import type { CollectionBeforeDeleteHook } from 'payload'
import { APIError } from 'payload'
import { curriculum, type CurriculumCollection } from '@/lib/adminCatalog'

/** Shared by both admin UIs: never silently orphan a curriculum folder. */
export const requireEmptyCurriculum: CollectionBeforeDeleteHook = async ({
  id,
  req,
  collection,
}) => {
  const slug = collection.slug as CurriculumCollection
  for (const [child, definition] of Object.entries(curriculum)) {
    if (definition.parent !== slug || !definition.field) continue
    const { totalDocs } = await req.payload.count({
      collection: child as CurriculumCollection,
      where: { [definition.field]: { equals: id } },
      req,
    })
    if (totalDocs) throw new APIError(`Remove the ${child} in this folder first.`, 409)
  }
  const documentField = { subjects: 'subject', modules: 'module', topics: 'topic' }[
    slug as 'subjects' | 'modules' | 'topics'
  ]
  if (documentField) {
    const { totalDocs } = await req.payload.count({
      collection: 'documents',
      where: { [documentField]: { equals: id } },
      req,
    })
    if (totalDocs) throw new APIError('Remove or move the PDFs in this folder first.', 409)
  }
}
