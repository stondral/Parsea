import { askRAGStream } from '@/lib/rag'
import Groq from 'groq-sdk'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      question,
      messages,
      mode = 'deep',
      targetLanguage = 'auto',
      filters,
      conversationId,
      history,
    } = body || {}

    // -------------------------------------------------------------
    // MODE 1: QUICK CHAT (Blazing Fast Groq openai/gpt-oss-20b)
    // -------------------------------------------------------------
    if (mode === 'quick') {
      const groqKey = process.env.GROQ_API_KEY
      if (!groqKey || !groqKey.trim()) {
        return new Response('GROQ_API_KEY is not configured', { status: 500 })
      }

      const groq = new Groq({ apiKey: groqKey })

      // Language constraint instructions
      let langInstruction = 'Respond naturally in the language used by the user.'
      if (targetLanguage === 'hi') {
        langInstruction =
          'CRITICAL: You MUST answer strictly in Hindi (Devanagari script αñ╣αñ┐αñ¿αÑìαñªαÑÇ), regardless of input language. Do not use Romanized Hindi.'
      } else if (targetLanguage === 'en') {
        langInstruction =
          'CRITICAL: You MUST answer strictly in clear, natural English, regardless of input language.'
      }

      const systemPrompt = `You are a concise, ultra-fast conversational assistant. 
Answer clearly in 2 to 3 direct spoken sentences. 
Avoid markdown headers, bullet lists, asterisks, or robotic citations.
${langInstruction}`

      const historyMessages = messages || (history ? history.map((m: any) => ({ role: m.role, content: m.content })) : [])
      const queryContent = question || (historyMessages.length > 0 ? historyMessages[historyMessages.length - 1].content : '')
      const userPrompt = queryContent ? { role: 'user', content: queryContent } : null

      const conversation = [
        { role: 'system', content: systemPrompt },
        ...historyMessages.slice(-5).filter((m: any) => m.content !== queryContent),
        ...(userPrompt ? [userPrompt] : []),
      ]

      const stream = await groq.chat.completions.create({
        model: 'openai/gpt-oss-20b',
        messages: conversation as any,
        temperature: 0.3,
        max_tokens: 300,
        stream: true,
      })

      // Stream directly back to client as plain text chunks
      const encoder = new TextEncoder()
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              const text = chunk.choices[0]?.delta?.content || ''
              if (text) {
                controller.enqueue(encoder.encode(text))
              }
            }
          } catch (streamErr: any) {
            console.error('Groq Quick Chat stream error:', streamErr)
          } finally {
            controller.close()
          }
        },
      })

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Transfer-Encoding': 'chunked',
          'Cache-Control': 'no-cache, no-transform',
        },
      })
    }

    // -------------------------------------------------------------
    // MODE 2: DEEP ANALYSIS (Existing NVIDIA Nemotron Server RAG)
    // -------------------------------------------------------------
    const queryText = question || (messages && messages.length > 0 ? messages[messages.length - 1].content : '')

    if (!queryText || !queryText.trim()) {
      return new Response(JSON.stringify({ error: 'Question is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const encoder = new TextEncoder()
    const customStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of askRAGStream(queryText, filters, { conversationId, history, targetLanguage })) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          }
        } catch (streamErr: any) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                error: streamErr?.message || 'Streaming error',
              })}\n\n`
            )
          )
        } finally {
          controller.close()
        }
      },
    })

    return new Response(customStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
