import type { CollectionConfig } from 'payload'
import { invalidateCatalog } from '@/hooks/invalidateCatalog'

export const Branches: CollectionConfig = {
  slug: 'branches',
  hooks: { afterChange: [invalidateCatalog], afterDelete: [invalidateCatalog] },
  access: {
    read: () => true,
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
