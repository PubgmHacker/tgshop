import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AdminRole } from '@tgshop/db'
import { createFixture, prisma, type TestFixture } from './setup.js'

const session = vi.hoisted(() => ({ role: 'SUPPORT', adminId: 'e2e-catalog-audit' }))
vi.mock('../../apps/admin/node_modules/next/cache.js', () => ({ revalidatePath: vi.fn() }))
vi.mock('../../apps/admin/src/lib/rbac', () => ({
  requireRole: async () => session,
  hasRole: (role: string) => role === 'ADMIN' || role === 'OWNER'
}))

import { getProductAction, listProductsAction, upsertProductAction } from '../../apps/admin/src/lib/actions/products'
import { listPlansAction } from '../../apps/admin/src/lib/actions/plans'

describe('admin catalog supplier credentials', () => {
  let fixture: TestFixture
  const config = { deliveryUrl: 'https://supplier.example/deliver', headers: { Authorization: 'Bearer fixture-secret' } }

  beforeAll(async () => {
    fixture = await createFixture({ externalConfig: config, stockCount: 0 })
    session.adminId = fixture.id
  })

  afterAll(async () => {
    if (!fixture) return
    await prisma.auditLog.deleteMany({ where: { actorId: fixture.id } })
    await fixture.cleanup()
  })

  it('does not return credentials to SUPPORT, including through plan relations', async () => {
    session.role = AdminRole.SUPPORT
    expect((await getProductAction(fixture.product.id))?.externalConfig).toBeNull()
    expect((await listProductsAction(fixture.category.id)).every((product) => product.externalConfig === null)).toBe(true)
    expect(JSON.stringify(await listPlansAction(fixture.product.id))).not.toContain('fixture-secret')
  })

  it('lets ADMIN edit configuration without copying credentials into the audit log', async () => {
    session.role = AdminRole.ADMIN
    expect((await getProductAction(fixture.product.id))?.externalConfig).toEqual(config)
    await upsertProductAction({
      ...fixture.product,
      externalConfig: config
    })
    const entries = await prisma.auditLog.findMany({ where: { actorId: fixture.id } })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.diff).toMatchObject({ externalConfigChanged: true })
    expect(JSON.stringify(entries)).not.toContain('fixture-secret')
  })

  it('clears persisted configuration when the editor submits null', async () => {
    session.role = AdminRole.ADMIN
    await upsertProductAction({ ...fixture.product, externalConfig: null })
    expect((await prisma.product.findUniqueOrThrow({ where: { id: fixture.product.id } })).externalConfig).toBeNull()
  })
})
