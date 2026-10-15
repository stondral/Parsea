import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/ingestion/run/route'
const m = vi.hoisted(() => ({ drain: vi.fn(async () => []), payload: {} }))
vi.mock('@/lib/payloadAuth', () => ({ getAppPayload: async () => m.payload }))
vi.mock('@/lib/ingestionQueue', () => ({ drainIngestionQueue: m.drain }))
describe('Protected Vercel queue endpoint', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })
  it('fails closed when the scheduler secret is missing', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(new Request('https://app.test/api/ingestion/run'))).status).toBe(503)
    expect(m.drain).not.toHaveBeenCalled()
  })
  it('rejects an incorrect bearer secret before touching the database', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret'.repeat(4))
    expect(
      (
        await GET(
          new Request('https://app.test/api/ingestion/run', {
            headers: { authorization: 'Bearer wrong' },
          }),
        )
      ).status,
    ).toBe(401)
    expect(m.drain).not.toHaveBeenCalled()
  })
  it('runs one checkpointed batch for an authenticated scheduler', async () => {
    const secret = 'test-secret'.repeat(4)
    vi.stubEnv('CRON_SECRET', secret)
    const response = await GET(
      new Request('https://app.test/api/ingestion/run', {
        headers: { authorization: `Bearer ${secret}` },
      }),
    )
    expect(response.status).toBe(200)
    expect(m.drain).toHaveBeenCalledWith(m.payload, 180_000, 1)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
