import type { CollectionConfig } from 'payload'
import { invalidateCatalog } from '@/hooks/invalidateCatalog'
import { adminOnly } from '@/access/admin'
import { requireEmptyCurriculum } from '@/hooks/requireEmptyCurriculum'
import { syncDocumentMetadata } from '@/hooks/syncDocumentMetadata'
import { invalidateDocumentAnswers } from '@/hooks/invalidateDocumentAnswers'

export const Topics: CollectionConfig = {
  slug: 'topics',
  hooks: { beforeDelete: [requireEmptyCurriculum], afterChange: [syncDocumentMetadata, invalidateCatalog, invalidateDocumentAnswers], afterDelete: [invalidateCatalog] },
  access: { read: () => true, create: adminOnly, update: adminOnly, delete: adminOnly },
  admin: { useAsTitle: 'name', defaultColumns: ['number', 'name', 'module'] },
  fields: [
    { name: 'number', type: 'text', required: true, admin: { description: 'e.g. 1.1, 1.2' } },
    { name: 'name', type: 'text', required: true, admin: { description: 'e.g. Propositions' } },
    { name: 'module', type: 'relationship', relationTo: 'modules', required: true },
  ],
}
