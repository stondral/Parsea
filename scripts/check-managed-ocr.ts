import fs from 'node:fs/promises'
import os from 'node:os'
import { createLocalOCRWorker } from '../src/lib/ocr'

const before = new Set(
  (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith('parsea-ocr-job-')),
)
const worker = await createLocalOCRWorker()
try {
  const result = await worker.recognize(await fs.readFile('tmp/pdfs/native-corrected-3.png'))
  if (!result.data.text.toLowerCase().includes('equivalence'))
    throw new Error('OCR fixture was not recognized.')
} finally {
  await worker.terminate()
}
const remaining = (await fs.readdir(os.tmpdir())).filter(
  (name) => name.startsWith('parsea-ocr-job-') && !before.has(name),
)
if (remaining.length)
  throw new Error(`Managed OCR left temporary directories: ${remaining.join(', ')}`)
console.log(
  'Real OCR recognized fixture text, terminated its worker and removed its temporary directory.',
)
