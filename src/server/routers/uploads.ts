import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import type { Payload } from 'payload'
import type { User } from '@/payload-types'
import { authenticatedProcedure, router } from '../trpc'
import { buildDownloadFilename, classifyDocumentFilename } from '@/lib/documentClassification'
import { relationId } from '@/lib/adminCatalog'
import type { UploadMetadata } from '@/lib/uploadJobs'
import { createHash } from 'node:crypto'
import { EMBEDDING_MODEL } from '@/lib/embeddings'
import { PAGE_ORIENTATION_VERSION } from '@/lib/pageOrientation'
const id = z.number().int().positive()
const name = z.string().trim().min(1).max(200)

async function ownedJob(ctx: { payload: Payload; user: User }, id: string) {
  const job = await (await import('@/lib/uploadJobs')).readUploadJob(ctx.payload, id)
  if (ctx.user.role !== 'admin' && Number(job.owner_id) !== ctx.user.id)
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This upload belongs to another user.' })
  return job
}

// One implementation, exposed through admin-only and signed-in upload routers.
export function createUploadProcedures(procedure: typeof authenticatedProcedure) {
  return {
    prepareUpload: procedure
      .input(
        z.object({
          requestId: z.uuid(),
          contentHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
          name,
          chapter: z.string().trim().max(200).default(''),
          originalFilename: z.string().min(1).max(255),
          bytes: z
            .number()
            .int()
            .positive()
            .max(25 * 1024 * 1024),
          type: z.enum(['Notes', 'PYQs', 'Assignments']),
          subject: id,
          module: id.optional(),
          topic: id.optional(),
          replaceDocumentId: id.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.replaceDocumentId && ctx.user.role !== 'admin')
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only admins can replace library PDFs.',
          })
        const { readUploadJob } = await import('@/lib/uploadJobs')
        const { getPresignedUploadUrl } = await import('@/lib/r2')
        if (!/\.pdf$/i.test(input.originalFilename))
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a PDF.' })
        const subject = await ctx.payload.findByID({
          collection: 'subjects',
          id: input.subject,
          depth: 0,
        })
        if (input.module) {
          const chosen = await ctx.payload.findByID({
            collection: 'modules',
            id: input.module,
            depth: 0,
          })
          if (relationId(chosen.subject) !== subject.id)
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Module does not belong to this subject.',
            })
        }
        let moduleId = input.module
        const classification = classifyDocumentFilename(input.originalFilename)
        if (!moduleId && !input.topic && classification.moduleNumber) {
          const existing = await ctx.payload.find({
            collection: 'modules',
            depth: 0,
            limit: 1,
            where: {
              and: [
                { subject: { equals: subject.id } },
                { number: { equals: classification.moduleNumber } },
              ],
            },
          })
          if (!existing.docs[0] && ctx.user.role !== 'admin')
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Choose an existing module. Only admins can add curriculum folders.',
            })
          const folder =
            existing.docs[0] ||
            (await ctx.payload.create({
              collection: 'modules',
              user: ctx.user,
              overrideAccess: false,
              data: {
                subject: subject.id,
                number: classification.moduleNumber,
                name: `Module ${classification.moduleNumber}`,
              },
            }))
          moduleId = folder.id
        }
        let topic = input.topic
          ? await ctx.payload.findByID({ collection: 'topics', id: input.topic, depth: 0 })
          : undefined
        if (!topic && moduleId && classification.topicNumber) {
          const existing = await ctx.payload.find({
            collection: 'topics',
            depth: 0,
            limit: 1,
            where: {
              and: [
                { module: { equals: moduleId } },
                { number: { equals: classification.topicNumber } },
              ],
            },
          })
          if (!existing.docs[0] && ctx.user.role !== 'admin')
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Choose an existing topic. Only admins can add curriculum folders.',
            })
          topic =
            existing.docs[0] ||
            (await ctx.payload.create({
              collection: 'topics',
              user: ctx.user,
              overrideAccess: false,
              data: {
                module: moduleId,
                number: classification.topicNumber,
                name: classification.topicTitle || `Topic ${classification.topicNumber}`,
              },
            }))
        }
        if (topic) {
          const topicModule = relationId(topic.module)!
          if (moduleId && moduleId !== topicModule)
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Topic does not belong to this module.',
            })
          moduleId = topicModule
        }
        const module = moduleId
          ? await ctx.payload.findByID({ collection: 'modules', id: moduleId, depth: 0 })
          : undefined
        if (module && relationId(module.subject) !== subject.id)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Module does not belong to this subject.',
          })
        if (input.replaceDocumentId)
          await ctx.payload.findByID({
            collection: 'documents',
            id: input.replaceDocumentId,
            user: ctx.user,
            overrideAccess: false,
          })
        const filename = buildDownloadFilename({
          subjectName: subject.name,
          moduleNumber: module?.number,
          moduleName: module?.name,
          topicNumber: topic?.number,
          topicName: topic?.name,
          title: input.name,
          originalFilename: input.originalFilename,
        })
        const metadata: UploadMetadata = {
          name: input.name,
          chapter: input.chapter || input.name,
          type: input.type,
          subject: input.subject,
          module: moduleId,
          topic: topic?.id,
          replaceDocumentId: input.replaceDocumentId,
        }
        const key = `uploads/${input.requestId}/${filename}`
        const db = (ctx.payload.db as any).drizzle
        const scope = JSON.stringify([
          ctx.user.id,
          metadata.subject,
          metadata.module || null,
          metadata.topic || null,
          metadata.type,
          input.contentHash,
        ])
        const dedup =
          input.contentHash && !input.replaceDocumentId
            ? createHash('sha256').update(scope).digest('hex')
            : null
        if (dedup) {
          const same = await db.execute(sql`SELECT j.id, j.filename FROM document_upload_jobs j
          WHERE j.dedup_key = ${dedup} AND j.status = 'ready' AND j.document_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = j.document_id AND c.embedding_model = ${EMBEDDING_MODEL})
          AND EXISTS (SELECT 1 FROM document_pages p WHERE p.document_id = j.document_id AND p.orientation_version = ${PAGE_ORIENTATION_VERSION}) LIMIT 1`)
          if (same.rows[0])
            return {
              id: String(same.rows[0].id),
              filename: String(same.rows[0].filename),
              status: 'ready',
              url: null,
            }
        }
        await db.execute(sql`INSERT INTO document_upload_jobs (id, owner_id, storage_key, filename, bytes, metadata, content_hash, dedup_key)
      VALUES (${input.requestId}::uuid, ${ctx.user.id}, ${key}, ${filename}, ${input.bytes}, ${JSON.stringify(metadata)}::jsonb, ${input.contentHash || null}, ${dedup})
      ON CONFLICT (id) DO NOTHING`)
        const job = await readUploadJob(ctx.payload, input.requestId)
        if (Number(job.owner_id) !== ctx.user.id)
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This upload ID is already in use. Choose the file again.',
          })
        if (
          job.bytes !== input.bytes ||
          (input.contentHash && job.content_hash !== input.contentHash) ||
          job.filename !== filename ||
          Object.entries(metadata).some(
            ([key, value]) => job.metadata[key as keyof UploadMetadata] !== value,
          )
        )
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This upload ID belongs to a different file. Choose the file again.',
          })
        return {
          id: job.id,
          filename: job.filename,
          status: job.status,
          url: job.status === 'uploading' ? await getPresignedUploadUrl(job.storage_key) : null,
        }
      }),
    completeUpload: procedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
      await ownedJob(ctx, input.id)
      return (await import('@/lib/uploadJobs')).queueUploadJob(ctx.payload, input.id)
    }),
    uploadSmallPDF: procedure
      .input(z.object({ id: z.uuid(), base64: z.string().max(4 * 1024 * 1024) }))
      .mutation(async ({ ctx, input }) => {
        const { uploadToR2 } = await import('@/lib/r2')
        const job = await ownedJob(ctx, input.id)
        if (job.status !== 'uploading') return { saved: true }
        if (job.bytes > 3 * 1024 * 1024)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'PDFs larger than 3 MB require direct R2 upload. Configure bucket CORS for this site.',
          })
        const buffer = Buffer.from(input.base64, 'base64')
        if (buffer.length !== job.bytes || !buffer.subarray(0, 1024).includes(Buffer.from('%PDF-')))
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'The file is not a complete PDF.' })
        await uploadToR2({ key: job.storage_key, buffer, contentType: 'application/pdf' })
        return { saved: true }
      }),
    processUpload: procedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
      await ownedJob(ctx, input.id)
      return (await import('@/lib/uploadJobs')).processUploadJob(ctx.payload, input.id)
    }),
    uploadStatus: procedure
      .input(z.object({ id: z.uuid() }))
      .query(({ ctx, input }) => ownedJob(ctx, input.id)),
    myUploads: procedure.query(async ({ ctx }) => {
      const result = await (ctx.payload.db as any).drizzle
        .execute(sql`SELECT id, filename, status, stage, progress, document_id, error
      FROM document_upload_jobs WHERE owner_id = ${ctx.user.id} ORDER BY created_at DESC LIMIT 10`)
      return result.rows as Array<{
        id: string
        filename: string
        status: string
        stage: string
        progress: number
        document_id: number | null
        error: string | null
      }>
    }),
  }
}
export const uploadsRouter = router(createUploadProcedures(authenticatedProcedure))
