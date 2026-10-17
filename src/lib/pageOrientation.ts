export const PAGE_ORIENTATION_VERSION = 1
export type PageRotation = 0 | 90 | 180 | 270
export interface PageOrientation {
  rotation: PageRotation
  confidence: number
  verified: boolean
}

/** Corrections are clockwise and relative to PDF.js's metadata-applied viewport. */
export function normalizeRotation(degrees: number): PageRotation {
  if (!Number.isFinite(degrees)) return 0
  return ((((Math.round(degrees / 90) * 90) % 360) + 360) % 360) as PageRotation
}

/** Weight readable text, not short numeric diagram labels or decorative titles. */
export function orientationFromText(
  items: Array<{ str: string; transform: number[] }>,
  viewport: number[],
): PageOrientation {
  const weights = [0, 0, 0, 0]
  let total = 0
  for (const item of items) {
    const letters = (item.str.match(/\p{L}/gu) || []).length
    if (letters < 3) continue
    const [a, b] = item.transform
    const angle =
      (Math.atan2(viewport[1] * a + viewport[3] * b, viewport[0] * a + viewport[2] * b) * 180) /
      Math.PI
    const nearest = Math.round(angle / 90) * 90
    total += letters
    if (Math.abs(angle - nearest) <= 12) weights[normalizeRotation(-nearest) / 90] += letters
  }
  const best = Math.max(...weights)
  const confidence = total ? (best / total) * 100 : 0
  const verified = best >= 20 && confidence >= 75
  return {
    rotation: verified ? ((weights.indexOf(best) * 90) as PageRotation) : 0,
    confidence,
    verified,
  }
}
