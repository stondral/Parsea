export interface FilenameClassification {
  title: string
  moduleNumber?: string
  topicNumber?: string
  topicTitle?: string
}

export interface DownloadFilenameParts {
  subjectName: string
  moduleNumber?: string
  moduleName?: string
  topicNumber?: string
  topicName?: string
  originalFilename: string
  title?: string
}

/**
 * Makes an upload useful before the user has typed anything. It intentionally
 * accepts loose real-world names such as "DM_module-1_logic_1.1.pdf".
 */
export function classifyDocumentFilename(filename: string): FilenameClassification {
  const stem = filename
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const moduleMatch = stem.match(/(?:module|mod|unit)\s*(\d+(?:\.\d+)?)/i)
  const topicMatch = stem.match(
    /(?:topic|chapter|sub(?:\s|-)?module|unit)\s*(\d+\.\d+)(?:\s*[:\-]\s*([^]+))?/i,
  )
  const implicitTopicMatch = stem.match(
    /(?:module|mod|unit)\s*\d+\s+[^\d]*?(\d+\.\d+)\s*[:\-]?\s*([^]*)/i,
  )

  const topicNumber = topicMatch?.[1] || implicitTopicMatch?.[1]
  const topicTitle = (topicMatch?.[2] || implicitTopicMatch?.[2])?.trim() || undefined

  return {
    title: stem,
    moduleNumber: moduleMatch?.[1],
    topicNumber,
    topicTitle,
  }
}

/** A readable, stable filename for browser downloads and R2 storage. */
export function buildDownloadFilename(parts: DownloadFilenameParts): string {
  const labels = [parts.subjectName]
  if (parts.moduleNumber)
    labels.push(`Module ${parts.moduleNumber}${parts.moduleName ? ` ${parts.moduleName}` : ''}`)
  if (parts.topicNumber)
    labels.push(`Topic ${parts.topicNumber}${parts.topicName ? ` ${parts.topicName}` : ''}`)

  const fallback = parts.originalFilename.replace(/\.pdf$/i, '')
  const title = parts.title?.trim().replace(/\.pdf$/i, '') || fallback
  if (title && !/^\d+$/.test(title)) labels.push(title)
  else labels.push(title ? `Study notes ${title}` : 'Study notes')
  const readable = labels.filter(Boolean).join('_')
  return `${
    readable
      .normalize('NFKC')
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '')
      .replace(/[\s—]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._]+|[._]+$/g, '')
      .slice(0, 170) || 'Study_notes'
  }.pdf`
}
