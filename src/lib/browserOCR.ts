import type { SelectionPoint } from './pdf-selection'
import { isClosedLasso } from './pdf-selection'
import { recognizeOCR } from './ocrRecognition'

function blob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('This selection could not be read.'))),
      'image/png',
    ),
  )
}

/** Local-only crop adapter. PDF bytes/images are never uploaded for region OCR. */
export async function ocrPDFRegion(
  source: HTMLCanvasElement,
  size: { width: number; height: number },
  points: SelectionPoint[],
) {
  if (!size.width || !size.height || points.length < 2) throw new Error('Draw a region first.')
  const sx = source.width / size.width,
    sy = source.height / size.height
  const left = Math.max(0, Math.min(...points.map((p) => p.x))),
    top = Math.max(0, Math.min(...points.map((p) => p.y)))
  const right = Math.min(size.width, Math.max(...points.map((p) => p.x))),
    bottom = Math.min(size.height, Math.max(...points.map((p) => p.y)))
  const crop = document.createElement('canvas')
  crop.width = Math.ceil((right - left) * sx)
  crop.height = Math.ceil((bottom - top) * sy)
  if (crop.width < 8 || crop.height < 8 || crop.width * crop.height > 8_000_000)
    throw new Error('Choose a readable region smaller than the full page.')
  const context = crop.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable in this browser.')
  context.fillStyle = 'white'
  context.fillRect(0, 0, crop.width, crop.height)
  context.save()
  if (isClosedLasso(points)) {
    context.beginPath()
    points.forEach((p, i) =>
      i
        ? context.lineTo((p.x - left) * sx, (p.y - top) * sy)
        : context.moveTo((p.x - left) * sx, (p.y - top) * sy),
    )
    context.closePath()
    context.clip()
  }
  context.drawImage(
    source,
    left * sx,
    top * sy,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  )
  context.restore()
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng')
  try {
    return await recognizeOCR(worker, await blob(crop), async (degrees) => {
      const rotated = document.createElement('canvas')
      rotated.width = degrees === 180 ? crop.width : crop.height
      rotated.height = degrees === 180 ? crop.height : crop.width
      const ctx = rotated.getContext('2d')!
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, rotated.width, rotated.height)
      ctx.translate(rotated.width / 2, rotated.height / 2)
      ctx.rotate((degrees * Math.PI) / 180)
      ctx.drawImage(crop, -crop.width / 2, -crop.height / 2)
      return blob(rotated)
    })
  } finally {
    await worker.terminate()
  }
}
