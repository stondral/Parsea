'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface AccountMenuProps {
  user: { name?: string; email?: string; semester?: number; role?: string | null } | null
  authChecked: boolean
  appearance?: 'navbar' | 'sidebar' | 'rail'
  calm?: boolean
}

/** Shared account actions; the parent supplies its existing session lookup. */
export function AccountMenu({
  user,
  authChecked,
  appearance = 'navbar',
  calm = true,
}: AccountMenuProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        ref.current?.querySelector('button')?.focus()
      }
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])
  async function signOut() {
    setSigningOut(true)
    setError('')
    try {
      const response = await fetch('/api/users/logout', { method: 'POST', credentials: 'include' })
      if (!response.ok) throw new Error('Sign out failed. Please try again.')
      setOpen(false)
      router.push('/login')
      router.refresh()
    } catch {
      setError('Sign out failed. Please try again.')
    } finally {
      setSigningOut(false)
    }
  }
  return (
    <div ref={ref} className={`navbar-account${appearance === 'sidebar' ? ' chat-account' : appearance === 'rail' ? ' chat-rail-account' : ''}`}>
      {!authChecked ? (
        <span className="navbar-auth-loading" aria-hidden="true" />
      ) : user ? (
        <>
          <button
            type="button"
            className="navbar-account-trigger"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label="Account options"
          >
            <span className="navbar-account-avatar">
              {(user.name || user.email || 'S').charAt(0).toUpperCase()}
            </span>
            <span className="navbar-account-copy">
              <strong>{user.name || 'Student'}</strong>
              <small>{user.semester ? `Semester ${user.semester}` : user.email}</small>
            </span>
            <span className="navbar-account-chevron" aria-hidden="true">
              ⌄
            </span>
          </button>
          {open && (
            <div className="navbar-account-menu" role="group" aria-label="Account actions">
              {user.role === 'admin' && (
                <Link href="/administrator" onClick={() => setOpen(false)}>Admin workspace</Link>
              )}
              <button type="button" onClick={signOut} disabled={signingOut}>
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
              {error && <p role="alert">{error}</p>}
            </div>
          )}
        </>
      ) : (
        <div className="navbar-auth-links">
          <Link href="/login" className="navbar-signin">
            Sign in
          </Link>
          <Link href="/signup" className="btn btn-primary btn-sm">
            {calm ? 'Get started' : 'Create account'}
          </Link>
        </div>
      )}
    </div>
  )
}
