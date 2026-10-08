import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ChatPage from '@/app/(frontend)/chat/page'

vi.mock('next/navigation', () => {
  const params = new URLSearchParams('subject=Discrete%20Mathematics&sem=3&branch=COMPS')
  return { useSearchParams: () => params, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }
})
vi.mock('@/components/AmbientGrid', () => ({ AmbientGrid: () => null }))

describe('Conversation-first workspace (isolated DOM, no live API)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('parsea_auto_speak', 'false')
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ user: null }) })),
    )
    window.matchMedia = vi.fn(
      () =>
        ({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    )
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('uses a gentle navigation rail and an on-demand history drawer', async () => {
    const { container } = render(<ChatPage />)
    await screen.findByRole('link', { name: 'Get started' })
    expect(container.querySelector('.navbar')).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Study workspace navigation' })).toBeDefined()
    expect(container.querySelector('#chat-history')?.getAttribute('aria-hidden')).toBe('true')
    const railHistory = screen.getByRole('button', { name: 'Conversation history' })
    fireEvent.click(railHistory)
    expect(screen.getByRole('dialog', { name: 'Chat history' })).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(container.querySelector('.chat-sidebar-nav')?.textContent).toContain('Library')
    expect(container.querySelector('.chat-toolbar-course')?.textContent).toContain(
      'Discrete Mathematics',
    )
    expect(screen.getByLabelText('Your study question').getAttribute('rows')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Edit study scope' }))
    expect(screen.getByLabelText('Subject')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByLabelText('Subject')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit study scope' }))
  })

  it('opens a Focus-mode history drawer, restores Escape focus, and keeps settings available', async () => {
    const { container } = render(<ChatPage />)
    await screen.findByRole('link', { name: 'Get started' })
    fireEvent.click(screen.getByRole('button', { name: 'Enter focus mode' }))
    expect(container.querySelector('.chat-shell')?.className).toContain('is-focus-mode')
    expect(container.querySelector('#chat-history')?.getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Chat settings' }))
    expect(
      screen.getByRole('button', { name: 'Chat settings' }).getAttribute('aria-expanded'),
    ).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Response language' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hindi' }))
    const toggle = screen.getByRole('button', { name: 'Open chat history' })
    toggle.focus()
    fireEvent.click(toggle)
    expect(screen.getByRole('dialog', { name: 'Chat history' })).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Chat history' })).toBeNull()
    expect(document.activeElement).toBe(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'Exit focus mode' }))
    expect(container.querySelector('.chat-shell')?.className).not.toContain('is-focus-mode')
  })

  function savedAnswer(sources: unknown[] = [], images: unknown[] = []) {
    const messages = [
      { id: 'question', role: 'user', content: 'Explain logic', timestamp: 1 },
      {
        id: 'answer',
        role: 'assistant',
        mode: 'deep',
        content: 'A simple explanation.',
        sources,
        images,
        timestamp: 2,
      },
    ]
    localStorage.setItem(
      'parsea_guest_conversations',
      JSON.stringify([{ id: 'saved', title: 'Explain logic', messages }]),
    )
    localStorage.setItem('parsea_guest_active_conversation_id', 'saved')
  }

  it('labels answers with no retrieved sources honestly', async () => {
    savedAnswer()
    render(<ChatPage />)
    await screen.findByText('General explanation · No note sources')
    expect(screen.queryByText('From your study materials')).toBeNull()
  })

  it('keeps real citations and diagrams in initially collapsed disclosures', async () => {
    savedAnswer(
      [{ document: 'Logic', page: 2, url: '/pdf/2?page=2' }],
      [{ url: '/image.png', page: 2, caption: 'Truth table' }],
    )
    const { container } = render(<ChatPage />)
    await screen.findByText('From your study materials')
    const disclosures = container.querySelectorAll<HTMLDetailsElement>('details.chat-evidence')
    expect(disclosures.length).toBe(2)
    expect([...disclosures].every((item) => !item.open)).toBe(true)
    disclosures.forEach((item) => (item.open = true))
    expect(screen.getByRole('link', { name: 'Open PDF' }).getAttribute('href')).toBe(
      '/pdf/2?page=2',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Expand diagram: Truth table' }))
    expect(screen.getByRole('dialog', { name: 'Expanded diagram' })).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Expanded diagram' })).toBeNull()
  })

  it('accepts a reviewed PDF draft locally without submitting a question', async () => {
    sessionStorage.setItem(
      'parsea_pdf_draft',
      JSON.stringify({ question: 'Explain this excerpt from Logic, page 2: truth tables.' }),
    )
    render(<ChatPage />)
    await waitFor(() =>
      expect((screen.getByLabelText('Your study question') as HTMLTextAreaElement).value).toContain(
        'truth tables',
      ),
    )
    expect(sessionStorage.getItem('parsea_pdf_draft')).toBeNull()
    expect(
      (fetch as ReturnType<typeof vi.fn>).mock.calls.every(([url]) => url === '/api/users/me'),
    ).toBe(true)
  })

  it('keeps mobile history and settings dismissible without removing any controls', async () => {
    window.matchMedia = vi.fn(
      (query) =>
        ({
          matches: query.includes('max-width: 920px'),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    )
    const { container } = render(<ChatPage />)
    await waitFor(() => expect(container.querySelector('a[href="/signup"]')).not.toBeNull())
    expect(container.querySelector('#chat-history')?.getAttribute('aria-hidden')).toBe('true')
    const history = screen.getByRole('button', { name: 'Open chat history' })
    history.focus()
    fireEvent.click(history)
    expect(container.querySelector('.chat-main')?.hasAttribute('inert')).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(container.querySelector('.chat-main')?.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(history)
    const settings = screen.getByRole('button', { name: 'Chat settings' })
    fireEvent.click(settings)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(settings.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(settings)
    fireEvent.click(screen.getByRole('button', { name: 'Edit study scope' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByLabelText('Subject')).toBeNull()
  })
})
