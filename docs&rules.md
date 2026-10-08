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
* **Frontend typography**: Manrope (Google Fonts, weights 400–800), loaded once in the frontend layout with `display=swap` and system sans-serif fallbacks. Do not duplicate the font request with a CSS `@import`.

### Landing-page design (updated 2026-10-08)

* Shared colors, navigation, buttons, and focus styles live in `src/app/(frontend)/theme.css`, scoped to `.parsea-theme`: warm ivory, white, muted periwinkle, and deep-blue accents. Landing, chat, notes, login, and signup use this theme; page-specific layout stays in their own stylesheets.
* The main white hero card uses a thin deep-blue border and restrained shadow for separation from the grid. The navbar is a floating white panel with a matching deep-blue border and a centered navigation tray. On mobile, its logged-out account action is the same muted light-blue “Get started” signup button as desktop, instead of the “Sign in” text link.
* `src/components/AmbientGrid.tsx` renders a decorative 56px grid with darker muted lines. Hovered cells fade out; pointer events remain available to content. Reduced-motion and coarse-pointer users receive a static grid. Animation runs only while cells are fading and cleans up listeners and frames.
* The subject browser retains existing tRPC queries, semester selection, subject links, loading/error/empty states, and the shared upload dialog. The study-chat illustration is explicitly labeled as an example.

### Chat, library, and multi-PDF upload (updated 2026-10-08)

* Chat navigation and workspace use the available viewport width without the shared 1240px cap: 24px outer gutters on desktop, 16px on mobile. The history sidebar keeps its fixed desktop width and mobile drawer behavior; other pages retain their existing width limits.
* Chat keeps streaming, math, citations, diagram zoom, speech settings, course filters, and saved conversations. Starter prompts fill an editable draft. The composer stays visible, scrolling follows responses only when the reader is near the bottom, and deletion requires confirmation. Mobile history and upload/diagram dialogs support Escape and focus restoration.
* Notes respects subject and semester URL parameters, groups PDFs by subject/module with optional topic labels, and provides search, type/module filters, retry, and empty states. Its current result limit is 100 files, displayed in the UI. Ask links pass course context to Deep analysis.
* Login/signup share the theme and brand mark, retain existing auth endpoints, preserve inputs on errors, and provide password visibility controls.
* `UploadNoteModal` accepts multiple PDFs with editable titles, a shared subject/module/topic, per-file progress, and failed-only retry. Each PDF remains a separate document using the existing upload/ingestion route and canonical embedding/R2 pipeline. Leaving module/topic blank allows the existing filename classifier to organize each file independently.
* `AdminBatchUpload` adds “Upload multiple PDFs to a module” to the Documents create/edit form and inherits selected relationships. Payload native bulk upload remains enabled on the collection list. This does not change a document into an array of PDFs or create a second embedding implementation.

### Public catalog performance (updated 2026-10-08)

* `src/lib/catalog.ts` is the centralized read-only SQL path for public academic catalog queries. It joins metadata once, applies bound search/course filters before the limit, and counts stats in SQL; it does not initialize Payload or ingestion. Do not reuse it for private/user data or bypass newly introduced collection access restrictions.
* The notes tRPC router uses the central cache with normalized versioned keys. Subjects/modules/topics cache for one hour; notes/stats for 30 seconds. Collection change/delete hooks invalidate the catalog namespace. Upload dialog queries run only while open, and stats use a separate tRPC HTTP link so they do not hold up batched subjects.
* RAG in the chat router and document processing in collection hooks load lazily. Preserve these boundaries: catalog requests must not import the PDF/transformer pipeline eagerly.
* The central Redis helper deduplicates in-flight reads, bounds Redis waits at 600 ms, and temporarily falls back after failures. Its bounded local mirror lasts at most five seconds with Redis configured; without Redis it uses the requested TTL.
* Verification: TypeScript and seven catalog/cache tests passed. Local catalog measurements were 20–41 ms for cached reads; the first measured subject read was 938 ms. These are local observations, not a production cold-start benchmark or a zero-second guarantee.

### Document deletion (updated 2026-10-08)

