import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { sql } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { getPresignedDownloadUrl, uploadToR2 } from '../src/lib/r2'
import { buildDownloadFilename } from '../src/lib/documentClassification'
import { processUploadJob } from '../src/lib/uploadJobs'
import { EMBEDDING_MODEL } from '../src/lib/embeddings'

if (!process.argv.includes('--apply'))
  throw new Error(
    'Use --apply to rebuild incompatible library indexes while preserving document IDs.',
  )
const payload = await getPayload({ config })
const summary: Array<{ id: number; status: string; error?: string }> = []
try {
  const users = await payload.find({
    collection: 'users',
    depth: 0,
    limit: 1,
    where: { and: [{ email: { equals: 'teamone@parsea.com' } }, { role: { equals: 'admin' } }] },
  })
  const owner = users.docs[0]
  if (!owner)
    throw new Error('The approved administrator account is unavailable. No roles were changed.')
  const docs = await payload.find({ collection: 'documents', limit: 1000, depth: 3, sort: 'id' })
  if (docs.totalDocs > 1000)
    throw new Error('Library exceeds this maintenance command’s explicit 1000-document bound.')
  const db = (payload.db as any).drizzle
  for (const doc of docs.docs) {
    try {
      const health = await db.execute(sql`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE embedding_model = ${EMBEDDING_MODEL} AND embedding IS NOT NULL)::int AS compatible FROM chunks WHERE document_id = ${doc.id}`)
      if (
        health.rows[0].total > 0 &&
        health.rows[0].total === health.rows[0].compatible &&
        doc.filename &&
        !/^\d+\.pdf$/i.test(doc.filename)
      ) {
        summary.push({ id: doc.id, status: 'already indexed' })
        continue
      }
      if (!doc.filename || typeof doc.subject !== 'object')
        throw new Error('Original PDF or subject metadata missing.')
      let buffer: Buffer | undefined
      if (doc.storageKey) {
        try {
          const response = await fetch(
            await getPresignedDownloadUrl(doc.storageKey, doc.r2Bucket || undefined),
            { signal: AbortSignal.timeout(30_000) },
          )
          if (response.ok) buffer = Buffer.from(await response.arrayBuffer())
        } catch {
          /* Existing local originals may repair a missing cloud object. */
        }
      }
      if (!buffer) {
        const root = path.resolve('media/documents'),
          source = path.resolve(root, doc.filename)
        if (!source.startsWith(root + path.sep)) throw new Error('Invalid original file path.')
        buffer = await readFile(source)
      }
      if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-')))
        throw new Error('Original does not contain a valid PDF header.')
      const module = doc.module && typeof doc.module === 'object' ? doc.module : undefined
      const topic = doc.topic && typeof doc.topic === 'object' ? doc.topic : undefined
      const stem = doc.filename.replace(/\.pdf$/i, '')
      const part = /^\d+$/.test(stem)
        ? module?.number && stem.startsWith(module.number) && stem.length > module.number.length
          ? stem.slice(module.number.length)
          : stem
        : ''
      const filename = buildDownloadFilename({
        subjectName: doc.subject.name,
        moduleName: module?.name,
        moduleNumber: module?.number,
        topicName: topic?.name,
        topicNumber: topic?.number,
        title: part ? `${doc.name} Part ${part}` : doc.name,
        originalFilename: doc.filename,
      })
      const id = randomUUID(),
        hash = createHash('sha256').update(buffer).digest('hex')
      const key = `uploads/maintenance/${id}/${filename}`
      await uploadToR2({ key, buffer, contentType: 'application/pdf' })
      const metadata = {
        name: doc.name,
        chapter: doc.chapter || doc.name,
        type: doc.type,
        subject: doc.subject.id,
        module: module?.id,
        topic: topic?.id,
        replaceDocumentId: doc.id,
      }
      await db.execute(sql`INSERT INTO document_upload_jobs(id, owner_id, storage_key, filename, bytes, metadata, content_hash, status, stage)
        VALUES (${id}::uuid, ${owner.id}, ${key}, ${filename}, ${buffer.length}, ${JSON.stringify(metadata)}::jsonb, ${hash}, 'queued', 'Maintenance re-index queued')`)
      let result = await processUploadJob(payload, id),
        steps = 1
      while (result.status === 'queued' && steps++ < 200)
        result = await processUploadJob(payload, id)
      if (result.status !== 'ready')
        throw new Error(result.error || `Indexing remains ${result.status}; resume job ${id}.`)
      summary.push({ id: doc.id, status: 'indexed and renamed' })
      console.log(JSON.stringify({ id: doc.id, status: 'indexed and renamed', filename, steps }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Indexing failed.'
      summary.push({ id: doc.id, status: 'failed', error: message })
      console.error(JSON.stringify({ id: doc.id, error: message }))
    }
  }
  console.log(JSON.stringify({ summary }))
} finally {
  await payload.destroy()
}
process.exit(summary.some((item) => item.status === 'failed') ? 1 : 0)
