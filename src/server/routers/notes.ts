import { z } from 'zod'
import { getPayload, type Payload } from 'payload'
import { router, publicProcedure } from '../trpc'
import config from '@/payload.config'
import { getOrSetCache, hashKey } from '@/lib/redis'

export interface NoteItem {
  id: string | number
  name: string
  chapter?: string
  type: 'Notes' | 'PYQs' | 'Assignments'
  filename?: string
  filesize?: number
  storageKey?: string
  subjectId?: string | number
  subjectName: string
  semesterNumber?: number | null
  branchName?: string
  createdAt: string
}

type NotesInput = {
  subject?: string
  type?: 'Notes' | 'PYQs' | 'Assignments'
  search?: string
  branch?: string
  semester?: number
}

type SubjectsInput = {
  branch?: string
  semester?: number
}

let payloadPromise: Promise<Payload> | null = null

async function getAppPayload() {
  if (!payloadPromise) {
    payloadPromise = config.then((payloadConfig) => getPayload({ config: payloadConfig }))
  }

  return payloadPromise
}

export const notesRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          subject: z.string().optional(),
          type: z.enum(['Notes', 'PYQs', 'Assignments']).optional(),
          search: z.string().optional(),
          branch: z.string().optional(),
          semester: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const cacheKey = hashKey('parsea:notes:list', JSON.stringify(input ?? {}))
      const result = await getOrSetCache(
        cacheKey,
        async () => {
          const payload = await getAppPayload()
          const whereClause: any = {}

          if (input?.type) {
            whereClause.type = { equals: input.type }
          }

          if (input?.search && input.search.trim()) {
            const query = input.search.trim()
            whereClause.or = [
              { name: { like: query } },
              { chapter: { like: query } },
            ]
          }

          const res = await payload.find({
            collection: 'documents',
            depth: 2,
            limit: 100,
            sort: '-createdAt',
            where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
          })

          let docs = res.docs

          if (input?.subject && input.subject.trim()) {
            const sub = input.subject.trim().toLowerCase()
            docs = docs.filter((d: any) => {
              const sName = typeof d.subject === 'object' ? d.subject?.name : ''
              return sName && sName.toLowerCase().includes(sub)
            })
          }

          if (input?.semester) {
            docs = docs.filter((d: any) => {
              const sem =
                typeof d.subject === 'object' && typeof d.subject?.semester === 'object'
                  ? d.subject?.semester?.number
                  : null
              return sem === input.semester
            })
          }

          if (input?.branch && input.branch.trim()) {
            const branch = input.branch.trim().toLowerCase()
            docs = docs.filter((d: any) => {
              const branchName =
                typeof d.subject === 'object' &&
                typeof d.subject?.semester === 'object' &&
                typeof d.subject?.semester?.branch === 'object'
                  ? d.subject?.semester?.branch?.name
                  : ''
              return branchName && branchName.toLowerCase().includes(branch)
            })
          }

          return docs.map((d: any): NoteItem => ({
            id: d.id,
            name: d.name,
            chapter: d.chapter || '',
            type: d.type || 'Notes',
            filename: d.filename,
            filesize: d.filesize,
            storageKey: d.storageKey,
            subjectId: typeof d.subject === 'object' ? d.subject?.id : d.subject,
            subjectName: typeof d.subject === 'object' ? d.subject?.name : 'General Studies',
            semesterNumber:
              typeof d.subject === 'object' && typeof d.subject?.semester === 'object'
                ? d.subject?.semester?.number
                : null,
            branchName:
              typeof d.subject === 'object' &&
              typeof d.subject?.semester === 'object' &&
              typeof d.subject?.semester?.branch === 'object'
                ? d.subject?.semester?.branch?.name
                : '',
            createdAt: d.createdAt,
          }))
        },
        30,
      )

      return result.data
    }),

  getSubjects: publicProcedure
    .input(
      z
        .object({
          branch: z.string().optional(),
          semester: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const cacheKey = hashKey('parsea:notes:subjects', JSON.stringify(input ?? {}))
      const result = await getOrSetCache(
        cacheKey,
        async () => {
          const payload = await getAppPayload()
          const res = await payload.find({
            collection: 'subjects',
            depth: 1,
            limit: 100,
            sort: 'name',
            select: {
              name: true,
              code: true,
              semester: true,
            },
          })

          let subs = res.docs

          if (input?.semester) {
            subs = subs.filter((s: any) => {
              const sem = typeof s.semester === 'object' ? s.semester?.number : null
              return sem === input.semester
            })
          }

          return subs.map((s: any) => ({
            id: s.id,
            name: s.name,
            code: s.code || '',
            semesterNumber: typeof s.semester === 'object' ? s.semester?.number : null,
            branchName:
              typeof s.semester === 'object' && typeof s.semester?.branch === 'object'
                ? s.semester?.branch?.name
                : '',
          }))
        },
        60 * 60,
      )

      return result.data
    }),

  getStats: publicProcedure.query(async () => {
    const result = await getOrSetCache(
      'parsea:notes:stats',
      async () => {
        const payload = await getAppPayload()
        const [docsRes, subsRes] = await Promise.all([
          payload.find({ collection: 'documents', limit: 1 }),
          payload.find({ collection: 'subjects', limit: 1 }),
        ])

        return {
          totalDocuments: docsRes.totalDocs,
          totalSubjects: subsRes.totalDocs,
        }
      },
      30,
    )

    return result.data
  }),
})
