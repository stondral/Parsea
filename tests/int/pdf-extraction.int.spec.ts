import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractPDF } from '@/lib/pdf-extraction'
import { LowConfidenceOCRError } from '@/lib/ocrRecognition'
const m = vi.hoisted(() => ({
  info: vi.fn(),
  text: vi.fn(),
  shot: vi.fn(),
  destroy: vi.fn(),
  worker: vi.fn(),
  terminate: vi.fn(),
  ocr: vi.fn(),
  hints: vi.fn(),
  rotate: vi.fn(),
}))
vi.mock('@/lib/pdfParser', () => ({
  pdfStandardFontPath: () => '/test-fonts/',
  loadPDFParser: async () => ({
    PDFParse: class {
      getInfo = m.info
      getText = m.text
      getScreenshot = m.shot
      destroy = m.destroy
    },
  }),
}))
vi.mock('@/lib/ocr', () => ({ createLocalOCRWorker: m.worker, recognizeImage: m.ocr }))
vi.mock('@/lib/pdfOrientationHints', () => ({ createPDFOrientationHints: m.hints }))
vi.mock('sharp', () => ({ default: () => ({ rotate: m.rotate }) }))
describe('Physical page extraction and OCR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.info.mockResolvedValue({ total: 3 })
    m.text.mockResolvedValue({
      pages: [{ num: 2, text: 'This middle page has readable text about Boolean algebra.' }],
    })
    m.shot.mockImplementation(async ({ partial }) => ({
      pages: [{ pageNumber: partial[0], data: new Uint8Array([1]) }],
    }))
    m.worker.mockResolvedValue({ terminate: m.terminate })
    m.ocr.mockResolvedValue({
      text: 'Readable scanned notes on logic, propositions and truth tables.',
      rotation: 0,
      confidence: 95,
      verified: true,
    })
    m.hints.mockResolvedValue({
      page: async () => ({ rotation: 0, confidence: 100, verified: true }),
      destroy: vi.fn(),
    })
    m.rotate.mockReturnValue({ png: () => ({ toBuffer: async () => Buffer.from([2]) }) })
  })
  it('OCRs omitted pages, reuses a worker, and preserves citation page numbers', async () => {
    const pages = await extractPDF(Buffer.from('%PDF-test'))
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3])
    expect(pages.map((p) => p.ocr)).toEqual([true, false, true])
    expect(m.worker).toHaveBeenCalledTimes(1)
    expect(m.terminate).toHaveBeenCalledTimes(1)
    expect(m.destroy).toHaveBeenCalledTimes(1)
    expect(m.text).toHaveBeenCalledWith({ pageJoiner: '' })
  })
  it('rejects non-PDF data', async () => {
    await expect(extractPDF(Buffer.from('not a PDF'))).rejects.toThrow('valid PDF header')
    expect(m.info).not.toHaveBeenCalled()
  })
  it('reuses saved physical pages without OCR or screenshot regeneration', async () => {
    const pages = await extractPDF(Buffer.from('%PDF-test'), {
      cachedPage: (pageNumber) => ({
        pageNumber,
        text: 'Saved page with readable academic text.',
        ocr: true,
        previewKey: `page-${pageNumber}`,
        orientationVersion: 1,
      }),
    })
    expect(pages.length).toBe(3)
    expect(m.shot).not.toHaveBeenCalled()
    expect(m.ocr).not.toHaveBeenCalled()
  })
  it('yields after a bounded page batch while keeping completed checkpoints', async () => {
    const saved = vi.fn(async () => {})
    await expect(
      extractPDF(Buffer.from('%PDF-test'), { maxFreshPages: 1, onPage: saved }),
    ).rejects.toMatchObject({ name: 'IngestionPending' })
    expect(saved).toHaveBeenCalledTimes(1)
    expect(m.terminate).toHaveBeenCalled()
  })
  it('rotates native text previews using geometry without OCR and versions the result', async () => {
    m.info.mockResolvedValue({ total: 1 })
    m.text.mockResolvedValue({
      pages: [
        { num: 1, text: 'A native PDF text paragraph with sufficient academic information.' },
      ],
    })
    m.hints.mockResolvedValue({
      page: async () => ({ rotation: 270, confidence: 100, verified: true }),
      destroy: vi.fn(),
    })
    const pages = await extractPDF(Buffer.from('%PDF-test'))
    expect(m.ocr).not.toHaveBeenCalled()
    expect(m.rotate).toHaveBeenCalledWith(270)
    expect(pages[0]).toMatchObject({
      orientationVersion: 1,
      orientation: { rotation: 270, verified: true },
    })
    expect(pages[0].screenshot).toEqual(Buffer.from([2]))
  })
  it('regenerates old unversioned checkpoints rather than reusing sideways previews', async () => {
    m.info.mockResolvedValue({ total: 1 })
    m.text.mockResolvedValue({ pages: [] })
    const pages = await extractPDF(Buffer.from('%PDF-test'), {
      cachedPage: () => ({
        pageNumber: 1,
        text: 'Old saved page',
        ocr: true,
        previewKey: 'sideways',
        orientationVersion: 0,
      }),
    })
    expect(m.ocr).toHaveBeenCalledTimes(1)
    expect(pages[0].orientationVersion).toBe(1)
    expect(pages[0].previewKey).toBeUndefined()
  })
  it('rejects blank scans, disposing all resources', async () => {
    m.text.mockResolvedValue({ pages: [] })
    m.ocr.mockResolvedValue({ text: '', rotation: 0, confidence: 0, verified: false })
    await expect(extractPDF(Buffer.from('%PDF-test'))).rejects.toThrow('No readable text')
    expect(m.destroy).toHaveBeenCalled()
    expect(m.terminate).toHaveBeenCalled()
  })
  it('keeps a diagram-only page without indexing low-confidence OCR noise', async () => {
    m.ocr.mockRejectedValueOnce(new LowConfidenceOCRError('Unreadable diagram labels'))
    const pages = await extractPDF(Buffer.from('%PDF-test'))
    expect(pages[0].text).toBe('')
    expect(pages[0].screenshot).toBeDefined()
    expect(pages[1].pageNumber).toBe(2)
    expect(pages[1].text).toContain('Boolean algebra')
  })
  it('explains password errors', async () => {
    m.info.mockRejectedValueOnce(new Error('Password required'))
    await expect(extractPDF(Buffer.from('%PDF-test'))).rejects.toThrow('Password-protected')
    expect(m.destroy).toHaveBeenCalled()
  })
  it('preserves the original parser error when cleanup also fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    m.info.mockRejectedValueOnce(new Error('Primary parsing failure'))
    m.destroy.mockRejectedValueOnce(new Error('Secondary cleanup failure'))
    await expect(extractPDF(Buffer.from('%PDF-test'))).rejects.toThrow('Primary parsing failure')
    expect(warning).toHaveBeenCalled()
    warning.mockRestore()
  })
  it('rejects oversized page counts before rendering', async () => {
    m.info.mockResolvedValueOnce({ total: 151 })
    await expect(extractPDF(Buffer.from('%PDF-test'))).rejects.toThrow('page limit')
    expect(m.shot).not.toHaveBeenCalled()
  })
})
