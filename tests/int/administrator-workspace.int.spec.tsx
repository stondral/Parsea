import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AdministratorWorkspace } from '@/components/AdministratorWorkspace'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  reindex: vi.fn(),
  saveUser: vi.fn(),
  refresh: vi.fn(async () => {}),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/components/AmbientGrid', () => ({ AmbientGrid: () => null }))
vi.mock('@/components/UploadNoteModal', () => ({
  UploadNoteModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? (
      <div role="dialog" aria-label="Batch PDFs">
        Batch upload
      </div>
    ) : null,
}))
vi.mock('@/trpc/client', () => {
  const query = (data: unknown) => ({
    useQuery: () => ({ data, isLoading: false, refetch: vi.fn() }),
  })
  const mutation = (mutateAsync: any) => ({
    useMutation: () => ({ mutateAsync, isPending: false }),
  })
  return {
    trpc: {
      useUtils: () => ({
        administrator: { invalidate: mocks.refresh },
        notes: { invalidate: mocks.refresh },
      }),
      administrator: {
        overview: query({ documents: 1, subjects: 1, modules: 1, users: 2 }),
        options: query({
          items: [{ id: 1, name: 'Discrete Mathematics', number: '', parentId: 3 }],
          truncated: false,
        }),
        folders: query({
          items: [{ id: 1, name: 'Discrete Mathematics', number: '', parentId: 3 }],
          pages: 1,
          total: 1,
        }),
        documents: query({
          items: [
            {
              id: 2,
              name: 'Logic',
              type: 'Notes',
              chapter: '',
              filename: 'Logic.pdf',
              filesize: 1000,
              subjectName: 'Discrete Mathematics',
              moduleName: 'Module 1: Logic',
              health: { pages: 4, chunks: 0, embedded: 0 },
            },
          ],
          pages: 1,
          total: 1,
        }),
        users: query({
          items: [
            { id: 3, name: 'Student', email: 'student@example.test', role: 'student', semester: 3 },
          ],
          pages: 1,
          total: 1,
        }),
        editDocument: mutation(mocks.save),
        deleteDocuments: mutation(mocks.remove),
        reindexDocument: mutation(mocks.reindex),
        saveFolder: mutation(mocks.save),
        deleteFolder: mutation(mocks.remove),
        saveUser: mutation(mocks.saveUser),
      },
    },
  }
})
function setup() {
  return render(
    <AdministratorWorkspace user={{ email: 'admin@example.test', name: 'Admin', role: 'admin' }} />,
  )
}

describe('Calm administrator workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.save.mockResolvedValue({ saved: 2 })
    mocks.remove.mockResolvedValue({ deleted: [2], failed: [] })
    mocks.saveUser.mockResolvedValue({ saved: 3 })
  })
  afterEach(cleanup)

  it('uses a pill navigation without a sidebar and opens shared batch upload', () => {
    const { container } = setup()
    expect(screen.getByRole('navigation', { name: 'Admin workspace' })).toBeDefined()
    expect(container.querySelector('aside')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '＋ Upload PDFs' }))
    expect(screen.getByRole('dialog', { name: 'Batch PDFs' })).toBeDefined()
    expect(container.querySelector('.administrator-content')?.hasAttribute('inert')).toBe(true)
  })

  it('shows real missing-index status and saves metadata independently', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Materials' }))
    expect(screen.getByRole('button', { name: 'Needs indexing' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Logic and proofs' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        id: 2,
        name: 'Logic and proofs',
        chapter: '',
        type: 'Notes',
      }),
    )
    expect(mocks.reindex).not.toHaveBeenCalled()
  })

  it('requires confirmation before selected PDFs are deleted', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Materials' }))
    fireEvent.click(screen.getByLabelText('Select Logic'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
    expect(mocks.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete PDFs' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ ids: [2] }))
  })

  it('requires permission acknowledgement before a profile role change', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'People' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'admin' } })
    expect(
      (screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(
      screen.getByLabelText('I understand this changes access to all administrative tools.'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() =>
      expect(mocks.saveUser).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'admin', confirmRoleChange: true }),
      ),
    )
  })
})
