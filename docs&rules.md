# Parsea — Documentation, Architecture & AI Agent Rules

## PDF runtime and upload feedback update (2026-10-17)

- Validation for this update: 23 focused upload/parser/chat tests pass, including transfer/index overlap; frozen-lockfile offline install and the production build (including TypeScript) pass. Browser visual verification was not performed.
- Node is pinned to 22.x. Native canvas 0.1.80 is a direct dependency with a synchronized pnpm lockfile. `ensurePDFRuntime` loads real DOMMatrix, ImageData and Path2D before either server PDF parser import. Failed initialization resets for retry and reports the missing runtime explicitly. Never add placeholder canvas classes. Linux canvas binding tracing remains explicit; Windows validation alone cannot certify the deployed Linux bundle.
- Batch uploads now overlap one serial direct-R2 transfer lane with one serial indexing lane. Later files can be safely saved while earlier files undergo OCR. Preparation remains serial to avoid racing inferred folder creation. Existing canonical ingestion, checkpoints, authorization and retries remain in use.
- Progress distinguishes safely uploaded files from ready-to-study indexes, includes per-file stages and OCR page counts, and uses a stage-weighted overall percentage. Only a ready server response reaches 100%. Failed files remain retryable; no artificial timer claims completion.
- Chat navigation is a compact, vertically centered muted capsule on desktop, retaining the mobile pill, history drawer and minimize controls. The upload dialog no longer shares the generic modal class; its file input and thin scrollbar are scoped.
- Real six-page native PDF extraction/rendering and rotation checks pass after runtime initialization; the corrected PNG was inspected. Deployment/restart is required before production retries can use this code. No deployment was performed by the assistant.

> **CRITICAL DIRECTIVE FOR AI AGENTS & CONTRIBUTORS:**
> Read this document completely before modifying or creating any code in this repository.
> **DO NOT CREATE DUPLICATE FUNCTIONS FOR THE SAME JOB.**
> All API procedures, caching, embedding, R2 storage, and RAG execution MUST follow the centralized single-source-of-truth modules documented below.

---

## Page orientation contract (2026-10-16)

This section supersedes earlier rotation, screenshot and synchronous re-index notes below.

