import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3'
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
  downloadFilename?: string,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ...(downloadFilename
      ? {
          ResponseContentDisposition: `attachment; filename="Study_notes.pdf"; filename*=UTF-8''${encodeURIComponent(downloadFilename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        }
      : {}),
  })

  return await getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds })
}

export async function getPresignedUploadUrl(key: string): Promise<string> {
  return getSignedUrl(
    r2Client,
    new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: 'application/pdf' }),
    { expiresIn: 900 },
  )
}

export async function getR2ObjectSize(key: string): Promise<number> {
  const object = await r2Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }))
  return object.ContentLength || 0
}

/** Stage an immutable re-index source inside R2; no large PDF proxy through Vercel. */
export async function copyR2Object(sourceKey: string, targetKey: string, sourceBucket = R2_BUCKET) {
  await r2Client.send(
    new CopyObjectCommand({
      Bucket: R2_BUCKET,
      Key: targetKey,
      CopySource: `${encodeURIComponent(sourceBucket)}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
    }),
  )
  return getR2ObjectSize(targetKey)
}
