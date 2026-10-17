// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import type { Worker } from 'tesseract.js'
import { managedOCRWorker } from '@/lib/managedOCR'
import { releaseResource, withResourceDeadline } from '@/lib/ingestionResources'
import { recognizeOCR } from '@/lib/ocrRecognition'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
describe('Ingestion resource ownership and deadlines', () => {
  it('rejects pending OCR immediately when the underlying thread crashes', async () => {
    const thread = new EventEmitter()
    const worker = await managedOCRWorker(
      async () =>
        ({
          worker: thread,
          recognize: () => new Promise(() => {}),
          terminate: async () => {},
        }) as unknown as Worker,
    )
    const result = worker.recognize(Buffer.from([1]))
    const failure = expect(result).rejects.toThrow('thread crashed')
    thread.emit('error', new Error('thread crashed'))
    await failure
    await worker.terminate()
  })
  it('terminates exactly once and removes only its owned temporary directory', async () => {
    let directory = ''
    const terminate = vi.fn(async () => {})
    const worker = await managedOCRWorker(async (cache) => {
      directory = cache
      await fs.writeFile(`${cache}/scratch`, 'test')
      return { terminate } as unknown as Worker
    })
    await Promise.all([worker.terminate(), worker.terminate()])
    expect(terminate).toHaveBeenCalledTimes(1)
    await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('collects a worker that initializes after its deadline', async () => {
    let resolve!: (worker: Worker) => void
    let directory = ''
    const terminate = vi.fn(async () => {})
    await expect(
      managedOCRWorker((cache) => {
        directory = cache
        return new Promise((done) => {
          resolve = done
        })
      }, 10),
    ).rejects.toThrow('initialization timed out')
    resolve({ terminate } as unknown as Worker)
    await vi.waitFor(() => expect(terminate).toHaveBeenCalledTimes(1))
    await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('bounds cleanup failures and does not throw over the original error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await releaseResource('hung worker', () => new Promise(() => {}), 10)
    await releaseResource('failed parser', async () => {
      throw new Error('cleanup')
    })
    expect(console.warn).toHaveBeenCalledTimes(2)
  })
  it('rejects a hung parser operation within its deadline', async () => {
    await expect(
      withResourceDeadline(() => new Promise(() => {}), 10, 'render timed out'),
    ).rejects.toThrow('render timed out')
  })
  it('does not launch more rotation passes after OCR expires', async () => {
    vi.useFakeTimers()
    let resolve!: (result: unknown) => void
    const recognize = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const rotate = vi.fn()
    const pending = recognizeOCR({ recognize } as unknown as Worker, Buffer.from([1]), rotate)
    const rejected = expect(pending).rejects.toThrow('OCR timed out')
    await vi.advanceTimersByTimeAsync(45_000)
    await rejected
    resolve({ data: { text: 'Recognized text', confidence: 95 } })
    await Promise.resolve()
    expect(rotate).not.toHaveBeenCalled()
    expect(recognize).toHaveBeenCalledTimes(1)
  })
})
