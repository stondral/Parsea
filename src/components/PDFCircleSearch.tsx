'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { textInSelection, isClosedLasso, type PDFTextBox, type SelectionPoint } from '@/lib/pdf-selection'
import './pdf-circle.css'

interface Props {
  url: string
  title: string
  initialPage: number
  subject?: string
  branch?: string
  semester?: number
}

/** Opt-in browser-only selection; normal PDF streaming remains unchanged. */
export function PDFCircleSearch(props: Props) {
  const router = useRouter()
  const [active, setActive] = useState(false)
  const [armed, setArmed] = useState(true)
  const [page, setPage] = useState(props.initialPage)
  const [total, setTotal] = useState(0)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [width, setWidth] = useState(800)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState('')
  const [points, setPoints] = useState<SelectionPoint[]>([])
  const [notice, setNotice] = useState('')
  const frame = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const documentRef = useRef<PDFDocumentProxy | null>(null)
  const boxesRef = useRef<PDFTextBox[]>([])
  const drawing = useRef<SelectionPoint[] | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!active || !frame.current) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(200, Math.min(1000, entry.contentRect.width - 32))),
    )
    observer.observe(frame.current)
    return () => observer.disconnect()
  }, [active])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let task: ReturnType<typeof import('pdfjs-dist').getDocument> | undefined
    setError('')
    setReady(false)
    setTotal(0)
    void import('pdfjs-dist')
      .then(async (pdfjs) => {
        if (cancelled) return
        pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'
        task = pdfjs.getDocument({ url: props.url, isEvalSupported: false })
        const document = await task.promise
        if (cancelled) return
        documentRef.current = document
        setTotal(document.numPages)
        setPage((current) => Math.max(1, Math.min(current, document.numPages)))
        setRevision((current) => current + 1)
      })
      .catch(() => {
        if (!cancelled)
          setError(
            'Selection could not load this PDF. Cloud PDFs need browser CORS access. You can still use the standard reader.',
          )
      })
    return () => {
      cancelled = true
      documentRef.current = null
      void task?.destroy().catch(() => undefined)
    }
  }, [active, props.url])

  useEffect(() => {
    const document = documentRef.current
    if (!active || !document || !canvas.current) return
    let cancelled = false
    let render: RenderTask | undefined
    setReady(false)
    setPoints([])
    setSelection('')
    setNotice('')
    boxesRef.current = []
    void (async () => {
      const pdfjs = await import('pdfjs-dist')
      const pdfPage = await document.getPage(page)
      if (cancelled || !canvas.current) return
      const base = pdfPage.getViewport({ scale: 1 })
      const viewport = pdfPage.getViewport({ scale: width / base.width })
      const target = canvas.current
      const dpi = Math.min(window.devicePixelRatio || 1, 2)
      target.width = Math.ceil(viewport.width * dpi)
      target.height = Math.ceil(viewport.height * dpi)
      setSize({ width: viewport.width, height: viewport.height })
      render = pdfPage.render({ canvas: target, viewport, transform: [dpi, 0, 0, dpi, 0, 0] })
      await render.promise
      const content = await pdfPage.getTextContent()
      if (cancelled) return
      boxesRef.current = content.items
        .filter((item) => 'str' in item)
        .map((item) => {
          const tx = pdfjs.Util.transform(viewport.transform, item.transform)
          const height = Math.hypot(tx[2], tx[3])
          const angle = Math.atan2(tx[1], tx[0])
          const lineWidth = item.width * viewport.scale
          const corners = [
            [0, -height],
            [lineWidth, -height],
            [lineWidth, 0],
            [0, 0],
          ].map(([x, y]) => ({
            x: tx[4] + x * Math.cos(angle) - y * Math.sin(angle),
            y: tx[5] + x * Math.sin(angle) + y * Math.cos(angle),
          }))
          const xs = corners.map((point) => point.x),
            ys = corners.map((point) => point.y)
          return {
            text: item.str,
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
            endOfLine: item.hasEOL,
          }
        })
      setReady(true)
    })().catch((error: Error) => {
      if (!cancelled && error.name !== 'RenderingCancelledException')
        setError('This page could not render. Try another page or return to the standard reader.')
    })
    return () => {
      cancelled = true
      render?.cancel()
    }
  }, [active, page, width, revision])

  function location(event: React.PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(
        0,
        Math.min(size.width, ((event.clientX - bounds.left) * size.width) / bounds.width),
      ),
      y: Math.max(
        0,
        Math.min(size.height, ((event.clientY - bounds.top) * size.height) / bounds.height),
      ),
    }
  }

  function finish(event: React.PointerEvent<SVGSVGElement>) {
    const path = drawing.current
    if (!path) return
    drawing.current = null
    const finished = [...path, location(event)]
    setPoints(finished)
    setSelection(textInSelection(boxesRef.current, finished))
    setNotice(
      'Selection ready. Review the text below before asking. Scans and image-only diagrams are not supported yet.',
    )
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function ask(instruction: string) {
    if (!selection.trim()) return
    const params = new URLSearchParams({ mode: 'deep' })
    if (props.subject) params.set('subject', props.subject)
    if (props.branch) params.set('branch', props.branch)
    if (props.semester) params.set('sem', String(props.semester))
    try {
      sessionStorage.setItem(
        'parsea_pdf_draft',
        JSON.stringify({
          question: `${instruction}\n\nExcerpt from “${props.title}”, page ${page}:\n${selection.slice(0, 4000)}`,
        }),
      )
      router.push(`/chat?${params.toString()}`)
    } catch {
      setNotice(
        'Your browser could not save the draft. Copy the selected text into Study chat instead.',
      )
    }
  }

  return (
    <div className={`pdf-circle-reader${active ? ' is-active' : ''}`}>
      <div className="pdf-circle-toolbar">
        <button type="button" onClick={() => setActive(!active)} aria-pressed={active}>
          {active ? 'Standard reader' : 'Circle to search · Try it'}
        </button>
        {active && (
          <>
            <button
              type="button"
              disabled={!ready}
              onClick={() => setArmed(!armed)}
              aria-pressed={armed}
            >
              {armed ? 'Drawing on' : 'Draw a circle'}
            </button>
            <button
              type="button"
              disabled={page <= 1 || !total}
              onClick={() => setPage(page - 1)}
              aria-label="Previous PDF page"
            >
              ←
            </button>
            <span>
              Page {page}
              {total ? ` / ${total}` : ''}
            </span>
            <button
              type="button"
              disabled={!total || page >= total}
              onClick={() => setPage(page + 1)}
              aria-label="Next PDF page"
            >
              →
            </button>
          </>
        )}
      </div>
      {!active ? (
        <iframe
          src={`${props.url}#page=${props.initialPage}`}
          title={props.title}
          className="pdf-frame"
        />
      ) : (
        <>
          <p className="pdf-circle-hint">
            Circle text with your mouse or finger, or drag a box. Review your selection, then open
            an editable chat draft. Nothing is sent automatically.
          </p>
          {error ? (
            <p className="pdf-circle-error" role="alert">
              {error}
            </p>
          ) : (
            <>
              {!ready && (
                <p role="status" className="pdf-circle-hint">
                  Loading page…
                </p>
              )}
              <div className="pdf-circle-scroll" ref={frame}>
                <div
                  className="pdf-circle-page"
                  style={{ width: size.width || '100%', height: size.height || 300 }}
                >
                  <canvas
                    ref={canvas}
                    style={{ width: '100%', height: '100%' }}
                    aria-label={`${props.title}, page ${page}`}
                  />
                  {armed && ready && (
                    <svg
                      className="pdf-circle-overlay"
                      viewBox={`0 0 ${size.width} ${size.height}`}
                      aria-label="Circle or drag over PDF text"
                      onPointerDown={(event) => {
                        if (event.button !== 0) return
                        drawing.current = [location(event)]
                        setPoints(drawing.current)
                        setSelection('')
                        event.currentTarget.setPointerCapture(event.pointerId)
                      }}
                      onPointerMove={(event) => {
                        if (!drawing.current) return
                        // Bound work for a long gesture, but retain its final coordinate.
                        if (drawing.current.length < 1000) drawing.current.push(location(event))
                        setPoints([...drawing.current])
                      }}
                      onPointerUp={finish}
                      onPointerCancel={() => {
                        drawing.current = null
                        setPoints([])
                      }}
                    >
                      {points.length > 1 &&
                (!isClosedLasso(points) ? (
                          <rect
                            x={Math.min(points[0].x, points.at(-1)!.x)}
                            y={Math.min(points[0].y, points.at(-1)!.y)}
                            width={Math.abs(points[0].x - points.at(-1)!.x)}
                            height={Math.abs(points[0].y - points.at(-1)!.y)}
                          />
                        ) : (
                          <polygon
                            points={points.map((point) => `${point.x},${point.y}`).join(' ')}
                          />
                        ))}
                    </svg>
                  )}
                </div>
              </div>
              <div className="pdf-circle-selection">
                <div>
                  <strong>Your selected text</strong>
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={() => {
                      setSelection(
                        boxesRef.current
                          .map((box) => box.text + (box.endOfLine ? '\n' : ' '))
                          .join('')
                          .trim()
                          .slice(0, 4000),
                      )
                      setNotice('Page text selected. You can edit it before asking.')
                    }}
                  >
                    Use page text instead
                  </button>
                </div>
                <textarea
                  aria-label="Review selected PDF text"
                  value={selection}
                  maxLength={4000}
                  onChange={(event) => setSelection(event.target.value)}
                  placeholder="Draw over text above, use page text, or type the excerpt here…"
                  rows={3}
                />
                <p role="status">
                  {notice ||
                    'Text-based prototype. It may select an entire PDF text line; edit the excerpt if needed.'}
                </p>
                {notice && !selection && (
                  <p>No readable text found here. Try a text paragraph; scanned pages need OCR.</p>
                )}
                <div className="pdf-circle-ask">
                  <button
                    type="button"
                    disabled={!selection.trim()}
                    onClick={() => ask('Explain this excerpt simply, using a short example.')}
                  >
                    Explain this ↗
                  </button>
                  <button
                    type="button"
                    disabled={!selection.trim()}
                    onClick={() =>
                      ask('Create three practice questions about this excerpt, with answers.')
                    }
                  >
                    Make practice questions ↗
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
