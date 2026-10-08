import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getAppPayload, isAdminUser } from '@/lib/payloadAuth'
import { AdministratorWorkspace } from '@/components/AdministratorWorkspace'

export const metadata = { title: 'Administrator · Parsea' }

export default async function AdministratorPage() {
  const payload = await getAppPayload()
  const { user } = await payload.auth({ headers: await headers() })
  if (!user) redirect('/login')
  if (!isAdminUser(user)) {
    return (
      <section className="parsea-theme" style={{ minHeight: '100dvh', padding: '48px 24px' }}>
        <h1>Admin access required.</h1>
        <p>This workspace is available to accounts with the Admin role.</p>
        <Link href="/">Return to Parsea</Link>
      </section>
    )
  }
  return (
    <AdministratorWorkspace
      user={{
        name: user.name || undefined,
        email: user.email,
        role: user.role,
        semester: user.semester || undefined,
      }}
    />
  )
}
