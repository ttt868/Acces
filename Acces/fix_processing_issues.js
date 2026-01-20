
import { pool } from './RealisticHonorableDeskscan/db.js';

async function fixProcessingIssues() {
  try {
    console.log("Starting database fixes for processing functionality");
    
    // First ensure the processing_start_time_seconds column exists
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
        
        -- Ensure other required columns exist
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'accumulated_processing_reward'
        ) THEN
          ALTER TABLE users ADD COLUMN accumulated_processing_reward NUMERIC DEFAULT 0;
          RAISE NOTICE 'Added accumulated_processing_reward column';
        END IF;

        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'last_processing_accumulation'
        ) THEN
          ALTER TABLE users ADD COLUMN last_processing_accumulation BIGINT;
          RAISE NOTICE 'Added last_processing_accumulation column';
        END IF;
      END$$;
    `);
    
    // Fix any null or inconsistent processing status
    await pool.query(`
      UPDATE users 
      SET processing_active = 0 
      WHERE processing_active IS NULL;
      
      UPDATE users 
      SET processing_start_time_seconds = FLOOR(processing_start_time / 1000) 
      WHERE processing_start_time IS NOT NULL AND processing_start_time_seconds IS NULL;
    `);
    
    console.log("Database fixes completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("Error during database fixes:", error);
    process.exit(1);
  }
}

// Run the fixes
fixProcessingIssues();