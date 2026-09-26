'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { trpc } from '@/trpc/client'
import { LMSNavbar } from '@/components/LMSNavbar'
import { UploadNoteModal } from '@/components/UploadNoteModal'

const MATERIAL_TYPES = ['All', 'Notes', 'PYQs', 'Assignments']

export default function NotesPage() {
  const searchParams = useSearchParams()
  const [selectedSubject, setSelectedSubject] = useState(() => searchParams.get('subject') ?? '')
  const [selectedType, setSelectedType] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [isUploadOpen, setIsUploadOpen] = useState(false)

  useEffect(() => {
    const subject = searchParams.get('subject')
    if (subject) setSelectedSubject(subject)
  }, [searchParams])

  const subjectsQuery = trpc.notes.getSubjects.useQuery(undefined, {
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
  })
  const notesQuery = trpc.notes.list.useQuery({
    subject: selectedSubject || undefined,
    type: selectedType === 'All' ? undefined : (selectedType as any),
    search: searchQuery || undefined,
  })

  const notes = notesQuery.data || []
  const subjects = subjectsQuery.data || []
  const isLoading = notesQuery.isLoading

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return ''
    const mb = bytes / (1024 * 1024)
    return mb < 1 ? `${Math.round(bytes / 1024)} KB` : `${mb.toFixed(1)} MB`
  }

  const formatDate = (isoString?: string) => {
    if (!isoString) return ''
    try {
      return new Date(isoString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return ''
    }
  }

  const typeTone = (type?: string) => {
    if (type === 'PYQs') return 'library-type library-type-amber'
    if (type === 'Assignments') return 'library-type library-type-purple'
    return 'library-type library-type-green'
  }

  return (
    <div className="lms-shell">
      <LMSNavbar onOpenUpload={() => setIsUploadOpen(true)} />

      <main className="library-page">
        <section className="library-hero">
          <div>
            <span className="section-kicker">Parsea resource library</span>
            <h1>Your study library.</h1>
            <p>Every note, past paper, and assignment in one searchable place.</p>
          </div>
          <div className="library-hero-actions">
            <Link href="/chat" className="btn btn-secondary">Ask Parsea</Link>
            <button type="button" className="btn btn-primary" onClick={() => setIsUploadOpen(true)}>
              Upload material
            </button>
          </div>
        </section>

        <section className="library-summary">
          <div>
            <span className="summary-label">Library overview</span>
            <strong>{notes.length} visible materials</strong>
          </div>
          <div className="library-summary-stats">
            <span><strong>{subjects.length}</strong> subjects</span>
            <span><strong>{notes.length}</strong> matching files</span>
            <span><strong>AI</strong> indexed</span>
          </div>
        </section>

        <section className="library-controls">
          <div className="library-search-row">
            <label className="library-search">
              <span className="search-mark" aria-hidden="true">/</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by title, subject, chapter, or topic"
              />
            </label>
            <span className="library-result-count">
              {isLoading ? 'Searching' : `${notes.length} result${notes.length === 1 ? '' : 's'}`}
            </span>
          </div>

          <div className="library-filter-row">
            <div className="library-subjects">
              <span className="filter-group-label">Subject</span>
              <button
                type="button"
                className={`chip${!selectedSubject ? ' active' : ''}`}
                onClick={() => setSelectedSubject('')}
              >
                All subjects
              </button>
              {subjects.map((subject) => (
                <button
                  key={subject.id}
                  type="button"
                  className={`chip${selectedSubject === subject.name ? ' active' : ''}`}
                  onClick={() => setSelectedSubject(selectedSubject === subject.name ? '' : subject.name)}
                >
                  {subject.name}
                </button>
              ))}
            </div>

            <div className="tab-group">
              {MATERIAL_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`tab${selectedType === type ? ' active' : ''}`}
                  onClick={() => setSelectedType(type)}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="library-results">
          <div className="library-results-heading">
            <div>
              <span className="section-kicker">Your materials</span>
              <h2>{selectedSubject || 'All subjects'}</h2>
            </div>
            <span className="section-count">{isLoading ? 'Loading' : `${notes.length} files`}</span>
          </div>

          {isLoading && (
            <div className="library-document-list">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="library-document-skeleton" />
              ))}
            </div>
          )}

          {!isLoading && notes.length === 0 && (
            <div className="empty-state library-empty-state">
              <span className="empty-state-icon">No files</span>
              <h3 className="empty-state-title">No materials found</h3>
              <p className="empty-state-description">
                {searchQuery || selectedSubject || selectedType !== 'All'
                  ? 'Try a different search or filter.'
                  : 'Upload your first PDF to make it available for notes and AI study chat.'}
              </p>
              <button type="button" className="btn btn-primary" onClick={() => setIsUploadOpen(true)}>
                Upload material
              </button>
            </div>
          )}

          {!isLoading && notes.length > 0 && (
            <div className="library-document-list">
              {notes.map((note) => (
                <article key={note.id} className="library-document">
                  <div className={typeTone(note.type)} aria-hidden="true">
                    {note.type === 'PYQs' ? 'Q' : note.type === 'Assignments' ? 'A' : 'N'}
                  </div>
                  <div className="library-document-main">
                    <div className="library-document-topline">
                      <span className="library-document-type">{note.type || 'Notes'}</span>
                      <span className="library-document-semester">
                        {note.semesterNumber ? `Semester ${note.semesterNumber}` : 'General'}
                      </span>
                    </div>
                    <h3>{note.name}</h3>
                    <p>
                      <strong>{note.subjectName || 'General material'}</strong>
                      {note.chapter ? ` - ${note.chapter}` : ''}
                    </p>
                  </div>
                  <div className="library-document-meta">
                    <span>{formatDate(note.createdAt)}</span>
                    <span>{formatFileSize(note.filesize)}</span>
                  </div>
                  <div className="library-document-actions">
                    <Link href={`/pdf/${note.id}`} target="_blank" className="btn btn-secondary btn-sm">
                      Read
                    </Link>
                    <Link href="/chat" className="btn btn-primary btn-sm">
                      Ask
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <UploadNoteModal isOpen={isUploadOpen} onClose={() => setIsUploadOpen(false)} />
    </div>
  )
}
