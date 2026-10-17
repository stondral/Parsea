# Vercel-only ingestion setup

The browser uploads directly to R2 and processes checkpointed page batches immediately. A cron invocation is a backup for queued work left behind after a tab closes; it is not an instant background service.

1. Deploy with the Vercel project Root Directory set to `parsea` if your repository root is the parent folder.
2. Apply Payload migrations, including `20261015_000000_resumable_ingestion` and `20261015_010000_page_orientation`, against the same database used by Vercel. The configured local database has already received the additive schema through the maintenance script.
3. In Vercel Project Settings → Environment Variables, add `CRON_SECRET` as a random secret of at least 32 characters for Production. Do not commit it or expose it through a `NEXT_PUBLIC_` variable.
4. Merge the `crons` array from the appropriate example into the project's `vercel.json` (inside the configured root directory). Preserve any existing configuration:
   - Hobby: `vercel-cron.hobby.example.json`, one daily backup invocation at 03:00 UTC (08:30 India time, with platform timing variation).
   - A plan supporting frequent cron: `vercel-cron.frequent.example.json`, one invocation every five minutes.
5. Redeploy. Vercel supplies `Authorization: Bearer <CRON_SECRET>` to the configured endpoint. `/api/ingestion/run` rejects unauthenticated requests and processes at most one page batch per invocation.
6. Open Settings → Cron Jobs, trigger a run, and check runtime logs plus `/administrator` → Materials → Recent uploads. A missing secret returns 503; an incorrect secret returns 401.

To generate a suitable secret on your computer, run `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and paste the output directly into the Vercel environment variable. Keep it out of screenshots, chat and source files. Environment/configuration changes require a new production deployment; uploading PDFs does not activate cron automatically.

Hobby cron is limited to once daily. A scanned PDF may need many checkpoint batches, so daily cron alone is **not** a timely unattended pipeline. On Hobby, keep the upload window open until indexing completes, or manually resume from recent uploads. Frequent unattended processing requires a Vercel plan with frequent cron support; no plan upgrade or external service has been created.

Official references: [Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Cron authentication and management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

The R2 CORS policy was applied with the existing S3 credentials. Production PUT preflight was verified as 204 with the correct allowed origin. Preserve existing bucket rules when adding any future preview domains; do not allow arbitrary origins.

Durability: completed page text and preview keys persist outside the final document transaction. Retries reuse them; lease tokens fence stale workers at publication. The old published PDF/index remains intact until all new pages, vectors, and cloud metadata commit. Incoming-file SHA-256 is verified server-side; equivalent content in the same owner's course folder/material type reuses an already compatible index. These safeguards do not claim perfect OCR or unlimited serverless runtime. PDFs remain bounded to 25 MB and 150 pages.

Migration rollback intentionally refuses to discard resumable upload state automatically. Review queued work and preserve checkpoints before any manual rollback.

OCR coverage: diagram-only/low-confidence pages can be retained visually while other readable pages are indexed. Ready-job stage text reports the number of pages without searchable text. Such pages are not represented by invented OCR or semantic vectors; local OCR is not diagram interpretation. A wholly unreadable PDF still fails instead of reporting a usable index.

Orientation: re-index existing PDFs from `/administrator` to regenerate upright source screenshots and publish per-page reader corrections. This uses durable replacement jobs and preserves original PDF bytes/IDs. The corrected PDF.js reader opens when current metadata exists, with manual rotate/reset controls for uncertain pages. Standard reader/download still uses the unchanged original; app rotation is not a rewritten PDF. Old-version checkpoints/previews are not reused. Re-index jobs can be resumed from Recent uploads after an interrupted connection.
