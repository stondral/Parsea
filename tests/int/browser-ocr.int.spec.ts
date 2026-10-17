import { afterEach, describe, expect, it, vi } from 'vitest'
import { ocrPDFRegion } from '@/lib/browserOCR'
const m = vi.hoisted(() => ({ worker: vi.fn(), recognize: vi.fn(), terminate: vi.fn() }))
vi.mock('tesseract.js', () => ({ createWorker: m.worker }))
describe('OCR crop coordinates in a rotated high-DPI reader', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })
  it('crops the currently rendered canvas in device pixels and terminates its local worker', async () => {
    const drawImage = vi.fn()
    const context = {
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      drawImage,
      translate: vi.fn(),
      rotate: vi.fn(),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as any)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
      callback(new Blob(['fixture']))
    })
    const source = document.createElement('canvas')
    source.width = 1600
    source.height = 1200 // 800x600 CSS page after a quarter turn, at 2x DPI.
    m.worker.mockResolvedValue({ recognize: m.recognize, terminate: m.terminate })
    m.recognize.mockResolvedValue({
      data: { text: 'Equivalence relations are reflexive and symmetric.', confidence: 95 },
    })
    const text = await ocrPDFRegion(source, { width: 800, height: 600 }, [
      { x: 100, y: 50 },
      { x: 300, y: 150 },
    ])
    expect(drawImage).toHaveBeenCalledWith(source, 200, 100, 400, 200, 0, 0, 400, 200)
    expect(text).toContain('Equivalence relations')
    expect(m.terminate).toHaveBeenCalledTimes(1)
  })
  it('rejects oversized regions before starting OCR', async () => {
    const source = document.createElement('canvas')
    source.width = 4000
    source.height = 4000
    await expect(
      ocrPDFRegion(source, { width: 1000, height: 1000 }, [
        { x: 0, y: 0 },
        { x: 1000, y: 1000 },
      ]),
    ).rejects.toThrow('smaller than the full page')
    expect(m.worker).not.toHaveBeenCalled()
  })
})
