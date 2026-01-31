// Explorer API متوافق مع Etherscan لدعم المحافظ والمنصات
import { pool } from './db.js';

// دالة إنشاء hash موحد (نفس المنطق المستخدم في النظام)
function createUnifiedTransactionHash(fromAddr, toAddr, amount, timestamp, nonce = 0) {
  const crypto = require('crypto');

  const normalizedFrom = (fromAddr || 'genesis').toLowerCase();
  const normalizedTo = (toAddr || '').toLowerCase();
  const normalizedAmount = parseFloat(amount || 0).toFixed(8);
  const normalizedTimestamp = parseInt(timestamp || Date.now());
  const normalizedNonce = parseInt(nonce || 0);

  const hashData = `${normalizedFrom}${normalizedTo}${normalizedAmount}${normalizedTimestamp}${normalizedNonce}`;
  return crypto.createHash('sha256').update(hashData).digest('hex');
}

// تطبيق hash موحد على جميع المعاملات في الاستجابة
function unifyTransactionHashes(transactions) {
  return transactions.map(tx => {
    // إنشاء hash موحد باستخدام نفس المنطق
    const unifiedHash = createUnifiedTransactionHash(
      tx.from || tx.fromAddress || tx.sender_address,
      tx.to || tx.toAddress || tx.recipient_address,
      tx.amount || tx.value,
      tx.timestamp,
      tx.nonce || 0
    );

    // توحيد جميع حقول hash
    return {
      ...tx,
      hash: unifiedHash,
      txId: unifiedHash,
      transactionHash: unifiedHash,
      id: unifiedHash,
      // الحفاظ على الحقول الأصلية للتوافق
      originalHash: tx.hash || tx.txId || tx.transactionHash
    };
  });
}


class ExplorerAPI {
  constructor(blockchain) {
    this.blockchain = blockchain;
  }

  // API متوافق مع Etherscan
  async handleExplorerRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const params = Object.fromEntries(url.searchParams);

    try {
      let result;

      switch (params.module) {
        case 'account':
          result = await this.handleAccountModule(params);
          break;
        case 'transaction':
          result = await this.handleTransactionModule(params);
          break;
        case 'block':
          result = await this.handleBlockModule(params);
          break;
        case 'stats':
          result = await this.handleStatsModule(params);
          break;
        default:
          throw new Error('Invalid module');
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200);
      res.end(JSON.stringify({
        status: '1',
        message: 'OK',
        result: result
      }));

    } catch (error) {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: '0',
        message: error.message,
        result: null
      }));
    }
  }

  async handleAccountModule(params) {
    const { action, address, startblock, endblock, sort } = params;

    switch (action) {
      case 'balance':
        const balance = this.blockchain.getBalance(address);
        return Math.floor(balance * 1e18).toString(); // في wei

      case 'balancemulti':
        const addresses = address.split(',');
        const balances = addresses.map(addr => ({
          account: addr,
          balance: Math.floor(this.blockchain.getBalance(addr) * 1e18).toString()
        }));
        return balances;

      case 'txlist':
        const transactions = await this.getTransactionsByAddress(address, startblock, endblock, sort);
        return unifyTransactionHashes(transactions);

      default:
        throw new Error('Invalid action for account module');
    }
  }

  async handleTransactionModule(params) {
    const { action, txhash } = params;

    switch (action) {
      case 'gettxreceiptstatus':
        const tx = this.blockchain.getTransactionByHash(txhash);
        return {
          status: tx ? '1' : '0'
        };

      default:
        throw new Error('Invalid action for transaction module');
    }
  }

  async handleBlockModule(params) {
    const { action, blockno } = params;

    switch (action) {
      case 'getblockreward':
        return {
          blockNumber: blockno,
          timeStamp: Math.floor(Date.now() / 1000).toString(),
          blockMiner: 'access-system-miner',
          blockReward: Math.floor(this.blockchain.processingReward * 1e18).toString()
        };

      default:
        throw new Error('Invalid action for block module');
    }
  }

  async handleStatsModule(params) {
    const { action } = params;

    switch (action) {
      case 'tokensupply':
        const supply = await this.blockchain.calculateCirculatingSupply();
        return Math.floor(supply * 1e18).toString();

      case 'chainsize':
        return {
          blockNumber: this.blockchain.chain.length - 1,
          chainSize: JSON.stringify(this.blockchain.chain).length,
          clientType: 'AccessNode'
        };

      default:
        throw new Error('Invalid action for stats module');
    }
  }

  async getTransactionsByAddress(address, startblock = 0, endblock = 'latest', sort = 'desc') {
    try {
      // البحث في قاعدة البيانات أولاً
      const result = await pool.query(`
        SELECT tx_hash, from_address, to_address, amount, timestamp, block_index, block_hash, nonce
        FROM blockchain_transactions 
        WHERE from_address = $1 OR to_address = $1
        ORDER BY timestamp ${sort === 'desc' ? 'DESC' : 'ASC'}
        LIMIT 1000
      `, [address]);

      const transactions = result.rows.map(row => {
        const singleHash = row.tx_hash;
        return {
          blockNumber: row.block_index?.toString() || '0',
          timeStamp: Math.floor(row.timestamp / 1000).toString(),
          hash: singleHash,
          txId: singleHash,
          transactionHash: singleHash,
          id: singleHash,
          from: row.from_address,
          to: row.to_address,
          value: Math.floor((row.amount || 0) * 1e18).toString(),
          gas: '21000',
          gasPrice: Math.floor(this.blockchain.getGasPrice() * 1e18 / 21000).toString(), // ✅ صحيح: gasPrice per unit
          gasUsed: '21000',
          input: '0x',
          contractAddress: '',
          cumulativeGasUsed: '21000',
          txreceipt_status: '1',
          confirmations: this.blockchain.chain.length - (row.block_index || 0),
          nonce: row.nonce
      }});

      return transactions;
    } catch (error) {
      console.error('Error getting transactions by address:', error);
      return [];
    }
  }
}

// Utility functions for compatibility
async function getTransactionDetails(txHash) {
  // This function can be implemented if needed
  return null;
}

async function getBlockDetails(blockId) {
  // This function can be implemented if needed
  return null;
}

async function searchBlockchain(query) {
  // This function can be implemented if needed
  return { results: [] };
}

async function getNetworkStats() {
  // This function can be implemented if needed
  return { 
    totalTransactions: 0,
    latestBlock: 0,
    difficulty: 1
  };
}

async function getRecentTransactions(limit = 10) {
  // This function can be implemented if needed
  return [];
}

async function getRecentBlocks(limit = 10) {
  // This function can be implemented if needed
  return [];
}

async function handleExplorerAPI(req, res, pathname, method) {
  // This function can be implemented if needed
  return false;
}

// Export all functions
export {
  ExplorerAPI,
  getTransactionDetails,
  getBlockDetails,
  searchBlockchain,
  getNetworkStats,
  getRecentTransactions,
  getRecentBlocks,
  handleExplorerAPI,
  createUnifiedTransactionHash,
  unifyTransactionHashes
};