import { createWorker } from 'tesseract.js'

/**
 * Perform OCR on a scanned page image buffer.
 * 1. Tries OpenRouter Vision model for high-accuracy handwriting & LaTeX formula transcription.
 * 2. Automatically falls back to local Tesseract.js (WASM) if the API is unreachable or times out.
 */
export async function extractTextFromImage(imageBuffer: Buffer | Uint8Array): Promise<string> {
  const base64Image = Buffer.from(imageBuffer).toString('base64')
  const apiKey = process.env.OPENROUTER_API_KEY

  // ─────────────────────────────────────────────────────────
  // 1. TIER 1: OpenRouter Vision Model (LaTeX & Handwriting specialist)
  // ─────────────────────────────────────────────────────────
  if (apiKey) {
    try {
      const visionModel = 'meta-llama/llama-3.2-11b-vision-instruct:free'
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Parsea Multimodal Ingestion',
        },
        body: JSON.stringify({
          model: visionModel,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Transcribe all handwritten and printed academic text, definitions, headings, and formulas from this slide/page. Use standard LaTeX math format ($...$ and $$...$$). Output ONLY the transcribed content without commentary.',
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${base64Image}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 1500,
          temperature: 0.1,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const text = data.choices?.[0]?.message?.content?.trim()
        if (text && text.length > 10) {
          return text
        }
      }
    } catch (visionErr) {
      console.warn('Vision OCR API failed, falling back to local Tesseract:', visionErr)
    }
  }

  // ─────────────────────────────────────────────────────────
  // 2. TIER 2: Local Tesseract.js Fallback (Offline WebAssembly)
  // ─────────────────────────────────────────────────────────
  try {
    const worker = await createWorker('eng')
    const ret = await worker.recognize(Buffer.from(imageBuffer))
    await worker.terminate()
    return ret.data.text.trim()
  } catch (tessErr) {
    console.error('Local Tesseract OCR error:', tessErr)
    return ''
  }
}
