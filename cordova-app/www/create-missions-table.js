// Create user_missions table for Daily Missions system
import { pool } from './db.js';

async function createMissionsTable() {
  try {
    console.log('Creating user_missions table...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_missions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        streak INTEGER DEFAULT 0,
        last_claim_date TIMESTAMP,
        daily_claimed BOOLEAN DEFAULT FALSE,
        completed_missions JSONB DEFAULT '{}',
        bonus_claimed BOOLEAN DEFAULT FALSE,
        social_verification JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )
    `);
    
    console.log('✅ user_missions table created successfully!');
    
    // Create index for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_missions_user_id ON user_missions(user_id)
    `);
    
    console.log('✅ Index created successfully!');
    
    process.exit(0);
  } catch (error) {
    console.error('Error creating table:', error.message);
    process.exit(1);
  }
}

createMissionsTable();
