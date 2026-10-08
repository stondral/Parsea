import type { Access, PayloadRequest } from 'payload'

export const adminOnly = ({ req }: { req: PayloadRequest }) => req.user?.role === 'admin'
export const adminRoleOnly = adminOnly
export const adminOrSelf: Access = ({ req }) =>
  req.user?.role === 'admin' ? true : req.user ? { id: { equals: req.user.id } } : false
