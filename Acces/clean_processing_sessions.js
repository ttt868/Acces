
/**
 * This script cleans up stale processing sessions to fix the 
 * "User already has an active processing session" error
 */

const { Pool } = require('pg');
require('dotenv').config({ path: './RealisticHonorableDeskscan/.env' });

// Create a connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function cleanupStaleMininingSessions() {
  const client = await pool.connect();

  try {
    console.log("Starting cleanup of stale processing sessions...");

    // Get all users with active processing sessions
    const sessionResult = await client.query(
      'SELECT id, processing_active, processing_start_time, processing_end_time FROM users WHERE processing_active = 1 OR processingactive = 1 OR is_active = 1'
    );

    console.log(`Found ${sessionResult.rows.length} active processing sessions to check`);

    // Also check users table for inconsistencies
    const usersWithActiveProcessing = await client.query(
      'SELECT id, processing_active, processingactive, is_active, processing_end_time, processing_start_time FROM users WHERE processing_active = 1 OR processingactive = 1 OR is_active = 1'
    );

    console.log(`Found ${usersWithActiveProcessing.rows.length} users with active processing flags`);

    // Current server time in milliseconds
    const now = Date.now();
    let cleanedCount = 0;

    // Check each active session
    for (const session of usersWithActiveProcessing.rows) {
      const sessionEndTime = parseInt(session.processing_end_time);

      // If end time has passed or end time is invalid, reset processing state
      if (!sessionEndTime || sessionEndTime <= now) {
        console.log(`Cleaning stale session for user ${session.id} - end time: ${new Date(sessionEndTime).toISOString()}`);
        
        await client.query(
          `UPDATE users 
           SET processing_active = 0, 
               processingactive = 0, 
               is_active = 0,
               processing_remaining_seconds = 0
           WHERE id = $1`,
          [session.id]
        );
        
        cleanedCount++;
      }
    }
    
    // Clean up orphaned processing history entries
    const orphanedHistoryCleanup = await client.query(
      `DELETE FROM processing_history 
       WHERE amount = 0 
       AND (user_name = 'Processing Started' OR user_name = 'Collecting...')
       AND timestamp < $1
       RETURNING id`,
      [now - (24 * 60 * 60 * 1000)] // Older than 24 hours
    );
    
    console.log(`Cleaned ${cleanedCount} stale processing sessions`);
    console.log(`Removed ${orphanedHistoryCleanup.rows.length} orphaned processing history entries`);

    return {
      success: true,
      cleaned_sessions: cleanedCount,
      cleaned_history: orphanedHistoryCleanup.rows.length
    };
  } catch (error) {
    console.error("Error during cleanup:", error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    client.release();
  }
}

// Execute the cleanup
cleanupStaleMininingSessions().then(result => {
  console.log("Cleanup result:", result);
  process.exit(0);
}).catch(err => {
  console.error("Unhandled error in cleanup script:", err);
  process.exit(1);
});