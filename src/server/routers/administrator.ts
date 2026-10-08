import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import type { Where } from 'payload'
import { adminProcedure, router } from '../trpc'
import {
  curriculum,
  relationId,
  type CurriculumCollection,
  type CurriculumItem,
} from '@/lib/adminCatalog'

const id = z.number().int().positive()
const collection = z.enum(['colleges', 'branches', 'semesters', 'subjects', 'modules', 'topics'])
const name = z.string().trim().min(1).max(200)
const paging = {
  page: z.number().int().min(1).default(1),
  search: z.string().trim().max(200).default(''),
}

function item(doc: any, slug: CurriculumCollection): CurriculumItem {
  const field = curriculum[slug].field
  return {
    id: doc.id,
    name: doc.name,
    number: String(doc.number ?? ''),
    code: doc.code || '',
    parentId: field ? relationId(doc[field]) : null,
  }
}

export const administratorRouter = router({
  overview: adminProcedure.query(async ({ ctx }) => {
    const collections = ['documents', 'subjects', 'modules', 'users'] as const
    const counts = await Promise.all(
      collections.map((collection) =>
        ctx.payload.count({ collection, user: ctx.user, overrideAccess: false }),
      ),
    )
    return Object.fromEntries(collections.map((key, i) => [key, counts[i].totalDocs])) as Record<
      (typeof collections)[number],
      number
    >
  }),

  folders: adminProcedure
    .input(z.object({ collection, parentId: id.optional(), ...paging }))
    .query(async ({ ctx, input }) => {
      const field = curriculum[input.collection].field
      const filters: Where[] = []
      if (input.search) filters.push({ name: { contains: input.search } })
      if (input.parentId && field) filters.push({ [field]: { equals: input.parentId } })
      const result = await ctx.payload.find({
        collection: input.collection,
        depth: 0,
        limit: 30,
        page: input.page,
        sort: 'name',
        where: filters.length ? { and: filters } : undefined,
        user: ctx.user,
        overrideAccess: false,
      })
      return {
        items: result.docs.map((doc) => item(doc, input.collection)),
        total: result.totalDocs,
        pages: result.totalPages,
      }
    }),

  // Bounded pickers are separate from paginated tables; the UI discloses truncation.
  options: adminProcedure
    .input(z.object({ collection, parentId: id.optional() }))
    .query(async ({ ctx, input }) => {
      const field = curriculum[input.collection].field
      const result = await ctx.payload.find({
        collection: input.collection,
        depth: 0,
        limit: 500,
        sort: 'name',
        where: input.parentId && field ? { [field]: { equals: input.parentId } } : undefined,
        user: ctx.user,
        overrideAccess: false,
      })
      return {
        items: result.docs.map((doc) => item(doc, input.collection)),
        truncated: result.hasNextPage,
      }
    }),

  saveFolder: adminProcedure
    .input(
      z.object({
        collection,
        id: id.optional(),
        name,
        number: z.string().trim().max(30).default(''),
        code: z.string().trim().max(50).default(''),
        parentId: id.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const definition = curriculum[input.collection]
      const data: Record<string, unknown> = { name: input.name }
      if (definition.parent && definition.field) {
        if (!input.parentId)
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a parent folder.' })
        await ctx.payload.findByID({
          collection: definition.parent,
          id: input.parentId,
          user: ctx.user,
          overrideAccess: false,
        })
        if (input.id) {
          const previous: any = await ctx.payload.findByID({
            collection: input.collection,
            id: input.id,
            depth: 0,
            user: ctx.user,
            overrideAccess: false,
          })
          if (relationId(previous[definition.field]) !== input.parentId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'Existing folders cannot be moved here. Their child relationships must remain consistent.',
            })
          }
        }
        data[definition.field] = input.parentId
      }
      if (input.collection === 'semesters') {
        const semester = Number(input.number)
        if (!Number.isInteger(semester) || semester < 1 || semester > 8)
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Semester must be 1–8.' })
        data.number = semester
      }
      if (input.collection === 'modules' || input.collection === 'topics') {
        if (!input.number)
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Enter a module or topic number.' })
        data.number = input.number
      }
      if (input.collection === 'subjects') data.code = input.code
      const common = {
        collection: input.collection,
        data: data as any,
        user: ctx.user,
        overrideAccess: false,
        depth: 0,
      }
      const result = input.id
        ? await ctx.payload.update({ ...common, id: input.id })
        : await ctx.payload.create(common)
      return item(result, input.collection)
    }),

  deleteFolder: adminProcedure
    .input(z.object({ collection, id }))
    .mutation(async ({ ctx, input }) => {
      await ctx.payload.delete({ ...input, user: ctx.user, overrideAccess: false })
      return { deleted: input.id }
    }),

  documents: adminProcedure
    .input(
      z.object({
        ...paging,
        subjectId: id.optional(),
        moduleId: id.optional(),
        type: z.enum(['Notes', 'PYQs', 'Assignments']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters: Where[] = []
      if (input.search)
        filters.push({
          or: [{ name: { contains: input.search } }, { filename: { contains: input.search } }],
        })
      if (input.subjectId) filters.push({ subject: { equals: input.subjectId } })
      if (input.moduleId) filters.push({ module: { equals: input.moduleId } })
      if (input.type) filters.push({ type: { equals: input.type } })
      const result = await ctx.payload.find({
        collection: 'documents',
        depth: 1,
        limit: 20,
        page: input.page,
        sort: '-createdAt',
        where: filters.length ? { and: filters } : undefined,
        user: ctx.user,
        overrideAccess: false,
      })
      const ids = result.docs.map((doc) => doc.id)
      const includedIds = sql.join(
        ids.map((value) => sql`${value}`),
        sql`, `,
      )
      // Authorized private dashboard query via Payload's existing adapter, not the public catalog pool.
      const health = ids.length
        ? await (ctx.payload.db as any).drizzle.execute(sql`
      SELECT d.id, COALESCE(p.pages, 0) AS pages, COALESCE(c.chunks, 0) AS chunks, COALESCE(c.embedded, 0) AS embedded
      FROM documents d
      LEFT JOIN (SELECT document_id, count(*)::int AS pages FROM document_pages
        WHERE document_id IN (${includedIds}) GROUP BY document_id) p ON p.document_id = d.id
      LEFT JOIN (SELECT document_id, count(*)::int AS chunks, count(embedding)::int AS embedded FROM chunks
        WHERE document_id IN (${includedIds}) GROUP BY document_id) c ON c.document_id = d.id
      WHERE d.id IN (${includedIds})
    `)
        : { rows: [] }
      const stats = new Map<number, { pages: number; chunks: number; embedded: number }>(
        health.rows.map((row: any) => [
          Number(row.id),
          { pages: Number(row.pages), chunks: Number(row.chunks), embedded: Number(row.embedded) },
        ]),
      )
      return {
        total: result.totalDocs,
        pages: result.totalPages,
        items: result.docs.map((doc) => ({
          id: doc.id,
          name: doc.name,
          chapter: doc.chapter || '',
          type: doc.type,
          filename: doc.filename || '',
          filesize: doc.filesize || 0,
          createdAt: doc.createdAt,
          hasCloudFile: Boolean(doc.storageKey),
          subjectId: relationId(doc.subject),
          subjectName: typeof doc.subject === 'object' ? doc.subject.name : '',
          moduleId: relationId(doc.module),
          moduleName:
            doc.module && typeof doc.module === 'object'
              ? `Module ${doc.module.number}: ${doc.module.name}`
              : '',
          topicName:
            doc.topic && typeof doc.topic === 'object'
              ? `${doc.topic.number}: ${doc.topic.name}`
              : '',
          health: stats.get(doc.id) || { pages: 0, chunks: 0, embedded: 0 },
        })),
      }
    }),

  editDocument: adminProcedure
    .input(
      z.object({
        id,
        name,
        chapter: z.string().trim().max(200),
        type: z.enum(['Notes', 'PYQs', 'Assignments']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input
      await ctx.payload.update({
        collection: 'documents',
        id,
        data,
        user: ctx.user,
        overrideAccess: false,
      })
      return { saved: id }
    }),

  reindexDocument: adminProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const doc = await ctx.payload.findByID({
      collection: 'documents',
      id: input.id,
      user: ctx.user,
      overrideAccess: false,
    })
    // Explicit, authenticated retry through the ONE canonical ingestion hook.
    await ctx.payload.update({
      collection: 'documents',
      id: input.id,
      data: { name: doc.name },
      user: ctx.user,
      overrideAccess: false,
      context: { forceDocumentIngestion: true, failOnIngestionError: true },
    })
    return { indexed: input.id }
  }),

  deleteDocuments: adminProcedure
    .input(z.object({ ids: z.array(id).min(1).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const deleted: number[] = []
      const failed: { id: number; message: string }[] = []
      for (const id of new Set(input.ids)) {
        try {
          await ctx.payload.delete({
            collection: 'documents',
            id,
            user: ctx.user,
            overrideAccess: false,
          })
          deleted.push(id)
        } catch (error) {
          failed.push({ id, message: error instanceof Error ? error.message : 'Deletion failed.' })
        }
      }
      return { deleted, failed }
    }),

  users: adminProcedure.input(z.object(paging)).query(async ({ ctx, input }) => {
    const result = await ctx.payload.find({
      collection: 'users',
      depth: 0,
      limit: 20,
      page: input.page,
      sort: '-createdAt',
      where: input.search
        ? { or: [{ name: { contains: input.search } }, { email: { contains: input.search } }] }
        : undefined,
      select: { name: true, email: true, role: true, semester: true, createdAt: true },
      user: ctx.user,
      overrideAccess: false,
    })
    return {
      total: result.totalDocs,
      pages: result.totalPages,
      items: result.docs.map((user) => ({
        id: user.id,
        name: user.name || '',
        email: user.email,
        role: user.role || 'student',
        semester: user.semester,
        createdAt: user.createdAt,
      })),
    }
  }),

  saveUser: adminProcedure
    .input(
      z.object({
        id,
        name: z.string().trim().max(200),
        semester: z.number().int().min(1).max(8).nullable(),
        role: z.enum(['student', 'admin']),
        confirmRoleChange: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const previous = await ctx.payload.findByID({
        collection: 'users',
        id: input.id,
        user: ctx.user,
        overrideAccess: false,
      })
      if (previous.role !== input.role) {
        if (!input.confirmRoleChange)
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Confirm this permission change.' })
        if (input.id === ctx.user.id)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'You cannot remove your own admin access here.',
          })
        if (previous.role === 'admin' && input.role !== 'admin') {
          const admins = await ctx.payload.count({
            collection: 'users',
            where: { role: { equals: 'admin' } },
            user: ctx.user,
            overrideAccess: false,
          })
          if (admins.totalDocs <= 1)
            throw new TRPCError({ code: 'CONFLICT', message: 'Keep at least one administrator.' })
        }
      }
      await ctx.payload.update({
        collection: 'users',
        id: input.id,
        data: { name: input.name, semester: input.semester, role: input.role },
        user: ctx.user,
        overrideAccess: false,
      })
      return { saved: input.id }
    }),
})
