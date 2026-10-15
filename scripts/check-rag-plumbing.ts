import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { sql } from 'drizzle-orm'
import { getEmbedding, EMBEDDING_MODEL } from '../src/lib/embeddings'
import { askRAG } from '../src/lib/rag'

const id = Number(process.argv[2])
if (!Number.isInteger(id) || id < 1) throw new Error('Pass an indexed document ID.')
const payload = await getPayload({ config })
try {
  const db = (payload.db as any).drizzle
  const result =
    await db.execute(sql`SELECT text, subject_name, semester, branch, module_number FROM chunks
    WHERE document_id = ${id} AND embedding_model = ${EMBEDDING_MODEL} ORDER BY page_number LIMIT 1`)
  const row = result.rows[0]
  if (!row) throw new Error('Document has no compatible semantic index.')
  const vector = JSON.stringify(await getEmbedding(row.text))
  const nearest =
    await db.execute(sql`SELECT document_id, page_number, 1 - (embedding <=> ${vector}::vector) AS similarity
    FROM chunks WHERE embedding_model = ${EMBEDDING_MODEL} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vector}::vector LIMIT 1`)
  const plan =
    await db.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM chunks WHERE embedding_model = ${EMBEDDING_MODEL}
    AND embedding IS NOT NULL ORDER BY embedding <=> ${vector}::vector LIMIT 25`)
  const filters = {
    subject: row.subject_name,
    semester: Number(row.semester),
    branch: row.branch,
    module: row.module_number,
  }
  const question = `Explain this topic from my notes in one short paragraph, with page references: ${row.text.slice(0, 180)}`
  const answer = await askRAG(question, filters)
  const repeated = await askRAG(question, filters)
  let screenshotVerified = false
  if (answer.images[0]) {
    const image = await fetch(answer.images[0].url, {
      headers: { Range: 'bytes=0-7' },
      signal: AbortSignal.timeout(15_000),
    })
    screenshotVerified =
      image.ok &&
      Buffer.from(await image.arrayBuffer())
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  }
  const queryPlan = plan.rows[0]['QUERY PLAN'][0]
  console.log(
    JSON.stringify({
      nearest: nearest.rows,
      queryPlan: {
        executionMs: queryPlan['Execution Time'],
        index: queryPlan.Plan.Plans?.[0]?.['Index Name'],
      },
      sources: answer.sources,
      screenshots: answer.images.length,
      screenshotVerified,
      firstMs: answer.latencyMs,
      cached: repeated.cached,
      repeatedMs: repeated.latencyMs,
    }),
  )
} finally {
  await payload.destroy()
}
process.exit(0)
