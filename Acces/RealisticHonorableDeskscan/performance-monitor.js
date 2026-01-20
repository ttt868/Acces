
// نظام مراقبة الأداء للتعامل مع المعاملات الضخمة
import { EventEmitter } from 'events';

class PerformanceMonitor extends EventEmitter {
  constructor() {
    super();
    this.metrics = {
      transactionThroughput: 0, // معاملات في الثانية
      averageBlockTime: 0, // متوسط وقت إنشاء الكتلة
      memoryUsage: 0, // استخدام الذاكرة
      diskUsage: 0, // استخدام القرص
      databaseConnections: 0, // اتصالات قاعدة البيانات
      responseTime: 0, // وقت الاستجابة
      errorRate: 0 // معدل الأخطاء
    };
    
    this.thresholds = {
      maxMemoryUsage: 1024 * 1024 * 1024, // 1GB
      maxResponseTime: 5000, // 5 ثواني
      maxErrorRate: 0.01, // 1%
      minThroughput: 100 // 100 معاملة/ثانية
    };

    this.startMonitoring();
  }

  startMonitoring() {
    // مراقبة كل 5 دقائق لتوفير الموارد
    setInterval(() => {
      this.collectMetrics();
      this.analyzePerformance();
    }, 300000);

    // تقليل الرسائل في الكونسول
    // console.log('📊 Performance monitoring started');
  }

  collectMetrics() {
    try {
      // استخدام الذاكرة
      const memUsage = process.memoryUsage();
      this.metrics.memoryUsage = memUsage.heapUsed;

      // استخدام المعالج
      const cpuUsage = process.cpuUsage();
      this.metrics.cpuUsage = cpuUsage;

      // عدد المقابض المفتوحة
      this.metrics.openHandles = process._getActiveHandles().length;

      // تسجيل صامت لتوفير الموارد

    } catch (error) {
      // تسجيل الأخطاء الحرجة فقط
      if (error.message.includes('CRITICAL')) {
        console.error('❌ Critical metrics error:', error);
      }
    }
  }

  analyzePerformance() {
    const alerts = [];

    // فحص استخدام الذاكرة
    if (this.metrics.memoryUsage > this.thresholds.maxMemoryUsage) {
      alerts.push({
        type: 'HIGH_MEMORY_USAGE',
        current: this.metrics.memoryUsage,
        threshold: this.thresholds.maxMemoryUsage,
        severity: 'HIGH'
      });
    }

    // فحص عدد المقابض
    if (this.metrics.openHandles > 1000) {
      alerts.push({
        type: 'HIGH_HANDLE_COUNT',
        current: this.metrics.openHandles,
        threshold: 1000,
        severity: 'MEDIUM'
      });
    }

    // إرسال التنبيهات
    alerts.forEach(alert => {
      this.emit('performance_alert', alert);
      console.warn(`⚠️ PERFORMANCE ALERT: ${alert.type} - Current: ${alert.current}, Threshold: ${alert.threshold}`);
    });

    return alerts;
  }

  // مراقبة إنتاجية المعاملات
  measureTransactionThroughput(transactionCount, timeWindow) {
    this.metrics.transactionThroughput = transactionCount / (timeWindow / 1000);
    
    if (this.metrics.transactionThroughput < this.thresholds.minThroughput) {
      this.emit('low_throughput', {
        current: this.metrics.transactionThroughput,
        threshold: this.thresholds.minThroughput
      });
    }

    return this.metrics.transactionThroughput;
  }

  // قياس وقت الاستجابة
  measureResponseTime(startTime) {
    const responseTime = Date.now() - startTime;
    this.metrics.responseTime = responseTime;

    if (responseTime > this.thresholds.maxResponseTime) {
      this.emit('slow_response', {
        responseTime: responseTime,
        threshold: this.thresholds.maxResponseTime
      });
    }

    return responseTime;
  }

  // توصيات التحسين
  getOptimizationRecommendations() {
    const recommendations = [];

    if (this.metrics.memoryUsage > this.thresholds.maxMemoryUsage * 0.8) {
      recommendations.push({
        type: 'memory',
        suggestion: 'تقليل عدد الكتل المحملة في الذاكرة',
        priority: 'HIGH'
      });
    }

    if (this.metrics.transactionThroughput < this.thresholds.minThroughput) {
      recommendations.push({
        type: 'throughput',
        suggestion: 'زيادة عدد المعاملات في كل كتلة',
        priority: 'MEDIUM'
      });
    }

    if (this.metrics.openHandles > 500) {
      recommendations.push({
        type: 'handles',
        suggestion: 'إغلاق الاتصالات غير المستخدمة',
        priority: 'MEDIUM'
      });
    }

    return recommendations;
  }

  // تقرير الأداء الشامل
  generatePerformanceReport() {
    return {
      timestamp: Date.now(),
      metrics: this.metrics,
      thresholds: this.thresholds,
      recommendations: this.getOptimizationRecommendations(),
      status: this.getOverallStatus()
    };
  }

  getOverallStatus() {
    const memoryOk = this.metrics.memoryUsage < this.thresholds.maxMemoryUsage;
    const throughputOk = this.metrics.transactionThroughput >= this.thresholds.minThroughput;
    const responseOk = this.metrics.responseTime < this.thresholds.maxResponseTime;

    if (memoryOk && throughputOk && responseOk) {
      return 'HEALTHY';
    } else if (!memoryOk || this.metrics.responseTime > this.thresholds.maxResponseTime * 2) {
      return 'CRITICAL';
    } else {
      return 'WARNING';
    }
  }
}

export default PerformanceMonitor;