- `src/lib/pageOrientation.ts` defines clockwise quarter-turn corrections and orientation version 1. Corrections are relative to the PDF metadata-applied viewport, not absolute PDF rotation. Never apply PDF /Rotate twice.
- `src/lib/pdf-extraction.ts` remains the only extraction/rendering pipeline. For native text, `pdfOrientationHints.ts` inspects public PDF.js text transforms after the viewport transform, weighted by readable letters; short numeric diagram labels and conflicting directions are not sufficient evidence. The optional inspector is disposed alongside the PDFParse renderer; private parser internals and fake canvas primitives are forbidden.
- The shared OCR recognizer now returns text, confidence, correction and verification status. Scans test 0/90/270/180 degrees, within the existing per-page timeout. A nonzero correction requires confident readable text and a meaningful improvement over the original direction; ambiguous diagram-only pages retain their original direction. The legacy text-only OCR adapter delegates to this same implementation. Region OCR uses this recognizer too.
- Screenshots apply the same saved correction with an expanded canvas, without cropping. Original PDF bytes, document IDs and physical citation pages remain unchanged. Native text is not unnecessarily replaced by OCR. Local OCR still cannot interpret diagram shapes or guarantee accurate equations.
- Migration `20261015_010000_page_orientation` adds versioned orientation/confidence/verification columns to checkpoints and published document pages, plus published preview keys. It is additive and has been applied to the configured database. Checkpoints with an older orientation version are regenerated, not reused. Current-version checkpoints retain resumability and lease fencing. Versioned preview folders preserve previous cloud objects until publication succeeds.
- All physical pages retain published orientation and available previews, including pages without searchable text; only readable text creates semantic chunks. The PDF page sidebar labels these as source page screenshots rather than standalone extracted diagrams, includes visual-only pages, and contains the whole image instead of cropping it.
- When published orientation metadata exists, the PDF.js reader opens in scroll mode with the per-page correction. Rotate left/right/reset controls are accessible on touch and desktop, and adjustments are local to the current reader view. Page rotation rerenders the canvas/text geometry and clears stale selections/answers; region OCR crops that rendered canvas using its actual DPI. Citation-page changes update the reader page. The explicit Standard reader fallback shows the unchanged original PDF and cannot inherit app-controlled corrections.
- `/administrator` re-indexing now calls `queueDocumentReindex`: stage a cloud-side R2 copy, create/reuse a durable replacement job, then continue via the same worker as uploads. Re-index/resume UIs share the bounded continuation helper. Existing files/indexes remain published until success. Failed/running jobs and coverage warnings remain visible in Recent uploads. No new embedding, storage, RAG, or LLM pipeline is permitted.
- Maintenance `scripts/repair-page-orientation.ts --apply <ids>` or `--apply --all` uses the same re-index queue and never promotes an account. All 13 current PDFs (IDs 3-15), including the reported Equivalence Relations document, have completed the refresh with IDs/originals retained. The final database audit records 364 physical pages and available previews, 283 nonzero automatic corrections, 52 unconfirmed directions, and 342 compatible semantic chunks with source-image links. Unconfirmed does not necessarily mean sideways: numeric/diagram-only pages and competing OCR evidence remain conservative. The earlier 350-chunk count below predates this stricter orientation/quality pass.
- Derived page/chunk reads stay public, but create/update/delete require admin access; internal canonical ingestion still uses trusted local API writes. Students must not be able to inject arbitrary preview keys or retrieval vectors through Payload endpoints. Ready-content reuse checks both embedding and page-orientation versions.
- Verification: all 126 isolated integration tests pass, with follow-up orientation/re-index/UI checks passing after the final small edits. A six-page native-text fixture confirms 0/90/180/270-degree content and both already-applied/extra PDF metadata rotation cases; corrected PNGs were visually inspected. The real seven-page scan and its published R2 PNG were verified upright. Local maintenance connection interruptions retained checkpoints. Automatic reclaim still waits 15 minutes; after three worker processes had explicitly exited, only their unchanged job/timestamp leases were conditionally released and resumed, with no published-index reset. Local production build and TypeScript pass; traces are approximately 106-108 MB with the PDF orientation worker, CPU ONNX, canvas and OCR assets present. These Windows measurements do not prove final Vercel/Linux size. No git push, deployment, or live-browser verification was performed.
- Source previews and app-reader rotation are derived views. Downloads/Standard reader preserve original PDF bytes. Saved historical chat messages may still reference old immutable image versions; this maintenance does not rewrite conversation history.
- Post-refresh cloud check: all 13 signed PDF range reads returned HTTP 206 with valid PDF headers. All 364 published pages have preview keys, and all 342 current-model chunks have source-image links; representative corrected PNGs were fetched and visually inspected. This is not a claim that ambiguous diagrams were semantically understood or that the code is deployed.

## Current upload and scheduling contract (2026-10-15)

This update supersedes conflicting October 10 setup and upload notes below.

