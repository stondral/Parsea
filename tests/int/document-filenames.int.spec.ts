import { describe, expect, it } from 'vitest'
import { buildDownloadFilename } from '@/lib/documentClassification'
describe('Descriptive download filenames', () => {
  it('keeps numeric files distinct without ever saving a bare 1.pdf', () => {
    const common = { subjectName: 'Discrete Mathematics', moduleNumber: '1', moduleName: 'Logic' }
    const first = buildDownloadFilename({ ...common, title: '1', originalFilename: '1.pdf' })
    expect(first).toBe('Discrete_Mathematics_Module_1_Logic_Study_notes_1.pdf')
    expect(buildDownloadFilename({ ...common, title: '2', originalFilename: '2.pdf' })).not.toBe(
      first,
    )
  })
  it('strips path characters, duplicate extensions and excessive length', () => {
    const filename = buildDownloadFilename({
      subjectName: '../Math/Logic',
      title: 'Truth tables.pdf',
      originalFilename: '1.pdf',
    })
    expect(filename).not.toMatch(/[\\/]/)
    expect(filename).not.toContain('.pdf.pdf')
    expect(
      buildDownloadFilename({
        subjectName: 'Math',
        title: 'X'.repeat(500),
        originalFilename: '1.pdf',
      }).length,
    ).toBeLessThanOrEqual(174)
  })
})
