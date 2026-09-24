# Parsea — Documentation, Architecture & AI Agent Rules

> **CRITICAL DIRECTIVE FOR AI AGENTS & CONTRIBUTORS:**
> Read this document completely before modifying or creating any code in this repository.
> **DO NOT CREATE DUPLICATE FUNCTIONS FOR THE SAME JOB.**
> All API procedures, caching, embedding, R2 storage, and RAG execution MUST follow the centralized single-source-of-truth modules documented below.

---

## 1. Core Technology Stack

* **Fullstack Framework**: Next.js 16 (App Router) + TypeScript
* **CMS & Academic Data Hierarchy**: Payload CMS 3.90 (`@payloadcms/next`, `@payloadcms/db-postgres`)
* **API Layer**: **tRPC v11** (`@trpc/server`, `@trpc/client`, `@trpc/react-query`)
* **State & Data Fetching**: **TanStack Query v5** (`@tanstack/react-query`)
* **Database & Vector Engine**: Supabase PostgreSQL with `pgvector`
  * **Vector Index**: **HNSW** (`chunks_embedding_hnsw` using `vector_cosine_ops`)
  * **Keyword Search**: PostgreSQL Full-Text Search with **GIN index** (`chunks_fts_idx`)
* **Object Storage**: **Cloudflare R2** (S3-compatible via `@aws-sdk/client-s3` & `@aws-sdk/s3-request-presigner`)
  * Direct student streaming via presigned URLs (Zero server bandwidth bottleneck on Next.js/Payload)
* **Cache Layer**: **Redis** (`ioredis`) with automatic in-memory fallback (< 1ms hits)
* **Embeddings**: Local transformer `Xenova/all-MiniLM-L6-v2` (**384 dimensions**, zero paid API cost, local Node.js execution via `@xenova/transformers`)
* **Reranker**: Composite Cross-Reranker fusing Reciprocal Rank Fusion (RRF) with exact query term overlap and vector cosine similarity
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
* **Object Storage (Cloudflare R2)**: There is only **ONE** module responsible for R2 upload & presigned URLs:
  ```ts
  import { uploadToR2, getPresignedDownloadUrl, R2_BUCKET } from '@/lib/r2'
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
* RAG answer cache key format: `rag:v2:<sha256({question, filters})[:16]>` (TTL: 24 hours)

### Rule 4: Bulletproof 2-Gate Retrieval Policy
Never return false citations to students:
* **Gate 1 (Similarity Gate)**: Vector search queries MUST enforce a minimum cosine similarity threshold (`0.35`) and keyword presence. If all chunks score below threshold and have 0 keyword match, immediately return without invoking the LLM.
* **Gate 2 (Negation Gate)**: If the LLM generates a response indicating information is absent (e.g., *"not mentioned"*, *"do not contain"*), the `sources` array MUST be emptied to `[]`. Never attach citations to negative answers.

### Rule 5: Public Read Access on Academic Collections
* Collections serving student materials (`Documents`, `DocumentPages`, `Chunks`, `Subjects`, `Semesters`, `Branches`, `Colleges`, `Media`) MUST define:
  ```ts
  access: {
    read: () => true,
  }
  ```
  Without this, Payload CMS restricts reads to authenticated admin sessions, causing public PDF downloads and native iframe viewers (`/api/documents/file/...`) to fail with `{"errors":[{"message":"You are not allowed to perform this action."}]}`.

### Rule 6: Cloudflare R2 for Binary PDF Storage & Presigned Streaming
* Binary PDF files are uploaded to **Cloudflare R2** with hierarchical keys:
  `documents/{branch}/{semester}/{subject}/{filename}`
* Payload CMS stores document metadata, `storageKey`, and `r2Bucket`.
* PDF viewers and download links must stream directly from Cloudflare R2 using `getPresignedDownloadUrl(storageKey)`. Never route large PDF streams through Next.js/Payload server processes.

### Rule 7: Metadata Pre-Filtering Before Retrieval
* Academic college scale involves hundreds of thousands of chunks across multiple departments.
* When `branch`, `semester`, or `subject` are provided, query filters MUST be applied in SQL before vector HNSW distance and GIN full-text calculations to isolate the search space.

### Rule 8: Batch Embedding Generation in Ingestion
* Never process embeddings sequentially 1-by-1 in loops (`PDF -> page 1 -> embedding -> page 2...`).
* Always batch chunks (batches of 16/32) and resolve vectors concurrently (`Promise.all`) before bulk inserting.

### Rule 9: Multimodal Diagram Extraction & Delivery
* Chunks can have attached visual figures and diagrams (`has_image: true`, `image_url: text`, `image_caption: text`).
* Extracted diagrams are stored in Cloudflare R2 under `documents/{branch}/{sem}/{subject}/media/page_{N}.png`.
* `askRAG()` returns `images: CitedImage[]` with presigned direct Cloudflare R2 URLs.
* The frontend chat UI displays visual diagram cards alongside text answers with full-resolution zoom modals.

---

## 3. Directory Structure & Import Reference

```text
parsea/src/
├── app/
│   ├── (frontend)/
│   │   ├── layout.tsx         # Wraps app with <TRPCProvider>
│   │   ├── chat/page.tsx      # Student chat UI using trpc.chat.ask.useMutation()
│   │   └── pdf/[id]/page.tsx  # Native PDF viewer with direct Cloudflare R2 presigned streaming
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
│   ├── Documents.ts           # Uploaded PDFs (relates to Subject, tracks storageKey & r2Bucket)
│   ├── DocumentPages.ts       # Extracted page text (relates to Document)
│   └── Chunks.ts              # Text chunks + pgvector vector(384) embeddings + academic tags
│
├── hooks/
│   └── processDocument.ts     # Document afterChange hook: R2 upload, batch embeddings, HNSW/GIN indexing
│
├── lib/
│   ├── r2.ts                  # Cloudflare R2 client (uploadToR2, getPresignedDownloadUrl)
│   ├── redis.ts               # Central Redis cache layer (ioredis + memory fallback)
│   ├── embeddings.ts          # Central local embeddings (all-MiniLM-L6-v2, 384-dim)
│   └── rag.ts                 # CANONICAL SINGLE RAG ENGINE (askRAG with pre-filtering & reranker)
│
├── server/
│   ├── trpc.ts                # tRPC initialization & procedures
│   └── routers/
│       ├── _app.ts            # Root AppRouter definition
│       └── chat.ts            # Chat router: defines chat.ask procedure with metadata filters
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

