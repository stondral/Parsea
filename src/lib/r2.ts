import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const R2_ENDPOINT = process.env.R2_ENDPOINT || ''
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
export const R2_BUCKET = process.env.R2_BUCKET || 'stondemporium-media'

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
})

/**
 * Upload a file/buffer directly to Cloudflare R2.
 */
export async function uploadToR2(params: {
  buffer: Buffer | Uint8Array
  key: string
  contentType?: string
  bucket?: string
}): Promise<{ key: string; bucket: string }> {
  const bucket = params.bucket || R2_BUCKET
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    Body: params.buffer,
    ContentType: params.contentType || 'application/pdf',
  })

  await r2Client.send(command)

  return {
    key: params.key,
    bucket,
  }
}

/**
 * Generate a temporary presigned GET URL for secure, direct student download/viewing.
 * Direct R2 download completely offloads PDF bandwidth from Next.js and Payload CMS!
 */
export async function getPresignedDownloadUrl(
  key: string,
  bucket = R2_BUCKET,
  expiresInSeconds = 3600, // 1 hour default
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  })

  return await getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds })
}
