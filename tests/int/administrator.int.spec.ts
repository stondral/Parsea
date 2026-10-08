import { beforeEach, describe, expect, it, vi } from 'vitest'
import { administratorRouter } from '@/server/routers/administrator'
import { requireEmptyCurriculum } from '@/hooks/requireEmptyCurriculum'
import { syncDocumentMetadata } from '@/hooks/syncDocumentMetadata'
import { adminOnly, adminOrSelf, adminRoleOnly } from '@/access/admin'

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  payload: {
    find: vi.fn(),
    findByID: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    db: { drizzle: { execute: vi.fn() } },
  },
}))
vi.mock('@/lib/payloadAuth', () => ({
  getRequestUser: mocks.getRequestUser,
  isAdminUser: (user: any) => user?.role === 'admin',
}))
const admin = { id: 1, role: 'admin', email: 'admin@example.test' }
const caller = () =>
  administratorRouter.createCaller({ headers: new Headers({ cookie: 'session=example' }) })

describe('Administrator management (mocked services; no database writes)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRequestUser.mockResolvedValue({ payload: mocks.payload, user: admin })
    mocks.payload.count.mockResolvedValue({ totalDocs: 0 })
  })

  it('denies guests and students before reading private data or writing', async () => {
    mocks.getRequestUser.mockResolvedValueOnce({ payload: mocks.payload, user: null })
    await expect(caller().overview()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    mocks.getRequestUser.mockResolvedValueOnce({
      payload: mocks.payload,
      user: { id: 2, role: 'student' },
    })
    await expect(caller().deleteDocuments({ ids: [2] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(mocks.payload.count).not.toHaveBeenCalled()
    expect(mocks.payload.delete).not.toHaveBeenCalled()
  })

  it('returns only explicitly selected user profile fields', async () => {
    mocks.payload.find.mockResolvedValue({
      docs: [
        {
          id: 2,
          name: 'Student',
          email: 'student@example.test',
          role: 'student',
          hash: 'secret',
          salt: 'secret',
          resetPasswordToken: 'secret',
        },
      ],
      totalDocs: 1,
      totalPages: 1,
    })
    const result = await caller().users({ page: 1 })
    expect(result.items[0]).not.toHaveProperty('hash')
    expect(result.items[0]).not.toHaveProperty('resetPasswordToken')
    expect(mocks.payload.find).toHaveBeenCalledWith(
      expect.objectContaining({ overrideAccess: false, user: admin, limit: 20 }),
    )
  })

  it('validates curriculum parents and rejects moving existing folders', async () => {
    await expect(
      caller().saveFolder({ collection: 'modules', name: 'Logic', number: '1' }),
    ).rejects.toThrow('Choose a parent')
    mocks.payload.findByID
      .mockResolvedValueOnce({ id: 5 })
      .mockResolvedValueOnce({ id: 2, subject: 3 })
    await expect(
      caller().saveFolder({
        collection: 'modules',
        id: 2,
        name: 'Logic',
        number: '1',
        parentId: 5,
      }),
    ).rejects.toThrow('cannot be moved')
    expect(mocks.payload.update).not.toHaveBeenCalled()
  })

  it('creates a numbered module through Payload with real access checks', async () => {
    mocks.payload.findByID.mockResolvedValue({ id: 5 })
    mocks.payload.create.mockResolvedValue({ id: 9, name: 'Logic', number: '1', subject: 5 })
    expect(
      await caller().saveFolder({ collection: 'modules', name: 'Logic', number: '1', parentId: 5 }),
    ).toMatchObject({ id: 9, parentId: 5 })
    expect(mocks.payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'Logic', number: '1', subject: 5 },
        overrideAccess: false,
      }),
    )
  })

  it('reports partial deletion failures instead of pretending all PDFs were removed', async () => {
    mocks.payload.delete
      .mockResolvedValueOnce({ id: 2 })
      .mockRejectedValueOnce(new Error('Storage unavailable'))
    expect(await caller().deleteDocuments({ ids: [2, 3, 2] })).toEqual({
      deleted: [2],
      failed: [{ id: 3, message: 'Storage unavailable' }],
    })
    expect(mocks.payload.delete).toHaveBeenCalledTimes(2)
  })

  it('retries indexing only via the canonical document hook and propagates failures', async () => {
    mocks.payload.findByID.mockResolvedValue({ id: 2, name: 'Logic' })
    mocks.payload.update.mockResolvedValue({ id: 2 })
    await caller().reindexDocument({ id: 2 })
    expect(mocks.payload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { forceDocumentIngestion: true, failOnIngestionError: true },
        overrideAccess: false,
      }),
    )
    mocks.payload.update.mockRejectedValueOnce(new Error('No readable text'))
    await expect(caller().reindexDocument({ id: 2 })).rejects.toThrow('No readable text')
  })

  it('requires explicit role confirmation and prevents self-demotion', async () => {
    mocks.payload.findByID.mockResolvedValue({ id: 2, role: 'student' })
    await expect(
      caller().saveUser({ id: 2, name: 'Student', semester: 3, role: 'admin' }),
    ).rejects.toThrow('Confirm')
    mocks.payload.findByID.mockResolvedValue({ id: 1, role: 'admin' })
    await expect(
      caller().saveUser({
        id: 1,
        name: 'Admin',
        semester: null,
        role: 'student',
        confirmRoleChange: true,
      }),
    ).rejects.toThrow('own admin')
    expect(mocks.payload.update).not.toHaveBeenCalled()
  })

  it('blocks deleting curriculum folders with child folders or PDFs', async () => {
    const req = { payload: mocks.payload } as any
    mocks.payload.count.mockResolvedValueOnce({ totalDocs: 1 })
    await expect(
      requireEmptyCurriculum({ id: 5, req, collection: { slug: 'subjects' } } as any),
    ).rejects.toThrow('Remove the modules')
    mocks.payload.count
      .mockResolvedValueOnce({ totalDocs: 0 })
      .mockResolvedValueOnce({ totalDocs: 2 })
    await expect(
      requireEmptyCurriculum({ id: 5, req, collection: { slug: 'subjects' } } as any),
    ).rejects.toThrow('PDFs')
  })

  it('keeps metadata SQL inside the parent transaction and does not touch embeddings', async () => {
    const execute = vi.fn()
    const req = {
      transactionID: Promise.resolve('parent'),
      payload: { db: { sessions: { parent: { db: { execute } } }, drizzle: { execute: vi.fn() } } },
    }
    await syncDocumentMetadata({
      doc: { id: 2 },
      req,
      operation: 'update',
      collection: { slug: 'documents' },
    } as any)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(req.payload.db.drizzle.execute).not.toHaveBeenCalled()
  })

  it('protects account roles and restricts students to their own profile', () => {
    expect(adminRoleOnly({ req: { user: { id: 2, role: 'student' } } as any })).toBe(false)
    expect(adminOnly({ req: { user: admin } as any })).toBe(true)
    expect(adminOrSelf({ req: { user: { id: 2, role: 'student' } } } as any)).toEqual({
      id: { equals: 2 },
    })
  })
})
