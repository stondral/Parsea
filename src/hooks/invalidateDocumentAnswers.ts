import { invalidateCachePrefix } from '@/lib/redis'

/** Cached answers may cite this document even after its chunks are removed. */
export async function invalidateDocumentAnswers(): Promise<void> {
  await invalidateCachePrefix('rag:v3:')
  await invalidateCachePrefix('rag:v2:')
}
