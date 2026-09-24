import type { CollectionAfterChangeHook } from 'payload'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { getEmbedding } from '@/lib/embeddings'
import { uploadToR2, R2_BUCKET } from '@/lib/r2'
import { PDFParse } from 'pdf-parse'
import path from 'path'
import fs from 'fs'
import { sql } from 'drizzle-orm'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

export const processDocument: CollectionAfterChangeHook = async ({
  doc,
  req,
  operation,
}) => {
  if ((operation === 'create' || operation === 'update') && doc.filename) {
    const isPdf =
      doc.mimeType === 'application/pdf' ||
      doc.mime_type === 'application/pdf' ||
      doc.filename.toLowerCase().endsWith('.pdf')

    if (isPdf) {
      try {
        req.payload.logger.info(`Starting high-speed multimodal ingestion for document ${doc.id}: ${doc.filename}`)

        // Fix pdfjs-dist conflict: Payload CMS adds an enumerable "random" property to Array.prototype
        if ('random' in Array.prototype) {
          Object.defineProperty(Array.prototype, 'random', { enumerable: false })
        }

        const filePath = path.resolve(process.cwd(), 'media/documents', doc.filename)
        const fileBuffer = fs.readFileSync(filePath)

        const db = (req.payload.db as any).drizzle

        // Resolve academic hierarchy metadata
        let subjectName = ''
        let semesterNumber: number | null = null
        let branchName = ''
        const chapter = doc.chapter || doc.name || 'Chapter'

        try {
          const subjectId = typeof doc.subject === 'object' ? doc.subject?.id : doc.subject
          if (subjectId) {
            const subjectDoc = await req.payload.findByID({
              collection: 'subjects',
              id: subjectId,
              depth: 2,
            })
            subjectName = subjectDoc?.name || ''
            if (subjectDoc?.semester && typeof subjectDoc.semester === 'object') {
              semesterNumber = subjectDoc.semester.number || null
              if (subjectDoc.semester.branch && typeof subjectDoc.semester.branch === 'object') {
                branchName = subjectDoc.semester.branch.name || ''
              }
            }
          }
        } catch (metaErr) {
          req.payload.logger.warn(`Could not resolve full hierarchy for doc ${doc.id}: ${metaErr}`)
        }

        // ─────────────────────────────────────────────────────────
        // 1. CLOUDFLARE R2 UPLOAD (PDF Document)
        // ─────────────────────────────────────────────────────────
        const branchSlug = slugify(branchName || 'general')
        const semSlug = semesterNumber ? `sem${semesterNumber}` : 'general'
        const subjectSlug = slugify(subjectName || 'notes')
        const r2PdfKey = `documents/${branchSlug}/${semSlug}/${subjectSlug}/${doc.filename}`

        try {
          req.payload.logger.info(`Uploading document ${doc.id} to Cloudflare R2: ${r2PdfKey}`)
          await uploadToR2({
            buffer: fileBuffer,
            key: r2PdfKey,
            contentType: 'application/pdf',
          })

          await db.execute(sql`
            UPDATE documents 
            SET storage_key = ${r2PdfKey}, r2_bucket = ${R2_BUCKET}
            WHERE id = ${doc.id};
          `)
          req.payload.logger.info(`Saved R2 storageKey=${r2PdfKey} to document ${doc.id}`)
        } catch (r2Err: any) {
          req.payload.logger.error(`Cloudflare R2 upload warning for doc ${doc.id}: ${r2Err?.message}`)
        }

        // ─────────────────────────────────────────────────────────
        // 2. EXTRACT DIAGRAMS & MEDIA PER PAGE -> CLOUDFLARE R2
        // ─────────────────────────────────────────────────────────
        const pageImageMap = new Map<number, { r2Key: string; caption: string }>()
        try {
          req.payload.logger.info(`Extracting diagrams and slide visuals from ${doc.filename}...`)
          const parser = new PDFParse(new Uint8Array(fileBuffer))
          await parser.load()

          const imgRes = await parser.getImage()
          const pagesWithMedia = new Set(
            imgRes.pages.filter((p) => p.images && p.images.length > 0).map((p) => p.pageNumber)
          )

          for (const pageNum of Array.from(pagesWithMedia)) {
            try {
              const shotRes = await parser.getScreenshot({ pageNumber: pageNum })
              const pData = shotRes.pages.find((p) => p.pageNumber === pageNum)
              if (pData && pData.data) {
                const imgKey = `documents/${branchSlug}/${semSlug}/${subjectSlug}/media/page_${pageNum}.png`
                await uploadToR2({
                  buffer: Buffer.from(pData.data),
                  key: imgKey,
                  contentType: 'image/png',
                })
                pageImageMap.set(pageNum, {
                  r2Key: imgKey,
                  caption: `Diagram & Visual Slide (Page ${pageNum})`,
                })
              }
            } catch (err) {
              // Non-critical if individual page screenshot fails
            }
          }
          await parser.destroy()
          req.payload.logger.info(`Extracted & uploaded ${pageImageMap.size} page diagrams to R2.`)
        } catch (mediaErr: any) {
          req.payload.logger.warn(`Diagram extraction warning: ${mediaErr?.message}`)
        }

        // ─────────────────────────────────────────────────────────
        // 3. PARSE PDF & SPLIT CHUNKS
        // ─────────────────────────────────────────────────────────
        const loader = new PDFLoader(filePath)
        const rawDocs = await loader.load()
        req.payload.logger.info(`Extracted ${rawDocs.length} pages from ${doc.filename}`)

        // Delete previous chunks/pages on update
        if (operation === 'update') {
          await req.payload.delete({
            collection: 'document_pages',
            where: { document: { equals: doc.id } },
          })
          await req.payload.delete({
            collection: 'chunks',
            where: { document: { equals: doc.id } },
          })
        }

        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 1000,
          chunkOverlap: 200,
        })

        interface PendingChunk {
          pageNumber: number
          text: string
          hasImage: boolean
          imageUrl?: string
          imageCaption?: string
        }

        const pendingChunks: PendingChunk[] = []

        for (const rDoc of rawDocs) {
          const pageNumber = rDoc.metadata.loc?.pageNumber || 1
          const pageText = rDoc.pageContent
          const imgInfo = pageImageMap.get(pageNumber)

          // Save raw document page
          await req.payload.create({
            collection: 'document_pages',
            data: {
              document: doc.id,
              pageNumber,
              text: pageText,
            },
          })

          // Split page into text chunks
          const splitChunks = await splitter.createDocuments([pageText])
          for (const sc of splitChunks) {
            if (sc.pageContent.trim().length > 20) {
              pendingChunks.push({
                pageNumber,
                text: sc.pageContent,
                hasImage: Boolean(imgInfo),
                imageUrl: imgInfo?.r2Key,
                imageCaption: imgInfo?.caption,
              })
            }
          }
        }

        // ─────────────────────────────────────────────────────────
        // 4. BATCH EMBEDDING GENERATION & BULK INGESTION
        // Process in batches of 16 instead of slow sequential 1-by-1
        // ─────────────────────────────────────────────────────────
        req.payload.logger.info(`Generating embeddings for ${pendingChunks.length} chunks in batches...`)
        const BATCH_SIZE = 16

        for (let i = 0; i < pendingChunks.length; i += BATCH_SIZE) {
          const batch = pendingChunks.slice(i, i + BATCH_SIZE)

          // Generate embeddings concurrently for the batch
          const embeddings = await Promise.all(
            batch.map((chunk) => getEmbedding(chunk.text))
          )

          // Insert batch chunks
          for (let j = 0; j < batch.length; j++) {
            const item = batch[j]
            const vector = embeddings[j]
            const vectorStr = JSON.stringify(vector)

            const createdChunk = await req.payload.create({
              collection: 'chunks',
              data: {
                document: doc.id,
                pageNumber: item.pageNumber,
                text: item.text,
                chapter,
                subjectName,
                semester: semesterNumber,
                branch: branchName,
                hasImage: item.hasImage,
                imageUrl: item.imageUrl,
                imageCaption: item.imageCaption,
              },
            })

            // Update pgvector embedding and image columns
            await db.execute(sql`
              UPDATE chunks 
              SET embedding = ${vectorStr}::vector,
                  has_image = ${item.hasImage},
                  image_url = ${item.imageUrl || null},
                  image_caption = ${item.imageCaption || null}
              WHERE id = ${createdChunk.id}
            `)
          }
        }

        // Ensure HNSW and GIN indexes exist on PostgreSQL
        await db.execute(sql`
          CREATE INDEX IF NOT EXISTS chunks_fts_idx 
          ON chunks 
          USING GIN (to_tsvector('english', text));
        `)
        await db.execute(sql`
          CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
          ON chunks
          USING hnsw (embedding vector_cosine_ops);
        `)

        req.payload.logger.info(
          `Successfully ingested document ${doc.id}: ${rawDocs.length} pages, ${pendingChunks.length} chunks, ${pageImageMap.size} diagrams indexed.`
        )
      } catch (error) {
        req.payload.logger.error(`Error ingesting PDF ${doc.id}: ${error}`)
      }
    }
  }
  return doc
}
