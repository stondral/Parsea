'use client'

import React, { useState, useEffect, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { trpc } from '@/trpc/client'
import { LMSNavbar } from '@/components/LMSNavbar'
import { UploadNoteModal } from '@/components/UploadNoteModal'
import { AmbientGrid } from '@/components/AmbientGrid'
import type { NoteItem } from '@/lib/catalog'
import './notes.css'

const MATERIAL_TYPES = ['All', 'Notes', 'PYQs', 'Assignments'] as const

function NotesContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const semesterParam = Number(searchParams.get('sem'))
  const semester =
    Number.isInteger(semesterParam) && semesterParam >= 1 && semesterParam <= 8
      ? semesterParam
      : undefined
  const selectedSubject = searchParams.get('subject') || ''
  const [selectedType, setSelectedType] = useState<(typeof MATERIAL_TYPES)[number]>('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedModule, setSelectedModule] = useState('')
  const [isUploadOpen, setIsUploadOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => setSelectedModule(''), [selectedSubject, semester, selectedType, debouncedSearch])

  const subjectsQuery = trpc.notes.getSubjects.useQuery(semester ? { semester } : undefined, {
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })
  const notesQuery = trpc.notes.list.useQuery(
    {
      subject: selectedSubject || undefined,
      semester,
      type: selectedType === 'All' ? undefined : selectedType,
      search: debouncedSearch || undefined,
    },
    { staleTime: 60_000 },
  )
  const notes = notesQuery.data || []
  const subjects = subjectsQuery.data || []
  const isLoading = notesQuery.isLoading

  const groups = useMemo(() => {
    const result = new Map<
      string,
      { key: string; subject: string; title: string; notes: NoteItem[] }
    >()
    for (const note of notes) {
      const key = `${note.subjectId || note.subjectName}:${note.moduleId || note.moduleNumber || 'general'}`
      if (!result.has(key))
        result.set(key, {
          key,
          subject: note.subjectName,
          title: note.moduleNumber
            ? `Module ${note.moduleNumber}${note.moduleName ? ` · ${note.moduleName}` : ''}`
            : 'General material',
          notes: [],
        })
      result.get(key)!.notes.push(note)
    }
    return [...result.values()]
  }, [notes])
  const visibleGroups = selectedModule
    ? groups.filter((group) => group.key === selectedModule)
    : groups
  const visibleCount = visibleGroups.reduce((total, group) => total + group.notes.length, 0)

  function selectSubject(subject: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (subject) params.set('subject', subject)
    else params.delete('subject')
    router.replace(`/notes${params.size ? `?${params.toString()}` : ''}`, { scroll: false })
  }

  function clearFilters() {
    setSearchQuery('')
    setDebouncedSearch('')
    setSelectedType('All')
    setSelectedModule('')
    selectSubject('')
  }
  function formatFileSize(bytes?: number) {
    if (!bytes) return ''
    return bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  function formatDate(value: string) {
    return new Date(value).toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }
  function chatLink(note?: NoteItem) {
    const params = new URLSearchParams({ mode: 'deep' })
    if (note?.subjectName || selectedSubject)
      params.set('subject', note?.subjectName || selectedSubject)
    if (note?.semesterNumber || semester)
      params.set('sem', String(note?.semesterNumber || semester))
    if (note?.branchName) params.set('branch', note.branchName)
    return `/chat?${params.toString()}`
  }

  return (
    <div className="lms-shell parsea-theme parsea-library">
      <AmbientGrid />
      <LMSNavbar
        appearance="calm"
        onOpenUpload={() => setIsUploadOpen(true)}
        semester={semester || 3}
      />
      <main className="library-page">
        <section className="library-hero">
          <div>
            <span className="section-kicker">A PLACE FOR EVERY IDEA</span>
            <h1>
              Your study <span>library.</span>
            </h1>
            <p>
              Notes, past papers, and assignments. A little more organised, a lot easier to find.
            </p>
            <div className="library-hero-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setIsUploadOpen(true)}
              >
                Bring your own notes <span aria-hidden="true">↑</span>
              </button>
              <Link href={chatLink()} className="btn btn-secondary">
                Ask Parsea <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>
          <div className="library-overview-card">
            <span className="library-overview-mark" aria-hidden="true">
              ✧
            </span>
            <span className="section-kicker">YOUR LEARNING SPACE</span>
            <strong>{isLoading ? '—' : notes.length}</strong>
            <span>materials in this view</span>
            <p>
              {semester ? `Semester ${semester}` : 'All semesters'} ·{' '}
              {selectedSubject || 'All subjects'}
            </p>
          </div>
        </section>

        <section className="library-controls" aria-label="Find your materials">
          <div className="library-search-row">
            <label className="library-search">
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="7.5" cy="7.5" r="5.5" />
                <path d="m12 12 4 4" />
              </svg>
              <span className="visually-hidden">Search materials</span>
              <input
                type="search"
                value={searchQuery}
                maxLength={200}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Find a title, module, or topic…"
              />
            </label>
            <div className="tab-group" aria-label="Material type">
              {MATERIAL_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`tab${selectedType === type ? ' active' : ''}`}
                  aria-pressed={selectedType === type}
                  onClick={() => setSelectedType(type)}
                >
                  {type === 'PYQs' ? 'Past papers' : type}
                </button>
              ))}
            </div>
          </div>
          <div className="library-filter-row">
            <div className="library-subjects">
              <span className="filter-group-label">Subject</span>
              <button
                type="button"
                className={`chip${!selectedSubject ? ' active' : ''}`}
                aria-pressed={!selectedSubject}
                onClick={() => selectSubject('')}
              >
                All subjects
              </button>
              {subjects.map((subject) => (
                <button
                  key={subject.id}
                  type="button"
                  className={`chip${selectedSubject === subject.name ? ' active' : ''}`}
                  aria-pressed={selectedSubject === subject.name}
                  onClick={() =>
                    selectSubject(selectedSubject === subject.name ? '' : subject.name)
                  }
                >
                  {subject.name}
                </button>
              ))}
            </div>
            {groups.length > 1 && (
              <label className="library-module-filter">
                <span className="visually-hidden">Filter by module</span>
                <select
                  value={selectedModule}
                  onChange={(event) => setSelectedModule(event.target.value)}
                >
                  <option value="">All modules</option>
                  {groups.map((group) => (
                    <option key={group.key} value={group.key}>
                      {!selectedSubject ? `${group.subject} · ` : ''}
                      {group.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {subjectsQuery.isError && (
            <p className="library-inline-error" role="alert">
              Subject filters couldn’t load.{' '}
              <button type="button" onClick={() => subjectsQuery.refetch()}>
                Try again
              </button>
            </p>
          )}
        </section>

        <section className="library-results" aria-busy={notesQuery.isFetching}>
          <div className="library-results-heading">
            <div>
              <span className="section-kicker">PICK UP WHERE YOU LEFT OFF</span>
              <h2>{selectedSubject || 'All your materials'}</h2>
            </div>
            <span className="section-count" role="status">
              {notesQuery.isFetching
                ? 'Finding your materials…'
                : `${visibleCount} file${visibleCount === 1 ? '' : 's'}`}
            </span>
          </div>
          {isLoading && (
            <div className="library-document-list" aria-label="Loading materials">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="library-document-skeleton" />
              ))}
            </div>
          )}
          {notesQuery.isError && (
            <div className="library-empty-state" role="alert">
              <span className="library-empty-mark" aria-hidden="true">
                ↻
              </span>
              <h3>Your library couldn’t load.</h3>
              <p>Your files haven’t gone anywhere. Please try again.</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => notesQuery.refetch()}
              >
                Reload materials
              </button>
            </div>
          )}
          {!isLoading && !notesQuery.isError && visibleCount === 0 && (
            <div className="library-empty-state">
              <span className="library-empty-mark" aria-hidden="true">
                ✧
              </span>
              <h3>A little room for something new.</h3>
              <p>
                {searchQuery || selectedSubject || selectedType !== 'All'
                  ? 'No matching materials. Try a different filter or bring your own notes.'
                  : 'Upload a PDF and give your next study session a starting point.'}
              </p>
              <div>
                {(searchQuery || selectedSubject || selectedType !== 'All') && (
                  <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                    Clear filters
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setIsUploadOpen(true)}
                >
                  Upload material
                </button>
              </div>
            </div>
          )}
          {!isLoading &&
            !notesQuery.isError &&
            visibleGroups.map((group) => (
              <details className="library-module-group" key={group.key} open>
                <summary>
                  <span className="library-module-icon" aria-hidden="true">
                    ▤
                  </span>
                  <div>
                    {!selectedSubject && (
                      <span className="library-module-subject">{group.subject}</span>
                    )}
                    <h3>{group.title}</h3>
                  </div>
                  <span className="library-module-count">
                    {group.notes.length} file{group.notes.length === 1 ? '' : 's'}
                  </span>
                  <span className="library-module-chevron" aria-hidden="true">
                    ⌄
                  </span>
                </summary>
                <div className="library-document-list">
                  {group.notes.map((note) => (
                    <article key={note.id} className="library-document">
                      <div
                        className={`library-type library-type-${note.type === 'PYQs' ? 'amber' : note.type === 'Assignments' ? 'purple' : 'green'}`}
                        aria-hidden="true"
                      >
                        {note.type === 'PYQs' ? 'Q' : note.type === 'Assignments' ? 'A' : 'N'}
                      </div>
                      <div className="library-document-main">
                        <div className="library-document-topline">
                          <span className="library-document-type">
                            {note.type === 'PYQs' ? 'Past paper' : note.type}
                          </span>
                          <span className="library-document-semester">
                            {note.topicNumber
                              ? `${note.topicNumber}${note.topicName ? ` · ${note.topicName}` : ''}`
                              : note.semesterNumber
                                ? `Semester ${note.semesterNumber}`
                                : 'General'}
                          </span>
                        </div>
                        <h4>{note.name}</h4>
                        <p>{note.chapter || note.subjectName}</p>
                      </div>
                      <div className="library-document-meta">
                        <span>{formatFileSize(note.filesize)}</span>
                        <span>{formatDate(note.createdAt)}</span>
                      </div>
                      <div className="library-document-actions">
                        <Link
                          href={`/pdf/${note.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary btn-sm"
                          aria-label={`Read ${note.name}`}
                        >
                          Read <span aria-hidden="true">↗</span>
                        </Link>
                        <Link
                          href={chatLink(note)}
                          className="btn btn-primary btn-sm"
                          aria-label={`Ask about ${note.name}`}
                        >
                          Ask
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </details>
            ))}
          {!isLoading && notes.length >= 100 && (
            <p className="library-limit-hint">
              Showing up to 100 materials. Narrow the subject, module, or search to find what you
              need.
            </p>
          )}
        </section>
        <footer className="library-footer">
          <span>Big ideas. Small steps.</span>
          <Link href="/">
            Back to your learning space <span aria-hidden="true">↗</span>
          </Link>
        </footer>
      </main>
      <UploadNoteModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onSuccess={() => notesQuery.refetch()}
      />
    </div>
  )
}

export default function NotesPage() {
  return (
    <Suspense fallback={<div className="lms-shell parsea-theme" />}>
      <NotesContent />
    </Suspense>
  )
}
