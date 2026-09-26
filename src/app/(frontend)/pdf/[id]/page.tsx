import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { notFound } from 'next/navigation'
import { getPresignedDownloadUrl } from '@/lib/r2'

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
  const pageNumber = searchParams.page ? parseInt(searchParams.page, 10) : 1

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
  let isR2 = false

  if (doc.storageKey) {
    try {
      directPdfUrl = await getPresignedDownloadUrl(doc.storageKey, doc.r2Bucket || undefined)
      isR2 = true
    } catch (error) {
      console.error('Failed generating R2 presigned URL, falling back to local:', error)
    }
  }

  const visualChunks = await payload.find({
    collection: 'chunks',
    depth: 0,
    limit: 100,
    sort: 'pageNumber',
    where: {
      and: [
        { document: { equals: docId } },
        { hasImage: { equals: true } },
      ],
    },
  })

  const visuals: ExtractedVisual[] = (
    await Promise.all(
      visualChunks.docs.map(async (chunk: any) => {
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

  const pdfViewerUrl = `${directPdfUrl}#page=${pageNumber}`
  const subjectName = typeof doc.subject === 'object' ? doc.subject?.name : 'Academic Notes'
  const chapterName = doc.chapter || doc.name

  return (
    <div className="pdf-viewer-shell">
      <header className="pdf-viewer-header">
        <div className="pdf-viewer-heading">
          <Link href="/notes" className="pdf-back-link">Back to library</Link>
          <div>
            <strong>{doc.name}</strong>
            <span>{subjectName} - {chapterName}</span>
          </div>
        </div>

        <div className="pdf-viewer-actions">
          {isR2 && <span className="pdf-storage-badge">R2 direct</span>}
          <span className="pdf-page-badge">Page {pageNumber}</span>
          <a href={directPdfUrl} target="_blank" rel="noopener noreferrer" download className="pdf-download-link">
            Download PDF
          </a>
        </div>
      </header>

      <div className={`pdf-viewer-workspace${uniqueVisuals.length ? ' has-visuals' : ''}`}>
        <div className="pdf-frame-wrap">
          <iframe src={pdfViewerUrl} title={doc.name} className="pdf-frame" />
        </div>

        {uniqueVisuals.length > 0 && (
          <aside className="pdf-visuals-panel">
            <div className="pdf-visuals-heading">
              <span className="section-kicker">From this document</span>
              <h2>Extracted visuals</h2>
              <p>Diagrams and image-rich pages found during ingestion.</p>
            </div>

            <div className="pdf-visual-list">
              {uniqueVisuals.map((visual) => (
                <article key={visual.page} className="pdf-visual-card">
                  <Link href={`/pdf/${params.id}?page=${visual.page}`} className="pdf-visual-image-link">
                    <img src={visual.url} alt={visual.caption} />
                    <span>Page {visual.page}</span>
                  </Link>
                  <div className="pdf-visual-copy">
                    <p>{visual.caption}</p>
                    <a href={visual.url} target="_blank" rel="noopener noreferrer">Open full size</a>
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
