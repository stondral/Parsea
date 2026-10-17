import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

// Build an isolated node_modules from traced physical files only. No repository
// modules or symlinks may hide a missing worker dependency in this smoke test.
const traceFile = path.resolve('.next/server/app/api/trpc/[trpc]/route.js.nft.json')
const trace = JSON.parse(await fs.readFile(traceFile, 'utf8'))
const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'parsea-traced-ocr-'))
for (const item of trace.files as string[]) {
  const full = path.resolve(path.dirname(traceFile), item)
  const normalized = full.replace(/\\/g, '/')
  const marker = '/node_modules/'
  const relative = normalized.slice(normalized.lastIndexOf(marker) + marker.length)
  if (
    !/^(tesseract\.js(?:-core)?|wasm-feature-detect|bmp-js|is-url|regenerator-runtime|node-fetch|whatwg-url|tr46|webidl-conversions)\//.test(
      relative,
    )
  )
    continue
  if (!(await fs.lstat(full)).isFile()) continue
  const target = path.join(sandbox, 'node_modules', relative)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(full, target)
}
const requireIsolated = createRequire(path.join(sandbox, 'smoke.cjs'))
const { createWorker } = requireIsolated('tesseract.js') as typeof import('tesseract.js')
const worker = await createWorker('eng', undefined, {
  cachePath: process.cwd(),
  errorHandler: () => {},
})
try {
  const result = await worker.recognize(await fs.readFile('tmp/pdfs/native-corrected-3.png'))
  if (!result.data.text.toLowerCase().includes('equivalence'))
    throw new Error(`OCR did not recognize fixture text: ${result.data.text}`)
  console.log('Isolated traced OCR worker recognized fixture text successfully.')
  console.log(`Smoke-test files: ${sandbox}`)
} finally {
  await worker.terminate()
}
