/**
 * This script fixes column already exists errors and ensures the boosted reward
 * is properly used when completing processing
 */
// Use dynamic import for ES modules
import { pool } from './RealisticHonorableDeskscan/db.js';

async function cleanupAccumulatedProcessingReward() {
  try {
    console.log('Starting cleanup of accumulated processing reward fields...');

    // Begin a transaction
    await pool.query('BEGIN');

    // Check which columns exist in the users table
    const columnsCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND (column_name = 'accumulated_processing_reward' 
           OR column_name = 'accumulatedreward' 
           OR column_name = 'accumulatedReward'
           OR column_name = 'baseaccumulatedreward'
           OR column_name = 'baseAccumulatedReward')
    `);

    const columns = columnsCheck.rows.map(row => row.column_name.toLowerCase());
    console.log('Found columns:', columns);

    // Check for case-sensitive duplicate columns
    if (columns.includes('accumulatedreward') && !columns.includes('accumulated_processing_reward')) {
      console.log('accumulatedReward column exists but accumulated_processing_reward does not');

      // No need to create a column that already exists
      console.log('Using existing accumulatedReward column');
    } 
    // If accumulated_processing_reward exists but accumulatedReward doesn't
    else if (columns.includes('accumulated_processing_reward') && !columns.includes('accumulatedreward')) {
      console.log('Found accumulated_processing_reward column, migrating to accumulatedReward...');

      // Create accumulatedReward column
      try {
        await pool.query(`ALTER TABLE users ADD COLUMN accumulatedReward NUMERIC DEFAULT 0`);
        console.log('Created accumulatedReward column');
      } catch (err) {
        if (err.code === '42701') {
          console.log('Column accumulatedReward already exists (case sensitivity issue)');
        } else {
          throw err;
        }
      }

      // Migrate data
      await pool.query(`
        UPDATE users 
        SET accumulatedReward = COALESCE(accumulated_processing_reward, 0)
        WHERE accumulated_processing_reward IS NOT NULL
      `);

      // Try to drop the old column
      try {
        await pool.query(`ALTER TABLE users DROP COLUMN IF EXISTS accumulated_processing_reward`);
        console.log('Dropped accumulated_processing_reward column');
      } catch (err) {
        console.error('Error dropping accumulated_processing_reward column:', err);
      }
    }

    // Ensure baseAccumulatedReward exists
    if (!columns.includes('baseaccumulatedreward')) {
      try {
        await pool.query(`ALTER TABLE users ADD COLUMN baseAccumulatedReward NUMERIC DEFAULT 0`);
        console.log('Created baseAccumulatedReward column');
      } catch (err) {
        if (err.code === '42701') {
          console.log('Column baseAccumulatedReward already exists (case sensitivity issue)');
        } else {
          throw err;
        }
      }
    }

    // Now update any active processing sessions to use the correct reward
    const activeProcessingResult = await pool.query(`
      SELECT id, accumulatedReward, baseAccumulatedReward, processing_boost_multiplier 
      FROM users 
      WHERE processing_active = 1
    `);

    console.log(`Found ${activeProcessingResult.rows.length} active processing sessions to check`);

    // Commit the transaction
    await pool.query('COMMIT');
    console.log('Cleanup completed successfully');

    return true;
  } catch (error) {
    // Rollback on error
    await pool.query('ROLLBACK');
    console.error('Error cleaning up accumulated processing reward fields:', error);
    return false;
  }
}

// Run the function
cleanupAccumulatedProcessingReward()
  .then(result => {
    console.log(`Cleanup finished with result: ${result}`);
    process.exit(0);
  })
  .catch(err => {
    console.error('Cleanup script failed:', err);
    process.exit(1);
  });