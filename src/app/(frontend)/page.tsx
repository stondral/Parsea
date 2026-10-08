'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/trpc/client'
import { LMSNavbar } from '@/components/LMSNavbar'
import { UploadNoteModal } from '@/components/UploadNoteModal'
import { AmbientGrid } from '@/components/AmbientGrid'
import './home.css'

const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8]

interface SubjectItem {
  id: string | number
  name: string
  code: string
  semesterNumber: number | null
  branchName: string
}

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {diagonal ? <path d="M6 18 18 6M6 6h12v12" /> : <path d="M4 12h15m-6-6 6 6-6 6" />}
    </svg>
  )
}

function Sparkle() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
    </svg>
  )
}

export default function CourseCatalogPage() {
  const [activeSem, setActiveSem] = useState(3)
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const subjectsQuery = trpc.notes.getSubjects.useQuery(
    { semester: activeSem },
    { staleTime: 1000 * 60 * 60, gcTime: 1000 * 60 * 60 },
  )
  const statsQuery = trpc.notes.getStats.useQuery()
  const subjects = (subjectsQuery.data ?? []) as SubjectItem[]

  return (
    <div className="lms-shell parsea-theme parsea-home">
      <AmbientGrid />
      <LMSNavbar onOpenUpload={() => setIsUploadOpen(true)} semester={activeSem} />
      <main className="home-content">
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-hero-copy">
            <span className="home-eyebrow">
              <span className="home-status-dot" /> A little clarity, every day
            </span>
            <h1 id="home-title">
              Less overwhelm.
              <br />
              More <span>understanding.</span>
            </h1>
            <p>
              Your notes, your subjects, and a little help when you need it. Make room for learning
              at your own pace.
            </p>
            <div className="home-hero-actions">
              <Link href="/chat" className="btn btn-primary">
                Start a study chat <Arrow />
              </Link>
              <a href="#your-subjects" className="btn btn-secondary">
                Explore your subjects
              </a>
            </div>
            <div className="home-hero-footnote">
              <span aria-hidden="true">✦</span> Big ideas. Small steps. You&apos;ve got this.
            </div>
          </div>
          <div className="home-visual" aria-label="An example of learning with Parsea">
            <div className="home-orbit home-orbit-one" aria-hidden="true" />
            <div className="home-orbit home-orbit-two" aria-hidden="true" />
            <div className="home-visual-top">
              <span>FROM “WHAT?” TO “GOT IT.”</span>
              <Sparkle />
            </div>
            <div className="home-note-tag">
              <span className="home-note-icon" aria-hidden="true">
                ↳
              </span>
              <div>
                <strong>Your course material</strong>
                <span>A starting point for every question</span>
              </div>
            </div>
            <div className="home-chat-preview">
              <div className="home-preview-header">
                <span className="home-preview-avatar">
                  <Sparkle />
                </span>
                <div>
                  <strong>Parsea</strong>
                  <span>Your study companion</span>
                </div>
                <span className="home-example-label">Example</span>
              </div>
              <div className="home-preview-question">
                Can you make the pigeonhole principle simpler?
              </div>
              <div className="home-preview-answer">
                <span className="home-answer-kicker">LET&apos;S BREAK IT DOWN</span>
                <p>Imagine 4 books and just 3 shelves.</p>
                <div className="home-shelves" aria-label="Four books placed on three shelves">
                  <span>
                    <i />
                    <i />
                  </span>
                  <span>
                    <i />
                  </span>
                  <span>
                    <i />
                  </span>
                </div>
                <p>
                  At least one shelf must hold <strong>more than one book.</strong> That&apos;s the
                  idea.
                </p>
              </div>
              <Link href="/chat" className="home-preview-prompt">
                <span>What would you like to understand?</span>
                <span className="home-prompt-arrow">
                  <Arrow />
                </span>
              </Link>
            </div>
            <div className="home-visual-footer">
              <span className="home-understood-mark" aria-hidden="true">
                ✓
              </span>
              <span>One concept clearer.</span>
              <span className="home-visual-flower" aria-hidden="true">
                ✳
              </span>
            </div>
          </div>
        </section>
        <div className="home-benefits" aria-label="Study tools">
          <span>
            <span aria-hidden="true">↳</span> Notes that stay together
          </span>
          <span>
            <span aria-hidden="true">✧</span> Explanations that click
          </span>
          <span>
            <span aria-hidden="true">◎</span> A pace that feels like yours
          </span>
        </div>
        <section className="home-curriculum" id="your-subjects" aria-labelledby="subjects-heading">
          <div className="home-section-heading">
            <div>
              <span className="home-kicker">YOUR LEARNING SPACE</span>
              <h2 id="subjects-heading">Pick up where you want to begin.</h2>
            </div>
            <Link href="/notes" className="home-text-link">
              All notes <Arrow diagonal />
            </Link>
          </div>
          <div className="home-semester-bar">
            <div className="home-semester-controls" role="group" aria-label="Choose your semester">
              <span>Semester</span>
              {SEMESTERS.map((sem) => (
                <button
                  key={sem}
                  type="button"
                  aria-pressed={activeSem === sem}
                  onClick={() => setActiveSem(sem)}
                  className={activeSem === sem ? 'is-selected' : ''}
                >
                  {sem}
                </button>
              ))}
            </div>
            <span className="home-library-count">
              {subjectsQuery.isLoading
                ? 'Finding your subjects…'
                : subjectsQuery.isError
                  ? 'Library unavailable'
                  : `${subjects.length} subject${subjects.length === 1 ? '' : 's'}`}
              {statsQuery.data
                ? ` · ${statsQuery.data.totalDocuments} materials in the library`
                : ''}
            </span>
          </div>
          {subjectsQuery.isLoading && (
            <div className="home-subject-grid" aria-busy="true" aria-label="Loading subjects">
              {[0, 1, 2].map((index) => (
                <div className="home-subject-skeleton" key={index}>
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          )}
          {subjectsQuery.isError && (
            <div className="home-empty" role="alert">
              <h3>Your subjects couldn&apos;t load just yet.</h3>
              <p>Give it another try. You can still open your notes or start a study chat.</p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => subjectsQuery.refetch()}
              >
                Try again
              </button>
            </div>
          )}
          {!subjectsQuery.isLoading && !subjectsQuery.isError && subjects.length === 0 && (
            <div className="home-empty">
              <span className="home-empty-mark" aria-hidden="true">
                ↳
              </span>
              <h3>A fresh space for Semester {activeSem}.</h3>
              <p>Try another semester, or add your subjects through the admin portal.</p>
              <Link href="/admin" className="btn btn-secondary">
                Manage subjects <Arrow diagonal />
              </Link>
            </div>
          )}
          {!subjectsQuery.isLoading && !subjectsQuery.isError && subjects.length > 0 && (
            <div className="home-subject-grid">
              {subjects.map((subject, index) => (
                <Link
                  key={subject.id}
                  href={`/notes?subject=${encodeURIComponent(subject.name)}&sem=${activeSem}`}
                  className={`home-subject-card home-subject-tone-${index % 3}`}
                >
                  <div className="home-subject-top">
                    <span className="home-subject-symbol" aria-hidden="true">
                      {subject.name
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((word) => word[0])
                        .join('')
                        .toUpperCase()}
                    </span>
                    <Arrow diagonal />
                  </div>
                  <span className="home-subject-code">
                    {subject.code || `SEMESTER ${subject.semesterNumber ?? activeSem}`}
                  </span>
                  <h3>{subject.name}</h3>
                  <p>{subject.branchName || 'Notes, PDFs & study help'}</p>
                  <span className="home-subject-bottom">
                    Explore subject <Arrow />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="home-tool-section" aria-labelledby="tools-heading">
          <div className="home-section-heading">
            <div>
              <span className="home-kicker">A LITTLE SUPPORT GOES A LONG WAY</span>
              <h2 id="tools-heading">Make the hard part a little easier.</h2>
            </div>
          </div>
          <div className="home-tools">
            <Link href="/notes" className="home-tool">
              <span className="home-tool-number">01 / ORGANISE</span>
              <h3>Everything has a place.</h3>
              <p>Find your material by subject and module. Less searching, more studying.</p>
              <span className="home-text-link">
                Open your library <Arrow />
              </span>
            </Link>
            <Link href="/chat" className="home-tool">
              <span className="home-tool-number">02 / UNDERSTAND</span>
              <h3>Ask the extra question.</h3>
              <p>Try a simpler explanation, a worked example, or a different way to see it.</p>
              <span className="home-text-link">
                Ask Parsea <Arrow />
              </span>
            </Link>
            <button type="button" className="home-tool" onClick={() => setIsUploadOpen(true)}>
              <span className="home-tool-number">03 / MAKE IT YOURS</span>
              <h3>Bring your own notes.</h3>
              <p>Add a PDF and keep your course material together in one familiar space.</p>
              <span className="home-text-link">
                Upload your notes <Arrow />
              </span>
            </button>
          </div>
        </section>
        <footer className="home-footer">
          <span>
            Parsea{' '}
            <span className="home-footer-star" aria-hidden="true">
              ✳
            </span>
          </span>
          <p>A calmer place to learn.</p>
          <a href="#home-title">Back to top ↑</a>
        </footer>
      </main>
      <UploadNoteModal isOpen={isUploadOpen} onClose={() => setIsUploadOpen(false)} />
    </div>
  )
}
