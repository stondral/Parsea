import { recognizeImage, createLocalOCRWorker } from './ocr'
import type { Worker } from 'tesseract.js'
import { IngestionPending } from './ingestionControl'
import { LowConfidenceOCRError } from './ocrRecognition'
import { PAGE_ORIENTATION_VERSION, type PageOrientation } from './pageOrientation'
import { createPDFOrientationHints } from './pdfOrientationHints'
import { loadPDFParser, pdfStandardFontPath } from './pdfParser'

export interface ExtractedPDFPage {
  pageNumber: number
  text: string
  screenshot?: Uint8Array
  ocr: boolean
  previewKey?: string
  orientation?: PageOrientation
  orientationVersion?: number
}

/** Canonical extraction renderer, optional public geometry inspector, real Node canvas. */
export async function extractPDF(
  buffer: Buffer,
  options: {
    onProgress?: (message: string) => void | Promise<void>
    onPage?: (page: ExtractedPDFPage) => Promise<void>
    maxPages?: number
    cachedPage?: (page: number) => ExtractedPDFPage | undefined
    maxFreshPages?: number
    maxOCRPages?: number
  } = {},
): Promise<ExtractedPDFPage[]> {
  if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-')))
    throw new Error('This file does not contain a valid PDF header.')
  if ('random' in Array.prototype)
    Object.defineProperty(Array.prototype, 'random', { enumerable: false })
  const { PDFParse } = await loadPDFParser()
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    standardFontDataUrl: pdfStandardFontPath(),
  })
  let worker: Worker | undefined
  let hints: Awaited<ReturnType<typeof createPDFOrientationHints>> | undefined
  try {
    const info = await parser.getInfo()
    if (!Number.isInteger(info.total) || info.total < 1)
      throw new Error('The PDF contains no pages.')
    if (info.total > (options.maxPages || 150))
      throw new Error(
        'This PDF exceeds the page limit. Split it into smaller module PDFs before uploading.',
      )
    const text = await parser.getText({ pageJoiner: '' })
    const byPage = new Map(text.pages.map((page) => [page.num, page.text.trim()]))
    if (text.pages.some((page) => page.text.trim().length >= 40)) {
      try {
        hints = await createPDFOrientationHints(buffer)
      } catch {
        await options.onProgress?.('Text orientation unavailable; retain original page direction.')
      }
    }
    const pages: ExtractedPDFPage[] = []
    let freshPages = 0,
      ocrPages = 0
    for (let pageNumber = 1; pageNumber <= info.total; pageNumber++) {
      const cached = options.cachedPage?.(pageNumber)
      if (cached && cached.orientationVersion === PAGE_ORIENTATION_VERSION) {
        await options.onPage?.(cached)
        pages.push(cached)
        continue
      }
      await options.onProgress?.(`Reading page ${pageNumber} / ${info.total}`)
      if (freshPages >= (options.maxFreshPages ?? Infinity)) throw new IngestionPending()
      freshPages++
      let pageText = byPage.get(pageNumber) || ''
      let screenshot: Uint8Array | undefined
      let ocr = false
      let orientation: PageOrientation = { rotation: 0, confidence: 0, verified: false }
      if (pageText.length >= 40 && hints) {
        try {
          orientation = await hints.page(pageNumber)
        } catch {
          await options.onProgress?.(
            `Page ${pageNumber}: orientation uncertain; use reader rotation controls if needed.`,
          )
        }
      }
      // Previews cover vector diagrams too, not only embedded images.
      try {
        const shot = await parser.getScreenshot({
          partial: [pageNumber],
          scale: pageText.length < 40 ? 2 : 1,
          imageBuffer: true,
          imageDataUrl: false,
        })
        screenshot = shot.pages.find((page) => page.pageNumber === pageNumber)?.data
      } catch (error) {
        if (pageText.length < 40)
          throw new Error(
            `Page ${pageNumber} needs OCR but could not render: ${error instanceof Error ? error.message : 'rendering failed'}`,
          )
        await options.onProgress?.(`Page ${pageNumber} text extracted; preview unavailable.`)
      }
      if (pageText.length < 40 && screenshot) {
        if (ocrPages >= (options.maxOCRPages ?? Infinity)) throw new IngestionPending()
        ocrPages++
        await options.onProgress?.(`Reading scanned page ${pageNumber} / ${info.total} with OCR`)
        worker ||= await createLocalOCRWorker()
        let recognized = ''
        try {
          const result = await recognizeImage(screenshot, { preferLocal: true, worker })
          recognized = result.text
          orientation = result
        } catch (error) {
          if (!(error instanceof LowConfidenceOCRError)) throw error
          // A diagram-only slide can resemble low-confidence OCR noise. Keep
          // its physical page/preview, never turn that noise into RAG vectors.
          pageText = ''
          ocr = true
          await options.onProgress?.(
            `Page ${pageNumber}: no reliable OCR text; original visual retained.`,
          )
        }
        if (recognized.trim().length > pageText.length) {
          pageText = recognized.trim()
          ocr = true
        }
      }
      // PDFParse already applies PDF /Rotate metadata. This is only the extra
      // content correction, shared with the reader; expand the canvas, never crop.
      if (screenshot && orientation.rotation) {
        const { default: sharp } = await import('sharp')
        screenshot = await sharp(Buffer.from(screenshot))
          .rotate(orientation.rotation)
          .png()
          .toBuffer()
      }
      const page = {
        pageNumber,
        text: pageText,
        screenshot,
        ocr,
        orientation,
        orientationVersion: PAGE_ORIENTATION_VERSION,
      }
      await options.onPage?.(page)
      pages.push(page)
    }
    if (!pages.some((page) => page.text.trim().length > 20))
      throw new Error(
        'No readable text was extracted, including OCR. Upload a clearer scan or a text-based PDF.',
      )
    return pages
  } catch (error) {
    if (error instanceof Error && /password|encrypted/i.test(error.message))
      throw new Error('Password-protected PDFs are not supported. Upload an unlocked copy.')
    throw error
  } finally {
    try {
      if (worker) await worker.terminate()
    } finally {
      try {
        await hints?.destroy()
      } finally {
        await parser.destroy()
      }
    }
  }
}
