import { dirname, join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { ensurePDFRuntime } from './pdfRuntime'

// Turbopack rewrites statically imported createRequire().resolve() into numeric
// module IDs. Obtain Node's resolver at runtime so filesystem paths stay strings.
const nodeRequire = process.getBuiltinModule('module').createRequire(join(process.cwd(), 'package.json'))

function packageFile(name: string): string {
  try {
    return nodeRequire.resolve(`${name}/package.json`)
  } catch {
    // Function traces retain physical store files, but may omit root aliases.
    const store = join(process.cwd(), 'node_modules', '.pnpm')
    const candidates = readdirSync(store)
      .filter((entry) => entry.startsWith(`${name}@`))
      .map((entry) => join(store, entry, 'node_modules', name, 'package.json'))
      .filter((file) => existsSync(file))
    if (candidates.length !== 1) throw new Error(`Cannot uniquely resolve deployed PDF dependency: ${name}`)
    return candidates[0]
  }
}

export function pdfStandardFontPath(): string {
  const packagePath = packageFile('pdfjs-dist')
  if (typeof packagePath !== 'string') throw new Error('PDF runtime resolver did not return a filesystem path.')
  return join(dirname(packagePath), 'standard_fonts').replace(/\\/g, '/') + '/'
}

/** Keep parser evaluation after canvas initialization, outside generated ESM wrappers. */
export async function loadPDFParser(): Promise<typeof import('pdf-parse')> {
  await ensurePDFRuntime()
  return nodeRequire(join(dirname(packageFile('pdf-parse')), 'dist/pdf-parse/cjs/index.cjs')) as typeof import('pdf-parse')
}
