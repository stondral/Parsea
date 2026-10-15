import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SourceVisual } from '@/components/SourceVisual'
const m = vi.hoisted(() => ({ refetch: vi.fn() }))
vi.mock('@/trpc/client', () => ({
  trpc: { chat: { refreshImage: { useQuery: () => ({ data: null, refetch: m.refetch }) } } },
}))
describe('Source image recovery', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })
  const image = {
    url: '/expired',
    caption: 'Source page screenshot',
    page: 1,
    document: 'Logic',
    storageKey: 'documents/page.png',
  }
  it('requests a fresh URL on image failure', async () => {
    m.refetch.mockResolvedValue({ data: { url: '/fresh' } })
    render(<SourceVisual image={image} onExpand={vi.fn()} />)
    fireEvent.error(screen.getByAltText(image.caption))
    await waitFor(() => expect(m.refetch).toHaveBeenCalledTimes(1))
  })
  it('offers retry when a source was deleted or cannot load', async () => {
    m.refetch.mockResolvedValue({ data: null })
    render(<SourceVisual image={image} onExpand={vi.fn()} />)
    fireEvent.error(screen.getByAltText(image.caption))
    expect(
      await screen.findByRole('button', { name: `Retry source image: ${image.caption}` }),
    ).toBeDefined()
  })
})
