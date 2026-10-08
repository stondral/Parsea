import { initTRPC, TRPCError } from '@trpc/server'

const t = initTRPC.context<{ headers?: Headers }>().create()

export const router = t.router
export const publicProcedure = t.procedure

// Only management requests initialize Payload. Keep public catalog reads light.
export const adminProcedure = t.procedure.use(async ({ ctx, next }) => {
  const { getRequestUser, isAdminUser } = await import('@/lib/payloadAuth')
  const { payload, user } = await getRequestUser(
    new Request('http://parsea.internal', { headers: ctx.headers }),
  )
  if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Please sign in.' })
  if (!isAdminUser(user)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required.' })
  return next({ ctx: { ...ctx, payload, user } })
})
