import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { drainIngestionQueue } from '../src/lib/ingestionQueue'

// Bounded operator command; Vercel's protected endpoint uses the same queue drain.
const payload = await getPayload({ config })
try {
  console.log(JSON.stringify(await drainIngestionQueue(payload)))
} finally {
  await payload.destroy()
}
process.exit(0)
