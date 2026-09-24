import React from 'react'
import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { notFound } from 'next/navigation'

interface PDFPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ page?: string }>
}

export default async function PDFViewerPage(props: PDFPageProps) {
  const params = await props.params
  const searchParams = await props.searchParams
  const pageNumber = searchParams.page ? parseInt(searchParams.page, 10) : 1

  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })

  let doc: any = null
  try {
    const docId = isNaN(Number(params.id)) ? params.id : Number(params.id)
    doc = await payload.findByID({
      collection: 'documents',
      id: docId,
      depth: 2,
    })
  } catch {
    return notFound()
  }

  if (!doc || !doc.filename) {
    return notFound()
  }

  const pdfUrl = `/api/documents/file/${encodeURIComponent(doc.filename)}#page=${pageNumber}`
  const subjectName = typeof doc.subject === 'object' ? doc.subject?.name : 'Academic Notes'
  const chapterName = doc.chapter || doc.name

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#0f172a', color: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Top Navigation & Metadata Toolbar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          backgroundColor: '#1e293b',
          borderBottom: '1px solid #334155',
          height: 60,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link
            href="/chat"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: '#94a3b8',
              textDecoration: 'none',
              fontSize: '0.9rem',
              fontWeight: 500,
              padding: '6px 12px',
              borderRadius: 6,
              backgroundColor: '#0f172a',
              border: '1px solid #334155',
              transition: 'color 0.15s ease',
            }}
          >
            ← Back to Chat
          </Link>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '1rem', fontWeight: 600, color: '#f8fafc' }}>
              📄 {doc.name}
            </span>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              {subjectName} • {chapterName}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              backgroundColor: '#2563eb',
              color: '#ffffff',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            Jumped to Page {pageNumber}
          </span>
          <a
            href={`/api/documents/file/${encodeURIComponent(doc.filename)}`}
            download
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '6px 12px',
              borderRadius: 6,
              backgroundColor: '#334155',
              color: '#cbd5e1',
              fontSize: '0.85rem',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            ⬇ Download PDF
          </a>
        </div>
      </header>

      {/* Embedded Native Browser PDF Viewer */}
      <div style={{ flex: 1, position: 'relative', width: '100%', height: 'calc(100vh - 60px)' }}>
        <iframe
          src={pdfUrl}
          title={doc.name}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
          }}
        />
      </div>
    </div>
  )
}
