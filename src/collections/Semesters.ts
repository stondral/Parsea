import type { CollectionConfig } from 'payload'

export const Semesters: CollectionConfig = {
  slug: 'semesters',
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
