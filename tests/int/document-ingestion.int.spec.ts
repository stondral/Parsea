import { describe, it, beforeEach, expect, vi } from 'vitest'
import { processDocument } from '@/hooks/processDocument'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  embed: vi.fn(),
  upload: vi.fn(),
  presign: vi.fn(),
  info: vi.fn(),
  screenshot: vi.fn(),
  ocr: vi.fn(),
}))
vi.mock('@/lib/embeddings', () => ({ getEmbedding: mocks.embed }))
vi.mock('@/lib/r2', () => ({
  uploadToR2: mocks.upload,
  getPresignedDownloadUrl: mocks.presign,
  R2_BUCKET: 'test',
}))
vi.mock('@/lib/ocr', () => ({ extractTextFromImage: mocks.ocr }))
vi.mock('@langchain/community/document_loaders/fs/pdf', () => ({
  PDFLoader: class {
    load = mocks.load
  },
}))
vi.mock('pdf-parse/worker', () => ({ CanvasFactory: class {} }))
vi.mock('pdf-parse', () => ({
  PDFParse: class {
    async load() {}
    getInfo = mocks.info
    getScreenshot = mocks.screenshot
    async getImage() {
      return { pages: [] }
    }
    async destroy() {}
  },
}))
vi.mock('@langchain/textsplitters', () => ({
  RecursiveCharacterTextSplitter: class {
    async createDocuments(text: string[]) {
      return text.map((pageContent) => ({ pageContent }))
    }
  },
}))

describe('Canonical indexing retry safety (no real embeddings or storage calls)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.upload.mockResolvedValue(undefined)
    mocks.embed.mockResolvedValue([0, 1])
    mocks.info.mockResolvedValue({ total: 0 })
    mocks.ocr.mockResolvedValue('A readable scanned explanation of truth tables and propositional logic.')
    mocks.screenshot.mockImplementation(async ({ partial }) => ({ pages: [{ pageNumber: partial[0], data: new Uint8Array([1]) }] }))
    mocks.load.mockResolvedValue([
      {
        pageContent:
          'A readable explanation of propositions, truth tables, and logical equivalence.',
        metadata: { loc: { pageNumber: 1 } },
      },
    ])
  })
  function args() {
    const transactional = { execute: vi.fn() }
    const outside = { execute: vi.fn() }
    const req = {
      transactionID: 'parent',
      file: { data: new Uint8Array([1, 2, 3]) },
      payload: {
        db: { drizzle: outside, sessions: { parent: { db: transactional } }, deleteMany: vi.fn() },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        create: vi.fn(async () => ({ id: 9 })),
        findByID: vi.fn(),
      },
    }
    return {
      args: {
        doc: { id: 2, name: 'Logic', filename: 'Logic.pdf', mimeType: 'application/pdf' },
        req,
        operation: 'update',
        context: { failOnIngestionError: true },
      } as any,
      transactional,
      outside,
      req,
    }
  }
  it('keeps chunk/page writes and vector SQL in the parent transaction', async () => {
    const test = args()
    await processDocument(test.args)
    expect(test.outside.execute).not.toHaveBeenCalled()
    expect(test.transactional.execute).toHaveBeenCalled()
    expect(test.req.payload.create).toHaveBeenCalledTimes(2)
    for (const call of test.req.payload.create.mock.calls as any[])
      expect(call[0].req).toBe(test.req)
  })
  it('propagates explicit retry failures rather than reporting success', async () => {
    mocks.load.mockRejectedValueOnce(new Error('PDF could not be parsed'))
    const test = args()
    await expect(processDocument(test.args)).rejects.toThrow('PDF could not be parsed')
    expect(test.req.payload.create).not.toHaveBeenCalled()
  })
  it('rejects an empty text index instead of marking it ready', async () => {
    mocks.load.mockResolvedValueOnce([])
    await expect(processDocument(args().args)).rejects.toThrow('No readable text chunks')
    expect(mocks.embed).not.toHaveBeenCalled()
  })
  it('runs local OCR when the text loader returns zero pages', async () => {
    mocks.load.mockResolvedValueOnce([])
    mocks.info.mockResolvedValueOnce({ total: 2 })
    const test = args()
    await processDocument(test.args)
    expect(mocks.ocr).toHaveBeenCalledTimes(2)
    expect(mocks.ocr).toHaveBeenCalledWith(expect.any(Uint8Array), { preferLocal: true })
    expect(mocks.screenshot.mock.calls.map(([options]) => options.partial)).toEqual([[1], [2]])
    expect(mocks.embed).toHaveBeenCalledTimes(2)
  })
  it('includes scanned pages omitted between text pages without OCRing readable text', async () => {
    mocks.info.mockResolvedValueOnce({ total: 2 })
    await processDocument(args().args)
    expect(mocks.ocr).toHaveBeenCalledTimes(1)
    expect(mocks.screenshot).toHaveBeenCalledWith(expect.objectContaining({ partial: [2], scale: 2 }))
    expect(mocks.embed).toHaveBeenCalledTimes(2)
  })
})
