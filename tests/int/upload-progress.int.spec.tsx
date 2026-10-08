import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { UploadNoteModal } from '@/components/UploadNoteModal'
import { estimateUploadProgress } from '@/lib/uploadProgress'

const mocks = vi.hoisted(() => ({ invalidate: vi.fn(async () => {}), upload: vi.fn() }))
vi.mock('@/trpc/client', () => {
  const query = (data: unknown) => ({
    useQuery: () => ({ data, isLoading: false, isError: false }),
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
    },
  }
})

describe('Honest optimistic upload progress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.upload)
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

  function startUpload() {
    render(<UploadNoteModal isOpen onClose={vi.fn()} initialSubjectId="1" />)
    fireEvent.change(screen.getByLabelText('Choose PDF files'), {
      target: { files: [new File(['pdf'], 'Module 1 Logic.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload 1 PDF' }))
  }

  it('shows estimated progress while waiting and 100% only after the response', async () => {
    let resolve!: (value: unknown) => void
    mocks.upload.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    startUpload()
    await screen.findByLabelText('Estimated batch upload progress')
    expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeLessThan(100)
    expect(screen.getByText(/not a live indexing measurement/)).toBeDefined()
    await act(async () => resolve({ ok: true, json: async () => ({ success: true }) }))
    await waitFor(() =>
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100'),
    )
    expect(screen.getByText('All PDFs uploaded. Nice work.')).toBeDefined()
  })

  it('keeps a failed upload retryable without a false completion state', async () => {
    mocks.upload.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Storage unavailable' }),
    })
    startUpload()
    await screen.findByRole('button', { name: 'Retry 1 file' })
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
    expect(screen.queryByText('All PDFs uploaded. Nice work.')).toBeNull()
  })
})
