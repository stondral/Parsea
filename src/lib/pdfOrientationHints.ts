import { orientationFromText, type PageOrientation } from './pageOrientation'
import { ensurePDFRuntime } from './pdfRuntime'
import { pdfStandardFontPath } from './pdfParser'

/** Public PDF.js text geometry only; PDFParse remains the extraction/render path. */
export async function createPDFOrientationHints(buffer: Buffer) {
  await ensurePDFRuntime()
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, standardFontDataUrl: pdfStandardFontPath() })
  try {
    const document = await task.promise
    return {
      async page(number: number): Promise<PageOrientation> {
        const page = await document.getPage(number)
        try {
          const content = await page.getTextContent()
          return orientationFromText(
            content.items.filter((item) => 'str' in item),
            page.getViewport({ scale: 1 }).transform,
          )
        } finally {
          page.cleanup()
        }
      },
      destroy: () => task.destroy(),
    }
  } catch (error) {
    await task.destroy()
    throw error
  }
}
