import Redis from 'ioredis'
import crypto from 'crypto'

// In-memory fallback cache for development or when Redis is unreachable
interface CacheEntry {
  value: string
  expiry: number
}
const memoryCache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<{ data: unknown; cached: boolean }>>()
let cacheRevision = 0
let redisUnavailableUntil = 0
const REDIS_DEADLINE_MS = 600

async function redisOperation<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Redis timeout')), REDIS_DEADLINE_MS)
      }),
    ])
  } catch (error) {
    redisUnavailableUntil = Date.now() + 30_000
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function remember(key: string, value: string, ttlSeconds: number) {
  if (memoryCache.size >= 1000) {
    for (const [entryKey, entry] of memoryCache)
      if (entry.expiry <= Date.now()) memoryCache.delete(entryKey)
    if (memoryCache.size >= 1000) memoryCache.delete(memoryCache.keys().next().value!)
  }
  // A short L1 mirror avoids Redis round trips without hiding cross-instance edits for long.
  const ttl = process.env.REDIS_URL ? Math.min(ttlSeconds, 5) : ttlSeconds
  memoryCache.set(key, { value, expiry: Date.now() + ttl * 1000 })
}

let redisClient: Redis | null = null

function getRedis(): Redis | null {
  if (Date.now() < redisUnavailableUntil) return null
  if (redisClient?.status === 'end') {
    redisClient.disconnect()
    redisClient = null
  }
  if (redisClient) return redisClient

  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    return null
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 0,
      connectTimeout: 600,
      commandTimeout: 600,
      lazyConnect: false,
      retryStrategy: () => null, // don't infinite retry if server is offline
    })

    redisClient.on('error', (err) => {
      console.warn('[Redis] Connection warning (using in-memory fallback):', err.message)
    })

    return redisClient
  } catch (err: any) {
    console.warn('[Redis] Initialization error, using in-memory cache:', err.message)
    return null
  }
}

/**
 * Generate a deterministic sha256 hash for cache keys
 */
export function hashKey(prefix: string, content: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(content.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16)
  return `${prefix}:${hash}`
}

/**
 * Retrieve an item from Redis or memory fallback
 */
export async function getCache<T>(key: string): Promise<T | null> {
  const local = memoryCache.get(key)
  if (local && Date.now() < local.expiry) return JSON.parse(local.value) as T
  if (local) memoryCache.delete(key)
  const redis = getRedis()
  if (redis) {
    try {
      const data = await redisOperation(redis.get(key))
      if (data) {
        const parsed = JSON.parse(data) as T
        remember(key, data, 5)
        return parsed
      }
    } catch {
      // Fallback to memory
    }
  }

  const item = memoryCache.get(key)
  if (!item) return null

  if (Date.now() > item.expiry) {
    memoryCache.delete(key)
    return null
  }

  return JSON.parse(item.value) as T
}

/**
 * Store an item in Redis or memory fallback with TTL
 */
export async function setCache(key: string, value: any, ttlSeconds: number = 3600): Promise<void> {
  const jsonStr = JSON.stringify(value)
  remember(key, jsonStr, ttlSeconds)

  const redis = getRedis()
  if (redis) {
    try {
      await redisOperation(redis.set(key, jsonStr, 'EX', ttlSeconds))
      return
    } catch {
      // Fallback to memory
    }
  }
}

/**
 * Lightspeed get-or-set helper
 */
export async function getOrSetCache<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number = 3600,
): Promise<{ data: T; cached: boolean }> {
  const pending = inFlight.get(key)
  if (pending) return pending as Promise<{ data: T; cached: boolean }>
  const revision = cacheRevision
  const task = (async () => {
    const cached = await getCache<T>(key)
    if (cached !== null) return { data: cached, cached: true }
    const fresh = await fetchFn()
    if (revision === cacheRevision) await setCache(key, fresh, ttlSeconds)
    return { data: fresh, cached: false }
  })()
  inFlight.set(key, task)
  try {
    return await task
  } finally {
    if (inFlight.get(key) === task) inFlight.delete(key)
  }
}

/** Invalidate only a known application namespace, never flush shared Redis. */
export async function invalidateCachePrefix(prefix: string): Promise<void> {
  cacheRevision++
  for (const key of memoryCache.keys()) if (key.startsWith(prefix)) memoryCache.delete(key)
  for (const key of inFlight.keys()) if (key.startsWith(prefix)) inFlight.delete(key)
  const redis = getRedis()
  if (!redis) return
  try {
    let cursor = '0'
    do {
      const [next, keys] = await redisOperation(
        redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200),
      )
      cursor = next
      if (keys.length) await redisOperation(redis.del(...keys))
    } while (cursor !== '0')
  } catch {
    /* Catalog TTLs remain the fallback if Redis is unavailable. */
  }
}
