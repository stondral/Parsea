import Redis from 'ioredis'
import crypto from 'crypto'

// In-memory fallback cache for development or when Redis is unreachable
interface CacheEntry {
  value: string
  expiry: number
}
const memoryCache = new Map<string, CacheEntry>()

let redisClient: Redis | null = null

function getRedis(): Redis | null {
  if (redisClient) return redisClient

  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    return null
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
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
  const hash = crypto.createHash('sha256').update(content.trim().toLowerCase()).digest('hex').slice(0, 16)
  return `${prefix}:${hash}`
}

/**
 * Retrieve an item from Redis or memory fallback
 */
export async function getCache<T>(key: string): Promise<T | null> {
  const redis = getRedis()
  if (redis) {
    try {
      const data = await redis.get(key)
      if (data) return JSON.parse(data) as T
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

  const redis = getRedis()
  if (redis) {
    try {
      await redis.set(key, jsonStr, 'EX', ttlSeconds)
      return
    } catch {
      // Fallback to memory
    }
  }

  memoryCache.set(key, {
    value: jsonStr,
    expiry: Date.now() + ttlSeconds * 1000,
  })
}

/**
 * Lightspeed get-or-set helper
 */
export async function getOrSetCache<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number = 3600
): Promise<{ data: T; cached: boolean }> {
  const cached = await getCache<T>(key)
  if (cached !== null) {
    return { data: cached, cached: true }
  }

  const fresh = await fetchFn()
  await setCache(key, fresh, ttlSeconds)
  return { data: fresh, cached: false }
}
