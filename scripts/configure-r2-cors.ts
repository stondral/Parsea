import 'dotenv/config'
import { GetBucketCorsCommand, PutBucketCorsCommand, type CORSRule } from '@aws-sdk/client-s3'
import { r2Client, R2_BUCKET } from '../src/lib/r2'
import { readFile } from 'node:fs/promises'

// Explicit operator maintenance. Preserve all existing rules on this shared
// bucket; add only the reviewed application origins from the checked-in policy.
const additions = JSON.parse(
  await readFile(new URL('../docs/r2-cors.json', import.meta.url), 'utf8'),
)
let existing: CORSRule[] = []
try {
  const current = await r2Client.send(new GetBucketCorsCommand({ Bucket: R2_BUCKET }))
  existing = current.CORSRules || []
} catch (error) {
  if (!(error instanceof Error) || error.name !== 'NoSuchCORSConfiguration') throw error
}
const rules = [...existing]
for (const rule of additions) {
  if (!rules.some((entry) => JSON.stringify(entry) === JSON.stringify(rule))) rules.push(rule)
}
await r2Client.send(
  new PutBucketCorsCommand({ Bucket: R2_BUCKET, CORSConfiguration: { CORSRules: rules } }),
)
const verified = await r2Client.send(new GetBucketCorsCommand({ Bucket: R2_BUCKET }))
console.log(
  JSON.stringify({
    bucket: R2_BUCKET,
    preservedRules: existing.length,
    configuredRules: verified.CORSRules?.length,
  }),
)
