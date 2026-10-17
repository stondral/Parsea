import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queueDocumentReindex } from '@/lib/reindexJob'
import { DocumentPages } from '@/collections/DocumentPages'
import { Chunks } from '@/collections/Chunks'
const m = vi.hoisted(() => ({ copy: vi.fn(), read: vi.fn() }))
vi.mock('@/lib/r2', () => ({ copyR2Object: m.copy }))
vi.mock('@/lib/uploadJobs', () => ({ readUploadJob: m.read }))
describe('Durable administrator re-index preparation', () => {
  const user = { id: 1, role: 'admin' } as any
  const payload = { findByID: vi.fn(), db: { drizzle: { execute: vi.fn() } } } as any
  beforeEach(() => {
    vi.clearAllMocks()
    payload.findByID.mockResolvedValue({
      id: 12,
      filename: 'Math_Relations.pdf',
      storageKey: 'published/old.pdf',
      subject: 1,
      module: 3,
      name: 'Relations',
      type: 'Notes',
    })
    payload.db.drizzle.execute.mockResolvedValue({ rows: [] })
    m.copy.mockResolvedValue(1024)
    m.read.mockResolvedValue({ id: 'job', status: 'queued', metadata: { replaceDocumentId: 12 } })
  })
  it('stages a cloud-side copy without updating the existing document or its index', async () => {
    const result = await queueDocumentReindex(payload, 12, user)
    expect(result.status).toBe('queued')
    expect(payload.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ id: 12, user, overrideAccess: false }),
    )
    expect(m.copy).toHaveBeenCalledWith(
      'published/old.pdf',
      expect.stringMatching(/^uploads\/reindex\/.+\/Math_Relations.pdf$/),
      undefined,
    )
    expect(payload.db.drizzle.execute).toHaveBeenCalledTimes(2)
    expect(m.read).toHaveBeenCalledTimes(1)
  })
  it('reuses an interrupted durable replacement instead of copying the PDF again', async () => {
    payload.db.drizzle.execute.mockResolvedValueOnce({ rows: [{ id: 'existing' }] })
    await queueDocumentReindex(payload, 12, user)
    expect(m.read).toHaveBeenCalledWith(payload, 'existing')
    expect(m.copy).not.toHaveBeenCalled()
  })
  it('denies non-admins and rejects missing cloud sources honestly', async () => {
    await expect(
      queueDocumentReindex(payload, 12, { id: 2, role: 'student' } as any),
    ).rejects.toThrow('Admin')
    expect(payload.findByID).not.toHaveBeenCalled()
    payload.findByID.mockResolvedValueOnce({ id: 12, filename: 'Math.pdf' })
    await expect(queueDocumentReindex(payload, 12, user)).rejects.toThrow('Replace PDF')
    expect(m.copy).not.toHaveBeenCalled()
  })
  it('keeps source reads public but prevents students from injecting signed preview keys or vectors', () => {
    for (const collection of [DocumentPages, Chunks]) {
      expect((collection.access!.read as any)({ req: { user: null } })).toBe(true)
      for (const action of ['create', 'update', 'delete'] as const) {
        expect((collection.access![action] as any)({ req: { user: { role: 'student' } } })).toBe(
          false,
        )
        expect((collection.access![action] as any)({ req: { user: { role: 'admin' } } })).toBe(true)
      }
    }
  })
})
