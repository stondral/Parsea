import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { UploadNoteModal } from '@/components/UploadNoteModal'
import { estimateUploadProgress } from '@/lib/uploadProgress'

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(async () => {}),
  upload: vi.fn(),
  prepare: vi.fn(),
  complete: vi.fn(),
  process: vi.fn(),
  direct: vi.fn(),
}))
vi.mock('@/lib/directUpload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/directUpload')>()),
  uploadPDFDirect: mocks.direct,
  smallPDFBase64: vi.fn(),
  PDFContentHash: vi.fn(async () => 'a'.repeat(64)),
}))
vi.mock('@/trpc/client', () => {
  const query = (data: unknown) => ({
    useQuery: () => ({
      data,
      isLoading: false,
      isError: false,
      refetch: vi.fn(async () => ({ data })),
    }),
  })
  return {
    trpc: {
      useUtils: () => ({
        notes: {
          list: { invalidate: mocks.invalidate },
          getStats: { invalidate: mocks.invalidate },
          getSubjects: { invalidate: mocks.invalidate },
          getModules: { invalidate: mocks.invalidate },
          getTopics: { invalidate: mocks.invalidate },
        },
      }),
      notes: {
        getSubjects: query([{ id: 1, name: 'Discrete Mathematics', semesterNumber: 3 }]),
        getModules: query([]),
        getTopics: query([]),
      },
      uploads: {
        prepareUpload: { useMutation: () => ({ mutateAsync: mocks.prepare }) },
        uploadSmallPDF: { useMutation: () => ({ mutateAsync: vi.fn() }) },
        completeUpload: { useMutation: () => ({ mutateAsync: mocks.complete }) },
        processUpload: { useMutation: () => ({ mutateAsync: mocks.process }) },
        uploadStatus: query(undefined),
        myUploads: query([]),
      },
    },
  }
})

describe('Honest optimistic upload progress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.upload)
    mocks.prepare.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      url: 'https://cloud.test/upload',
      status: 'uploading',
    })
    mocks.direct.mockResolvedValue(undefined)
    mocks.complete.mockResolvedValue({ status: 'queued' })
    mocks.process.mockResolvedValue({ status: 'ready', document_id: 7 })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('moves gently forward but never claims server completion', () => {
    const values = [0, 1000, 10_000, 60_000, 600_000].map(
      (time) => estimateUploadProgress(time).percent,
    )
    expect(values.every((percent) => percent < 100)).toBe(true)
    expect(values).toEqual([...values].sort((a, b) => a - b))
    expect(estimateUploadProgress(600_000).message).toContain('waiting for confirmation')
  })

  it('starts admin indexing after a drop without waiting for metadata submission', async () => {
    vi.useFakeTimers()
    mocks.prepare.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      url: 'https://cloud.test/upload',
      status: 'uploading',
    })
    mocks.direct.mockResolvedValue(undefined)
    mocks.complete.mockResolvedValue({ status: 'queued' })
    mocks.process.mockResolvedValue({ status: 'ready', document_id: 7 })
    render(<UploadNoteModal isOpen administrator onClose={vi.fn()} initialSubjectId="1" />)
    fireEvent.change(screen.getByLabelText('Choose PDF files'), {
      target: { files: [new File(['%PDF-test'], '1.pdf', { type: 'application/pdf' })] },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300)
    })
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Study notes 1', subject: 1 }),
    )
    expect(mocks.direct).toHaveBeenCalledTimes(1)
    expect(mocks.process).toHaveBeenCalledTimes(1)
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
  })

  function startUpload() {
    render(<UploadNoteModal isOpen onClose={vi.fn()} initialSubjectId="1" />)
    fireEvent.change(screen.getByLabelText('Choose PDF files'), {
      target: { files: [new File(['pdf'], 'Module 1 Logic.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload 1 PDF' }))
  }

  it('saves later PDFs while indexing is pending, with only one indexing lane', async () => {
    let finish!: (value: unknown) => void
    mocks.prepare.mockImplementation(async (input: { requestId: string }) => ({
      id: input.requestId,
      url: 'https://cloud.test/upload',
      status: 'uploading',
    }))
    mocks.process.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    render(<UploadNoteModal isOpen onClose={vi.fn()} initialSubjectId="1" />)
    fireEvent.change(screen.getByLabelText('Choose PDF files'), {
      target: {
        files: ['first.pdf', 'second.pdf'].map(
          (name) => new File(['pdf'], name, { type: 'application/pdf' }),
        ),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload 2 PDFs' }))
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(2))
    expect(mocks.process).toHaveBeenCalledTimes(1)
    expect(screen.getByText('2 of 2 safely uploaded')).toBeDefined()
    expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeLessThan(100)
    await act(async () => finish({ status: 'ready', document_id: 7 }))
    await waitFor(() => expect(mocks.process).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100'),
    )
  })

  it('shows confirmed stages and 100% only after the index response', async () => {
    let resolve!: (value: unknown) => void
    mocks.process.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    startUpload()
    await screen.findByLabelText('Confirmed batch upload progress')
    expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeLessThan(100)
    expect(screen.getByText(/Live transfer and indexing stages/)).toBeDefined()
    await waitFor(() => expect(mocks.process).toHaveBeenCalled())
    await act(async () => resolve({ status: 'ready', document_id: 7 }))
    await waitFor(() =>
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100'),
    )
    expect(screen.getByText('All PDFs uploaded. Nice work.')).toBeDefined()
  })

  it('keeps a failed upload retryable without a false completion state', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('Storage unavailable'))
    startUpload()
    await screen.findByRole('button', { name: 'Retry 1 file' })
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
    expect(screen.queryByText('All PDFs uploaded. Nice work.')).toBeNull()
  })
  it('continues queued page batches for student uploads without REST', async () => {
    mocks.process
      .mockResolvedValueOnce({ status: 'queued' })
      .mockResolvedValueOnce({ status: 'ready', document_id: 7 })
    startUpload()
    await waitFor(() =>
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100'),
    )
    expect(mocks.process).toHaveBeenCalledTimes(2)
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})
