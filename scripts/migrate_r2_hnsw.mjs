import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: './.env' });

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  try {
    console.log('1. Adding storage_key and r2_bucket to documents table...');
    await pool.query(`
      ALTER TABLE documents 
      ADD COLUMN IF NOT EXISTS storage_key text,
      ADD COLUMN IF NOT EXISTS r2_bucket text;
    `);

    console.log('2. Updating document 2 with R2 storage key and bucket...');
    await pool.query(`
      UPDATE documents 
      SET 
        storage_key = 'documents/comps/sem3/discrete-mathematics/module-5.pdf',
        r2_bucket = 'stondemporium-media'
      WHERE id = 2;
    `);

    console.log('3. Creating HNSW index on chunks.embedding with vector_cosine_ops...');
    // Drop ivfflat index if exists or create hnsw
    await pool.query(`
      CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
      ON chunks
      USING hnsw (embedding vector_cosine_ops);
    `);

    console.log('4. Checking documents schema...');
    const docCols = await pool.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'documents'
    `);
    console.log('Document columns:', docCols.rows.map(r => r.column_name));

    console.log('5. Checking chunk indexes...');
    const idxRes = await pool.query(`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'chunks';
    `);
    console.log('Chunks indexes:', idxRes.rows.map(r => ({ name: r.indexname, def: r.indexdef })));

    console.log('Migration complete!');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await pool.end();
  }
}

migrate();
