import { router } from '../trpc'
import { chatRouter } from './chat'
import { notesRouter } from './notes'
import { administratorRouter } from './administrator'
import { uploadsRouter } from './uploads'

export const appRouter = router({
  chat: chatRouter,
  notes: notesRouter,
  administrator: administratorRouter,
  uploads: uploadsRouter,
})

export type AppRouter = typeof appRouter
