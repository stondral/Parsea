import type { CollectionAfterChangeHook } from 'payload'
import { deleteDocumentDependents } from '@/hooks/deleteDocumentDependents'
import { getEmbedding } from '@/lib/embeddings'
import { uploadToR2, getPresignedDownloadUrl, R2_BUCKET } from '@/lib/r2'
import { extractTextFromImage } from '@/lib/ocr'
import path from 'path'
import fs from 'fs'
import { sql } from 'drizzle-orm'
import { buildDocumentStoragePaths } from '@/lib/documentStorage'

// Polyfill browser globals needed by pdfjs-dist / pdf-parse if not already present in Node runtime
if (typeof (globalThis as any).DOMMatrix === 'undefined') {
  class DOMMatrixFallback {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
    m11 = 1; m12 = 0; m13 = 0; m14 = 0
    m21 = 0; m22 = 1; m23 = 0; m24 = 0
    m31 = 0; m32 = 0; m33 = 1; m34 = 0
    m41 = 0; m42 = 0; m43 = 0; m44 = 1
    is2D = true
    isIdentity = true
    translate() { return this }
    scale() { return this }
    multiply() { return this }
    preMultiplySelf() { return this }
    invertSelf() { return this }
    setTransform() { return this }
  }
  ;(globalThis as any).DOMMatrix = DOMMatrixFallback
}
if (typeof (globalThis as any).Path2D === 'undefined') {
  class Path2DFallback {
    addPath() {}
    closePath() {}
  }
  ;(globalThis as any).Path2D = Path2DFallback
}
if (typeof (globalThis as any).ImageData === 'undefined') {
  class ImageDataFallback {
    data = new Uint8ClampedArray(0)
    width = 0
    height = 0
  }
  ;(globalThis as any).ImageData = ImageDataFallback
}


