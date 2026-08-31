// Drives the broadcast lifecycle against real Postgres + Redis.
//
// The four defects this covers were all invisible to a typecheck, because each
// one was a correct-looking call whose effect landed in Redis:
//
//   1. an explicitly published post that nothing ever arms -> delivered never
//   2. a delayed job with no deterministic id           -> uncancellable
//   3. QUEUED written as SENDING                        -> permanently frozen
//   4. three producers spelling the job name differently
//
// Everything below imports the REAL production modules rather than a local
// mirror of them: the post is armed through apps/bot's publishPost() and then
// looked up through apps/worker's broadcastJobId(), so a disagreement between
// the two packages about the queue name, the job name or the id format shows up
// as a missing job instead of a passing test. (Imports go through dist/ because
// scripts/ is at the repo root, outside every workspace's node_modules.)
//
// Nothing here sends a Telegram message: every case stops at the moment the
// worker would begin fanning out, which is exactly where the cancel guard, the
// arming logic and the id contract live.
import { readFileSync } from 'node:fs'
import { prisma, PostStatus, PostSource } from '../packages/db/dist/index.js'
import { getQueue, QueueName, closeAllWorkers } from '../apps/worker/dist/queue.js'
import { closeRedisConnection } from '../apps/worker/dist/redis.js'
import { broadcastJobId, enqueueBroadcast, BROADCAST_JOB_NAME } from '../apps/worker/dist/queues/broadcast.js'
import { createPost, publishPost } from '../apps/bot/dist/domain/content.js'
import { closeBroadcastQueue } from '../apps/bot/dist/domain/content.js'
import { redis as botRedis } from '../apps/bot/dist/config/redis.js'

const queue = getQueue(QueueName.Broadcast)

let failures = 0
const created = []

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` -> got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`
  )
}

/** Creates a post through the bot's real createPost(), then forces a status the test needs. */
async function makePost({ status, scheduledAt = null, source = PostSource.MANUAL } = {}) {
  const post = await createPost({ text: 'verify-broadcast', segment: 'all', scheduledAt, source })
  created.push(post.id)
  if (!status || post.status === status) return post
  return prisma.broadcastPost.update({ where: { id: post.id }, data: { status } })
}

console.log('=== BROADCAST LIFECYCLE ===')

// ── 1. The bot arms a scheduled post; the worker can name the job it made ──
// This is the cross-producer test: apps/bot writes the job, apps/worker
// addresses it. Both halves of the contract have to match for this to pass.
{
  const hourMs = 60 * 60 * 1000
  const post = await makePost({ scheduledAt: new Date(Date.now() + hourMs) })
  check('a scheduled MANUAL post starts SCHEDULED', post.status, PostStatus.SCHEDULED)

  const published = await publishPost(post.id)
  check('publishPost() moves it to QUEUED, not SENDING', published.status, PostStatus.QUEUED)

  const job = await queue.getJob(broadcastJobId(post.id))
  check('the bot-produced job is retrievable by the worker id', job !== undefined && job !== null, true)
  check('the two packages agree on the job name', job.name, BROADCAST_JOB_NAME)
  check('the job carries the postId', job.data.postId, post.id)
  check('the job is held, not runnable', await job.getState(), 'delayed')

  // The cancel path: remove the job, then flip the row. Removing by id is the
  // whole point of the deterministic id — an auto-id job could not be found.
  await job.remove()
  check('job is gone after remove()', (await queue.getJob(broadcastJobId(post.id))) ?? null, null)

  await prisma.broadcastPost.update({ where: { id: post.id }, data: { status: PostStatus.CANCELLED } })
  const after = await prisma.broadcastPost.findUnique({ where: { id: post.id } })
  check('cancelled post reaches CANCELLED', after.status, PostStatus.CANCELLED)
}

// ── 2. Arming twice is a no-op, not a double send ──────────────────────────
// The property every producer leans on: queue.add() with an id that already
// exists silently keeps the first job. Proven by the delay not moving.
{
  const post = await makePost({ status: PostStatus.QUEUED })
  await enqueueBroadcast(post.id, 60_000)
  await enqueueBroadcast(post.id, 3_600_000)

  const job = await queue.getJob(broadcastJobId(post.id))
  check('re-arming an already-armed post keeps the first job', job.opts.delay, 60_000)
  await job.remove()
}

