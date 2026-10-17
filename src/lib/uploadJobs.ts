import type { Payload } from 'payload'
import { sql } from 'drizzle-orm'
import { getPresignedDownloadUrl, getR2ObjectSize } from './r2'
import { createHash, randomUUID } from 'node:crypto'
import { IngestionPending, DuplicateDocument } from './ingestionControl'

export interface UploadMetadata {
  name: string
  chapter: string
  type: 'Notes' | 'PYQs' | 'Assignments'
  subject: number
  module?: number
  topic?: number
  replaceDocumentId?: number
}
export interface UploadJob {
  id: string
  filename: string
  bytes: number
  storage_key: string
  metadata: UploadMetadata
  status: string
  progress: number
  stage: string
  error: string | null
  document_id: number | null
  owner_id: number
  content_hash?: string | null
  lease_token?: string | null
}

export async function readUploadJob(payload: Payload, id: string): Promise<UploadJob> {
  const result = await (payload.db as any).drizzle.execute(
    sql`SELECT * FROM document_upload_jobs WHERE id = ${id}::uuid`,
  )
  if (!result.rows[0]) throw new Error('Upload not found.')
  return result.rows[0]
}

export async function queueUploadJob(payload: Payload, id: string) {
  const job = await readUploadJob(payload, id)
  if (job.status !== 'uploading') return job
  const bytes = await getR2ObjectSize(job.storage_key)
  if (bytes !== job.bytes) throw new Error('The PDF upload is incomplete. Please upload it again.')
  await (payload.db as any).drizzle
    .execute(sql`UPDATE document_upload_jobs SET status = 'queued', progress = 10,
    stage = 'Uploaded · waiting to index', updated_at = now() WHERE id = ${id}::uuid AND status = 'uploading'`)
  return readUploadJob(payload, id)
}

/** Durable claim + atomic publication. Used by authenticated tRPC and the worker. */
export async function processUploadJob(payload: Payload, id: string) {
  const db = (payload.db as any).drizzle
  const lease = randomUUID()
  const claimed =
    await db.execute(sql`UPDATE document_upload_jobs SET status = 'running', progress = GREATEST(progress, 10), stage = 'Reading the PDF',
    error = NULL, lease_token = ${lease}::uuid, updated_at = now() WHERE id = ${id}::uuid AND (status IN ('queued', 'failed')
    OR (status = 'running' AND updated_at < now() - interval '15 minutes')) RETURNING *`)
  const job: UploadJob | undefined = claimed.rows[0]
  if (!job) return readUploadJob(payload, id)
  try {
    const response = await fetch(await getPresignedDownloadUrl(job.storage_key), {
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error('The uploaded cloud PDF could not be read.')
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length !== job.bytes || !buffer.subarray(0, 1024).includes(Buffer.from('%PDF-')))
      throw new Error('The uploaded file is not a complete PDF.')
    const hash = createHash('sha256').update(buffer).digest('hex')
    if (job.content_hash && hash !== job.content_hash)
      throw new Error('The PDF content changed during upload. Choose the file again.')
    const scope = JSON.stringify([
      job.owner_id,
      job.metadata.subject,
      job.metadata.module || null,
      job.metadata.topic || null,
      job.metadata.type,
      hash,
    ])
    const dedup = createHash('sha256').update(scope).digest('hex')
    await db.execute(
      sql`UPDATE document_upload_jobs SET content_hash = ${hash}, dedup_key = ${dedup} WHERE id = ${id}::uuid AND lease_token = ${lease}::uuid`,
    )
    const { replaceDocumentId, ...metadata } = job.metadata
    if (replaceDocumentId && job.owner_id) {
      const owner = await payload.findByID({ collection: 'users', id: job.owner_id, depth: 0 })
      if (owner.role !== 'admin')
        throw new Error('Admin access is required to process this replacement.')
    }
    const data = {
      ...metadata,
      module: metadata.module ?? null,
      topic: metadata.topic ?? null,
      filename: job.filename,
      mimeType: 'application/pdf',
      filesize: job.bytes,
    }
    const context = {
      documentSource: buffer,
      uploadJobId: job.id,
      uploadLeaseToken: lease,
      forceDocumentIngestion: true,
    }
    // Parent transaction commits both the document/index and job's ready state.
    // A retry after a lost HTTP response cannot create a duplicate document.
    if (replaceDocumentId)
      await payload.update({ collection: 'documents', id: replaceDocumentId, data, context })
    else await payload.create({ collection: 'documents', data, context })
  } catch (error) {
    if (error instanceof IngestionPending) {
      await db.execute(sql`UPDATE document_upload_jobs SET status = 'queued', stage = 'Pages saved · continuing indexing', updated_at = now()
        WHERE id = ${id}::uuid AND lease_token = ${lease}::uuid AND status = 'running'`)
      return readUploadJob(payload, id)
    }
    if (error instanceof DuplicateDocument) {
      await db.execute(sql`UPDATE document_upload_jobs SET status = 'ready', document_id = ${error.documentId}, progress = 100,
        stage = 'Already indexed · existing PDF reused', updated_at = now() WHERE id = ${id}::uuid AND lease_token = ${lease}::uuid`)
      return readUploadJob(payload, id)
    }
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Indexing failed.'
    payload.logger.error(
      { err: error, uploadJobId: id },
      'PDF indexing attempt failed; checkpoints retained',
    )
    await db.execute(sql`UPDATE document_upload_jobs SET status = 'failed', error = ${message}, stage = 'Needs attention',
      updated_at = now() WHERE id = ${id}::uuid AND status = 'running' AND lease_token = ${lease}::uuid`)
  }
  return readUploadJob(payload, id)
}
