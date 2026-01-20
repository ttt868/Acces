
const { pool } = require('./RealisticHonorableDeskscan/db.js');

/**
 * This script completely removes the 'accumulated_processing_reward' field from the users table
 */
async function removeAccumulatedProcessingRewardField() {
  const client = await pool.connect();

  try {
    console.log('Starting database update to remove accumulated_processing_reward field...');

    // Begin transaction
    await client.query('BEGIN');

    // First check if the column exists
    const columnCheck = await client.query(`
      SELECT COUNT(*) as has_column 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name = 'accumulated_processing_reward'
    `);

    const hasColumn = parseInt(columnCheck.rows[0].has_column) > 0;

    if (hasColumn) {
      console.log('accumulated_processing_reward column found - proceeding with removal');

      // Ensure accumulatedReward column exists for data preservation
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' 
            AND column_name = 'accumulatedReward'
          ) THEN
            ALTER TABLE users ADD COLUMN accumulatedReward NUMERIC DEFAULT 0;
          END IF;
        END$$;
      `);

      // Copy any values to accumulatedReward to preserve data before deletion
      await client.query(`
        UPDATE users 
        SET accumulatedReward = accumulated_processing_reward
        WHERE accumulated_processing_reward IS NOT NULL;
      `);

      console.log('Preserved any existing values in accumulatedReward field');

      // Now drop the accumulated_processing_reward column
      await client.query(`
        ALTER TABLE users DROP COLUMN accumulated_processing_reward;
      `);

      console.log('Successfully removed accumulated_processing_reward column from users table');
    } else {
      console.log('The accumulated_processing_reward column does not exist - nothing to remove');
    }

    // Commit transaction
    await client.query('COMMIT');
    console.log('Database update completed successfully');

  } catch (error) {
    // Rollback on error
    await client.query('ROLLBACK');
    console.error('Error removing accumulated_processing_reward field:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the function
removeAccumulatedProcessingRewardField()
  .then(() => console.log('Script completed'))
  .catch(err => console.error('Script failed:', err));