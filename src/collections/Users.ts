import type { CollectionConfig } from 'payload'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['name', 'email', 'semester', 'phoneNumber', 'createdAt'],
  },
  auth: true,
  fields: [
    {
      name: 'name',
      type: 'text',
    },
    {
      name: 'phoneNumber',
      type: 'text',
      admin: {
        description: 'Optional phone number for account recovery and study groups.',
      },
    },
    {
      name: 'semester',
      type: 'number',
      min: 1,
      max: 8,
    },
  ],
}
