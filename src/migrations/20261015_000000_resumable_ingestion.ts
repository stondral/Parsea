import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-postgres'
import { ingestionResumeSchemaSQL } from '../lib/ingestionSchema'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(ingestionResumeSchemaSQL))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Resume checkpoints are intentionally retained. Review pending uploads before rolling back this migration.',
  )
}
