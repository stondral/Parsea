import { describe, expect, it, vi } from 'vitest'
import { nameDocumentUpload } from '@/hooks/nameDocumentUpload'
describe('Payload native upload naming', () => {
  function setup(bytes = '%PDF-test') {
    const req = {
      file: { name: '1.pdf', data: Buffer.from(bytes) },
      payload: { findByID: vi.fn(async () => ({ id: 1, name: 'Discrete Mathematics' })) },
    }
    const args = { data: { subject: 1 } } as any
    return { req, args, hook: { operation: 'create', req, args } as any }
  }
  it('fills native bulk upload Name/Type and renames before file generation', async () => {
    const t = setup()
    await nameDocumentUpload(t.hook)
    expect(t.args.data.name).toBe('Study notes')
    expect(t.args.data.type).toBe('Notes')
    expect(t.req.file.name).toBe('Discrete_Mathematics_Study_notes.pdf')
  })
  it('rejects mislabeled binary files before reading curriculum', async () => {
    const t = setup('not a PDF')
    await expect(nameDocumentUpload(t.hook)).rejects.toThrow('valid PDF header')
    expect(t.req.payload.findByID).not.toHaveBeenCalled()
  })
})
