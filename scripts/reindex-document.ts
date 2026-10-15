import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { getEmbedding, EMBEDDING_MODEL } from '../src/lib/embeddings'
import { sql } from 'drizzle-orm'

// Explicit maintenance: same canonical hook as /administrator; preserves IDs.
const id = Number(process.argv[2])
if (!Number.isInteger(id) || id < 1) throw new Error('Provide a positive document ID.')
const payload = await getPayload({ config })
try {
  const doc = await payload.findByID({ collection: 'documents', id, depth: 0 })
  const start = Date.now()
  await payload.update({
    collection: 'documents',
    id,
    data: { name: doc.name },
    context: { forceDocumentIngestion: true },
  })
  const db = (payload.db as any).drizzle
  const health =
    await db.execute(sql`SELECT count(*)::int AS chunks, count(embedding)::int AS vectors,
    count(*) FILTER (WHERE has_image)::int AS visual_chunks FROM chunks WHERE document_id = ${id} AND embedding_model = ${EMBEDDING_MODEL}`)
  const vector = JSON.stringify(await getEmbedding('Explain the concepts in these study notes'))
  const nearest =
    await db.execute(sql`SELECT page_number, 1 - (embedding <=> ${vector}::vector) AS similarity
    FROM chunks WHERE document_id = ${id} AND embedding_model = ${EMBEDDING_MODEL} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vector}::vector LIMIT 3`)
  console.log(
    JSON.stringify({
      id,
      milliseconds: Date.now() - start,
      health: health.rows,
      nearest: nearest.rows,
    }),
  )
} finally {
  await payload.destroy()
}
process.exit(0)
