
import pkg from 'pg';
const { Pool } = pkg;
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function createApiKeysTable() {
  try {
    console.log('Creating API keys tables...');

    // Create explorer_users table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS explorer_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        avatar TEXT,
        google_id VARCHAR(255),
        created_at BIGINT NOT NULL,
        last_login BIGINT
      )
    `);

    // Create explorer_sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS explorer_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES explorer_users(id) ON DELETE CASCADE,
        token VARCHAR(255) UNIQUE NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        is_active BOOLEAN DEFAULT true
      )
    `);

    // ✅ إضافة عمود explorer_user_id إلى explorer_api_keys
    await pool.query(`
      CREATE TABLE IF NOT EXISTS explorer_api_keys (
        id SERIAL PRIMARY KEY,
        explorer_user_id INTEGER REFERENCES explorer_users(id) ON DELETE CASCADE,
        api_key VARCHAR(64) UNIQUE NOT NULL,
        key_name VARCHAR(255),
        rate_limit INTEGER DEFAULT 100,
        requests_used INTEGER DEFAULT 0,
        requests_reset_at BIGINT,
        is_active BOOLEAN DEFAULT true,
        created_at BIGINT NOT NULL,
        last_used_at BIGINT
      )
    `);

    // ✅ إضافة عمود explorer_user_id إلى explorer_api_tokens
    await pool.query(`
      CREATE TABLE IF NOT EXISTS explorer_api_tokens (
        id SERIAL PRIMARY KEY,
        explorer_user_id INTEGER REFERENCES explorer_users(id) ON DELETE CASCADE,
        token VARCHAR(128) UNIQUE NOT NULL,
        token_name VARCHAR(255),
        created_at BIGINT NOT NULL,
        last_used BIGINT,
        is_active BOOLEAN DEFAULT true,
        usage_count INTEGER DEFAULT 0
      )
    `);

    // 🗑️ حذف الجدول المكرر api_keys إن وجد
    await pool.query(`DROP TABLE IF EXISTS api_keys CASCADE`);
    console.log('🗑️ Removed duplicate api_keys table');

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_explorer_api_keys_user_id ON explorer_api_keys(explorer_user_id);
      CREATE INDEX IF NOT EXISTS idx_explorer_api_keys_api_key ON explorer_api_keys(api_key);
      CREATE INDEX IF NOT EXISTS idx_explorer_api_tokens_user_id ON explorer_api_tokens(explorer_user_id);
      CREATE INDEX IF NOT EXISTS idx_explorer_api_tokens_token ON explorer_api_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_explorer_sessions_token ON explorer_sessions(token);
      CREATE INDEX IF NOT EXISTS idx_explorer_sessions_user_id ON explorer_sessions(user_id);
    `);

    console.log('✅ API Keys tables created successfully');
    console.log('✅ Using explorer_user_id for proper user references');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating API Keys tables:', error);
    process.exit(1);
  }
}

createApiKeysTable();