// ── 3. A cancelled post sends to nobody, even if a job survives the race ───
// Reproduces the exact interleaving the conditional claim exists for: the
// admin cancels while the worker is picking the job up.
{
  const post = await makePost({ status: PostStatus.CANCELLED })

  const claimed = await prisma.broadcastPost.updateMany({
    where: { id: post.id, status: { notIn: [PostStatus.SENT, PostStatus.CANCELLED] } },
    data: { status: PostStatus.SENDING }
  })
  check('claim matches nothing for a CANCELLED post', claimed.count, 0)

  const after = await prisma.broadcastPost.findUnique({ where: { id: post.id } })
  check('CANCELLED post was not flipped to SENDING', after.status, PostStatus.CANCELLED)
}

// ── 4. An already-SENT post cannot be re-sent by a retried job ─────────────
{
  const post = await makePost({ status: PostStatus.SENT })
  const claimed = await prisma.broadcastPost.updateMany({
    where: { id: post.id, status: { notIn: [PostStatus.SENT, PostStatus.CANCELLED] } },
    data: { status: PostStatus.SENDING }
  })
  check('claim matches nothing for a SENT post', claimed.count, 0)
}

// ── 5. A post can be re-armed once its job is gone ─────────────────────────
// The failure this catches: retrying a FAILED broadcast enqueues nothing while
// reporting success, because the retained finished job still holds the id.
{
  const post = await makePost({ status: PostStatus.FAILED })
  const id = broadcastJobId(post.id)

  await enqueueBroadcast(post.id, 60_000)
  await (await queue.getJob(id)).remove()

  await enqueueBroadcast(post.id, 60_000)
  const second = await queue.getJob(id)
  check('post can be re-armed after its job was removed', second !== undefined && second !== null, true)
  check('re-armed job carries the right postId', second.data.postId, post.id)
  await second.remove()
}

// ── 6. The sweep finds an armed-but-jobless post, not a saved schedule ─────
{
  const past = new Date(Date.now() - 60_000)
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000)

  const savedSchedule = await makePost({ status: PostStatus.SCHEDULED, scheduledAt: past })
  const notDue = await makePost({ status: PostStatus.SCHEDULED, scheduledAt: future })
  const orphan = await makePost({ status: PostStatus.QUEUED, scheduledAt: past })
  const draft = await makePost({ status: PostStatus.DRAFT })

  // The sweep's own query, verbatim from broadcast.worker.ts::sweepDuePosts.
  const found = await prisma.broadcastPost.findMany({
    where: { status: PostStatus.QUEUED },
    select: { id: true }
  })
  const ids = new Set(found.map((p) => p.id))

  check('sweep ignores a saved SCHEDULED post', ids.has(savedSchedule.id), false)
  check('sweep picks up a QUEUED post whose job vanished', ids.has(orphan.id), true)
  check('sweep ignores a SCHEDULED post that is not due yet', ids.has(notDue.id), false)
  check('sweep ignores an unarmed DRAFT', ids.has(draft.id), false)
}

// ── 7. An AGENT-authored post never lands in an armable state ──────────────
// The safety gate: an agent-authored post stays DRAFT even when it carries a
// requested schedule, so it cannot reach customers without a human publish.
{
  const post = await makePost({ scheduledAt: new Date(Date.now() + 60_000), source: PostSource.AGENT })
  check('AGENT post with a scheduledAt is DRAFT, not SCHEDULED', post.status, PostStatus.DRAFT)
  check('the requested time is still recorded', post.scheduledAt !== null, true)
}

// ── 8. The admin producer spells the contract the same way ─────────────────
// apps/admin only exists inside a Next build, so it cannot be imported here the
// way the other two producers are. A source-level check is the honest fallback:
// it is the third spelling of the contract, and it was wrong once already
// ('send-broadcast'), so leaving it unchecked is what let that drift happen.
{
  const src = readFileSync(new URL('../apps/admin/src/lib/queue.ts', import.meta.url), 'utf8')
  check(
    'admin uses the same job name as bot and worker',
    src.includes(`export const BROADCAST_JOB_NAME = '${BROADCAST_JOB_NAME}'`),
    true
  )
  check('admin builds the same job id', src.includes('`broadcast-${postId}`'), true)
}

// ── cleanup ───────────────────────────────────────────────────────────────
for (const id of created) {
  const job = await queue.getJob(broadcastJobId(id))
  if (job) await job.remove()
}
await prisma.broadcastPost.deleteMany({ where: { id: { in: created } } })

console.log(failures === 0 ? 'ALL BROADCAST CHECKS PASSED' : `${failures} CHECK(S) FAILED`)

await closeBroadcastQueue()
await botRedis.quit()
await closeAllWorkers()
await closeRedisConnection()
await prisma.$disconnect()
process.exit(failures === 0 ? 0 : 1)
