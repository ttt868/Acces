// Fix Server Time Display script
// This script fixes the server time display issues by correcting time unit handling

console.log("Starting server time display fix...");

// Import required modules
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Initialize database connection with SSL
const pool = new Pool({
  ssl: {
    rejectUnauthorized: false
  }
});

async function fixServerTimeDisplay() {
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

    // Fix incorrect timestamp formats (converting seconds to milliseconds where needed)
    await client.query(`
      UPDATE users 
      SET processing_start_time = processing_start_time * 1000 
      WHERE processing_start_time < 2000000000 AND processing_start_time > 0
    `);

    await client.query(`
      UPDATE users 
      SET processing_end_time = processing_end_time * 1000 
      WHERE processing_end_time < 2000000000 AND processing_end_time > 0
    `);

    console.log("Updated timestamp formats in database");

    // Ensure server code uses consistent time format
    console.log("Script completed successfully");
    client.release();
  } catch (error) {
    console.error("Error fixing server time display:", error);
  } finally {
    // Close pool
    await pool.end();
  }
}

// Run the function
fixServerTimeDisplay().catch(err => {
  console.error("Unhandled error:", err);
});
