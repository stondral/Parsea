import { z } from 'zod'
import { router, publicProcedure } from '../trpc'

export const chatRouter = router({
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
