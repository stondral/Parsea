import { getPayload } from 'payload'
import config from '@/payload.config'
import { ChatOpenAI } from '@langchain/openai'
import { getEmbedding } from './embeddings'
import { getOrSetCache, hashKey } from './redis'
import { getPresignedDownloadUrl } from './r2'
import { sql } from 'drizzle-orm'
import { PromptTemplate } from '@langchain/core/prompts'

export interface AcademicFilters {
  branch?: string
  semester?: number
  subject?: string
}

export interface SourceCitation {
  document: string
  chapter?: string
  page: number
  url: string
}

export interface CitedImage {
  url: string
  caption: string
  page: number
  document: string
}

export interface RAGResult {
  answer: string
  sources: SourceCitation[]
  images: CitedImage[]
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
  branch: string
  semester: number | null
  has_image: boolean
  image_url?: string
  image_caption?: string
  rrfScore: number
  vectorSimilarity: number
  keywordRank: number
  hasKeywordMatch: boolean
  rerankScore?: number
}

/**
 * Lightweight BM25-style lexical term coverage scorer for reranking.
 * Checks what proportion of unique search query terms appear in the candidate text.
 */
function computeTermOverlapScore(query: string, text: string): number {
  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2)

  if (queryTerms.length === 0) return 0

  const lowerText = text.toLowerCase()
  let matches = 0
  for (const term of queryTerms) {
    if (lowerText.includes(term)) {
      matches++
    }
  }

  return matches / queryTerms.length
}

/**
 * Composite Cross-Reranker:
 * Fuses Reciprocal Rank Fusion (RRF) with exact query term overlap and vector cosine similarity.
 */
function rerankCandidates(candidates: RankedChunk[], query: string): RankedChunk[] {
  return candidates
    .map((chunk) => {
      const termOverlap = computeTermOverlapScore(query, chunk.text)
      const compositeScore = chunk.rrfScore * 50 + termOverlap * 0.3 + chunk.vectorSimilarity * 0.2

      return {
        ...chunk,
        rerankScore: compositeScore,
      }
    })
    .sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0))
}

/**
 * Canonical RAG execution engine for Parsea
 * Implements:
 * 1. Metadata Pre-Filtering (branch, semester, subject)
 * 2. Parallel Hybrid Retrieval: pgvector HNSW (<=>) + PostgreSQL Full-Text Search GIN (tsvector)
 * 3. Reciprocal Rank Fusion (RRF)
 * 4. Composite Term-Overlap Reranker
 * 5. Multimodal Diagram / Media Extraction from Cloudflare R2
 * 6. 2-Gate Hallucination Guard
 * 7. Redis Layered Caching
 */
