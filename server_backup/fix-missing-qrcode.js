
// QR Code Persistence Fix Utility
import { pool } from './db.js';

async function fixMissingQRCodes() {
  try {
    console.log('Starting QR code persistence fix...');
    
    // First ensure the QR code columns exist in the database
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'qrcode_data'
        ) THEN
          ALTER TABLE users ADD COLUMN qrcode_data TEXT;
        END IF;

        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'qrcode_timestamp'
        ) THEN
          ALTER TABLE users ADD COLUMN qrcode_timestamp BIGINT;
        END IF;
        
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'qrcode_wallet_address'
        ) THEN
          ALTER TABLE users ADD COLUMN qrcode_wallet_address TEXT;
        END IF;
      END$$;
    `);
    
    console.log('QR code columns verified in database');
    
    // Find users with wallet addresses but missing QR code data
    const usersResult = await pool.query(`
      SELECT id, email, wallet_address 
      FROM users 
      WHERE wallet_address IS NOT NULL 
      ORDER BY id DESC
    `);
    
    console.log(`Found ${usersResult.rows.length} users to check for QR code data`);
    
    let fixedCount = 0;
    
    // Process each user and generate QR code data if needed
    for (const user of usersResult.rows) {
      try {
        // Check if user already has QR code data
        const qrCheckResult = await pool.query(
          'SELECT qrcode_data, qrcode_wallet_address FROM users WHERE id = $1',
          [user.id]
        );
        
        const hasValidQRCode = qrCheckResult.rows[0] && 
                              qrCheckResult.rows[0].qrcode_data && 
                              qrCheckResult.rows[0].qrcode_wallet_address === user.wallet_address;
        
        if (hasValidQRCode) {
          console.log(`User ${user.id} (${user.email}) already has valid QR code data`);
          continue;
        }
        
        // Generate basic QR code data
        const qrCodeData = `<div id="qrcode-display" title="${user.wallet_address}" style="width: 150px; height: 150px; margin: 0px auto;">
<canvas width="150" height="150"></canvas>
  <img style="display: none;">
</div>
<div class="qrcode-label" style="margin-top: 10px; text-align: center; color: rgb(51, 51, 51);">Scan to receive payment</div>
<div style="font-size: 10px; margin-top: 5px; text-align: center; color: rgb(85, 85, 85);">${user.wallet_address.substring(0, 8)}...${user.wallet_address.substring(user.wallet_address.length - 6)}</div>`;
        
        // Save the QR code data to the database
        const timestamp = Date.now();
        await pool.query(
          'UPDATE users SET qrcode_data = $1, qrcode_timestamp = $2, qrcode_wallet_address = $3 WHERE id = $4',
          [qrCodeData, timestamp, user.wallet_address, user.id]
        );
        
        console.log(`Fixed QR code data for user ${user.id} (${user.email})`);
        fixedCount++;
      } catch (err) {
        console.error(`Error fixing QR code for user ${user.id} (${user.email}):`, err);
      }
    }
    
    console.log(`QR code persistence fix complete. Fixed ${fixedCount} users.`);
  } catch (error) {
    console.error('Error running QR code fix:', error);
  } finally {
    // Don't close the pool here if it's shared with the main application
  }
}

// Run the fix function
fixMissingQRCodes();
