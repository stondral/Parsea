import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'
import { sql } from '@payloadcms/db-postgres'

export async function up({ payload }: MigrateUpArgs): Promise<void> {
  await payload.db.drizzle.execute(sql`
    CREATE TABLE IF NOT EXISTS "modules" (
      "id" serial PRIMARY KEY NOT NULL,
      "number" varchar NOT NULL,
      "name" varchar NOT NULL,
      "subject_id" integer NOT NULL,
      "updated_at" timestamp(3) with time zone NOT NULL DEFAULT now(),
      "created_at" timestamp(3) with time zone NOT NULL DEFAULT now()
    );
  `)
  await payload.db.drizzle.execute(sql`
    CREATE TABLE IF NOT EXISTS "topics" (
      "id" serial PRIMARY KEY NOT NULL,
      "number" varchar NOT NULL,
      "name" varchar NOT NULL,
      "module_id" integer NOT NULL,
      "updated_at" timestamp(3) with time zone NOT NULL DEFAULT now(),
      "created_at" timestamp(3) with time zone NOT NULL DEFAULT now()
    );
  `)
  await payload.db.drizzle.execute(sql`
    ALTER TABLE "modules" ADD CONSTRAINT "modules_subject_id_subjects_id_fk"
      FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;
  `).catch(() => undefined)
  await payload.db.drizzle.execute(sql`
    ALTER TABLE "topics" ADD CONSTRAINT "topics_module_id_modules_id_fk"
      FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;
  `).catch(() => undefined)
  await payload.db.drizzle.execute(sql`ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "module_id" integer;`)
  await payload.db.drizzle.execute(sql`ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "topic_id" integer;`)
  await payload.db.drizzle.execute(sql`
    ALTER TABLE "documents" ADD CONSTRAINT "documents_module_id_modules_id_fk"
      FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE set null ON UPDATE no action;
  `).catch(() => undefined)
  await payload.db.drizzle.execute(sql`
    ALTER TABLE "documents" ADD CONSTRAINT "documents_topic_id_topics_id_fk"
      FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;
  `).catch(() => undefined)
  await payload.db.drizzle.execute(sql`ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "module_name" varchar;`)
  await payload.db.drizzle.execute(sql`ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "module_number" varchar;`)
  await payload.db.drizzle.execute(sql`ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "topic_name" varchar;`)
  await payload.db.drizzle.execute(sql`ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "topic_number" varchar;`)
  await payload.db.drizzle.execute(sql`CREATE INDEX IF NOT EXISTS "modules_subject_idx" ON "modules" USING btree ("subject_id");`)
  await payload.db.drizzle.execute(sql`CREATE INDEX IF NOT EXISTS "topics_module_idx" ON "topics" USING btree ("module_id");`)
  await payload.db.drizzle.execute(sql`CREATE INDEX IF NOT EXISTS "documents_module_idx" ON "documents" USING btree ("module_id");`)
  await payload.db.drizzle.execute(sql`CREATE INDEX IF NOT EXISTS "documents_topic_idx" ON "documents" USING btree ("topic_id");`)
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  await payload.db.drizzle.execute(sql`ALTER TABLE "chunks" DROP COLUMN IF EXISTS "topic_number";`)
  await payload.db.drizzle.execute(sql`ALTER TABLE "chunks" DROP COLUMN IF EXISTS "topic_name";`)
  await payload.db.drizzle.execute(sql`ALTER TABLE "chunks" DROP COLUMN IF EXISTS "module_number";`)
  await payload.db.drizzle.execute(sql`ALTER TABLE "chunks" DROP COLUMN IF EXISTS "module_name";`)
  await payload.db.drizzle.execute(sql`ALTER TABLE "documents" DROP COLUMN IF EXISTS "topic_id";`)
  await payload.db.drizzle.execute(sql`ALTER TABLE "documents" DROP COLUMN IF EXISTS "module_id";`)
  await payload.db.drizzle.execute(sql`DROP TABLE IF EXISTS "topics";`)
  await payload.db.drizzle.execute(sql`DROP TABLE IF EXISTS "modules";`)
}
