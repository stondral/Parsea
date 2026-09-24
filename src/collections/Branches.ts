import type { CollectionConfig } from 'payload'

export const Branches: CollectionConfig = {
  slug: 'branches',
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
