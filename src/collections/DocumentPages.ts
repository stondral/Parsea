import type { CollectionConfig } from 'payload'
import { adminOnly } from '@/access/admin'

export const DocumentPages: CollectionConfig = {
  slug: 'document_pages',
  access: {
    read: () => true,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: 'document',
      type: 'relationship',
      relationTo: 'documents',
      required: true,
    },
    {
      name: 'pageNumber',
      type: 'number',
      required: true,
    },
    {
      name: 'text',
      type: 'textarea',
    },
    {
      name: 'orientationRotation',
      type: 'number',
      defaultValue: 0,
      validate: (value: number | null | undefined) =>
        [0, 90, 180, 270].includes(value ?? 0) || 'Use a quarter-turn rotation.',
    },
    { name: 'orientationConfidence', type: 'number', defaultValue: 0, min: 0, max: 100 },
    { name: 'orientationVerified', type: 'checkbox', defaultValue: false },
    { name: 'orientationVersion', type: 'number', defaultValue: 0 },
    { name: 'previewKey', type: 'text' },
  ],
}