- Admin and student uploads share `src/server/routers/uploads.ts`, the canonical R2 and ingestion pipeline, and persisted progress. Students can access only their own jobs and cannot replace library documents or create curriculum folders. Admin-only operations remain role-gated.
- SHA-256 is computed before upload and verified against downloaded bytes before indexing. Compatible ready indexes are reused only within the same owner, subject/module/topic and material type. Stable request IDs, advisory publication locks and model checks protect retries and concurrent identical uploads.
- Migration `20261015_000000_resumable_ingestion` adds page checkpoints, content hashes and lease tokens. Completed text/OCR and screenshot keys survive document-transaction rollback. A processing invocation handles at most eight fresh pages, including at most three OCR pages; subsequent invocations reuse completed pages. Lease fencing prevents an expired worker from publishing over its successor. Existing published files/indexes remain intact until atomic replacement succeeds.
- Both upload entry points start after a subject is known and a short cancellation window. Recent uploads support explicit resume. Browser closure does not erase queued work, but does not itself start a worker.
- The user selected Vercel-only hosting. `/api/ingestion/run` is a Node GET endpoint with a 300-second declared maximum, constant-time Bearer authentication via a server-only `CRON_SECRET` of at least 32 characters, and at most one checkpoint batch per invocation. The shared queue drain is `src/lib/ingestionQueue.ts`; the operator CLI reuses it. Scheduler examples and activation steps are in `docs/vercel-ingestion-setup.md`. No paid host, cron activation, secret configuration, git push or deployment was performed. Hobby's daily cron is only a backup, not timely unattended processing of large scans.
- R2 bucket CORS is now applied, preserving existing rules. Production-origin PUT preflight returned 204 with the correct origin, GET/HEAD/PUT and content-type permission. The previous 403/setup-blocked notes below are historical. Use `scripts/configure-r2-cors.ts` and `scripts/check-r2-cors.ts` for controlled maintenance; do not allow arbitrary origins.
- Circle selection uses the PDF text layer first. An explicit local OCR action reads a scanned region using `src/lib/browserOCR.ts`; browser and server OCR share `src/lib/ocrRecognition.ts` for quality checks, rotations and timeouts. First use downloads worker/language assets. Selected image pixels are not uploaded for OCR; explaining the resulting text remains a separate explicit action. OCR does not interpret diagram shapes.
- Diagram-only or low-confidence pages in an otherwise readable PDF retain their original visual/checkpoint and are excluded from semantic chunks rather than indexed as OCR noise. Ready-job status explicitly reports pages without searchable text. Entirely unreadable PDFs still fail; rendering failures and timeouts are not silently swallowed. Document 13 exposed this real edge case at physical page 39 and resumed from its 38 saved pages; its final coverage is 43 chunks across 62 physical pages, with 19 pages lacking searchable text. Standalone diagram interpretation remains outside local OCR capability.
- RAG citation identity includes document ID plus physical page, so separate PDFs with identical titles do not collapse sources. Real rebuilt Logic material returned five source screenshots; a signed PNG was verified. This is not a latency promise: the uncached smoke answer took about 36 seconds, while the cached repeat was immediate.
- Verification: production Next build, TypeScript, and 104 integration tests pass, including content mismatch, bounded-batch continuation, stale-lease fencing, duplicate-publication handling, and diagram-only pages. Local function traces are 99-101 MB across chat, upload, tRPC and cron, including Linux CPU ONNX and OCR assets; this is not a guarantee of final Vercel bundle size. Four real rotated scan pages yielded readable OCR. Browser visual QA and the final Linux/Vercel deployment are not verified.
- Full-library audit completed against the configured database: all 13 documents (IDs 3-15) now have descriptive filenames, cloud pointers and compatible `minilm-l6-v2-q8-v1` indexes, totaling 350 semantic chunks with linked source screenshots. Twelve documents were rebuilt; document 8 was already compatible. Document 13 initially failed the old OCR rule and was separately resumed successfully after the diagram-only fix; the initial maintenance command's failure summary is historical, not the final database state. Original local PDFs, document IDs and previous cloud versions were retained. Use `scripts/check-library-cloud.ts` for read-only signed cloud-header checks, and `scripts/resume-upload-job.ts <uuid>` for an explicit operator resume of an existing durable job.
- Signed R2 range reads for all 13 PDFs returned HTTP 206 with valid PDF headers, including repaired PDF 7. This verifies the current objects, not an undeployed browser route or future upload.

## Current ingestion contract (2026-10-10)

This section supersedes the historical SHA-vector/ONNX hotfix and earlier OCR notes below.

