import type { CollectionConfig } from 'payload'

export const DocumentPages: CollectionConfig = {
  slug: 'document_pages',
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
  ],
}
