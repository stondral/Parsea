import 'dotenv/config'
import fs from 'node:fs/promises'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { getPresignedDownloadUrl } from '../src/lib/r2'
import { PAGE_ORIENTATION_VERSION } from '../src/lib/pageOrientation'

const id = Number(process.argv[2]),
  number = Number(process.argv[3] || 1)
if (![id, number].every((value) => Number.isInteger(value) && value > 0))
  throw new Error('Pass a document ID and physical page number.')
const payload = await getPayload({ config })
try {
  const page = (
    await payload.find({
      collection: 'document_pages',
      depth: 0,
      limit: 1,
      where: {
        and: [
          { document: { equals: id } },
          { pageNumber: { equals: number } },
          { orientationVersion: { equals: PAGE_ORIENTATION_VERSION } },
        ],
      },
    })
  ).docs[0]
  if (!page?.previewKey) throw new Error('No current published preview for this page.')
  const response = await fetch(await getPresignedDownloadUrl(page.previewKey), {
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Preview returned ${response.status}.`)
  const png = Buffer.from(await response.arrayBuffer())
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error('Preview is not a PNG.')
  await fs.mkdir('tmp/pdfs', { recursive: true })
  await fs.writeFile(`tmp/pdfs/published-upright-${id}-${number}.png`, png)
  console.log(
    JSON.stringify({
      documentId: id,
      page: number,
      correction: page.orientationRotation,
      confidence: page.orientationConfidence,
      verified: page.orientationVerified,
      pngBytes: png.length,
    }),
  )
} finally {
  await payload.destroy()
}
process.exit(0)
