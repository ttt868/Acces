
import { pool } from './db.js';

async function createProtectionTables() {
  try {
    console.log('Creating reward protection tables...');
    
    // Create reward transfers table for audit trail
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reward_transfers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        old_balance NUMERIC(20,8) NOT NULL,
        reward_amount NUMERIC(20,8) NOT NULL,
        new_balance NUMERIC(20,8) NOT NULL,
        transfer_timestamp BIGINT NOT NULL,
        session_data JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create emergency rewards table for failed transfers
    await pool.query(`
      CREATE TABLE IF NOT EXISTS emergency_rewards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        reward_amount NUMERIC(20,8) NOT NULL,
        session_data JSONB,
        error_details TEXT,
        created_at BIGINT NOT NULL,
        status VARCHAR(20) DEFAULT 'PENDING',
        recovered_at BIGINT,
        recovered_by VARCHAR(100)
      )
    `);
    
    // Add transfer_id column to processing_history for linking
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'processing_history' AND column_name = 'transfer_id'
        ) THEN
          ALTER TABLE processing_history ADD COLUMN transfer_id INTEGER REFERENCES reward_transfers(id);
        END IF;
      END$$;
    `);
    
    // Add last_successful_transfer column to users
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'last_successful_transfer'
        ) THEN
          ALTER TABLE users ADD COLUMN last_successful_transfer BIGINT;
        END IF;
      END$$;
    `);
    
    // Create indexes for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_reward_transfers_user_id ON reward_transfers(user_id);
      CREATE INDEX IF NOT EXISTS idx_reward_transfers_timestamp ON reward_transfers(transfer_timestamp);
      CREATE INDEX IF NOT EXISTS idx_emergency_rewards_user_id ON emergency_rewards(user_id);
      CREATE INDEX IF NOT EXISTS idx_emergency_rewards_status ON emergency_rewards(status);
    `);
    
    console.log('Reward protection tables created successfully');
    
  } catch (error) {
    console.error('Error creating protection tables:', error);
    throw error;
  }
}

// Run the creation
createProtectionTables().catch(console.error);
