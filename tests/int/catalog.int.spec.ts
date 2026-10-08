import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ query: vi.fn(), on: vi.fn() }))
vi.mock('pg', () => ({
  Pool: class {
    query = database.query
    on = database.on
  },
}))

describe('lightweight public catalog', () => {
  beforeEach(() => {
    vi.resetModules()
    database.query.mockReset()
    delete (globalThis as typeof globalThis & { parseaCatalogPool?: unknown }).parseaCatalogPool
  })

  it('reads subjects, semesters, and branch names in one joined query', async () => {
    database.query.mockResolvedValue({
      rows: [{ id: 1, name: 'Math', code: 'M1', semesterNumber: 3, branchName: 'COMPS' }],
    })
    const { readSubjects } = await import('@/lib/catalog')
    expect(await readSubjects({ semester: 3, branch: 'COMPS' })).toHaveLength(1)
    expect(database.query).toHaveBeenCalledTimes(1)
    const [sql, params] = database.query.mock.calls[0]
    expect(sql).toContain('LEFT JOIN semesters')
    expect(sql).toContain('LEFT JOIN branches')
    expect(sql).toContain('sem.number = $1')
    expect(params).toEqual([3, '%COMPS%'])
  })

  it('applies literal searches and relationship filters before the 100-file limit', async () => {
    database.query.mockResolvedValue({ rows: [] })
    const { readNotes } = await import('@/lib/catalog')
    await readNotes({
      semester: 3,
      subject: "Math'; DROP TABLE documents;--",
      search: '100%_notes',
    })
    const [sql, params] = database.query.mock.calls[0]
    expect(sql).not.toContain('DROP TABLE')
    expect(sql.indexOf('WHERE')).toBeLessThan(sql.indexOf('LIMIT 100'))
    expect(params).toEqual(["%Math'; DROP TABLE documents;--%", 3, '%100\\%\\_notes%'])
    expect(sql).toContain('m.name ILIKE $3')
    expect(sql).toContain('t.name ILIKE $3')
  })

  it('keeps module and topic order natural and dates serializable', async () => {
    database.query.mockResolvedValue({
      rows: [
        {
          id: 10,
          name: 'Ten',
          subjectName: 'Math',
          moduleNumber: '10',
          createdAt: new Date('2026-10-01'),
        },
        {
          id: 2,
          name: 'Two',
          subjectName: 'Math',
          moduleNumber: '2',
          createdAt: new Date('2026-10-01'),
        },
      ],
    })
    const { readNotes } = await import('@/lib/catalog')
    const notes = await readNotes()
    expect(notes.map((note) => note.id)).toEqual([2, 10])
    expect(typeof notes[0].createdAt).toBe('string')
  })

  it('counts rows without hydrating documents or their relations', async () => {
    database.query.mockResolvedValue({ rows: [{ totalDocuments: 7, totalSubjects: 2 }] })
    const { readCatalogStats } = await import('@/lib/catalog')
    expect(await readCatalogStats()).toEqual({ totalDocuments: 7, totalSubjects: 2 })
    expect(database.query.mock.calls[0][0]).toContain('COUNT(*)')
    expect(database.query).toHaveBeenCalledTimes(1)
  })
})
