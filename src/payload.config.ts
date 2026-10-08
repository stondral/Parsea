import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Colleges } from './collections/Colleges'
import { Branches } from './collections/Branches'
import { Semesters } from './collections/Semesters'
import { Subjects } from './collections/Subjects'
import { Modules } from './collections/Modules'
import { Topics } from './collections/Topics'
import { Documents } from './collections/Documents'
import { DocumentPages } from './collections/DocumentPages'
import { Chunks } from './collections/Chunks'
import { Conversations } from './collections/Conversations'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media, Colleges, Branches, Semesters, Subjects, Modules, Topics, Documents, DocumentPages, Chunks, Conversations],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
    push: false,
  }),
  sharp,
  plugins: [],
})
