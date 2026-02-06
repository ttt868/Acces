
// نظام إدارة الأخطاء المتقدم - تقليل الضوضاء في الكونسول
class ErrorManager {
  constructor() {
    this.errorCache = new Map();
    this.maxCacheSize = 50;
    this.errorCooldown = 30000; // 30 ثانية
    this.criticalErrors = new Set();
    this.suppressedErrors = new Set([
      'column "block_number" of relation',
      'column "block_number" does not exist',
      'ServiceWorker registration failed',
      'WebSocket disconnected',
      'Presence WebSocket disconnected',
      'Saved 9 account balances to storage',
      'Saved 28 blocks to storage',
      'Saved 30 blocks to storage',
      'Computing cross-network messages',
      'Network load balancing',
      'Performance monitoring completed'
    ]);
  }

  // تسجيل ذكي للأخطاء - يمنع التكرار
  logError(key, error, level = 'error') {
    const now = Date.now();
    const cached = this.errorCache.get(key);
    
    // التحقق من الأخطاء المقموعة
    const errorMessage = typeof error === 'string' ? error : error.message;
    const isSuppressed = this.suppressedErrors.some(pattern => 
      errorMessage.includes(pattern)
    );
    
    if (isSuppressed) {
      // تسجيل مبسط للأخطاء المقموعة
      if (!cached || (now - cached.lastLogged) > this.errorCooldown * 10) {
        console.warn(`⚠️ [SUPPRESSED] ${errorMessage.substring(0, 100)}...`);
        this.errorCache.set(key, { lastLogged: now, count: 1 });
      }
      return;
    }
    
    // معالجة الأخطاء العادية
    if (!cached || (now - cached.lastLogged) > this.errorCooldown) {
      if (level === 'critical') {
        console.error(`🚨 CRITICAL: ${errorMessage}`);
        this.criticalErrors.add(key);
      } else if (level === 'error') {
        console.error(`❌ ERROR: ${errorMessage}`);
      } else if (level === 'warn') {
        console.warn(`⚠️ WARNING: ${errorMessage}`);
      }
      
      this.errorCache.set(key, { lastLogged: now, count: cached ? cached.count + 1 : 1 });
      
      // تنظيف الذاكرة
      if (this.errorCache.size > this.maxCacheSize) {
        const oldestKey = Array.from(this.errorCache.keys())[0];
        this.errorCache.delete(oldestKey);
      }
    } else if (cached) {
      cached.count++;
      
      // تسجيل ملخص كل 100 خطأ
      if (cached.count % 100 === 0) {
        console.log(`📊 Error summary: "${key}" occurred ${cached.count} times`);
      }
    }
  }

  // قمع أخطاء معينة
  suppressError(pattern) {
    this.suppressedErrors.add(pattern);
  }

  // إحصائيات الأخطاء
  getErrorStats() {
    return {
      totalErrorTypes: this.errorCache.size,
      criticalErrors: this.criticalErrors.size,
      suppressedPatterns: this.suppressedErrors.size
    };
  }

  // تنظيف الأخطاء القديمة
  cleanup() {
    const now = Date.now();
    const cleanupTime = this.errorCooldown * 5; // 5 دقائق
    
    for (const [key, data] of this.errorCache.entries()) {
      if ((now - data.lastLogged) > cleanupTime) {
        this.errorCache.delete(key);
      }
    }
  }
}

// إنشاء مدير أخطاء عالمي
const globalErrorManager = new ErrorManager();

// تصدير الدوال المساعدة
export function logError(key, error, level = 'error') {
  globalErrorManager.logError(key, error, level);
}

export function suppressError(pattern) {
  globalErrorManager.suppressError(pattern);
}

export function getErrorStats() {
  return globalErrorManager.getErrorStats();
}

// تنظيف دوري للأخطاء
setInterval(() => {
  globalErrorManager.cleanup();
}, 300000); // كل 5 دقائق

export default globalErrorManager;
