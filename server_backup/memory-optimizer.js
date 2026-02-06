
```javascript
// محسن الذاكرة للبيانات الضخمة
class MemoryOptimizer {
  constructor() {
    this.cache = new Map();
    this.maxCacheSize = 100000; // 100 ألف عنصر كحد أقصى
    this.compressionRatio = 0.3; // ضغط 70% من البيانات
    this.cleanupInterval = 300000; // تنظيف كل 5 دقائق
    
    this.startMemoryManagement();
  }

  // إدارة الذاكرة الذكية
  startMemoryManagement() {
    setInterval(() => {
      this.optimizeMemoryUsage();
    }, this.cleanupInterval);
    
    // مراقبة استخدام الذاكرة
    setInterval(() => {
      this.monitorMemoryUsage();
    }, 60000); // كل دقيقة
  }

  // مراقبة استخدام الذاكرة
  monitorMemoryUsage() {
    const usage = process.memoryUsage();
    const usedMB = Math.round(usage.heapUsed / 1024 / 1024);
    const limitMB = 1024; // حد 1GB
    
    console.log(`💾 استخدام الذاكرة: ${usedMB}MB من ${limitMB}MB`);
    
    // تنظيف إجباري إذا تجاوز 80%
    if (usedMB > limitMB * 0.8) {
      console.warn('⚠️ استخدام ذاكرة عالي - بدء تنظيف إجباري');
      this.forceCleanup();
    }
  }

  // تحسين استخدام الذاكرة
  optimizeMemoryUsage() {
    // تنظيف الكاش
    if (this.cache.size > this.maxCacheSize) {
      const entriesToRemove = this.cache.size - Math.floor(this.maxCacheSize * 0.7);
      const entries = Array.from(this.cache.entries());
      
      // حذف أقدم العناصر
      for (let i = 0; i < entriesToRemove; i++) {
        this.cache.delete(entries[i][0]);
      }
      
      console.log(`🧹 تم تنظيف ${entriesToRemove} عنصر من الكاش`);
    }

    // تشغيل جامع القمامة إذا كان متاحاً
    if (global.gc) {
      global.gc();
      console.log('🗑️ تم تشغيل جامع القمامة');
    }
  }

  // تنظيف إجباري
  forceCleanup() {
    // حذف 50% من الكاش
    const entries = Array.from(this.cache.entries());
    const toRemove = Math.floor(entries.length * 0.5);
    
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i][0]);
    }
    
    // تشغيل جامع القمامة عدة مرات
    if (global.gc) {
      for (let i = 0; i < 3; i++) {
        global.gc();
      }
    }
    
    console.log(`🚨 تنظيف إجباري: تم حذف ${toRemove} عنصر`);
  }

  // ضغط البيانات الذكي
  compressData(data) {
    try {
      const compressed = JSON.stringify(data);
      return {
        data: compressed,
        compressed: true,
        originalSize: JSON.stringify(data).length,
        compressedSize: compressed.length
      };
    } catch (error) {
      return { data: data, compressed: false };
    }
  }

  // إلغاء ضغط البيانات
  decompressData(compressedData) {
    if (compressedData.compressed) {
      try {
        return JSON.parse(compressedData.data);
      } catch (error) {
        return compressedData.data;
      }
    }
    return compressedData.data;
  }
}

export default MemoryOptimizer;
```
