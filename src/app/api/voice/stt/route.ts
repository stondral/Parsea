import { NextRequest, NextResponse } from "next/server"
import { Groq, toFile } from "groq-sdk"

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey || !apiKey.trim()) {
    return NextResponse.json({ error: "Error: Please set GROQ_API_KEY in your .env file" }, { status: 500 })
  }

  try {
    const formData = await req.formData()
    const fileObj = (formData.get("file") || formData.get("audio")) as File | null

    if (!fileObj || fileObj.size < 2000) {
      return NextResponse.json({ text: "", error: "No audio recorded" })
    }

    const groq = new Groq({ apiKey })
    const arrayBuffer = await fileObj.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const fileName = fileObj.name || "speech.webm"
    const fileType = fileObj.type || "audio/webm"

    const file = await toFile(buffer, fileName, { type: fileType })

    const transcription: any = await groq.audio.transcriptions.create({
      file: file,
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
      temperature: 0.0,
    })

    const rawText = (transcription.text || "").trim()
    const segments = transcription.segments || []

    // Check Whisper silence & low-confidence metrics
    const isSilent =
      segments.length > 0 &&
      segments.every((s: any) => s.no_speech_prob > 0.45 || s.avg_logprob < -0.9)

    // Blocked common hallucination phrases
    const hallucinationList = [
      "thank you",
      "thank you.",
      "thank you for watching",
      "thanks for watching",
      "hienglish",
      "hinglish",
      "english",
      "hindi",
      "subtitles by",
      "bye",
      "you",
      ".",
    ]

    if (isSilent || hallucinationList.includes(rawText.toLowerCase()) || rawText.length === 0) {
      return NextResponse.json({ text: "", isSilent: true })
    }

    return NextResponse.json({ text: rawText, language: transcription.language || "auto" })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "STT transcription failed" }, { status: 500 })
  }
}
