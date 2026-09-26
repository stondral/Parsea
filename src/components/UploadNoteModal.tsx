'use client'

import React, { useState } from 'react'
import { trpc } from '@/trpc/client'

interface UploadNoteModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function UploadNoteModal({ isOpen, onClose, onSuccess }: UploadNoteModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [chapter, setChapter] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [type, setType] = useState<'Notes' | 'PYQs' | 'Assignments'>('Notes')
  const [isUploading, setIsUploading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const subjectsQuery = trpc.notes.getSubjects.useQuery(undefined, {
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
  })

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
      if (!name) {
        const cleanName = selected.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ')
        setName(cleanName)
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

      const res = await fetch('/api/notes/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed.')

      setSuccessMsg('Uploaded! Ingestion & pgvector indexing complete.')
      utils.notes.list.invalidate()
      utils.notes.getStats.invalidate()

      setTimeout(() => {
        setIsUploading(false)
        setFile(null)
        setName('')
        setChapter('')
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
          {successMsg && <div className="alert alert-success">✓ {successMsg}</div>}

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
              <span className="file-drop-icon">PDF</span>
              <p className={`file-drop-label${file ? ' has-file' : ''}`}>
                {file ? file.name : 'Click to browse or drag & drop a PDF'}
              </p>
              {file && (
                <span className="file-drop-size">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              )}
            </div>
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
                onChange={(e) => setSubjectId(e.target.value)}
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
