import type { CollectionConfig } from 'payload'
import { invalidateCatalog } from '@/hooks/invalidateCatalog'

export const Subjects: CollectionConfig = {
  slug: 'subjects',
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
      name: 'code',
      type: 'text',
    },
    {
      name: 'semester',
      type: 'relationship',
      relationTo: 'semesters',
      required: true,
    },
  ],
}
