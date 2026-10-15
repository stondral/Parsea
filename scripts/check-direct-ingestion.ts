import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { sql } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { uploadToR2, r2Client, R2_BUCKET } from '../src/lib/r2'
import { GetBucketCorsCommand } from '@aws-sdk/client-s3'
import { queueUploadJob, processUploadJob } from '../src/lib/uploadJobs'
import { buildDownloadFilename } from '../src/lib/documentClassification'

// Explicit smoke replacement: preserves the supplied existing document's ID.
const id = Number(process.argv[2])
const file = process.argv[3]
if (!Number.isInteger(id) || id < 1 || !file)
  throw new Error('Pass a document ID and local PDF path.')
const payload = await getPayload({ config })
try {
  const admins = await payload.find({
    collection: 'users',
    where: { role: { equals: 'admin' } },
    limit: 1,
  })
  if (!admins.docs[0]) throw new Error('An existing Admin account is required.')
  const doc = await payload.findByID({ collection: 'documents', id, depth: 2 })
  const subject = typeof doc.subject === 'object' ? doc.subject : undefined
  const module = doc.module && typeof doc.module === 'object' ? doc.module : undefined
  const topic = doc.topic && typeof doc.topic === 'object' ? doc.topic : undefined
  if (!subject) throw new Error('Subject missing.')
  const bytes = await readFile(file)
  const filename = buildDownloadFilename({
    subjectName: subject.name,
    moduleName: module?.name,
    moduleNumber: module?.number,
    topicName: topic?.name,
    topicNumber: topic?.number,
    title: doc.name,
    originalFilename: doc.filename || 'Notes.pdf',
  })
  const jobId = randomUUID(),
    key = `uploads/${jobId}/${filename}`
  const metadata = {
    name: doc.name,
    chapter: doc.chapter || doc.name,
    type: doc.type,
    subject: subject.id,
    module: module?.id,
    topic: topic?.id,
    replaceDocumentId: id,
  }
  await (payload.db as any).drizzle
    .execute(sql`INSERT INTO document_upload_jobs (id, owner_id, storage_key, filename, bytes, metadata)
    VALUES (${jobId}::uuid, ${admins.docs[0].id}, ${key}, ${filename}, ${bytes.length}, ${JSON.stringify(metadata)}::jsonb)`)
  await uploadToR2({ key, buffer: bytes, contentType: 'application/pdf' })
  await queueUploadJob(payload, jobId)
  const result = await processUploadJob(payload, jobId)
  const retry = await processUploadJob(payload, jobId)
  console.log(
    JSON.stringify({
      job: result.id,
      status: result.status,
      documentId: result.document_id,
      filename: result.filename,
      duplicateRetryDocumentId: retry.document_id,
      error: result.error,
    }),
  )
  try {
    const cors = await r2Client.send(new GetBucketCorsCommand({ Bucket: R2_BUCKET }))
    console.log(JSON.stringify({ bucketCORS: cors.CORSRules }))
  } catch {
    console.log(
      'Bucket CORS could not be read. Configure GET/HEAD/PUT for the app origins before browser uploads.',
    )
  }
} finally {
  await payload.destroy()
}
process.exit(0)
