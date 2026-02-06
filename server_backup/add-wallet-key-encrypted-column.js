
// Script to add wallet_key_encrypted column to users table
import { pool } from './db.js';

// Connect to the database
async function addWalletKeyEncryptedColumn() {
  try {
    console.log('Adding wallet_key_encrypted column to users table...');
    
    // Connect to database
    const client = await pool.connect();
    console.log('Successfully connected to database');

    // Check if the column exists
    const checkResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'wallet_key_encrypted'
    `);
    
    if (checkResult.rows.length > 0) {
      console.log('wallet_key_encrypted column already exists in users table');
    } else {
      // Add the column
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN wallet_key_encrypted BOOLEAN DEFAULT false
      `);
      
      console.log('Added wallet_key_encrypted column to users table');
    }

    client.release();
    console.log('Column check/update completed successfully');
  } catch (error) {
    console.error('Error adding column:', error);
  }
}

// Run the function
addWalletKeyEncryptedColumn();
