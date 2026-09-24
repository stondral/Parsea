import { getPayload } from 'payload'
import config from '@/payload.config'
import { ChatOpenAI } from '@langchain/openai'
import { getEmbedding } from './embeddings'
import { getOrSetCache, hashKey } from './redis'
import { sql } from 'drizzle-orm'
import { PromptTemplate } from '@langchain/core/prompts'

export interface SourceCitation {
  document: string
  chapter?: string
  page: number
  url: string
}

export interface RAGResult {
  answer: string
  sources: SourceCitation[]
  cached: boolean
  latencyMs: number
}

interface RankedChunk {
  id: any
  text: string
  page_number: number
  document_id: any
  document_name: string
  chapter: string
  subject_name: string
  rrfScore: number
  vectorSimilarity: number
  hasKeywordMatch: boolean
}

/**
 * Canonical RAG execution engine for Parsea
 * Implements Hybrid Retrieval: Vector Search (Semantics) + Keyword Search (Exact terms) + RRF Reranker
 */
export async function askRAG(question: string): Promise<RAGResult> {
  const startTime = performance.now()
  const trimmed = question.trim()
  const cacheKey = hashKey('rag', trimmed)

  // 1. Check Redis cache first for Lightspeed instant retrieval (< 5ms)
  const { data: cachedResult, cached } = await getOrSetCache<{ answer: string; sources: SourceCitation[] }>(
    cacheKey,
    async () => {
      const openRouterKey = process.env.OPENROUTER_API_KEY
      const deepseekKey = process.env.DEEPSEEK_API_KEY
      const apiKey = openRouterKey || deepseekKey

      if (!apiKey) {
        throw new Error('Please set OPENROUTER_API_KEY in your .env file')
      }

      // Parallelize config resolution + embedding computation
      const [payloadConfig, questionEmbedding] = await Promise.all([
        config,
        getEmbedding(trimmed),
      ])

      const payload = await getPayload({ config: payloadConfig })
      const db = (payload.db as any).drizzle
      const vectorStr = JSON.stringify(questionEmbedding)

      // Clean terms for PostgreSQL full-text search
      const cleanKeywords = trimmed.replace(/[^a-zA-Z0-9\s]/g, ' ').trim()

      // ─────────────────────────────────────────────────────────
      // HYBRID RETRIEVAL STEP 1 & 2: Vector Search + Keyword Search in parallel
      // ─────────────────────────────────────────────────────────
      const vectorPromise = db.execute(sql`
        SELECT c.id, c.text, c.page_number, c.document_id, c.chapter, c.subject_name,
               d.name AS document_name,
               1 - (c.embedding <=> ${vectorStr}::vector) AS vector_similarity
        FROM chunks c
        LEFT JOIN documents d ON c.document_id = d.id
        WHERE c.embedding IS NOT NULL
        ORDER BY c.embedding <=> ${vectorStr}::vector
        LIMIT 15
      `)

      let keywordPromise: Promise<any> = Promise.resolve({ rows: [] })
      if (cleanKeywords.length > 0) {
        keywordPromise = db.execute(sql`
          SELECT c.id, c.text, c.page_number, c.document_id, c.chapter, c.subject_name,
                 d.name AS document_name,
                 ts_rank(to_tsvector('english', c.text), plainto_tsquery('english', ${cleanKeywords})) AS keyword_rank
          FROM chunks c
          LEFT JOIN documents d ON c.document_id = d.id
          WHERE to_tsvector('english', c.text) @@ plainto_tsquery('english', ${cleanKeywords})
          ORDER BY ts_rank(to_tsvector('english', c.text), plainto_tsquery('english', ${cleanKeywords})) DESC
          LIMIT 15
        `)
      }

      const [vectorRes, keywordRes] = await Promise.all([vectorPromise, keywordPromise])

      const vRows = vectorRes.rows || vectorRes
      const kwRows = keywordRes.rows || keywordRes

      // ─────────────────────────────────────────────────────────
      // RERANKER: Reciprocal Rank Fusion (RRF with k = 60)
      // ─────────────────────────────────────────────────────────
      const candidateMap = new Map<any, RankedChunk>()

      // Accumulate vector candidates
      vRows.forEach((row: any, index: number) => {
        const rank = index + 1
        const rrf = 1 / (60 + rank)
        candidateMap.set(row.id, {
          id: row.id,
          text: row.text,
          page_number: Number(row.page_number),
          document_id: row.document_id,
          document_name: row.document_name || 'Document',
          chapter: row.chapter || row.document_name || 'Chapter',
          subject_name: row.subject_name || '',
          rrfScore: rrf,
          vectorSimilarity: Number(row.vector_similarity) || 0,
          hasKeywordMatch: false,
        })
      })

      // Accumulate keyword candidates & fuse with RRF
      kwRows.forEach((row: any, index: number) => {
        const rank = index + 1
        const rrf = 1 / (60 + rank)
        const existing = candidateMap.get(row.id)
        if (existing) {
          existing.rrfScore += rrf
          existing.hasKeywordMatch = true
        } else {
          candidateMap.set(row.id, {
            id: row.id,
            text: row.text,
            page_number: Number(row.page_number),
            document_id: row.document_id,
            document_name: row.document_name || 'Document',
            chapter: row.chapter || row.document_name || 'Chapter',
            subject_name: row.subject_name || '',
            rrfScore: rrf,
            vectorSimilarity: 0,
            hasKeywordMatch: true,
          })
        }
      })

      // Sort by RRF score descending and take the top best chunks
      const rerankedChunks = Array.from(candidateMap.values())
        .sort((a, b) => b.rrfScore - a.rrfScore)
        .slice(0, 4)

      // GATE 1: If top candidate has low vector similarity AND zero keyword match, reject
      const bestMatch = rerankedChunks[0]
      if (!bestMatch || (bestMatch.vectorSimilarity < 0.35 && !bestMatch.hasKeywordMatch)) {
        return {
          answer: 'The provided study materials do not contain information about this topic.',
          sources: [],
        }
      }

      // Deduplicate sources with clickable viewer URLs
      const contextStr = rerankedChunks.map((c) => `[Page ${c.page_number}] ${c.text}`).join('\n\n')
      const sourcesMap = new Map<string, SourceCitation>()
      for (const c of rerankedChunks) {
        const key = `${c.document_name}-${c.page_number}`
        if (!sourcesMap.has(key)) {
          sourcesMap.set(key, {
            document: c.document_name,
            chapter: c.chapter,
            page: c.page_number,
            url: `/pdf/${c.document_id}?page=${c.page_number}`,
          })
        }
      }
      const sources = Array.from(sourcesMap.values())

      // ─────────────────────────────────────────────────────────
      // LLM GENERATION: OpenRouter
      // ─────────────────────────────────────────────────────────
      const baseURL = openRouterKey ? 'https://openrouter.ai/api/v1' : 'https://api.deepseek.com'
      const modelName = openRouterKey
        ? process.env.OPENROUTER_MODEL || 'nex-agi/nex-n2.5-mini:free'
        : 'deepseek-chat'

      const llm = new ChatOpenAI({
        modelName,
        temperature: 0.1,
        apiKey,
        maxTokens: 2500,
        configuration: {
          baseURL,
          defaultHeaders: openRouterKey
            ? {
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'Parsea Academic Assistant',
              }
            : undefined,
        },
      })

      const prompt = PromptTemplate.fromTemplate(`
You are an academic assistant. Answer the question clearly, concisely, and accurately based ONLY on the following study materials context.
If the answer is not contained in the context, say "The provided study materials do not contain information about this topic."

Format your answer with clear markdown headings, bullet points, and standard LaTeX math (use $...$ for inline and $$...$$ for display equations).
Do not repeat unneeded boilerplate.

Context:
{context}

Question: {question}

Answer:
`)

      let answer = ''
      try {
        const chain = prompt.pipe(llm)
        const response = await chain.invoke({
          context: contextStr,
          question: trimmed,
        })
        answer = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
      } catch (llmError: any) {
        console.warn('LLM call failed, falling back to direct context excerpt:', llmError?.message)
        answer = `Here is the relevant information extracted directly from your study material:\n\n${contextStr}`
      }

      // GATE 2: Negation guard - never return false citations if model says information is absent
      const negationKeywords = [
        'do not contain',
        'does not contain',
        'not mentioned',
        'no information',
        'cannot be determined',
        "don't know based on",
        'not found in',
        'not discussed',
      ]
      const isNegative = negationKeywords.some((p) => answer.toLowerCase().includes(p))

      return {
        answer,
        sources: isNegative ? [] : sources,
      }
    },
    86400 // Cache for 24 hours
  )

  const latencyMs = Math.round(performance.now() - startTime)

  return {
    ...cachedResult,
    cached,
    latencyMs,
  }
}
