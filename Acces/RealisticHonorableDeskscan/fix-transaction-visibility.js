
// Fix transaction visibility issues
async function fixTransactionVisibility() {
  try {
    // Use dynamic import to import ESM module in CommonJS
    const { pool } = await import('./db.js');
    
    // 1. Ensure transactions table has necessary columns
    await pool.query(`
      ALTER TABLE transactions 
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS gas_fee NUMERIC(10, 8) DEFAULT 0.00002;
    `);
    
    console.log('✅ Transaction table columns fixed');
    
    // 2. Update transaction types for better display in UI
    await pool.query(`
      UPDATE transactions 
      SET status = 'confirmed' 
      WHERE status IS NULL OR status = '';
    `);
    
    console.log('✅ Transaction statuses updated');
    
    // 3. Refresh wallet balances to ensure accuracy
    console.log('Refreshing wallet balances...');
    
    // Get all wallet addresses
    const walletResult = await pool.query(`
      SELECT id, wallet_address 
      FROM user_wallets
    `);
    
    for (const wallet of walletResult.rows) {
      // Calculate incoming transactions
      const incomingResult = await pool.query(`
        SELECT COALESCE(SUM(amount), 0) as total_in 
        FROM transactions 
        WHERE recipient_address = $1 AND status = 'confirmed'
      `, [wallet.wallet_address]);
      
      // Calculate outgoing transactions
      const outgoingResult = await pool.query(`
        SELECT COALESCE(SUM(amount), 0) as total_out, 
               COALESCE(SUM(gas_fee), 0) as total_fees
        FROM transactions 
        WHERE sender_address = $1 AND status = 'confirmed'
      `, [wallet.wallet_address]);
      
      const totalIn = parseFloat(incomingResult.rows[0].total_in) || 0;
      const totalOut = parseFloat(outgoingResult.rows[0].total_out) || 0;
      const totalFees = parseFloat(outgoingResult.rows[0].total_fees) || 0;
      
      // Calculate balance
      let balance = totalIn - totalOut - totalFees;
      
      // Add initial balance for generated wallets (1000000 tokens)
      const walletInfo = await pool.query(`
        SELECT is_generated FROM user_wallets WHERE id = $1
      `, [wallet.id]);
      
      if (walletInfo.rows.length > 0 && walletInfo.rows[0].is_generated) {
        balance += 1000000;
      }
      
      // Update wallet balance
      await pool.query(`
        INSERT INTO wallet_balances (wallet_id, balance, last_updated)
        VALUES ($1, $2, $3)
        ON CONFLICT (wallet_id) 
        DO UPDATE SET balance = $2, last_updated = $3
      `, [wallet.id, balance, Date.now()]);
      
      console.log(`  ✓ Updated balance for wallet ${wallet.wallet_address}: ${balance}`);
    }
    
    console.log('✅ Wallet balances refreshed');
    
    // Close the pool when done
    await pool.end();
    console.log('✅ Transaction visibility fix completed');
  } catch (err) {
    console.error('❌ Error fixing transaction visibility:', err);
  }
}

// Run the function
fixTransactionVisibility();
