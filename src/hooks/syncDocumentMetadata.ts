import type { CollectionAfterChangeHook } from 'payload'
import { sql } from 'drizzle-orm'

/** Retag derived chunks without recomputing vectors or requiring the local PDF. */
export const syncDocumentMetadata: CollectionAfterChangeHook = async ({
  doc,
  req,
  collection,
  operation,
}) => {
  if (operation !== 'update') return doc
  const filters = {
    documents: sql`d.id = ${doc.id}`,
    subjects: sql`s.id = ${doc.id}`,
    modules: sql`m.id = ${doc.id}`,
    topics: sql`t.id = ${doc.id}`,
    semesters: sql`sem.id = ${doc.id}`,
    branches: sql`b.id = ${doc.id}`,
    colleges: sql`b.college_id = ${doc.id}`,
  }
  const filter = filters[collection.slug as keyof typeof filters]
  if (!filter) return doc
  const transactionID = await req.transactionID
  const db = transactionID
    ? req.payload.db.sessions?.[String(transactionID)]?.db
    : (req.payload.db as any).drizzle
  if (!db) throw new Error('Metadata transaction unavailable.')
  await (db as any).execute(sql`
    UPDATE chunks c SET chapter = COALESCE(NULLIF(d.chapter, ''), d.name, 'Chapter'), subject_name = s.name,
      module_name = m.name, module_number = m.number,
      topic_name = t.name, topic_number = t.number,
      semester = sem.number, branch = b.name
    FROM documents d
    JOIN subjects s ON s.id = d.subject_id
    JOIN semesters sem ON sem.id = s.semester_id
    JOIN branches b ON b.id = sem.branch_id
    LEFT JOIN modules m ON m.id = d.module_id
    LEFT JOIN topics t ON t.id = d.topic_id
    WHERE c.document_id = d.id AND ${filter}
  `)
  return doc
}
