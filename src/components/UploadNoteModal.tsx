'use client'

import React, { useEffect, useState, useRef, useId } from 'react'
import { trpc } from '@/trpc/client'
import { classifyDocumentFilename } from '@/lib/documentClassification'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { estimateUploadProgress } from '@/lib/uploadProgress'
import './upload.css'

interface UploadNoteModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
  initialSubjectId?: string
  initialModuleId?: string
  initialTopicId?: string
}

interface UploadEntry {
  id: string
  file: File
  title: string
  status: 'ready' | 'uploading' | 'uploaded' | 'failed'
  error?: string
}

function findLikelySubject(
  filename: string,
  subjects: Array<{ id: string | number; name: string }>,
) {
  const normalizedFilename = filename.toLowerCase().replace(/[^a-z0-9]/g, '')
  return subjects.find((subject) => {
    const normalizedName = subject.name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const words = subject.name.toLowerCase().match(/[a-z]{4,}/g) || []
    return (
      (normalizedName.length > 3 && normalizedFilename.includes(normalizedName)) ||
      (words.length > 0 && words.every((word) => filename.toLowerCase().includes(word)))
    )
  })
}

export function UploadNoteModal({
  isOpen,
  onClose,
  onSuccess,
  initialSubjectId = '',
  initialModuleId = '',
  initialTopicId = '',
}: UploadNoteModalProps) {
  const [uploads, setUploads] = useState<UploadEntry[]>([])
  const [subjectId, setSubjectId] = useState(initialSubjectId)
  const [moduleId, setModuleId] = useState(initialModuleId)
  const [topicId, setTopicId] = useState(initialTopicId)
  const [chapter, setChapter] = useState('')
  const [type, setType] = useState<'Notes' | 'PYQs' | 'Assignments'>('Notes')
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [activeStartedAt, setActiveStartedAt] = useState(0)
  const [progressNow, setProgressNow] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const fileInputId = useId()
  const titleId = useId()
  const utils = trpc.useUtils()
  const subjectsQuery = trpc.notes.getSubjects.useQuery(undefined, {
    enabled: isOpen,
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })
  const modulesQuery = trpc.notes.getModules.useQuery(
    { subjectId },
    { enabled: isOpen && Boolean(subjectId), staleTime: 60 * 60 * 1000 },
  )
  const topicsQuery = trpc.notes.getTopics.useQuery(
    { moduleId },
    { enabled: isOpen && Boolean(moduleId), staleTime: 60 * 60 * 1000 },
  )
  const completed = uploads.filter((entry) => entry.status === 'uploaded').length
  const pending = uploads.filter((entry) => entry.status !== 'uploaded')
  const firstFile = uploads[0]?.file
  const activeFile = uploads.find((entry) => entry.status === 'uploading')
  const estimate = estimateUploadProgress(progressNow - activeStartedAt)
  const batchPercent = uploads.length ? Math.round((completed + (activeFile ? estimate.percent / 100 : 0)) / uploads.length * 100) : 0

  useEffect(() => {
    if (!isUploading) return
    const timer = window.setInterval(() => setProgressNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isUploading])

  useDialogFocus(isOpen, dialogRef, () => {
    if (!isUploading) onClose()
  })
  useEffect(() => {
    if (!isOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      setUploads([])
      setError('')
      setChapter('')
      setIsUploading(false)
      return
    }
    setSubjectId(initialSubjectId)
    setModuleId(initialModuleId)
    setTopicId(initialTopicId)
  }, [isOpen, initialSubjectId, initialModuleId, initialTopicId])

  useEffect(() => {
    if (!firstFile || subjectId || !subjectsQuery.data) return
    const likely = findLikelySubject(firstFile.name, subjectsQuery.data)
    if (likely) setSubjectId(String(likely.id))
  }, [firstFile, subjectId, subjectsQuery.data])

  function addFiles(files: File[]) {
    if (isUploading) return
    const valid = files.filter(
      (file) => file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf',
    )
    setError(
      valid.length !== files.length
        ? 'Only PDF files were added. Please select PDFs for this batch.'
        : '',
    )
    setUploads((previous) => {
      const existing = new Set(
        previous.map((entry) => `${entry.file.name}:${entry.file.size}:${entry.file.lastModified}`),
      )
      return [
        ...previous,
        ...valid
          .filter((file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`))
          .map((file) => ({
            id: crypto.randomUUID(),
            file,
            title: classifyDocumentFilename(file.name).title,
            status: 'ready' as const,
          })),
      ]
    })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (
      !subjectId ||
      !pending.length ||
      pending.some((entry) => !entry.title.trim()) ||
      isUploading
    )
      return
    setIsUploading(true)
    setError('')
    let successful = 0
    let failed = 0
    for (const entry of pending) {
      const startedAt = Date.now()
      setActiveStartedAt(startedAt)
      setProgressNow(startedAt)
      setUploads((previous) =>
        previous.map((item) =>
          item.id === entry.id ? { ...item, status: 'uploading', error: undefined } : item,
        ),
      )
      const data = new FormData()
      data.append('file', entry.file)
      data.append('name', entry.title.trim())
      data.append('chapter', chapter.trim())
      data.append('type', type)
      data.append('subject', subjectId)
      if (moduleId) data.append('module', moduleId)
      if (topicId) data.append('topic', topicId)
      try {
        const response = await fetch('/api/notes/upload', { method: 'POST', body: data })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error || 'Upload failed. Please try again.')
        successful++
        setUploads((previous) =>
          previous.map((item) => (item.id === entry.id ? { ...item, status: 'uploaded' } : item)),
        )
      } catch (uploadError) {
        failed++
        setUploads((previous) =>
          previous.map((item) =>
            item.id === entry.id
              ? {
                  ...item,
                  status: 'failed',
                  error: uploadError instanceof Error ? uploadError.message : 'Upload failed.',
                }
              : item,
          ),
        )
      }
    }
    setIsUploading(false)
    if (successful) {
      await Promise.all([
        utils.notes.list.invalidate(),
        utils.notes.getStats.invalidate(),
        utils.notes.getSubjects.invalidate(),
        utils.notes.getModules.invalidate(),
        utils.notes.getTopics.invalidate(),
      ])
      onSuccess?.()
    }
    if (failed)
      setError(
        `${failed} file${failed === 1 ? '' : 's'} couldn’t upload. Successful files stay saved; retry only the failed ones.`,
      )
  }

  if (!isOpen) return null
  return (
    <div
      className="parsea-upload-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isUploading) onClose()
      }}
    >
      <div
        className="parsea-upload-dialog modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="parsea-upload-header">
          <div>
            <span>MAKE IT YOURS</span>
            <h2 id={titleId}>Bring your notes.</h2>
            <p>One module. As many PDFs as you need.</p>
          </div>
          <button
            type="button"
            aria-label="Close upload dialog"
            onClick={onClose}
            disabled={isUploading}
          >
            ×
          </button>
        </header>
        <form onSubmit={handleSubmit} className="parsea-upload-form" aria-busy={isUploading}>
          {error && (
            <p className="parsea-upload-error" role="alert">
              {error}
            </p>
          )}
          <div
            className={`parsea-upload-drop${dragActive ? ' is-dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              if (!isUploading) setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragActive(false)
              addFiles(Array.from(event.dataTransfer.files))
            }}
          >
            <input
              id={fileInputId}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              disabled={isUploading}
              aria-label="Choose PDF files"
              onChange={(event) => {
                addFiles(Array.from(event.target.files || []))
                event.target.value = ''
              }}
            />
            <span aria-hidden="true">↑</span>
            <strong>Drop your PDFs here</strong>
            <p>or click to choose several files at once</p>
          </div>
          {uploads.length > 0 && (
            <div className="parsea-upload-queue">
              <div className={`parsea-upload-progress${isUploading ? ' is-working' : ''}`}>
                <div className="parsea-upload-progress-heading"><strong>{isUploading ? 'A little closer to a clearer library.' : `${completed} of ${uploads.length} PDFs saved`}</strong><span>{batchPercent}%{isUploading ? ' est.' : ''}</span></div>
                <div className="parsea-upload-meter" role="progressbar" aria-valuenow={batchPercent} aria-valuemin={0} aria-valuemax={100} aria-label={isUploading ? 'Estimated batch upload progress' : 'Confirmed batch upload progress'} aria-valuetext={`${completed} of ${uploads.length} PDFs saved${isUploading ? '; remaining progress is estimated' : ''}`}><span style={{ width: `${batchPercent}%` }} /></div>
                <p role="status" aria-live="polite">{isUploading ? estimate.message : completed === uploads.length ? 'All uploads confirmed. Your notes have a home.' : 'Your PDFs are ready when you are.'}</p>
                {isUploading && <small>{completed} of {uploads.length} saved · {activeFile?.file.name}<br />Estimated progress, not a live indexing measurement. Completion waits for the server.</small>}
              </div>
              {uploads.map((entry) => (
                <div key={entry.id} className="parsea-upload-entry" data-status={entry.status}>
                  <div>
                    <label>
                      <span className="parsea-upload-filename">{entry.file.name}</span>
                      <input
                        aria-label={`Title for ${entry.file.name}`}
                        value={entry.title}
                        onChange={(event) =>
                          setUploads((previous) =>
                            previous.map((item) =>
                              item.id === entry.id ? { ...item, title: event.target.value } : item,
                            ),
                          )
                        }
                        disabled={isUploading || entry.status === 'uploaded'}
                        required
                      />
                    </label>
                    <span className="parsea-upload-file-status">
                      {entry.status === 'uploaded'
                        ? '✓ Uploaded'
                        : entry.status === 'uploading'
                          ? 'Processing…'
                          : entry.status === 'failed'
                            ? entry.error
                            : `${(entry.file.size / (1024 * 1024)).toFixed(2)} MB · Ready`}
                    </span>
                  </div>
                  {entry.status !== 'uploaded' && (
                    <button
                      type="button"
                      aria-label={`Remove ${entry.file.name}`}
                      disabled={isUploading}
                      onClick={() =>
                        setUploads((previous) => previous.filter((item) => item.id !== entry.id))
                      }
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="parsea-upload-grid">
            <label>
              <span>Subject / course</span>
              <select
                value={subjectId}
                required
                disabled={isUploading || subjectsQuery.isLoading}
                onChange={(event) => {
                  setSubjectId(event.target.value)
                  setModuleId('')
                  setTopicId('')
                }}
              >
                <option value="">Choose a subject</option>
                {subjectsQuery.data?.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                    {subject.semesterNumber ? ` · Semester ${subject.semesterNumber}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Material type</span>
              <select
                value={type}
                disabled={isUploading}
                onChange={(event) => setType(event.target.value as typeof type)}
              >
                <option value="Notes">Notes</option>
                <option value="PYQs">Past papers</option>
                <option value="Assignments">Assignments</option>
              </select>
            </label>
            <label>
              <span>
                Module <small>optional</small>
              </span>
              <select
                value={moduleId}
                disabled={isUploading || !subjectId || modulesQuery.isLoading}
                onChange={(event) => {
                  setModuleId(event.target.value)
                  setTopicId('')
                }}
              >
                <option value="">
                  {subjectId ? 'Use filename or general notes' : 'Choose a subject first'}
                </option>
                {modulesQuery.data?.map((module) => (
                  <option key={module.id} value={module.id}>
                    Module {module.number}: {module.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>
                Topic / submodule <small>optional</small>
              </span>
              <select
                value={topicId}
                disabled={isUploading || !moduleId || topicsQuery.isLoading}
                onChange={(event) => setTopicId(event.target.value)}
              >
                <option value="">
                  {moduleId ? 'Use each filename or no submodule' : 'Choose a module first'}
                </option>
                {topicsQuery.data?.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.number}: {topic.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(subjectsQuery.isError || modulesQuery.isError || topicsQuery.isError) && (
            <p className="parsea-upload-error" role="alert">
              Some folders couldn’t load.{' '}
              <button
                type="button"
                onClick={() => {
                  subjectsQuery.refetch()
                  if (subjectId) modulesQuery.refetch()
                  if (moduleId) topicsQuery.refetch()
                }}
              >
                Try again
              </button>
            </p>
          )}
          <label className="parsea-upload-chapter">
            <span>
              Chapter or context <small>optional · applies to this batch</small>
            </span>
            <input
              value={chapter}
              disabled={isUploading}
              onChange={(event) => setChapter(event.target.value)}
              placeholder="e.g. Logic, proofs, and worked examples"
            />
          </label>
          <p className="parsea-upload-hint">
            {moduleId
              ? 'All PDFs will go into the selected module. Leave the submodule blank to sort each file by its own filename.'
              : 'Choose one folder for the batch, or let “Module 1” and “1.1” in each filename help sort your files.'}{' '}
            Each PDF stays separate and uses the existing R2 + embedding pipeline.
          </p>
          <footer className="parsea-upload-footer">
            <button
              type="button"
              className="parsea-upload-secondary"
              onClick={onClose}
              disabled={isUploading}
            >
              {completed === uploads.length && completed > 0 ? 'Done' : 'Cancel'}
            </button>
            {pending.length > 0 || uploads.length === 0 ? (
              <button
                type="submit"
                className="parsea-upload-primary"
                disabled={
                  isUploading ||
                  !subjectId ||
                  !pending.length ||
                  pending.some((entry) => !entry.title.trim())
                }
              >
                {isUploading
                  ? 'Uploading your notes…'
                  : uploads.some((entry) => entry.status === 'failed')
                    ? `Retry ${pending.length} file${pending.length === 1 ? '' : 's'}`
                    : `Upload ${pending.length || ''} PDF${pending.length === 1 ? '' : 's'}`}
              </button>
            ) : (
              <span className="parsea-upload-complete" role="status">
                All PDFs uploaded. Nice work.
              </span>
            )}
          </footer>
        </form>
      </div>
    </div>
  )
}
