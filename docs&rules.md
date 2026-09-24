# Parsea — Documentation, Architecture & AI Agent Rules

> **CRITICAL DIRECTIVE FOR AI AGENTS & CONTRIBUTORS:**
> Read this document completely before modifying or creating any code in this repository.
> **DO NOT CREATE DUPLICATE FUNCTIONS FOR THE SAME JOB.**
> All API procedures, caching, embedding, and RAG execution MUST follow the centralized single-source-of-truth modules documented below.

---

## 1. Core Technology Stack

* **Fullstack Framework**: Next.js 16 (App Router) + TypeScript
* **CMS & Academic Data Hierarchy**: Payload CMS 3.90 (`@payloadcms/next`, `@payloadcms/db-postgres`)
* **API Layer**: **tRPC v11** (`@trpc/server`, `@trpc/client`, `@trpc/react-query`)
* **State & Data Fetching**: **TanStack Query v5** (`@tanstack/react-query`)
* **Database & Vector Engine**: Supabase PostgreSQL with `pgvector` (cosine distance `<=>`)
* **Cache Layer**: **Redis** (`ioredis`) with automatic in-memory fallback (< 1ms hits)
* **Embeddings**: Local transformer `Xenova/all-MiniLM-L6-v2` (**384 dimensions**, zero paid API cost, local Node.js execution via `@xenova/transformers`)
* **LLM Engine**: OpenRouter Free Tier (default model: `nex-agi/nex-n2.5-mini:free`, zero cost)
* **Frontend Markdown & Math**: `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `katex`

---

## 2. Global Rules & Invariants for AI Agents

### Rule 1: No Duplicate Functions ("Don't create 2 funcs for the same job")
* **RAG Generation**: There is only **ONE** function responsible for performing RAG in the entire codebase:
  ```ts
  import { askRAG } from '@/lib/rag'
  ```
  Do NOT write custom vector queries, similarity checks, or LLM prompt chains inside components, server actions, or ad-hoc routes. Always call `askRAG`.
* **Embeddings**: There is only **ONE** function responsible for computing text embeddings:
  ```ts
  import { getEmbedding } from '@/lib/embeddings'
  ```
* **Caching**: There is only **ONE** module responsible for caching:
  ```ts
  import { getCache, setCache, getOrSetCache, hashKey } from '@/lib/redis'
  ```

### Rule 2: Client-Server Communication Must Use tRPC + TanStack Query
* All new client-facing procedures MUST be added to tRPC routers in `src/server/routers/`.
* On the frontend, components MUST use tRPC React hooks (`trpc.<router>.<procedure>.useQuery()` / `useMutation()`), NOT raw `fetch('/api/...')`.
* If a legacy REST endpoint is needed for external tools (e.g. `POST /api/chat`), it MUST simply delegate directly to `askRAG()` in `src/lib/rag.ts`.

### Rule 3: Redis-First Caching (LightSpeed Performance)
* All computationally expensive operations (text embeddings, vector queries, LLM answers) MUST check the Redis cache layer before calling remote APIs or heavy pipelines.
* Use `getOrSetCache(key, fetchFn, ttlSeconds)` for atomic cache-aside operations.
* Embeddings cache key format: `emb:<sha256(text)[:16]>` (TTL: 7 days)
* RAG answer cache key format: `rag:<sha256(question)[:16]>` (TTL: 24 hours)

### Rule 4: Bulletproof 2-Gate Retrieval Policy
Never return false citations to students:
* **Gate 1 (Similarity Gate)**: Vector search queries MUST enforce a minimum cosine similarity threshold (`MIN_SIMILARITY_THRESHOLD = 0.40`). If all chunks score below 0.40, the system must immediately return without invoking the LLM.
* **Gate 2 (Negation Gate)**: If the LLM generates a response indicating information is absent (e.g., *"not mentioned"*, *"do not contain"*), the `sources` array MUST be emptied to `[]`. Never attach citations to negative answers.

### Rule 5: Public Read Access on Academic Collections
* Collections serving student materials (`Documents`, `DocumentPages`, `Chunks`, `Subjects`, `Semesters`, `Branches`, `Colleges`, `Media`) MUST define:
  ```ts
  access: {
    read: () => true,
  }
  ```
  Without this, Payload CMS restricts reads to authenticated admin sessions, causing public PDF downloads and native iframe viewers (`/api/documents/file/...`) to fail with `{"errors":[{"message":"You are not allowed to perform this action."}]}`.

---

## 3. Directory Structure & Import Reference

```text
src/
├── app/
│   ├── (frontend)/
│   │   ├── layout.tsx         # Wraps app with <TRPCProvider>
│   │   ├── chat/page.tsx      # Student chat UI using trpc.chat.ask.useMutation()
│   │   └── pdf/[id]/page.tsx  # Native embedded PDF viewer jumping to #page=N
│   ├── (payload)/             # Payload CMS admin routes (/admin)
│   └── api/
│       ├── chat/route.ts      # REST wrapper -> calls askRAG()
│       └── trpc/[trpc]/       # tRPC HTTP fetchRequestHandler
│
├── collections/               # Payload CMS Academic Hierarchy
│   ├── Colleges.ts            # College level
│   ├── Branches.ts            # Branch level (relates to College)
│   ├── Semesters.ts           # Semester level (relates to Branch)
│   ├── Subjects.ts            # Subject level (relates to Semester)
│   ├── Documents.ts           # Uploaded PDFs (relates to Subject, triggers hook)
│   ├── DocumentPages.ts       # Extracted page text (relates to Document)
│   └── Chunks.ts              # Text chunks + pgvector vector(384) embeddings
│
├── hooks/
│   └── processDocument.ts     # Document afterChange hook: extracts PDF, chunks & embeds
│
├── lib/
│   ├── redis.ts               # Central Redis cache layer (ioredis + memory fallback)
│   ├── embeddings.ts          # Central local embeddings (all-MiniLM-L6-v2, 384-dim)
│   └── rag.ts                 # CANONICAL SINGLE RAG ENGINE (askRAG)
│
├── server/
│   ├── trpc.ts                # tRPC initialization & procedures
│   └── routers/
│       ├── _app.ts            # Root AppRouter definition
│       └── chat.ts            # Chat router: defines chat.ask procedure
│
└── trpc/
    ├── client.ts              # createTRPCReact<AppRouter>()
    └── Provider.tsx           # TRPCProvider (QueryClientProvider + trpc.Provider)
