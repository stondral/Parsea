import type { Payload } from 'payload'
import type { User } from '@/payload-types'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { copyR2Object } from './r2'
import { readUploadJob, type UploadMetadata } from './uploadJobs'
import { relationId } from './adminCatalog'

/** /administrator and maintenance use the same durable replacement pipeline. */
export async function queueDocumentReindex(payload: Payload, documentId: number, user: User) {
  if (user.role !== 'admin') throw new Error('Admin access required.')
  const doc = await payload.findByID({
    collection: 'documents',
    id: documentId,
    depth: 0,
    user,
    overrideAccess: false,
  })
  if (!doc.storageKey || !doc.filename)
    throw new Error('Cloud PDF missing. Use Replace PDF to restore the original.')
  const db = (payload.db as any).drizzle
  const existing =
    await db.execute(sql`SELECT id FROM document_upload_jobs WHERE metadata @> ${JSON.stringify({ replaceDocumentId: documentId })}::jsonb
    AND storage_key LIKE 'uploads/reindex/%'
    AND status IN ('queued', 'running', 'failed') ORDER BY created_at DESC LIMIT 1`)
  if (existing.rows[0]) return readUploadJob(payload, existing.rows[0].id)
  const id = randomUUID(),
    key = `uploads/reindex/${id}/${doc.filename}`
  const bytes = await copyR2Object(doc.storageKey, key, doc.r2Bucket || undefined)
  if (!bytes || bytes > 25 * 1024 * 1024)
    throw new Error('PDF must be between 1 byte and 25 MB. Replace it with a smaller PDF.')
  const metadata: UploadMetadata = {
    name: doc.name,
    chapter: doc.chapter || doc.name,
    type: doc.type,
    subject: relationId(doc.subject)!,
    module: relationId(doc.module) || undefined,
    topic: relationId(doc.topic) || undefined,
    replaceDocumentId: documentId,
  }
  await db.execute(sql`INSERT INTO document_upload_jobs (id, owner_id, storage_key, filename, bytes, metadata, status, stage)
    VALUES (${id}::uuid, ${user.id}, ${key}, ${doc.filename}, ${bytes}, ${JSON.stringify(metadata)}::jsonb, 'queued', 'Re-index queued · original preserved')`)
  return readUploadJob(payload, id)
}
