import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractTextFromImage } from '@/lib/ocr'

const mocks = vi.hoisted(() => ({ createWorker: vi.fn(), recognize: vi.fn(), terminate: vi.fn() }))
vi.mock('tesseract.js', () => ({ createWorker: mocks.createWorker }))

describe('Canonical Tesseract fallback', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks() })
  function worker() {
    mocks.createWorker.mockResolvedValue({ recognize: mocks.recognize, terminate: mocks.terminate })
    mocks.terminate.mockResolvedValue(undefined)
  }
  it('uses local Tesseract directly for PDF scans, even with a vision API key configured', async () => {
    worker()
    vi.stubEnv('OPENROUTER_API_KEY', 'test-only')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    mocks.recognize.mockResolvedValue({ data: { text: '  Truth tables and logic  ' } })
    expect(await extractTextFromImage(new Uint8Array([1]), { preferLocal: true })).toBe('Truth tables and logic')
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.terminate).toHaveBeenCalledTimes(1)
  })
  it('terminates the worker even when recognition fails', async () => {
    worker()
    mocks.recognize.mockRejectedValue(new Error('Unreadable image'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await extractTextFromImage(new Uint8Array([1]), { preferLocal: true })).toBe('')
    expect(mocks.terminate).toHaveBeenCalledTimes(1)
    log.mockRestore()
  })
})
