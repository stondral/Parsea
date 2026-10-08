'use client'

import React, { useEffect, useState } from 'react'
import { trpc } from '@/trpc/client'
import { classifyDocumentFilename, type FilenameClassification } from '@/lib/documentClassification'

interface UploadNoteModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

function findLikelySubject(filename: string, subjects: Array<{ id: string | number; name: string }>) {
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

export function UploadNoteModal({ isOpen, onClose, onSuccess }: UploadNoteModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [chapter, setChapter] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [filenameInfo, setFilenameInfo] = useState<FilenameClassification | null>(null)
  const [type, setType] = useState<'Notes' | 'PYQs' | 'Assignments'>('Notes')
  const [isUploading, setIsUploading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const subjectsQuery = trpc.notes.getSubjects.useQuery(undefined, {
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
  })
  const modulesQuery = trpc.notes.getModules.useQuery(
    { subjectId },
    { enabled: Boolean(subjectId), staleTime: 1000 * 60 * 60 },
  )
  const topicsQuery = trpc.notes.getTopics.useQuery(
    { moduleId },
    { enabled: Boolean(moduleId), staleTime: 1000 * 60 * 60 },
  )

  useEffect(() => {
    if (!file || subjectId || !subjectsQuery.data) return
    const likelySubject = findLikelySubject(file.name, subjectsQuery.data)
    if (likelySubject) setSubjectId(String(likelySubject.id))
  }, [file, subjectId, subjectsQuery.data])

  useEffect(() => {
    if (!filenameInfo?.moduleNumber || moduleId || !modulesQuery.data) return
    const matchingModule = modulesQuery.data.find((module) => module.number === filenameInfo.moduleNumber)
    if (matchingModule) setModuleId(String(matchingModule.id))
  }, [filenameInfo, moduleId, modulesQuery.data])

  useEffect(() => {
    if (!filenameInfo?.topicNumber || topicId || !topicsQuery.data) return
    const matchingTopic = topicsQuery.data.find((topic) => topic.number === filenameInfo.topicNumber)
    if (matchingTopic) setTopicId(String(matchingTopic.id))
  }, [filenameInfo, topicId, topicsQuery.data])

  if (!isOpen) return null

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0]
      if (!selected.name.toLowerCase().endsWith('.pdf') && selected.type !== 'application/pdf') {
        setErrorMsg('Please select a valid PDF document.')
        return
      }
      setFile(selected)
      setErrorMsg(null)
      const classification = classifyDocumentFilename(selected.name)
      setFilenameInfo(classification)
      if (!name) {
        setName(classification.title)
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) { setErrorMsg('Please select a PDF file.'); return }
    if (!name.trim()) { setErrorMsg('Please provide a document title.'); return }

    setIsUploading(true)
    setErrorMsg(null)
    setSuccessMsg(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('name', name.trim())
      formData.append('chapter', chapter.trim())
      formData.append('type', type)
      if (subjectId) formData.append('subject', subjectId)
      if (moduleId) formData.append('module', moduleId)
      if (topicId) formData.append('topic', topicId)

      const res = await fetch('/api/notes/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed.')

      setSuccessMsg('Uploaded! Ingestion & pgvector indexing complete.')
      utils.notes.list.invalidate()
      utils.notes.getStats.invalidate()
      utils.notes.getModules.invalidate()
      utils.notes.getTopics.invalidate()

      setTimeout(() => {
        setIsUploading(false)
        setFile(null)
        setName('')
        setChapter('')
        setModuleId('')
        setTopicId('')
        setFilenameInfo(null)
        setSuccessMsg(null)
        if (onSuccess) onSuccess()
        onClose()
      }, 1400)
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during upload.')
      setIsUploading(false)
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget && !isUploading) onClose() }}
    >
      <div className="modal">
        {/* Header */}
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Upload Academic Notes</h2>
            <p className="modal-subtitle">Stores to Cloudflare R2 · builds pgvector embeddings</p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={isUploading}
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="modal-body">
          {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
          {successMsg && <div className="alert alert-success"><svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 5 }}><polyline points="1.5,6.5 5,10 11.5,3"/></svg> {successMsg}</div>}

          {/* File drop zone */}
          <div className="form-group">
            <label className="form-label form-label-required">PDF Document</label>
            <div
              className="file-drop"
              onClick={() => document.getElementById('note-file-input')?.click()}
            >
              <input
                id="note-file-input"
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileChange}
                disabled={isUploading}
                style={{ display: 'none' }}
              />
              <span className="file-drop-icon">
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto', display: 'block', color: 'var(--text-muted)' }}><path d="M6 26v2a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2v-2"/><polyline points="12,14 18,8 24,14"/><line x1="18" y1="8" x2="18" y2="24"/></svg>
              </span>
              <p className={`file-drop-label${file ? ' has-file' : ''}`}>
                {file ? file.name : 'Click to browse or drag & drop a PDF'}
              </p>
              {file && (
                <span className="file-drop-size">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              )}
            </div>
            {filenameInfo?.moduleNumber && (
              <p className="form-hint">
                ✨ We found Module {filenameInfo.moduleNumber}
                {filenameInfo.topicNumber ? ` · Topic ${filenameInfo.topicNumber}` : ''} in the filename. We’ll file it there automatically.
              </p>
            )}
          </div>

          {/* Document title */}
          <div className="form-group">
            <label className="form-label form-label-required">Document Title</label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Module 3 – Graph Theory & Proofs"
              disabled={isUploading}
              required
            />
          </div>

          {/* Chapter */}
          <div className="form-group">
            <label className="form-label">Chapter / Unit / Topic</label>
            <input
              type="text"
              className="form-input"
              value={chapter}
              onChange={(e) => setChapter(e.target.value)}
              placeholder="e.g. Unit 3: Graph Traversal, Trees & Flow"
              disabled={isUploading}
            />
          </div>

          {/* Subject + Type */}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Subject / Course</label>
              <select
                className="form-select"
                value={subjectId}
                onChange={(e) => { setSubjectId(e.target.value); setModuleId(''); setTopicId('') }}
                disabled={isUploading}
              >
                <option value="">General / No subject</option>
                {subjectsQuery.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.semesterNumber ? ` (Sem ${s.semesterNumber})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Material Type</label>
              <select
                className="form-select"
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                disabled={isUploading}
              >
                <option value="Notes">Notes</option>
                <option value="PYQs">PYQs (Past Papers)</option>
                <option value="Assignments">Assignments</option>
              </select>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Module <span className="form-label-optional">optional</span></label>
              <select
                className="form-select"
                value={moduleId}
                onChange={(e) => { setModuleId(e.target.value); setTopicId('') }}
                disabled={isUploading || !subjectId}
              >
                <option value="">{subjectId ? 'No module — upload as general notes' : 'Choose a subject first'}</option>
                {modulesQuery.data?.map((module) => (
                  <option key={module.id} value={module.id}>
                    Module {module.number}: {module.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Topic / submodule <span className="form-label-optional">optional</span></label>
              <select
                className="form-select"
                value={topicId}
                onChange={(e) => setTopicId(e.target.value)}
                disabled={isUploading || !moduleId}
              >
                <option value="">{moduleId ? 'No submodule' : 'Choose a module first'}</option>
                {topicsQuery.data?.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.number}: {topic.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Actions */}
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isUploading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isUploading || !file || !name.trim()}
            >
              {isUploading ? (
                <>
                  <span className="btn-spinner" />
                  Processing & Ingesting…
                </>
              ) : (
                'Upload & Index Note'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