* Required `document_pages.document_id` and `chunks.document_id` columns currently have foreign keys configured with `ON DELETE SET NULL`. Deleting a parent with dependent records therefore fails with PostgreSQL `23502`. Do not solve this by allowing orphaned pages or vectors.
* `src/hooks/deleteDocumentDependents.ts` is the shared cleanup used by Documents' `beforeDelete` hook and re-ingestion on update. It deletes only that document's chunks/pages, passes the parent's Payload request to retain its transaction, and aborts when bulk cleanup reports failures. Existing parent delete access checks remain unchanged.
* Document changes/deletes also invalidate current `rag:v3:` and legacy `rag:v2:` answer caches through the central Redis helper, preventing old cached citations from surviving removal. Catalog invalidation remains centralized.
* R2 object lifecycle is unchanged by this relational cleanup. Database verification reproduced the original failure for document 2, verified cleanup followed by deletion, and rolled back all changes; no PDF or records were permanently removed by that check. Five deletion/cache-invalidation tests supplement the seven catalog/cache tests.


---

### Conversation-first chat and PDF selection (updated 2026-10-09)

* `/chat` uses sidebar navigation/account actions, not the landing navbar. A slim course toolbar replaces the duplicated heading/scope card. The composer starts with one line and expands up to 128px; mode, language, and voice stay available in compact menus. Mobile and Focus mode hide settings behind an accessible Settings button.
* Focus mode hides the sidebar and secondary badges/hints; history opens as a focus-managed drawer. Scope/settings support Escape and focus restoration. Answer typography and internal spacing favor reading, with horizontal scrolling for wide math/code/tables. The outer workspace remains full width.
* Sources and extracted diagrams are separate, initially collapsed native disclosures. Do not label an answer as grounded unless it has actual retrieved sources: answers without citations say “General explanation · No note sources.” Current Logic documents have no ingested chunks in the inspected database, and screenshots are only available for image-rich pages; UI formatting does not repair ingestion.
* `PDFCircleSearch` is an opt-in text-selection prototype in `/pdf/[id]`. PDF.js loads only on activation, renders one page, and maps a closed lasso or dragged box to text geometry. Keyboard users can select page text and edit the excerpt. Scans/image-only diagrams explicitly require future OCR/vision support; no OCR or visual understanding is claimed.
* Explain/practice actions transfer a bounded draft through browser session storage to the existing chat workflow. They never send the selection automatically or put it into the URL. Generation continues through the canonical RAG pipeline; there is no second embedding, storage, or LLM implementation. Direct R2 PDFs need appropriate browser CORS access; standard reading remains available when selection fails.
* The locally hosted PDF.js worker and Apache license in `public/vendor/pdfjs` are copied from the pinned `pdfjs-dist@5.4.296` package. Update the worker together with that dependency.
* Verification uses isolated DOM/component tests and TypeScript. Live browser preview was not verified because browser access was declined. No real LLM requests, accounts, uploads, or permanent document deletions were performed in those tests.

### Payload lock-schema repair (updated 2026-10-09)

* A second verified deletion blocker was PostgreSQL `42703`: Payload lock relationships lacked `modules_id`, `topics_id`, and `conversations_id`. `20261009_000000_lock_hierarchy` adds their columns, indexes, and cascade foreign keys idempotently. `npx tsx scripts/repair-lock-hierarchy.ts` applies this targeted repair against the configured database; it does not delete records or files.
* Derived chunk/page cleanup now uses Payload's adapter bulk delete, with the parent's request/transaction and document-specific filters. These derived collections currently have no delete hooks/uploads. If such lifecycle behavior is added, revisit this bulk optimization rather than silently skipping it. Parent document access checks and normal upload deletion remain intact.
* The repair was applied locally. Payload document 2 deletion plus cleanup returned no errors in a rollback-only diagnostic (1,078ms), restoring document 2 and all 47 chunks. Physical-file removal and the authenticated admin HTTP path were not exercised by that diagnostic. Existing R2 object lifecycle is unchanged.

### Administrator workspace and upload feedback (updated 2026-10-09)

