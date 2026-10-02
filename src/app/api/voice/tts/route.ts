import { NextResponse } from 'next/server'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

function stripMarkdown(text: string): string {
  if (!text) return ''
  return (
    text
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, '')
      // Remove inline code
      .replace(/`([^`]+)`/g, '$1')
      // Remove display math $$...$$
      .replace(/\$\$[\s\S]*?\$\$/g, '')
      // Remove inline math $...$
      .replace(/\$[^$]+\$/g, '')
      // Remove markdown headings, bold, italic
      .replace(/[#*_-]/g, ' ')
      // Remove links [text](url) -> text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove table formatting lines
      .replace(/\|/g, ' ')
      // Collapse multiple whitespace
      .replace(/\s+/g, ' ')
      .trim()
  )
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey || !apiKey.trim()) {
      return NextResponse.json(
        { error: 'Error: Please set GROQ_API_KEY in your .env file' },
        { status: 400 }
      )
    }

    const body = await req.json()
    const { text, voice = 'auto', targetLanguage = 'auto' } = body || {}

    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Text is required for speech synthesis' }, { status: 400 })
    }

    const cleanText = stripMarkdown(text)
    const textToSynthesize = cleanText || text

    let selectedVoice = voice
    if (selectedVoice === 'auto' || !selectedVoice) {
      if (targetLanguage === 'hi') {
        selectedVoice = 'hi-IN-SwaraNeural'
      } else if (targetLanguage === 'en') {
        selectedVoice = 'en-IN-NeerjaNeural'
      } else {
        const isDevanagari = /[\u0900-\u097F]/.test(textToSynthesize)
        selectedVoice = isDevanagari ? 'hi-IN-SwaraNeural' : 'en-IN-NeerjaNeural'
      }
    }

    const tts = new MsEdgeTTS()
    await tts.setMetadata(selectedVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
    const streamResult = tts.toStream(textToSynthesize)
    const audioStream = (streamResult as any).audioStream || streamResult

    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      audioStream.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      audioStream.on('end', () => resolve())
      audioStream.on('close', () => resolve())
      audioStream.on('error', (err: any) => {
        if (chunks.length > 0) {
          console.warn('TTS stream emitted warning after data received:', err?.message)
          resolve()
        } else {
          reject(err)
        }
      })
    })

    if (chunks.length === 0) {
      return NextResponse.json({ error: 'Speech synthesis yielded empty audio' }, { status: 500 })
    }

    const audioBuffer = Buffer.concat(chunks)

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error: any) {
    console.error('TTS Route Error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to synthesize speech' },
      { status: 500 }
    )
  }
}
