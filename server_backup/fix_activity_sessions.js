
/**
 * This script cleans up stale processing sessions that might be causing 
 * "User already has an active processing session" errors
 */

import { pool } from './db.js';

async function cleanupStaleProcessing() {
  try {
    console.log('Starting processing session cleanup...');
    
    // Get a client from the pool
    const client = await pool.connect();
    
    try {
      // First check if all required tables and columns exist
      await client.query(`
        DO $$
        BEGIN
          -- Create processing_sessions table if it doesn't exist
          IF NOT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'processing_sessions'
          ) THEN
            CREATE TABLE processing_sessions (
              user_id INTEGER PRIMARY KEY,
              duration INTEGER DEFAULT 86400,
              remaining INTEGER,
              is_active BOOLEAN DEFAULT TRUE,
              start_time BIGINT,
              last_updated BIGINT
            );
          END IF;
        END$$;
      `);
      
      // Find all active processing sessions
      const sessionResult = await client.query(
        'SELECT user_id, start_time, last_updated, remaining FROM processing_sessions WHERE is_active = TRUE'
      );
      
      console.log(`Found ${sessionResult.rows.length} active processing sessions to check`);
      
      // Current server time in seconds
      const now = Math.floor(Date.now() / 1000);
      let cleanedCount = 0;
      
      // Check each active session
      for (const session of sessionResult.rows) {
        // Calculate time elapsed since last update
        const lastUpdateTime = session.last_updated || session.start_time;
        const elapsedSeconds = now - lastUpdateTime;
        
        // Calculate remaining time
        const remainingSeconds = Math.max(0, session.remaining - elapsedSeconds);
        
        // If no time remaining or stale (over 24 hours old), mark inactive
        if (remainingSeconds <= 0 || elapsedSeconds > 86400) {
          console.log(`Cleaning up stale processing session for user ${session.user_id}`);
          
          await client.query(`
            UPDATE processing_sessions 
            SET is_active = FALSE, remaining = 0 
            WHERE user_id = $1
          `, [session.user_id]);
          
          // Also update the processing_active flag in users table
          await client.query(`
            UPDATE users 
            SET processing_active = 0, processing_remaining_seconds = 0 
            WHERE id = $1
          `, [session.user_id]);
          
          cleanedCount++;
        }
      }
      
      console.log(`Cleaned up ${cleanedCount} stale processing sessions`);
      console.log('Processing session cleanup completed successfully');
      
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error cleaning up processing sessions:', error);
  } finally {
    // Close the pool
    await pool.end();
  }
}

// Execute the cleanup
cleanupStaleProcessing().then(() => {
  console.log('Cleanup script finished executing');
  process.exit(0);
}).catch(err => {
  console.error('Unhandled error in cleanup script:', err);
  process.exit(1);
});
