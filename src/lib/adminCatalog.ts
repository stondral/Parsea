/** Shared labels and parent relationships, not an alternative data-access path. */
export const curriculum = {
  colleges: { label: 'Colleges', singular: 'college', parent: null, field: null },
  branches: { label: 'Branches', singular: 'branch', parent: 'colleges', field: 'college' },
  semesters: { label: 'Semesters', singular: 'semester', parent: 'branches', field: 'branch' },
  subjects: { label: 'Subjects', singular: 'subject', parent: 'semesters', field: 'semester' },
  modules: { label: 'Modules', singular: 'module', parent: 'subjects', field: 'subject' },
  topics: { label: 'Topics', singular: 'topic', parent: 'modules', field: 'module' },
} as const
export type CurriculumCollection = keyof typeof curriculum
export type CurriculumItem = {
  id: number
  name: string
  number: string
  code: string
  parentId: number | null
}

export function relationId(value: unknown): number | null {
  const id = typeof value === 'object' && value !== null && 'id' in value ? value.id : value
  return id === null || id === undefined ? null : Number(id)
}
