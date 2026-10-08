'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

interface CurrentUser {
  name?: string
  email?: string
  semester?: number
}

interface LMSNavbarProps {
  onOpenUpload?: () => void
  branch?: string
  semester?: number | string
}

export function LMSNavbar({ onOpenUpload, branch = 'COMPS', semester = 3 }: LMSNavbarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/users/me', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active) setCurrentUser(data?.user || null)
      })
      .catch(() => {
        if (active) setCurrentUser(null)
      })
      .finally(() => {
        if (active) setAuthChecked(true)
      })
    return () => {
      active = false
    }
  }, [])

  const handleLogout = async () => {
    await fetch('/api/users/logout', { method: 'POST', credentials: 'include' })
    setCurrentUser(null)
    setAccountOpen(false)
    setMenuOpen(false)
    router.push('/login')
    router.refresh()
  }

  const isChat = pathname === '/chat'
  const isNotes = pathname === '/notes'
  const isHome = pathname === '/'

  return (
    <nav className={`navbar${menuOpen ? ' menu-open' : ''}`} aria-label="Main navigation">
      {/* Brand */}
      <Link href="/" className="navbar-brand" onClick={() => setMenuOpen(false)}>
        <svg
          width="34"
          height="34"
          viewBox="0 0 34 34"
          fill="none"
          className="navbar-brand-mark"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <rect x="1" y="1" width="32" height="32" rx="10" fill="currentColor" opacity=".09" />
          <path
            d="m17 6 3.2 7.8L28 17l-7.8 3.2L17 28l-3.2-7.8L6 17l7.8-3.2Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="17" cy="17" r="2.3" fill="currentColor" />
        </svg>
        <span className="navbar-logo-name">Parsea</span>
        <span className="navbar-badge">Academic Intelligence</span>
      </Link>

      {/* Nav links */}
      <div className="navbar-nav">
        {isHome && (
          <Link
            href="/"
            className="nav-link nav-home-link active"
            aria-current="page"
            onClick={() => setMenuOpen(false)}
          >
            Overview
          </Link>
        )}
        <Link
          href="/notes"
          className={`nav-link${isNotes ? ' active' : ''}`}
          onClick={() => setMenuOpen(false)}
        >
          <span className="nav-glyph" aria-hidden="true">
            N
          </span>
          <span className="nav-label">
            <span className="nav-label-desktop">{isHome ? 'Library' : 'Your Notes'}</span>
            <span className="nav-label-mobile">{isHome ? 'Library' : 'Notes'}</span>
          </span>
        </Link>
        <Link
          href="/chat"
          className={`nav-link${isChat ? ' active' : ''}`}
          onClick={() => setMenuOpen(false)}
        >
          <span className="nav-glyph" aria-hidden="true">
            AI
          </span>
          <span className="nav-label">
            <span className="nav-label-desktop">{isHome ? 'Study chat' : 'AI Assistant'}</span>
            <span className="nav-label-mobile">{isHome ? 'Study chat' : 'Ask AI'}</span>
          </span>
        </Link>
      </div>

      {/* Right side */}
      <div className="navbar-actions">
        <span className="navbar-scope-pill">
          <span className="navbar-scope-dot" />
          {branch} · Sem {semester}
        </span>

        {onOpenUpload && currentUser && (
          <button type="button" onClick={onOpenUpload} className="btn btn-primary btn-sm">
            Upload notes
          </button>
        )}

        {!authChecked ? (
          <span className="navbar-auth-loading" aria-hidden="true" />
        ) : currentUser ? (
          <div className="navbar-account">
            <button
              type="button"
              className="navbar-account-trigger"
              onClick={() => setAccountOpen((open) => !open)}
              aria-expanded={accountOpen}
              aria-haspopup="menu"
            >
              <span className="navbar-account-avatar">
                {(currentUser.name || currentUser.email || 'S').charAt(0).toUpperCase()}
              </span>
              <span className="navbar-account-copy">
                <strong>{currentUser.name || 'Student'}</strong>
                <small>
                  {currentUser.semester ? `Semester ${currentUser.semester}` : currentUser.email}
                </small>
              </span>
              <span className="navbar-account-chevron">⌄</span>
            </button>
            {accountOpen && (
              <div className="navbar-account-menu" role="menu">
                <Link
                  href="/admin"
                  target="_blank"
                  onClick={() => {
                    setAccountOpen(false)
                    setMenuOpen(false)
                  }}
                >
                  Admin portal
                </Link>
                <button type="button" onClick={handleLogout}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="navbar-auth-links">
            <Link href="/login" className="navbar-signin" onClick={() => setMenuOpen(false)}>
              Sign in
            </Link>
            <Link
              href="/signup"
              className="btn btn-primary btn-sm"
              onClick={() => setMenuOpen(false)}
            >
              {isHome ? 'Get started' : 'Create account'}
            </Link>
          </div>
        )}
      </div>
    </nav>
  )
}
