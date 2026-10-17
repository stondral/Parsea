import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { Worker } from 'tesseract.js'
import type { Worker as NodeWorker } from 'node:worker_threads'
import { releaseResource } from './ingestionResources'

/** One worker owns one disposable directory; never sweep uploads or shared caches. */
export async function managedOCRWorker(
  create: (cachePath: string) => Promise<Worker>,
  timeoutMs = 60_000,
): Promise<Worker> {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'parsea-ocr-job-'))
  let timer: ReturnType<typeof setTimeout> | undefined
  let expired = false
  let owned: Worker | undefined
  let disposal: Promise<void> | undefined
  const dispose = () =>
    (disposal ||= (async () => {
      if (owned)
        await releaseResource('OCR thread', async () => {
          // Tesseract's terminate() resolves before Node's thread actually exits.
          const native = (owned as unknown as { worker?: NodeWorker }).worker
          await Promise.all([
            Promise.resolve().then(() => native?.terminate?.()),
            Promise.resolve().then(() => owned!.terminate()),
          ])
        })
      // The exact target was created above; recursive deletion is confined to it.
      if (
        path.dirname(temporary) !== path.resolve(os.tmpdir()) ||
        !path.basename(temporary).startsWith('parsea-ocr-job-')
      )
        throw new Error('Invalid OCR temporary directory.')
      await fs.rm(temporary, { recursive: true, force: true })
    })())
  try {
    // Reuse a local language fixture when available; never remove its original.
    try {
      await fs.copyFile(
        path.join(process.cwd(), 'eng.traineddata'),
        path.join(temporary, 'eng.traineddata'),
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const creating = create(temporary).then(async (worker) => {
      owned = worker
      if (expired) {
        // Initialization may finish after the caller timed out. Collect it too.
        disposal = undefined
        await dispose()
        throw new Error('OCR initialization completed after its deadline.')
      }
      return worker
    })
    const worker = await Promise.race([
      creating,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true
          reject(
            new Error(
              'OCR worker initialization timed out after 60 seconds. Resume indexing to retry.',
            ),
          )
        }, timeoutMs)
      }),
    ])
    const thread = (worker as unknown as { worker?: NodeWorker }).worker
    let failure: Error | undefined
    const pending = new Set<(error: Error) => void>()
    const failed = (error: Error) => {
      failure = error
      for (const reject of pending) reject(error)
      pending.clear()
    }
    // Tesseract exposes its underlying Node thread on the returned object.
    // Guard that capability so alternate/mock workers remain supported.
    thread?.on?.('error', failed)
    thread?.on?.('exit', (code) => {
      if (!disposal)
        failed(new Error(`OCR worker exited unexpectedly (${code}). Resume indexing to retry.`))
    })
    // Keep the original handle for disposal; callers receive an idempotent owner.
    return new Proxy(worker, {
      get(target, property) {
        if (property === 'terminate') return dispose
        const value = Reflect.get(target, property)
        if (property === 'recognize' && typeof value === 'function')
          return (...args: unknown[]) => {
            if (failure || disposal)
              return Promise.reject(failure || new Error('OCR worker has been disposed.'))
            return new Promise((resolve, reject) => {
              pending.add(reject)
              Promise.resolve()
                .then(() => value.apply(target, args))
                .then(resolve, reject)
                .finally(() => pending.delete(reject))
            })
          }
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  } catch (error) {
    await releaseResource('OCR resources', dispose)
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}
