function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '')
}

/** Canonical object paths for ingestion and explicit cloud-copy repairs. */
export function buildDocumentStoragePaths(input: {
  id: number | string; filename: string; branchName?: string; semesterNumber?: number | null;
  subjectName?: string; moduleNumber?: string; moduleName?: string; topicNumber?: string; topicName?: string;
}) {
  const branch = slugify(input.branchName || 'general')
  const semester = input.semesterNumber ? `sem${input.semesterNumber}` : 'general'
  const subject = slugify(input.subjectName || 'notes')
  const module = input.moduleNumber ? `module-${slugify(input.moduleNumber)}-${slugify(input.moduleName || 'notes')}` : 'general'
  const topic = input.topicNumber ? `topic-${slugify(input.topicNumber)}-${slugify(input.topicName || 'notes')}` : 'general'
  const document = slugify(input.filename.replace(/\.pdf$/i, '')) || `document-${input.id}`
  const folder = `documents/${branch}/${semester}/${subject}/${module}/${topic}/${document}`
  return { folder, pdfKey: `${folder}/${input.filename}` }
}
