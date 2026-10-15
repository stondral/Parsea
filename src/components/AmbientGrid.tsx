'use client'

import { useEffect, useRef } from 'react'

/** Decorative cursor trail. Draws only while a cell is fading, never a continuous loop. */
export function AmbientGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const cells = new Map<string, { x: number; y: number; touched: number }>()
    const size = 56
    let width = 0
    let height = 0
    let frame = 0
    let lastCell = ''

    function draw(now: number) {
      if (!context) return
      frame = 0
      context.clearRect(0, 0, width, height)
      context.strokeStyle = 'rgba(73, 82, 122, 0.14)'
      context.lineWidth = 1
      context.beginPath()
      for (let x = 0; x <= width; x += size) {
        context.moveTo(x + 0.5, 0)
        context.lineTo(x + 0.5, height)
      }
      for (let y = 0; y <= height; y += size) {
        context.moveTo(0, y + 0.5)
        context.lineTo(width, y + 0.5)
      }
      context.stroke()
      for (const [key, cell] of cells) {
        const life = Math.max(0, 1 - (now - cell.touched) / 1100)
        if (!life) {
          cells.delete(key)
          continue
        }
        context.fillStyle = `rgba(100, 111, 164, ${life * 0.13})`
        context.fillRect(cell.x * size + 1, cell.y * size + 1, size - 1, size - 1)
      }
      if (cells.size) frame = window.requestAnimationFrame(draw)
    }

    function resize() {
      if (!canvas || !context) return
      width = window.innerWidth
      height = window.innerHeight
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      cells.clear()
      lastCell = ''
      if (frame) window.cancelAnimationFrame(frame)
      draw(performance.now())
    }

    function touchCell(event: PointerEvent, refresh = false) {
      if (motionPreference.matches) return
      const x = Math.floor(event.clientX / size)
      const y = Math.floor(event.clientY / size)
      const key = `${x}:${y}`
      if (!refresh && key === lastCell) return
      lastCell = key
      cells.set(key, { x, y, touched: performance.now() })
      // Bound work even if the pointer crosses the whole viewport very quickly.
      if (cells.size > 48) cells.delete(cells.keys().next().value!)
      if (!frame) frame = window.requestAnimationFrame(draw)
    }

    function onPointerMove(event: PointerEvent) {
      // Touch/pen trails only follow contact; mouse hover still works on hybrid devices.
      if (event.pointerType !== 'mouse' && !event.buttons) return
      touchCell(event)
    }

    function onPointerDown(event: PointerEvent) {
      touchCell(event, true)
    }

    function clearTrail() {
      cells.clear()
      lastCell = ''
      if (frame) window.cancelAnimationFrame(frame)
      draw(performance.now())
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('blur', clearTrail)
    motionPreference.addEventListener('change', clearTrail)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('blur', clearTrail)
      motionPreference.removeEventListener('change', clearTrail)
    }
  }, [])

  return <canvas ref={canvasRef} className="home-ambient-grid" aria-hidden="true" />
}