export function ChatWidget() {
  const askMutation = trpc.chat.ask.useMutation()

  const handleSearch = (query: string) => {
    askMutation.mutate({
      question: query,
      filters: {
        branch: 'COMPS',
        semester: 3,
        subject: 'Discrete Mathematics',
      },
    }, {
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
      <button onClick={() => handleSearch('State pigeonhole principle')} disabled={askMutation.isPending}>
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

const result = await askRAG('what is pigeonhole principle', {
  branch: 'COMPS',
  semester: 3,
  subject: 'Discrete Mathematics',
})
```

### 3. Cloudflare R2 Direct PDF Presigned Streaming
```ts
import { getPresignedDownloadUrl } from '@/lib/r2'

// Generates a 1-hour presigned URL directly from Cloudflare R2
const presignedUrl = await getPresignedDownloadUrl(
  'documents/comps/sem3/discrete-mathematics/module-5.pdf',
  'stondemporium-media',
  3600
)
```

---

## 5. Optimized Hybrid Retrieval Architecture Diagram

```text
                           Student Query
                                 │
                   ┌─────────────┴─────────────┐
                   │ Metadata Pre-Filtering    │
                   │ branch, semester, subject │
                   └─────────────┬─────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
      pgvector (HNSW Index)            PostgreSQL FTS (GIN)
      Semantic Cosine (<=>)            Exact Keyword Match
            Top 25                           Top 25
                 │                               │
                 └───────────────┬───────────────┘
                                 ▼
                     Reciprocal Rank Fusion (RRF)
                          Merged Top 30-50
                                 │
                                 ▼
                     Composite Cross-Reranker
                     (RRF + Lexical Term Coverage + Vector Sim)
                                 │
                                 ▼
                           Top 5 Chunks
                                 │
                                 ▼
                             LLM Engine
                      (OpenRouter / Free Tier)
                                 │
                                 ▼
                         Answer + Citations
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
            Redis Cache                       Student
         (rag:v2:<hash>)                         │
                                                 ▼
                                        Click 📄 [Open PDF ↗]
                                                 │
                                                 ▼
                                           Cloudflare R2
                                      (Direct Presigned Stream)
```
