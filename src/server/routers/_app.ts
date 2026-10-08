import { router } from '../trpc'
import { chatRouter } from './chat'
import { notesRouter } from './notes'
import { administratorRouter } from './administrator'

export const appRouter = router({
  chat: chatRouter,
  notes: notesRouter,
  administrator: administratorRouter,
})

export type AppRouter = typeof appRouter
