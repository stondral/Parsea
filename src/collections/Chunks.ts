import type { CollectionConfig } from 'payload'

export const Chunks: CollectionConfig = {
  slug: 'chunks',
  access: {
    read: () => true,
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
      required: true,
    },
    {
      name: 'chapter',
      type: 'text',
    },
    {
      name: 'subjectName',
      type: 'text',
    },
    {
      name: 'semester',
      type: 'number',
    },
    {
      name: 'branch',
      type: 'text',
    },
    {
      name: 'hasImage',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      name: 'imageUrl',
      type: 'text',
    },
    {
      name: 'imageCaption',
      type: 'text',
    },
  ],
}
