import type { Payload } from 'payload'
import { sql } from 'drizzle-orm'
import { processUploadJob } from './uploadJobs'

/** Shared bounded scheduler/CLI drain. Leases arbitrate browser/cron overlap. */
export async function drainIngestionQueue(payload: Payload, budgetMs = 180_000, maxSteps = 20) {
  const started = Date.now()
  const results: Array<{ id: string; status: string; documentId: number | null }> = []
  while (results.length < maxSteps && Date.now() - started < budgetMs) {
    const next = await (payload.db as any).drizzle.execute(sql`SELECT id FROM document_upload_jobs
      WHERE status = 'queued' OR (status = 'running' AND updated_at < now() - interval '15 minutes')
      ORDER BY updated_at ASC LIMIT 1`)
    if (!next.rows[0]) break
    const result = await processUploadJob(payload, next.rows[0].id)
    results.push({ id: result.id, status: result.status, documentId: result.document_id })
    // One OCR batch can be slow. Do not begin another when the route is close
    // to its limit; saved pages allow the next invocation to continue.
    if (Date.now() - started > Math.min(budgetMs, 120_000)) break
  }
  return results
}
