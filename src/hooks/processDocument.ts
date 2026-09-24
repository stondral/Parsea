import type { CollectionAfterChangeHook } from 'payload'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/hf_transformers'
import path from 'path'
import { sql } from 'drizzle-orm'

export const processDocument: CollectionAfterChangeHook = async ({
  doc, // full document data
  req,
  operation,
}) => {
  if ((operation === 'create' || operation === 'update') && doc.filename) {
    if (doc.mimeType === 'application/pdf') {
      try {
        const filePath = path.resolve(process.cwd(), 'media/documents', doc.filename)
        const loader = new PDFLoader(filePath)
        const rawDocs = await loader.load()

        const db = (req.payload.db as any).drizzle

        // Initialize pgvector if not exists
        await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector;`)
        
        // Drop existing 1536 dim column if we are switching to 384 dim
        await db.execute(sql`ALTER TABLE chunks DROP COLUMN IF EXISTS embedding;`)
        await db.execute(sql`ALTER TABLE chunks ADD COLUMN embedding vector(384);`)

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
        
        const embeddings = new HuggingFaceTransformersEmbeddings({
          modelName: 'Xenova/all-MiniLM-L6-v2',
        })

        for (const rDoc of rawDocs) {
          const pageNumber = rDoc.metadata.loc.pageNumber || 1
          const pageText = rDoc.pageContent

          // Save page
          const createdPage = await req.payload.create({
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
              },
            })
            
            // Generate embedding and save to pgvector column via raw SQL
            const vector = await embeddings.embedQuery(chunk.pageContent)
            await db.execute(sql`
              UPDATE chunks 
              SET embedding = ${JSON.stringify(vector)}::vector 
              WHERE id = ${createdChunk.id}
            `)
          }
        }
      } catch (error) {
        req.payload.logger.error(`Error processing PDF ${doc.id}: ${error}`)
      }
    }
  }
  return doc
}
