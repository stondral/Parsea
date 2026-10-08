'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { trpc } from '@/trpc/client'
import { BrandMark } from './BrandMark'
import { AmbientGrid } from './AmbientGrid'
import { AccountMenu } from './AccountMenu'
import { UploadNoteModal } from './UploadNoteModal'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { curriculum, type CurriculumCollection, type CurriculumItem } from '@/lib/adminCatalog'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/routers/_app'
import '@/app/(frontend)/administrator/administrator.css'

type DocumentItem = inferRouterOutputs<AppRouter>['administrator']['documents']['items'][number]
type PersonItem = inferRouterOutputs<AppRouter>['administrator']['users']['items'][number]
type Tab = 'Overview' | 'Materials' | 'Curriculum' | 'People'

function Dialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(true, ref, () => {
    if (!busy) onClose()
  })
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])
  return (
    <div
      className="administrator-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="administrator-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close dialog">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

function Pagination({
  page,
  pages,
  total,
  setPage,
}: {
  page: number
  pages: number
  total: number
  setPage: (page: number) => void
}) {
  return (
    <footer className="administrator-pagination">
      <span>
        {total} total · Page {page} of {Math.max(1, pages)}
      </span>
      <div>
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
    </footer>
  )
}

function QueryState({
  loading,
  error,
  retry,
}: {
  loading: boolean
  error?: { message: string } | null
  retry: () => void
}) {
  if (loading)
    return (
      <p className="administrator-empty" role="status">
        Getting your workspace ready…
      </p>
    )
  if (error)
    return (
      <div className="administrator-error" role="alert">
        {error.message} <button onClick={retry}>Try again</button>
      </div>
    )
  return null
}

export function AdministratorWorkspace({
  user,
}: {
  user: { name?: string; email: string; role?: string | null; semester?: number }
}) {
  const [tab, setTab] = useState<Tab>('Overview')
  const [upload, setUpload] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [subjectId, setSubjectId] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [materialType, setMaterialType] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [documentEdit, setDocumentEdit] = useState<DocumentItem | null>(null)
  const [deleteIds, setDeleteIds] = useState<number[] | null>(null)
  const [health, setHealth] = useState<DocumentItem | null>(null)
  const [level, setLevel] = useState<CurriculumCollection>('subjects')
  const [parentFilter, setParentFilter] = useState('')
  const [folderEdit, setFolderEdit] = useState<{
    id?: number
    name: string
    number: string
    code: string
    parentId: number | null
  } | null>(null)
  const [folderDelete, setFolderDelete] = useState<CurriculumItem | null>(null)
  const [personEdit, setPersonEdit] = useState<PersonItem | null>(null)
  const [originalRole, setOriginalRole] = useState('')
  const [confirmRole, setConfirmRole] = useState(false)
  const utils = trpc.useUtils()
  const overview = trpc.administrator.overview.useQuery(undefined, { retry: false })
  const subjects = trpc.administrator.options.useQuery(
    { collection: 'subjects' },
    { enabled: tab === 'Materials' || upload, retry: false },
  )
  const modules = trpc.administrator.options.useQuery(
    { collection: 'modules', parentId: Number(subjectId) || undefined },
    { enabled: Boolean(subjectId) && tab === 'Materials', retry: false },
  )
  const documents = trpc.administrator.documents.useQuery(
    {
      page,
      search: debouncedSearch,
      subjectId: Number(subjectId) || undefined,
      moduleId: Number(moduleId) || undefined,
      type: materialType ? (materialType as DocumentItem['type']) : undefined,
    },
    { enabled: tab === 'Materials', retry: false },
  )
  const parent = curriculum[level].parent
  const parents = trpc.administrator.options.useQuery(
    { collection: parent || 'colleges' },
    { enabled: Boolean(parent) && tab === 'Curriculum', retry: false },
  )
  const folders = trpc.administrator.folders.useQuery(
    {
      collection: level,
      page,
      search: debouncedSearch,
      parentId: Number(parentFilter) || undefined,
    },
    { enabled: tab === 'Curriculum', retry: false },
  )
  const people = trpc.administrator.users.useQuery(
    { page, search: debouncedSearch },
    { enabled: tab === 'People', retry: false },
  )
  const editDocument = trpc.administrator.editDocument.useMutation()
  const deleteDocuments = trpc.administrator.deleteDocuments.useMutation()
  const saveFolder = trpc.administrator.saveFolder.useMutation()
  const deleteFolder = trpc.administrator.deleteFolder.useMutation()
  const saveUser = trpc.administrator.saveUser.useMutation()
  const reindexDocument = trpc.administrator.reindexDocument.useMutation()
  const modalOpen =
    upload ||
    Boolean(documentEdit || deleteIds || health || folderEdit || folderDelete || personEdit)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    setSelected([])
  }, [page, debouncedSearch, subjectId, moduleId, materialType, tab])

  function changeTab(next: Tab) {
    setTab(next)
    setSearch('')
    setDebouncedSearch('')
    setPage(1)
    setError('')
    setNotice('')
  }
  async function refresh() {
    await Promise.all([utils.administrator.invalidate(), utils.notes.invalidate()])
  }
  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
  }
  function openDialog(action: () => void) {
    setError('')
    setNotice('')
    action()
  }
  const rows = documents.data?.items || []
  const folderRows = folders.data?.items || []
  const allSelected = rows.length > 0 && rows.every((doc) => selected.includes(doc.id))
  const titles: Record<Tab, [string, string]> = {
    Overview: [
      'A little care. A better library.',
      'Keep course material organised, useful, and ready for students.',
    ],
    Materials: [
      'Your material, in good order.',
      'Manage PDFs, organise modules, and see what is actually indexed.',
    ],
    Curriculum: [
      'Give every idea a place.',
      'College → branch → semester → subject → module → topic.',
    ],
    People: [
      'The people learning here.',
      'Manage study profiles and permissions, with a little extra care.',
    ],
  }
  return (
    <div className="administrator-shell parsea-theme">
      <AmbientGrid />
      <div className="administrator-content" inert={modalOpen || undefined}>
        <header className="administrator-topbar">
          <Link href="/" className="administrator-brand">
            <BrandMark />
            <span>
              Parsea<small>ADMINISTRATOR</small>
            </span>
          </Link>
          <div className="administrator-account">
            <Link href="/notes">View library ↗</Link>
            <AccountMenu user={user} authChecked />
          </div>
        </header>
        <nav className="administrator-nav" aria-label="Admin workspace">
          {(['Overview', 'Materials', 'Curriculum', 'People'] as Tab[]).map((item) => (
            <button
              key={item}
              onClick={() => changeTab(item)}
              aria-current={tab === item ? 'page' : undefined}
            >
              {item}
            </button>
          ))}
        </nav>
        <div className="administrator-heading">
          <div>
            <p className="administrator-eyebrow">A QUIET PLACE TO MANAGE</p>
            <h1>{titles[tab][0]}</h1>
            <p>{titles[tab][1]}</p>
          </div>
          <button
            className="administrator-primary"
            onClick={() => openDialog(() => setUpload(true))}
          >
            ＋ Upload PDFs
          </button>
        </div>
        {notice && (
          <p className="administrator-notice" role="status">
            {notice}
          </p>
        )}
        {error && !modalOpen && (
          <p className="administrator-error" role="alert">
            {error}
          </p>
        )}
        {tab === 'Overview' && (
          <>
            <QueryState
              loading={overview.isLoading}
              error={overview.error}
              retry={() => overview.refetch()}
            />
            {overview.data && (
              <div className="administrator-stats">
                {(['documents', 'subjects', 'modules', 'users'] as const).map((key) => (
                  <button
                    key={key}
                    onClick={() => {
                      changeTab(
                        key === 'documents'
                          ? 'Materials'
                          : key === 'users'
                            ? 'People'
                            : 'Curriculum',
                      )
                      if (key === 'subjects' || key === 'modules') setLevel(key)
                    }}
                  >
                    <span>
                      {key === 'documents'
                        ? 'PDFs in the library'
                        : key === 'users'
                          ? 'Registered accounts'
                          : curriculum[key].label}
                    </span>
                    <strong>{overview.data[key]}</strong>
                    <small>Manage ↗</small>
                  </button>
                ))}
              </div>
            )}
            <div className="administrator-guides">
              <section>
                <span className="administrator-eyebrow">START WITH STRUCTURE</span>
                <h2>One module. Many perspectives.</h2>
                <p>
                  Create a subject, add its modules and optional 1.1 / 1.2 topics, then bring all
                  the relevant PDFs into the same place.
                </p>
                <button onClick={() => changeTab('Curriculum')}>Organise curriculum →</button>
              </section>
              <section>
                <span className="administrator-eyebrow">CONTEXT THAT YOU CAN TRUST</span>
                <h2>Uploaded isn’t always indexed.</h2>
                <p>
                  Each PDF shows extracted pages, text chunks, and saved vectors. Missing vectors
                  are flagged instead of being labelled ready.
                </p>
                <button onClick={() => changeTab('Materials')}>Check your materials →</button>
              </section>
            </div>
          </>
        )}
        {tab !== 'Overview' && (
          <section className="administrator-panel" aria-label={tab}>
            <div className="administrator-filters">
              <label className="administrator-search">
                <span className="sr-only">Search {tab.toLowerCase()}</span>
                <input
                  value={search}
                  placeholder={`Search ${tab.toLowerCase()}…`}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setPage(1)
                  }}
                />
              </label>
              {tab === 'Materials' && (
                <>
                  <select
                    aria-label="Filter by subject"
                    value={subjectId}
                    onChange={(e) => {
                      setSubjectId(e.target.value)
                      setModuleId('')
                      setPage(1)
                    }}
                  >
                    <option value="">All subjects</option>
                    {subjects.data?.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter by module"
                    value={moduleId}
                    disabled={!subjectId}
                    onChange={(e) => {
                      setModuleId(e.target.value)
                      setPage(1)
                    }}
                  >
                    <option value="">All modules</option>
                    {modules.data?.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.number}: {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter by material type"
                    value={materialType}
                    onChange={(e) => {
                      setMaterialType(e.target.value)
                      setPage(1)
                    }}
                  >
                    <option value="">All types</option>
                    <option>Notes</option>
                    <option>PYQs</option>
                    <option>Assignments</option>
                  </select>
                </>
              )}
              {tab === 'Curriculum' && (
                <>
                  <select
                    aria-label="Curriculum level"
                    value={level}
                    onChange={(e) => {
                      setLevel(e.target.value as CurriculumCollection)
                      setParentFilter('')
                      setPage(1)
                      setSearch('')
                      setDebouncedSearch('')
                    }}
                  >
                    {Object.entries(curriculum).map(([key, definition]) => (
                      <option key={key} value={key}>
                        {definition.label}
                      </option>
                    ))}
                  </select>
                  {parent && (
                    <select
                      aria-label="Filter by parent"
                      value={parentFilter}
                      onChange={(e) => {
                        setParentFilter(e.target.value)
                        setPage(1)
                      }}
                    >
                      <option value="">All {curriculum[parent].label.toLowerCase()}</option>
                      {parents.data?.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                          {item.number ? ` · ${item.number}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="administrator-primary"
                    onClick={() =>
                      openDialog(() =>
                        setFolderEdit({
                          name: '',
                          number: '',
                          code: '',
                          parentId: Number(parentFilter) || null,
                        }),
                      )
                    }
                  >
                    ＋ Add {curriculum[level].singular}
                  </button>
                </>
              )}
              <button aria-label="Refresh workspace" onClick={() => refresh()}>
                ↻ Refresh
              </button>
            </div>
            {((subjects.data?.truncated && tab === 'Materials') ||
              (parents.data?.truncated && tab === 'Curriculum')) && (
              <p className="administrator-muted">
                Picker shows the first 500 folders. The curriculum table is searchable and
                paginated.
              </p>
            )}
            {tab === 'Materials' && (
              <>
                <QueryState
                  loading={documents.isLoading}
                  error={documents.error || subjects.error || modules.error}
                  retry={() => {
                    documents.refetch()
                    subjects.refetch()
                    if (subjectId) modules.refetch()
                  }}
                />
                {selected.length > 0 && (
                  <div className="administrator-selection">
                    <span>{selected.length} selected on this page</span>
                    <button
                      className="administrator-danger"
                      onClick={() => openDialog(() => setDeleteIds(selected))}
                    >
                      Delete selected
                    </button>
                    <button onClick={() => setSelected([])}>Clear</button>
                  </div>
                )}
                {!documents.isLoading && !documents.error && (
                  <div className="administrator-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>
                            <input
                              type="checkbox"
                              aria-label="Select all PDFs on this page"
                              checked={allSelected}
                              onChange={(e) =>
                                setSelected(e.target.checked ? rows.map((doc) => doc.id) : [])
                              }
                            />
                          </th>
                          <th>Material</th>
                          <th>Folder</th>
                          <th>Index health</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((doc) => (
                          <tr key={doc.id}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select ${doc.name}`}
                                checked={selected.includes(doc.id)}
                                onChange={(e) =>
                                  setSelected(
                                    e.target.checked
                                      ? [...selected, doc.id]
                                      : selected.filter((id) => id !== doc.id),
                                  )
                                }
                              />
                            </td>
                            <td>
                              <strong>{doc.name}</strong>
                              <small>
                                {doc.type} · {(doc.filesize / 1024 / 1024).toFixed(2)} MB
                              </small>
                              <small className="administrator-filename">{doc.filename}</small>
                            </td>
                            <td>
                              <span>{doc.subjectName || 'No subject'}</span>
                              <small>
                                {doc.moduleName || 'General notes'}
                                {doc.topicName ? ` · ${doc.topicName}` : ''}
                              </small>
                            </td>
                            <td>
                              <button
                                className={`administrator-health ${doc.health.chunks > 0 && doc.health.embedded === doc.health.chunks ? 'is-ready' : 'needs-care'}`}
                                onClick={() => openDialog(() => setHealth(doc))}
                              >
                                {doc.health.chunks > 0 && doc.health.embedded === doc.health.chunks
                                  ? 'Vectors saved'
                                  : 'Needs indexing'}
                              </button>
                              <small>
                                {doc.health.pages} pages · {doc.health.embedded}/{doc.health.chunks}{' '}
                                vectors
                              </small>
                              <small>
                                {doc.hasCloudFile
                                  ? 'Cloud key saved'
                                  : 'No cloud PDF key · local only'}
                              </small>
                            </td>
                            <td>
                              <div className="administrator-row-actions">
                                <Link href={`/pdf/${doc.id}`} target="_blank">
                                  Read ↗
                                </Link>
                                <button onClick={() => openDialog(() => setDocumentEdit(doc))}>
                                  Edit
                                </button>
                                <button
                                  className="administrator-danger"
                                  onClick={() => openDialog(() => setDeleteIds([doc.id]))}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length === 0 && (
                      <p className="administrator-empty">
                        No PDFs here yet. Try another filter or upload your first batch.
                      </p>
                    )}
                  </div>
                )}
                {documents.data && (
                  <Pagination
                    page={page}
                    pages={documents.data.pages}
                    total={documents.data.total}
                    setPage={setPage}
                  />
                )}
              </>
            )}
            {tab === 'Curriculum' && (
              <>
                <QueryState
                  loading={folders.isLoading}
                  error={folders.error || parents.error}
                  retry={() => {
                    folders.refetch()
                    if (parent) parents.refetch()
                  }}
                />
                {!folders.isLoading && !folders.error && (
                  <div className="administrator-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{curriculum[level].label}</th>
                          <th>Parent folder</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {folderRows.map((folder) => (
                          <tr key={folder.id}>
                            <td>
                              <strong>
                                {folder.number ? `${folder.number} · ` : ''}
                                {folder.name}
                              </strong>
                              {folder.code && <small>{folder.code}</small>}
                            </td>
                            <td>
                              {parents.data?.items.find((item) => item.id === folder.parentId)
                                ?.name || (folder.parentId ? `Folder #${folder.parentId}` : '—')}
                            </td>
                            <td>
                              <div className="administrator-row-actions">
                                <button onClick={() => openDialog(() => setFolderEdit(folder))}>
                                  Edit
                                </button>
                                {(level === 'subjects' || level === 'modules') && (
                                  <button
                                    onClick={() => {
                                      setSubjectId(
                                        String(level === 'subjects' ? folder.id : folder.parentId),
                                      )
                                      setModuleId(level === 'modules' ? String(folder.id) : '')
                                      setUpload(true)
                                    }}
                                  >
                                    Upload PDFs
                                  </button>
                                )}
                                <button
                                  className="administrator-danger"
                                  onClick={() => openDialog(() => setFolderDelete(folder))}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {folderRows.length === 0 && (
                      <p className="administrator-empty">
                        A fresh folder. Add your first {curriculum[level].singular} to get started.
                      </p>
                    )}
                  </div>
                )}
                {folders.data && (
                  <Pagination
                    page={page}
                    pages={folders.data.pages}
                    total={folders.data.total}
                    setPage={setPage}
                  />
                )}
              </>
            )}
            {tab === 'People' && (
              <>
                <QueryState
                  loading={people.isLoading}
                  error={people.error}
                  retry={() => people.refetch()}
                />
                {!people.isLoading && !people.error && (
                  <div className="administrator-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Semester</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {people.data?.items.map((person) => (
                          <tr key={person.id}>
                            <td>
                              <strong>{person.name || 'Student'}</strong>
                            </td>
                            <td>{person.email}</td>
                            <td>
                              <span className="administrator-role">{person.role}</span>
                            </td>
                            <td>{person.semester || '—'}</td>
                            <td>
                              <button
                                onClick={() =>
                                  openDialog(() => {
                                    setPersonEdit(person)
                                    setOriginalRole(person.role)
                                    setConfirmRole(false)
                                  })
                                }
                              >
                                Edit profile
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {people.data?.items.length === 0 && (
                      <p className="administrator-empty">No matching accounts.</p>
                    )}
                  </div>
                )}
                {people.data && (
                  <Pagination
                    page={page}
                    pages={people.data.pages}
                    total={people.data.total}
                    setPage={setPage}
                  />
                )}
              </>
            )}
          </section>
        )}
        <footer className="administrator-footnote">
          <span>Small details. A stronger study library.</span>
          <Link href="/admin" target="_blank">
            Advanced Payload administration ↗
          </Link>
        </footer>
      </div>
      <UploadNoteModal
        isOpen={upload}
        onClose={() => setUpload(false)}
        initialSubjectId={subjectId}
        initialModuleId={moduleId}
        onSuccess={() => {
          refresh()
          setNotice('PDFs uploaded. Check their index health in Materials.')
        }}
      />
      {documentEdit && (
        <Dialog
          title="Edit material"
          onClose={() => setDocumentEdit(null)}
          busy={editDocument.isPending}
        >
          <form
            className="administrator-form"
            onSubmit={async (e) => {
              e.preventDefault()
              setError('')
              try {
                await editDocument.mutateAsync({
                  id: documentEdit.id,
                  name: documentEdit.name,
                  chapter: documentEdit.chapter,
                  type: documentEdit.type,
                })
                setDocumentEdit(null)
                setNotice('Material updated. Existing vectors are preserved.')
                await refresh()
              } catch (e) {
                fail(e)
              }
            }}
          >
            <label>
              Title
              <input
                required
                maxLength={200}
                value={documentEdit.name}
                onChange={(e) => setDocumentEdit({ ...documentEdit, name: e.target.value })}
              />
            </label>
            <label>
              Chapter / context
              <input
                maxLength={200}
                value={documentEdit.chapter}
                onChange={(e) => setDocumentEdit({ ...documentEdit, chapter: e.target.value })}
              />
            </label>
            <label>
              Material type
              <select
                value={documentEdit.type}
                onChange={(e) =>
                  setDocumentEdit({ ...documentEdit, type: e.target.value as DocumentItem['type'] })
                }
              >
                <option>Notes</option>
                <option>PYQs</option>
                <option>Assignments</option>
              </select>
            </label>
            <p className="administrator-muted">
              Edits update metadata and retrieval tags. They do not re-upload the PDF or regenerate
              its vectors.
            </p>
            {error && (
              <p className="administrator-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                disabled={editDocument.isPending}
                onClick={() => setDocumentEdit(null)}
              >
                Cancel
              </button>
              <button className="administrator-primary" disabled={editDocument.isPending}>
                {editDocument.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
      {deleteIds && (
        <Dialog
          title={`Delete ${deleteIds.length} PDF${deleteIds.length === 1 ? '' : 's'}?`}
          onClose={() => setDeleteIds(null)}
          busy={deleteDocuments.isPending}
        >
          <p>
            This removes the selected library records and their extracted pages and vectors. It
            cannot be undone from this workspace.
          </p>
          <p className="administrator-muted">
            Cloud storage objects follow the existing storage lifecycle; this does not promise an R2
            purge.
          </p>
          {error && (
            <p className="administrator-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button disabled={deleteDocuments.isPending} onClick={() => setDeleteIds(null)}>
              Keep PDFs
            </button>
            <button
              className="administrator-danger"
              disabled={deleteDocuments.isPending}
              onClick={async () => {
                setError('')
                try {
                  const result = await deleteDocuments.mutateAsync({ ids: deleteIds })
                  setSelected(result.failed.map((entry) => entry.id))
                  await refresh()
                  setNotice(
                    `${result.deleted.length} PDF${result.deleted.length === 1 ? '' : 's'} deleted.`,
                  )
                  if (result.failed.length) {
                    setDeleteIds(result.failed.map((entry) => entry.id))
                    setError(
                      result.failed.map((entry) => `#${entry.id}: ${entry.message}`).join(' · '),
                    )
                  } else setDeleteIds(null)
                } catch (e) {
                  fail(e)
                }
              }}
            >
              {deleteDocuments.isPending ? 'Deleting…' : 'Delete PDFs'}
            </button>
          </footer>
        </Dialog>
      )}
      {folderEdit && (
        <Dialog
          title={`${folderEdit.id ? 'Edit' : 'Add'} ${curriculum[level].singular}`}
          onClose={() => setFolderEdit(null)}
          busy={saveFolder.isPending}
        >
          <form
            className="administrator-form"
            onSubmit={async (e) => {
              e.preventDefault()
              setError('')
              try {
                await saveFolder.mutateAsync({
                  ...folderEdit,
                  collection: level,
                  parentId: folderEdit.parentId || undefined,
                })
                setFolderEdit(null)
                setNotice('Folder saved.')
                await refresh()
              } catch (e) {
                fail(e)
              }
            }}
          >
            <label>
              Name
              <input
                required
                maxLength={200}
                value={folderEdit.name}
                onChange={(e) => setFolderEdit({ ...folderEdit, name: e.target.value })}
                placeholder={level === 'modules' ? 'e.g. Logic' : 'Folder name'}
              />
            </label>
            {['semesters', 'modules', 'topics'].includes(level) && (
              <label>
                Number
                <input
                  required
                  maxLength={30}
                  value={folderEdit.number}
                  onChange={(e) => setFolderEdit({ ...folderEdit, number: e.target.value })}
                  placeholder={level === 'topics' ? 'e.g. 1.1' : 'e.g. 1'}
                />
              </label>
            )}
            {level === 'subjects' && (
              <label>
                Subject code · optional
                <input
                  maxLength={50}
                  value={folderEdit.code}
                  onChange={(e) => setFolderEdit({ ...folderEdit, code: e.target.value })}
                />
              </label>
            )}
            {parent && (
              <label>
                {curriculum[parent].singular}
                <select
                  required
                  disabled={Boolean(folderEdit.id)}
                  value={folderEdit.parentId || ''}
                  onChange={(e) =>
                    setFolderEdit({ ...folderEdit, parentId: Number(e.target.value) || null })
                  }
                >
                  <option value="">Choose a parent folder</option>
                  {parents.data?.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.number ? ` · ${item.number}` : ''}
                    </option>
                  ))}
                  {folderEdit.parentId &&
                    !parents.data?.items.some((item) => item.id === folderEdit.parentId) && (
                      <option value={folderEdit.parentId}>Folder #{folderEdit.parentId}</option>
                    )}
                </select>
              </label>
            )}
            {parent && !parents.isLoading && !parents.data?.items.length && (
              <p className="administrator-muted">Create a {curriculum[parent].singular} first.</p>
            )}
            {parents.error && (
              <p role="alert">Parent folders couldn’t load. Close this dialog and refresh.</p>
            )}
            {error && (
              <p className="administrator-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                disabled={saveFolder.isPending}
                onClick={() => setFolderEdit(null)}
              >
                Cancel
              </button>
              <button
                className="administrator-primary"
                disabled={saveFolder.isPending || Boolean(parent && !folderEdit.parentId)}
              >
                {saveFolder.isPending ? 'Saving…' : 'Save folder'}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
      {folderDelete && (
        <Dialog
          title={`Delete “${folderDelete.name}”?`}
          onClose={() => setFolderDelete(null)}
          busy={deleteFolder.isPending}
        >
          <p>
            Only empty folders can be deleted. PDFs and child folders are never silently removed.
          </p>
          {error && (
            <p className="administrator-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button disabled={deleteFolder.isPending} onClick={() => setFolderDelete(null)}>
              Keep folder
            </button>
            <button
              className="administrator-danger"
              disabled={deleteFolder.isPending}
              onClick={async () => {
                setError('')
                try {
                  await deleteFolder.mutateAsync({ collection: level, id: folderDelete.id })
                  setFolderDelete(null)
                  setNotice('Empty folder deleted.')
                  await refresh()
                } catch (e) {
                  fail(e)
                }
              }}
            >
              {deleteFolder.isPending ? 'Deleting…' : 'Delete folder'}
            </button>
          </footer>
        </Dialog>
      )}
      {health && (
        <Dialog
          title="Index health"
          onClose={() => setHealth(null)}
          busy={reindexDocument.isPending}
        >
          <h3>{health.name}</h3>
          <dl className="administrator-health-details">
            <div>
              <dt>Extracted pages</dt>
              <dd>{health.health.pages}</dd>
            </div>
            <div>
              <dt>Text chunks</dt>
              <dd>{health.health.chunks}</dd>
            </div>
            <div>
              <dt>Saved vectors</dt>
              <dd>{health.health.embedded}</dd>
            </div>
          </dl>
          {!health.hasCloudFile && (
            <p className="administrator-error">
              No cloud PDF key is saved. Re-indexing can only recover this file if the original is
              still available on this server; otherwise upload the original PDF again.
            </p>
          )}
          <p>
            {health.health.chunks > 0 && health.health.embedded === health.health.chunks
              ? 'These chunks have saved embeddings. Retrieval still depends on the question and course filters.'
              : 'This PDF does not have a complete vector index. It may not supply context or citations to chat. Upload completion alone does not confirm indexing.'}
          </p>
          <p className="administrator-muted">
            Re-indexing reads the saved PDF and replaces its extracted pages and vectors. It can
            take a while for large PDFs. File replacement remains in advanced administration.
          </p>
          {error && (
            <p className="administrator-error" role="alert">
              {error}
            </p>
          )}
          {reindexDocument.isPending && (
            <p role="status">
              Working through your PDF. Keep this window open until the server confirms indexing.
            </p>
          )}
          <footer>
            <button disabled={reindexDocument.isPending} onClick={() => setHealth(null)}>
              Done
            </button>
            <button
              className="administrator-primary"
              disabled={reindexDocument.isPending}
              onClick={async () => {
                setError('')
                try {
                  await reindexDocument.mutateAsync({ id: health.id })
                  setHealth(null)
                  setNotice('Re-indexing confirmed. Updated counts are in Materials.')
                  await refresh()
                } catch (e) {
                  fail(e)
                }
              }}
            >
              {reindexDocument.isPending ? 'Re-indexing…' : 'Re-index PDF'}
            </button>
          </footer>
        </Dialog>
      )}
      {personEdit && (
        <Dialog
          title="Edit study profile"
          onClose={() => setPersonEdit(null)}
          busy={saveUser.isPending}
        >
          <form
            className="administrator-form"
            onSubmit={async (e) => {
              e.preventDefault()
              setError('')
              try {
                await saveUser.mutateAsync({
                  id: personEdit.id,
                  name: personEdit.name,
                  semester: personEdit.semester || null,
                  role: personEdit.role,
                  confirmRoleChange: confirmRole,
                })
                setPersonEdit(null)
                setNotice('Profile saved.')
                await refresh()
              } catch (e) {
                fail(e)
              }
            }}
          >
            <p className="administrator-muted">{personEdit.email}</p>
            <label>
              Name
              <input
                maxLength={200}
                value={personEdit.name}
                onChange={(e) => setPersonEdit({ ...personEdit, name: e.target.value })}
              />
            </label>
            <label>
              Semester
              <select
                value={personEdit.semester || ''}
                onChange={(e) =>
                  setPersonEdit({ ...personEdit, semester: Number(e.target.value) || null })
                }
              >
                <option value="">Not set</option>
                {Array.from({ length: 8 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Role
              <select
                value={personEdit.role}
                onChange={(e) => {
                  setPersonEdit({ ...personEdit, role: e.target.value as PersonItem['role'] })
                  setConfirmRole(false)
                }}
              >
                <option value="student">Student</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            {originalRole !== personEdit.role && (
              <label className="administrator-role-confirm">
                <input
                  type="checkbox"
                  required
                  checked={confirmRole}
                  onChange={(e) => setConfirmRole(e.target.checked)}
                />
                <span>I understand this changes access to all administrative tools.</span>
              </label>
            )}
            {error && (
              <p className="administrator-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                disabled={saveUser.isPending}
                onClick={() => setPersonEdit(null)}
              >
                Cancel
              </button>
              <button
                className="administrator-primary"
                disabled={saveUser.isPending || (originalRole !== personEdit.role && !confirmRole)}
              >
                {saveUser.isPending ? 'Saving…' : 'Save profile'}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
    </div>
  )
}
