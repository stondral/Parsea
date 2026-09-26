'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { trpc } from '@/trpc/client'
import { LMSNavbar } from '@/components/LMSNavbar'
import { UploadNoteModal } from '@/components/UploadNoteModal'

interface SubjectItem {
  id: string | number
  name: string
  code: string
  semesterNumber: number | null
  branchName: string
}

const COURSE_PALETTE = [
  { tone: 'course-tone-green', mark: 'SUM' },
  { tone: 'course-tone-blue', mark: 'CS' },
  { tone: 'course-tone-amber', mark: 'ENG' },
  { tone: 'course-tone-purple', mark: 'NET' },
  { tone: 'course-tone-green', mark: 'LAB' },
  { tone: 'course-tone-blue', mark: 'GEO' },
  { tone: 'course-tone-amber', mark: 'DB' },
  { tone: 'course-tone-purple', mark: 'WEB' },
]

const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8]

export default function CourseCatalogPage() {
  const router = useRouter()
  const [activeSem, setActiveSem] = useState(3)
  const [isUploadOpen, setIsUploadOpen] = useState(false)

  const subjectsQuery = trpc.notes.getSubjects.useQuery(
    { semester: activeSem },
    { staleTime: 1000 * 60 * 60, gcTime: 1000 * 60 * 60 },
  )
  const statsQuery = trpc.notes.getStats.useQuery()
  const subjects = (subjectsQuery.data ?? []) as SubjectItem[]
  const leadSubject = subjects[0]

  const openNotes = (subject: SubjectItem) => {
    router.push(`/notes?subject=${encodeURIComponent(subject.name)}&sem=${activeSem}`)
  }

  return (
    <div className="lms-shell">
      <LMSNavbar onOpenUpload={() => setIsUploadOpen(true)} />

      <main className="learning-home">
        <section className="learning-hero">
          <div className="learning-hero-copy">
            <p className="catalog-hero-eyebrow">Parsea learning desk</p>
            <h1 className="learning-hero-title">Your semester, in one place.</h1>
            <p className="learning-hero-sub">
              Open any subject, pick up your notes, or ask Parsea to make the hard part clearer.
            </p>
            <div className="learning-hero-actions">
              <Link href="/chat" className="btn btn-primary">Ask Parsea</Link>
              <Link href="/notes" className="btn btn-light">Browse all notes</Link>
            </div>
          </div>

          <div className="semester-picker">
            <span className="semester-picker-label">Current semester</span>
            <div className="sem-selector">
              {SEMESTERS.map((sem) => (
                <button
                  key={sem}
                  type="button"
                  className={`sem-pill${activeSem === sem ? ' active' : ''}`}
                  onClick={() => setActiveSem(sem)}
                >
                  Sem {sem}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="learning-overview" aria-label="Semester overview">
          <div>
            <span className="overview-kicker">Semester {activeSem} workspace</span>
            <strong className="overview-title">Everything you need to study is ready.</strong>
          </div>
          <div className="overview-stats">
            <div className="overview-stat">
              <strong>{subjectsQuery.isLoading ? '-' : subjects.length}</strong>
              <span>Subjects</span>
            </div>
            <div className="overview-stat">
              <strong>{statsQuery.data?.totalDocuments ?? '-'}</strong>
              <span>Materials</span>
            </div>
            <div className="overview-stat">
              <strong>{statsQuery.data?.totalSubjects ?? '-'}</strong>
              <span>In library</span>
            </div>
          </div>
        </section>

        <section className="learning-dashboard">
          <article className="continue-panel">
            <div>
              <span className="panel-kicker">Continue studying</span>
              <h2>{leadSubject ? leadSubject.name : 'Choose a subject to begin'}</h2>
              <p>
                {leadSubject
                  ? `${leadSubject.code || 'Semester material'} - notes, PDFs, and AI explanations in one workspace.`
                  : 'Your semester subjects will appear here as soon as they are available.'}
              </p>
            </div>
            {leadSubject && (
              <button type="button" className="btn btn-light" onClick={() => openNotes(leadSubject)}>
                Open subject
              </button>
            )}
          </article>

          <article className="assistant-panel">
            <span className="panel-kicker">Study with Parsea</span>
            <h2>Stuck on a concept?</h2>
            <p>Ask a question grounded in your course material and get the source page with the answer.</p>
            <Link href="/chat" className="text-action">Start a study chat <span aria-hidden="true">-&gt;</span></Link>
          </article>
        </section>

        <section className="subject-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Your curriculum</span>
              <h2>Semester {activeSem} subjects</h2>
            </div>
            <span className="section-count">
              {subjectsQuery.isLoading ? 'Loading' : `${subjects.length} available`}
            </span>
          </div>

          {subjectsQuery.isLoading && (
            <div className="subject-list">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="subject-skeleton" />
              ))}
            </div>
          )}

          {!subjectsQuery.isLoading && subjects.length === 0 && (
            <div className="empty-state">
              <span className="empty-state-icon">No data</span>
              <h3 className="empty-state-title">No subjects in Semester {activeSem}</h3>
              <p className="empty-state-description">Choose another semester or add subjects in the admin panel.</p>
              <Link href="/admin" target="_blank" className="btn btn-secondary">Open admin</Link>
            </div>
          )}

          {!subjectsQuery.isLoading && subjects.length > 0 && (
            <div className="subject-list">
              {subjects.map((subject, index) => {
                const palette = COURSE_PALETTE[index % COURSE_PALETTE.length]
                return (
                  <article key={subject.id} className="subject-row">
                    <div className={`subject-mark ${palette.tone}`} aria-hidden="true">{palette.mark}</div>
                    <div className="subject-main">
                      <span className="subject-code">{subject.code || `SEM ${activeSem}`}</span>
                      <h3>{subject.name}</h3>
                      <p>{subject.branchName || 'Academic course'} - Semester {subject.semesterNumber ?? activeSem}</p>
                    </div>
                    <div className="subject-actions">
                      <span className="subject-status">Ready to study</span>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openNotes(subject)}>
                        Open notes
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="study-tools">
          <div>
            <span className="section-kicker">Study tools</span>
            <h2>Keep the momentum going.</h2>
          </div>
          <div className="tool-links">
            <Link href="/chat" className="tool-link">
              <span className="tool-link-mark">AI</span>
              <span><strong>Ask Parsea</strong><small>Get an explanation from your notes</small></span>
              <span aria-hidden="true">-&gt;</span>
            </Link>
            <Link href="/notes" className="tool-link">
              <span className="tool-link-mark">PDF</span>
              <span><strong>Notes library</strong><small>Search every uploaded material</small></span>
              <span aria-hidden="true">-&gt;</span>
            </Link>
            <button type="button" className="tool-link" onClick={() => setIsUploadOpen(true)}>
              <span className="tool-link-mark">UP</span>
              <span><strong>Upload material</strong><small>Add a PDF to your study desk</small></span>
              <span aria-hidden="true">-&gt;</span>
            </button>
          </div>
        </section>
      </main>

      <UploadNoteModal isOpen={isUploadOpen} onClose={() => setIsUploadOpen(false)} />
    </div>
  )
}
