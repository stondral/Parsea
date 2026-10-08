import type { CollectionConfig } from 'payload'
import { invalidateCatalog } from '@/hooks/invalidateCatalog'
import { adminOnly } from '@/access/admin'
import { requireEmptyCurriculum } from '@/hooks/requireEmptyCurriculum'
import { syncDocumentMetadata } from '@/hooks/syncDocumentMetadata'
import { invalidateDocumentAnswers } from '@/hooks/invalidateDocumentAnswers'

export const Semesters: CollectionConfig = {
  slug: 'semesters',
  hooks: { beforeDelete: [requireEmptyCurriculum], afterChange: [syncDocumentMetadata, invalidateCatalog, invalidateDocumentAnswers], afterDelete: [invalidateCatalog] },
  access: {
    read: () => true,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'name',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'number',
      type: 'number',
      required: true,
    },
    {
      name: 'branch',
      type: 'relationship',
      relationTo: 'branches',
      required: true,
    },
  ],
}
