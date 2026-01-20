
// Enhanced database check utility
async function checkDatabaseColumns() {
  try {
    // Use dynamic import to handle ESM modules
    const { pool } = await import('./db.js');
    
    console.log('=== DATABASE STRUCTURE VERIFICATION ===');
    
    // 1. First check if the users table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'users'
      ) as table_exists
    `);
    
    console.log('Users table exists:', tableCheck.rows[0].table_exists);
    
    if (!tableCheck.rows[0].table_exists) {
      console.error('CRITICAL ERROR: users table does not exist!');
      return;
    }
    
    // 2. Get all columns from the users table
    const allColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);
    
    console.log('\nAll columns in users table:');
    allColumns.rows.forEach(col => {
      console.log(`- ${col.column_name} (${col.data_type}, ${col.is_nullable === 'YES' ? 'nullable' : 'not nullable'})`);
    });
    
    // 3. Check specifically for wallet columns
    const walletColumns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name IN ('wallet_address', 'wallet_private_key', 'wallet_created_at')
    `);
    
    console.log('\nWallet columns found:', walletColumns.rows.map(r => r.column_name));
    
    // 4. Sample user data (with sensitive info masked)
    const usersResult = await pool.query(`
      SELECT 
        id, 
        email, 
        wallet_address,
        CASE 
          WHEN wallet_private_key IS NOT NULL THEN 'PRESENT_BUT_MASKED' 
          ELSE NULL 
        END AS wallet_private_key,
        wallet_created_at
      FROM users 
      LIMIT 5
    `);
    
    console.log('\nSample user data (sensitive info masked):');
    console.log(JSON.stringify(usersResult.rows, null, 2));
    
    // 5. Add missing columns if needed
    if (walletColumns.rows.length < 3) {
      console.log('\nAttempting to add missing wallet columns...');
      
      try {
        await pool.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT FROM information_schema.columns 
              WHERE table_name = 'users' AND column_name = 'wallet_address'
            ) THEN
              ALTER TABLE users ADD COLUMN wallet_address TEXT;
              RAISE NOTICE 'Added wallet_address column';
            END IF;
            
            IF NOT EXISTS (
              SELECT FROM information_schema.columns 
              WHERE table_name = 'users' AND column_name = 'wallet_private_key'
            ) THEN
              ALTER TABLE users ADD COLUMN wallet_private_key TEXT;
              RAISE NOTICE 'Added wallet_private_key column';
            END IF;
            
            IF NOT EXISTS (
              SELECT FROM information_schema.columns 
              WHERE table_name = 'users' AND column_name = 'wallet_created_at'
            ) THEN
              ALTER TABLE users ADD COLUMN wallet_created_at BIGINT;
              RAISE NOTICE 'Added wallet_created_at column';
            END IF;
            
            -- Add QR code related columns if they don't exist
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
        
        console.log('Missing columns added successfully');
      } catch (err) {
        console.error('Error adding missing columns:', err);
      }
      
      // Verify columns were added
      const verifyColumns = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name IN ('wallet_address', 'wallet_private_key', 'wallet_created_at')
      `);
      
      console.log('Wallet columns after update:', verifyColumns.rows.map(r => r.column_name));
    }
    
    // Close the pool when done
    await pool.end();
    console.log('\n=== DATABASE CHECK COMPLETE ===');
  } catch (err) {
    console.error('Error checking database:', err);
  }
}

// Run the check
checkDatabaseColumns();
