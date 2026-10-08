import { Pool } from 'pg'

/** Public, read-only catalog queries. Never initialize ingestion or the CMS here. */
export interface CatalogSubject {
  id: number
  name: string
  code: string
  semesterNumber: number | null
  branchName: string
}

export interface NoteItem {
  id: number
  name: string
  chapter?: string
  type: 'Notes' | 'PYQs' | 'Assignments'
  filename?: string
  filesize?: number
  storageKey?: string
  subjectId?: number
  subjectName: string
  moduleId?: number
  moduleName?: string
  moduleNumber?: string
  topicId?: number
  topicName?: string
  topicNumber?: string
  semesterNumber?: number | null
  branchName?: string
  createdAt: string
}

export interface CatalogFilters {
  subject?: string
  type?: 'Notes' | 'PYQs' | 'Assignments'
  search?: string
  branch?: string
  semester?: number
}

const catalogGlobal = globalThis as typeof globalThis & { parseaCatalogPool?: Pool }

function getCatalogPool() {
  if (!catalogGlobal.parseaCatalogPool) {
    catalogGlobal.parseaCatalogPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 5_000,
      application_name: 'parsea-public-catalog',
    })
    catalogGlobal.parseaCatalogPool.on('error', () => {
      console.warn('[Catalog] An idle database connection closed; the pool will reconnect.')
    })
  }
  return catalogGlobal.parseaCatalogPool
}

// Search is literal, not an SQL LIKE wildcard language; all values are bound.
function contains(value: string) {
  return `%${value.trim().replace(/[\\%_]/g, '\\$&')}%`
}

export async function readSubjects(input: Pick<CatalogFilters, 'semester' | 'branch'> = {}) {
  const params: Array<string | number> = []
  const where: string[] = []
  if (input.semester) {
    params.push(input.semester)
    where.push(`sem.number = $${params.length}`)
  }
  if (input.branch?.trim()) {
    params.push(contains(input.branch))
    where.push(`b.name ILIKE $${params.length}`)
  }
  const result = await getCatalogPool().query<CatalogSubject>(
    `
    SELECT s.id, s.name, COALESCE(s.code, '') AS code,
      sem.number AS "semesterNumber", COALESCE(b.name, '') AS "branchName"
    FROM subjects s
    LEFT JOIN semesters sem ON sem.id = s.semester_id
    LEFT JOIN branches b ON b.id = sem.branch_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY s.name, s.id
  `,
    params,
  )
  return result.rows
}

export async function readNotes(input: CatalogFilters = {}): Promise<NoteItem[]> {
  const params: Array<string | number> = []
  const where: string[] = []
  if (input.type) {
    params.push(input.type)
    where.push(`d.type = $${params.length}`)
  }
  if (input.subject?.trim()) {
    params.push(contains(input.subject))
    where.push(`s.name ILIKE $${params.length}`)
  }
  if (input.semester) {
    params.push(input.semester)
    where.push(`sem.number = $${params.length}`)
  }
  if (input.branch?.trim()) {
    params.push(contains(input.branch))
    where.push(`b.name ILIKE $${params.length}`)
  }
  if (input.search?.trim()) {
    params.push(contains(input.search))
    const param = `$${params.length}`
    where.push(
      `(d.name ILIKE ${param} OR d.chapter ILIKE ${param} OR s.name ILIKE ${param} OR m.name ILIKE ${param} OR t.name ILIKE ${param})`,
    )
  }
  const result = await getCatalogPool().query<NoteItem & { createdAt: string | Date }>(
    `
    SELECT d.id, d.name, COALESCE(d.chapter, '') AS chapter, d.type,
      d.filename, d.filesize, d.storage_key AS "storageKey",
      d.subject_id AS "subjectId", COALESCE(s.name, 'General Studies') AS "subjectName",
      d.module_id AS "moduleId", COALESCE(m.name, '') AS "moduleName", COALESCE(m.number, '') AS "moduleNumber",
      d.topic_id AS "topicId", COALESCE(t.name, '') AS "topicName", COALESCE(t.number, '') AS "topicNumber",
      sem.number AS "semesterNumber", COALESCE(b.name, '') AS "branchName", d.created_at AS "createdAt"
    FROM documents d
    LEFT JOIN subjects s ON s.id = d.subject_id
    LEFT JOIN semesters sem ON sem.id = s.semester_id
    LEFT JOIN branches b ON b.id = sem.branch_id
    LEFT JOIN modules m ON m.id = d.module_id
    LEFT JOIN topics t ON t.id = d.topic_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 100
  `,
    params,
  )
  return result.rows
    .map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }))
    .sort(
      (a, b) =>
        a.subjectName.localeCompare(b.subjectName) ||
        (a.moduleNumber || '∞').localeCompare(b.moduleNumber || '∞', undefined, {
          numeric: true,
        }) ||
        (a.topicNumber || '∞').localeCompare(b.topicNumber || '∞', undefined, { numeric: true }) ||
        b.createdAt.localeCompare(a.createdAt),
    )
}

export async function readModules(subjectId: number) {
  const result = await getCatalogPool().query<{ id: number; number: string; name: string }>(
    'SELECT id, number, name FROM modules WHERE subject_id = $1 ORDER BY number, id',
    [subjectId],
  )
  return result.rows.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
}

export async function readTopics(moduleId: number) {
  const result = await getCatalogPool().query<{ id: number; number: string; name: string }>(
    'SELECT id, number, name FROM topics WHERE module_id = $1 ORDER BY number, id',
    [moduleId],
  )
  return result.rows.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
}

export async function readCatalogStats() {
  const result = await getCatalogPool().query<{ totalDocuments: number; totalSubjects: number }>(
    'SELECT (SELECT COUNT(*)::int FROM documents) AS "totalDocuments", (SELECT COUNT(*)::int FROM subjects) AS "totalSubjects"',
  )
  return result.rows[0]
}
