/**
 * This script cleans up stale processing sessions without relying on server time
 */
```

```javascript
import { pool } from './RealisticHonorableDeskscan/db.js';
```

```javascript
async function cleanupStaleProcessing() {
  try {
    console.log('Starting processing session cleanup...');
```

```javascript
    // Get a client from the pool
    const client = await pool.connect();
    console.log('Successfully connected to database');
```

```javascript
    try {
      // Find all active processing sessions
      const sessionResult = await client.query(
        'SELECT user_id, start_time, last_updated, remaining FROM processing_sessions WHERE is_active = TRUE'
      );
```

```javascript
      console.log(`Found ${sessionResult.rows.length} active processing sessions to check`);
```

```javascript
      // Current time in seconds
      const now = Math.floor(Date.now() / 1000);
      let cleanedCount = 0;
```

```javascript
      // Check each active session
      for (const session of sessionResult.rows) {
        // Calculate time elapsed since session start
        const startTime = parseInt(session.start_time) || 0;
        const lastUpdateTime = parseInt(session.last_updated) || startTime;
```

```javascript
        // Convert timestamps to seconds if they're in milliseconds
        const startTimeSeconds = startTime > 2000000000 ? Math.floor(startTime / 1000) : startTime;
        const lastUpdateTimeSeconds = lastUpdateTime > 2000000000 ? Math.floor(lastUpdateTime / 1000) : lastUpdateTime;
```

```javascript
        const elapsedSeconds = now - startTimeSeconds;
        const timeSinceUpdate = now - lastUpdateTimeSeconds;
```

```javascript
        // Calculate remaining time
        const remainingSeconds = Math.max(0, parseInt(session.remaining) || 0);
```

```javascript
        // If no time remaining or stale (over 1 hour with no updates), mark inactive
        if (remainingSeconds <= 0 || elapsedSeconds > 86400 || timeSinceUpdate > 3600) {
          console.log(`Cleaning up stale processing session for user ${session.user_id}`);
```

```javascript
          await client.query(`
            UPDATE processing_sessions 
            SET is_active = FALSE, remaining = 0 
            WHERE user_id = $1
          `, [session.user_id]);
```

```javascript
          // Also update the processing_active flag in users table
          await client.query(`
            UPDATE users 
            SET processing_active = 0, processingactive = 0, processing_remaining_seconds = 0 
            WHERE id = $1
          `, [session.user_id]);
```

```javascript
          cleanedCount++;
        }
      }
```

```javascript
      // Also find users with mismatched processing states
      const userMismatchResult = await client.query(`
        SELECT u.id, u.processing_active, u.processingactive, ms.is_active
        FROM users u
        LEFT JOIN processing_sessions ms ON u.id = ms.user_id
        WHERE 
          (u.processing_active = 1 AND (ms.is_active IS NULL OR ms.is_active = FALSE))
          OR
          (u.processingactive = 1 AND (ms.is_active IS NULL OR ms.is_active = FALSE))
      `);
```

```javascript
      console.log(`Found ${userMismatchResult.rows.length} users with mismatched processing states`);
```

```javascript
      // Fix each mismatch
      for (const user of userMismatchResult.rows) {
        console.log(`Fixing mismatched processing state for user ${user.id}`);
```

```javascript
        await client.query(`
          UPDATE users 
          SET processing_active = 0, processingactive = 0, processing_remaining_seconds = 0 
          WHERE id = $1
        `, [user.id]);
```

```javascript
        cleanedCount++;
      }
```

```javascript
      console.log(`Cleaned up ${cleanedCount} stale processing sessions`);
      console.log('Processing session cleanup completed successfully');
```

```javascript
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error cleaning up processing sessions:', error);
  } finally {
    // Close the pool
    await pool.end();
  }
}
```

```javascript
// Execute the cleanup
cleanupStaleProcessing().then(() => {
  console.log('Cleanup script finished executing');
  process.exit(0);
}).catch(err => {
  console.error('Unhandled error in cleanup script:', err);
  process.exit(1);
});
```

```
</replit_final_file>
/**
 * This script cleans up stale processing sessions without relying on server time
 */

import { pool } from './RealisticHonorableDeskscan/db.js';

async function cleanupStaleProcessing() {
  try {
    console.log('Starting processing session cleanup...');

    // Get a client from the pool
    const client = await pool.connect();
    console.log('Successfully connected to database');

    try {
      // Find all active processing sessions
      const sessionResult = await client.query(
        'SELECT user_id, start_time, last_updated, remaining FROM processing_sessions WHERE is_active = TRUE'
      );

      console.log(`Found ${sessionResult.rows.length} active processing sessions to check`);

      // Current time in seconds
      const now = Math.floor(Date.now() / 1000);
      let cleanedCount = 0;

      // Check each active session
      for (const session of sessionResult.rows) {
        // Calculate time elapsed since session start
        const startTime = parseInt(session.start_time) || 0;
        const lastUpdateTime = parseInt(session.last_updated) || startTime;

        // Convert timestamps to seconds if they're in milliseconds
        const startTimeSeconds = startTime > 2000000000 ? Math.floor(startTime / 1000) : startTime;
        const lastUpdateTimeSeconds = lastUpdateTime > 2000000000 ? Math.floor(lastUpdateTime / 1000) : lastUpdateTime;

        const elapsedSeconds = now - startTimeSeconds;
        const timeSinceUpdate = now - lastUpdateTimeSeconds;

        // Calculate remaining time
        const remainingSeconds = Math.max(0, parseInt(session.remaining) || 0);

        // If no time remaining or stale (over 1 hour with no updates), mark inactive
        if (remainingSeconds <= 0 || elapsedSeconds > 86400 || timeSinceUpdate > 3600) {
          console.log(`Cleaning up stale processing session for user ${session.user_id}`);

          await client.query(`
            UPDATE processing_sessions 
            SET is_active = FALSE, remaining = 0 
            WHERE user_id = $1
          `, [session.user_id]);

          // Also update the processing_active flag in users table
          await client.query(`
            UPDATE users 
            SET processing_active = 0, processingactive = 0, processing_remaining_seconds = 0 
            WHERE id = $1
          `, [session.user_id]);

          cleanedCount++;
        }
      }

      // Also find users with mismatched processing states
      const userMismatchResult = await client.query(`
        SELECT u.id, u.processing_active, u.processingactive, ms.is_active
        FROM users u
        LEFT JOIN processing_sessions ms ON u.id = ms.user_id
        WHERE 
          (u.processing_active = 1 AND (ms.is_active IS NULL OR ms.is_active = FALSE))
          OR
          (u.processingactive = 1 AND (ms.is_active IS NULL OR ms.is_active = FALSE))
      `);

      console.log(`Found ${userMismatchResult.rows.length} users with mismatched processing states`);

      // Fix each mismatch
      for (const user of userMismatchResult.rows) {
        console.log(`Fixing mismatched processing state for user ${user.id}`);

        await client.query(`
          UPDATE users 
          SET processing_active = 0, processingactive = 0, processing_remaining_seconds = 0 
          WHERE id = $1
        `, [user.id]);

        cleanedCount++;
      }

      console.log(`Cleaned up ${cleanedCount} stale processing sessions`);
      console.log('Processing session cleanup completed successfully');

    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error cleaning up processing sessions:', error);
  } finally {
    // Close the pool
    await pool.end();
  }
}

// Execute the cleanup
cleanupStaleProcessing().then(() => {
  console.log('Cleanup script finished executing');
  process.exit(0);
}).catch(err => {
  console.error('Unhandled error in cleanup script:', err);
  process.exit(1);
});
</replit_final_file>