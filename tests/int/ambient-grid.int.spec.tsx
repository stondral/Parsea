import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { AmbientGrid } from '@/components/AmbientGrid'

describe('Ambient grid pointer support', () => {
  const fillRect = vi.fn()
  let frame: FrameRequestCallback | undefined
  let reduced = false

  beforeEach(() => {
    reduced = false
    fillRect.mockClear()
    frame = undefined
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      stroke: vi.fn(), setTransform: vi.fn(), fillRect,
    } as unknown as CanvasRenderingContext2D)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frame = callback; return 1 }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  function pointer(type: string, pointerType: string, buttons = 0) {
    const event = new MouseEvent(type, { clientX: 80, clientY: 80, buttons, cancelable: true })
    Object.defineProperty(event, 'pointerType', { value: pointerType })
    window.dispatchEvent(event)
    return event
  }

  it.each(['touch', 'pen', 'mouse'])('lights cells for %s contact without cancelling scrolling or clicks', (pointerType) => {
    render(<AmbientGrid />)
    expect(pointer('pointerdown', pointerType, 1).defaultPrevented).toBe(false)
    expect(frame).toBeDefined()
    frame!(performance.now())
    expect(fillRect).toHaveBeenCalledWith(57, 57, 55, 55)
  })

  it('allows mouse hover on hybrid devices but ignores unpressed touch movement', () => {
    render(<AmbientGrid />)
    pointer('pointermove', 'touch')
    expect(frame).toBeUndefined()
    pointer('pointermove', 'mouse')
    expect(frame).toBeDefined()
  })

  it('keeps reduced-motion users static and removes listeners on unmount', () => {
    reduced = true
    const { unmount } = render(<AmbientGrid />)
    pointer('pointerdown', 'touch', 1)
    expect(frame).toBeUndefined()
    unmount()
    reduced = false
    pointer('pointerdown', 'mouse', 1)
    expect(frame).toBeUndefined()
  })
})
