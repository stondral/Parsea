import type { Worker } from 'tesseract.js'
import type { PageOrientation, PageRotation } from './pageOrientation'
type OCRImage = Parameters<Worker['recognize']>[0]

export class LowConfidenceOCRError extends Error {}
export interface OCRRecognition extends PageOrientation {
  text: string
}

/** Shared OCR recognition/quality/timeout contract for server PDFs and browser crops. */
export async function recognizeOCR(
  worker: Worker,
  image: OCRImage,
  rotate?: (degrees: number) => Promise<OCRImage>,
): Promise<OCRRecognition> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let expired = false
  try {
    const result = await Promise.race([
      (async () => {
        const original = await worker.recognize(image)
        let best = original
        let rotation: PageRotation = 0
        if (rotate) {
          for (const degrees of [90, 270, 180]) {
            if (expired) throw new Error('OCR operation cancelled after timeout.')
            const rotated = await rotate(degrees)
            if (expired) throw new Error('OCR operation cancelled after timeout.')
            const candidate = await worker.recognize(rotated)
            if (candidate.data.confidence > (best.data.confidence ?? 0)) {
              best = candidate
              rotation = degrees as PageRotation
            }
          }
        }
        const confidence = best.data.confidence ?? 0
        const verified =
          confidence >= 65 &&
          (best.data.text.match(/\p{L}/gu) || []).length >= 15 &&
          (rotation === 0 || confidence - (original.data.confidence ?? 0) >= 10)
        // Ambiguous orientation must not silently rotate a page or choose noise.
        if (rotation && !verified) {
          best = original
          rotation = 0
        }
        if (best.data.text.trim().length > 20 && (best.data.confidence ?? 100) < 40)
          throw new LowConfidenceOCRError(
            'OCR could not read this scan reliably. Upload a clearer or correctly rotated PDF.',
          )
        return {
          text: best.data.text.trim(),
          rotation,
          confidence: best.data.confidence ?? 0,
          verified,
        }
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          expired = true
          reject(
            new Error('OCR timed out after 45 seconds. Resume indexing; saved pages are retained.'),
          )
        }, 45_000)
      }),
    ])
    return result
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
