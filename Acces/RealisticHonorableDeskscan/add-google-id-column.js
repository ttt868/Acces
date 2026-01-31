/**
 * Add google_id column to users table
 * Run this script to fix Google Sign-In
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function addGoogleIdColumn() {
  try {
    console.log('🔧 Adding google_id column to users table...');
    
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'google_id'
        ) THEN
          ALTER TABLE users ADD COLUMN google_id TEXT;
          RAISE NOTICE 'Column google_id added to users table';
        ELSE
          RAISE NOTICE 'Column google_id already exists';
        END IF;
      END$$;
    `);
    
    // Create index for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    `);
    
    console.log('✅ google_id column added successfully!');
    
    // Verify
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'google_id'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ Verified: google_id column exists');
      console.log(result.rows[0]);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

addGoogleIdColumn();
