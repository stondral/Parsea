'use client'

import React, { useEffect, useState, useRef, useId } from 'react'
import { trpc } from '@/trpc/client'
import { classifyDocumentFilename } from '@/lib/documentClassification'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import {
  uploadPDFDirect,
  smallPDFBase64,
  PDFContentHash,
  finishIndexingJob,
} from '@/lib/directUpload'
import './upload.css'

interface UploadNoteModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
  initialSubjectId?: string
  initialModuleId?: string
  initialTopicId?: string
  replaceDocumentId?: number
  initialTitle?: string
  administrator?: boolean
}

interface UploadEntry {
  id: string
  file: File
  title: string
  status: 'ready' | 'uploading' | 'uploaded' | 'failed'
  error?: string
  saved?: boolean
  progress?: number
  stage?: string
  jobId?: string
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
  replaceDocumentId,
  initialTitle = '',
  administrator = false,
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
  const [autoStart, setAutoStart] = useState(true)
  const [jobId, setJobId] = useState('')
  const submitting = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const fileInputId = useId()
  const titleId = useId()
  const utils = trpc.useUtils()
  const prepareUpload = trpc.uploads.prepareUpload.useMutation()
  const uploadSmallPDF = trpc.uploads.uploadSmallPDF.useMutation()
  const completeUpload = trpc.uploads.completeUpload.useMutation()
  const processUpload = trpc.uploads.processUpload.useMutation()
  const recent = trpc.uploads.myUploads.useQuery(undefined, { enabled: isOpen, retry: false })
  const job = trpc.uploads.uploadStatus.useQuery(
    { id: jobId },
    {
      enabled: Boolean(jobId),
      refetchInterval: isUploading ? 1500 : false,
    },
  )
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
  const saved = uploads.filter((entry) => entry.saved || entry.status === 'uploaded').length
  const batchPercent = uploads.length
    ? Math.floor(uploads.reduce((sum, entry) => sum + (entry.progress || 0), 0) / uploads.length)
    : 0

  function updateEntry(id: string, patch: Partial<UploadEntry>) {
    setUploads((previous) =>
      previous.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    )
  }

  useEffect(() => {
    if (!job.data || job.data.id !== jobId) return
    const data = job.data
    setUploads((previous) =>
      previous.map((entry) =>
        entry.jobId === jobId && entry.status === 'uploading'
          ? {
              ...entry,
              progress: Math.max(entry.progress || 20, Math.min(99, 20 + data.progress * 0.8)),
              stage: data.stage,
            }
          : entry,
      ),
    )
  }, [job.data, jobId])

