import 'dotenv/config'
import { getAppPayload } from '../src/lib/payloadAuth'

// Trusted CLI only; never auto-promote the first signup or expose this publicly.
const email = process.argv[2]?.trim().toLowerCase()
if (!email) throw new Error('Specify the explicitly approved account email.')
const payload = await getAppPayload()
try {
  const result = await payload.find({ collection: 'users', depth: 0, limit: 2, where: { email: { equals: email } } })
  if (result.docs.length !== 1) throw new Error('Expected exactly one existing account. No account was created or changed.')
  const user = await payload.update({ collection: 'users', id: result.docs[0].id, data: { role: 'admin' } })
  console.log(JSON.stringify({ account: user.email, role: user.role, id: user.id }))
} finally {
  await payload.db.destroy?.()
}
process.exit(0)
