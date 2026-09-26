import { getPayload } from 'payload'
import config from '@/payload.config'
import { ChatOpenAI } from '@langchain/openai'
import { getEmbedding } from './embeddings'
import { getCache, setCache, getOrSetCache, hashKey } from './redis'
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

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ConversationOptions {
  conversationId?: string
  history?: ChatMessage[]
}

export interface SessionContext {
  contextStr: string
  sources: SourceCitation[]
  images: CitedImage[]
  filters?: AcademicFilters
  lastQuestion: string
  diagramsContext?: string
}

export interface RAGResult {
  answer: string
  sources: SourceCitation[]
  images: CitedImage[]
  cached: boolean
  retrievalBypassed?: boolean
  latencyMs: number
}

export interface StreamEvent {
  type: 'metadata' | 'token' | 'done' | 'error'
  sources?: SourceCitation[]
  images?: CitedImage[]
  token?: string
  answer?: string
  cached?: boolean
  retrievalBypassed?: boolean
  latencyMs?: number
  error?: string
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
 * Determines whether a follow-up user query is an elaboration or clarification
 * on the currently active context (allowing us to bypass database vector queries entirely).
 */
export function shouldRetrieveContext(query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  return !/^(hi|hello|hey|hiya|good morning|good afternoon|good evening|thanks|thank you|thx|yo|who are you|what can you do|how are you)[.!?\s]*$/i.test(q)
}

export function isElaborationQuery(query: string): boolean {
  const q = query.trim().toLowerCase()

  const followUpPatterns = [
    /\b(explain|elaborate|clarify|simplify)\b/i,
    /\b(example|instance|sample|illustration)\b/i,
    /\b(simpler|simple words|more simple|layman|easy terms)\b/i,
    /\b(summarize|summary|bullet points|tldr|takeaways)\b/i,
    /\b(code|python|pseudocode|algorithm|implementation|function)\b/i,
    /\b(why|how come|how so|prove|proof|derivation)\b/i,
    /\b(practice|quiz|problem|exercise|question)\b/i,
    /\b(table|compare|difference|tabular)\b/i,
    /\b(what about|what if|how about)\b/i,
    /\b(step \d+|equation \d+|condition \d+|first|second|third|last)\b/i,
    /\b(more detail|further detail|expand on)\b/i,
    /\b(what does this mean|what do you mean)\b/i,
  ]

  if (followUpPatterns.some((pattern) => pattern.test(q))) {
    return true
  }

  const wordCount = q.split(/\s+/).length
  const pronounPattern = /\b(it|this|that|these|those|its|their|the above)\b/i
  if (wordCount <= 14 && pronounPattern.test(q)) {
    return true
  }

  return false
}

/**
 * Canonical RAG execution engine for Parsea
 * Implements:
 * 1. Ephemeral Redis Session Context Carry-Over & Zero-DB Retrieval Bypass
 * 2. Metadata Pre-Filtering (branch, semester, subject)
 * 3. Parallel Hybrid Retrieval: pgvector HNSW (<=>) + PostgreSQL Full-Text Search GIN (tsvector)
 * 4. Reciprocal Rank Fusion (RRF)
 * 5. Composite Term-Overlap Reranker
 * 6. Multimodal Diagram / Media Extraction from Cloudflare R2
 * 7. 2-Gate Hallucination Guard
 * 8. Redis Layered Caching
 */
export async function askRAG(
  question: string,
  filters?: AcademicFilters,
  options?: ConversationOptions
): Promise<RAGResult> {
  const startTime = performance.now()
  const trimmed = question.trim()

  const conversationId = options?.conversationId
  const history = options?.history || []
  const sessionKey = conversationId ? `session:${conversationId}:context` : null

  // 1. Check for active session in Redis
  const activeSession = sessionKey ? await getCache<SessionContext>(sessionKey) : null

  // Determine if this turn should bypass fresh vector/keyword retrieval
  const canBypassRetrieval = Boolean(
    activeSession &&
    history.length > 0 &&
    isElaborationQuery(trimmed)
  )

  // Cache key includes question, filters, conversation turn, and bypass status
  const cacheKeyPayload = JSON.stringify({
    q: trimmed,
    f: filters || {},
    cid: conversationId || '',
    lastQ: activeSession?.lastQuestion || '',
    bypassed: canBypassRetrieval,
  })
  const cacheKey = hashKey('rag:v3', cacheKeyPayload)

  // 2. Check Redis cache first for Lightspeed instant retrieval (< 10ms)
  const { data: cachedResult, cached } = await getOrSetCache<{
    answer: string
    sources: SourceCitation[]
    images: CitedImage[]
    retrievalBypassed?: boolean
  }>(
    cacheKey,
    async () => {
      const apiKey = process.env.NVIDIA_API_KEY
      if (!apiKey) throw new Error('Please set NVIDIA_API_KEY in your .env file')

      const llm = new ChatOpenAI({
        modelName: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b',
        temperature: 0.2,
        apiKey,
        maxTokens: 16384,
        configuration: {
          baseURL: 'https://integrate.api.nvidia.com/v1',
        },
      })

      // Format conversation history (sliding window: last 6 messages)
      const historyContext =
        history.length > 0
          ? `\nRecent Conversation History:\n` +
            history
              .slice(-6)
              .map((m) => `${m.role === 'user' ? 'Student' : 'Assistant'}: ${m.content}`)
              .join('\n\n') +
            `\n`
          : ''

      // ─────────────────────────────────────────────────────────
      // BRANCH A: RETRIEVAL BYPASS (Zero DB Queries!)
      // ─────────────────────────────────────────────────────────
      if (canBypassRetrieval && activeSession) {
        const prompt = PromptTemplate.fromTemplate(`
You are an expert university lecturer and academic tutor. Your job is to EXPLAIN and TEACH — not to copy-paste text.

Using the study material context provided, compose a well-structured, insightful academic explanation that:
- SYNTHESISES information across the retrieved chunks into a coherent explanation
- EXPLAINS concepts in your own words as a knowledgeable teacher would
- Uses CONCRETE EXAMPLES, analogies, or worked problems to make abstract ideas tangible
- Structures the answer with clear markdown headings (## and ###), numbered steps for procedures, and bullet lists for properties
- Renders ALL mathematical expressions in proper LaTeX: use $...$ for inline math and $$...$$ for display/block equations
- NEVER dumps raw extracted text — always paraphrase, organise, and explain
- If diagrams are mentioned in the context, describe what they illustrate
- Ends with a short "Key Takeaways" section if the answer is longer than a few lines

Use the study material context as supporting evidence when it is present and relevant. If it is empty or insufficient, answer normally from your general academic knowledge when the question is safe and answerable. Be helpful with greetings, adjacent concepts, reworded questions, intuition, examples, and study strategy. Never refuse solely because retrieval found no matching note, and never invent citations or claim unsupported information came from the notes.
{diagrams}
## Study Material Context
{context}
{history}
## Student Question
{question}

## Your Explanation
`)

        let answer = ''
        try {
          const chain = prompt.pipe(llm)
          const response = await chain.invoke({
            context: activeSession.contextStr,
            diagrams: activeSession.diagramsContext || '',
            history: historyContext,
            question: trimmed,
          })
          answer = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
        } catch (llmError: any) {
          console.warn('LLM call failed during retrieval bypass:', llmError?.message)
          answer = 'Sorry, the AI model is temporarily unavailable. Please try again in a moment.'
        }

        // Gate 2: Negation guard
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

        // Update active session lastQuestion in Redis (refresh TTL 1h)
        if (sessionKey) {
          await setCache(
            sessionKey,
            {
              ...activeSession,
              lastQuestion: trimmed,
            },
            3600
          )
        }

        return {
          answer,
          sources: isNegative ? [] : activeSession.sources,
          images: isNegative ? [] : activeSession.images,
          retrievalBypassed: true,
        }
      }

      // ─────────────────────────────────────────────────────────
      // BRANCH B: FRESH HYBRID RETRIEVAL (Supabase HNSW + GIN)
      // ─────────────────────────────────────────────────────────
      // Contextualize retrieval query if query is short or referential
      const retrievalQuery =
        activeSession?.lastQuestion && trimmed.split(/\s+/).length <= 4
          ? `${activeSession.lastQuestion} ${trimmed}`
          : trimmed

      // Parallelize config resolution + embedding computation
      const shouldRetrieve = shouldRetrieveContext(trimmed)
      const [payloadConfig, questionEmbedding] = await Promise.all([
        config,
        shouldRetrieve ? getEmbedding(retrievalQuery) : Promise.resolve<number[] | null>(null),
      ])

      const payload = shouldRetrieve ? await getPayload({ config: payloadConfig }) : null
      const db = payload ? (payload.db as any).drizzle : null
      const vectorStr = questionEmbedding ? JSON.stringify(questionEmbedding) : ''

      // Clean terms for PostgreSQL full-text search
      const cleanKeywords = retrievalQuery.replace(/[^a-zA-Z0-9\s]/g, ' ').trim()

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
      const vectorPromise = shouldRetrieve && questionEmbedding
        ? db!.execute(sql`
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
        : Promise.resolve({ rows: [] })

      let keywordPromise: Promise<any> = Promise.resolve({ rows: [] })
      if (shouldRetrieve && cleanKeywords.length > 0) {
        keywordPromise = db!.execute(sql`
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
      const reranked = rerankCandidates(rawCandidates, retrievalQuery)
      const topChunks = reranked.slice(0, 5)

      // GATE 1: Keep answers useful even when the student asks beyond the uploaded notes.
      // Retrieval-backed answers still require a meaningful vector or keyword match; otherwise
      // the model receives an explicit no-context signal and answers from general knowledge.
      const bestMatch = topChunks[0]
      const hasMaterialMatch = Boolean(
        bestMatch && (bestMatch.vectorSimilarity >= 0.35 || bestMatch.hasKeywordMatch)
      )

      // Deduplicate sources with clickable viewer URLs
      const contextStr = hasMaterialMatch
        ? topChunks.map((c) => `[Page ${c.page_number}] ${c.text}`).join('\n\n')
        : ''
      const sourcesMap = new Map<string, SourceCitation>()
      for (const c of hasMaterialMatch ? topChunks : []) {
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
      const sources = hasMaterialMatch ? Array.from(sourcesMap.values()) : []

      // ─────────────────────────────────────────────────────────
      // STEP 5: Multimodal Images & Diagrams Extraction (Cloudflare R2)
      // ─────────────────────────────────────────────────────────
      const images: CitedImage[] = []
      const seenImages = new Set<string>()

      for (const c of hasMaterialMatch ? topChunks : []) {
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

      const diagramsContext =
        images.length > 0
          ? `\nIllustrative diagrams available in materials:\n` +
            images.map((img) => `- Page ${img.page}: ${img.caption}`).join('\n') +
            `\n(You may reference or describe these diagrams in your explanation to help the student understand visual concepts.)\n`
          : ''

      // ─────────────────────────────────────────────────────────
      // STEP 6: LLM Generation
      // ─────────────────────────────────────────────────────────
      const prompt = PromptTemplate.fromTemplate(`
You are an expert university lecturer and academic tutor. Your job is to EXPLAIN and TEACH — not to copy-paste text.

Using the study material context provided, compose a well-structured, insightful academic explanation that:
- SYNTHESISES information across the retrieved chunks into a coherent explanation
- EXPLAINS concepts in your own words as a knowledgeable teacher would
- Uses CONCRETE EXAMPLES, analogies, or worked problems to make abstract ideas tangible
- Structures the answer with clear markdown headings (## and ###), numbered steps for procedures, and bullet lists for properties
- Renders ALL mathematical expressions in proper LaTeX: use $...$ for inline math and $$...$$ for display/block equations. For example, write $\\lfloor n/m \\rfloor$ NOT "⌊ n/m ⌋"
- NEVER dumps raw extracted text — always paraphrase, organise, and explain
- If diagrams are mentioned in the context, describe what they illustrate
- Ends with a short "Key Takeaways" section if the answer is longer than a few lines

Use the study material context as supporting evidence when it is present and relevant. If it is empty or insufficient, answer normally from your general academic knowledge when the question is safe and answerable. Be helpful with greetings, adjacent concepts, reworded questions, intuition, examples, and study strategy. Never refuse solely because retrieval found no matching note, and never invent citations or claim unsupported information came from the notes.
{diagrams}
## Study Material Context
{context}
{history}
## Student Question
{question}

## Your Explanation
`)

      let answer = ''
      try {
        const chain = prompt.pipe(llm)
        const response = await chain.invoke({
          context: contextStr,
          diagrams: diagramsContext,
          history: historyContext,
          question: trimmed,
        })
        answer = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
      } catch (llmError: any) {
        console.warn('LLM call failed:', llmError?.message)
        answer = 'Sorry, the AI model is temporarily unavailable. Please try again in a moment.'
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

      const finalSources = !hasMaterialMatch || isNegative ? [] : sources
      const finalImages = !hasMaterialMatch || isNegative ? [] : images

      // Save retrieved context into Redis session (TTL 1 hour)
      if (sessionKey && hasMaterialMatch) {
        await setCache(
          sessionKey,
          {
            contextStr,
            sources: finalSources,
            images: finalImages,
            filters,
            lastQuestion: trimmed,
            diagramsContext,
          },
          3600
        )
      }

      return {
        answer,
        sources: finalSources,
        images: finalImages,
        retrievalBypassed: false,
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

/**
 * Canonical Streaming RAG Generator for Parsea.
 * Yields:
 * 1. Immediate 'metadata' event (sources + Cloudflare R2 diagram URLs) in < 80ms.
 * 2. Incremental 'token' events from LLM as words are generated (Time-to-First-Token in ~250-300ms).
 * 3. Final 'done' event with completed answer, latency, and caches in Redis for repeat queries.
 */
export async function* askRAGStream(
  question: string,
  filters?: AcademicFilters,
  options?: ConversationOptions
): AsyncGenerator<StreamEvent> {
  const startTime = performance.now()
  const trimmed = question.trim()

  const conversationId = options?.conversationId
  const history = options?.history || []
  const sessionKey = conversationId ? `session:${conversationId}:context` : null

  // 1. Check for active session in Redis
  const activeSession = sessionKey ? await getCache<SessionContext>(sessionKey) : null

  // Determine if this turn should bypass fresh vector/keyword retrieval
  const canBypassRetrieval = Boolean(
    activeSession &&
    history.length > 0 &&
    isElaborationQuery(trimmed)
  )

  const cacheKeyPayload = JSON.stringify({
    q: trimmed,
    f: filters || {},
    cid: conversationId || '',
    lastQ: activeSession?.lastQuestion || '',
    bypassed: canBypassRetrieval,
  })
  const cacheKey = hashKey('rag:v3', cacheKeyPayload)

  // 1. Check Redis Cache first (< 5ms)
  const cached = await getCache<{
    answer: string
    sources: SourceCitation[]
    images: CitedImage[]
    retrievalBypassed?: boolean
  }>(cacheKey)

  if (cached) {
    const latencyMs = Math.round(performance.now() - startTime)
    yield {
      type: 'metadata',
      sources: cached.sources,
      images: cached.images,
      cached: true,
      retrievalBypassed: cached.retrievalBypassed,
    }
    yield {
      type: 'token',
      token: cached.answer,
    }
    yield {
      type: 'done',
      answer: cached.answer,
      sources: cached.sources,
      images: cached.images,
      cached: true,
      retrievalBypassed: cached.retrievalBypassed,
      latencyMs,
    }
    return
  }

  const apiKey = process.env.NVIDIA_API_KEY
  if (!apiKey) {
    yield { type: 'error', error: 'Please set NVIDIA_API_KEY in your .env file' }
    return
  }

  const llm = new ChatOpenAI({
    modelName: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b',
    temperature: 0.2,
    apiKey,
    maxTokens: 16384,
    streaming: true,
    configuration: {
      baseURL: 'https://integrate.api.nvidia.com/v1',
    },
  })

  // Format conversation history (sliding window: last 6 messages)
  const historyContext =
    history.length > 0
      ? `\nRecent Conversation History:\n` +
        history
          .slice(-6)
          .map((m) => `${m.role === 'user' ? 'Student' : 'Assistant'}: ${m.content}`)
          .join('\n\n') +
        `\n`
      : ''

  // ─────────────────────────────────────────────────────────
  // BRANCH A: RETRIEVAL BYPASS (Zero DB Queries!)
  // ─────────────────────────────────────────────────────────
  if (canBypassRetrieval && activeSession) {
    yield {
      type: 'metadata',
      sources: activeSession.sources,
      images: activeSession.images,
      cached: false,
      retrievalBypassed: true,
    }

    const prompt = PromptTemplate.fromTemplate(`
You are an expert university lecturer and academic tutor. Your job is to EXPLAIN and TEACH — not to copy-paste text.

Using the study material context provided, compose a well-structured, insightful academic explanation that:
- SYNTHESISES information across the retrieved chunks into a coherent explanation
- EXPLAINS concepts in your own words as a knowledgeable teacher would
- Uses CONCRETE EXAMPLES, analogies, or worked problems to make abstract ideas tangible
- Structures the answer with clear markdown headings (## and ###), numbered steps for procedures, and bullet lists for properties
- Renders ALL mathematical expressions in proper LaTeX: use $...$ for inline math and $$...$$ for display/block equations. For example, write $\\lfloor n/m \\rfloor$ NOT "⌊ n/m ⌋"
- NEVER dumps raw extracted text — always paraphrase, organise, and explain
- If diagrams are mentioned in the context, describe what they illustrate
- Ends with a short "Key Takeaways" section if the answer is longer than a few lines

Use the study material context as supporting evidence when it is present and relevant. If it is empty or insufficient, answer normally from your general academic knowledge when the question is safe and answerable. Be helpful with greetings, adjacent concepts, reworded questions, intuition, examples, and study strategy. Never refuse solely because retrieval found no matching note, and never invent citations or claim unsupported information came from the notes.
{diagrams}
## Study Material Context
{context}
{history}
## Student Question
{question}

## Your Explanation
`)

    let fullAnswer = ''
    try {
      const chain = prompt.pipe(llm)
      const stream = await chain.stream({
        context: activeSession.contextStr,
        diagrams: activeSession.diagramsContext || '',
        history: historyContext,
        question: trimmed,
      })

      for await (const chunk of stream) {
        const token = typeof chunk.content === 'string' ? chunk.content : ''
        if (token) {
          fullAnswer += token
          yield { type: 'token', token }
        }
      }
    } catch (llmError: any) {
      console.warn('Streaming LLM failed during retrieval bypass:', llmError?.message)
      fullAnswer = 'Sorry, the AI model is temporarily unavailable. Please try again in a moment.'
      yield { type: 'token', token: fullAnswer }
    }

    // Gate 2: Negation Check
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
    const isNegative = negationKeywords.some((p) => fullAnswer.toLowerCase().includes(p))
    const finalSources = isNegative ? [] : activeSession.sources
    const finalImages = isNegative ? [] : activeSession.images

    if (sessionKey) {
      await setCache(
        sessionKey,
        {
          ...activeSession,
          lastQuestion: trimmed,
        },
        3600
      )
    }

    await setCache(
      cacheKey,
      { answer: fullAnswer, sources: finalSources, images: finalImages, retrievalBypassed: true },
      86400
    )

    yield {
      type: 'done',
      answer: fullAnswer,
      sources: finalSources,
      images: finalImages,
      cached: false,
      retrievalBypassed: true,
      latencyMs: Math.round(performance.now() - startTime),
    }
    return
  }

  // ─────────────────────────────────────────────────────────
  // BRANCH B: FRESH RETRIEVAL (Supabase HNSW + GIN)
  // ─────────────────────────────────────────────────────────
  const retrievalQuery =
    activeSession?.lastQuestion && trimmed.split(/\s+/).length <= 4
      ? `${activeSession.lastQuestion} ${trimmed}`
      : trimmed

  // 2. Parallel config resolution + question embedding
  const shouldRetrieve = shouldRetrieveContext(trimmed)
  const [payloadConfig, questionEmbedding] = await Promise.all([
    config,
    shouldRetrieve ? getEmbedding(retrievalQuery) : Promise.resolve<number[] | null>(null),
  ])

  const payload = shouldRetrieve ? await getPayload({ config: payloadConfig }) : null
  const db = payload ? (payload.db as any).drizzle : null
  const vectorStr = questionEmbedding ? JSON.stringify(questionEmbedding) : ''
  const cleanKeywords = retrievalQuery.replace(/[^a-zA-Z0-9\s]/g, ' ').trim()

  // 3. Metadata Pre-Filtering
  const filterBranch = filters?.branch?.trim()
  const filterSemester = filters?.semester
  const filterSubject = filters?.subject?.trim()

  const branchClause = filterBranch ? sql`AND LOWER(c.branch) = LOWER(${filterBranch})` : sql``
  const semesterClause = filterSemester ? sql`AND c.semester = ${filterSemester}` : sql``
  const subjectClause = filterSubject
    ? sql`AND (LOWER(c.subject_name) LIKE LOWER(${`%${filterSubject}%`}) OR LOWER(d.name) LIKE LOWER(${`%${filterSubject}%`}))`
    : sql``

  // 4. Parallel Vector Search (HNSW) + Keyword Search (GIN)
  const vectorPromise = shouldRetrieve && questionEmbedding
    ? db!.execute(sql`
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
    : Promise.resolve({ rows: [] })

  let keywordPromise: Promise<any> = Promise.resolve({ rows: [] })
  if (shouldRetrieve && cleanKeywords.length > 0) {
    keywordPromise = db!.execute(sql`
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

  // 5. RRF Fusion
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

  // 6. Composite Reranker
  const rawCandidates = Array.from(candidateMap.values())
  const reranked = rerankCandidates(rawCandidates, retrievalQuery)
  const topChunks = reranked.slice(0, 5)

  // Gate 1: keep out-of-syllabus questions useful without fabricating note citations.
  const bestMatch = topChunks[0]
  const hasMaterialMatch = Boolean(
    bestMatch && (bestMatch.vectorSimilarity >= 0.35 || bestMatch.hasKeywordMatch)
  )

  // Deduplicate sources
  const contextStr = hasMaterialMatch
    ? topChunks.map((c) => `[Page ${c.page_number}] ${c.text}`).join('\n\n')
    : ''
  const sourcesMap = new Map<string, SourceCitation>()
  for (const c of hasMaterialMatch ? topChunks : []) {
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
  const sources = hasMaterialMatch ? Array.from(sourcesMap.values()) : []

  // Multimodal Cloudflare R2 Diagrams
  const images: CitedImage[] = []
  const seenImages = new Set<string>()

  for (const c of hasMaterialMatch ? topChunks : []) {
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
        console.warn('Failed generating presigned URL for diagram in stream:', imgErr)
      }
    }
  }

  // Yield metadata immediately so client can render source & diagram cards right away!
  yield {
    type: 'metadata',
    sources,
    images,
    cached: false,
    retrievalBypassed: false,
  }

  const diagramsContext =
    images.length > 0
      ? `\nIllustrative diagrams available in materials:\n` +
        images.map((img) => `- Page ${img.page}: ${img.caption}`).join('\n') +
        `\n(You may reference or describe these diagrams in your explanation to help the student understand visual concepts.)\n`
      : ''

  const prompt = PromptTemplate.fromTemplate(`
You are an expert university lecturer and academic tutor. Your job is to EXPLAIN and TEACH — not to copy-paste text.

Using the study material context provided, compose a well-structured, insightful academic explanation that:
- SYNTHESISES information across the retrieved chunks into a coherent explanation
- EXPLAINS concepts in your own words as a knowledgeable teacher would
- Uses CONCRETE EXAMPLES, analogies, or worked problems to make abstract ideas tangible
- Structures the answer with clear markdown headings (## and ###), numbered steps for procedures, and bullet lists for properties
- Renders ALL mathematical expressions in proper LaTeX: use $...$ for inline math and $$...$$ for display/block equations. For example, write $\\lfloor n/m \\rfloor$ NOT "⌊ n/m ⌋"
- NEVER dumps raw extracted text — always paraphrase, organise, and explain
- If diagrams are mentioned in the context, describe what they illustrate
- Ends with a short "Key Takeaways" section if the answer is longer than a few lines

Use the study material context as supporting evidence when it is present and relevant. If it is empty or insufficient, answer normally from your general academic knowledge when the question is safe and answerable. Be helpful with greetings, adjacent concepts, reworded questions, intuition, examples, and study strategy. Never refuse solely because retrieval found no matching note, and never invent citations or claim unsupported information came from the notes.
{diagrams}
## Study Material Context
{context}
{history}
## Student Question
{question}

## Your Explanation
`)

  let fullAnswer = ''
  try {
    const chain = prompt.pipe(llm)
    const stream = await chain.stream({
      context: contextStr,
      diagrams: diagramsContext,
      history: historyContext,
      question: trimmed,
    })

    for await (const chunk of stream) {
      const token = typeof chunk.content === 'string' ? chunk.content : ''
      if (token) {
        fullAnswer += token
        yield { type: 'token', token }
      }
    }
  } catch (llmError: any) {
    console.warn('Streaming LLM failed:', llmError?.message)
    fullAnswer = 'Sorry, the AI model is temporarily unavailable. Please try again in a moment.'
    yield { type: 'token', token: fullAnswer }
  }


  // Gate 2: Negation Check
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
  const isNegative = negationKeywords.some((p) => fullAnswer.toLowerCase().includes(p))
  const finalSources = !hasMaterialMatch || isNegative ? [] : sources
  const finalImages = !hasMaterialMatch || isNegative ? [] : images

  // Save retrieved context into Redis session (TTL 1 hour)
  if (sessionKey && hasMaterialMatch) {
    await setCache(
      sessionKey,
      {
        contextStr,
        sources: finalSources,
        images: finalImages,
        filters,
        lastQuestion: trimmed,
        diagramsContext,
      },
      3600
    )
  }

  // Cache full response in Redis for future requests
  await setCache(cacheKey, { answer: fullAnswer, sources: finalSources, images: finalImages, retrievalBypassed: false }, 86400)

  const latencyMs = Math.round(performance.now() - startTime)

  yield {
    type: 'done',
    answer: fullAnswer,
    sources: finalSources,
    images: finalImages,
    cached: false,
    retrievalBypassed: false,
    latencyMs,
  }
}

