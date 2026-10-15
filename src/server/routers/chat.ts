import { z } from 'zod'
import { router, publicProcedure } from '../trpc'

export const chatRouter = router({
  refreshImage: publicProcedure
    .input(z.object({ storageKey: z.string().min(1).max(2048) }))
    .query(async ({ input }) => {
      const { getAppPayload } = await import('@/lib/payloadAuth')
      const payload = await getAppPayload()
      // Never turn this into an arbitrary private-object signing endpoint.
      const linked = await payload.find({
        collection: 'chunks',
        depth: 0,
        limit: 1,
        overrideAccess: false,
        where: { imageUrl: { equals: input.storageKey } },
        select: { imageUrl: true },
      })
      if (!linked.docs[0]) return null
      const { getPresignedDownloadUrl } = await import('@/lib/r2')
      return { url: await getPresignedDownloadUrl(input.storageKey) }
    }),
  ask: publicProcedure
    .input(
      z.object({
        question: z.string().min(1, 'Question cannot be empty'),
        conversationId: z.string().optional(),
        history: z
          .array(
            z.object({
              role: z.enum(['user', 'assistant']),
              content: z.string(),
            }),
          )
          .max(20)
          .optional(),
        filters: z
          .object({
            branch: z.string().optional(),
            semester: z.number().optional(),
            subject: z.string().optional(),
            module: z.string().optional(),
            topic: z.string().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { askRAG } = await import('@/lib/rag')
      return await askRAG(input.question, input.filters, {
        conversationId: input.conversationId,
        history: input.history,
      })
    }),
})
