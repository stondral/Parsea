import type { CollectionConfig } from 'payload'
import { invalidateCatalog } from '@/hooks/invalidateCatalog'
import { adminOnly } from '@/access/admin'
import { requireEmptyCurriculum } from '@/hooks/requireEmptyCurriculum'
import { syncDocumentMetadata } from '@/hooks/syncDocumentMetadata'
import { invalidateDocumentAnswers } from '@/hooks/invalidateDocumentAnswers'

export const Branches: CollectionConfig = {
  slug: 'branches',
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
      name: 'college',
      type: 'relationship',
      relationTo: 'colleges',
      required: true,
    },
  ],
}
