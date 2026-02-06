
// نظام مراقبة الأداء والتشخيص المتقدم
import fs from 'fs';
import os from 'os';

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      memory: [],
      cpu: [],
      transactions: [],
      blocks: [],
      network: [],
      storage: []
    };
    
    this.alerts = [];
    this.thresholds = {
      memoryUsage: 80, // %
      cpuUsage: 85, // %
      transactionLatency: 1000, // ms
      blockTime: 30000, // ms
      diskUsage: 90 // %
    };

    this.startMonitoring();
  }

  startMonitoring() {
    // مراقبة كل 30 ثانية (بدلاً من ثانية) - توفير 97% CPU
    // 📉 تخفيض 30x: من 1/ثانية إلى 1/30 ثانية
    setInterval(() => {
      this.collectMetrics();
    }, 30000);

    // تقرير شامل كل 5 دقائق (بدلاً من دقيقة)
    // 📉 تخفيض 5x = توفير 80% CPU
    setInterval(() => {
      this.generateReport();
    }, 300000);

    // تنظيف البيانات القديمة كل ساعة
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 3600000);
  }

  collectMetrics() {
    const now = Date.now();

    // مراقبة الذاكرة
    const memoryUsage = process.memoryUsage();
    this.metrics.memory.push({
      timestamp: now,
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      external: memoryUsage.external,
      rss: memoryUsage.rss,
      usage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
    });

    // مراقبة CPU
    const cpuUsage = process.cpuUsage();
    this.metrics.cpu.push({
      timestamp: now,
      user: cpuUsage.user,
      system: cpuUsage.system,
      loadAverage: os.loadavg()
    });

    // فحص التحذيرات
    this.checkAlerts();
  }

  recordTransaction(transaction, processingTime) {
    this.metrics.transactions.push({
      timestamp: Date.now(),
      hash: transaction.hash,
      from: transaction.from,
      to: transaction.to,
      amount: transaction.amount,
      processingTime: processingTime,
      memoryBefore: process.memoryUsage().heapUsed,
      memoryAfter: process.memoryUsage().heapUsed
    });
  }

  recordBlock(block, processingTime) {
    this.metrics.blocks.push({
      timestamp: Date.now(),
      index: block.index,
      transactionCount: block.transactions.length,
      processingTime: processingTime,
      size: JSON.stringify(block).length,
      difficulty: block.difficulty
    });
  }

  checkAlerts() {
    const latest = this.getLatestMetrics();
    
    // تحذير استخدام الذاكرة
    if (latest.memory && latest.memory.usage > this.thresholds.memoryUsage) {
      this.addAlert('HIGH_MEMORY_USAGE', `Memory usage: ${latest.memory.usage.toFixed(2)}%`);
    }

    // تحذير زمن المعاملات
    const avgTxTime = this.getAverageTransactionTime();
    if (avgTxTime > this.thresholds.transactionLatency) {
      this.addAlert('HIGH_TRANSACTION_LATENCY', `Avg transaction time: ${avgTxTime}ms`);
    }
  }

  addAlert(type, message) {
    const alert = {
      timestamp: Date.now(),
      type: type,
      message: message,
      severity: this.getAlertSeverity(type)
    };

    this.alerts.push(alert);
    // Only log critical alerts
    if (this.getAlertSeverity(type) === 'CRITICAL') {
      console.warn(`🚨 CRITICAL [${type}]: ${message}`);
    }
    this.saveAlert(alert);
  }

  getAlertSeverity(type) {
    const severityMap = {
      'HIGH_MEMORY_USAGE': 'WARNING',
      'HIGH_CPU_USAGE': 'WARNING', 
      'HIGH_TRANSACTION_LATENCY': 'CRITICAL',
      'DISK_FULL': 'CRITICAL',
      'NETWORK_ERROR': 'ERROR'
    };
    return severityMap[type] || 'INFO';
  }

  getLatestMetrics() {
    return {
      memory: this.metrics.memory[this.metrics.memory.length - 1],
      cpu: this.metrics.cpu[this.metrics.cpu.length - 1],
      transactions: this.metrics.transactions.slice(-10),
      blocks: this.metrics.blocks.slice(-5)
    };
  }

  getAverageTransactionTime() {
    if (this.metrics.transactions.length === 0) return 0;
    
    const recent = this.metrics.transactions.slice(-100);
    const total = recent.reduce((sum, tx) => sum + tx.processingTime, 0);
    return total / recent.length;
  }

  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      system: {
        memory: this.getMemoryStats(),
        cpu: this.getCPUStats(),
        storage: this.getStorageStats()
      },
      blockchain: {
        transactions: this.getTransactionStats(),
        blocks: this.getBlockStats(),
        performance: this.getPerformanceStats()
      },
      alerts: this.alerts.slice(-10)
    };

    this.saveReport(report);
  }

  getMemoryStats() {
    if (this.metrics.memory.length === 0) return {};
    
    const recent = this.metrics.memory.slice(-60); // آخر دقيقة
    const usage = recent.map(m => m.usage);
    
    return {
      current: recent[recent.length - 1],
      average: usage.reduce((sum, u) => sum + u, 0) / usage.length,
      peak: Math.max(...usage),
      trend: usage.length > 1 ? usage[usage.length - 1] - usage[0] : 0
    };
  }

  getCPUStats() {
    const cpus = os.cpus();
    return {
      count: cpus.length,
      model: cpus[0].model,
      loadAverage: os.loadavg(),
      uptime: os.uptime()
    };
  }

  getStorageStats() {
    try {
      const stats = fs.statSync('./network-data');
      return {
        blockchainSize: this.getDirectorySize('./network-data'),
        lastModified: stats.mtime,
        available: this.getAvailableSpace()
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  getTransactionStats() {
    if (this.metrics.transactions.length === 0) return {};
    
    const recent = this.metrics.transactions.slice(-1000);
    const times = recent.map(tx => tx.processingTime);
    
    return {
      total: this.metrics.transactions.length,
      recentCount: recent.length,
      averageTime: times.reduce((sum, t) => sum + t, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      throughput: recent.length / 60 // per minute
    };
  }

  getBlockStats() {
    if (this.metrics.blocks.length === 0) return {};
    
    const recent = this.metrics.blocks.slice(-10);
    const times = recent.map(b => b.processingTime);
    
    return {
      total: this.metrics.blocks.length,
      averageProcessingTime: times.reduce((sum, t) => sum + t, 0) / times.length,
      averageTransactionsPerBlock: recent.reduce((sum, b) => sum + b.transactionCount, 0) / recent.length,
      averageBlockSize: recent.reduce((sum, b) => sum + b.size, 0) / recent.length
    };
  }

  getPerformanceStats() {
    return {
      transactionThroughput: this.getTransactionThroughput(),
      blockGenerationRate: this.getBlockGenerationRate(),
      systemEfficiency: this.calculateSystemEfficiency(),
      recommendations: this.getPerformanceRecommendations()
    };
  }

  getTransactionThroughput() {
    const lastMinute = this.metrics.transactions.filter(
      tx => Date.now() - tx.timestamp < 60000
    );
    return lastMinute.length; // transactions per minute
  }

  getBlockGenerationRate() {
    const lastHour = this.metrics.blocks.filter(
      block => Date.now() - block.timestamp < 3600000
    );
    return lastHour.length; // blocks per hour
  }

  calculateSystemEfficiency() {
    const memoryEfficiency = 100 - (this.getMemoryStats().average || 0);
    const transactionEfficiency = Math.min(100, 1000 / (this.getAverageTransactionTime() || 1000) * 100);
    
    return (memoryEfficiency + transactionEfficiency) / 2;
  }

  getPerformanceRecommendations() {
    const recommendations = [];
    const memoryStats = this.getMemoryStats();
    
    if (memoryStats.average > 70) {
      recommendations.push('Consider increasing memory allocation or optimizing memory usage');
    }
    
    if (this.getAverageTransactionTime() > 500) {
      recommendations.push('Transaction processing is slow - consider parallel processing');
    }
    
    if (this.getBlockGenerationRate() < 6) {
      recommendations.push('Block generation rate is low - consider adjusting difficulty');
    }
    
    return recommendations;
  }

  getDirectorySize(dirPath) {
    let size = 0;
    try {
      const files = fs.readdirSync(dirPath);
      files.forEach(file => {
        const filePath = `${dirPath}/${file}`;
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          size += this.getDirectorySize(filePath);
        } else {
          size += stats.size;
        }
      });
    } catch (error) {
      console.error('Error calculating directory size:', error);
    }
    return size;
  }

  getAvailableSpace() {
    try {
      const stats = fs.statSync('./');
      return {
        free: 'N/A', // يتطلب مكتبة إضافية لحساب المساحة المتاحة
        total: 'N/A'
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  saveReport(report) {
    const filename = `performance-report-${Date.now()}.json`;
    const reportPath = `./performance-reports/${filename}`;
    
    // إنشاء المجلد إذا لم يكن موجود
    if (!fs.existsSync('./performance-reports')) {
      fs.mkdirSync('./performance-reports', { recursive: true });
    }
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  saveAlert(alert) {
    const alertsFile = './performance-reports/alerts.log';
    const logEntry = `${new Date(alert.timestamp).toISOString()} [${alert.severity}] ${alert.type}: ${alert.message}\n`;
    
    fs.appendFileSync(alertsFile, logEntry);
  }

  cleanupOldMetrics() {
    const maxAge = 24 * 60 * 60 * 1000; // 24 ساعة
    const cutoff = Date.now() - maxAge;
    
    // تنظيف البيانات القديمة
    this.metrics.memory = this.metrics.memory.filter(m => m.timestamp > cutoff);
    this.metrics.cpu = this.metrics.cpu.filter(c => c.timestamp > cutoff);
    this.metrics.transactions = this.metrics.transactions.filter(t => t.timestamp > cutoff);
    this.metrics.blocks = this.metrics.blocks.filter(b => b.timestamp > cutoff);
    this.alerts = this.alerts.filter(a => a.timestamp > cutoff);
    
    console.log('🧹 Cleaned up old performance metrics');
  }

  // API للوصول للمقاييس
  getMetrics() {
    return {
      current: this.getLatestMetrics(),
      stats: {
        memory: this.getMemoryStats(),
        transactions: this.getTransactionStats(),
        blocks: this.getBlockStats(),
        performance: this.getPerformanceStats()
      },
      alerts: this.alerts.slice(-10)
    };
  }

  exportMetrics() {
    const exportData = {
      timestamp: Date.now(),
      metrics: this.metrics,
      alerts: this.alerts,
      systemInfo: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        uptime: process.uptime()
      }
    };
    
    const filename = `metrics-export-${Date.now()}.json`;
    fs.writeFileSync(`./exports/${filename}`, JSON.stringify(exportData, null, 2));
    
    return filename;
  }
}

export { PerformanceMonitor };
