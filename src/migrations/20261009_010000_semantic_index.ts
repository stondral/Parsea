import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-postgres'
import { ingestionSchemaSQL } from '../lib/ingestionSchema'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(ingestionSchemaSQL))
}
export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Upload jobs intentionally survive rollback; dropping them would lose queued PDFs.
  await db.execute(sql`DROP INDEX IF EXISTS chunks_embedding_model_hnsw; DROP INDEX IF EXISTS chunks_course_lookup; ALTER TABLE chunks DROP COLUMN IF EXISTS embedding_model;`)
}
