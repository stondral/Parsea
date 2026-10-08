import type { CollectionConfig } from 'payload'
import { invalidateCatalog } from '@/hooks/invalidateCatalog'

export const Topics: CollectionConfig = {
  slug: 'topics',
  hooks: { afterChange: [invalidateCatalog], afterDelete: [invalidateCatalog] },
  access: { read: () => true },
  admin: { useAsTitle: 'name', defaultColumns: ['number', 'name', 'module'] },
  fields: [
    { name: 'number', type: 'text', required: true, admin: { description: 'e.g. 1.1, 1.2' } },
    { name: 'name', type: 'text', required: true, admin: { description: 'e.g. Propositions' } },
    { name: 'module', type: 'relationship', relationTo: 'modules', required: true },
  ],
}
