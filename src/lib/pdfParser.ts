import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { ensurePDFRuntime } from './pdfRuntime'

const nodeRequire = createRequire(import.meta.url)

export function pdfStandardFontPath(): string {
  return join(dirname(nodeRequire.resolve('pdfjs-dist/package.json')), 'standard_fonts').replace(/\\/g, '/') + '/'
}

/** Keep parser evaluation after canvas initialization, outside generated ESM wrappers. */
export async function loadPDFParser(): Promise<typeof import('pdf-parse')> {
  await ensurePDFRuntime()
  return nodeRequire('pdf-parse') as typeof import('pdf-parse')
}
