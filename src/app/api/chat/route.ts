import { NextResponse } from 'next/server'
import { askRAG } from '@/lib/rag'

export async function POST(req: Request) {
  try {
    const { question, filters } = await req.json()
    if (!question) {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 })
    }

    const result = await askRAG(question, filters)
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 })
  }
}
