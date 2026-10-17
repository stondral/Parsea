import fs from 'node:fs/promises'
import { loadPDFParser } from '../src/lib/pdfParser'
import { createLocalOCRWorker } from '../src/lib/ocr'
import sharp from 'sharp'

const filename = process.argv[2]
const pageNumber = Number(process.argv[3])
if (!filename || !Number.isInteger(pageNumber) || pageNumber < 1)
  throw new Error('Pass a PDF path and a physical page number.')
const { PDFParse } = await loadPDFParser()
const parser = new PDFParse({
  data: new Uint8Array(await fs.readFile(filename)),
  isEvalSupported: false,
})
const worker = await createLocalOCRWorker()
try {
  const shot = await parser.getScreenshot({
    partial: [pageNumber],
    scale: 2,
    imageBuffer: true,
    imageDataUrl: false,
  })
  const source = shot.pages[0]?.data
  if (!source) throw new Error('Page did not render.')
  await fs.mkdir('tmp/pdfs', { recursive: true })
  await fs.writeFile('tmp/pdfs/page-diagnostic.png', source)
  for (const rotation of [0, 90, 270, 180]) {
    const image = await sharp(source).rotate(rotation).png().toBuffer()
    const result = await worker.recognize(image)
    console.log(
      JSON.stringify({
        rotation,
        confidence: result.data.confidence,
        text: result.data.text.slice(0, 1200),
      }),
    )
  }
} finally {
  await worker.terminate()
  await parser.destroy()
}
