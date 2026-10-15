import { describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  sign: vi.fn(async (..._args: any[]) => 'https://example.test/download'),
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: m.sign }))
import { getPresignedDownloadUrl } from '@/lib/r2'
describe('Cross-origin PDF download filenames', () => {
  it('sets a signed attachment filename without changing the PDF viewing URL', async () => {
    await getPresignedDownloadUrl('documents/1.pdf', 'bucket', 3600, 'Math_Logic_Notes.pdf')
    expect(m.sign.mock.calls[0][1].input.ResponseContentDisposition).toContain(
      "filename*=UTF-8''Math_Logic_Notes.pdf",
    )
    await getPresignedDownloadUrl('documents/1.pdf', 'bucket')
    expect(m.sign.mock.calls[1][1].input.ResponseContentDisposition).toBeUndefined()
  })
})
