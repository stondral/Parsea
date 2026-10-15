import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { getPresignedDownloadUrl } from '../src/lib/r2'

const payload = await getPayload({ config })
const results: Array<{ id: number; pdfHeader: boolean; status: number }> = []
try {
  const docs = await payload.find({ collection: 'documents', limit: 1000, depth: 0 })
  for (const doc of docs.docs) {
    if (!doc.storageKey) {
      results.push({ id: doc.id, pdfHeader: false, status: 0 })
      continue
    }
    const response = await fetch(
      await getPresignedDownloadUrl(doc.storageKey, doc.r2Bucket || undefined),
      {
        headers: { Range: 'bytes=0-1023' },
        signal: AbortSignal.timeout(30_000),
      },
    )
    const header =
      response.ok && Buffer.from(await response.arrayBuffer()).includes(Buffer.from('%PDF-'))
    results.push({ id: doc.id, pdfHeader: Boolean(header), status: response.status })
  }
  console.log(JSON.stringify({ results }))
} finally {
  await payload.destroy()
}
process.exit(results.every((item) => item.pdfHeader) ? 0 : 1)
