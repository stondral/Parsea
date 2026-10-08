import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import PDFViewerPage from '@/app/(frontend)/pdf/[id]/page'

const mocks = vi.hoisted(() => ({ findByID: vi.fn(), find: vi.fn(), presign: vi.fn() }))
vi.mock('@/payload.config', () => ({ default: {} }))
vi.mock('payload', () => ({
  getPayload: async () => ({ findByID: mocks.findByID, find: mocks.find }),
}))
vi.mock('@/lib/r2', () => ({ getPresignedDownloadUrl: mocks.presign }))
vi.mock('@/components/PDFCircleSearch', () => ({
  PDFCircleSearch: ({ url }: { url: string }) => <iframe src={url} title="PDF reader" />,
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('Not found')
  },
}))

describe('Vercel PDF storage guard', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
  })
  async function setup(storageKey?: string) {
    vi.stubEnv('VERCEL', '1')
    mocks.findByID.mockResolvedValue({
      id: 7,
      name: 'Logic',
      filename: '5.pdf',
      storageKey,
      subject: { name: 'Discrete Mathematics' },
    })
    mocks.find.mockResolvedValue({ docs: [] })
    mocks.presign.mockResolvedValue('https://storage.example.test/Logic.pdf')
    return render(
      await PDFViewerPage({
        params: Promise.resolve({ id: '7' }),
        searchParams: Promise.resolve({}),
      }),
    )
  }
  it('does not embed the broken local-file URL for a cloudless Vercel record', async () => {
    const { container } = await setup()
    expect(screen.getByRole('alert').textContent).toContain('fresh upload')
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Download PDF' })).toBeNull()
  })
  it('retains direct cloud viewing and download when a key exists', async () => {
    await setup('documents/Logic.pdf')
    expect(screen.getByTitle('PDF reader').getAttribute('src')).toBe(
      'https://storage.example.test/Logic.pdf',
    )
    expect(screen.getByRole('link', { name: 'Download PDF' })).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
