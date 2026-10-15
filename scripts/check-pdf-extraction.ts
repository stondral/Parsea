import fs from 'node:fs/promises'
import { extractPDF } from '../src/lib/pdf-extraction'

const filename = process.argv[2]
if (!filename) throw new Error('Pass a PDF path.')
const start = Date.now()
const pages = await extractPDF(await fs.readFile(filename), { onProgress: console.log })
console.log(
  JSON.stringify({
    physicalPages: pages.length,
    readable: pages.filter((p) => p.text.length > 20).length,
    ocr: pages.filter((p) => p.ocr).length,
    screenshots: pages.filter((p) => p.screenshot).length,
    milliseconds: Date.now() - start,
  }),
)
if (process.argv.includes('--preview') && pages[0]?.screenshot) {
  await fs.mkdir('tmp/pdfs', { recursive: true })
  await fs.writeFile('tmp/pdfs/ingestion-preview.png', pages[0].screenshot)
  console.log(pages[0].text.slice(0, 600))
}