```

---

## 4. How to Import and Use Core Modules

### 1. In Frontend Components (React / Client Components)
```tsx
'use client'

import { trpc } from '@/trpc/client'

export function MyComponent() {
  const askMutation = trpc.chat.ask.useMutation()

  const handleSearch = (query: string) => {
    askMutation.mutate({ question: query }, {
      onSuccess: (data) => {
        console.log('Answer:', data.answer)
        console.log('Sources:', data.sources)
        console.log('From Redis Cache:', data.cached)
        console.log('Latency (ms):', data.latencyMs)
      },
    })
  }

  return (
    <div>
      <button onClick={() => handleSearch('Explain pigeonhole principle')} disabled={askMutation.isPending}>
        {askMutation.isPending ? 'Searching...' : 'Search'}
      </button>
      {askMutation.data && <div>{askMutation.data.answer}</div>}
    </div>
  )
}
```

### 2. In Backend Routes, Services & tRPC Procedures
```ts
// Always use the canonical askRAG function
import { askRAG } from '@/lib/rag'

const result = await askRAG('what is pigeonhole principle')
// result = { answer: string, sources: Array<{ document: string, page: number }>, cached: boolean, latencyMs: number }
```

### 3. Using the Redis Cache Directly
```ts
import { getCache, setCache, getOrSetCache, hashKey } from '@/lib/redis'

// Simple Get / Set
await setCache('my-key', { data: 123 }, 3600) // 1 hr TTL
const cached = await getCache<{ data: number }>('my-key')

// Atomic Get-Or-Set
const key = hashKey('prefix', userInput)
const { data, cached } = await getOrSetCache(key, async () => {
  return await expensiveComputation()
}, 3600)
```

### 4. Generating Embeddings
```ts
import { getEmbedding } from '@/lib/embeddings'

// Returns Promise<number[]> with exactly 384 dimensions
// Automatically checks Redis before running transformer model
const vector = await getEmbedding('text to embed')
```

---

## 5. Current End-to-End Workflow

```
1. Admin Upload (http://localhost:3000/admin)
   College -> Branch -> Semester -> Subject -> Document (PDF Upload)
         │
         ▼
2. Ingestion Pipeline (src/hooks/processDocument.ts)
   - Sanitizes Array.prototype.random (prevents pdfjs-dist crash)
   - Splits PDF by page into `document_pages`
   - Chunks text into ~1000 character overlapping windows
   - Generates 384-dim embeddings via getEmbedding() (Redis-cached)
   - Saves to `chunks` table with `embedding vector(384)` in Supabase PostgreSQL
         │
         ▼
3. Student Query (http://localhost:3000/chat)
   - User types question into UI
   - Triggers `trpc.chat.ask.useMutation()`
         │
         ▼
4. Canonical RAG Engine (src/lib/rag.ts -> askRAG)
   - Step A: Checks Redis cache (Returns in < 40ms on hit 🚀)
   - Step B: Computes query vector via getEmbedding() (Redis-cached)
   - Step C: Executes single SQL JOIN with Gate 1 similarity threshold (>= 0.40)
   - Step D: Calls OpenRouter free LLM (nex-agi/nex-n2.5-mini:free)
   - Step E: Runs Gate 2 negation filter (erases sources if model says info is missing)
   - Step F: Caches final response in Redis for 24 hours
         │
         ▼
5. Frontend Rendering
   - Renders answer with react-markdown + KaTeX math notation
   - Displays page-level citation badges (e.g. 📄 Pigeonhole Principle Page 37)
   - Shows live latency counter (⚡ 0.04s on cache hit)
```

---

## 6. Environment Variables Reference (`.env`)

```env
DATABASE_URL=postgresql://postgres:...@...supabase.co:5432/postgres
PAYLOAD_SECRET=...
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=nex-agi/nex-n2.5-mini:free
# Optional: Real Redis instance (defaults to sub-millisecond in-memory fallback if omitted)
# REDIS_URL=redis://default:...@...upstash.io:6379
```
