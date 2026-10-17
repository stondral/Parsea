import fs from 'node:fs/promises'
import path from 'node:path'
const routes = [
  'api/chat',
  'api/chat/stream',
  'api/trpc/[trpc]',
  'api/notes/upload',
  'api/ingestion/run',
]
for (const route of routes) {
  const filename = path.resolve('.next/server/app', route, 'route.js.nft.json')
  const trace = JSON.parse(await fs.readFile(filename, 'utf8'))
  const files: Array<{ name: string; bytes: number }> = []
  for (const file of trace.files) {
    try {
      const full = path.resolve(path.dirname(filename), file)
      files.push({ name: full, bytes: (await fs.stat(full)).size })
    } catch {
      /* Linux-only assets may not exist on a Windows workstation. */
    }
  }
  console.log(
    JSON.stringify({
      route,
      tracedMB: Math.round(files.reduce((n, f) => n + f.bytes, 0) / 1024 / 1024),
      linuxONNX: files.some((f) => /onnxruntime-node.*linux.*x64.*binding/.test(f.name)),
      ocrWorker: files.some((f) => /tesseract.js.*worker-script.*node.*index.js/.test(f.name)),
      ocrWasm: files.some((f) => /tesseract.js-core.*\.wasm$/.test(f.name)),
      canvas: files.some((f) => /@napi-rs.*canvas/.test(f.name)),
      linuxCanvasBinding: files.some((f) => /canvas-linux-x64-gnu.*\.node$/.test(f.name)),
      pdfOrientationWorker: files.some((f) => /pdfjs-dist.*legacy.*pdf\.worker\.mjs$/.test(f.name)),
      largest: files
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 5)
        .map((f) => ({ name: path.basename(f.name), mb: Math.round(f.bytes / 1024 / 1024) })),
    }),
  )
}
