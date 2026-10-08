import type { CollectionConfig } from 'payload'
import { adminOnly } from '@/access/admin'
import { requireEmptyCurriculum } from '@/hooks/requireEmptyCurriculum'
import { invalidateCatalog } from '@/hooks/invalidateCatalog'

export const Colleges: CollectionConfig = {
  slug: 'colleges',
  hooks: { beforeDelete: [requireEmptyCurriculum], afterChange: [invalidateCatalog], afterDelete: [invalidateCatalog] },
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
  ],
}
