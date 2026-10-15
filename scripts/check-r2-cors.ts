import 'dotenv/config'
import { getPresignedUploadUrl } from '../src/lib/r2'
const origin = process.argv[2] || 'https://parsealms.vercel.app'
const url = await getPresignedUploadUrl('diagnostics/cors-probe.pdf')
const response = await fetch(url, {
  method: 'OPTIONS',
  headers: {
    Origin: origin,
    'Access-Control-Request-Method': 'PUT',
    'Access-Control-Request-Headers': 'content-type',
  },
  signal: AbortSignal.timeout(15_000),
})
console.log(
  JSON.stringify({
    origin,
    status: response.status,
    allowedOrigin: response.headers.get('access-control-allow-origin'),
    allowedMethods: response.headers.get('access-control-allow-methods'),
    allowedHeaders: response.headers.get('access-control-allow-headers'),
  }),
)
