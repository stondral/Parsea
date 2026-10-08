import type { CollectionConfig } from 'payload'

export const Modules: CollectionConfig = {
  slug: 'modules',
  access: { read: () => true },
  admin: { useAsTitle: 'name', defaultColumns: ['number', 'name', 'subject'] },
  fields: [
    { name: 'number', type: 'text', required: true, admin: { description: 'e.g. 1, 2, 5' } },
    { name: 'name', type: 'text', required: true, admin: { description: 'e.g. Logic' } },
    { name: 'subject', type: 'relationship', relationTo: 'subjects', required: true },
  ],
}
