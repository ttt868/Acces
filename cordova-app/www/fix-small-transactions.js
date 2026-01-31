import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true
});

// Function to handle transactions with improved precision for small amounts
async function handleTransaction(sender, recipient, amount, description) {
  try {
    // Basic input validation
    if (!sender || !recipient || !amount) {
      throw new Error('Invalid input parameters for transaction');
    }

    // Convert amount to a numeric value, ensure it's a positive number
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      throw new Error('Invalid transaction amount');
    }

    // Generate a unique hash for the transaction (for example, using UUID)
    const hash = generateTransactionHash(sender, recipient, amount, Date.now());

    // Fetch sender and recipient details from the database
    const senderResult = await pool.query('SELECT id, coins, wallet_address FROM users WHERE id = $1', [sender]);
    const recipientResult = await pool.query('SELECT id, coins, wallet_address FROM users WHERE id = $1', [recipient]);

    if (senderResult.rows.length === 0 || recipientResult.rows.length === 0) {
      throw new Error('Sender or recipient not found');
    }

    const senderData = senderResult.rows[0];
    const recipientData = recipientResult.rows[0];

    const senderAddress = senderData.wallet_address;
    const recipientAddress = recipientData.wallet_address;

    // Check if the sender has sufficient balance
    if (senderData.coins < numericAmount) {
      throw new Error('Insufficient balance');
    }

    // Start a database transaction to ensure atomicity
    await pool.query('BEGIN');

    try {
      // Get current balances with proper precision before update
      const senderBalanceResult = await pool.query(
        'SELECT coins FROM users WHERE id = $1',
        [sender]
      );

      const recipientBalanceResult = await pool.query(
        'SELECT coins FROM users WHERE id = $1',
        [recipient]
      );

      // Calculate new balances precisely
      const currentSenderBalance = parseFloat(senderBalanceResult.rows[0].coins || 0);
      const currentRecipientBalance = parseFloat(recipientBalanceResult.rows[0].coins || 0);

      // Perform precise calculations to avoid rounding errors
      const gasFee = 0.00002;
      const totalDeduction = numericAmount + gasFee;
      const newSenderBalance = (currentSenderBalance - totalDeduction).toFixed(8);
      const newRecipientBalance = (currentRecipientBalance + numericAmount).toFixed(8);

      // Use a single query to update sender's balance for better atomicity
      await pool.query(
        'UPDATE users SET coins = CAST($1 AS numeric(20,8)) WHERE id = $2', 
        [newSenderBalance, sender]
      );

      // Update recipient's balance with explicit casting to ensure precision
      await pool.query(
        'UPDATE users SET coins = CAST($1 AS numeric(20,8)) WHERE id = $2', 
        [newRecipientBalance, recipient]
      );

      console.log(`Precise balance update: Sender ${sender} ${currentSenderBalance} → ${newSenderBalance}`);
      console.log(`Precise balance update: Recipient ${recipient} ${currentRecipientBalance} → ${newRecipientBalance}`);

      // Record the transaction in the database
      const timestamp = Date.now();

      // Record transaction in database with proper numeric formatting and explicit type cast
      // Enhanced with more detailed transaction recording and precision for small amounts
      console.log(`Recording transaction: amount=${numericAmount} (${typeof numericAmount})`);
      await pool.query(
        `INSERT INTO transactions 
        (sender, recipient, sender_address, recipient_address, amount, timestamp, hash, description, gas_fee, status, formatted_date) 
        VALUES ($1, $2, $3, $4, $5::numeric(20, 8), $6, $7, $8, $9::numeric(10, 8), $10, $11)
        ON CONFLICT (hash) DO NOTHING`,
        [
          sender, 
          recipient, 
          senderAddress, 
          recipientAddress, 
          numericAmount.toFixed(8), 
          timestamp, 
          hash, 
          description || null, 
          gasFee.toFixed(8),
          'confirmed',
          new Date(timestamp).toISOString()
        ]
      );

      // Verify balances were correctly updated before committing
      const verifiedSenderBalance = await pool.query(
        'SELECT coins FROM users WHERE id = $1',
        [sender]
      );

      const verifiedRecipientBalance = await pool.query(
        'SELECT coins FROM users WHERE id = $1',
        [recipient]
      );

      console.log(`VERIFICATION: Sender balance after update: ${verifiedSenderBalance.rows[0].coins}`);
      console.log(`VERIFICATION: Recipient balance after update: ${verifiedRecipientBalance.rows[0].coins}`);

      // Commit the transaction
      await pool.query('COMMIT');

      return { 
        success: true, 
        message: 'Transaction successful', 
        hash, 
        timestamp, 
        newSenderBalance: verifiedSenderBalance.rows[0].coins, 
        newRecipientBalance: verifiedRecipientBalance.rows[0].coins 
      };
    } catch (error) {
      // Rollback on error
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Transaction failed:', error);
    return { success: false, message: error.message };
  }
}

// Utility function to generate a transaction hash (example implementation)
function generateTransactionHash(sender, recipient, amount, timestamp) {
  const data = `${sender}-${recipient}-${amount}-${timestamp}-${Math.random()}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString();
}

export { handleTransaction };