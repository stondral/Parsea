/** Optimistic UX only: the legacy synchronous endpoint has no stage telemetry. */
export function estimateUploadProgress(elapsedMs: number) {
  const seconds = Math.max(0, elapsedMs / 1000)
  return {
    percent: Math.min(90, Math.round(12 + 78 * (1 - Math.exp(-seconds / 35)))),
    message:
      seconds < 8
        ? 'Your PDF is on its way.'
        : seconds < 25
          ? 'Making room for your notes. Keep this window open.'
          : seconds < 60
            ? 'The server is still working on this PDF.'
            : 'Still waiting for confirmation. Larger PDFs can take a little longer.',
  }
}
