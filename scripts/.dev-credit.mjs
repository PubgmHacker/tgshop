import { prisma, LedgerType } from '@tgshop/db'
import { credit, getBalance } from '@tgshop/core'

const tgId = BigInt(process.env.DEV_PREVIEW_TG_ID ?? '777000123')
const amountCents = Number(process.argv[2] ?? 5000)

const user = await prisma.user.findUnique({ where: { tgId } })
if (!user) {
  console.error('preview user not found for tgId', tgId.toString())
  process.exit(1)
}

const before = await getBalance(prisma, user.id)
const result = await prisma.$transaction((tx) =>
  credit(tx, {
    userId: user.id,
    amountCents,
    type: LedgerType.TOPUP,
    comment: 'dev manual top-up for purchase-flow test',
    idempotencyKey: `dev-topup-${user.id}-${Date.now()}`
  })
)
console.log(
  JSON.stringify(
    {
      tgId: tgId.toString(),
      userId: user.id,
      beforeCents: before,
      creditedCents: amountCents,
      balanceAfterCents: result.balanceAfterCents
    },
    null,
    2
  )
)
await prisma.$disconnect()
