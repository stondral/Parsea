import type { CollectionAfterChangeHook } from 'payload'
import { deleteDocumentDependents } from './deleteDocumentDependents'
import { getEmbedding, EMBEDDING_MODEL } from '@/lib/embeddings'
import { extractPDF } from '@/lib/pdf-extraction'
import { uploadToR2, getPresignedDownloadUrl, R2_BUCKET } from '@/lib/r2'
import { buildDocumentStoragePaths } from '@/lib/documentStorage'
import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { DuplicateDocument, IngestionPending } from '@/lib/ingestionControl'
import type { ExtractedPDFPage } from '@/lib/pdf-extraction'
import { PAGE_ORIENTATION_VERSION, normalizeRotation } from '@/lib/pageOrientation'

/** Canonical synchronous indexing. A successful upload means a usable index. */
export const processDocument: CollectionAfterChangeHook = async ({
  doc,
  req,
  operation,
  context,
}) => {
  if (!doc.filename || !doc.filename.toLowerCase().endsWith('.pdf')) return doc
  const transactionID = await req.transactionID
  const db = transactionID
    ? (req.payload.db.sessions?.[String(transactionID)]?.db as any)
    : (req.payload.db as any).drizzle
  if (!db) throw new Error('Document transaction unavailable.')
  const jobId = typeof context?.uploadJobId === 'string' ? context.uploadJobId : undefined
  const lease = typeof context?.uploadLeaseToken === 'string' ? context.uploadLeaseToken : undefined
  const checkpointDB = (req.payload.db as any).drizzle
  const progress = async (percent: number, stage: string) => {
    req.payload.logger.info(stage)
    if (jobId)
      await checkpointDB.execute(sql`UPDATE document_upload_jobs
      SET progress = GREATEST(progress, ${percent}), stage = ${stage}, updated_at = now() WHERE id = ${jobId}::uuid AND status = 'running'
      AND lease_token = ${lease || null}::uuid`)
  }
  try {
    let buffer: Buffer
    if (Buffer.isBuffer(context?.documentSource)) buffer = context.documentSource
    else if (req.file?.data) buffer = Buffer.from(req.file.data)
    else if (doc.storageKey) {
      const url = await getPresignedDownloadUrl(doc.storageKey, doc.r2Bucket || R2_BUCKET)
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error('Stored PDF could not be read. Replace it from Materials.')
      buffer = Buffer.from(await response.arrayBuffer())
    } else {
      const root = path.resolve(process.cwd(), 'media/documents')
      const filePath = path.resolve(root, doc.filename)
      if (!filePath.startsWith(root + path.sep)) throw new Error('Invalid PDF file path.')
      try {
        buffer = await fs.readFile(filePath)
      } catch {
        throw new Error('Original PDF is unavailable. Replace it from Materials.')
      }
    }
    req.payload.logger.info(`Parsing document ${doc.id}: ${doc.filename}`)
    const subjectId = typeof doc.subject === 'object' ? doc.subject?.id : doc.subject
    const subject = await req.payload.findByID({
      collection: 'subjects',
      id: subjectId,
      depth: 2,
      req,
    })
    const semester = typeof subject.semester === 'object' ? subject.semester : undefined
    const branch = semester && typeof semester.branch === 'object' ? semester.branch : undefined
    const moduleId = typeof doc.module === 'object' ? doc.module?.id : doc.module
    const topicId = typeof doc.topic === 'object' ? doc.topic?.id : doc.topic
    const module = moduleId
      ? await req.payload.findByID({ collection: 'modules', id: moduleId, depth: 0, req })
      : undefined
    const topic = topicId
      ? await req.payload.findByID({ collection: 'topics', id: topicId, depth: 0, req })
      : undefined
    const tags = {
      chapter: doc.chapter || doc.name,
      subjectName: subject.name,
      semester: semester?.number,
      branch: branch?.name || '',
      moduleName: module?.name || '',
      moduleNumber: module?.number || '',
      topicName: topic?.name || '',
      topicNumber: topic?.number || '',
    }
    const storage = buildDocumentStoragePaths({
      id: doc.id,
      filename: doc.filename,
      ...tags,
      semesterNumber: tags.semester,
      branchName: tags.branch,
    })
    const versionFolder = `${storage.folder}/versions/${jobId || randomUUID()}/orientation-v${PAGE_ORIENTATION_VERSION}`
    const visuals = new Map<number, string>()
    const checkpoints = new Map<number, ExtractedPDFPage>()
    if (jobId && lease) {
      const saved = await checkpointDB.execute(
        sql`SELECT page_number, text, ocr, preview_key, orientation_rotation, orientation_confidence, orientation_verified, orientation_version FROM document_upload_pages WHERE job_id = ${jobId}::uuid AND orientation_version = ${PAGE_ORIENTATION_VERSION}`,
      )
      for (const row of saved.rows)
        checkpoints.set(Number(row.page_number), {
          pageNumber: Number(row.page_number),
          text: row.text,
          ocr: row.ocr,
          previewKey: row.preview_key || undefined,
          orientation: {
            rotation: normalizeRotation(Number(row.orientation_rotation)),
            confidence: Number(row.orientation_confidence),
            verified: row.orientation_verified,
          },
          orientationVersion: Number(row.orientation_version),
        })
    }
    // Consume previews one page at a time; a large scan must not retain hundreds
    // of rendered PNGs in the serverless heap. Old published assets are untouched.
    const pages = await extractPDF(buffer, {
      onProgress: (message) => {
        const page = message.match(/Reading page (\d+) \/ (\d+)/)
        return progress(
          page ? 10 + Math.floor((Number(page[1]) / Number(page[2])) * 29) : 15,
          message,
        )
      },
      cachedPage: (page) => checkpoints.get(page),
      maxFreshPages: jobId ? 8 : undefined,
      maxOCRPages: jobId ? 3 : undefined,
      budgetMs: jobId ? 160_000 : undefined,
      onPage: async (page) => {
        if (page.previewKey) visuals.set(page.pageNumber, page.previewKey)
        if (page.screenshot) {
          const key = `${versionFolder}/media/page_${page.pageNumber}.png`
          try {
            await uploadToR2({ buffer: page.screenshot, key, contentType: 'image/png' })
            visuals.set(page.pageNumber, key)
          } catch (error) {
            req.payload.logger.warn(
              `Page ${page.pageNumber} preview could not save: ${String(error)}`,
            )
          }
        }
        if (jobId && lease && !checkpoints.has(page.pageNumber)) {
          const saved =
            await checkpointDB.execute(sql`INSERT INTO document_upload_pages (job_id, page_number, text, ocr, preview_key, orientation_rotation, orientation_confidence, orientation_verified, orientation_version)
            SELECT id, ${page.pageNumber}, ${page.text}, ${page.ocr}, ${visuals.get(page.pageNumber) || null}, ${page.orientation?.rotation || 0}, ${page.orientation?.confidence || 0}, ${page.orientation?.verified || false}, ${PAGE_ORIENTATION_VERSION} FROM document_upload_jobs
            WHERE id = ${jobId}::uuid AND lease_token = ${lease}::uuid AND status = 'running'
            ON CONFLICT (job_id, page_number) DO UPDATE SET text = EXCLUDED.text, ocr = EXCLUDED.ocr, preview_key = EXCLUDED.preview_key,
            orientation_rotation = EXCLUDED.orientation_rotation, orientation_confidence = EXCLUDED.orientation_confidence,
            orientation_verified = EXCLUDED.orientation_verified, orientation_version = EXCLUDED.orientation_version RETURNING page_number`)
          if (!saved.rows.length)
            throw new Error('This indexing attempt lost its lease. Resume the active job.')
        }
        page.screenshot = undefined
      },
    })
    const { RecursiveCharacterTextSplitter } = await import('@langchain/textsplitters')
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 })
    const chunks: Array<{ pageNumber: number; text: string; vector?: number[] }> = []
    for (const page of pages) {
      for (const text of await splitter.splitText(page.text))
        if (text.trim().length > 20) chunks.push({ pageNumber: page.pageNumber, text })
    }
    if (!chunks.length) throw new Error('No readable chunks were extracted. Upload a clearer PDF.')
    for (let start = 0; start < chunks.length; start += 16) {
      await progress(
        40 + Math.floor((start / chunks.length) * 35),
        `Embedding chunks ${start + 1}–${Math.min(start + 16, chunks.length)} / ${chunks.length}`,
      )
      const batch = chunks.slice(start, start + 16)
      const vectors = await Promise.all(batch.map((chunk) => getEmbedding(chunk.text)))
      batch.forEach((chunk, index) => {
        chunk.vector = vectors[index]
      })
    }
    // A cloud PDF is mandatory; never leave production pointing at ephemeral disk.
    // Stage a fresh object version: a failed DB transaction must never overwrite
    // the PDF or previews still referenced by the previous successful index.
    await progress(80, 'Saving the cloud PDF and source screenshots')
    const cloud = await uploadToR2({
      buffer,
      key: `${versionFolder}/${doc.filename}`,
      contentType: 'application/pdf',
    })
    if (jobId && lease) {
      // Fence stale workers before publication. A second claim cannot publish
      // another document after its predecessor resumes from a timed-out request.
      const locked = await db.execute(
        sql`SELECT lease_token, dedup_key FROM document_upload_jobs WHERE id = ${jobId}::uuid FOR UPDATE`,
      )
      if (locked.rows[0]?.lease_token !== lease)
        throw new Error('This indexing attempt lost its lease.')
      const key = locked.rows[0]?.dedup_key
      if (key && operation === 'create') {
        await db.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext('parsea-pdf-dedup'), hashtext(${key}))`,
        )
        const duplicate =
          await db.execute(sql`SELECT document_id FROM document_upload_jobs WHERE dedup_key = ${key}
          AND status = 'ready' AND document_id IS NOT NULL AND id <> ${jobId}::uuid
          AND EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = document_upload_jobs.document_id AND c.embedding_model = ${EMBEDDING_MODEL})
          AND EXISTS (SELECT 1 FROM document_pages p WHERE p.document_id = document_upload_jobs.document_id AND p.orientation_version = ${PAGE_ORIENTATION_VERSION}) LIMIT 1`)
        if (duplicate.rows[0]) throw new DuplicateDocument(Number(duplicate.rows[0].document_id))
      }
    }
    if (operation === 'update') await deleteDocumentDependents({ id: doc.id, req })
    for (const page of pages) {
      // Preserve every physical page's orientation/visual, but never create
      // searchable chunks out of blank/low-confidence OCR.
      await req.payload.create({
        collection: 'document_pages',
        req,
        data: {
          document: doc.id,
          pageNumber: page.pageNumber,
          text: page.text,
          orientationRotation: page.orientation?.rotation || 0,
          orientationConfidence: page.orientation?.confidence || 0,
          orientationVerified: page.orientation?.verified || false,
          orientationVersion: PAGE_ORIENTATION_VERSION,
          previewKey: visuals.get(page.pageNumber) || null,
        },
      })
    }
    // Derived chunks have no write hooks. Bound bulk SQL avoids Payload lock
    // round trips; it uses the same transaction as the parent document.
    for (let start = 0; start < chunks.length; start += 32) {
      const values = chunks.slice(start, start + 32).map((chunk) => {
        const image = visuals.get(chunk.pageNumber)
        return sql`(${doc.id}, ${chunk.pageNumber}, ${chunk.text}, ${tags.chapter}, ${tags.subjectName}, ${tags.semester || null}, ${tags.branch}, ${tags.moduleName}, ${tags.moduleNumber}, ${tags.topicName}, ${tags.topicNumber}, ${Boolean(image)}, ${image || null}, ${image ? `Source page screenshot (Page ${chunk.pageNumber})` : null}, ${JSON.stringify(chunk.vector)}::vector, ${EMBEDDING_MODEL}, NOW(), NOW())`
      })
      await db.execute(
        sql`INSERT INTO chunks (document_id, page_number, text, chapter, subject_name, semester, branch, module_name, module_number, topic_name, topic_number, has_image, image_url, image_caption, embedding, embedding_model, created_at, updated_at) VALUES ${sql.join(values, sql`, `)}`,
      )
    }
    await db.execute(
      sql`UPDATE documents SET storage_key = ${cloud.key}, r2_bucket = ${cloud.bucket} WHERE id = ${doc.id}`,
    )
    const visualOnlyPages = pages.filter((page) => page.text.trim().length <= 20).length
    if (jobId)
      await db.execute(sql`UPDATE document_upload_jobs SET status = 'ready', document_id = ${doc.id},
      progress = 100, stage = ${visualOnlyPages ? `Parsed and indexed · ${visualOnlyPages} pages without searchable text` : 'Parsed and indexed'}, error = NULL, updated_at = now() WHERE id = ${jobId}::uuid`)
    req.payload.logger.info(
      `Indexed document ${doc.id}: ${pages.length} physical pages, ${chunks.length} semantic chunks, ${visuals.size} screenshots (${EMBEDDING_MODEL}).`,
    )
    return { ...doc, storageKey: cloud.key, r2Bucket: cloud.bucket }
  } catch (error) {
    if (error instanceof IngestionPending || error instanceof DuplicateDocument)
      req.payload.logger.info(`Document ${doc.id}: ${error.message}`)
    else req.payload.logger.error(`Indexing document ${doc.id} failed: ${String(error)}`)
    throw error // Parent transaction rolls back, preserving the old index.
  }
}
