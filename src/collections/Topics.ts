import type { CollectionConfig } from 'payload'

export const Topics: CollectionConfig = {
  slug: 'topics',
  access: { read: () => true },
  admin: { useAsTitle: 'name', defaultColumns: ['number', 'name', 'module'] },
  fields: [
    { name: 'number', type: 'text', required: true, admin: { description: 'e.g. 1.1, 1.2' } },
    { name: 'name', type: 'text', required: true, admin: { description: 'e.g. Propositions' } },
    { name: 'module', type: 'relationship', relationTo: 'modules', required: true },
  ],
}
