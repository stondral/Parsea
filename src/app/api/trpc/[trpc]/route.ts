import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@/server/routers/_app'

export const runtime = 'nodejs'
export const maxDuration = 300

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => ({ headers: req.headers }),
  })

export { handler as GET, handler as POST }
