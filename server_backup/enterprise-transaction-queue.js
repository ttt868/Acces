import { pool } from './db.js';
import { EventEmitter } from 'events';

class EnterpriseTransactionQueue extends EventEmitter {
  constructor() {
    super();
    this.processingBatchSize = 1000;
    this.maxRetries = 3;
    this.processingInterval = 500;
    this.isProcessing = false;
    this.stats = {
      totalProcessed: 0,
      totalFailed: 0,
      averageProcessingTime: 0,
      throughput: 0
    };
    
    this.startAutoProcessing();
    this.startStatsMonitoring();
  }

  async addToQueue(transaction) {
    try {
      const { hash, from, to, value, gasPrice = 0, priority = 1 } = transaction;
      
      const result = await pool.query(`
        INSERT INTO transaction_queue 
        (tx_hash, from_address, to_address, value, gas_price, priority, created_at, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
        ON CONFLICT (tx_hash) DO NOTHING
        RETURNING id
      `, [hash, from.toLowerCase(), to.toLowerCase(), value, gasPrice, priority, Date.now()]);
      
      if (result.rows.length > 0) {
        this.emit('transactionQueued', { hash, priority });
        return { success: true, queueId: result.rows[0].id };
      }
      
      return { success: false, reason: 'duplicate' };
    } catch (error) {
      console.error('خطأ في إضافة المعاملة للطابور:', error);
      return { success: false, error: error.message };
    }
  }

  async processBatch() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    const startTime = Date.now();
    
    try {
      const pendingTxs = await pool.query(`
        SELECT * FROM transaction_queue
        WHERE status = 'pending' AND retry_count < $1
        ORDER BY priority DESC, created_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      `, [this.maxRetries, this.processingBatchSize]);
      
      if (pendingTxs.rows.length === 0) {
        this.isProcessing = false;
        return;
      }
      
      console.log(`⚡ معالجة ${pendingTxs.rows.length} معاملة من الطابور...`);
      
      const batchPromises = pendingTxs.rows.map(tx => this.processTransaction(tx));
      const results = await Promise.allSettled(batchPromises);
      
      let successCount = 0;
      let failCount = 0;
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.success) {
          successCount++;
        } else {
          failCount++;
        }
      });
      
      this.stats.totalProcessed += successCount;
      this.stats.totalFailed += failCount;
      
      const processingTime = Date.now() - startTime;
      this.stats.averageProcessingTime = 
        (this.stats.averageProcessingTime * 0.9) + (processingTime * 0.1);
      this.stats.throughput = Math.round((successCount / (processingTime / 1000)) * 100) / 100;
      
      console.log(`✅ نجح: ${successCount} | ❌ فشل: ${failCount} | ⚡ السرعة: ${this.stats.throughput} tx/s`);
      
      await pool.query(`
        INSERT INTO performance_stats (metric_name, metric_value, timestamp, metadata)
        VALUES ($1, $2, $3, $4)
      `, [
        'transaction_throughput',
        this.stats.throughput,
        Date.now(),
        JSON.stringify({ batch_size: pendingTxs.rows.length, success: successCount, failed: failCount })
      ]);
      
    } catch (error) {
      console.error('خطأ في معالجة الدفعة:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async processTransaction(queuedTx) {
    try {
      await pool.query(`
        UPDATE transaction_queue
        SET status = 'processing', processed_at = $1
        WHERE id = $2
      `, [Date.now(), queuedTx.id]);
      
      this.emit('transactionProcessing', queuedTx);
      
      await pool.query(`
        UPDATE transaction_queue
        SET status = 'completed', processed_at = $1
        WHERE id = $2
      `, [Date.now(), queuedTx.id]);
      
      this.emit('transactionCompleted', queuedTx);
      
      return { success: true };
      
    } catch (error) {
      const newRetryCount = queuedTx.retry_count + 1;
      const newStatus = newRetryCount >= this.maxRetries ? 'failed' : 'pending';
      
      await pool.query(`
        UPDATE transaction_queue
        SET status = $1, retry_count = $2, error_message = $3
        WHERE id = $4
      `, [newStatus, newRetryCount, error.message, queuedTx.id]);
      
      if (newStatus === 'failed') {
        this.emit('transactionFailed', { ...queuedTx, error: error.message });
      }
      
      return { success: false, error: error.message };
    }
  }

  startAutoProcessing() {
    setInterval(() => {
      this.processBatch();
    }, this.processingInterval);
    
    console.log(`🚀 نظام الطابور المتقدم بدأ - معالجة كل ${this.processingInterval}ms`);
  }

  startStatsMonitoring() {
    setInterval(async () => {
      const queueStats = await pool.query(`
        SELECT 
          status,
          COUNT(*) as count,
          AVG(retry_count) as avg_retries
        FROM transaction_queue
        GROUP BY status
      `);
      
      console.log('📊 إحصائيات الطابور:');
      queueStats.rows.forEach(stat => {
        console.log(`   ${stat.status}: ${stat.count} معاملة (متوسط المحاولات: ${parseFloat(stat.avg_retries || 0).toFixed(2)})`);
      });
      console.log(`   إنتاجية: ${this.stats.throughput} tx/s | معالج كلي: ${this.stats.totalProcessed}`);
    }, 30000);
  }

  async getQueueStatus() {
    const result = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM transaction_queue
      GROUP BY status
    `);
    
    return {
      stats: this.stats,
      queueStatus: result.rows,
      timestamp: Date.now()
    };
  }

  async clearCompleted(olderThanMs = 3600000) {
    const cutoffTime = Date.now() - olderThanMs;
    
    const result = await pool.query(`
      DELETE FROM transaction_queue
      WHERE status = 'completed' AND processed_at < $1
    `, [cutoffTime]);
    
    console.log(`🧹 تم حذف ${result.rowCount} معاملة مكتملة من الطابور`);
    return result.rowCount;
  }
}

export default EnterpriseTransactionQueue;
