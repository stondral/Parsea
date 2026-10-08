'use client'

import { useState } from 'react'
import { useFormFields } from '@payloadcms/ui'
import { TRPCProvider } from '@/trpc/Provider'
import { UploadNoteModal } from '@/components/UploadNoteModal'

function relationshipId(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && 'id' in value) return String(value.id)
  return ''
}

/** Batch shortcut on the single-document form, reusing the student ingestion flow. */
export function AdminBatchUpload() {
  const [open, setOpen] = useState(false)
  const subject = useFormFields(([fields]) => fields.subject?.value)
  const module = useFormFields(([fields]) => fields.module?.value)
  const topic = useFormFields(([fields]) => fields.topic?.value)
  return (
    <TRPCProvider>
      <div className="parsea-admin-batch">
        <p>
          Building a module library? Upload several PDFs together. Pick a subject and module below
          first, or choose them in the batch uploader. Each PDF becomes its own document.
        </p>
        <button type="button" onClick={() => setOpen(true)}>
          Upload multiple PDFs to a module ↗
        </button>
      </div>
      <UploadNoteModal
        isOpen={open}
        onClose={() => setOpen(false)}
        initialSubjectId={relationshipId(subject)}
        initialModuleId={relationshipId(module)}
        initialTopicId={relationshipId(topic)}
      />
    </TRPCProvider>
  )
}
