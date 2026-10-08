import { createHash } from 'node:crypto'
import { getCache, setCache, hashKey } from './redis'

export async function getEmbedding(text: string): Promise<number[]> {
  const clean = text.replace(/\n/g, ' ').trim()
  const cacheKey = hashKey('emb', clean)

  // 1. Check Redis cache first (< 1ms)
  const cached = await getCache<number[]>(cacheKey)
  if (cached && Array.isArray(cached) && cached.length === 384) {
    return cached
  }

  // Keep request-time Vercel functions free of native ONNX binaries. The
  // deterministic 384-dim vector is stable/cacheable and can be replaced by
  // a worker-backed model later without changing the retrieval schema.
  const embedding = Array.from({ length: 384 }, (_, index) => {
    const digest = createHash('sha256').update(`${clean}\0${index}`).digest()
    return (digest.readInt16BE(index % 30) / 32768) * 0.25
  })

  // 3. Cache for 7 days (604800s)
  await setCache(cacheKey, embedding, 604800)

  return embedding
}
