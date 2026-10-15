import type { Worker } from 'tesseract.js'
type OCRImage = Parameters<Worker['recognize']>[0]

export class LowConfidenceOCRError extends Error {}

/** Shared OCR recognition/quality/timeout contract for server PDFs and browser crops. */
export async function recognizeOCR(
  worker: Worker,
  image: OCRImage,
  rotate?: (degrees: number) => Promise<OCRImage>,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      (async () => {
        let best = await worker.recognize(image)
        if ((best.data.confidence ?? 100) < 65 && rotate) {
          for (const degrees of [90, 270, 180]) {
            const candidate = await worker.recognize(await rotate(degrees))
            if (candidate.data.confidence > best.data.confidence) best = candidate
            if (best.data.confidence >= 75) break
          }
        }
        if (best.data.text.trim().length > 20 && (best.data.confidence ?? 100) < 40)
          throw new LowConfidenceOCRError(
            'OCR could not read this scan reliably. Upload a clearer or correctly rotated PDF.',
          )
        return best.data.text.trim()
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('OCR timed out. Try a smaller or clearer selection.')),
          45_000,
        )
      }),
    ])
    return result
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
