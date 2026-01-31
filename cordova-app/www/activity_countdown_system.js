/**
 * Simplified Activity Countdown System
 * This implements a pure seconds-based countdown timer without date/time dependencies
 * No accumulated reward or history management - handled by other modules
 */

import { pool } from './db.js';

// Initialize necessary database tables for the activity countdown system
async function initializeActivityCountdownTables() {
  try {
    // Get a client from the pool
    const client = await pool.connect();

    try {
      // Create an activity_sessions table if it doesn't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS activity_sessions (
          user_id INTEGER PRIMARY KEY,
          duration INTEGER DEFAULT 86400,
          remaining INTEGER,
          is_active BOOLEAN DEFAULT TRUE,
          start_time BIGINT,
          last_updated BIGINT
        );
      `);

      // Ensure the necessary columns exist in users table
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_remaining_seconds'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_remaining_seconds INTEGER;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_duration_seconds'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_duration_seconds INTEGER DEFAULT 86400;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_start_time_seconds'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_start_time_seconds BIGINT;
          END IF;
        END$$;
      `);

      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error initializing processing countdown tables:', error);
    throw error;
  }
}

// Start a new processing countdown session for a user
async function startProcessingCountdown(userId) {
  try {
    const client = await pool.connect();

    try {
      // Begin transaction
      await client.query('BEGIN');

      // Check if user already has an active session in processing_sessions table
      const activeCheck = await client.query(
        'SELECT * FROM processing_sessions WHERE user_id = $1',
        [userId]
      );

      // If there's an existing session, we need to check if it's truly active
      if (activeCheck.rows.length > 0) {
        const existingSession = activeCheck.rows[0];
        const now = Math.floor(Date.now() / 1000);

        // Calculate elapsed time since last update
        const elapsedSeconds = now - (existingSession.last_updated || existingSession.start_time);

        // Calculate remaining time
        const remainingSeconds = Math.max(0, existingSession.remaining - elapsedSeconds);

        // If there's remaining time and session is marked active, it's truly active
        if (remainingSeconds > 0 && existingSession.is_active) {
          await client.query('ROLLBACK');
          return {
            success: false,
            error: 'User already has an active processing session',
            remaining_seconds: remainingSeconds
          };
        } else {
          // Session exists but is not active - clear it for new session
          await client.query(
            'UPDATE processing_sessions SET is_active = FALSE, remaining = 0 WHERE user_id = $1',
            [userId]
          );
        }
      }

      console.log(`Starting new processing session for user ${userId}`);

      // Start a new processing session
      const duration = 86400; // 24 hours in seconds
      const now = Math.floor(Date.now() / 1000);

      await client.query(`
        INSERT INTO processing_sessions (user_id, duration, remaining, is_active, start_time, last_updated)
        VALUES ($1, $2, $3, TRUE, $4, $4)
        ON CONFLICT (user_id)
        DO UPDATE SET 
          duration = $2,
          remaining = $3,
          is_active = TRUE,
          start_time = $4,
          last_updated = $4
      `, [userId, duration, duration, now]);

      // Update user record for compatibility
      await client.query(`
        UPDATE users 
        SET 
          processing_active = 1, 
          processing_remaining_seconds = $1,
          processing_duration_seconds = $1,
          processing_start_time_seconds = $2,
          processing_start_time = $3,
          processing_end_time = $4
        WHERE id = $5
      `, [duration, now, now * 1000, (now + duration) * 1000, userId]);

      // Commit transaction
      await client.query('COMMIT');

      return {
        success: true,
        message: 'Processing countdown started successfully',
        duration: duration,
        remaining_seconds: duration,
        start_time: now,
        end_time: now + duration
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error starting processing countdown:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Get the current status of a processing countdown session
async function getProcessingCountdownStatus(userId) {
  try {
    const client = await pool.connect();

    try {
      // Get the current session
      const sessionQuery = await client.query(
        'SELECT * FROM processing_sessions WHERE user_id = $1',
        [userId]
      );

      if (sessionQuery.rows.length === 0) {
        // No session found
        return {
          success: true,
          processing_active: 0,
          remaining_seconds: 0,
          can_start: true
        };
      }

      const session = sessionQuery.rows[0];
      const now = Math.floor(Date.now() / 1000);

      // Calculate time elapsed since last update
      const elapsedSeconds = now - (session.last_updated || session.start_time);

      // Calculate remaining time
      let remainingSeconds = Math.max(0, session.remaining - elapsedSeconds);

      // Check if processing is still active
      const isActive = remainingSeconds > 0 && session.is_active;

      // Update the session if needed
      if (elapsedSeconds > 10) {
        await client.query(`
          UPDATE processing_sessions 
          SET 
            remaining = $1, 
            is_active = $2,
            last_updated = $3
          WHERE user_id = $4
        `, [remainingSeconds, remainingSeconds > 0, now, userId]);

        // Also update user table for compatibility
        await client.query(`
          UPDATE users 
          SET 
            processing_active = $1,
            processing_remaining_seconds = $2
          WHERE id = $3
        `, [isActive ? 1 : 0, remainingSeconds, userId]);
      }

      return {
        success: true,
        processing_active: isActive ? 1 : 0,
        remaining_seconds: remainingSeconds,
        duration: session.duration,
        start_time: session.start_time,
        end_time: session.start_time + session.duration,
        last_updated: now,
        can_start: !isActive,
        is_completed: !isActive && session.start_time > 0
      };
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error getting processing countdown status:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Complete processing countdown session (no reward handling)
async function completeProcessingCountdown(userId) {
  try {
    console.log(`Completing processing session for user ${userId}`);

    const client = await pool.connect();

    try {
      // Begin transaction for atomic operation
      await client.query('BEGIN');

      // Update user processing status
      await client.query(`
        UPDATE users SET 
          processing_active = 0,
          processing_completed = true
        WHERE id = $1
      `, [userId]);

      // Clear processing session
      await client.query('UPDATE processing_sessions SET is_active = FALSE, remaining = 0 WHERE user_id = $1', [userId]);

      // Clear ad boost completely when session ends
      // This ensures no boost data carries over to next session
      const { clearAdBoost } = await import('./db.js');
      await clearAdBoost(userId);
      console.log(`[AD BOOST] Complete clear for user ${userId} - session ended`);

      // Commit transaction
      await client.query('COMMIT');

      console.log(`Processing session completed for user ${userId}`);

      return {
        success: true,
        message: 'Processing session completed successfully',
        timestamp: Date.now(),
        completion_status: 'success'
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error in processing completion:', error);

    return { 
      success: false, 
      error: error.message
    };
  }
}

export {
  initializeActivityCountdownTables,
  startProcessingCountdown,
  getProcessingCountdownStatus,
  completeProcessingCountdown
};