import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@/payload.config'
import path from 'path'
import fs from 'fs'

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const name = formData.get('name') as string
    const chapter = (formData.get('chapter') as string) || ''
    const type = (formData.get('type') as string) || 'Notes'
    let subjectId = formData.get('subject') as string

    if (!file) {
      return NextResponse.json({ error: 'Please choose a PDF file to upload.' }, { status: 400 })
    }

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Please provide a title for the document.' }, { status: 400 })
    }

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF documents are supported.' }, { status: 400 })
    }

    const payloadConfig = await config
    const payload = await getPayload({ config: payloadConfig })

    // Resolve or bootstrap subject if necessary
    let resolvedSubjectId: number | string = subjectId
    if (!resolvedSubjectId || resolvedSubjectId === 'undefined') {
      const existingSubjects = await payload.find({ collection: 'subjects', limit: 1 })
      if (existingSubjects.docs.length > 0) {
        resolvedSubjectId = existingSubjects.docs[0].id
      } else {
        // Bootstrap baseline academic hierarchy
        const existingSem = await payload.find({ collection: 'semesters', limit: 1 })
        let semId = existingSem.docs[0]?.id
        if (!semId) {
          const existingBranch = await payload.find({ collection: 'branches', limit: 1 })
          let branchId = existingBranch.docs[0]?.id
          if (!branchId) {
            const existingCollege = await payload.find({ collection: 'colleges', limit: 1 })
            let colId = existingCollege.docs[0]?.id
            if (!colId) {
              const newCol = await payload.create({
                collection: 'colleges',
                data: { name: 'Engineering College' },
              })
              colId = newCol.id
            }
            const newBranch = await payload.create({
              collection: 'branches',
              data: { name: 'Computer Engineering', college: colId },
            })
            branchId = newBranch.id
          }
          const newSem = await payload.create({
            collection: 'semesters',
            data: { name: 'Semester 3', number: 3, branch: branchId },
          })
          semId = newSem.id
        }
        const newSub = await payload.create({
          collection: 'subjects',
          data: { name: 'Discrete Mathematics', semester: semId },
        })
        resolvedSubjectId = newSub.id
      }
    }

    const arrayBuffer = await file.arrayBuffer()
    const fileBuffer = Buffer.from(arrayBuffer)

    // Ensure local destination media folder exists
    const mediaDir = path.resolve(process.cwd(), 'media/documents')
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true })
    }

    // Create document in Payload CMS
    // This automatically triggers the afterChange: [processDocument] hook
    // which uploads to Cloudflare R2, extracts diagrams, and indexes vector embeddings
    const doc = await payload.create({
      collection: 'documents',
      data: {
        name: name.trim(),
        chapter: chapter.trim() || name.trim(),
        type: (type as any) || 'Notes',
        subject: isNaN(Number(resolvedSubjectId)) ? resolvedSubjectId : Number(resolvedSubjectId),
      },
      file: {
        data: fileBuffer,
        name: file.name,
        mimetype: 'application/pdf',
        size: fileBuffer.length,
      },
    })

    return NextResponse.json({
      success: true,
      doc: {
        id: doc.id,
        name: doc.name,
        filename: doc.filename,
        chapter: doc.chapter,
        type: doc.type,
      },
    })
  } catch (error: any) {
    console.error('Note upload error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to process and ingest document.' },
      { status: 500 }
    )
  }
}
