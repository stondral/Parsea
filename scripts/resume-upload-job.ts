import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { processUploadJob } from '../src/lib/uploadJobs'

const id = process.argv[2]
if (!id || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Pass an upload job UUID.')
const payload = await getPayload({ config })
let status = ''
try {
  let job = await processUploadJob(payload, id)
  for (let step = 1; job.status === 'queued' && step < 200; step++)
    job = await processUploadJob(payload, id)
  status = job.status
  console.log(
    JSON.stringify({ id, status, documentId: job.document_id, stage: job.stage, error: job.error }),
  )
} finally {
  await payload.destroy()
}
process.exit(status === 'ready' ? 0 : 1)
