
// نظام معالجة المعاملات المتوازية
import { Worker } from 'worker_threads';
import cluster from 'cluster';
import os from 'os';

class ParallelTransactionProcessor {
  constructor() {
    this.numCPUs = os.cpus().length;
    this.workers = [];
    this.taskQueue = [];
    this.maxQueueSize = 1000000; // مليون معاملة في الطابور
    this.processingRate = 0;
    
    this.initializeWorkers();
    this.startPerformanceMonitoring();
  }

  // تهيئة العمليات المتوازية
  initializeWorkers() {
    if (cluster.isMaster) {
      // إنشاء عامل لكل معالج
      for (let i = 0; i < this.numCPUs; i++) {
        const worker = cluster.fork();
        this.workers.push(worker);
        
        worker.on('message', (result) => {
          this.handleWorkerResult(result);
        });
      }
      
      console.log(`🚀 تم تشغيل ${this.numCPUs} عامل متوازي للمعالجة`);
    }
  }

  // معالجة المعاملات بالتوازي
  async processTransactionsBatch(transactions) {
    // تقسيم المعاملات على العمال
    const batchSize = Math.ceil(transactions.length / this.numCPUs);
    const batches = [];
    
    for (let i = 0; i < transactions.length; i += batchSize) {
      batches.push(transactions.slice(i, i + batchSize));
    }

    // توزيع العمل على العمال
    const promises = batches.map((batch, index) => {
      return this.processInWorker(batch, index);
    });

    // انتظار اكتمال جميع العمليات
    const results = await Promise.all(promises);
    
    // دمج النتائج
    return results.flat();
  }

  // معالجة في عامل منفصل
  processInWorker(batch, workerIndex) {
    return new Promise((resolve, reject) => {
      const worker = this.workers[workerIndex % this.workers.length];
      
      const taskId = Date.now() + Math.random();
      
      worker.send({
        type: 'PROCESS_BATCH',
        taskId: taskId,
        batch: batch
      });

      // انتظار النتيجة
      const onMessage = (message) => {
        if (message.taskId === taskId) {
          worker.off('message', onMessage);
          
          if (message.type === 'BATCH_COMPLETE') {
            resolve(message.results);
          } else if (message.type === 'BATCH_ERROR') {
            reject(new Error(message.error));
          }
        }
      };

      worker.on('message', onMessage);
    });
  }

  // مراقبة الأداء
  startPerformanceMonitoring() {
    setInterval(() => {
      const queueLength = this.taskQueue.length;
      const memoryUsage = process.memoryUsage();
      
      console.log(`📊 أداء المعالجة:`);
      console.log(`   - طابور المعاملات: ${queueLength.toLocaleString()}`);
      console.log(`   - معدل المعالجة: ${this.processingRate}/ثانية`);
      console.log(`   - استخدام الذاكرة: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`);
      console.log(`   - العمال النشطون: ${this.workers.length}`);
      
      // تحذير إذا امتلأ الطابور
      if (queueLength > this.maxQueueSize * 0.8) {
        console.warn(`⚠️ تحذير: الطابور ممتلئ بنسبة ${Math.round(queueLength / this.maxQueueSize * 100)}%`);
      }
      
    }, 10000); // كل 10 ثوان
  }

  // معالجة الطابور الذكي
  async smartQueueProcessing() {
    while (this.taskQueue.length > 0) {
      // أخذ دفعة من المعاملات
      const batch = this.taskQueue.splice(0, 1000);
      
      // معالجة متوازية
      const startTime = Date.now();
      await this.processTransactionsBatch(batch);
      const endTime = Date.now();
      
      // حساب معدل المعالجة
      this.processingRate = Math.round(batch.length / ((endTime - startTime) / 1000));
    }
  }

  // إضافة معاملات للطابور
  addTransactions(transactions) {
    if (this.taskQueue.length + transactions.length > this.maxQueueSize) {
      console.warn('⚠️ تحذير: الطابور ممتلئ - تجاهل معاملات جديدة');
      return false;
    }
    
    this.taskQueue.push(...transactions);
    
    // بدء المعالجة إذا لم تكن نشطة
    if (!this.processing) {
      this.processing = true;
      this.smartQueueProcessing().finally(() => {
        this.processing = false;
      });
    }
    
    return true;
  }
}

// عامل المعالجة (Worker Process)
if (!cluster.isMaster) {
  process.on('message', async (message) => {
    if (message.type === 'PROCESS_BATCH') {
      try {
        // معالجة دفعة المعاملات
        const results = await processBatchInWorker(message.batch);
        
        process.send({
          type: 'BATCH_COMPLETE',
          taskId: message.taskId,
          results: results
        });
        
      } catch (error) {
        process.send({
          type: 'BATCH_ERROR',
          taskId: message.taskId,
          error: error.message
        });
      }
    }
  });
}

// دالة معالجة الدفعة في العامل
async function processBatchInWorker(batch) {
  const results = [];
  
  for (const transaction of batch) {
    try {
      // معالجة المعاملة
      const result = {
        hash: transaction.hash,
        status: 'processed',
        timestamp: Date.now()
      };
      
      results.push(result);
      
    } catch (error) {
      results.push({
        hash: transaction.hash,
        status: 'failed',
        error: error.message
      });
    }
  }
  
  return results;
}

export default ParallelTransactionProcessor;
