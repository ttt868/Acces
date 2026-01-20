import { pool } from './db.js';
import { Worker } from 'worker_threads';
import os from 'os';
import { EventEmitter } from 'events';
import EnterpriseTransactionQueue from './enterprise-transaction-queue.js';
import ultraCache from './ultra-fast-cache.js';

class UltraFastProcessor extends EventEmitter {
  constructor() {
    super();
    
    this.numWorkers = Math.max(4, os.cpus().length);
    this.workers = [];
    this.taskQueue = [];
    this.maxConcurrentTransactions = 10000;
    this.processingBatchSize = 500;
    this.transactionQueue = new EnterpriseTransactionQueue();
    
    this.stats = {
      totalProcessed: 0,
      totalQueued: 0,
      peakThroughput: 0,
      currentThroughput: 0,
      avgProcessingTime: 0,
      queueSize: 0
    };
    
    this.rateLimitBypass = true;
    
    this.transactionQueue.on('transactionCompleted', (tx) => {
      this.stats.totalProcessed++;
      this.emit('transactionComplete', tx);
    });
    
    this.startMetricsCollection();
    
    console.log(`🚀 UltraFast Processor initialized with ${this.numWorkers} workers`);
    console.log(`⚡ Max concurrent transactions: ${this.maxConcurrentTransactions}`);
    console.log(`🔥 Rate limit bypass: ${this.rateLimitBypass ? 'ENABLED' : 'DISABLED'}`);
  }

