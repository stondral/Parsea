import fs from 'node:fs/promises'
import path from 'node:path'

let checked = 0
async function inspect(directory: string): Promise<void> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) await inspect(filename)
    else if (entry.name.endsWith('.js')) {
      const source = await fs.readFile(filename, 'utf8')
      if (!source.includes('PDF runtime resolver did not return')) continue
      checked++
      if (/\.dirname\)\(\d+\)/.test(source))
        throw new Error(`Numeric module ID passed to dirname in ${filename}`)
      if (!source.includes('getBuiltinModule("module")'))
        throw new Error(`Native runtime resolver missing from ${filename}`)
    }
  }
}
await inspect('.next/server/chunks')
if (!checked) throw new Error('No compiled PDF runtime found. Run the production build first.')
console.log(`Checked ${checked} compiled PDF runtime chunks: native resolver retained; no numeric dirname argument.`)
