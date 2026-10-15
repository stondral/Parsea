import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
export const runtime = 'nodejs'
export const maxDuration = 300
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 32)
    return NextResponse.json({ error: 'Scheduler secret is not configured.' }, { status: 503 })
  const supplied = Buffer.from(request.headers.get('authorization') || '')
  const expected = Buffer.from(`Bearer ${secret}`)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const { getAppPayload } = await import('@/lib/payloadAuth')
  const { drainIngestionQueue } = await import('@/lib/ingestionQueue')
  const results = await drainIngestionQueue(await getAppPayload(), 180_000, 1)
  return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
}
