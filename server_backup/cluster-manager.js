
// نظام Clustering للاستفادة من جميع أنوية المعالج
import cluster from 'cluster';
import os from 'os';
import { EventEmitter } from 'events';

class ClusterManager extends EventEmitter {
  constructor() {
    super();
    this.numCPUs = os.cpus().length;
    this.workers = new Map();
    this.restartAttempts = new Map();
    this.maxRestartAttempts = 5;
  }

  start() {
    if (cluster.isPrimary) {
      console.log(`🚀 Master process ${process.pid} starting cluster...`);
      console.log(`📊 Spawning ${this.numCPUs} workers for maximum performance`);

      // إنشاء workers
      for (let i = 0; i < this.numCPUs; i++) {
        this.createWorker();
      }

      // مراقبة Workers
      cluster.on('exit', (worker, code, signal) => {
        console.warn(`⚠️ Worker ${worker.process.pid} died (${signal || code})`);
        this.handleWorkerDeath(worker);
      });

      // معلومات الأداء
      setInterval(() => this.logClusterStats(), 60000);

    } else {
      // Worker process - تشغيل السيرفر
      this.runWorkerServer();
    }
  }

  createWorker() {
    const worker = cluster.fork();
    this.workers.set(worker.id, {
      worker: worker,
      startedAt: Date.now(),
      restarts: 0
    });

    worker.on('message', (msg) => {
      this.handleWorkerMessage(worker, msg);
    });
  }

  handleWorkerDeath(deadWorker) {
    const workerInfo = this.workers.get(deadWorker.id);
    
    if (!workerInfo) return;

    const restarts = this.restartAttempts.get(deadWorker.id) || 0;

    if (restarts < this.maxRestartAttempts) {
      console.log(`🔄 Restarting worker ${deadWorker.id} (attempt ${restarts + 1})`);
      this.createWorker();
      this.restartAttempts.set(deadWorker.id, restarts + 1);
    } else {
      console.error(`❌ Worker ${deadWorker.id} failed ${this.maxRestartAttempts} times - not restarting`);
      this.workers.delete(deadWorker.id);
    }
  }

  handleWorkerMessage(worker, message) {
    // معالجة رسائل Workers
    if (message.type === 'stats') {
      this.emit('workerStats', { workerId: worker.id, stats: message.data });
    }
  }

  async runWorkerServer() {
    // استيراد وتشغيل السيرفر في Worker
    const { default: server } = await import('./server.js');
    console.log(`✅ Worker ${process.pid} ready to handle requests`);
  }

  logClusterStats() {
    const stats = {
      totalWorkers: this.workers.size,
      activeCPUs: this.numCPUs,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      workerStats: Array.from(this.workers.entries()).map(([id, info]) => ({
        id: id,
        pid: info.worker.process.pid,
        uptime: (Date.now() - info.startedAt) / 1000,
        restarts: info.restarts
      }))
    };

    console.log('📊 CLUSTER STATS:', JSON.stringify(stats, null, 2));
  }

  shutdown() {
    console.log('🛑 Shutting down cluster gracefully...');
    
    for (const [id, info] of this.workers.entries()) {
      info.worker.disconnect();
      
      setTimeout(() => {
        if (!info.worker.isDead()) {
          info.worker.kill();
        }
      }, 5000);
    }
  }
}

export default ClusterManager;
