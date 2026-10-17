import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const nextConfig: NextConfig = {
  // Keep all heavy server-only packages out of the Next.js bundle.
  // Any package that uses native binaries, Node built-ins (fs, child_process),
  // or is purely server-side must be listed here so Turbopack/webpack never
  // tries to bundle it into the client or Edge runtime.
  serverExternalPackages: [
    // Transformers / ML
    '@huggingface/transformers',
    '@xenova/transformers',
    'onnxruntime-node',
    'onnxruntime-web',

    // PDF / Document processing
    'pdf-parse',
    'pdfjs-dist',
    '@langchain/community',
    '@langchain/textsplitters',
    'tesseract.js',

    // LangChain (server-side LLM orchestration)
    '@langchain/core',
    '@langchain/openai',
    'langchain',

    // Image / Canvas (optional native addons)
    'sharp',
    '@napi-rs/canvas',
    'canvas',

    // Database / Cache
    'drizzle-orm',
    'pg',
    'ioredis',

    // AWS SDK (R2 / S3)
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',

    // TTS
    'msedge-tts',

    // Misc Node-only
    'fs-extra',
    'dotenv',
  ],

  // Include physical pnpm store paths only. Root package aliases are directory
  // symlinks; explicitly including their descendants can invalidate Vercel packages.
  // Explicit Linux CPU binding: Transformers resolves native ONNX dynamically.
  outputFileTracingIncludes: {
    '/*': [
      'node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/dist/**',
      'node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/package.json',
      'node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*/linux/x64/*',
      'node_modules/.pnpm/@napi-rs+canvas@*/node_modules/@napi-rs/canvas/**',
      'node_modules/.pnpm/pdf-parse@*/node_modules/pdf-parse/package.json',
      'node_modules/.pnpm/pdf-parse@*/node_modules/pdf-parse/dist/pdf-parse/cjs/**',
      'node_modules/.pnpm/@napi-rs+canvas-linux-x64-gnu@*/node_modules/@napi-rs/canvas-linux-x64-gnu/**',
      'node_modules/.pnpm/tesseract.js-core@*/node_modules/tesseract.js-core/*lstm*',
      'node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      'node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/standard_fonts/**',
      'node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/package.json',
    ],
  },
  outputFileTracingExcludes: {
    '/*': [
      '**/onnxruntime-node/bin/napi-v*/win32/**',
      '**/onnxruntime-node/bin/napi-v*/darwin/**',
      '**/onnxruntime-node/bin/napi-v*/linux/arm64/**',
      '**/onnxruntime-node/bin/napi-v*/linux/x64/*cuda*',
      '**/onnxruntime-node/bin/napi-v*/linux/x64/*tensorrt*',
      '.cache/**',
      'media/**',
    ],
  },

  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },

  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    // Treat optional native modules as externals so webpack never emits
    // "module not found" warnings for packages that are guarded by try/catch
    // at runtime but aren't installed (e.g. @napi-rs/canvas)
    const existingExternals = webpackConfig.externals
    const asArray = Array.isArray(existingExternals)
      ? existingExternals
      : existingExternals
        ? [existingExternals]
        : []

    webpackConfig.externals = [...asArray, '@napi-rs/canvas', 'canvas']

    return webpackConfig
  },

  turbopack: {
    root: path.resolve(dirname),
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
