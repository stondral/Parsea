/** Bound cleanup and preserve the primary ingestion error. */
export async function releaseResource(
  label: string,
  dispose: () => Promise<unknown>,
  timeoutMs = 5000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve().then(dispose),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} cleanup timed out`)), timeoutMs)
      }),
    ])
  } catch (error) {
    console.warn(`${label} cleanup failed:`, error)
  } finally {
    if (timer) clearTimeout(timer)
  }
}
export async function withResourceDeadline<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