* `/administrator` is a separate calm workspace with an elongated pill navigation, real overview counts, paginated/searchable PDF management, curriculum CRUD from colleges through topics, and profile/role management. Shared batch upload can be opened from a subject or module. Advanced Payload remains available for file replacement and low-level administration, not everyday library tasks.
* Every administrator tRPC procedure authenticates the Payload session and requires an Admin role. The page also guards access before rendering. Public catalog queries remain lazy; private admin data never uses the public catalog SQL pool. Query results explicitly select safe account fields and bound table/picker sizes.
* Users can register as students and read/update their own profile, but cannot assign themselves an Admin role. Curriculum writes and document edits/deletes require Admin access in Payload too. Role changes require acknowledgement and block self-demotion; folders with children/PDFs cannot be deleted. Bulk PDF deletion reports partial failures, reusing the existing document cleanup/cache hooks.
* Metadata-only document edits retag chunks in the parent transaction without re-uploading or recomputing embeddings. Curriculum name/number edits similarly synchronize derived retrieval tags. Existing curriculum folders cannot be moved by this UI, preventing inconsistent child relationships.
* Index health shows stored page/chunk/vector counts and cloud-key presence, not an invented job status. Explicit re-indexing goes through the canonical ingestion hook with strict error propagation. Ingestion's derived writes and direct vector/storage SQL now share the parent transaction; saved cloud PDFs can be read when a local copy is absent. Re-indexing is still synchronous and can exceed serverless runtime limits; no durable worker/queue or instant-on-drop indexing is claimed.
* The shared uploader has gently advancing optimistic progress capped below completion until a server response, per-file status, estimated-progress labeling, reduced-motion support, and failed-only retry. Upload confirmation does not claim a complete vector index.
* `/chat` now replaces its permanent sidebar with a narrow rounded navigation rail (horizontal pill on mobile). History is always an on-demand focus-managed drawer. Focus hides the rail; navigation, accounts, scope, citations, diagrams, and composer controls remain available.
* Vercel PDF records without a usable R2 URL show an unavailable-file explanation instead of embedding a local endpoint's JSON failure. The PDF 7 production record was confirmed to have no cloud key, and its local-file URL returned HTTP 500. With explicit user approval, its 2,238,410-byte original was restored to R2 and its existing ID preserved; the cloud PDF header was verified. No vectors were regenerated or local originals removed. The explicitly approved account was granted Admin access via the trusted CLI.
* Maintenance scripts `repair-document-cloud-copy.ts <id>` and `grant-admin-access.ts <email>` require explicit operator-selected targets; never automatically promote a signup or run them without approval. Cloud object paths are centralized in `lib/documentStorage.ts`; binary operations still use `lib/r2.ts`.
* The reported production `Cannot find module 'onnxruntime-node'` is a separate deployment/runtime packaging failure. It resolves locally, but existing local chat build traces lacked ONNX files. No dependency/tracing deployment patch or production ML verification is included in this change. Production rechecking is on hold until the user pushes. Local verification: TypeScript and 49 isolated tests; live browser visual review remains unverified.

### Scanned-PDF OCR correction (2026-10-09)

* Text-only PDF loaders omit image-only pages. Ingestion now independently enumerates physical pages with PDFParse's public `getInfo()`, inserts omitted pages into the extraction pass, and runs the existing canonical OCR helper on low-text pages—even when the loader returned zero pages.
* Screenshots use the supported `partial: [pageNumber]` option, with 2x rendering for OCR, rather than an ignored `pageNumber` property that could render every page repeatedly. Private `parser.load()` calls were removed.
* PDF scan OCR goes directly to the existing Tesseract.js helper (`preferLocal`), avoiding a vision API wait. Other callers retain vision-first behavior with a bounded timeout. Workers terminate in `finally`, including recognition failures. First-use language-data downloads still require network access; this is not a fully offline or serverless-timeout guarantee.
* Regression tests cover all-scan PDFs returning zero text pages, mixed text/scanned pages, local-OCR selection, and worker cleanup. Blank/unreadable scans still produce an honest strict indexing failure. No real document was re-indexed by these tests; production checking remains on hold until the user pushes.

### Production ONNX packaging hotfix (2026-10-09)

* `onnxruntime-node@1.30.0` is now a direct production dependency rather than only a Transformers.js transitive dependency. Next file tracing explicitly includes the ONNX runtime packages for chat and tRPC server traces. This addresses Vercel's `Cannot find module 'onnxruntime-node'` error; verify after deployment.

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
  `documents/{branch}/{semester}/{subject}/{module}/{topic}/{document}/{filename}`
* Payload CMS stores document metadata, `storageKey`, and `r2Bucket`.
* PDF viewers and download links must stream directly from Cloudflare R2 using `getPresignedDownloadUrl(storageKey)`. Never route large PDF streams through Next.js/Payload server processes.

### Rule 7: Metadata Pre-Filtering Before Retrieval
* Academic college scale involves hundreds of thousands of chunks across multiple departments.
* When `branch`, `semester`, `subject`, `module`, or `topic` are provided, query filters MUST be applied in SQL before vector HNSW distance and GIN full-text calculations to isolate the search space.

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
│   ├── Modules.ts             # Module level (relates to Subject)
│   ├── Topics.ts              # Optional 1.1 / 1.2 level (relates to Module)
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
