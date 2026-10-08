import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { getOrSetCache, hashKey } from '@/lib/redis'
import { readSubjects, readNotes, readModules, readTopics, readCatalogStats } from '@/lib/catalog'
export type { NoteItem } from '@/lib/catalog'

const optionalText = z.string().trim().max(200).optional()
const semester = z.number().int().min(1).max(8).optional()

// Canonical key inputs keep whitespace/case and absent fields from fragmenting caches.
function normalizedFilters(input: Record<string, unknown> = {}) {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, typeof value === 'string' ? value.trim().toLowerCase() : value]),
  )
}

export const notesRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          subject: optionalText,
          type: z.enum(['Notes', 'PYQs', 'Assignments']).optional(),
          search: optionalText,
          branch: optionalText,
          semester,
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const result = await getOrSetCache(
        hashKey('parsea:notes:list:v2', JSON.stringify(normalizedFilters(input))),
        () => readNotes(input),
        30,
      )
      return result.data
    }),

  getSubjects: publicProcedure
    .input(z.object({ branch: optionalText, semester }).optional())
    .query(async ({ input }) => {
      const result = await getOrSetCache(
        hashKey('parsea:notes:subjects:v2', JSON.stringify(normalizedFilters(input))),
        () => readSubjects(input),
        60 * 60,
      )
      return result.data
    }),

  getModules: publicProcedure
    .input(z.object({ subjectId: z.union([z.string(), z.number()]) }))
    .query(async ({ input }) => {
      const subjectId = Number(input.subjectId)
      if (!Number.isInteger(subjectId) || subjectId <= 0) return []
      const result = await getOrSetCache(
        hashKey('parsea:notes:modules:v2', String(subjectId)),
        () => readModules(subjectId),
        60 * 60,
      )
      return result.data
    }),

  getTopics: publicProcedure
    .input(z.object({ moduleId: z.union([z.string(), z.number()]) }))
    .query(async ({ input }) => {
      const moduleId = Number(input.moduleId)
      if (!Number.isInteger(moduleId) || moduleId <= 0) return []
      const result = await getOrSetCache(
        hashKey('parsea:notes:topics:v2', String(moduleId)),
        () => readTopics(moduleId),
        60 * 60,
      )
      return result.data
    }),

  getStats: publicProcedure.query(async () => {
    const result = await getOrSetCache('parsea:notes:stats:v2', readCatalogStats, 30)
    return result.data
  }),
})
