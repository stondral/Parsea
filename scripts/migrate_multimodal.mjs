import dotenv from 'dotenv';
import fs from 'fs';
import pg from 'pg';
import { PDFParse } from 'pdf-parse';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

dotenv.config({ path: './.env' });

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET || 'stondemporium-media';

async function main() {
  try {
    console.log('1. Altering chunks table to add multimodal image columns...');
    await pool.query(`
      ALTER TABLE chunks 
      ADD COLUMN IF NOT EXISTS has_image boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS image_url text,
      ADD COLUMN IF NOT EXISTS image_caption text;
    `);
    console.log('Columns added successfully!');

    console.log('2. Parsing Module 5.pdf for visual diagram extraction...');
    const buffer = fs.readFileSync('./media/documents/Module 5.pdf');
    const parser = new PDFParse(new Uint8Array(buffer));
    await parser.load();

    const imgRes = await parser.getImage();
    const pagesWithImages = new Set(
      imgRes.pages.filter(p => p.images && p.images.length > 0).map(p => p.pageNumber)
    );
    // Explicitly include important illustrative slides like page 37
    pagesWithImages.add(37);
    pagesWithImages.add(38);
    pagesWithImages.add(39);

    console.log(`Found ${pagesWithImages.size} pages with diagrams/figures. Extracting and uploading screenshots to R2...`);

    for (const pageNum of Array.from(pagesWithImages).sort((a, b) => a - b)) {
      try {
        const shotRes = await parser.getScreenshot({ pageNumber: pageNum });
        const pageData = shotRes.pages.find(p => p.pageNumber === pageNum);

        if (pageData && pageData.data) {
          const r2Key = `documents/comps/sem3/discrete-mathematics/media/page_${pageNum}.png`;
          console.log(`  Uploading Page ${pageNum} diagram -> R2: ${r2Key}...`);

          await r2Client.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: r2Key,
            Body: Buffer.from(pageData.data),
            ContentType: 'image/png',
          }));

          const caption = `Diagram & Visual Slide (Page ${pageNum})`;

          // Update chunks for this document and page
          await pool.query(`
            UPDATE chunks 
            SET 
              has_image = true,
              image_url = $1,
              image_caption = $2
            WHERE document_id = 2 AND page_number = $3;
          `, [r2Key, caption, pageNum]);

          console.log(`  Updated chunks for page ${pageNum} with R2 image`);
        }
      } catch (pageErr) {
        console.warn(`  Failed for page ${pageNum}:`, pageErr.message);
      }
    }

    await parser.destroy();

    // Verify updated chunks
    const countRes = await pool.query('SELECT count(*) FROM chunks WHERE has_image = true');
    console.log(`Total chunks with image diagrams linked: ${countRes.rows[0].count}`);

    console.log('Migration & Image Extraction Complete!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