  async processTransaction(txData) {
    const startTime = Date.now();
    
    try {
      if (!this.validateTransaction(txData)) {
        throw new Error('Invalid transaction data');
      }
      
      const { from, to, value, hash, gasPrice = 0, nonce, signature } = txData;
      const normalizedFrom = from.toLowerCase();
      const normalizedTo = to.toLowerCase();
      
      const senderBalance = await ultraCache.getBalance(normalizedFrom);
      
      if (senderBalance < value) {
        throw new Error(`Insufficient balance: ${senderBalance} < ${value}`);
      }
      
      const queueResult = await this.transactionQueue.addToQueue({
        hash,
        from: normalizedFrom,
        to: normalizedTo,
        value,
        gasPrice,
        priority: this.calculatePriority(gasPrice, value)
      });
      
      if (!queueResult.success) {
        if (queueResult.reason === 'duplicate') {
          return { success: false, error: 'Transaction already queued' };
        }
        throw new Error(queueResult.error || 'Failed to queue transaction');
      }
      
      const newSenderBalance = senderBalance - value;
      const recipientBalance = await ultraCache.getBalance(normalizedTo);
      const newRecipientBalance = recipientBalance + value;
      
      await this.updateBalances(normalizedFrom, normalizedTo, newSenderBalance, newRecipientBalance);
      
      ultraCache.setBalance(normalizedFrom, newSenderBalance, 'L1');
      ultraCache.setBalance(normalizedTo, newRecipientBalance, 'L1');
      
      const processingTime = Date.now() - startTime;
      this.updateStats(processingTime);
      
      this.emit('transactionProcessed', {
        hash,
        from: normalizedFrom,
        to: normalizedTo,
        value,
        processingTime,
        queueId: queueResult.queueId
      });
      
      return {
        success: true,
        hash,
        queueId: queueResult.queueId,
        processingTime
      };
      
    } catch (error) {
      console.error('❌ خطأ في معالجة المعاملة:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  validateTransaction(txData) {
    if (!txData.from || !txData.to || typeof txData.value === 'undefined') {
      return false;
    }
    
    if (!txData.from.startsWith('0x') || !txData.to.startsWith('0x')) {
      return false;
    }
    
    if (txData.from.length !== 42 || txData.to.length !== 42) {
      return false;
    }
    
    if (txData.value < 0) {
      return false;
    }
    
    return true;
  }

  calculatePriority(gasPrice, value) {
    const gasPriorityScore = gasPrice * 0.7;
    const valuePriorityScore = Math.min(value, 1000) * 0.3;
    
    return Math.floor(gasPriorityScore + valuePriorityScore);
  }

  async updateBalances(fromAddress, toAddress, senderBalance, recipientBalance) {
    try {
      const currentTime = Date.now();
      
      await pool.query(`
        INSERT INTO balance_cache (address, balance, last_updated, block_number, cache_level)
        VALUES ($1, $2, $3, 0, 1)
        ON CONFLICT (address) DO UPDATE SET
          balance = EXCLUDED.balance,
          last_updated = EXCLUDED.last_updated
      `, [fromAddress, senderBalance, currentTime]);
      
      await pool.query(`
        INSERT INTO balance_cache (address, balance, last_updated, block_number, cache_level)
        VALUES ($1, $2, $3, 0, 1)
        ON CONFLICT (address) DO UPDATE SET
          balance = EXCLUDED.balance,
          last_updated = EXCLUDED.last_updated
      `, [toAddress, recipientBalance, currentTime]);
      
      await pool.query(`
        UPDATE users SET coins = $1 WHERE LOWER(wallet_address) = $2
      `, [senderBalance.toFixed(8), fromAddress]);
      
      await pool.query(`
        UPDATE users SET coins = $1 WHERE LOWER(wallet_address) = $2
      `, [recipientBalance.toFixed(8), toAddress]);
      
      await pool.query(`
        INSERT INTO external_wallets (address, wallet_address, balance, first_seen, last_activity, is_active)
        VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT (address) DO UPDATE SET
          balance = EXCLUDED.balance,
          last_activity = EXCLUDED.last_activity
      `, [fromAddress, fromAddress, senderBalance.toFixed(8), currentTime, currentTime]);
      
      await pool.query(`
        INSERT INTO external_wallets (address, wallet_address, balance, first_seen, last_activity, is_active)
        VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT (address) DO UPDATE SET
          balance = EXCLUDED.balance,
          last_activity = EXCLUDED.last_activity
      `, [toAddress, toAddress, recipientBalance.toFixed(8), currentTime, currentTime]);
      
    } catch (error) {
      console.error('❌ خطأ في تحديث الأرصدة:', error);
      throw error;
    }
  }

  updateStats(processingTime) {
    this.stats.totalProcessed++;
    
    this.stats.avgProcessingTime = 
      (this.stats.avgProcessingTime * 0.95) + (processingTime * 0.05);
    
    const throughput = 1000 / this.stats.avgProcessingTime;
    this.stats.currentThroughput = Math.round(throughput * 100) / 100;
    
    if (this.stats.currentThroughput > this.stats.peakThroughput) {
      this.stats.peakThroughput = this.stats.currentThroughput;
    }
  }

  async processBatch(transactions) {
    const promises = transactions.map(tx => this.processTransaction(tx));
    const results = await Promise.allSettled(promises);
    
    return results.map((result, index) => ({
      transaction: transactions[index],
      success: result.status === 'fulfilled' && result.value.success,
      result: result.status === 'fulfilled' ? result.value : { error: result.reason }
    }));
  }

  startMetricsCollection() {
    setInterval(async () => {
      const queueStatus = await this.transactionQueue.getQueueStatus();
      this.stats.queueSize = queueStatus.queueStatus.reduce((sum, s) => sum + parseInt(s.count), 0);
      
      await pool.query(`
        INSERT INTO performance_stats (metric_name, metric_value, timestamp, metadata)
        VALUES ($1, $2, $3, $4)
      `, [
        'ultra_processor_throughput',
        this.stats.currentThroughput,
        Date.now(),
        JSON.stringify(this.stats)
      ]);
    }, 10000);
  }

  async getStats() {
    const cacheStats = ultraCache.getStats();
    const queueStatus = await this.transactionQueue.getQueueStatus();
    
    return {
      processor: this.stats,
      cache: cacheStats,
      queue: queueStatus,
      timestamp: Date.now()
    };
  }

  checkRateLimit(address) {
    return true;
  }

  async clearOldData() {
    await this.transactionQueue.clearCompleted();
    
    const oldCacheTime = Date.now() - (24 * 60 * 60 * 1000);
    await pool.query(`
      DELETE FROM balance_cache WHERE last_updated < $1
    `, [oldCacheTime]);
  }
}

const ultraProcessor = new UltraFastProcessor();
export default ultraProcessor;
