import 'dotenv/config'
import { getPayload, createLocalReq } from 'payload'
import config from '../src/payload.config'

// Diagnostic only: no files, caches, or committed records are removed.
const payload = await getPayload({ config })
const started = Date.now()
const transactionID = await payload.db.beginTransaction()
if (!transactionID) throw new Error('A rollback-capable transaction is required')
const req = await createLocalReq({ req: { transactionID } }, payload)
const collection = payload.collections.documents.config
collection.upload.staticDir = undefined
collection.hooks.afterDelete = []
for (const method of ['deleteOne', 'deleteMany', 'find'] as const) {
  const original = payload.db[method].bind(payload.db) as (...args: any[]) => Promise<any>
  ;(payload.db as any)[method] = async (args: any) => {
    try {
      return await original(args)
    } catch (error: any) {
      console.error(
        JSON.stringify({
          method,
          collection: args.collection,
          message: error.message,
          cause: error.cause?.message,
          code: error.cause?.code,
          table: error.cause?.table,
          column: error.cause?.column,
        }),
      )
      throw error
    }
  }
}
try {
  const before = await payload.find({
    collection: 'chunks',
    where: { document: { equals: 2 } },
    limit: 1,
    depth: 0,
    req,
  })
  const result = await payload.delete({
    collection: 'documents',
    where: { id: { in: [2] } },
    depth: 0,
    req,
  })
  console.log(
    JSON.stringify({
      beforeChunks: before.totalDocs,
      removed: result.docs.map((doc) => doc.id),
      errors: result.errors,
      elapsedMs: Date.now() - started,
    }),
  )
} finally {
  await payload.db.rollbackTransaction(transactionID)
  const document = await payload.findByID({ collection: 'documents', id: 2, depth: 0 })
  const chunks = await payload.find({
    collection: 'chunks',
    where: { document: { equals: 2 } },
    limit: 1,
    depth: 0,
  })
  console.log(JSON.stringify({ restoredDocument: document.id, restoredChunks: chunks.totalDocs }))
  await payload.destroy()
}
process.exit(0)
