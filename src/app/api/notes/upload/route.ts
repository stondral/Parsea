import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { buildDownloadFilename, classifyDocumentFilename } from '@/lib/documentClassification'

export const runtime = 'nodejs'
export const maxDuration = 300

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
    if (file.size > 25 * 1024 * 1024)
      return NextResponse.json({ error: 'Split PDFs larger than 25 MB into smaller module files.' }, { status: 400 })

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Please provide a title for the document.' }, { status: 400 })
    }

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF documents are supported.' }, { status: 400 })
    }
    if (!['Notes', 'PYQs', 'Assignments'].includes(type))
      return NextResponse.json({ error: 'Choose a valid document type.' }, { status: 400 })
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    if (!fileBuffer.subarray(0, 1024).includes(Buffer.from('%PDF-')))
      return NextResponse.json({ error: 'This file does not contain a valid PDF header.' }, { status: 400 })

    const payloadConfig = await config
    const payload = await getPayload({ config: payloadConfig })
    const uploadUser = (await payload.auth({ headers: req.headers })).user
    const filenameInfo = classifyDocumentFilename(file.name)

    // Never silently place a PDF under an arbitrary first subject.
    const resolvedSubjectId = Number(subjectId)
    if (!Number.isInteger(resolvedSubjectId) || resolvedSubjectId < 1)
      return NextResponse.json({ error: 'Choose a subject before uploading.' }, { status: 400 })
    const replacement = Number(formData.get('replaceDocumentId'))
    let admin: Awaited<ReturnType<typeof payload.auth>>['user'] = null
    if (formData.has('replaceDocumentId')) {
      if (!Number.isInteger(replacement) || replacement < 1)
        return NextResponse.json({ error: 'Invalid replacement document.' }, { status: 400 })
      admin = uploadUser
      if (admin?.role !== 'admin')
        return NextResponse.json({ error: 'Only admins can replace library PDFs.' }, { status: 403 })
      await payload.findByID({ collection: 'documents', id: replacement, user: admin, overrideAccess: false })
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
        if (uploadUser?.role !== 'admin')
          return NextResponse.json({ error: 'Choose an existing module. Only admins can add curriculum folders.' }, { status: 400 })
        const created = await payload.create({
          collection: 'modules',
          user: uploadUser,
          overrideAccess: false,
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
      const parentModule = await payload.findByID({ collection: 'modules', id: Number(topicModuleId), depth: 0 })
      const parentSubject = typeof parentModule.subject === 'object' ? parentModule.subject?.id : parentModule.subject
      if (Number(parentSubject) !== resolvedSubjectId)
        return NextResponse.json({ error: 'The selected topic does not belong to this subject.' }, { status: 400 })
      if (resolvedModuleId && Number(topicModuleId) !== Number(resolvedModuleId)) {
        return NextResponse.json({ error: 'The selected topic does not belong to this module.' }, { status: 400 })
      }
      resolvedTopicId = parsedTopicId
      resolvedModuleId ||= Number(topicModuleId)
      moduleName = parentModule.name
      moduleNumber = parentModule.number
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
        if (uploadUser?.role !== 'admin')
          return NextResponse.json({ error: 'Choose an existing topic. Only admins can add curriculum folders.' }, { status: 400 })
        const created = await payload.create({
          collection: 'topics',
          user: uploadUser,
          overrideAccess: false,
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
      title: name.trim(),
    })

    // Create document in Payload CMS
    // This automatically triggers the afterChange: [processDocument] hook
    // which uploads to Cloudflare R2, extracts diagrams, and indexes vector embeddings
    const data = {
      name: name.trim(), chapter: chapter.trim() || name.trim(),
      type: type as 'Notes' | 'PYQs' | 'Assignments', subject: resolvedSubjectId,
      module: resolvedModuleId, topic: resolvedTopicId,
    }
    const upload = { data: fileBuffer, name: downloadFilename, mimetype: 'application/pdf', size: fileBuffer.length }
    const doc = replacement
      ? await payload.update({ collection: 'documents', id: replacement, data, file: upload, user: admin, overrideAccess: false, context: { forceDocumentIngestion: true } })
      : await payload.create({ collection: 'documents', data, file: upload })

    return NextResponse.json({
      success: true,
      indexed: true,
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
