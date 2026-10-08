import type { PayloadRequest } from 'payload'

/** Used by document deletion and re-ingestion; keep the parent's transaction. */
export async function deleteDocumentDependents({
  id,
  req,
}: {
  id: number | string
  req: PayloadRequest
}): Promise<void> {
  for (const collection of ['chunks', 'document_pages'] as const) {
    // These derived collections have no deletion hooks or uploads. Delete in
    // bulk through the adapter to avoid one lock/preference query per chunk.
    // Parent authorization has already run; keep the same transaction.
    await req.payload.db.deleteMany({
      collection,
      where: { document: { equals: id } },
      req,
    })
  }
}
