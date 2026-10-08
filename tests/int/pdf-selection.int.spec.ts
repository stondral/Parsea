import { describe, expect, it } from 'vitest'
import { textInSelection } from '@/lib/pdf-selection'

const boxes = [
  { text: 'Logic and truth tables', x: 10, y: 20, width: 180, height: 12, endOfLine: true },
  { text: 'Unrelated paragraph', x: 10, y: 100, width: 180, height: 12 },
]

describe('PDF region selection', () => {
  it('selects text inside a dragged rectangle only', () => {
    expect(
      textInSelection(boxes, [
        { x: 0, y: 10 },
        { x: 200, y: 40 },
      ]),
    ).toBe('Logic and truth tables')
  })
  it('supports a closed lasso and leaves outside text out', () => {
    expect(
      textInSelection(boxes, [
        { x: 0, y: 10 },
        { x: 100, y: 0 },
        { x: 200, y: 10 },
        { x: 200, y: 50 },
        { x: 0, y: 50 },
        { x: 0, y: 10 },
      ]),
    ).toBe('Logic and truth tables')
  })
  it('treats a many-point straight drag as a rectangle, not an empty polygon', () => {
    expect(
      textInSelection(boxes, [
        { x: 0, y: 10 },
        { x: 40, y: 16 },
        { x: 80, y: 22 },
        { x: 120, y: 28 },
        { x: 160, y: 34 },
        { x: 200, y: 40 },
      ]),
    ).toBe('Logic and truth tables')
  })
  it('does not treat a click or tiny scribble as selected text', () => {
    expect(textInSelection(boxes, [{ x: 0, y: 10 }])).toBe('')
    expect(
      textInSelection(boxes, [
        { x: 10, y: 20 },
        { x: 12, y: 22 },
      ]),
    ).toBe('')
  })
  it('returns an empty selection for image-only pages', () => {
    expect(
      textInSelection(
        [],
        [
          { x: 0, y: 0 },
          { x: 200, y: 200 },
        ],
      ),
    ).toBe('')
  })
  it('bounds transferred text without inventing OCR or visual understanding', () => {
    expect(
      textInSelection(
        [{ ...boxes[0], text: 'a'.repeat(6000) }],
        [
          { x: 0, y: 10 },
          { x: 200, y: 40 },
        ],
      ),
    ).toHaveLength(4000)
  })
})
