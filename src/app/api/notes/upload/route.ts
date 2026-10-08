import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@/payload.config'
import path from 'path'
import fs from 'fs'
import { buildDownloadFilename, classifyDocumentFilename } from '@/lib/documentClassification'

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const name = formData.get('name') as string
    const chapter = (formData.get('chapter') as string) || ''
    const type = (formData.get('type') as string) || 'Notes'
    let subjectId = formData.get('subject') as string
    const moduleId = formData.get('module') as string
    const topicId = formData.get('topic') as string

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
    const filenameInfo = classifyDocumentFilename(file.name)

    // Resolve or bootstrap subject if necessary
    let resolvedSubjectId: number
    const parsedSubjectId = Number(subjectId)

    if (subjectId && !isNaN(parsedSubjectId) && parsedSubjectId > 0) {
      resolvedSubjectId = parsedSubjectId
    } else {
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

    // A module/topic selected by the learner wins. When nothing was chosen,
    // use the filename as a small, predictable organizer: "Module 1" creates
    // or reuses Module 1 below the selected subject; "1.1" does the same for a topic.
    let resolvedModuleId: number | undefined
    let resolvedTopicId: number | undefined
    let moduleName = ''
    let moduleNumber = ''
    let topicName = ''
    let topicNumber = ''

    const parsedModuleId = Number(moduleId)
    if (moduleId && Number.isFinite(parsedModuleId) && parsedModuleId > 0) {
      const moduleDoc = await payload.findByID({ collection: 'modules', id: parsedModuleId, depth: 0 })
      const moduleSubjectId = typeof moduleDoc.subject === 'object' ? moduleDoc.subject?.id : moduleDoc.subject
      if (Number(moduleSubjectId) !== Number(resolvedSubjectId)) {
        return NextResponse.json({ error: 'The selected module does not belong to this subject.' }, { status: 400 })
      }
      resolvedModuleId = parsedModuleId
      moduleName = moduleDoc.name
      moduleNumber = moduleDoc.number
    } else if (filenameInfo.moduleNumber) {
      const existing = await payload.find({
        collection: 'modules',
        limit: 1,
        where: {
          and: [
            { subject: { equals: resolvedSubjectId } },
            { number: { equals: filenameInfo.moduleNumber } },
          ],
        },
      })
      resolvedModuleId = existing.docs[0]?.id
      moduleName = existing.docs[0]?.name || ''
      moduleNumber = existing.docs[0]?.number || filenameInfo.moduleNumber
      if (!resolvedModuleId) {
        const created = await payload.create({
          collection: 'modules',
          data: {
            subject: resolvedSubjectId,
            number: filenameInfo.moduleNumber,
            name: `Module ${filenameInfo.moduleNumber}`,
          },
        })
        resolvedModuleId = created.id
        moduleName = created.name
        moduleNumber = created.number
      }
    }

    const parsedTopicId = Number(topicId)
    if (topicId && Number.isFinite(parsedTopicId) && parsedTopicId > 0) {
      const topicDoc = await payload.findByID({ collection: 'topics', id: parsedTopicId, depth: 1 })
      const topicModuleId = typeof topicDoc.module === 'object' ? topicDoc.module?.id : topicDoc.module
      if (resolvedModuleId && Number(topicModuleId) !== Number(resolvedModuleId)) {
        return NextResponse.json({ error: 'The selected topic does not belong to this module.' }, { status: 400 })
      }
      resolvedTopicId = parsedTopicId
      resolvedModuleId ||= Number(topicModuleId)
      topicName = topicDoc.name
      topicNumber = topicDoc.number
    } else if (resolvedModuleId && filenameInfo.topicNumber) {
      const existing = await payload.find({
        collection: 'topics',
        limit: 1,
        where: {
          and: [
            { module: { equals: resolvedModuleId } },
            { number: { equals: filenameInfo.topicNumber } },
          ],
        },
      })
      resolvedTopicId = existing.docs[0]?.id
      topicName = existing.docs[0]?.name || ''
      topicNumber = existing.docs[0]?.number || filenameInfo.topicNumber
      if (!resolvedTopicId) {
        const created = await payload.create({
          collection: 'topics',
          data: {
            module: resolvedModuleId,
            number: filenameInfo.topicNumber,
            name: filenameInfo.topicTitle || `Topic ${filenameInfo.topicNumber}`,
          },
        })
        resolvedTopicId = created.id
        topicName = created.name
        topicNumber = created.number
      }
    }

    const subjectDoc = await payload.findByID({ collection: 'subjects', id: resolvedSubjectId, depth: 0 })
    const downloadFilename = buildDownloadFilename({
      subjectName: subjectDoc.name,
      moduleNumber,
      moduleName,
      topicNumber,
      topicName,
      originalFilename: file.name,
    })

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
        subject: resolvedSubjectId,
        module: resolvedModuleId,
        topic: resolvedTopicId,
      },
      file: {
        data: fileBuffer,
        name: downloadFilename,
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
        module: doc.module,
        topic: doc.topic,
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
