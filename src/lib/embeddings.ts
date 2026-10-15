import path from 'node:path'
import os from 'node:os'
import { getOrSetCache, hashKey } from './redis'

export const EMBEDDING_MODEL = 'minilm-l6-v2-q8-v1'
export const EMBEDDING_DIMENSIONS = 384
type Extractor = Awaited<
  ReturnType<typeof import('@huggingface/transformers').pipeline<'feature-extraction'>>
>
let extractor: Promise<Extractor> | undefined

function getExtractor() {
  if (!extractor) {
    extractor = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.cacheDir = path.join(
        process.env.VERCEL ? os.tmpdir() : process.cwd(),
        '.cache',
        'embeddings',
      )
      return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        device: 'cpu',
        dtype: 'q8',
      })
    })().catch((error) => {
      extractor = undefined
      throw error
    })
  }
  return extractor
}

/** The ONLY embedding path for both ingestion and queries. Never substitute hashes. */
export async function getEmbedding(text: string): Promise<number[]> {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) throw new Error('Cannot embed empty text.')
  const result = await getOrSetCache(
    hashKey(`emb:${EMBEDDING_MODEL}`, clean),
    async () => {
      const model = await getExtractor()
      const output = await model(clean, { pooling: 'mean', normalize: true })
      const vector = Array.from(output.data, Number)
      if (vector.length !== EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value)))
        throw new Error('Embedding model returned an invalid vector.')
      return vector
    },
    604800,
  )
  return result.data
}
