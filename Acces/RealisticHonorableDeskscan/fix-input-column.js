
import { pool } from './db.js';

async function fixInputColumn() {
  try {
    console.log('🔧 Adding input column to transactions table...');
    
    await pool.query(`
      ALTER TABLE transactions 
      ADD COLUMN IF NOT EXISTS input TEXT
    `);
    
    console.log('✅ Successfully added input column');
    
    // Verify it was added
    const result = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'transactions' AND column_name = 'input'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ Verified: input column exists');
    } else {
      console.log('❌ ERROR: input column still missing');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixInputColumn();
