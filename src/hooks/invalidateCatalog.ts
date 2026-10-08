import { invalidateCachePrefix } from '@/lib/redis'

/** Shared metadata invalidation hook; no ingestion work or duplicate cache layer. */
export async function invalidateCatalog() {
  await invalidateCachePrefix('parsea:notes:')
}
