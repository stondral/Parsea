import type { CollectionConfig } from 'payload'
import { invalidateCatalog } from '@/hooks/invalidateCatalog'

export const Semesters: CollectionConfig = {
  slug: 'semesters',
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
