// نظام تحسين الموارد لتقليل استهلاك Autoscale
import { pool } from './db.js';

// Cache للبيانات المستخدمة بكثرة - تحسين لتوفير الموارد
const cache = new Map();
const CACHE_DURATION = 300000; // 5 دقائق - زيادة أكبر لتقليل الاستعلامات

// تنظيف Cache دوري مع تقليل التكرار أكثر
setInterval(() => {
  const now = Date.now();
  const keysToDelete = [];

  for (const [key, data] of cache.entries()) {
    if (now - data.timestamp > CACHE_DURATION) {
      keysToDelete.push(key);
    }
  }

  // حذف المفاتيح بكفاءة
  keysToDelete.forEach(key => cache.delete(key));

  // تنظيف الذاكرة بشكل أكثر تدرجاً
  if (cache.size > 500) { // تقليل الحد الأقصى
    const entries = Array.from(cache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, 250);
    toRemove.forEach(([key]) => cache.delete(key));
  }
}, 600000); // كل 10 دقائق بدلاً من 3 دقائق

// دالة للحصول على البيانات مع Cache
export async function getCachedData(key, fetchFunction) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  const data = await fetchFunction();
  cache.set(key, { data, timestamp: Date.now() });
  return data;
}

// تجميع العمليات المتشابهة
const batchOperations = new Map();

export function batchDatabaseOperation(operation, delay = 1000) {
  return new Promise((resolve, reject) => {
    if (!batchOperations.has(operation.type)) {
      batchOperations.set(operation.type, []);

      setTimeout(async () => {
        const operations = batchOperations.get(operation.type);
        batchOperations.delete(operation.type);

        try {
          // تنفيذ العمليات في batch واحد
          await pool.query('BEGIN');

          for (const op of operations) {
            try {
              const result = await op.execute();
              op.resolve(result);
            } catch (error) {
              op.reject(error);
            }
          }

          await pool.query('COMMIT');
        } catch (error) {
          await pool.query('ROLLBACK');
          operations.forEach(op => op.reject(error));
        }
      }, delay);
    }

    batchOperations.get(operation.type).push({
      ...operation,
      resolve,
      reject
    });
  });
}

// تحسين استعلامات قاعدة البيانات
export function optimizeQuery(query, params) {
  // إضافة LIMIT للاستعلامات الطويلة
  if (query.includes('SELECT') && !query.includes('LIMIT')) {
    query += ' LIMIT 1000';
  }

  return { query, params };
}

// تحسين معالجة الطلبات المتعددة
const requestQueue = new Map();
const BATCH_SIZE = 10;
const BATCH_TIMEOUT = 500;

export function batchUserRequests(userId, operation) {
  return new Promise((resolve, reject) => {
    if (!requestQueue.has(userId)) {
      requestQueue.set(userId, []);

      setTimeout(async () => {
        const operations = requestQueue.get(userId) || [];
        requestQueue.delete(userId);

        try {
          const results = await Promise.all(
            operations.map(op => op.execute())
          );

          operations.forEach((op, index) => {
            op.resolve(results[index]);
          });
        } catch (error) {
          operations.forEach(op => op.reject(error));
        }
      }, BATCH_TIMEOUT);
    }

    const queue = requestQueue.get(userId);
    queue.push({ ...operation, resolve, reject });

    // تنفيذ فوري إذا وصل الـ batch للحد الأقصى
    if (queue.length >= BATCH_SIZE) {
      const operations = queue.splice(0, BATCH_SIZE);
      requestQueue.set(userId, queue);

      Promise.all(operations.map(op => op.execute()))
        .then(results => {
          operations.forEach((op, index) => {
            op.resolve(results[index]);
          });
        })
        .catch(error => {
          operations.forEach(op => op.reject(error));
        });
    }
  });
}

// تحسين الاستعلامات للحد من استهلاك قاعدة البيانات
export function optimizeQueryWithLimit(query, params, maxRows = 100) {
  // إضافة LIMIT تلقائياً لتقليل استهلاك الذاكرة
  if (query.includes('SELECT') && !query.includes('LIMIT')) {
    query += ` LIMIT ${maxRows}`;
  }

  // تحسين استعلامات JOIN
  if (query.includes('JOIN') && !query.includes('INDEX')) {
    console.log('Warning: JOIN query without explicit index usage detected');
  }

  return { query, params };
}

// مراقب استهلاك الذاكرة
let memoryCheckInterval;

export function startMemoryMonitoring() {
  if (memoryCheckInterval) return;

  memoryCheckInterval = setInterval(() => {
    const used = process.memoryUsage();
    const mbUsed = Math.round(used.rss / 1024 / 1024);

    // رفع الحد الأدنى لتقليل التدخلات غير الضرورية
    if (mbUsed > 300) { // تقليل الحد لتحسين الأداء
      console.warn(`Memory usage: ${mbUsed}MB - optimizing...`);

      // تنظيف أكثر عدوانية للCache
      if (cache.size > 50) { // تقليل الحد
        const entries = Array.from(cache.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toRemove = entries.slice(0, Math.floor(cache.size * 0.7)); // حذف 70%
        toRemove.forEach(([key]) => cache.delete(key));
        console.log(`Cleared ${toRemove.length} cache entries to free memory`);
      }

      // تشغيل garbage collection إذا كان متاحاً
      if (global.gc) {
        global.gc();
        console.log('Garbage collection triggered');
      }
    }
  }, 300000); // كل 5 دقائق بدلاً من كل دقيقة
}

export function stopMemoryMonitoring() {
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
    memoryCheckInterval = null;
  }
}

// بدء مراقبة الذاكرة تلقائياً
startMemoryMonitoring();

// إعدادات تحسين الموارد المحسنة
const RESOURCE_OPTIMIZATION = {
  MINING_SYNC_INTERVAL: 600000, // 10 دقائق للمراقبة العادية
  FINAL_HOUR_INTERVAL: 60000, // دقيقة واحدة للساعة الأخيرة فقط
  WS_PING_INTERVAL: 180000, // 3 دقائق للWebSocket
  MEMORY_CHECK_INTERVAL: 600000, // فحص الذاكرة كل 10 دقائق
  MAX_ACTIVE_CONNECTIONS: 30, // تقليل أكثر
  BATCH_OPERATIONS: true,
  CACHE_DURATION: 300000, // 5 دقائق كاش
  SMART_MONITORING: true, // تفعيل المراقبة الذكية
  LAZY_UPDATES: true // تحديثات كسولة
};

export default {
  getCachedData,
  batchDatabaseOperation,
  optimizeQuery,
  batchUserRequests,
  optimizeQueryWithLimit,
  startMemoryMonitoring,
  stopMemoryMonitoring
};