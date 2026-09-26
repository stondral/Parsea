import { router } from '../trpc'
import { chatRouter } from './chat'
import { notesRouter } from './notes'

export const appRouter = router({
  chat: chatRouter,
  notes: notesRouter,
})

export type AppRouter = typeof appRouter
