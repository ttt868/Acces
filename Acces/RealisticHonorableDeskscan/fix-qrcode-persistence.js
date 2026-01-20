
// QR Code Persistence Fix Utility
import { pool } from './db.js';

async function ensureQRCodeColumns() {
  try {
    console.log('Running QR code columns fix...');
    
    // Ensure QR code columns exist in users table
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'qrcode_data'
        ) THEN
          ALTER TABLE users ADD COLUMN qrcode_data TEXT;
          RAISE NOTICE 'Added qrcode_data column';
        END IF;
        
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'qrcode_timestamp'
        ) THEN
          ALTER TABLE users ADD COLUMN qrcode_timestamp BIGINT;
          RAISE NOTICE 'Added qrcode_timestamp column';
        END IF;
        
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'qrcode_wallet_address'
        ) THEN
          ALTER TABLE users ADD COLUMN qrcode_wallet_address TEXT;
          RAISE NOTICE 'Added qrcode_wallet_address column';
        END IF;
      END$$;
    `);
    
    console.log('QR code columns added to users table');
    
    // Check count of users with wallets but without QR codes
    const userCheck = await pool.query(`
      SELECT COUNT(*) as count
      FROM users
      WHERE wallet_address IS NOT NULL
      AND qrcode_data IS NULL
    `);
    
    const usersNeedingQR = parseInt(userCheck.rows[0].count);
    console.log(`Found ${usersNeedingQR} users with wallets but missing QR code data`);
    
    return true;
  } catch (error) {
    console.error('Error ensuring QR code columns:', error);
    return false;
  }
}

// Run the function and close the connection
ensureQRCodeColumns()
  .then(result => {
    console.log('QR code columns check completed:', result ? 'Successfully' : 'With errors');
    pool.end();
  })
  .catch(err => {
    console.error('Error running QR code fix:', err);
    pool.end();
  });