  useEffect(() => {
    if (
      !autoStart ||
      !isOpen ||
      isUploading ||
      submitting.current ||
      !subjectId ||
      !uploads.some((entry) => entry.status === 'ready')
    )
      return
    // A brief undo window lets the admin turn off auto-start or change the folder.
    const timer = window.setTimeout(() => {
      void handleSubmit()
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [
    administrator,
    autoStart,
    isOpen,
    isUploading,
    subjectId,
    moduleId,
    topicId,
    uploads,
    chapter,
    type,
  ])

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
      (file) =>
        (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') &&
        file.size > 0 &&
        file.size <= 25 * 1024 * 1024,
    )
    setError(
      valid.length !== files.length
        ? 'Only non-empty PDFs up to 25 MB were added. Split larger PDFs into module files.'
        : '',
    )
    setUploads((previous) => {
      const existing = new Set(
        previous.map((entry) => `${entry.file.name}:${entry.file.size}:${entry.file.lastModified}`),
      )
      return [
        ...(replaceDocumentId ? [] : previous),
        ...valid
          .filter((file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`))
          .slice(0, replaceDocumentId ? 1 : undefined)
          .map((file) => ({
            id: crypto.randomUUID(),
            file,
            title:
              initialTitle ||
              (/^\d+$/.test(classifyDocumentFilename(file.name).title)
                ? `Study notes ${classifyDocumentFilename(file.name).title}`
                : classifyDocumentFilename(file.name).title),
            status: 'ready' as const,
          })),
      ]
    })
  }

  async function finishIndexing(id: string) {
    const result = await finishIndexingJob(id, (input) => processUpload.mutateAsync(input))
    await recent.refetch()
    return result
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault()
    if (
      !subjectId ||
      !pending.length ||
      pending.some((entry) => !entry.title.trim()) ||
      isUploading ||
      submitting.current
    )
      return
    submitting.current = true
    setIsUploading(true)
    setError('')
    let successful = 0
    let failed = 0
    // Transfer the next PDF while one indexing lane consumes saved files.
    // Preparation stays serial to avoid racing inferred curriculum creation.
    let indexing = Promise.resolve()
    for (const entry of pending) {
      setUploads((previous) =>
        previous.map((item) =>
          item.id === entry.id ? { ...item, status: 'uploading', error: undefined } : item,
        ),
      )
      try {
        {
          updateEntry(entry.id, { progress: 0, stage: 'Checking PDF…' })
          const prepared = await prepareUpload.mutateAsync({
            requestId: entry.id,
            contentHash: await PDFContentHash(entry.file),
            originalFilename: entry.file.name,
            bytes: entry.file.size,
            name: entry.title.trim(),
            chapter: chapter.trim(),
            type,
            subject: Number(subjectId),
            module: Number(moduleId) || undefined,
            topic: Number(topicId) || undefined,
            replaceDocumentId,
          })
          updateEntry(entry.id, { jobId: prepared.id, stage: 'Uploading PDF…' })
          if (prepared.url) {
            try {
              await uploadPDFDirect(prepared.url, entry.file, (percent) =>
                updateEntry(entry.id, {
                  progress: percent * 0.2,
                  stage: `Uploading PDF · ${percent}% transferred`,
                }),
              )
            } catch (error) {
              if (entry.file.size > 3 * 1024 * 1024) throw error
              await uploadSmallPDF.mutateAsync({
                id: prepared.id,
                base64: await smallPDFBase64(entry.file),
              })
            }
          }
          await completeUpload.mutateAsync({ id: prepared.id })
          updateEntry(entry.id, {
            saved: true,
            progress: 20,
            stage: 'Safely uploaded · waiting to index',
          })
          indexing = indexing.then(async () => {
            setJobId(prepared.id)
            updateEntry(entry.id, { stage: 'Reading the PDF…' })
            try {
              await finishIndexing(prepared.id)
              successful++
              updateEntry(entry.id, { status: 'uploaded', progress: 100, stage: 'Ready to study' })
            } catch (error) {
              failed++
              updateEntry(entry.id, {
                status: 'failed',
                error: error instanceof Error ? error.message : 'Indexing failed.',
              })
            }
          })
        }
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
    await indexing
    setIsUploading(false)
    submitting.current = false
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
        `${failed} file${failed === 1 ? '' : 's'} need attention. Safely uploaded files stay saved; retry resumes the failed steps.`,
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
        className="parsea-upload-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="parsea-upload-header">
          <div>
            <span>MAKE IT YOURS</span>
            <h2 id={titleId}>
              {replaceDocumentId ? 'Replace and re-index PDF.' : 'Bring your notes.'}
            </h2>
            <p>
              {replaceDocumentId
                ? 'Keep this document ID and links. Choose one replacement PDF.'
                : 'One module. As many PDFs as you need.'}
            </p>
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
        {Boolean(recent.data?.length) && (
          <details>
            <summary>Your recent uploads</summary>
            {recent.data?.map((item) => (
              <p key={item.id}>
                {item.filename} · {item.stage} · {item.progress}%{' '}
                {item.document_id && <a href={`/pdf/${item.document_id}`}>Read PDF</a>}
                {['queued', 'failed', 'running'].includes(item.status) && (
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={async () => {
                      setIsUploading(true)
                      setJobId(item.id)
                      setError('')
                      try {
                        await finishIndexing(item.id)
                        onSuccess?.()
                      } catch (error) {
                        setError(
                          error instanceof Error ? error.message : 'Could not resume indexing.',
                        )
                      } finally {
                        setIsUploading(false)
                      }
                    }}
                  >
                    Resume indexing
                  </button>
                )}
              </p>
            ))}
          </details>
        )}
        <form onSubmit={handleSubmit} className="parsea-upload-form" aria-busy={isUploading}>
          {
            <label>
              <input
                type="checkbox"
                checked={autoStart}
                disabled={isUploading}
                onChange={(event) => setAutoStart(event.target.checked)}
              />{' '}
              Start automatically once a subject is selected
            </label>
          }
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
                <div className="parsea-upload-progress-heading">
                  <strong>
                    {isUploading
                      ? `${saved} of ${uploads.length} safely uploaded`
                      : `${completed} of ${uploads.length} PDFs saved`}
                  </strong>
                  <span>{batchPercent}%</span>
                </div>
                <div
                  className="parsea-upload-meter"
                  role="progressbar"
                  aria-valuenow={batchPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={'Confirmed batch upload progress'}
                  aria-valuetext={`${saved} safely uploaded; ${completed} of ${uploads.length} ready to study`}
                >
                  <span style={{ width: `${batchPercent}%` }} />
                </div>
                <p role="status" aria-live="polite">
                  {isUploading
                    ? (job.data?.id === jobId ? job.data.stage : activeFile?.stage) ||
                      'Preparing PDFs…'
                    : completed === uploads.length
                      ? 'All uploads confirmed. Your notes have a home.'
                      : 'Your PDFs are ready when you are.'}
                </p>
                {isUploading && (
                  <small>
                    {completed} of {uploads.length} ready to study · {activeFile?.file.name}
                    <br />
                    Live transfer and indexing stages. Overall percentage is stage-weighted; 100%
                    requires server confirmation.
                  </small>
                )}
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
                          ? entry.stage || 'Preparing…'
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
                  ? saved === uploads.length
                    ? 'Preparing your notes…'
                    : 'Uploading your notes…'
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
