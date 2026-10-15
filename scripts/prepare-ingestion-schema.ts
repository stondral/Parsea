import 'dotenv/config'
import pg from 'pg'
import { ingestionSchemaSQL, ingestionResumeSchemaSQL } from '../src/lib/ingestionSchema'
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
try {
  await db.connect()
  await db.query(ingestionSchemaSQL)
  await db.query(ingestionResumeSchemaSQL)
  console.log(
    'Semantic-index schema prepared. Existing PDFs/chunks were not deleted or relabelled.',
  )
} finally {
  await db.end()
}
