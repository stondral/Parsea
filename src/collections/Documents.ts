import type { CollectionConfig } from 'payload'
import { processDocument } from '../hooks/processDocument'

export const Documents: CollectionConfig = {
  slug: 'documents',
  access: {
    read: () => true,
    create: () => true,
  },
  admin: {
    useAsTitle: 'name',
  },
  upload: {
    staticDir: 'media/documents',
    mimeTypes: ['application/pdf'],
  },
  hooks: {
    afterChange: [processDocument],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'chapter',
      type: 'text',
      admin: {
        description: 'e.g. Unit 3, Linked Lists, Normalization',
      },
    },
    {
      name: 'type',
      type: 'select',
      options: ['Notes', 'PYQs', 'Assignments'],
      required: true,
    },
    {
      name: 'subject',
      type: 'relationship',
      relationTo: 'subjects',
      required: true,
    },
    {
      name: 'module',
      type: 'relationship',
      relationTo: 'modules',
      admin: {
        description: 'Optional. Organizes many PDFs under a subject module.',
      },
    },
    {
      name: 'topic',
      type: 'relationship',
      relationTo: 'topics',
      admin: {
        description: 'Optional. A finer section such as 1.1 or 1.2.',
      },
    },
    {
      name: 'storageKey',
      type: 'text',
      admin: {
        description: 'Cloudflare R2 object key path, e.g. documents/comps/sem3/math/module-1.pdf',
      },
    },
    {
      name: 'r2Bucket',
      type: 'text',
      admin: {
        description: 'Cloudflare R2 bucket name',
      },
    },
  ],
}
