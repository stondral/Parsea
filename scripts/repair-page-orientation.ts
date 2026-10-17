import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { sql } from 'drizzle-orm'
import { queueDocumentReindex } from '../src/lib/reindexJob'
import { processUploadJob } from '../src/lib/uploadJobs'
import { PAGE_ORIENTATION_VERSION } from '../src/lib/pageOrientation'

if (!process.argv.includes('--apply')) throw new Error('Use --apply with document IDs or --all.')
const ids = process.argv
  .slice(2)
  .filter((arg) => /^\d+$/.test(arg))
  .map(Number)
if (!ids.length && !process.argv.includes('--all'))
  throw new Error('Select document IDs or --all explicitly.')
const payload = await getPayload({ config })
const summary: Array<{ id: number; status: string; error?: string }> = []
try {
  const owner = (
    await payload.find({
      collection: 'users',
      limit: 1,
      depth: 0,
      where: { and: [{ email: { equals: 'teamone@parsea.com' } }, { role: { equals: 'admin' } }] },
    })
  ).docs[0]
  if (!owner) throw new Error('Approved administrator unavailable; no roles were changed.')
  const docs = await payload.find({
    collection: 'documents',
    depth: 0,
    limit: 1000,
    ...(ids.length ? { where: { id: { in: ids } } } : {}),
  })
  if (docs.totalDocs > 1000) throw new Error('Explicit 1000-document maintenance bound exceeded.')
  // Repair the reported seven-page Equivalence Relations PDF first.
  docs.docs.sort((a, b) => (a.id === 12 ? -1 : b.id === 12 ? 1 : a.id - b.id))
  for (const doc of docs.docs) {
    try {
      const current = await (payload.db as any).drizzle.execute(sql`SELECT id FROM document_pages
        WHERE document_id = ${doc.id} AND orientation_version = ${PAGE_ORIENTATION_VERSION} LIMIT 1`)
      if (current.rows[0]) {
        summary.push({ id: doc.id, status: 'already current' })
        continue
      }
      let job = await queueDocumentReindex(payload, doc.id, owner)
      if (job.status === 'failed' || job.status === 'running')
        job = await processUploadJob(payload, job.id)
      for (let step = 0; job.status === 'queued' && step < 200; step++)
        job = await processUploadJob(payload, job.id)
      if (job.status !== 'ready')
        throw new Error(job.error || `Job ${job.id} remains ${job.status}.`)
      summary.push({ id: doc.id, status: job.stage })
      console.log(JSON.stringify({ documentId: doc.id, status: job.status, stage: job.stage }))
    } catch (error) {
      summary.push({
        id: doc.id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  console.log(JSON.stringify({ summary }))
} finally {
  await payload.destroy()
}
process.exit(summary.some((row) => row.status === 'failed') ? 1 : 0)
