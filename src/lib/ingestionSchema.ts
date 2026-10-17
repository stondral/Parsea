/** Idempotent migration shared by Payload migrations and the maintenance CLI. */
export const ingestionSchemaSQL = `
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding_model varchar;
CREATE INDEX IF NOT EXISTS chunks_embedding_model_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding_model = 'minilm-l6-v2-q8-v1' AND embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS chunks_fts_idx ON chunks USING GIN (to_tsvector('english', text));
CREATE INDEX IF NOT EXISTS chunks_course_lookup ON chunks (lower(subject_name), semester, lower(branch));
CREATE TABLE IF NOT EXISTS document_upload_jobs (
  id uuid PRIMARY KEY, owner_id integer NOT NULL REFERENCES users(id),
  storage_key text NOT NULL UNIQUE, filename text NOT NULL, bytes integer NOT NULL,
  metadata jsonb NOT NULL, status varchar NOT NULL DEFAULT 'uploading',
  progress integer NOT NULL DEFAULT 0, stage text NOT NULL DEFAULT 'Waiting for PDF', error text,
  document_id integer REFERENCES documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_upload_jobs_status ON document_upload_jobs(status, updated_at);
`

export const ingestionResumeSchemaSQL = `
ALTER TABLE document_upload_jobs ADD COLUMN IF NOT EXISTS content_hash varchar(64);
ALTER TABLE document_upload_jobs ADD COLUMN IF NOT EXISTS dedup_key varchar(64);
ALTER TABLE document_upload_jobs ADD COLUMN IF NOT EXISTS lease_token uuid;
CREATE INDEX IF NOT EXISTS document_upload_jobs_dedup ON document_upload_jobs(dedup_key) WHERE dedup_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS document_upload_pages (
  job_id uuid NOT NULL REFERENCES document_upload_jobs(id) ON DELETE CASCADE,
  page_number integer NOT NULL, text text NOT NULL, ocr boolean NOT NULL,
  preview_key text, PRIMARY KEY(job_id, page_number)
);
`

export const pageOrientationSchemaSQL = `
ALTER TABLE document_upload_pages ADD COLUMN IF NOT EXISTS orientation_rotation integer NOT NULL DEFAULT 0;
ALTER TABLE document_upload_pages ADD COLUMN IF NOT EXISTS orientation_confidence double precision NOT NULL DEFAULT 0;
ALTER TABLE document_upload_pages ADD COLUMN IF NOT EXISTS orientation_verified boolean NOT NULL DEFAULT false;
ALTER TABLE document_upload_pages ADD COLUMN IF NOT EXISTS orientation_version integer NOT NULL DEFAULT 0;
ALTER TABLE document_pages ADD COLUMN IF NOT EXISTS orientation_rotation numeric DEFAULT 0;
ALTER TABLE document_pages ADD COLUMN IF NOT EXISTS orientation_confidence numeric DEFAULT 0;
ALTER TABLE document_pages ADD COLUMN IF NOT EXISTS orientation_verified boolean DEFAULT false;
ALTER TABLE document_pages ADD COLUMN IF NOT EXISTS orientation_version numeric DEFAULT 0;
ALTER TABLE document_pages ADD COLUMN IF NOT EXISTS preview_key varchar;
`
