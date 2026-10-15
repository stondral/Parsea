import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queueUploadJob, processUploadJob } from '@/lib/uploadJobs'
import { IngestionPending, DuplicateDocument } from '@/lib/ingestionControl'
const m = vi.hoisted(() => ({ size: vi.fn(), presign: vi.fn() }))
vi.mock('@/lib/r2', () => ({ getR2ObjectSize: m.size, getPresignedDownloadUrl: m.presign }))
describe('Durable cloud upload safety', () => {
  const job = {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'queued',
    storage_key: 'uploads/id/Math_Logic.pdf',
    bytes: 9,
    filename: 'Math_Logic.pdf',
    metadata: { name: 'Logic', chapter: 'Logic', type: 'Notes', subject: 1 },
  }
  function setup() {
    return { db: { drizzle: { execute: vi.fn() } }, create: vi.fn(), update: vi.fn() } as any
  }
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    m.presign.mockResolvedValue('https://example.test/pdf')
  })
  it('does not enqueue an incomplete upload', async () => {
    const payload = setup()
    payload.db.drizzle.execute.mockResolvedValueOnce({ rows: [{ ...job, status: 'uploading' }] })
    m.size.mockResolvedValueOnce(8)
    await expect(queueUploadJob(payload, job.id)).rejects.toThrow('incomplete')
    expect(payload.db.drizzle.execute).toHaveBeenCalledTimes(1)
  })
  it('never processes a ready job twice after a lost response', async () => {
    const payload = setup()
    payload.db.drizzle.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...job, status: 'ready', document_id: 7 }] })
    expect((await processUploadJob(payload, job.id)).document_id).toBe(7)
    expect(payload.create).not.toHaveBeenCalled()
  })
  it('passes verified bytes into the canonical hook and preserves replacement IDs', async () => {
    const payload = setup()
    payload.db.drizzle.execute
      .mockResolvedValueOnce({
        rows: [{ ...job, metadata: { ...job.metadata, replaceDocumentId: 7 } }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...job, status: 'ready', document_id: 7 }] })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => Buffer.from('%PDF-test') })),
    )
    await processUploadJob(payload, job.id)
    expect(payload.create).not.toHaveBeenCalled()
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 7,
        context: expect.objectContaining({
          forceDocumentIngestion: true,
          uploadJobId: job.id,
          documentSource: expect.any(Buffer),
        }),
      }),
    )
  })
  it('records corrupt uploads as failed without creating a document', async () => {
    const payload = setup()
    payload.db.drizzle.execute
      .mockResolvedValueOnce({ rows: [job] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...job, status: 'failed', error: 'Incomplete PDF' }] })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => Buffer.from('not a PDF') })),
    )
    expect((await processUploadJob(payload, job.id)).status).toBe('failed')
    expect(payload.create).not.toHaveBeenCalled()
  })
  it('rejects a content hash mismatch before creating an index', async () => {
    const payload = setup()
    payload.db.drizzle.execute
      .mockResolvedValueOnce({ rows: [{ ...job, content_hash: '0'.repeat(64) }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...job, status: 'failed' }] })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => Buffer.from('%PDF-test') })),
    )
    expect((await processUploadJob(payload, job.id)).status).toBe('failed')
    expect(payload.create).not.toHaveBeenCalled()
  })
  it('requeues a bounded page batch instead of reporting indexing failure', async () => {
    const payload = setup()
    payload.db.drizzle.execute
      .mockResolvedValueOnce({ rows: [job] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...job, status: 'queued', progress: 42 }] })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => Buffer.from('%PDF-test') })),
    )
    payload.create.mockRejectedValueOnce(new IngestionPending())
    const result = await processUploadJob(payload, job.id)
    expect(result.status).toBe('queued')
    expect(result.progress).toBe(42)
  })
  it('returns the existing document when concurrent publication detects a duplicate', async () => {
    const payload = setup()
    payload.db.drizzle.execute
      .mockResolvedValueOnce({ rows: [job] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...job, status: 'ready', document_id: 19 }] })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => Buffer.from('%PDF-test') })),
    )
    payload.create.mockRejectedValueOnce(new DuplicateDocument(19))
    expect((await processUploadJob(payload, job.id)).document_id).toBe(19)
  })
})
