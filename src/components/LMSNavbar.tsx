'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BrandMark } from '@/components/BrandMark'
import { AccountMenu } from '@/components/AccountMenu'

interface CurrentUser {
  name?: string
  email?: string
  semester?: number
}

interface LMSNavbarProps {
  appearance?: 'default' | 'calm'
  onOpenUpload?: () => void
  branch?: string
  semester?: number | string
}

export function LMSNavbar({
  onOpenUpload,
  branch = 'COMPS',
  semester = 3,
  appearance = 'default',
}: LMSNavbarProps) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

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

  const isChat = pathname === '/chat'
  const isNotes = pathname === '/notes'
  const isHome = pathname === '/'
  const isCalm = isHome || appearance === 'calm'

  return (
    <nav className={`navbar${menuOpen ? ' menu-open' : ''}`} aria-label="Main navigation">
      {/* Brand */}
      <Link href="/" className="navbar-brand" onClick={() => setMenuOpen(false)}>
        <BrandMark className="navbar-brand-mark" />
        <span className="navbar-logo-name">Parsea</span>
        <span className="navbar-badge">Academic Intelligence</span>
      </Link>

      {/* Nav links */}
      <div className="navbar-nav">
        {isCalm && (
          <Link
            href="/"
            className={`nav-link nav-home-link${isHome ? ' active' : ''}`}
            aria-current={isHome ? 'page' : undefined}
            onClick={() => setMenuOpen(false)}
          >
            Overview
          </Link>
        )}
        <Link
          href="/notes"
          className={`nav-link${isNotes ? ' active' : ''}`}
          aria-current={isNotes ? 'page' : undefined}
          onClick={() => setMenuOpen(false)}
        >
          <span className="nav-glyph" aria-hidden="true">
            N
          </span>
          <span className="nav-label">
            <span className="nav-label-desktop">{isCalm ? 'Library' : 'Your Notes'}</span>
            <span className="nav-label-mobile">{isCalm ? 'Library' : 'Notes'}</span>
          </span>
        </Link>
        <Link
          href="/chat"
          className={`nav-link${isChat ? ' active' : ''}`}
          aria-current={isChat ? 'page' : undefined}
          onClick={() => setMenuOpen(false)}
        >
          <span className="nav-glyph" aria-hidden="true">
            AI
          </span>
          <span className="nav-label">
            <span className="nav-label-desktop">{isCalm ? 'Study chat' : 'AI Assistant'}</span>
            <span className="nav-label-mobile">{isCalm ? 'Study chat' : 'Ask AI'}</span>
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

        <AccountMenu user={currentUser} authChecked={authChecked} calm={isCalm} />
      </div>
    </nav>
  )
}
