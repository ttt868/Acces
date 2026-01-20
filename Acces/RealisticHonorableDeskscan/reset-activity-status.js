
// Reset processing status for debugging
import { pool, initializeDatabase } from './db.js';

// Initialize the database
initializeDatabase()
  .then(async () => {
    console.log('Database initialized');
    
    try {
      // Get users with active processing
      const activeUsers = await pool.query(
        'SELECT id, email FROM users WHERE processing_active = 1'
      );
      
      console.log(`Found ${activeUsers.rows.length} users with active processing`);
      
      for (const user of activeUsers.rows) {
        console.log(`Resetting processing status for user ${user.id} (${user.email})`);
        
        await pool.query(
          `UPDATE users 
           SET processing_active = 0, 
               processingactive = 0, 
               processing_start_time = NULL, 
               processing_end_time = NULL,
               processing_cooldown = NULL,
               processing_completed = TRUE
           WHERE id = $1`,
          [user.id]
        );
        
        console.log(`Reset complete for user ${user.id}`);
      }
      
      console.log('All processing sessions have been reset');
      process.exit(0);
    } catch (error) {
      console.error('Error resetting processing status:', error);
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Database initialization failed:', error);
    process.exit(1);
  });
