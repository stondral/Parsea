import { beforeEach, describe, expect, it, vi } from 'vitest'
import { processDocument } from '@/hooks/processDocument'
const mocks = vi.hoisted(() => ({ extract: vi.fn(), embed: vi.fn(), upload: vi.fn() }))
vi.mock('@/lib/pdf-extraction', () => ({ extractPDF: mocks.extract }))
vi.mock('@/lib/embeddings', () => ({ getEmbedding: mocks.embed, EMBEDDING_MODEL: 'test-model' }))
vi.mock('@/lib/r2', () => ({
  uploadToR2: mocks.upload,
  getPresignedDownloadUrl: vi.fn(),
  R2_BUCKET: 'test',
}))
vi.mock('@langchain/textsplitters', () => ({
  RecursiveCharacterTextSplitter: class {
    async splitText(text: string) {
      return text ? [text] : []
    }
  },
}))
describe('Canonical indexing transaction safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.extract.mockResolvedValue([
      {
        pageNumber: 3,
        text: 'A readable explanation of propositions and truth tables.',
        screenshot: new Uint8Array([1]),
        ocr: true,
      },
    ])
    mocks.embed.mockResolvedValue([0, 1])
    mocks.upload.mockImplementation(async ({ key }) => ({ key, bucket: 'test' }))
  })
  function setup() {
    const execute = vi.fn(),
      remove = vi.fn(),
      outside = vi.fn()
    const req = {
      transactionID: 'parent',
      file: { data: Buffer.from('%PDF-test') },
      payload: {
        db: {
          drizzle: { execute: outside },
          sessions: { parent: { db: { execute } } },
          deleteMany: remove,
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        findByID: vi.fn(async () => ({
          name: 'Math',
          semester: { number: 3, branch: { name: 'COMPS' } },
        })),
        create: vi.fn(async () => ({ id: 9 })),
      },
    }
    return {
      execute,
      remove,
      outside,
      req,
      args: {
        doc: { id: 2, name: 'Logic', filename: 'Math_Logic.pdf', subject: 1 },
        req,
        operation: 'update',
      } as any,
    }
  }
  it('keeps writes in the parent transaction and preserves physical page numbers', async () => {
    const t = setup()
    const result = await processDocument(t.args)
    expect(t.outside).not.toHaveBeenCalled()
    expect(t.execute).toHaveBeenCalledTimes(2)
    expect(t.req.payload.create).toHaveBeenCalledWith(
      expect.objectContaining({ req: t.req, data: expect.objectContaining({ pageNumber: 3 }) }),
    )
    expect(result.storageKey).toContain('/versions/')
    expect(t.remove).toHaveBeenCalledTimes(2)
  })
  it('preserves the old index if extraction fails', async () => {
    mocks.extract.mockRejectedValueOnce(new Error('PDF could not be parsed'))
    const t = setup()
    await expect(processDocument(t.args)).rejects.toThrow('PDF could not be parsed')
    expect(t.remove).not.toHaveBeenCalled()
  })
  it('preserves the old index if model inference fails', async () => {
    mocks.embed.mockRejectedValueOnce(new Error('Model unavailable'))
    const t = setup()
    await expect(processDocument(t.args)).rejects.toThrow('Model unavailable')
    expect(t.remove).not.toHaveBeenCalled()
  })
  it('requires a cloud copy before publishing', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('Storage unavailable'))
    const t = setup()
    await expect(processDocument(t.args)).rejects.toThrow('Storage unavailable')
    expect(t.remove).not.toHaveBeenCalled()
  })
  it('fences a stale job attempt before replacing any published index', async () => {
    const t = setup()
    t.args.context = {
      uploadJobId: '00000000-0000-4000-8000-000000000001',
      uploadLeaseToken: '00000000-0000-4000-8000-000000000002',
    }
    t.outside.mockResolvedValue({ rows: [] })
    t.execute.mockResolvedValueOnce({
      rows: [{ lease_token: '00000000-0000-4000-8000-000000000003' }],
    })
    await expect(processDocument(t.args)).rejects.toThrow('lost its lease')
    expect(t.remove).not.toHaveBeenCalled()
  })
  it('rejects empty extraction', async () => {
    mocks.extract.mockResolvedValueOnce([])
    const t = setup()
    await expect(processDocument(t.args)).rejects.toThrow('No readable chunks')
    expect(t.remove).not.toHaveBeenCalled()
  })
})
