import type { Job } from 'bullmq'
import { prisma } from '@tgshop/db'
import { loadEncryptionKey } from '@tgshop/core'
import {
  sweep,
  createTronGridSigner,
  sumUnconfirmedInbound,
  LowTrxError,
  ManualSweepRequired,
  type SweepDeps,
  type SweepLedger,
  type TronConfig
} from '@tgshop/payments'
import { createWorker, QueueName, newCorrelationId, upsertRepeatable } from '../queue.js'
import { jobLogger } from '../logger.js'
import { getTronGridClient, type TronGridClient } from '../lib/trongrid.js'
import { loadEnv, type WorkerEnv } from '../env.js'
import { enqueueNotify } from './notify.js'

// ─────────────────────────────────────────────────────────────────────────────
// chain-sweep — repeatable job that consolidates USDT sitting in per-invoice
// DepositAddress rows into TRON_SWEEP_TO_ADDRESS.
//
// Key material and transaction construction live in @tgshop/payments; this
// worker supplies chain reads (via TronGrid), the persistence guard, and the
// alerting. It never holds a decrypted key longer than a single `sweep()` call.
//
// TWO MODES:
//   • READ-ONLY (default, TRON_SWEEP_READ_ONLY=true, or no TRON_MASTER_XPRV):
//     computes what *would* be swept and logs it. This is the documented
//     manual-sweep posture — an operator moves funds from a separate signing
//     environment. Nothing is signed or broadcast.
//   • LIVE (TRON_SWEEP_READ_ONLY=false AND TRON_MASTER_XPRV present): derives
//     each deposit address's own private key, funds its energy from the hot
//     wallet if needed, and broadcasts a real TRC-20 transfer.
//
// Also checks the treasury's TRX balance and raises a low-TRX admin alert
// below TRON_LOW_TRX_THRESHOLD, since TRC-20 transfers need TRX for energy.
// ─────────────────────────────────────────────────────────────────────────────

const SWEEP_INTERVAL_MS = 5 * 60 * 1000

export async function registerChainSweepRepeatables(): Promise<void> {
  await upsertRepeatable(QueueName.ChainSweep, 'sweep-usdt', SWEEP_INTERVAL_MS)
}

/**
 * Persistence guard against sweeping the same address twice.
 *
 * WHY A CONDITIONAL UPDATE IS ENOUGH: `claim` issues
 * `UPDATE deposit_addresses SET is_swept = true WHERE address = $1 AND is_swept = false`.
 * Postgres takes a row-level exclusive lock for the update; a second
 * transaction touching the same row blocks until the first commits and then —
 * under READ COMMITTED, via EvalPlanQual — re-evaluates its WHERE clause
 * against the newly committed row. It sees is_swept = true, matches zero rows,
 * and reports `count === 0`. So exactly one caller can ever win, and that holds
 * across BullMQ concurrency, across worker processes, and across machines,
 * because the arbitration happens in the database rather than in memory.
 *
 * A Redis lock or an in-process mutex would not survive a second worker
 * container; a Postgres advisory lock would, but Prisma's pool can route two
 * `$queryRaw` calls to different sessions, so a session-scoped lock could be
 * released from the wrong connection. The CAS needs no extra column, no extra
 * round trip, and no assumption about which pooled connection we land on.
 *
 * FAILURE POSTURE: the claim is taken before broadcasting. If the process dies
 * mid-sweep, the row stays is_swept = true with funds still on it. That is
 * deliberate — stranded funds are recoverable by an operator flipping the flag,
 * a double-spend is not. `release` is only called when payments proves nothing
 * was broadcast.
 */
function createPrismaSweepLedger(log: ReturnType<typeof jobLogger>): SweepLedger {
  return {
    async claim(address: string): Promise<boolean> {
      const claimed = await prisma.depositAddress.updateMany({
        where: { address, isSwept: false },
        data: { isSwept: true }
      })
      return claimed.count === 1
    },

    async release(address: string): Promise<void> {
      await prisma.depositAddress.updateMany({ where: { address }, data: { isSwept: false } })
    },

    async commit({ address, txHash, amountSwept }): Promise<void> {
      // isSwept is already true from `claim`; all that remains is recording what
      // actually went out. The hash goes on the row itself — that is what closes
      // the `isSwept && txHash == null` gap an interrupted sweep leaves behind —
      // and to AuditLog, which is where admins already read system provenance
      // and which keeps the amount alongside it.
      const row = await prisma.depositAddress.update({
        where: { address },
        data: { txHash, sweptAt: new Date() },
        select: { id: true }
      })
      await prisma.auditLog.create({
        data: {
          actorType: 'system',
          actorId: QueueName.ChainSweep,
          action: 'sweep_broadcast',
          entity: 'DepositAddress',
          entityId: row.id,
          diff: { address, txHash, amountSwept: amountSwept.toString() }
        }
      })
      log.info({ address, txHash, amountSwept: amountSwept.toString() }, 'chain-sweep broadcast recorded')
    }
  }
}

