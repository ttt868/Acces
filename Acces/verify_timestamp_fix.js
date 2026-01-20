
// Timestamp Verification Script
// This script ensures all timestamps are in the correct format across the database

console.log("Starting timestamp verification...");

// Import required modules
const { Pool } = require('pg');

// Initialize database connection with SSL
const pool = new Pool({
  ssl: {
    rejectUnauthorized: false
  }
});

async function verifyTimestamps() {
  try {
    console.log("Connecting to database...");

    // Verify database connection
    const client = await pool.connect();
    console.log("Database connection established");

    // Check for time-related columns
    const timeColumns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND (column_name LIKE '%time%' OR column_name LIKE '%date%')
    `);

    console.log("Time-related columns:", timeColumns.rows);

    // Verify timestamp formats
    const result = await client.query(`
      SELECT id, processing_start_time, processing_end_time, processing_start_time_seconds
      FROM users 
      WHERE processing_start_time > 0 OR processing_start_time_seconds > 0
      LIMIT 5
    `);

    if (result.rows.length > 0) {
      // Check each user's timestamps
      result.rows.forEach(row => {
        const msTime = parseInt(row.processing_start_time);
        const secTime = parseInt(row.processing_start_time_seconds);
        
        console.log(`User ID ${row.id} timestamps:`);
        console.log(`  processing_start_time (ms): ${msTime} -> ${new Date(msTime).toISOString()}`);
        console.log(`  processing_start_time_seconds (s): ${secTime} -> ${new Date(secTime * 1000).toISOString()}`);
        console.log(`  processing_end_time (ms): ${row.processing_end_time} -> ${new Date(parseInt(row.processing_end_time)).toISOString()}`);
        
        // Check if timestamps are in the correct range (milliseconds should be ~1000x larger than seconds)
        if (msTime > 0 && secTime > 0) {
          const ratio = msTime / secTime;
          console.log(`  Ratio of ms/s timestamps: ${ratio.toFixed(2)} (should be close to 1000)`);
          
          if (ratio < 900 || ratio > 1100) {
            console.log(`  WARNING: Timestamp ratio is outside expected range (900-1100)`);
          } else {
            console.log(`  GOOD: Timestamp formats appear to be correct`);
          }
        }
      });
    } else {
      console.log("No active processing sessions found to verify timestamps");
    }

    // Check server current time
    const serverTime = Date.now();
    const serverTimeSeconds = Math.floor(serverTime / 1000);
    
    console.log("\nServer time verification:");
    console.log(`  Current server time (ms): ${serverTime} -> ${new Date(serverTime).toISOString()}`);
    console.log(`  Current server time (s): ${serverTimeSeconds} -> ${new Date(serverTimeSeconds * 1000).toISOString()}`);

    // Check if server time is properly synced with database time field
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMPORARY TABLE IF NOT EXISTS time_check (
        server_time BIGINT,
        server_time_s BIGINT
      )
    `);
    
    await client.query(`
      INSERT INTO time_check (server_time, server_time_s)
      VALUES ($1, $2)
    `, [serverTime, serverTimeSeconds]);
    
    const timeCheck = await client.query(`
      SELECT * FROM time_check
    `);
    
    console.log("\nDatabase time storage check:");
    console.log(`  Stored time (ms): ${timeCheck.rows[0].server_time} -> ${new Date(parseInt(timeCheck.rows[0].server_time)).toISOString()}`);
    console.log(`  Stored time (s): ${timeCheck.rows[0].server_time_s} -> ${new Date(parseInt(timeCheck.rows[0].server_time_s) * 1000).toISOString()}`);
    
    await client.query('ROLLBACK');

    console.log("\nTimestamp verification completed");
    client.release();
  } catch (error) {
    console.error("Error verifying timestamps:", error);
  } finally {
    // Close pool
    await pool.end();
  }
}

// Run the function
verifyTimestamps().catch(err => {
  console.error("Unhandled error:", err);
});