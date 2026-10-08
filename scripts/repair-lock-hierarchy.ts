import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { up } from '../src/migrations/20261009_000000_lock_hierarchy'
import type { MigrateUpArgs } from '@payloadcms/db-postgres'

const payload = await getPayload({ config })
try {
  await up({ payload } as MigrateUpArgs)
  console.log('Module/topic lock relationships repaired. No records or files deleted.')
} finally {
  await payload.destroy()
}
process.exit(0)