- The only PDF extraction path is `src/lib/pdf-extraction.ts`: PDFParse public APIs, real Node canvas, physical page numbers, no fake DOMMatrix/Path2D/ImageData. Low-text pages use one reused Tesseract worker per document. Low-confidence OCR retries expanded-canvas 90/270/180-degree rotations; unreadable scans, passwords, corrupt files, more than 150 pages, and per-page OCR timeouts fail honestly. Screenshots are staged and released page by page rather than retained in memory.
- The only embedding path remains `src/lib/embeddings.ts`: actual quantized MiniLM, mean pooling, normalization, 384 finite dimensions, lazy singleton initialization, version `minilm-l6-v2-q8-v1`. NEVER substitute hashes. Cache keys include the model version. Unknown/legacy vectors are excluded until genuinely regenerated.
- Migration `20261009_010000_semantic_index` adds `embedding_model`, a model-specific cosine HNSW index, GIN FTS, course lookup, and the durable `document_upload_jobs` table. Apply migrations before deploying these callers. `scripts/prepare-ingestion-schema.ts` is the idempotent maintenance equivalent; it was applied to the configured database without deleting or relabelling old chunks.
- Indexing stages a fresh cloud PDF and screenshots before replacing derived rows. The document, pages, versioned vectors, cloud pointer, and upload-job ready state publish in one parent transaction. Failed replacements retain the previous index/cloud objects; staged unused objects are not automatically purged. Bulk SQL uses the parent transaction. Embeddings run in batches of 16, chunk inserts in batches of 32.
- Admin uploads in `/administrator` use authenticated tRPC prepare/complete/process/status procedures and direct signed R2 PUTs (25 MB limit). Stable request IDs prevent retry-created duplicate documents; this is not content-hash duplicate detection. Server HEAD size and PDF header are verified before indexing. A <=3 MB authenticated tRPC fallback covers unavailable browser CORS without exceeding Vercel's request limit. Larger PDFs MUST use direct R2.
- The admin uploader can start automatically after a subject is known, with a short cancellation window. Actual byte transfer and persisted server stages drive progress. Only an atomically committed usable index reports 100%/ready. Recent jobs, failures, resume, replacement, curriculum creation, and user management stay in `/administrator`; native Payload is optional.
- Queue records survive browser closure, but durable records are NOT an autonomous worker. The browser initiates processing; interrupted jobs can be reclaimed after 15 minutes. Schedule `node --import=tsx/esm scripts/ingestion-worker.ts` on a persistent Node runner for unattended/long OCR jobs. No scheduler or external worker has been provisioned. Vercel request handlers declare 300 seconds, not an unlimited-runtime guarantee.
- Filename classification remains centralized. Explicit folders win; admins can reuse/create inferred module/topic folders. Every newly uploaded file gets a sanitized subject/module/topic/title filename, including native Payload uploads. Numeric input names never remain `1.pdf`. Replacement keeps the document ID and citation links. Existing old records are not all renamed/re-indexed automatically.
- Retrieval applies exact course filters before search, ignores incompatible model vectors, and uses consistent OR FTS matching/ranking, RRF, and reranking. Sessions include model and scope; a new named topic must retrieve rather than reuse a previous answer merely because it says “explain.” Deletion/re-index invalidates current/legacy answer and session caches.
- Source page screenshots are labelled as screenshots, not falsely presented as extracted standalone diagrams. Chat and inline PDF explanations display returned sources/visuals with physical page labels and accessible expansion. Cached answers retain object keys and refresh signed URLs. Saved-chat image failures can request a fresh URL only for keys still linked from public chunks; arbitrary private-object signing is forbidden.
- The LLM provider currently used by `rag.ts` is NVIDIA's OpenAI-compatible endpoint, with `NVIDIA_MODEL` override. General-knowledge answers without matched material must carry no note sources or images. Existing similarity/negation gates must not be weakened or citations fabricated.
- Deployment tracing explicitly includes Linux x64 CPU ONNX, canvas wrapper/Linux binding, OCR worker and LSTM WASM assets; excludes other ONNX platforms, GPU binaries, local PDFs and model caches. Local trace measurements are not a proof of the final Linux/Vercel function size or deployment success.
- Verified against real files: scanned PDF 8 indexed and replaced through the durable job path, same ID on retry, cloud screenshot saved; four sideways scanned pages produce readable OCR after rotation. Existing PDFs other than the smoke-test target still need re-index/re-upload. No production deployment or browser visual test was performed.

### Required production setup before bulk re-upload

