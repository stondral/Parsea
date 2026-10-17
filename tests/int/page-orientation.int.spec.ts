import { describe, expect, it, vi } from 'vitest'
import { orientationFromText, normalizeRotation } from '@/lib/pageOrientation'
import { recognizeOCR, LowConfidenceOCRError } from '@/lib/ocrRecognition'

describe('Shared per-page orientation', () => {
  const viewport = [1, 0, 0, -1, 0, 800]
  it.each([0, 90, 180, 270])(
    'corrects a %i-degree text baseline without changing page identity',
    (angle) => {
      const radians = (angle * Math.PI) / 180
      const result = orientationFromText(
        [
          {
            str: 'Equivalence relations are reflexive transitive and symmetric',
            transform: [Math.cos(radians), Math.sin(radians), 0, 1, 0, 0],
          },
        ],
        viewport,
      )
      expect(result.rotation).toBe(angle)
      expect(result.verified).toBe(true)
    },
  )
  it('incorporates metadata in the text viewport and adds only the extra correction in the reader', () => {
    const result = orientationFromText(
      [
        {
          str: 'This sentence is already upright after PDF metadata rotation',
          transform: [0, 1, -1, 0, 0, 0],
        },
      ],
      [0, 1, 1, 0, 0, 0],
    )
    expect(result.rotation).toBe(0)
    expect(normalizeRotation(90 + result.rotation)).toBe(90)
    expect(normalizeRotation(-90)).toBe(270)
  })
  it('does not guess direction from numeric diagram labels or conflicting text', () => {
    expect(
      orientationFromText([{ str: '46 104 38 88', transform: [0, 1, 1, 0, 0, 0] }], viewport)
        .verified,
    ).toBe(false)
    expect(
      orientationFromText(
        [0, 90].map((angle) => ({
          str: 'A sufficiently long paragraph with academic words',
          transform: [
            Math.cos((angle * Math.PI) / 180),
            Math.sin((angle * Math.PI) / 180),
            0,
            1,
            0,
            0,
          ],
        })),
        viewport,
      ).verified,
    ).toBe(false)
  })
  it.each([90, 180, 270])(
    'retains OCR confidence and the winning %i-degree correction',
    async (angle) => {
      const text = 'Equivalence relations are reflexive transitive and symmetric.'
      const worker = {
        recognize: vi.fn(async (image: string) => ({
          data: { text, confidence: image === String(angle) ? 96 : 20 },
        })),
      }
      const result = await recognizeOCR(worker as any, '0', async (degrees) => String(degrees))
      expect(result).toMatchObject({ text, rotation: angle, confidence: 96, verified: true })
      expect(worker.recognize).toHaveBeenCalledTimes(4)
    },
  )
  it('keeps the original direction when competing OCR scores are too close', async () => {
    const worker = {
      recognize: vi.fn(async (image: string) => ({
        data: {
          text: 'A clear academic paragraph with enough letters for detection.',
          confidence: image === '90' ? 89 : 85,
        },
      })),
    }
    expect(
      await recognizeOCR(worker as any, '0', async (degrees) => String(degrees)),
    ).toMatchObject({ rotation: 0, verified: false })
  })
  it('never treats low-confidence gibberish as reliable OCR', async () => {
    const worker = {
      recognize: vi.fn(async () => ({
        data: { text: 'Random gibberish characters repeated repeatedly', confidence: 12 },
      })),
    }
    await expect(
      recognizeOCR(worker as any, '0', async (degrees) => String(degrees)),
    ).rejects.toBeInstanceOf(LowConfidenceOCRError)
  })
})
