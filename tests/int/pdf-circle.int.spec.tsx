import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PDFCircleSearch } from '@/components/PDFCircleSearch'

const fake = vi.hoisted(() => ({
  push: vi.fn(),
  destroy: vi.fn(),
  cancel: vi.fn(),
  getDocument: vi.fn(),
  ask: vi.fn(),
  ocr: vi.fn(),
  viewport: vi.fn(),
}))
vi.mock('@/lib/browserOCR', () => ({ ocrPDFRegion: fake.ocr }))
vi.mock('@/trpc/client', () => ({
  trpc: { chat: { ask: { useMutation: () => ({ mutateAsync: fake.ask }) } } },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fake.push }) }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: fake.getDocument,
  Util: {
    transform: (v: number[], i: number[]) => [
      v[0] * i[0] + v[2] * i[1],
      v[1] * i[0] + v[3] * i[1],
      v[0] * i[2] + v[2] * i[3],
      v[1] * i[2] + v[3] * i[3],
      v[0] * i[4] + v[2] * i[5] + v[4],
      v[1] * i[4] + v[3] * i[5] + v[5],
    ],
  },
}))

describe('Circle to Search prototype (isolated component, no live requests)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    fake.ask.mockResolvedValue({
      answer: 'Truth tables list possible truth values.',
      sources: [],
      images: [],
      cached: false,
      latencyMs: 10,
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    vi.stubGlobal(
      'PointerEvent',
      class extends MouseEvent {
        pointerType: string
        pointerId: number
        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init)
          this.pointerType = init.pointerType || 'mouse'
          this.pointerId = init.pointerId || 1
        }
      },
    )
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => false)
    fake.viewport.mockImplementation(({ rotation = 0 }) => ({
      width: rotation % 180 ? 800 : 600,
      height: rotation % 180 ? 600 : 800,
      scale: 1,
      transform: (
        {
          0: [1, 0, 0, -1, 0, 800],
          90: [0, 1, 1, 0, 0, 0],
          180: [-1, 0, 0, 1, 600, 0],
          270: [0, -1, -1, 0, 800, 600],
        } as Record<number, number[]>
      )[rotation],
    }))
    fake.getDocument.mockReturnValue({
      destroy: fake.destroy.mockResolvedValue(undefined),
      promise: Promise.resolve({
        numPages: 2,
        getPage: async () => ({
          rotate: 0,
          getViewport: fake.viewport,
          render: () => ({ promise: Promise.resolve(), cancel: fake.cancel }),
          getTextContent: async () => ({
            items: [
              {
                str: 'Truth tables compare logical statements.',
                width: 250,
                transform: [1, 0, 0, 14, 40, 760],
                hasEOL: true,
              },
            ],
          }),
        }),
      }),
    })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  const props = {
    url: '/fixture.pdf',
    title: 'Logic',
    initialPage: 1,
    subject: 'Discrete Mathematics',
    branch: 'COMPS',
    semester: 3,
  }

  it('keeps the normal reader and lazily loads selection only when requested', async () => {
    const { container } = render(<PDFCircleSearch {...props} />)
    expect(container.querySelector('iframe')?.src).toContain('/fixture.pdf#page=1')
    expect(fake.getDocument).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Circle to search/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Scroll / pan' }).hasAttribute('disabled')).toBe(
        false,
      ),
    )
    expect(fake.getDocument).toHaveBeenCalledWith({ url: '/fixture.pdf', isEvalSupported: false })
    fireEvent.click(screen.getByRole('button', { name: 'Standard reader' }))
    expect(container.querySelector('iframe')).not.toBeNull()
    expect(fake.destroy).toHaveBeenCalled()
  })
  it('opens the corrected reader in scroll mode and keeps touch selection aligned after manual rotation', async () => {
    render(
      <PDFCircleSearch
        {...props}
        orientations={{ 1: { rotation: 0, confidence: 100, verified: true } }}
      />,
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Rotate PDF page right' }).hasAttribute('disabled'),
      ).toBe(false),
    )
    expect(screen.queryByLabelText('Circle or drag over PDF text')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Rotate PDF page right' }))
    await waitFor(() =>
      expect(fake.viewport).toHaveBeenCalledWith(expect.objectContaining({ rotation: 90 })),
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Draw a circle' }).hasAttribute('disabled')).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }))
    const overlay = await screen.findByLabelText('Circle or drag over PDF text')
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
    } as DOMRect)
    fireEvent.pointerDown(overlay, { clientX: 740, clientY: 20, button: 0, pointerType: 'touch' })
    fireEvent.pointerUp(overlay, { clientX: 790, clientY: 320, button: 0, pointerType: 'touch' })
    expect(
      (screen.getByLabelText('Review selected PDF text') as HTMLTextAreaElement).value,
    ).toContain('Truth tables')
    expect(screen.queryByLabelText('Circle or drag over PDF text')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reset page rotation' }))
    await waitFor(() =>
      expect((screen.getByLabelText('Review selected PDF text') as HTMLTextAreaElement).value).toBe(
        '',
      ),
    )
  })
  it('honors a new citation page prop while retaining per-page saved corrections', async () => {
    const orientations = {
      1: { rotation: 90 as const, confidence: 95, verified: true },
      2: { rotation: 180 as const, confidence: 95, verified: true },
    }
    const view = render(<PDFCircleSearch {...props} orientations={orientations} />)
    await waitFor(() =>
      expect(fake.viewport).toHaveBeenCalledWith(expect.objectContaining({ rotation: 90 })),
    )
    view.rerender(<PDFCircleSearch {...props} initialPage={2} orientations={orientations} />)
    await waitFor(() =>
      expect(fake.viewport).toHaveBeenCalledWith(expect.objectContaining({ rotation: 180 })),
    )
    expect(screen.getByText('Page 2 / 2')).toBeDefined()
  })

  it('extracts a dragged region, permits review, and transfers a draft without calling an LLM', async () => {
    render(<PDFCircleSearch {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Circle to search/ }))
    const overlay = await screen.findByLabelText('Circle or drag over PDF text')
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 600,
      height: 800,
    } as DOMRect)
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 20, button: 0 })
    fireEvent.pointerUp(overlay, { clientX: 400, clientY: 80, button: 0 })
    expect((screen.getByLabelText('Review selected PDF text') as HTMLTextAreaElement).value).toBe(
      'Truth tables compare logical statements.',
    )
    expect(fake.push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Open in Study chat/ }))
    expect(JSON.parse(sessionStorage.getItem('parsea_pdf_draft')!).question).toContain(
      'page 1:\nTruth tables',
    )
    expect(fake.push).toHaveBeenCalledWith(
      '/chat?mode=deep&subject=Discrete+Mathematics&branch=COMPS&sem=3',
    )
    expect(fake.push.mock.calls[0][0]).not.toContain('Truth')
  })

  it('offers a keyboard-accessible page-text alternative and page navigation', async () => {
    render(<PDFCircleSearch {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Circle to search/ }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Use page text instead' }).hasAttribute('disabled'),
      ).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Use page text instead' }))
    expect(
      (screen.getByLabelText('Review selected PDF text') as HTMLTextAreaElement).value,
    ).toContain('Truth tables')
    fireEvent.click(screen.getByRole('button', { name: 'Next PDF page' }))
    await waitFor(() => expect(screen.getByText('Page 2 / 2')).toBeDefined())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Scroll / pan' }).hasAttribute('disabled')).toBe(
        false,
      ),
    )
    expect((screen.getByLabelText('Review selected PDF text') as HTMLTextAreaElement).value).toBe(
      '',
    )
  })

  it('shows a truthful load error and allows returning to the original reader', async () => {
    fake.getDocument.mockReturnValue({
      destroy: fake.destroy.mockResolvedValue(undefined),
      promise: Promise.reject(new Error('Unavailable')),
    })
    const { container } = render(<PDFCircleSearch {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Circle to search/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('could not load')
    fireEvent.click(screen.getByRole('button', { name: 'Standard reader' }))
    expect(container.querySelector('iframe')).not.toBeNull()
  })

  it('answers inside the PDF through the existing chat mutation only after an explicit click', async () => {
    render(<PDFCircleSearch {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Circle to search/ }))
    await screen.findByLabelText('Circle or drag over PDF text')
    fireEvent.click(screen.getByRole('button', { name: 'Use page text instead' }))
    expect(fake.ask).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Explain this' }))
    expect(await screen.findByText('Truth tables list possible truth values.')).toBeDefined()
    expect(fake.ask).toHaveBeenCalledWith(
      expect.objectContaining({
        question: expect.stringContaining('page 1:\nTruth tables'),
        filters: { subject: props.subject, branch: props.branch, semester: props.semester },
      }),
    )
    expect(fake.push).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Review selected PDF text'), {
      target: { value: 'New selection' },
    })
    expect(screen.queryByText('Truth tables list possible truth values.')).toBeNull()
  })

  it('discards stale answers after a page change and reports retryable failures', async () => {
    let resolve!: (value: any) => void
    fake.ask.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    render(<PDFCircleSearch {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Circle to search/ }))
    await screen.findByLabelText('Circle or drag over PDF text')
    fireEvent.click(screen.getByRole('button', { name: 'Use page text instead' }))
    fireEvent.click(screen.getByRole('button', { name: 'Explain this' }))
    expect(screen.getByText('Reading your selected text…')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Next PDF page' }))
    await screen.findByText('Page 2 / 2')
    resolve({ answer: 'Stale result', sources: [], images: [] })
    await waitFor(() => expect(screen.queryByText('Reading your selected text…')).toBeNull())
    expect(screen.queryByText('Stale result')).toBeNull()
    await screen.findByLabelText('Circle or drag over PDF text')
    fake.ask.mockRejectedValueOnce(new Error('Server failure'))
    fireEvent.click(screen.getByRole('button', { name: 'Use page text instead' }))
    fireEvent.click(screen.getByRole('button', { name: 'Explain this' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Your selection is safe')
  })

  it('offers scroll mode without a drawing overlay', async () => {
    render(<PDFCircleSearch {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Circle to search/ }))
    await screen.findByLabelText('Circle or drag over PDF text')
    fireEvent.click(screen.getByRole('button', { name: 'Scroll / pan' }))
    expect(screen.queryByLabelText('Circle or drag over PDF text')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }))
    expect(screen.getByLabelText('Circle or drag over PDF text')).toBeDefined()
  })
  it('reads a selected scan locally and waits for an explicit AI question', async () => {
    fake.ocr.mockResolvedValue('Readable scanned text about truth tables.')
    const { container } = render(<PDFCircleSearch {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Circle to search/ }))
    await waitFor(() => expect(container.querySelector('.pdf-circle-overlay')).not.toBeNull())
    const overlay = container.querySelector('.pdf-circle-overlay')!
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 600,
      height: 800,
    } as DOMRect)
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 100, pointerId: 1, button: 0 })
    fireEvent.pointerUp(overlay, { clientX: 250, clientY: 300, pointerId: 1, button: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Read scanned selection (OCR)' }))
    await waitFor(() =>
      expect((screen.getByLabelText('Review selected PDF text') as HTMLTextAreaElement).value).toBe(
        'Readable scanned text about truth tables.',
      ),
    )
    expect(fake.ocr).toHaveBeenCalledTimes(1)
    expect(fake.ask).not.toHaveBeenCalled()
  })

  it('extracts finger selections and automatically restores touch scrolling', async () => {
    render(<PDFCircleSearch {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Circle to search/ }))
    const overlay = await screen.findByLabelText('Circle or drag over PDF text')
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 600,
      height: 800,
    } as DOMRect)
    fireEvent.pointerDown(overlay, {
      clientX: 20,
      clientY: 20,
      pointerType: 'touch',
      pointerId: 4,
      button: 0,
    })
    fireEvent.pointerUp(overlay, {
      clientX: 400,
      clientY: 80,
      pointerType: 'touch',
      pointerId: 4,
      button: 0,
    })
    expect(
      (screen.getByLabelText('Review selected PDF text') as HTMLTextAreaElement).value,
    ).toContain('Truth tables')
    expect(screen.queryByLabelText('Circle or drag over PDF text')).toBeNull()
    expect(screen.getByRole('button', { name: 'Draw a circle' })).toBeDefined()
    expect(fake.ask).not.toHaveBeenCalled()
  })
})