The production-origin R2 PUT preflight was tested and returned HTTP 403 without CORS headers. Bucket-management access was not available through the configured object credentials. Apply `docs/r2-cors.json` in Cloudflare R2 bucket settings (add exact preview origins if needed), then re-run `scripts/check-r2-cors.ts`. GET/HEAD CORS is also required for PDF.js circle selection. Until this is configured, only the small-file fallback is usable; do not claim all production uploads are ready. Activate a persistent ingestion worker for unattended large scans. Re-upload/re-index old vectors rather than merely marking their model tag compatible.

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
* **Embeddings**: Quantized `Xenova/all-MiniLM-L6-v2` (**384 dimensions**), local CPU inference via `@huggingface/transformers`; model-versioned cache and indexes.
* **Reranker**: Composite Cross-Reranker fusing Reciprocal Rank Fusion (RRF) with exact query term overlap and vector cosine similarity
* **LLM Engine**: NVIDIA's OpenAI-compatible endpoint, configured through `NVIDIA_API_KEY` and optional `NVIDIA_MODEL`. Verify availability/limits with the configured service; do not assume unlimited free inference.
* **Frontend Markdown & Math**: `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `katex`
* **Frontend typography**: Manrope (Google Fonts, weights 400–800), loaded once in the frontend layout with `display=swap` and system sans-serif fallbacks. Do not duplicate the font request with a CSS `@import`.

### Landing-page design (updated 2026-10-08)

* Shared colors, navigation, buttons, and focus styles live in `src/app/(frontend)/theme.css`, scoped to `.parsea-theme`: warm ivory, white, muted periwinkle, and deep-blue accents. Landing, chat, notes, login, and signup use this theme; page-specific layout stays in their own stylesheets.
* The main white hero card uses a thin deep-blue border and restrained shadow for separation from the grid. The navbar is a floating white panel with a matching deep-blue border and a centered navigation tray. On mobile, its logged-out account action is the same muted light-blue “Get started” signup button as desktop, instead of the “Sign in” text link.
* `src/components/AmbientGrid.tsx` renders a decorative 56px grid with darker muted lines. Mouse hover and touch/pen contact light cells with a short fade; passive window listeners do not cancel scrolling or clicks. Reduced-motion users receive a static grid. Animation runs only while cells are fading and cleans up listeners and frames.
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

* Chat request-time embeddings no longer directly import native ONNX, but the current SHA-derived deterministic vectors are not semantic embeddings and are incompatible with existing MiniLM vectors. Matching dimensions alone does not preserve retrieval correctness. A proper same-model inference path and cache/index migration are still needed; production function-size compliance has not been verified.

### PDF answers and touch navigation (2026-10-09)

* Circle selection now offers explicit Explain/practice actions inside the PDF reader, calling the existing `trpc.chat.ask` mutation and canonical `askRAG`. The selected, editable excerpt and page/title travel in the question; no new LLM, embeddings, storage, or binary proxy implementation was introduced. Reading/selecting alone never sends an AI request.
* Inline answers render Markdown/math, loading and retryable error states, and additional sources only when returned by retrieval. Changing the excerpt/page/reader invalidates stale answers. Open in Study chat still transfers a local, editable draft without auto-submission.
* Draw/Scroll controls support touch readers; finishing a touch/pen selection releases the drawing overlay so scrolling resumes. Text-layer selection is supported; scanned images and diagram regions do not have region OCR in this tool. R2 browser CORS remains required for PDF.js, with the standard reader available on failure.
* Chat has a compact, labelled Minimise/Show navigation toolbar control on all devices, separate from Focus. Hidden navigation is removed from keyboard/accessibility traversal. History remains available from the toolbar, including while navigation is hidden.
* Navbar Get started hover explicitly retains a light muted background and contrasting deep-blue text; its scoped hover selector takes precedence over generic primary-button hover styles.
* Known pre-existing retrieval limitation: the ONNX hotfix currently produces SHA-derived pseudo-random vectors, not semantic MiniLM embeddings. These are incompatible with old model vectors and do not preserve semantic search. This interaction change does not repair that pipeline or verify production answer quality.
* Verification: isolated component tests cover inline PDF request/draft/error/stale-result handling, grid mouse/touch/pen and reduced motion, and navigation hide/restore. No live browser or production end-to-end verification is claimed.

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
* Embeddings cache key format: `emb:minilm-l6-v2-q8-v1:<hash>` (TTL: 7 days).
* RAG answer cache: `rag:v4:<hash>`, including model, question, filters, conversation context, and recent history (TTL: 24 hours).

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
