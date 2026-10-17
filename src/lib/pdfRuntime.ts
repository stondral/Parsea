/** Load real Node canvas primitives before PDF.js evaluates its module globals. */
let initialization: Promise<void> | undefined

export function ensurePDFRuntime(): Promise<void> {
  initialization ||= import('@napi-rs/canvas')
    .then(({ DOMMatrix, ImageData, Path2D }) => {
      if (!DOMMatrix || !ImageData || !Path2D)
        throw new Error('The native canvas package is incomplete.')
      const globals = globalThis as unknown as Record<string, unknown>
      globals.DOMMatrix ||= DOMMatrix
      globals.ImageData ||= ImageData
      globals.Path2D ||= Path2D
    })
    .catch((cause: unknown) => {
      initialization = undefined
      throw new Error(
        'PDF rendering runtime unavailable. Install @napi-rs/canvas with its platform binding and redeploy on Node 22.',
        { cause },
      )
    })
  return initialization
}
