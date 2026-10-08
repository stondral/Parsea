import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PDFCircleSearch } from '@/components/PDFCircleSearch'

const fake = vi.hoisted(() => ({
  push: vi.fn(),
  destroy: vi.fn(),
  cancel: vi.fn(),
  getDocument: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fake.push }) }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: fake.getDocument,
  Util: {
    transform: (_viewport: number[], item: number[]) => [1, 0, 0, -14, item[4], 800 - item[5]],
  },
}))

describe('Circle to Search prototype (isolated component, no live requests)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    vi.stubGlobal('PointerEvent', MouseEvent)
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => false)
    fake.getDocument.mockReturnValue({
      destroy: fake.destroy.mockResolvedValue(undefined),
      promise: Promise.resolve({
        numPages: 2,
        getPage: async () => ({
          getViewport: () => ({
            width: 600,
            height: 800,
            scale: 1,
            transform: [1, 0, 0, -1, 0, 800],
          }),
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
      expect(screen.getByRole('button', { name: 'Drawing on' }).hasAttribute('disabled')).toBe(
        false,
      ),
    )
    expect(fake.getDocument).toHaveBeenCalledWith({ url: '/fixture.pdf', isEvalSupported: false })
    fireEvent.click(screen.getByRole('button', { name: 'Standard reader' }))
    expect(container.querySelector('iframe')).not.toBeNull()
    expect(fake.destroy).toHaveBeenCalled()
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
    fireEvent.click(screen.getByRole('button', { name: /Explain this/ }))
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
      expect(screen.getByRole('button', { name: 'Drawing on' }).hasAttribute('disabled')).toBe(
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
})
