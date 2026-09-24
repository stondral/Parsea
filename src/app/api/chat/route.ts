import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { ChatOpenAI } from '@langchain/openai'
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/hf_transformers'
import { sql } from 'drizzle-orm'
import { PromptTemplate } from '@langchain/core/prompts'

export async function POST(req: Request) {
  try {
    const { question } = await req.json()
    if (!question) {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 })
    }

    if (!process.env.DEEPSEEK_API_KEY) {
      return NextResponse.json({ error: 'DEEPSEEK_API_KEY is not set' }, { status: 500 })
    }

    const payloadConfig = await config
    const payload = await getPayload({ config: payloadConfig })
    const db = (payload.db as any).drizzle

    const embeddings = new HuggingFaceTransformersEmbeddings({
      modelName: 'Xenova/all-MiniLM-L6-v2',
    })
    const questionEmbedding = await embeddings.embedQuery(question)
    const vectorStr = JSON.stringify(questionEmbedding)

    // Perform vector search using pgvector
    const topChunks = await db.execute(sql`
      SELECT id, text, "pageNumber", document_id, 1 - (embedding <=> ${vectorStr}::vector) as similarity
      FROM chunks
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT 5
    `)

    const rows = topChunks.rows || topChunks // Depending on driver

    if (!rows || rows.length === 0) {
      return NextResponse.json({ answer: "I couldn't find any relevant information in the documents.", sources: [] })
    }

    // Prepare context for the LLM
    const contextStr = rows.map((row: any) => `[Page ${row.pageNumber}] ${row.text}`).join('\n\n')

    // Generate answer with LangChain
    const llm = new ChatOpenAI({
      modelName: 'deepseek-chat',
      temperature: 0,
      openAIApiKey: process.env.DEEPSEEK_API_KEY,
      configuration: {
        baseURL: 'https://api.deepseek.com',
      },
    })

    const prompt = PromptTemplate.fromTemplate(`
      You are an academic assistant. Answer the question based ONLY on the following context from study materials.
      If the answer is not in the context, say "I don't know based on the provided documents."
      
      Context:
      {context}
      
      Question: {question}
      
      Answer:
    `)

    const chain = prompt.pipe(llm)
    const response = await chain.invoke({
      context: contextStr,
      question: question,
    })

    // Get document names for sources
    const sources = []
    for (const row of rows) {
      if (row.document_id) {
        const doc = await payload.findByID({
          collection: 'documents',
          id: row.document_id,
        })
        sources.push({
          document: doc.name,
          page: row.pageNumber,
        })
      }
    }

    // Deduplicate sources
    const uniqueSources = Array.from(new Set(sources.map(s => JSON.stringify(s)))).map(s => JSON.parse(s))

    return NextResponse.json({
      answer: response.content,
      sources: uniqueSources,
    })
  } catch (error) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
