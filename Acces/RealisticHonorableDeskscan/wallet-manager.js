// Wallet management functionality
// Using dynamic import for db.js
const { pool, safeQuery } = await import('./db.js');
import crypto from 'crypto';

// Constants for wallet management
export const MAX_WALLETS_PER_USER = 5;
export const WALLET_COOLDOWN_MINUTES = 5;

// Encryption settings - ENCRYPTION_KEY MUST be set in .env (minimum 32 characters)
// Without a persistent key, encrypted wallets become unrecoverable after server restart
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) {
  console.error('🔴 CRITICAL: ENCRYPTION_KEY missing or too short in .env! Must be at least 32 characters.');
  console.error('🔴 Server cannot start without ENCRYPTION_KEY — encrypted wallets would be lost on restart.');
  process.exit(1);
}
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ENCRYPTION_IV_LENGTH = 16; // For AES, this is always 16 bytes
const ENCRYPTION_ALGORITHM = 'aes-256-cbc';

// Function to encrypt wallet private keys with more robust implementation
export function encryptPrivateKey(privateKey) {
  try {
    // Check if input is already encrypted
    if (privateKey && privateKey.includes(':') && privateKey.split(':').length === 2) {
      try {
        // Try decrypting to see if it's valid - if it succeeds, it's already encrypted
        const decrypted = decryptPrivateKey(privateKey);
        if (decrypted && decrypted.startsWith('0x')) {
          console.log('Key appears to be already encrypted, skipping encryption');
          return privateKey;
        }
      } catch (e) {
        // Failed to decrypt, might not be a valid encrypted key
        console.log('Could not verify if already encrypted, proceeding with encryption');
      }
    }

    // If no valid private key, return original to avoid errors
    if (!privateKey || typeof privateKey !== 'string') {
      console.error('Invalid private key format for encryption');
      return privateKey;
    }

    // Create proper encryption with secure IV
    const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(privateKey);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (error) {
    console.error('Error encrypting private key:', error);
    // In case of encryption failure, still return original to prevent data loss
    return privateKey;
  }
}

// Function to decrypt wallet private keys with improved error handling
export function decryptPrivateKey(encryptedData) {
  try {
    // Handle case when data is not encrypted
    if (!encryptedData || typeof encryptedData !== 'string') {
      return encryptedData;
    }

    const textParts = encryptedData.split(':');
    if (textParts.length !== 2) {
      // Not encrypted or invalid format
      return encryptedData;
    }
    
    // Proceed with decryption
    const iv = Buffer.from(textParts[0], 'hex');
    const encryptedText = Buffer.from(textParts[1], 'hex');
    
    // Validate IV length to prevent errors
    if (iv.length !== ENCRYPTION_IV_LENGTH) {
      console.error('Invalid IV length in encrypted data');
      return encryptedData;
    }
    
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error('Error decrypting private key:', error);
    return encryptedData; // Return original if decryption fails
  }
}

// Initialize wallet tables
export async function initializeWalletTables() {
  try {
    // Permanently remove user_wallets table if it exists
    await pool.query(`DROP TABLE IF EXISTS user_wallets CASCADE`);
    console.log('✅ Permanently removed user_wallets table');

    // Permanently remove wallet_balances table if it exists
    await pool.query(`DROP TABLE IF EXISTS wallet_balances CASCADE`);
    console.log('✅ Permanently removed wallet_balances table');
    
    console.log('Wallet tables cleanup completed successfully');
    return true;
  } catch (error) {
    console.error('Error during wallet tables cleanup:', error);
    return false;
  }
}

// Check if a wallet already exists (using users table only)
export async function walletExists(walletAddress) {
  try {
    const result = await pool.query(
      'SELECT id FROM users WHERE wallet_address = $1',
      [walletAddress]
    );

    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking if wallet exists:', error);
    return false;
  }
}

// Check if a private key exists in the system (using users table only)
export async function getWalletByPrivateKey(privateKey) {
  try {
    // Try direct match (for unencrypted keys)
    const directResult = await pool.query(
      `SELECT id, wallet_address, id as user_id, wallet_created_at as created_at, 
              true as is_generated, wallet_key_encrypted as is_encrypted, wallet_private_key as private_key,
              coins as balance
       FROM users
       WHERE wallet_private_key = $1
       LIMIT 1`,
      [privateKey]
    );

    if (directResult.rows.length > 0) {
      return directResult.rows[0];
    }

    // If not found, get all users with encrypted keys and try decrypting
    const allUsers = await pool.query(
      `SELECT id, wallet_address, id as user_id, wallet_created_at as created_at,
              true as is_generated, wallet_key_encrypted as is_encrypted, wallet_private_key as private_key,
              coins as balance
       FROM users
       WHERE wallet_key_encrypted = true AND wallet_private_key IS NOT NULL`
    );

    for (const user of allUsers.rows) {
      const decryptedKey = decryptPrivateKey(user.private_key);
      if (decryptedKey === privateKey) {
        return user;
      }
    }

    return null;
  } catch (error) {
    console.error('Error getting wallet by private key:', error);
    return null;
  }
}

// Simplified wallet creation check - no limits enforced
export async function checkWalletCreationLimits(userId) {
  try {
    // Always allow wallet creation - no limits
    return {
      canCreate: true,
      walletsRemaining: 999,
      message: 'Wallet creation allowed.'
    };
  } catch (error) {
    console.error('Error in wallet creation check:', error);
    return {
      canCreate: true,
      walletsRemaining: 999,
      message: 'Wallet creation allowed.'
    };
  }
}

// ✅ AUTO-GENERATE WALLET FOR NEW USER - CRYPTOGRAPHICALLY SECURE KEY GENERATION
export async function generateWalletForNewUser(userId, email) {
  try {
    // Generate cryptographically secure random private key (32 bytes = 64 hex chars)
    const privateKey = '0x' + crypto.randomBytes(32).toString('hex');
    
    // Generate wallet address from private key hash
    const addressSeed = crypto.createHash('sha256').update(privateKey).digest('hex');
    const walletAddress = '0x' + addressSeed.substring(0, 40);
    
    // Encrypt private key before saving to database
    const encryptedKey = encryptPrivateKey(privateKey);
    const timestamp = Date.now();
    await safeQuery(
      `UPDATE users 
       SET wallet_address = $1, wallet_private_key = $2, wallet_created_at = $3, wallet_key_encrypted = true
       WHERE id = $4`,
      [walletAddress, encryptedKey, timestamp, userId]
    );
    
    console.log(`✅ Auto-created wallet for user ${userId}: ${walletAddress}`);
    
    return {
      id: userId,
      wallet_address: walletAddress,
      user_id: userId,
      created_at: timestamp,
      balance: 0
    };
  } catch (error) {
    console.error('Error generating wallet for new user:', error.message || error);
    // Don't throw - wallet creation is not critical for signup
    return null;
  }
}

// Create a new wallet (using users table only)
export async function createWallet(userId, walletAddress, privateKey) {
  try {
    // Start a transaction
    await pool.query('BEGIN');

    // Check if this wallet already exists in users table
    const existingWallet = await pool.query(
      'SELECT id FROM users WHERE wallet_address = $1',
      [walletAddress]
    );

    if (existingWallet.rows.length > 0) {
      await pool.query('ROLLBACK');
      throw new Error('Wallet address already exists in the system');
    }

    // Encrypt the private key
    const encryptedPrivateKey = encryptPrivateKey(privateKey);
    const isEncrypted = encryptedPrivateKey !== privateKey;

    const timestamp = Date.now();

    // Update user with wallet information
    await pool.query(
      `UPDATE users 
       SET wallet_address = $1, wallet_private_key = $2, wallet_created_at = $3, wallet_key_encrypted = $4
       WHERE id = $5`,
      [walletAddress, encryptedPrivateKey, timestamp, isEncrypted, userId]
    );

    // Commit the transaction
    await pool.query('COMMIT');

    // Return the wallet data
    return {
      id: userId,
      wallet_address: walletAddress,
      user_id: userId,
      created_at: timestamp,
      last_used_at: timestamp,
      is_generated: true,
      balance: 0
    };
  } catch (error) {
    // Rollback on error
    await pool.query('ROLLBACK');
    console.error('Error creating wallet:', error);
    throw error;
  }
}

// Get all wallets for a user (using users table only)
export async function getUserWallets(userId) {
  try {
    const result = await pool.query(
      `SELECT id, wallet_address, true as is_generated, wallet_created_at as created_at, wallet_created_at as last_used_at,
              coins as balance, true as is_active
       FROM users
       WHERE id = $1 AND wallet_address IS NOT NULL`,
      [userId]
    );

    return result.rows;
  } catch (error) {
    console.error('Error getting user wallets:', error);
    return [];
  }
}

// Set active wallet for a user (using users table only)
export async function setActiveWallet(userId, walletAddress, privateKey) {
  try {
    // Update the users table with the new active wallet
    const timestamp = Date.now();
    
    // Encrypt the private key for storage
    const encryptedPrivateKey = encryptPrivateKey(privateKey);

    await pool.query(
      `UPDATE users 
       SET wallet_address = $1, wallet_private_key = $2, wallet_created_at = $3, wallet_key_encrypted = true
       WHERE id = $4`,
      [walletAddress, encryptedPrivateKey, timestamp, userId]
    );

    return true;
  } catch (error) {
    console.error('Error setting active wallet:', error);
    return false;
  }
}

// Get transactions for a wallet with improved error handling and retry logic
export async function getWalletTransactions(walletAddress) {
  let retries = 3;

  while (retries > 0) {
    try {
      // Use more specific column selection to improve performance
      const result = await pool.query(
        `SELECT id, sender, recipient, sender_address, recipient_address, 
                amount::numeric as amount, timestamp, hash, status, 
                COALESCE(description, '') as description,
                gas_fee::numeric as gas_fee,
                CASE WHEN sender_address = $1 THEN 'outgoing' ELSE 'incoming' END as type
         FROM transactions
         WHERE sender_address = $1 OR recipient_address = $1
         ORDER BY timestamp DESC
         LIMIT 100`,
        [walletAddress]
      );

      console.log(`Retrieved ${result.rows.length} transactions for wallet ${walletAddress}`);

      // Process transaction amounts to ensure they're proper numeric values with consistent display format
      const transactions = result.rows.map(tx => {
        // Ensure amount is properly parsed as a float with full precision
        const amount = typeof tx.amount === 'string' ? parseFloat(tx.amount) : 
                       typeof tx.amount === 'number' ? tx.amount : 0;
        
        // Ensure gas fee is properly parsed
        const gasFee = typeof tx.gas_fee === 'string' ? parseFloat(tx.gas_fee) : 
                      typeof tx.gas_fee === 'number' ? tx.gas_fee : 0.00002;
        
        // Format the amount string, preserving leading zeros for small decimals
        // For very small numbers, ensure they display properly by forcing string conversion with fixed precision
        const amountDisplay = amount.toFixed(8);
        // Format gas fee string
        const gasFeeDisplay = gasFee.toFixed(8);
        
        return {
          ...tx,
          amount: amount,
          // Always show 8 decimal places for consistent display of small amounts
          amount_display: amountDisplay, 
          amount_string: amountDisplay, // Add extra field for UI display
          gas_fee: gasFee,
          gas_fee_display: gasFeeDisplay,
          date: new Date(Number(tx.timestamp)).toISOString()
        };
      });

      return transactions;
    } catch (error) {
      retries--;
      console.error(`Error getting wallet transactions (retries left: ${retries}):`, error);
      // Wait before retrying
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  // Return empty array if all retries failed
  console.error(`Failed to retrieve transactions for wallet ${walletAddress} after multiple attempts`);
  return [];
}

// Get all transactions for a user
export async function getUserTransactions(userId) {
  try {
    // First get all wallets belonging to this user
    const walletsResult = await pool.query(
      'SELECT wallet_address FROM user_wallets WHERE user_id = $1',
      [userId]
    );

    // Also get the wallet from users table (backward compatibility)
    const userWalletResult = await pool.query(
      'SELECT wallet_address FROM users WHERE id = $1 AND wallet_address IS NOT NULL',
      [userId]
    );

    // Combine all addresses
    const walletAddresses = [
      ...walletsResult.rows.map(row => row.wallet_address),
      ...(userWalletResult.rows.length > 0 ? [userWalletResult.rows[0].wallet_address] : [])
    ];

    // If no wallets, return empty array
    if (walletAddresses.length === 0) {
      return [];
    }

    // Get all transactions for these wallets
    const transactionsResult = await pool.query(
      `SELECT id, sender, recipient, sender_address, recipient_address, 
              amount::numeric as amount, timestamp, hash, status, 
              COALESCE(description, '') as description,
              gas_fee::numeric as gas_fee,
              CASE 
                WHEN sender_address = ANY($1) THEN 'outgoing' 
                WHEN recipient_address = ANY($1) THEN 'incoming'
                ELSE 'unknown' 
              END as type
       FROM transactions
       WHERE sender_address = ANY($1) OR recipient_address = ANY($1)
       ORDER BY timestamp DESC
       LIMIT 100`,
      [walletAddresses]
    );

    // Process the result for client-side consumption
    const transactions = transactionsResult.rows.map(tx => ({
      ...tx,
      amount: parseFloat(tx.amount),
      gas_fee: parseFloat(tx.gas_fee || 0),
      date: new Date(Number(tx.timestamp)).toISOString(),
      from: tx.sender_address,
      to: tx.recipient_address,
      isOutgoing: tx.type === 'outgoing'
    }));

    console.log(`Found ${transactions.length} transactions for user ${userId}`);
    return transactions;
  } catch (error) {
    console.error('Error fetching user transactions:', error);
    return [];
  }
}