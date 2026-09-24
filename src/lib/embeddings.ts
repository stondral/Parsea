import { getCache, setCache, hashKey } from './redis'

let pipelinePromise: Promise<any> | null = null

export async function getEmbedding(text: string): Promise<number[]> {
  const clean = text.replace(/\n/g, ' ').trim()
  const cacheKey = hashKey('emb', clean)

  // 1. Check Redis cache first (< 1ms)
  const cached = await getCache<number[]>(cacheKey)
  if (cached && Array.isArray(cached) && cached.length === 384) {
    return cached
  }

  // 2. Compute via Xenova transformer pipeline
  if (!pipelinePromise) {
    const { pipeline } = await import('@xenova/transformers')
    pipelinePromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
  }

  const pipe = await pipelinePromise
  const output = await pipe(clean, { pooling: 'mean', normalize: true })
  const embedding = Array.from(output.data) as number[]

  // 3. Cache for 7 days (604800s)
  await setCache(cacheKey, embedding, 604800)

  return embedding
}
