
<line_number>1</line_number>
// Autoscale Resource Optimizer - تحسين استهلاك الموارد لتوفير التكاليف
import { pool } from './db.js';

// إعدادات تحسين الموارد المحسنة لتوفير تكاليف Autoscale
const OPTIMIZATION_CONFIG = {
  // تقليل تكرار العمليات أكثر
  DATABASE_BATCH_SIZE: 50, // زيادة حجم الدفعة
  QUERY_TIMEOUT: 10000, // تقليل timeout
  CONNECTION_POOL_SIZE: 3, // تقليل الاتصالات
  
  // تحسين الذاكرة بقوة
  MAX_CACHE_SIZE: 50, // تقليل الكاش
  MEMORY_CLEANUP_THRESHOLD: 200, // تنظيف أسرع
  
  // تحسين الشبكة
  RESPONSE_COMPRESSION: true,
  KEEP_ALIVE_TIMEOUT: 60000, // زيادة timeout
  
  // تحسين العمليات للتركيز على الساعة الأخيرة
  LAZY_LOADING: true,
  DEBOUNCE_TIME: 5000, // زيادة التأخير
  FINAL_HOUR_FOCUS: true, // التركيز على الساعة الأخيرة
  MINIMAL_PROCESSING: true // معالجة بحد أدنى
};

// مراقب الموارد المحسن
class ResourceMonitor {
  constructor() {
    this.lastCleanup = 0;
    this.operationQueue = [];
    this.isProcessing = false;
  }

  // تجميع العمليات لتقليل استهلاك CPU
  async batchOperation(operation) {
    return new Promise((resolve, reject) => {
      this.operationQueue.push({ operation, resolve, reject });
      
      if (!this.isProcessing) {
        this.processBatch();
      }
    });
  }

  async processBatch() {
    if (this.operationQueue.length === 0) return;
    
    this.isProcessing = true;
    const batch = this.operationQueue.splice(0, OPTIMIZATION_CONFIG.DATABASE_BATCH_SIZE);
    
    try {
      await pool.query('BEGIN');
      
      for (const { operation, resolve, reject } of batch) {
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }
      
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Batch operation failed:', error.message);
    }
    
    this.isProcessing = false;
    
    // معالجة الدفعة التالية إذا وجدت
    if (this.operationQueue.length > 0) {
      setTimeout(() => this.processBatch(), 100);
    }
  }

  // تنظيف دوري محسن
  async performCleanup() {
    const now = Date.now();
    
    // تجنب التنظيف المتكرر
    if (now - this.lastCleanup < 300000) return; // 5 دقائق
    
    try {
      // تنظيف الجلسات المنتهية الصلاحية
      await this.cleanupExpiredSessions();
      
      // تنظيف البيانات المؤقتة
      await this.cleanupTempData();
      
      // تحسين استهلاك الذاكرة
      this.optimizeMemory();
      
      this.lastCleanup = now;
      console.log('🧹 Resource cleanup completed');
    } catch (error) {
      console.error('Cleanup failed:', error.message);
    }
  }

  async cleanupExpiredSessions() {
    const expireTime = Date.now() - (24 * 60 * 60 * 1000); // 24 ساعة
    
    await pool.query(
      'DELETE FROM processing_history WHERE timestamp < $1 AND amount = 0',
      [expireTime]
    );
  }

  async cleanupTempData() {
    // حذف البيانات المؤقتة القديمة
    await pool.query(
      'UPDATE users SET last_server_update = NULL WHERE last_server_update < $1',
      [Date.now() - (7 * 24 * 60 * 60 * 1000)] // أسبوع
    );
  }

  optimizeMemory() {
    // تشغيل garbage collection إذا كان متاحاً
    if (global.gc) {
      global.gc();
    }
    
    const usage = process.memoryUsage();
    const mbUsed = Math.round(usage.rss / 1024 / 1024);
    
    if (mbUsed > OPTIMIZATION_CONFIG.MEMORY_CLEANUP_THRESHOLD) {
      console.log(`🔧 Memory optimization triggered (${mbUsed}MB used)`);
      
      // إشعال عملية تنظيف إضافية
      if (global.gc) {
        global.gc();
      }
    }
  }
}

// إنشاء مثيل المراقب
const resourceMonitor = new ResourceMonitor();

// بدء المراقبة التلقائية
setInterval(() => {
  resourceMonitor.performCleanup();
}, 600000); // كل 10 دقائق

export { resourceMonitor, OPTIMIZATION_CONFIG };
export default resourceMonitor;
