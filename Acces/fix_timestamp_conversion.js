
// Comprehensive Timestamp Conversion Fix
// This script ensures all timestamps in the database are properly stored and interpreted

console.log("Starting comprehensive timestamp fix...");

// Import required modules
const { Pool } = require('pg');

// Initialize database connection with SSL
const pool = new Pool({
  ssl: {
    rejectUnauthorized: false
  }
});

async function fixTimestampConversions() {
  try {
    console.log("Connecting to database...");

    // Verify database connection
    const client = await pool.connect();
    console.log("Database connection established");

    // Check for all time-related columns in the users table
    const timeColumns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND (column_name LIKE '%time%' OR column_name LIKE '%date%')
    `);

    console.log("Time-related columns:", timeColumns.rows);

    // Fix timestamps that should be in milliseconds but are in seconds
    // This ensures all our timestamps are consistently stored in milliseconds
    const columnsToFix = [
      'processing_start_time', 
      'processing_end_time', 
      'privacy_accepted_date', 
      'verification_date', 
      'qrcode_timestamp',
      'wallet_created_at',
      'last_payout',
      'last_processing_accumulation'
    ];

    // Start a transaction for consistent updates
    await client.query('BEGIN');

    try {
      // Fix each column that needs conversion
      for (const column of columnsToFix) {
        console.log(`Checking and fixing ${column}...`);
        
        await client.query(`
          UPDATE users 
          SET ${column} = ${column} * 1000 
          WHERE ${column} < 2000000000 AND ${column} > 0
        `);

        console.log(`Fixed ${column} timestamps`);
      }

      // Create or update the processing_start_time_seconds column for proper second-based storage
      console.log("Ensuring processing_start_time_seconds is updated...");

      // First make sure the column exists
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_start_time_seconds'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_start_time_seconds BIGINT;
          END IF;
        END$$;
      `);

      // Make sure we're properly setting processing_start_time_seconds from processing_start_time
      await client.query(`
        UPDATE users 
        SET processing_start_time_seconds = FLOOR(processing_start_time / 1000)
        WHERE processing_start_time IS NOT NULL 
          AND processing_start_time > 0 
          AND (processing_start_time_seconds IS NULL OR processing_start_time_seconds = 0);
      `);

      console.log("Updated processing_start_time_seconds values");

      // Fix transactions table timestamps
      console.log("Fixing transaction timestamps...");
      await client.query(`
        UPDATE transactions 
        SET timestamp = timestamp * 1000 
        WHERE timestamp < 2000000000 AND timestamp > 0
      `);
      
      // Fix processing_history table timestamps
      console.log("Fixing processing history timestamps...");
      await client.query(`
        UPDATE processing_history 
        SET timestamp = timestamp * 1000 
        WHERE timestamp < 2000000000 AND timestamp > 0
      `);

      // Commit transaction
      await client.query('COMMIT');
      console.log("All timestamp fixes committed to the database");
    } catch (error) {
      await client.query('ROLLBACK');
      console.error("Error during timestamp fixes, transaction rolled back:", error);
      throw error;
    }

    // Print current server time for verification
    const serverTime = new Date();
    const serverTimeUnix = Date.now();
    console.log("Current server time:", serverTime.toISOString());
    console.log("Current server timestamp (ms):", serverTimeUnix);
    console.log("Current server timestamp (s):", Math.floor(serverTimeUnix / 1000));

    console.log("Timestamp conversion fixes completed successfully");
    client.release();
  } catch (error) {
    console.error("Error fixing timestamps:", error);
  } finally {
    // Close pool
    await pool.end();
  }
}

// Run the function
fixTimestampConversions().catch(err => {
  console.error("Unhandled error:", err);
});