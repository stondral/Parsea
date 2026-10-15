import { describe, expect, it, vi } from 'vitest'
vi.mock('@/payload.config', () => ({ default: {} }))
import { isElaborationQuery } from '@/lib/rag'
describe('Session retrieval isolation', () => {
  it('does not mistake a new academic topic for a cached follow-up', () => {
    for (const question of [
      'Explain quantum mechanics',
      'Give examples of Euclidean division',
      'Compare groups and rings',
      'What is the algorithm for sorting?',
    ])
      expect(isElaborationQuery(question)).toBe(false)
  })
  it('allows explicitly referential clarification', () => {
    for (const question of [
      'Explain that again',
      'Give me an example',
      'Make it simpler',
      'Why is this true?',
    ])
      expect(isElaborationQuery(question)).toBe(true)
  })
})
