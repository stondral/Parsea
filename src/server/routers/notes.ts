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
  moduleId?: string | number
  moduleName?: string
  moduleNumber?: string
  topicId?: string | number
  topicName?: string
  topicNumber?: string
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

// Eagerly kick off Payload initialisation at module load time so the first
// tRPC request doesn't pay the cold-start penalty (was causing ~50 s delays).
let payloadPromise: Promise<Payload> = config.then((payloadConfig) =>
  getPayload({ config: payloadConfig })
)

function getAppPayload() {
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
            depth: 3,
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

          const notes = docs.map((d: any): NoteItem => ({
            id: d.id,
            name: d.name,
            chapter: d.chapter || '',
            type: d.type || 'Notes',
            filename: d.filename,
            filesize: d.filesize,
            storageKey: d.storageKey,
            subjectId: typeof d.subject === 'object' ? d.subject?.id : d.subject,
            subjectName: typeof d.subject === 'object' ? d.subject?.name : 'General Studies',
            moduleId: typeof d.module === 'object' ? d.module?.id : d.module,
            moduleName: typeof d.module === 'object' ? d.module?.name : '',
            moduleNumber: typeof d.module === 'object' ? d.module?.number : '',
            topicId: typeof d.topic === 'object' ? d.topic?.id : d.topic,
            topicName: typeof d.topic === 'object' ? d.topic?.name : '',
            topicNumber: typeof d.topic === 'object' ? d.topic?.number : '',
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

          // Keep the library predictable: subject → module → topic → newest file.
          return notes.sort((a, b) =>
            a.subjectName.localeCompare(b.subjectName) ||
            (a.moduleNumber || '∞').localeCompare(b.moduleNumber || '∞', undefined, { numeric: true }) ||
            (a.topicNumber || '∞').localeCompare(b.topicNumber || '∞', undefined, { numeric: true }) ||
            b.createdAt.localeCompare(a.createdAt)
          )
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
          // Resolve the small parent set first. This keeps the database query scoped
          // to the chosen semester instead of hydrating every subject and filtering
          // it in Node after the fact.
          const semesters = await payload.find({
            collection: 'semesters',
            depth: input?.branch?.trim() ? 1 : 0,
            limit: 100,
            pagination: false,
            where: input?.semester ? { number: { equals: input.semester } } : undefined,
          })

          const matchingSemesterIds = semesters.docs
            .filter((semester: any) => {
              if (!input?.branch?.trim()) return true
              const branchName = typeof semester.branch === 'object' ? semester.branch?.name : ''
              return branchName?.toLowerCase().includes(input.branch.trim().toLowerCase())
            })
            .map((semester: any) => semester.id)

          if (matchingSemesterIds.length === 0) return []

          const res = await payload.find({
            collection: 'subjects',
            depth: 1,
            limit: 100,
            pagination: false,
            sort: 'name',
            where: { semester: { in: matchingSemesterIds } },
            select: {
              name: true,
              code: true,
              semester: true,
            },
          })

          return res.docs.map((s: any) => ({
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

  getModules: publicProcedure
    .input(z.object({ subjectId: z.union([z.string(), z.number()]) }))
    .query(async ({ input }) => {
      const subjectId = Number(input.subjectId)
      if (!Number.isFinite(subjectId) || subjectId <= 0) return []

      const result = await getOrSetCache(
        hashKey('parsea:notes:modules', String(subjectId)),
        async () => {
          const payload = await getAppPayload()
          const modules = await payload.find({
            collection: 'modules',
            depth: 0,
            limit: 100,
            pagination: false,
            sort: 'number',
            where: { subject: { equals: subjectId } },
          })
          return modules.docs.map((module: any) => ({
            id: module.id,
            number: module.number,
            name: module.name,
          }))
        },
        60 * 60,
      )
      return result.data
    }),

  getTopics: publicProcedure
    .input(z.object({ moduleId: z.union([z.string(), z.number()]) }))
    .query(async ({ input }) => {
      const moduleId = Number(input.moduleId)
      if (!Number.isFinite(moduleId) || moduleId <= 0) return []

      const result = await getOrSetCache(
        hashKey('parsea:notes:topics', String(moduleId)),
        async () => {
          const payload = await getAppPayload()
          const topics = await payload.find({
            collection: 'topics',
            depth: 0,
            limit: 100,
            pagination: false,
            sort: 'number',
            where: { module: { equals: moduleId } },
          })
          return topics.docs.map((topic: any) => ({
            id: topic.id,
            number: topic.number,
            name: topic.name,
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
