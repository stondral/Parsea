import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  pipeline: vi.fn(),
  model: vi.fn(),
  cache: vi.fn(),
  env: { cacheDir: '' },
}))
vi.mock('@huggingface/transformers', () => ({ pipeline: m.pipeline, env: m.env }))
vi.mock('@/lib/redis', () => ({
  hashKey: (prefix: string, text: string) => `${prefix}:${text}`,
  getOrSetCache: m.cache,
}))
describe('Versioned semantic embedding contract', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    m.pipeline.mockResolvedValue(m.model)
    m.model.mockResolvedValue({ data: new Float32Array(384).fill(0.05) })
    m.cache.mockImplementation(async (_key, compute) => ({ data: await compute(), cached: false }))
  })
  it('uses one real, normalized MiniLM pipeline for ingestion and queries', async () => {
    const { getEmbedding, EMBEDDING_MODEL } = await import('@/lib/embeddings')
    expect((await getEmbedding('  truth\n tables ')).length).toBe(384)
    await getEmbedding('another query')
    expect(m.pipeline).toHaveBeenCalledTimes(1)
    expect(m.pipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      device: 'cpu',
      dtype: 'q8',
    })
    expect(m.model).toHaveBeenCalledWith('truth tables', { pooling: 'mean', normalize: true })
    expect(m.cache.mock.calls[0][0]).toContain(EMBEDDING_MODEL)
  })
  it('rejects empty input and invalid vectors instead of substituting hashes', async () => {
    const { getEmbedding } = await import('@/lib/embeddings')
    await expect(getEmbedding(' ')).rejects.toThrow('empty text')
    m.model.mockResolvedValueOnce({ data: [1, 2] })
    await expect(getEmbedding('logic')).rejects.toThrow('invalid vector')
  })
  it('retries initialization after a model-loading failure', async () => {
    const { getEmbedding } = await import('@/lib/embeddings')
    m.pipeline.mockRejectedValueOnce(new Error('Network unavailable'))
    await expect(getEmbedding('logic')).rejects.toThrow('Network unavailable')
    expect((await getEmbedding('logic')).length).toBe(384)
    expect(m.pipeline).toHaveBeenCalledTimes(2)
  })
})
