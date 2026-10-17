import fs from 'node:fs/promises'
import { extractPDF } from '../src/lib/pdf-extraction'

const pages = await extractPDF(await fs.readFile('tmp/pdfs/native-orientation-fixture.pdf'))
const expected = [0, 90, 180, 270, 270, 0]
for (const page of pages) {
  if (
    page.orientation?.rotation !== expected[page.pageNumber - 1] ||
    !page.orientation.verified ||
    page.ocr
  )
    throw new Error(
      `Unexpected native orientation on page ${page.pageNumber}: ${JSON.stringify(page.orientation)}`,
    )
  if (page.screenshot)
    await fs.writeFile(`tmp/pdfs/native-corrected-${page.pageNumber}.png`, page.screenshot)
}
console.log(JSON.stringify(pages.map((page) => ({ page: page.pageNumber, ...page.orientation }))))
