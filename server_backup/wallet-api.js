// Wallet API - handles wallet-related API endpoints
import { pool } from './db.js';
import {
  checkWalletCreationLimits,
  createWallet,
  getUserWallets,
  getWalletTransactions,
  walletExists,
  getWalletByPrivateKey,
  setActiveWallet,
  MAX_WALLETS_PER_USER
} from './wallet-manager.js';

// ✅ OPTIMIZED: QR codes are now generated dynamically on client-side
// No need to save QR code HTML to database - saves resources!
// This function is kept for backward compatibility but does nothing
async function ensureQRCodeData(userId, walletAddress) {
  // QR code is generated dynamically from wallet_address on client
  console.log(`QR code will be generated dynamically for user ${userId}`);
  return true;
}

// API handler for generating a new wallet
async function handleGenerateWallet(req, res) {
  try {
    const { userId } = req.body;

    if (!userId) {
      return {
        status: 400,
        body: { 
          success: false, 
          error: 'Missing required parameters' 
        }
      };
    }

    // Check if user can create a new wallet
    const creationLimits = await checkWalletCreationLimits(userId);

    if (!creationLimits.canCreate) {
      return {
        status: 403,
        body: { 
          success: false, 
          error: creationLimits.message,
          limits: creationLimits
        }
      };
    }

    // Generate random wallet credentials - In a real system, this would be much more secure
    const crypto = await import('crypto');
    const privateKey = '0x' + crypto.randomBytes(32).toString('hex');
    const walletAddress = '0x' + crypto.randomBytes(20).toString('hex');

    // Create the wallet - this will encrypt the private key
    const wallet = await createWallet(userId, walletAddress, privateKey);

    return {
      status: 201,
      body: {
        success: true,
        message: 'Wallet generated successfully',
        wallet: {
          address: wallet.wallet_address,
          privateKey: privateKey, // Return unencrypted key to client for this session only
          balance: wallet.balance,
          created_at: wallet.created_at,
          encrypted: true
        }
      }
    };
  } catch (error) {
    console.error('Error in generateWallet API:', error);
    return {
      status: 500,
      body: { 
        success: false, 
        error: 'Server error generating wallet' 
      }
    };
  }
}

// API handler for importing an existing wallet
async function handleImportWallet(req, res) {
  try {
    const { userId, privateKey } = req.body;

    if (!userId || !privateKey) {
      return {
        status: 400,
        body: { 
          success: false, 
          error: 'Missing required parameters' 
        }
      };
    }

    // Check if private key exists in the system
    const existingWallet = await getWalletByPrivateKey(privateKey);

    if (existingWallet) {
      // If exists, associate with this user and set as active
      await setActiveWallet(userId, existingWallet.wallet_address, privateKey);

      return {
        status: 200,
        body: {
          success: true,
          message: 'Wallet imported successfully',
          wallet: {
            address: existingWallet.wallet_address,
            privateKey: privateKey,
            balance: existingWallet.balance || 0,
            created_at: existingWallet.created_at,
            imported: true
          }
        }
      };
    }

    // Private key not found, generate a wallet address for it
    const crypto = await import('crypto');
    const walletAddress = '0x' + crypto.randomBytes(20).toString('hex');

    // Create new wallet with the given private key
    const wallet = await createWallet(userId, walletAddress, privateKey);

    return {
      status: 201,
      body: {
        success: true,
        message: 'Wallet created from private key',
        wallet: {
          address: wallet.wallet_address,
          privateKey: privateKey,
          balance: wallet.balance || 0,
          created_at: wallet.created_at,
          imported: false
        }
      }
    };
  } catch (error) {
    console.error('Error in importWallet API:', error);
    return {
      status: 500,
      body: { 
        success: false, 
        error: 'Server error processing wallet import' 
      }
    };
  }
}

// API handler for getting all wallets for a user
async function handleGetUserWallets(req, res) {
  try {
    const { userId } = req.params;

    // Get all wallets for this user
    const wallets = await getUserWallets(userId);

    return {
      status: 200,
      body: {
        success: true,
        wallets
      }
    };
  } catch (error) {
    console.error('Error in getUserWallets API:', error);
    return {
      status: 500,
      body: { 
        success: false, 
        error: 'Server error retrieving wallets' 
      }
    };
  }
}

// API handler for getting transaction history for a wallet
async function handleGetWalletTransactions(req, res) {
  try {
    const { address } = req.params;

    // Get transactions for this wallet address
    const transactions = await getWalletTransactions(address);

    // Format transaction for display
    transactions.forEach(transaction => {
      transaction.amount = parseFloat(transaction.amount);
      transaction.formatted_amount = transaction.amount.toFixed(8);
    });

    return {
      status: 200,
      body: {
        success: true,
        transactions
      }
    };
  } catch (error) {
    console.error('Error in getWalletTransactions API:', error);
    return {
      status: 500,
      body: { 
        success: false, 
        error: 'Server error retrieving transactions' 
      }
    };
  }
}

// API handler for setting a user's active wallet
async function handleSetActiveWallet(req, res) {
  try {
    const { userId, walletAddress, privateKey } = req.body;

    if (!userId || !walletAddress || !privateKey) {
      return {
        status: 400,
        body: { 
          success: false, 
          error: 'Missing required parameters' 
        }
      };
    }

    // Set the active wallet
    await setActiveWallet(userId, walletAddress, privateKey);

    return {
      status: 200,
      body: {
        success: true,
        message: 'Active wallet updated successfully',
        walletAddress
      }
    };
  } catch (error) {
    console.error('Error in setActiveWallet API:', error);
    return {
      status: 500,
      body: { 
        success: false, 
        error: 'Server error updating active wallet' 
      }
    };
  }
}

// Deduct the amount from sender's balance with proper decimal precision
// Force 8 decimal places in the database to maintain consistent formatting
// Ensure zero values maintain all 8 decimal places with explicit casting
await pool.query(
  'UPDATE users SET coins = CAST($1 AS numeric(20,8)) WHERE id = $2', 
  [parseFloat(newSenderBalance).toFixed(8), sender]
);

// Add the amount to recipient's balance with proper decimal precision
// Force 8 decimal places in the database to maintain consistent formatting
// Ensure zero values maintain all 8 decimal places with explicit casting
await pool.query(
  'UPDATE users SET coins = CAST($1 AS numeric(20,8)) WHERE id = $2', 
  [parseFloat(newRecipientBalance).toFixed(8), recipient]
);

// Export all handlers in a single export statement
export {
  handleGenerateWallet,
  handleImportWallet,
  handleGetUserWallets,
  handleGetWalletTransactions,
  handleSetActiveWallet
};