function buildTronConfig(env: WorkerEnv, masterXpub: string): TronConfig {
  return {
    masterXpub,
    // TronGrid serves unauthenticated requests at a lower rate limit, so an
    // empty key is a valid (if slower) configuration rather than a hard error.
    tronGridApiKey: env.TRONGRID_API_KEY ?? '',
    tronGridBaseUrl: env.TRONGRID_API_BASE,
    usdtContractAddress: env.TRON_USDT_CONTRACT,
    minConfirmations: env.TRON_MIN_CONFIRMATIONS,
    treasuryAddress: env.TRON_SWEEP_TO_ADDRESS ?? ''
  }
}

/** Chain reads shared by both modes, so read-only reports the same number live mode would act on. */
function createChainReaders(client: TronGridClient, env: WorkerEnv, createdAtMs: number) {
  return {
    getUsdtBalance: (address: string): Promise<bigint> =>
      client.getTrc20Balance(address, env.TRON_USDT_CONTRACT),

    getUnconfirmedInboundUsdt: async (address: string): Promise<bigint> => {
      const transfers = await client.getTrc20TransfersTo(address, env.TRON_USDT_CONTRACT, createdAtMs)
      return sumUnconfirmedInbound(
        transfers.map((tr) => ({ amount: BigInt(tr.value), blockTimestampMs: tr.block_timestamp })),
        Date.now(),
        env.TRON_MIN_CONFIRMATIONS
      )
    }
  }
}

async function processChainSweep(job: Job<Record<string, never>>): Promise<void> {
  const correlationId = newCorrelationId()
  const log = jobLogger(QueueName.ChainSweep, job.id, correlationId)
  const env = loadEnv()

  if (!env.TRON_SWEEP_TO_ADDRESS) {
    log.debug('TRON_SWEEP_TO_ADDRESS not configured, skipping chain-sweep')
    return
  }
  if (!env.TRON_MASTER_XPUB) {
    log.debug('TRON_MASTER_XPUB not configured, skipping chain-sweep')
    return
  }

  const threshold = BigInt(env.TRON_SWEEP_THRESHOLD)
  const client = getTronGridClient()
  const config = buildTronConfig(env, env.TRON_MASTER_XPUB)

  // Live mode needs the extended PRIVATE key: an xpub can derive deposit
  // addresses but provably cannot sign transfers out of them.
  const liveMode = !env.TRON_SWEEP_READ_ONLY && Boolean(env.TRON_MASTER_XPRV)

  const candidates = await prisma.depositAddress.findMany({
    where: { isSwept: false, network: 'TRON' }
  })

  const signer = createTronGridSigner(config)
  const ledger = createPrismaSweepLedger(log)
  const encryptionKey = liveMode ? loadEncryptionKey() : undefined

  let sweptCount = 0
  let skippedCount = 0
  let sweptTotalUsdt6 = 0n

  for (const depositAddress of candidates) {
    try {
      const readers = createChainReaders(client, env, depositAddress.createdAt.getTime())

      if (!liveMode) {
        const balanceUsdt6 = await readers.getUsdtBalance(depositAddress.address)
        skippedCount += 1
        if (balanceUsdt6 < threshold) continue
        log.info(
          {
            address: depositAddress.address,
            balanceUsdt6: balanceUsdt6.toString(),
            reason: env.TRON_SWEEP_READ_ONLY ? 'TRON_SWEEP_READ_ONLY=true' : 'TRON_MASTER_XPRV not configured'
          },
          'chain-sweep (read-only): would sweep — move these funds manually'
        )
        continue
      }

      const deps: SweepDeps = {
        ...readers,
        encryptionKey,
        ledger,
        getTrxBalanceSun: (address: string) => client.getTrxBalanceSun(address),
        signAndBroadcast: signer.signAndBroadcastTrc20,
        sendTrx: signer.sendTrx
      }

      const outcome = await sweep(
        config,
        {
          derivationIndex: depositAddress.derivationIndex,
          toAddress: env.TRON_SWEEP_TO_ADDRESS,
          // Cross-check: the row we are about to drain must be the address the
          // xpub derives for this index, or the key would not control it.
          expectedAddress: depositAddress.address,
          encryptedMasterXprv: env.TRON_MASTER_XPRV,
          encryptedHotWalletKey: env.TRON_HOT_WALLET_KEY,
          readOnly: false,
          thresholdUsdt6: threshold,
          energy: {
            reserveSun: BigInt(env.TRON_SWEEP_ENERGY_RESERVE_SUN),
            topUpSun: BigInt(env.TRON_SWEEP_TOPUP_SUN),
            hotWalletFloorSun: BigInt(env.TRON_SWEEP_HOT_WALLET_FLOOR_SUN),
            feeLimitSun: BigInt(env.TRON_SWEEP_FEE_LIMIT_SUN),
            topUpTimeoutMs: env.TRON_SWEEP_TOPUP_TIMEOUT_MS,
            topUpPollIntervalMs: env.TRON_SWEEP_TOPUP_POLL_INTERVAL_MS
          }
        },
        deps
      )

      if (outcome.status === 'swept') {
        sweptCount += 1
        sweptTotalUsdt6 += BigInt(outcome.amountSwept)
        log.info(
          {
            address: outcome.fromAddress,
            txHash: outcome.txHash,
            amountUsdt6: outcome.amountSwept,
            topUpTxHash: outcome.topUpTxHash
          },
          'chain-sweep swept deposit address'
        )
      } else {
        skippedCount += 1
        log.debug(
          { address: outcome.fromAddress, reason: outcome.reason, sweepable: outcome.sweepableAmount },
          'chain-sweep skipped deposit address'
        )
      }
    } catch (err) {
      skippedCount += 1
      await handleSweepError(err, depositAddress.address, client, log)
    }
  }

  await checkLowTrx(client, env, log)

  log.info(
    {
      swept: sweptCount,
      sweptTotalUsdt6: sweptTotalUsdt6.toString(),
      skipped: skippedCount,
      total: candidates.length,
      mode: liveMode ? 'live' : 'read-only'
    },
    'chain-sweep sweep complete'
  )
}

