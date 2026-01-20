import { pool } from './db.js';
import { getNetworkNode } from './network-api.js';

async function updateTransactionInput() {
  try {
    console.log('🔧 Updating transaction input data from blockchain...');

    const networkNode = getNetworkNode();
    if (!networkNode || !networkNode.blockchain) {
      throw new Error('Network not available');
    }

    // Get all transactions from blockchain
    const allTransactions = networkNode.blockchain.getAllTransactions();
    
    let updated = 0;
    for (const tx of allTransactions) {
      if (tx.input || tx.data) {
        try {
          const result = await pool.query(
            `UPDATE transactions 
             SET input = $1 
             WHERE (hash = $2 OR tx_hash = $2) AND input IS NULL`,
            [tx.input || tx.data, tx.hash || tx.txId]
          );
          
          if (result.rowCount > 0) {
            updated++;
            console.log(`✅ Updated transaction ${tx.hash} with input data (${(tx.input || tx.data).length} bytes)`);
          }
        } catch (error) {
          console.warn(`Warning: Could not update transaction ${tx.hash}:`, error.message);
        }
      }
    }

    console.log(`✅ Updated ${updated} transactions with input data`);
    return { success: true, updated };

  } catch (error) {
    console.error('❌ Error updating transaction input:', error);
    return { success: false, error: error.message };
  } finally {
    process.exit(0);
  }
}

// Run the update
updateTransactionInput();
