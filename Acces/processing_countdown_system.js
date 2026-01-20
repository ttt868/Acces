/**
 * Simplified Processing Countdown System
 * This implements a pure seconds-based countdown timer without date/time dependencies
 */

import { pool } from './db.js';

// Initialize the processing tables
async function initializeProcessingCountdownTables() {
  try {
    // Ensure we have simplified processing countdown columns
    await pool.query(`
      DO $$
      BEGIN
        -- Add processing_remaining_seconds column if it doesn't exist
        IF NOT EXISTS (
          SELECT FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'processing_remaining_seconds'
        ) THEN
          ALTER TABLE users ADD COLUMN processing_remaining_seconds INTEGER;
        END IF;

        -- Add processing_duration_seconds column if it doesn't exist (default 24h)
        IF NOT EXISTS (
          SELECT FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'processing_duration_seconds'
        ) THEN
          ALTER TABLE users ADD COLUMN processing_duration_seconds INTEGER DEFAULT 86400;
        END IF;

        -- Add last_processing_update column to track when the remaining time was last updated
        IF NOT EXISTS (
          SELECT FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'last_processing_update'
        ) THEN
          ALTER TABLE users ADD COLUMN last_processing_update BIGINT;
        END IF;
      END$$;
    `);

    console.log('Ensured simplified processing countdown columns exist');

    // Update processing_remaining_seconds for active sessions where it's null
    const result = await pool.query(`
      UPDATE users 
      SET processing_remaining_seconds = 
        CASE 
          -- When processing is active and end_time exists, calculate remaining seconds
          WHEN processing_active = 1 AND processing_end_time IS NOT NULL AND processing_start_time IS NOT NULL THEN
            GREATEST(0, FLOOR((processing_end_time - EXTRACT(EPOCH FROM NOW()) * 1000) / 1000)::INTEGER)
          ELSE
            NULL
        END
      WHERE processing_active = 1 AND processing_remaining_seconds IS NULL
      RETURNING id, processing_active, processing_end_time, processing_start_time, processing_remaining_seconds
    `);

    console.log('Updated processing_remaining_seconds for active sessions:', result.rows);

    return true;
  } catch (error) {
    console.error('Error initializing processing countdown tables:', error);
    return false;
  }
}

// Start a new processing session with simplified countdown
async function startProcessingCountdown(userId) {
  try {
    const duration = 86400; // 24 hours in seconds
    const now = Math.floor(Date.now() / 1000); // Current time in seconds

    // Start a transaction
    await pool.query('BEGIN');

    // Start new processing session
    const result = await pool.query(`
      UPDATE users
      SET processing_active = 1,
          processing_remaining_seconds = $1,
          processing_duration_seconds = $1,
          last_processing_update = $2,
          processing_start_time = $3,
          processing_end_time = $4,
          processing_start_time_seconds = $2
      WHERE id = $5
      RETURNING id, processing_remaining_seconds
    `, [
      duration, 
      now, 
      now * 1000, // For backward compatibility
      (now + duration) * 1000, // For backward compatibility
      userId
    ]);

    // Record processing start in history
    await pool.query(
      'INSERT INTO processing_history (user_id, amount, timestamp, user_name, date) VALUES ($1, 0, $2, $3, $4)',
      [userId, now * 1000, 'Processing Started', new Date(now * 1000).toISOString()]
    );

    await pool.query('COMMIT');

    console.log(`✅ Processing session started for user ${userId} at ${new Date(now * 1000).toISOString()}`);

    return {
      success: true,
      remaining_seconds: duration,
      start_time: now,
      end_time: now + duration
    };
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error starting processing countdown:', error);
    return { success: false, error: error.message };
  }
}

// Get current processing countdown status
async function getProcessingCountdownStatus(userId) {
  try {
    // Get current processing status
    const result = await pool.query(`
      SELECT 
        processing_active, 
        processing_remaining_seconds,
        processing_duration_seconds,
        last_processing_update
      FROM users
      WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return { success: false, error: 'User not found' };
    }

    const userData = result.rows[0];
    const now = Math.floor(Date.now() / 1000); // Current time in seconds

    // If we have a valid remaining time and processing is active
    if (userData.processing_active === 1 && userData.processing_remaining_seconds !== null) {
      // Calculate elapsed time since last update
      const lastUpdate = userData.last_processing_update || now;
      const elapsedSeconds = now - lastUpdate;

      // Calculate new remaining time
      let newRemaining = userData.processing_remaining_seconds - elapsedSeconds;

      // Ensure remaining time never goes below 0
      newRemaining = Math.max(0, newRemaining);

      // If timer has expired, mark processing as complete
      if (newRemaining <= 0) {
        // Update the database to mark processing as completed
        await pool.query(`
          UPDATE users
          SET processing_active = 0,
              processing_remaining_seconds = 0,
              last_processing_update = $1
          WHERE id = $2
        `, [now, userId]);

        return {
          success: true,
          processing_active: 0,
          remaining_seconds: 0,
          is_completed: true,
          server_time: now
        };
      }

      // Update the remaining time in the database
      await pool.query(`
        UPDATE users
        SET processing_remaining_seconds = $1,
            last_processing_update = $2
        WHERE id = $3
      `, [newRemaining, now, userId]);

      return {
        success: true,
        processing_active: 1,
        remaining_seconds: newRemaining,
        duration_seconds: userData.processing_duration_seconds || 86400,
        is_completed: false,
        server_time: now
      };
    }

    // If processing is not active
    return {
      success: true,
      processing_active: 0,
      remaining_seconds: 0,
      duration_seconds: userData.processing_duration_seconds || 86400,
      is_completed: true,
      server_time: now
    };
  } catch (error) {
    console.error('Error getting processing countdown status:', error);
    return { success: false, error: error.message };
  }
}

// Complete processing and add reward
async function completeProcessingCountdown(userId, finalReward) {
  try {
    // Start a transaction
    await pool.query('BEGIN');

    // Get current user data
    const userResult = await pool.query(
      'SELECT coins FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return { success: false, error: 'User not found' };
    }

    const currentCoins = parseFloat(userResult.rows[0].coins || 0);
    const rewardAmount = parseFloat(finalReward || 0.25);
    const newBalance = currentCoins + rewardAmount;

    // Update user balance and reset processing
    await pool.query(`
      UPDATE users
      SET coins = $1::numeric(20,8),
          processing_active = 0,
          processing_remaining_seconds = NULL
      WHERE id = $2
    `, [newBalance.toFixed(8), userId]);

    // Add record to processing history
    const now = Date.now();
    await pool.query(
      'INSERT INTO processing_history (user_id, amount, timestamp, user_name, date) VALUES ($1, $2, $3, $4, $5)',
      [userId, rewardAmount, now, 'Processing Reward', new Date(now).toISOString()]
    );

    await pool.query('COMMIT');

    return {
      success: true,
      new_balance: newBalance,
      reward_amount: rewardAmount
    };
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error completing processing countdown:', error);
    return { success: false, error: error.message };
  }
}



export {
  initializeProcessingCountdownTables,
  startProcessingCountdown,
  getProcessingCountdownStatus,
  completeProcessingCountdown,
  ensureProcessingColumnsExist,
  getAccumulatedReward
};