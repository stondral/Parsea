import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'
import { sql } from '@payloadcms/db-postgres'

// New collections must also exist in Payload's polymorphic lock relationship.
// Idempotent so this repair can run on a database with partially applied schema.
export async function up({ payload }: MigrateUpArgs): Promise<void> {
  await payload.db.drizzle.execute(sql`
    ALTER TABLE "payload_locked_documents_rels"
      ADD COLUMN IF NOT EXISTS "modules_id" integer,
      ADD COLUMN IF NOT EXISTS "topics_id" integer,
      ADD COLUMN IF NOT EXISTS "conversations_id" integer;
    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_modules_id_idx"
      ON "payload_locked_documents_rels" ("modules_id");
    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_topics_id_idx"
      ON "payload_locked_documents_rels" ("topics_id");
    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_conversations_id_idx"
      ON "payload_locked_documents_rels" ("conversations_id");
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payload_locked_documents_rels_modules_fk') THEN
        ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_modules_fk"
          FOREIGN KEY ("modules_id") REFERENCES "modules" ("id") ON DELETE cascade;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payload_locked_documents_rels_conversations_fk') THEN
        ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_conversations_fk"
          FOREIGN KEY ("conversations_id") REFERENCES "conversations" ("id") ON DELETE cascade;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payload_locked_documents_rels_topics_fk') THEN
        ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_topics_fk"
          FOREIGN KEY ("topics_id") REFERENCES "topics" ("id") ON DELETE cascade;
      END IF;
    END $$;
  `)
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  await payload.db.drizzle.execute(sql`
    ALTER TABLE "payload_locked_documents_rels"
      DROP COLUMN IF EXISTS "conversations_id", DROP COLUMN IF EXISTS "topics_id", DROP COLUMN IF EXISTS "modules_id";
  `)
}