export const processDocument: CollectionAfterChangeHook = async ({
  doc,
  req,
  operation,
  context,
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
        let fileBuffer: Buffer
        if (req.file?.data) fileBuffer = Buffer.from(req.file.data)
        else if (fs.existsSync(filePath)) fileBuffer = fs.readFileSync(filePath)
        else if (doc.storageKey) {
          const url = await getPresignedDownloadUrl(doc.storageKey, doc.r2Bucket || R2_BUCKET)
          const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
          if (!response.ok) throw new Error('Stored PDF could not be read for indexing.')
          fileBuffer = Buffer.from(await response.arrayBuffer())
        } else throw new Error('The original PDF is unavailable. Upload a replacement first.')

        // Direct SQL and derived Payload writes must share the parent transaction.
        const transactionID = await req.transactionID
        const db = transactionID ? req.payload.db.sessions?.[String(transactionID)]?.db as any : (req.payload.db as any).drizzle
        if (!db) throw new Error('Document transaction unavailable.')

        // Resolve academic hierarchy metadata
        let subjectName = ''
        let semesterNumber: number | null = null
        let branchName = ''
        let moduleName = ''
        let moduleNumber = ''
        let topicName = ''
        let topicNumber = ''
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

        try {
          const moduleId = typeof doc.module === 'object' ? doc.module?.id : doc.module
          if (moduleId) {
            const moduleDoc = await req.payload.findByID({ collection: 'modules', id: moduleId, depth: 0 })
            moduleName = moduleDoc?.name || ''
            moduleNumber = moduleDoc?.number || ''
          }
          const topicId = typeof doc.topic === 'object' ? doc.topic?.id : doc.topic
          if (topicId) {
            const topicDoc = await req.payload.findByID({ collection: 'topics', id: topicId, depth: 0 })
            topicName = topicDoc?.name || ''
            topicNumber = topicDoc?.number || ''
          }
        } catch (metaErr) {
          req.payload.logger.warn(`Could not resolve module hierarchy for doc ${doc.id}: ${metaErr}`)
        }

        // ─────────────────────────────────────────────────────────
        // 1. CLOUDFLARE R2 UPLOAD (PDF Document)
        // ─────────────────────────────────────────────────────────
        const { folder: r2Folder, pdfKey: r2PdfKey } = buildDocumentStoragePaths({
          id: doc.id, filename: doc.filename, branchName, semesterNumber, subjectName,
          moduleNumber, moduleName, topicNumber, topicName,
        })

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
        let PDFParseClass: any = null
        let CanvasFactoryClass: any = null

        try {
          // Lazy-load worker and pdf-parse dynamically to prevent top-level module evaluation issues
          const workerMod = await import('pdf-parse/worker')
          CanvasFactoryClass = workerMod.CanvasFactory
          const pdfParseMod = await import('pdf-parse')
          PDFParseClass = pdfParseMod.PDFParse
        } catch (loadErr: any) {
          req.payload.logger.warn(`pdf-parse module could not be initialized: ${loadErr?.message}`)
        }

        if (PDFParseClass) {
          try {
            req.payload.logger.info(`Extracting diagrams and slide visuals from ${doc.filename}...`)
            const parser: any = new PDFParseClass({
              data: new Uint8Array(fileBuffer),
              ...(CanvasFactoryClass ? { CanvasFactory: CanvasFactoryClass } : {}),
            })
            const imgRes = await parser.getImage()
            const pagesWithMedia = new Set<number>(
              imgRes.pages
                .filter((p: any) => p.images && p.images.length > 0)
                .map((p: any) => Number(p.pageNumber))
            )

            for (const pageNum of Array.from(pagesWithMedia)) {
              try {
                const shotRes = await parser.getScreenshot({ partial: [pageNum], imageBuffer: true, imageDataUrl: false })
                const pData = shotRes.pages.find((p: any) => p.pageNumber === pageNum)
                if (pData && pData.data) {
                  const imgKey = `${r2Folder}/media/page_${pageNum}.png`
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
        }

        // ─────────────────────────────────────────────────────────
        // 3. PARSE PDF & SPLIT CHUNKS
        // ─────────────────────────────────────────────────────────
        const { PDFLoader } = await import('@langchain/community/document_loaders/fs/pdf')
        const loader = new PDFLoader(new Blob([new Uint8Array(fileBuffer)], { type: 'application/pdf' }))
        let rawDocs = await loader.load()
        req.payload.logger.info(`Extracted ${rawDocs.length} pages from ${doc.filename}`)

        // Text loaders omit image-only pages, including every page in a scan.
        // Enumerate physical pages independently so missing pages reach OCR too.
        if (PDFParseClass) {
          const inventory = new PDFParseClass({ data: new Uint8Array(fileBuffer) })
          try {
            const info = await inventory.getInfo()
            if (Number.isInteger(info.total) && info.total > 0) {
              const textPages = new Map(rawDocs.map((page) => [page.metadata.loc?.pageNumber, page]))
              rawDocs = Array.from({ length: info.total }, (_, index) => {
                const pageNumber = index + 1
                return textPages.get(pageNumber) || { pageContent: '', metadata: { loc: { pageNumber } } }
              })
              req.payload.logger.info(`Checking all ${info.total} physical pages for text or OCR.`)
            }
          } finally {
            await inventory.destroy()
          }
        }

        // Delete previous chunks/pages on update
        if (operation === 'update') {
          await deleteDocumentDependents({ id: doc.id, req })
        }

        const { RecursiveCharacterTextSplitter } = await import('@langchain/textsplitters')
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
          let pageText = rDoc.pageContent?.trim() || ''
          const imgInfo = pageImageMap.get(pageNumber)

          // ─────────────────────────────────────────────────────────
          // OCR FALLBACK: For scanned, CamScanner & handwritten pages (< 40 chars)
          // ─────────────────────────────────────────────────────────
          if (pageText.length < 40 && PDFParseClass) {
            req.payload.logger.info(`Page ${pageNumber} has low text density (${pageText.length} chars). Triggering OCR fallback...`)
            try {
              const ocrParser: any = new PDFParseClass({
                data: new Uint8Array(fileBuffer),
                ...(CanvasFactoryClass ? { CanvasFactory: CanvasFactoryClass } : {}),
              })
              try {
                const shotRes = await ocrParser.getScreenshot({ partial: [pageNumber], scale: 2, imageBuffer: true, imageDataUrl: false })
                const pData = shotRes.pages.find((p: any) => p.pageNumber === pageNumber)
                if (pData?.data) {
                  const ocrText = await extractTextFromImage(pData.data, { preferLocal: true })
                  if (ocrText && ocrText.length > 20) {
                    req.payload.logger.info(`Tesseract extracted ${ocrText.length} characters from Page ${pageNumber}.`)
                    pageText = `[OCR Transcribed Page ${pageNumber}]:\n${ocrText}`
                  }
                }
              } finally {
                await ocrParser.destroy()
              }
            } catch (ocrErr: any) {
              req.payload.logger.warn(`OCR fallback failed for page ${pageNumber}: ${ocrErr?.message}`)
            }
          }

          // Save raw document page
          await req.payload.create({
            collection: 'document_pages',
            req,
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
        if (context.failOnIngestionError && !pendingChunks.length) throw new Error('No readable text chunks were extracted. This PDF may need OCR or a clearer scan.')
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
              req,
              data: {
                document: doc.id,
                pageNumber: item.pageNumber,
                text: item.text,
                chapter,
                subjectName,
                moduleName,
                moduleNumber,
                topicName,
                topicNumber,
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
        if (context.failOnIngestionError) throw error
      }
    }
  }
  return doc
}
