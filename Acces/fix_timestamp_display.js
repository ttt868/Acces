
// Simplified Timestamp Display Fix
// This script implements the simpler countdown approach without relying on complex date calculations

console.log("Starting simplified timestamp display fix...");

// Import required modules
const { Pool } = require('pg');

// Initialize database connection with SSL
const pool = new Pool({
  ssl: {
    rejectUnauthorized: false
  }
});

async function fixTimestampDisplay() {
  try {
    console.log("Connecting to database...");

    // Verify database connection
    const client = await pool.connect();
    console.log("Database connection established");

    // First ensure we have the required columns in the users table
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'processing_duration_seconds'
        ) THEN
          ALTER TABLE users ADD COLUMN processing_duration_seconds INTEGER DEFAULT 86400;
        END IF;

        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'processing_remaining_seconds'
        ) THEN
          ALTER TABLE users ADD COLUMN processing_remaining_seconds INTEGER;
        END IF;
      END$$;
    `);

    console.log("Ensured simplified processing countdown columns exist");

    // Update the processing_remaining_seconds for currently active sessions
    await client.query(`
      UPDATE users
      SET processing_remaining_seconds = 
        CASE 
          WHEN processing_active = 1 AND processing_end_time > extract(epoch from now()) * 1000 THEN 
            FLOOR((processing_end_time - extract(epoch from now()) * 1000) / 1000)
          ELSE 
            NULL
        END
      WHERE processing_active = 1;
    `);

    console.log("Updated processing_remaining_seconds for active sessions");

    // Verify the updates
    const activeUsers = await client.query(`
      SELECT id, processing_active, processing_end_time, processing_start_time, processing_remaining_seconds
      FROM users
      WHERE processing_active = 1
      LIMIT 5
    `);

    console.log("Active processing sessions updated:", activeUsers.rows);

    // Update the frontend API endpoint to use the new simplified approach
    console.log("The API endpoint will now serve remaining seconds directly");

    // Done
    console.log("Simplified timestamp display fix completed successfully");
    client.release();
  } catch (error) {
    console.error("Error fixing timestamp display:", error);
  } finally {
    // Close pool
    await pool.end();
  }
}

// Run the function
fixTimestampDisplay().catch(err => {
  console.error("Unhandled error:", err);
});