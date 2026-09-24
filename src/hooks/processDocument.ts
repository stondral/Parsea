import type { CollectionAfterChangeHook } from 'payload'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { getEmbedding } from '@/lib/embeddings'
import path from 'path'
import { sql } from 'drizzle-orm'

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
        req.payload.logger.info(`Starting ingestion for document ${doc.id}: ${doc.filename}`)

        // Fix pdfjs-dist conflict: Payload CMS adds an enumerable "random" property to Array.prototype
        // which pdfjs-dist detects and throws an error on.
        if ('random' in Array.prototype) {
          Object.defineProperty(Array.prototype, 'random', { enumerable: false })
        }

        const filePath = path.resolve(process.cwd(), 'media/documents', doc.filename)
        const loader = new PDFLoader(filePath)
        const rawDocs = await loader.load()
        req.payload.logger.info(`Extracted ${rawDocs.length} pages from ${doc.filename}`)

        const db = (req.payload.db as any).drizzle

        // Initialize pgvector if not exists
        await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector;`)
        await db.execute(sql`ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding vector(384);`)

        // For updates, delete old pages and chunks first
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

        // Resolve academic hierarchy metadata for the chunks
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

        let totalChunksCount = 0

        for (const rDoc of rawDocs) {
          const pageNumber = rDoc.metadata.loc?.pageNumber || 1
          const pageText = rDoc.pageContent

          // Save page
          await req.payload.create({
            collection: 'document_pages',
            data: {
              document: doc.id,
              pageNumber,
              text: pageText,
            },
          })

          // Split page into chunks
          const chunks = await splitter.createDocuments([pageText])
          for (const chunk of chunks) {
            const createdChunk = await req.payload.create({
              collection: 'chunks',
              data: {
                document: doc.id,
                pageNumber,
                text: chunk.pageContent,
                chapter,
                subjectName,
                semester: semesterNumber,
                branch: branchName,
              },
            })

            // Generate embedding and save to pgvector column via raw SQL
            const vector = await getEmbedding(chunk.pageContent)
            await db.execute(sql`
              UPDATE chunks 
              SET embedding = ${JSON.stringify(vector)}::vector 
              WHERE id = ${createdChunk.id}
            `)
            totalChunksCount++
          }
        }

        req.payload.logger.info(
          `Successfully processed document ${doc.id}: ${rawDocs.length} pages, ${totalChunksCount} chunks with embeddings generated.`
        )
      } catch (error) {
        req.payload.logger.error(`Error processing PDF ${doc.id}: ${error}`)
      }
    }
  }
  return doc
}
