import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { askRAG } from '@/lib/rag'

export const chatRouter = router({
  ask: publicProcedure
    .input(
      z.object({
        question: z.string().min(1, 'Question cannot be empty'),
      })
    )
    .mutation(async ({ input }) => {
      return await askRAG(input.question)
    }),
})
