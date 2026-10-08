export interface SelectionPoint {
  x: number
  y: number
}
export interface PDFTextBox {
  text: string
  x: number
  y: number
  width: number
  height: number
  endOfLine?: boolean
}

export function isClosedLasso(points: SelectionPoint[]): boolean {
  if (points.length < 5) return false
  const first = points[0],
    last = points[points.length - 1]
  const extent = Math.max(
    Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
    Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)),
  )
  return extent >= 8 && Math.hypot(last.x - first.x, last.y - first.y) <= extent * 0.3
}

/** Match text geometry in CSS-page coordinates, independent of canvas DPI. */
export function textInSelection(boxes: PDFTextBox[], points: SelectionPoint[]): string {
  if (points.length < 2) return ''
  const left = Math.min(...points.map((point) => point.x))
  const right = Math.max(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const bottom = Math.max(...points.map((point) => point.y))
  if (right - left < 8 || bottom - top < 8) return ''
  const lasso = isClosedLasso(points)
  // Short gestures behave as a rectangle; a traced circle is a closed lasso.
  function inside(x: number, y: number) {
    if (!lasso) return x >= left && x <= right && y >= top && y <= bottom
    let hit = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i],
        b = points[j]
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit
    }
    return hit
  }
  return boxes
    .filter((box) => {
      // A PDF text item may contain an entire line. Sample across it so circling
      // part of a line does not silently produce an empty selection.
      const y = box.y + box.height / 2
      return [0.1, 0.5, 0.9].some((fraction) => inside(box.x + box.width * fraction, y))
    })
    .map((box) => box.text + (box.endOfLine ? '\n' : ' '))
    .join('')
    .trim()
    .slice(0, 4000)
}
