import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { deleteDocumentDependents } from '@/hooks/deleteDocumentDependents'
import { invalidateDocumentAnswers } from '@/hooks/invalidateDocumentAnswers'

const cache = vi.hoisted(() => ({ invalidateCachePrefix: vi.fn() }))
vi.mock('@/lib/redis', () => cache)

describe('document deletion', () => {
  const remove = vi.fn()
  const req = {
    payload: { db: { deleteMany: remove } },
    transactionID: 'parent-transaction',
  } as unknown as PayloadRequest
  beforeEach(() => {
    vi.clearAllMocks()
    remove.mockReset().mockResolvedValue(undefined)
    cache.invalidateCachePrefix.mockResolvedValue(undefined)
  })

  it('removes only the selected document’s chunks and pages in the parent request', async () => {
    await deleteDocumentDependents({ id: 2, req })
    expect(remove).toHaveBeenCalledTimes(2)
    for (const [index, collection] of ['chunks', 'document_pages'].entries()) {
      expect(remove.mock.calls[index][0]).toEqual({
        collection,
        where: { document: { equals: 2 } },
        req,
      })
      expect(remove.mock.calls[index][0].req).toBe(req)
    }
  })

  it('propagates database failures to the parent transaction', async () => {
    remove.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(deleteDocumentDependents({ id: 2, req })).rejects.toThrow('Database unavailable')
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('registers cleanup before parent deletion, retaining normal access controls', async () => {
    const { Documents } = await import('@/collections/Documents')
    expect(Documents.hooks?.beforeDelete).toContain(deleteDocumentDependents)
    expect(Documents.hooks?.afterDelete).toContain(invalidateDocumentAnswers)
    const { adminOnly } = await import('@/access/admin')
    expect(Documents.access?.delete).toBe(adminOnly)
  })

  it('invalidates current and legacy answer caches so removed sources are not cached', async () => {
    await invalidateDocumentAnswers()
    expect(cache.invalidateCachePrefix.mock.calls).toEqual([['rag:v3:'], ['rag:v2:']])
  })
})
