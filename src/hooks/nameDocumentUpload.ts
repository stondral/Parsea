import type { CollectionBeforeOperationHook } from 'payload'
import { buildDownloadFilename, classifyDocumentFilename } from '@/lib/documentClassification'

/** Runs before Payload generates its upload filename, including native /admin. */
export const nameDocumentUpload: CollectionBeforeOperationHook<'documents'> = async ({
  args,
  operation,
  req,
}) => {
  if (!['create', 'update'].includes(operation) || !req.file || !('data' in args) || !args.data)
    return
  if (!Buffer.from(req.file.data).subarray(0, 1024).includes(Buffer.from('%PDF-')))
    throw new Error('This file does not contain a valid PDF header.')
  const data = args.data as Record<string, any>
  const previous =
    operation === 'update' && 'id' in args && args.id
      ? await req.payload.findByID({
          collection: 'documents',
          id: args.id as number,
          depth: 0,
          req,
        })
      : undefined
  const subjectId = data.subject ?? previous?.subject
  const subject = await req.payload.findByID({
    collection: 'subjects',
    id: typeof subjectId === 'object' ? subjectId.id : subjectId,
    depth: 0,
    req,
  })
  const moduleId = data.module ?? previous?.module
  const topicId = data.topic ?? previous?.topic
  const module = moduleId
    ? await req.payload.findByID({
        collection: 'modules',
        id: typeof moduleId === 'object' ? moduleId.id : moduleId,
        depth: 0,
        req,
      })
    : undefined
  const topic = topicId
    ? await req.payload.findByID({
        collection: 'topics',
        id: typeof topicId === 'object' ? topicId.id : topicId,
        depth: 0,
        req,
      })
    : undefined
  const relationId = (value: any) => Number(typeof value === 'object' ? value?.id : value)
  if (module && relationId(module.subject) !== subject.id)
    throw new Error('Module does not belong to this subject.')
  if (topic && (!module || relationId(topic.module) !== module.id))
    throw new Error('Choose the module that contains this topic.')
  const inferred = classifyDocumentFilename(req.file.name).title
  data.name ||=
    previous?.name || (/^\d+$/.test(inferred) ? module?.name || 'Study notes' : inferred)
  data.type ||= previous?.type || 'Notes'
  req.file.name = buildDownloadFilename({
    subjectName: subject.name,
    moduleName: module?.name,
    moduleNumber: module?.number,
    topicName: topic?.name,
    topicNumber: topic?.number,
    title: data.name,
    originalFilename: req.file.name,
  })
}
