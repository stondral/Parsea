import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-postgres'
import { pageOrientationSchemaSQL } from '../lib/ingestionSchema'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(pageOrientationSchemaSQL))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Page orientation and preview metadata are retained. Review published sources before manual rollback.',
  )
}