export async function askRAG(question: string, filters?: AcademicFilters): Promise<RAGResult> {
  const startTime = performance.now()
  const trimmed = question.trim()

  // Cache key includes question, filters, and schema version
  const cacheKeyPayload = JSON.stringify({ q: trimmed, f: filters || {} })
  const cacheKey = hashKey('rag:v3', cacheKeyPayload)

  // 1. Check Redis cache first for Lightspeed instant retrieval (< 10ms)
  const { data: cachedResult, cached } = await getOrSetCache<{
    answer: string
    sources: SourceCitation[]
    images: CitedImage[]
  }>(
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
      // METADATA PRE-FILTERING CLAUSES
      // ─────────────────────────────────────────────────────────
      const filterBranch = filters?.branch?.trim()
      const filterSemester = filters?.semester
      const filterSubject = filters?.subject?.trim()

      const branchClause = filterBranch ? sql`AND LOWER(c.branch) = LOWER(${filterBranch})` : sql``
      const semesterClause = filterSemester ? sql`AND c.semester = ${filterSemester}` : sql``
      const subjectClause = filterSubject
        ? sql`AND (LOWER(c.subject_name) LIKE LOWER(${`%${filterSubject}%`}) OR LOWER(d.name) LIKE LOWER(${`%${filterSubject}%`}))`
        : sql``

      // ─────────────────────────────────────────────────────────
      // HYBRID RETRIEVAL STEP 1 & 2: Vector Search (HNSW) + Keyword Search (GIN) in parallel
      // ─────────────────────────────────────────────────────────
      const vectorPromise = db.execute(sql`
        SELECT c.id, c.text, c.page_number, c.document_id, c.chapter, c.subject_name, c.branch, c.semester,
               c.has_image, c.image_url, c.image_caption,
               d.name AS document_name,
               1 - (c.embedding <=> ${vectorStr}::vector) AS vector_similarity
        FROM chunks c
        LEFT JOIN documents d ON c.document_id = d.id
        WHERE c.embedding IS NOT NULL
        ${branchClause}
        ${semesterClause}
        ${subjectClause}
        ORDER BY c.embedding <=> ${vectorStr}::vector
        LIMIT 25
      `)

      let keywordPromise: Promise<any> = Promise.resolve({ rows: [] })
      if (cleanKeywords.length > 0) {
        keywordPromise = db.execute(sql`
          SELECT c.id, c.text, c.page_number, c.document_id, c.chapter, c.subject_name, c.branch, c.semester,
                 c.has_image, c.image_url, c.image_caption,
                 d.name AS document_name,
                 ts_rank(to_tsvector('english', c.text), plainto_tsquery('english', ${cleanKeywords})) AS keyword_rank
          FROM chunks c
          LEFT JOIN documents d ON c.document_id = d.id
          WHERE to_tsvector('english', c.text) @@ plainto_tsquery('english', ${cleanKeywords})
          ${branchClause}
          ${semesterClause}
          ${subjectClause}
          ORDER BY ts_rank(to_tsvector('english', c.text), plainto_tsquery('english', ${cleanKeywords})) DESC
          LIMIT 25
        `)
      }

      const [vectorRes, keywordRes] = await Promise.all([vectorPromise, keywordPromise])

      const vRows = vectorRes.rows || vectorRes
      const kwRows = keywordRes.rows || keywordRes

      // ─────────────────────────────────────────────────────────
      // STEP 3: Reciprocal Rank Fusion (RRF with k = 60)
      // ─────────────────────────────────────────────────────────
      const candidateMap = new Map<any, RankedChunk>()

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
          branch: row.branch || '',
          semester: row.semester ? Number(row.semester) : null,
          has_image: Boolean(row.has_image),
          image_url: row.image_url || undefined,
          image_caption: row.image_caption || undefined,
          rrfScore: rrf,
          vectorSimilarity: Number(row.vector_similarity) || 0,
          keywordRank: 0,
          hasKeywordMatch: false,
        })
      })

      kwRows.forEach((row: any, index: number) => {
        const rank = index + 1
        const rrf = 1 / (60 + rank)
        const existing = candidateMap.get(row.id)
        if (existing) {
          existing.rrfScore += rrf
          existing.keywordRank = Number(row.keyword_rank) || 0
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
            branch: row.branch || '',
            semester: row.semester ? Number(row.semester) : null,
            has_image: Boolean(row.has_image),
            image_url: row.image_url || undefined,
            image_caption: row.image_caption || undefined,
            rrfScore: rrf,
            vectorSimilarity: 0,
            keywordRank: Number(row.keyword_rank) || 0,
            hasKeywordMatch: true,
          })
        }
      })

      // ─────────────────────────────────────────────────────────
      // STEP 4: Composite Cross-Reranker (Top 5 chunks)
      // ─────────────────────────────────────────────────────────
      const rawCandidates = Array.from(candidateMap.values())
      const reranked = rerankCandidates(rawCandidates, trimmed)
      const topChunks = reranked.slice(0, 5)

      // GATE 1: If top candidate has low similarity AND zero keyword match, reject immediately
      const bestMatch = topChunks[0]
      if (!bestMatch || (bestMatch.vectorSimilarity < 0.35 && !bestMatch.hasKeywordMatch)) {
        return {
          answer: 'The provided study materials do not contain information about this topic.',
          sources: [],
          images: [],
        }
      }

      // Deduplicate sources with clickable viewer URLs
      const contextStr = topChunks.map((c) => `[Page ${c.page_number}] ${c.text}`).join('\n\n')
      const sourcesMap = new Map<string, SourceCitation>()
      for (const c of topChunks) {
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
      // STEP 5: Multimodal Images & Diagrams Extraction (Cloudflare R2)
      // ─────────────────────────────────────────────────────────
      const images: CitedImage[] = []
      const seenImages = new Set<string>()

      for (const c of topChunks) {
        if (c.has_image && c.image_url && !seenImages.has(c.image_url)) {
          seenImages.add(c.image_url)
          try {
            const presigned = await getPresignedDownloadUrl(c.image_url)
            images.push({
              url: presigned,
              caption: c.image_caption || `Diagram & Visual Slide (Page ${c.page_number})`,
              page: c.page_number,
              document: c.document_name,
            })
          } catch (imgErr) {
            console.warn('Failed generating presigned URL for diagram:', imgErr)
          }
        }
      }

      // ─────────────────────────────────────────────────────────
      // STEP 6: LLM Generation
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

      const diagramsContext =
        images.length > 0
          ? `\nIllustrative diagrams available in materials:\n` +
            images.map((img) => `- Page ${img.page}: ${img.caption}`).join('\n') +
            `\n(You may reference or describe these diagrams in your explanation to help the student understand visual concepts.)\n`
          : ''

      const prompt = PromptTemplate.fromTemplate(`
You are an academic assistant. Answer the question clearly, concisely, and accurately based ONLY on the following study materials context.
If the answer is not contained in the context, say "The provided study materials do not contain information about this topic."

Format your answer with clear markdown headings, bullet points, and standard LaTeX math (use $...$ for inline and $$...$$ for display equations).
Do not repeat unneeded boilerplate.
{diagrams}
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
          diagrams: diagramsContext,
          question: trimmed,
        })
        answer = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
      } catch (llmError: any) {
        console.warn('LLM call failed, falling back to direct context excerpt:', llmError?.message)
        answer = `Here is the relevant information extracted directly from your study material:\n\n${contextStr}`
      }

      // GATE 2: Negation guard
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
        images: isNegative ? [] : images,
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
