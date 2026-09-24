import type { CollectionConfig } from 'payload'

export const Subjects: CollectionConfig = {
  slug: 'subjects',
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
