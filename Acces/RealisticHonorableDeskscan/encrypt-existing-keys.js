
// Script to encrypt existing wallet private keys
import { pool } from './db.js';
import { encryptPrivateKey } from './wallet-manager.js';

// Main function to encrypt existing wallet private keys
async function encryptExistingKeys() {
  try {
    console.log('Starting encryption of existing wallet private keys...');

    // Connect to database
    const client = await pool.connect();
    console.log('Successfully connected to database');

    // Encrypt keys in user_wallets table
    console.log('Encrypting private keys in user_wallets table...');
    const walletResult = await client.query(`
      SELECT id, private_key, is_encrypted 
      FROM user_wallets 
      WHERE (is_encrypted = false OR is_encrypted IS NULL)
    `);

    // Encrypt each unencrypted private key
    let walletKeysEncrypted = 0;
    for (const wallet of walletResult.rows) {
      try {
        const encryptedKey = encryptPrivateKey(wallet.private_key);
        
        // Only update if encryption succeeded and produced a different value
        if (encryptedKey !== wallet.private_key) {
          await client.query(
            'UPDATE user_wallets SET private_key = $1, is_encrypted = true WHERE id = $2',
            [encryptedKey, wallet.id]
          );
          walletKeysEncrypted++;
        }
      } catch (error) {
        console.error('Error encrypting private key:', error);
      }
    }
    console.log(`Encrypted ${walletKeysEncrypted} private keys in user_wallets table`);

    // Encrypt keys in users table (legacy storage)
    console.log('Encrypting private keys in users table...');
    const usersResult = await client.query(`
      SELECT id, wallet_private_key, wallet_key_encrypted
      FROM users 
      WHERE wallet_private_key IS NOT NULL 
      AND (wallet_key_encrypted = false OR wallet_key_encrypted IS NULL)
    `);

    // Encrypt each unencrypted private key
    let userKeysEncrypted = 0;
    for (const user of usersResult.rows) {
      try {
        const encryptedKey = encryptPrivateKey(user.wallet_private_key);
        
        // Only update if encryption succeeded and produced a different value
        if (encryptedKey !== user.wallet_private_key) {
          await client.query(
            'UPDATE users SET wallet_private_key = $1, wallet_key_encrypted = true WHERE id = $2',
            [encryptedKey, user.id]
          );
          userKeysEncrypted++;
        }
      } catch (error) {
        console.error('Error encrypting private key:', error);
      }
    }
    console.log(`Encrypted ${userKeysEncrypted} private keys in users table`);

    client.release();
    console.log('Private key encryption completed successfully!');
  } catch (error) {
    console.error('Error in encryption process:', error);
  }
}

// Run the function
encryptExistingKeys();
