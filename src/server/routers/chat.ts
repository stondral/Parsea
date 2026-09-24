import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { askRAG } from '@/lib/rag'

export const chatRouter = router({
  ask: publicProcedure
    .input(
      z.object({
        question: z.string().min(1, 'Question cannot be empty'),
        filters: z
          .object({
            branch: z.string().optional(),
            semester: z.number().optional(),
            subject: z.string().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await askRAG(input.question, input.filters)
    }),
})
