import { AdminRole } from '@tgshop/db'
import { listBroadcastsAction, segmentCountsAction } from '../../../lib/actions/broadcasts'
import { BROADCAST_SEGMENTS } from '../../../lib/schemas'
import { hasRole, requireSession } from '../../../lib/rbac'
import { BroadcastsClient, type BroadcastRow, type BroadcastStats, type SegmentOption } from './broadcasts-client'
import { t } from '../../../lib/i18n'

export const dynamic = 'force-dynamic'

/**
 * `BroadcastPost.statsJson` is a free-form Json column written by apps/worker
 * ({ total, sent, blocked, failed, startedAt, finishedAt }). Older or partial
 * rows must not crash the list, so every field is read defensively.
 */
function toStats(value: unknown): BroadcastStats | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const read = (key: string): number => {
    const raw = record[key]
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
  }
  return { total: read('total'), sent: read('sent'), blocked: read('Заблокирован'), failed: read('failed') }
}

export default async function BroadcastsPage() {
  const session = await requireSession()

  const [posts, counts] = await Promise.all([listBroadcastsAction(), segmentCountsAction()])

  const countBySegment = new Map(counts.map((entry) => [entry.segment, entry]))
  const segments: SegmentOption[] = BROADCAST_SEGMENTS.map((definition) => {
    const counted = countBySegment.get(definition.value)
    return {
      value: definition.value,
      label: definition.label,
      count: counted?.count ?? 0,
      workerSupported: definition.workerSupported
    }
  })

  const rows: BroadcastRow[] = posts.map((post) => ({
    id: post.id,
    text: post.text,
    mediaUrl: post.mediaUrl,
    segment: post.segment,
    status: post.status,
    scheduledAt: post.scheduledAt ? post.scheduledAt.toISOString() : null,
    sentAt: post.sentAt ? post.sentAt.toISOString() : null,
    createdAt: post.createdAt.toISOString(),
    stats: toStats(post.statsJson)
  }))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('broadcasts.title')}</h1>
      <BroadcastsClient
        posts={rows}
        segments={segments}
        canCompose={hasRole(session.role, AdminRole.ADMIN)}
        canDelete={hasRole(session.role, AdminRole.OWNER)}
      />
    </div>
  )
}
