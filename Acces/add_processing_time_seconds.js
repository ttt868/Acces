
import { pool } from './RealisticHonorableDeskscan/db.js';

async function addProcessingTimeSecondsColumn() {
  try {
    console.log("Starting database migration - adding processing_start_time_seconds column");
    
    // Add the missing processing_start_time_seconds column
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'processing_start_time_seconds'
        ) THEN
          ALTER TABLE users ADD COLUMN processing_start_time_seconds BIGINT;
          
          -- Update the new column with data converted from the existing processing_start_time field
          UPDATE users 
          SET processing_start_time_seconds = FLOOR(processing_start_time / 1000)
          WHERE processing_start_time IS NOT NULL;
          
          RAISE NOTICE 'Added processing_start_time_seconds column and migrated data';
        ELSE
          RAISE NOTICE 'Column processing_start_time_seconds already exists';
        END IF;
      END$$;
    `);
    
    console.log("Database migration completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("Error during database migration:", error);
    process.exit(1);
  }
}

// Run the migration
addProcessingTimeSecondsColumn();