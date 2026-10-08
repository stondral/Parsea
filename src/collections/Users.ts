import type { CollectionConfig } from 'payload'
import { adminOnly, adminOrSelf, adminRoleOnly } from '@/access/admin'

export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    admin: adminOnly,
    create: () => true,
    read: adminOrSelf,
    update: adminOrSelf,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['name', 'email', 'semester', 'phoneNumber', 'createdAt'],
  },
  auth: true,
  fields: [
    {
      name: 'name',
      type: 'text',
    },
    {
      name: 'phoneNumber',
      type: 'text',
      admin: {
        description: 'Optional phone number for account recovery and study groups.',
      },
    },
    {
      name: 'role',
      type: 'select',
      defaultValue: 'student',
      access: { create: adminRoleOnly, update: adminRoleOnly },
      options: [
        { label: 'Student', value: 'student' },
        { label: 'Admin', value: 'admin' },
      ],
      admin: { position: 'sidebar' },
    },
    {
      name: 'semester',
      type: 'number',
      min: 1,
      max: 8,
    },
  ],
}
