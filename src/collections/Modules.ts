import type { CollectionConfig } from 'payload'
import { invalidateCatalog } from '@/hooks/invalidateCatalog'
import { adminOnly } from '@/access/admin'
import { requireEmptyCurriculum } from '@/hooks/requireEmptyCurriculum'
import { syncDocumentMetadata } from '@/hooks/syncDocumentMetadata'
import { invalidateDocumentAnswers } from '@/hooks/invalidateDocumentAnswers'

export const Modules: CollectionConfig = {
  slug: 'modules',
  hooks: { beforeDelete: [requireEmptyCurriculum], afterChange: [syncDocumentMetadata, invalidateCatalog, invalidateDocumentAnswers], afterDelete: [invalidateCatalog] },
  access: { read: () => true, create: adminOnly, update: adminOnly, delete: adminOnly },
  admin: { useAsTitle: 'name', defaultColumns: ['number', 'name', 'subject'] },
  fields: [
    { name: 'number', type: 'text', required: true, admin: { description: 'e.g. 1, 2, 5' } },
    { name: 'name', type: 'text', required: true, admin: { description: 'e.g. Logic' } },
    { name: 'subject', type: 'relationship', relationTo: 'subjects', required: true },
  ],
}
