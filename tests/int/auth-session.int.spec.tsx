import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuthForm } from '@/components/AuthForm'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@/components/AmbientGrid', () => ({ AmbientGrid: () => null }))
const response = (body: unknown, ok = true) => ({ ok, json: async () => body })
let request: ReturnType<typeof vi.fn>
function submit(mode: 'login' | 'signup') {
  render(<AuthForm mode={mode} />)
  if (mode === 'signup')
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Learner' } })
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'learner@example.com' },
  })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'example-password' } })
  fireEvent.click(
    screen.getByRole('button', { name: mode === 'signup' ? /Create my account/ : /^Sign in/ }),
  )
}
describe('browser session establishment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    request = vi.fn()
    vi.stubGlobal('fetch', request)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
  it('logs in after signup and verifies the cookie before navigation', async () => {
    request
      .mockResolvedValueOnce(response({ doc: { id: 1 } }))
      .mockResolvedValueOnce(response({ user: { id: 1 } }))
      .mockResolvedValueOnce(response({ user: { id: 1 } }))
    submit('signup')
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/'))
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/api/users',
      '/api/users/login',
      '/api/users/me',
    ])
    for (const [, options] of request.mock.calls)
      expect(options).toMatchObject({ credentials: 'include', cache: 'no-store' })
  })
  it('stays on the form when a successful login does not retain its cookie', async () => {
    request
      .mockResolvedValueOnce(response({ user: { id: 1 } }))
      .mockResolvedValueOnce(response({ user: null }))
    submit('login')
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('did not retain'),
    )
    expect(router.push).not.toHaveBeenCalled()
  })
  it('retries login without creating the same account again', async () => {
    request
      .mockResolvedValueOnce(response({ doc: { id: 1 } }))
      .mockResolvedValueOnce(response({}, false))
    submit('signup')
    await screen.findByRole('alert')
    request
      .mockResolvedValueOnce(response({ user: { id: 1 } }))
      .mockResolvedValueOnce(response({ user: { id: 1 } }))
    fireEvent.click(screen.getByRole('button', { name: /Create my account/ }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/'))
    expect(request.mock.calls.filter(([url]) => url === '/api/users')).toHaveLength(1)
  })
})
