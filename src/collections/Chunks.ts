import type { CollectionConfig } from 'payload'

export const Chunks: CollectionConfig = {
  slug: 'chunks',
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
    // For now embedding is omitted, we will add it when we set up pgvector with Drizzle.
  ],
}
