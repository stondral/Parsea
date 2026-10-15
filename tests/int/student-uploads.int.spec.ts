import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadsRouter } from '@/server/routers/uploads'
const m = vi.hoisted(() => ({ auth: vi.fn(), execute: vi.fn(), findByID: vi.fn() }))
vi.mock('@/lib/payloadAuth', () => ({ getRequestUser: m.auth }))
const caller = () => uploadsRouter.createCaller({ headers: new Headers() })
describe('Student upload ownership and permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.auth.mockResolvedValue({
      user: { id: 2, role: 'student' },
      payload: { db: { drizzle: { execute: m.execute } }, findByID: m.findByID },
    })
  })
  it('rejects guests before signing a cloud URL', async () => {
    m.auth.mockResolvedValueOnce({ user: null, payload: {} })
    await expect(
      caller().uploadStatus({ id: '00000000-0000-4000-8000-000000000001' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(m.execute).not.toHaveBeenCalled()
  })
  it('does not disclose another student’s upload or allow its processing', async () => {
    m.execute.mockResolvedValue({
      rows: [{ id: '00000000-0000-4000-8000-000000000001', owner_id: 3 }],
    })
    await expect(
      caller().uploadStatus({ id: '00000000-0000-4000-8000-000000000001' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      caller().processUpload({ id: '00000000-0000-4000-8000-000000000001' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(m.execute).toHaveBeenCalledTimes(2)
  })
  it('does not let a student replace library PDFs', async () => {
    await expect(
      caller().prepareUpload({
        requestId: '00000000-0000-4000-8000-000000000001',
        name: 'Logic',
        originalFilename: 'Logic.pdf',
        bytes: 100,
        type: 'Notes',
        subject: 1,
        replaceDocumentId: 7,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(m.findByID).not.toHaveBeenCalled()
  })
  it('reuses an already indexed content hash before issuing another upload URL', async () => {
    m.findByID.mockResolvedValue({ id: 1, name: 'Math' })
    m.execute.mockResolvedValueOnce({
      rows: [{ id: '00000000-0000-4000-8000-000000000002', filename: 'Math_Logic.pdf' }],
    })
    const result = await caller().prepareUpload({
      requestId: '00000000-0000-4000-8000-000000000001',
      name: 'Renamed logic',
      originalFilename: 'Logic.pdf',
      bytes: 100,
      type: 'Notes',
      subject: 1,
      contentHash: 'a'.repeat(64),
    })
    expect(result).toMatchObject({
      id: '00000000-0000-4000-8000-000000000002',
      status: 'ready',
      url: null,
    })
    expect(m.execute).toHaveBeenCalledTimes(1)
  })
})
