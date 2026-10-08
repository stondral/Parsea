import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const redis = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  scan: vi.fn(),
  del: vi.fn(),
  on: vi.fn(),
  disconnect: vi.fn(),
}))
vi.mock('ioredis', () => ({
  default: class {
    get = redis.get
    set = redis.set
    scan = redis.scan
    del = redis.del
    on = redis.on
    disconnect = redis.disconnect
    status = 'ready'
  },
}))

describe('central cache performance', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('REDIS_URL', '')
    vi.clearAllMocks()
    redis.get.mockResolvedValue(null)
    redis.set.mockResolvedValue('OK')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('coalesces concurrent cold requests into a single computation', async () => {
    const { getOrSetCache } = await import('@/lib/redis')
    const compute = vi.fn(async () => {
      await Promise.resolve()
      return ['Math']
    })
    const results = await Promise.all(
      Array.from({ length: 8 }, () => getOrSetCache('parsea:notes:subjects:test', compute, 60)),
    )
    expect(compute).toHaveBeenCalledTimes(1)
    expect(results.every((result) => result.data[0] === 'Math')).toBe(true)
    expect((await getOrSetCache('parsea:notes:subjects:test', compute, 60)).cached).toBe(true)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('bounds a hung Redis command and skips it during the circuit-breaker cooldown', async () => {
    vi.useFakeTimers()
    vi.stubEnv('REDIS_URL', 'redis://test')
    redis.get.mockImplementation(() => new Promise(() => {}))
    const { getOrSetCache } = await import('@/lib/redis')
    const first = getOrSetCache('parsea:notes:a', async () => 1)
    await vi.advanceTimersByTimeAsync(601)
    expect((await first).data).toBe(1)
    expect((await getOrSetCache('parsea:notes:b', async () => 2)).data).toBe(2)
    expect(redis.get).toHaveBeenCalledTimes(1)
  })

  it('does not retain a failed computation or republish invalidated in-flight data', async () => {
    const { getOrSetCache, getCache, invalidateCachePrefix } = await import('@/lib/redis')
    await expect(
      getOrSetCache('parsea:notes:failed', async () => {
        throw new Error('offline')
      }),
    ).rejects.toThrow('offline')
    expect((await getOrSetCache('parsea:notes:failed', async () => 3)).data).toBe(3)
    let resolve!: (value: number) => void
    const pending = getOrSetCache(
      'parsea:notes:pending',
      () =>
        new Promise<number>((done) => {
          resolve = done
        }),
    )
    await Promise.resolve()
    await Promise.resolve()
    await invalidateCachePrefix('parsea:notes:')
    resolve(4)
    await pending
    expect(await getCache('parsea:notes:pending')).toBeNull()
    expect(await getCache('parsea:notes:failed')).toBeNull()
  })
})
