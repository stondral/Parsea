/** Bytes go to R2, never through a Vercel function. */
export function uploadPDFDirect(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    request.setRequestHeader('Content-Type', 'application/pdf')
    request.timeout = 180_000
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    request.onerror = () =>
      reject(
        new Error('Cloud upload failed. Check your connection and the R2 bucket CORS settings.'),
      )
    request.ontimeout = () => reject(new Error('Cloud upload timed out. Please retry.'))
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`Cloud upload failed (${request.status}). Please retry.`))
    request.send(file)
  })
}

export function smallPDFBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('This file could not be read. Choose it again.'))
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.readAsDataURL(file)
  })
}

export async function PDFContentHash(file: File): Promise<string> {
  if (!crypto.subtle)
    throw new Error(
      'Secure uploads require HTTPS or localhost. Open the production site to upload this PDF.',
    )
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}