async function handleSweepError(
  err: unknown,
  address: string,
  client: TronGridClient,
  log: ReturnType<typeof jobLogger>
): Promise<void> {
  if (err instanceof ManualSweepRequired) {
    // Expected in read-only mode; not an operational failure.
    log.info({ address, balance: err.balance.toString() }, 'chain-sweep: manual sweep required')
    return
  }
  if (err instanceof LowTrxError) {
    // Out of TRX for energy: alert rather than retry-burn. The address keeps
    // its funds and is picked up again once the hot wallet is refilled.
    // `err.address` is whichever wallet came up short — the deposit address
    // when there is no hot wallet key, otherwise the hot wallet itself.
    const shortfallTrx = (Number(err.requiredSunEstimate) / 1_000_000).toFixed(2)
    log.warn(
      { address: err.address, shortfallTrx },
      'chain-sweep: insufficient TRX for energy, skipping without broadcasting'
    )
    // The alert template reports a balance, so read the real one rather than
    // rendering the shortfall as a negative number.
    let balanceTrxDisplay = `<${shortfallTrx} short`
    try {
      balanceTrxDisplay = (Number(await client.getTrxBalanceSun(err.address)) / 1_000_000).toFixed(2)
    } catch (balanceErr) {
      log.debug({ balanceErr }, 'chain-sweep: could not read TRX balance for the low-TRX alert')
    }
    await enqueueNotify({ kind: 'low_trx', address: err.address, balanceTrxDisplay })
    return
  }
  const reason = err instanceof Error ? err.message : String(err)
  log.error({ err, address }, 'chain-sweep failed for address')
  await enqueueNotify({ kind: 'sweep_failed', address, reason })
}

async function checkLowTrx(
  client: TronGridClient,
  env: WorkerEnv,
  log: ReturnType<typeof jobLogger>
): Promise<void> {
  if (!env.TRON_SWEEP_TO_ADDRESS) return
  try {
    const balanceSun = await client.getTrxBalanceSun(env.TRON_SWEEP_TO_ADDRESS)
    const thresholdSun = BigInt(env.TRON_LOW_TRX_THRESHOLD)
    if (balanceSun < thresholdSun) {
      const balanceTrxDisplay = (Number(balanceSun) / 1_000_000).toFixed(2)
      await enqueueNotify({ kind: 'low_trx', address: env.TRON_SWEEP_TO_ADDRESS, balanceTrxDisplay })
    }
  } catch (err) {
    log.error({ err }, 'chain-sweep: failed to check TRX balance for low-TRX alert')
  }
}

export function startChainSweepWorker() {
  return createWorker<Record<string, never>, void>(QueueName.ChainSweep, processChainSweep)
}
