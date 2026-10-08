import 'dotenv/config'
import { getAppPayload } from '../src/lib/payloadAuth'
import { uploadToR2, getPresignedDownloadUrl } from '../src/lib/r2'
import { buildDocumentStoragePaths } from '../src/lib/documentStorage'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

// Explicit maintenance command: only the provided document is changed.
const id = Number(process.argv[2])
if (!Number.isInteger(id) || id < 1) throw new Error('Provide a positive document ID.')
const payload = await getAppPayload()
try {
  const doc = await payload.findByID({ collection: 'documents', id, depth: 3 })
  if (!doc.filename) throw new Error('No original filename is recorded.')
  if (doc.storageKey) throw new Error('This document already has a cloud key. Refusing to overwrite it.')
  const mediaRoot = path.resolve(process.cwd(), 'media/documents')
  const filePath = path.resolve(mediaRoot, doc.filename)
  if (!filePath.startsWith(mediaRoot + path.sep)) throw new Error('Invalid original file path.')
  const buffer = await readFile(filePath)
  if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('The local file is not a PDF.')
  const subject = typeof doc.subject === 'object' ? doc.subject : undefined
  const semester = subject && typeof subject.semester === 'object' ? subject.semester : undefined
  const branch = semester && typeof semester.branch === 'object' ? semester.branch : undefined
  const module = doc.module && typeof doc.module === 'object' ? doc.module : undefined
  const topic = doc.topic && typeof doc.topic === 'object' ? doc.topic : undefined
  const { pdfKey } = buildDocumentStoragePaths({ id, filename: doc.filename,
    subjectName: subject?.name, semesterNumber: semester?.number, branchName: branch?.name,
    moduleNumber: module?.number, moduleName: module?.name, topicNumber: topic?.number, topicName: topic?.name,
  })
  const cloud = await uploadToR2({ buffer, key: pdfKey, contentType: 'application/pdf' })
  const url = await getPresignedDownloadUrl(cloud.key, cloud.bucket)
  const response = await fetch(url, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`Cloud verification failed (${response.status}). Metadata was not changed.`)
  const prefix = Buffer.from(await response.arrayBuffer())
  if (!prefix.includes(Buffer.from('%PDF-'))) throw new Error('Cloud object is not a readable PDF. Metadata was not changed.')
  await payload.update({ collection: 'documents', id, data: { storageKey: cloud.key, r2Bucket: cloud.bucket } })
  console.log(JSON.stringify({ repairedDocument: id, bytes: buffer.length, cloudVerified: true, vectorsRegenerated: false }))
} finally {
  await payload.db.destroy?.()
}
process.exit(0)
