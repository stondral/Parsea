import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { notFound } from 'next/navigation'
import { getPresignedDownloadUrl } from '@/lib/r2'
import { PDFCircleSearch } from '@/components/PDFCircleSearch'
import { buildDownloadFilename } from '@/lib/documentClassification'
import {
  PAGE_ORIENTATION_VERSION,
  normalizeRotation,
  type PageOrientation,
} from '@/lib/pageOrientation'

interface PDFPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ page?: string }>
}

interface ExtractedVisual {
  url: string
  page: number
  caption: string
}

export default async function PDFViewerPage(props: PDFPageProps) {
  const params = await props.params
  const searchParams = await props.searchParams
  const requestedPage = Number(searchParams.page)
  const pageNumber = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1

  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })

  const docId = isNaN(Number(params.id)) ? params.id : Number(params.id)
  let doc: any = null

  try {
    doc = await payload.findByID({
      collection: 'documents',
      id: docId,
      depth: 2,
    })
  } catch {
    return notFound()
  }

  if (!doc || !doc.filename) return notFound()

  let directPdfUrl = `/api/documents/file/${encodeURIComponent(doc.filename)}`
  const downloadFilename = buildDownloadFilename({
    subjectName: doc.subject?.name || 'Academic Notes',
    moduleNumber: doc.module?.number,
    moduleName: doc.module?.name,
    topicNumber: doc.topic?.number,
    topicName: doc.topic?.name,
    title: doc.name,
    originalFilename: doc.filename,
  })
  let downloadUrl = directPdfUrl
  let isR2 = false

  if (doc.storageKey) {
    try {
      directPdfUrl = await getPresignedDownloadUrl(doc.storageKey, doc.r2Bucket || undefined)
      downloadUrl = await getPresignedDownloadUrl(
        doc.storageKey,
        doc.r2Bucket || undefined,
        3600,
        downloadFilename,
      )
      isR2 = true
    } catch (error) {
      console.error('Failed generating R2 presigned URL:', error)
    }
  }

  // Vercel cannot serve uploads from a previous function's local filesystem.
  // Do not embed a known-invalid local endpoint and present its JSON as a PDF.
  const unavailableOnVercel = process.env.VERCEL === '1' && !isR2

  const savedPages = await payload.find({
    collection: 'document_pages',
    depth: 0,
    limit: 150,
    sort: 'pageNumber',
    where: {
      and: [
        { document: { equals: docId } },
        { orientationVersion: { equals: PAGE_ORIENTATION_VERSION } },
      ],
    },
  })
  const orientations: Record<number, PageOrientation> = {}
  for (const saved of savedPages.docs)
    orientations[saved.pageNumber] = {
      rotation: normalizeRotation(saved.orientationRotation || 0),
      confidence: saved.orientationConfidence || 0,
      verified: Boolean(saved.orientationVerified),
    }

  const visualChunks = await payload.find({
    collection: 'chunks',
    depth: 0,
    limit: 100,
    sort: 'pageNumber',
    where: {
      and: [{ document: { equals: docId } }, { hasImage: { equals: true } }],
    },
  })

  // Versioned page previews also include visual-only pages, without invented chunks.
  const visualEntries = savedPages.docs.length
    ? savedPages.docs
        .filter((page) => page.previewKey)
        .map((page) => ({
          imageUrl: page.previewKey,
          pageNumber: page.pageNumber,
          imageCaption: `Source page screenshot (Page ${page.pageNumber})`,
        }))
    : visualChunks.docs
  const visuals: ExtractedVisual[] = (
    await Promise.all(
      visualEntries.map(async (chunk: any) => {
        if (!chunk.imageUrl) return null

        try {
          return {
            url: await getPresignedDownloadUrl(chunk.imageUrl, doc.r2Bucket || undefined),
            page: chunk.pageNumber,
            caption: chunk.imageCaption || `Extracted visual from page ${chunk.pageNumber}`,
          }
        } catch {
          return null
        }
      }),
    )
  ).filter((visual): visual is ExtractedVisual => Boolean(visual))

  const uniqueVisuals = visuals.filter(
    (visual, index, all) => all.findIndex((item) => item.page === visual.page) === index,
  )

  const subjectName = typeof doc.subject === 'object' ? doc.subject?.name : 'Academic Notes'
  const chapterName = doc.chapter || doc.name

  return (
    <div className="pdf-viewer-shell">
      <header className="pdf-viewer-header">
        <div className="pdf-viewer-heading">
          <Link href="/notes" className="pdf-back-link">
            Back to library
          </Link>
          <div>
            <strong>{doc.name}</strong>
            <span>
              {subjectName} - {chapterName}
            </span>
          </div>
        </div>

        <div className="pdf-viewer-actions">
          {isR2 && <span className="pdf-storage-badge">R2 direct</span>}
          <span className="pdf-page-badge">Page {pageNumber}</span>
          {!unavailableOnVercel && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={downloadFilename}
              className="pdf-download-link"
            >
              Download PDF
            </a>
          )}
        </div>
      </header>

      <div className={`pdf-viewer-workspace${uniqueVisuals.length ? ' has-visuals' : ''}`}>
        <div className="pdf-frame-wrap">
          {unavailableOnVercel ? (
            <section className="pdf-storage-unavailable" role="alert">
              <span aria-hidden="true">↥</span>
              <h1>This PDF needs a fresh upload.</h1>
              <p>
                The library record is here, but its cloud PDF is unavailable. This deployment cannot
                read a PDF saved only on a previous server.
              </p>
              <p>
                An administrator needs to upload the original file again and confirm that its cloud
                copy is saved.
              </p>
              <Link href="/notes">Back to your library →</Link>
            </section>
          ) : (
            <PDFCircleSearch
              url={directPdfUrl}
              title={doc.name}
              initialPage={pageNumber}
              subject={subjectName}
              branch={doc.subject?.semester?.branch?.name}
              semester={doc.subject?.semester?.number}
              orientations={orientations}
            />
          )}
        </div>

        {uniqueVisuals.length > 0 && (
          <aside className="pdf-visuals-panel">
            <div className="pdf-visuals-heading">
              <span className="section-kicker">From this document</span>
              <h2>Source page visuals</h2>
              <p>
                Page screenshots, including diagrams. Uncertain page directions can be adjusted in
                the reader.
              </p>
            </div>

            <div className="pdf-visual-list">
              {uniqueVisuals.map((visual) => (
                <article key={visual.page} className="pdf-visual-card">
                  <Link
                    href={`/pdf/${params.id}?page=${visual.page}`}
                    className="pdf-visual-image-link"
                  >
                    <img src={visual.url} alt={visual.caption} />
                    <span>Page {visual.page}</span>
                  </Link>
                  <div className="pdf-visual-copy">
                    <p>{visual.caption}</p>
                    <a href={visual.url} target="_blank" rel="noopener noreferrer">
                      Open full size
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
