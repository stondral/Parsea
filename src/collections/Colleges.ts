import type { CollectionConfig } from 'payload'

export const Colleges: CollectionConfig = {
  slug: 'colleges',
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
