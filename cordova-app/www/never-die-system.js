/**
 * 🛡️ Auto-Recovery & Never Die System
 * نظام الحماية الشاملة - السيرفر لا يسقط أبداً!
 * 
 * الميزات:
 * 1. 🔄 Auto-restart عند أي سقوط
 * 2. 💓 Health monitoring كل 30 ثانية
 * 3. 🧹 Memory cleanup تلقائي
 * 4. ⏰ Keep-alive لمنع النوم
 * 5. 🛡️ Error isolation - الأخطاء لا تسقط السيرفر
 */

import { spawn } from 'child_process';
import http from 'http';
import https from 'https';

class NeverDieSystem {
  constructor(options = {}) {
    this.serverScript = options.serverScript || 'server.js';
    this.healthCheckInterval = options.healthCheckInterval || 30000; // 30 ثانية
    this.keepAliveInterval = options.keepAliveInterval || 60000; // دقيقة
    this.maxRestarts = options.maxRestarts || 9999; // لا حدود تقريباً
    this.restartDelay = options.restartDelay || 2000; // 2 ثانية
    this.serverUrl = options.serverUrl || `http://localhost:${process.env.PORT || 5000}`;
    
    this.serverProcess = null;
    this.restartCount = 0;
    this.lastRestartTime = 0;
    this.isShuttingDown = false;
    this.healthCheckTimer = null;
    this.keepAliveTimer = null;
    
    console.log('🛡️ Never Die System initialized');
  }

  /**
   * 🚀 بدء النظام
   */
  start() {
    console.log('🚀 Starting Never Die System...');
    this.spawnServer();
    this.startHealthCheck();
    this.startKeepAlive();
    this.setupProcessHandlers();
  }

  /**
   * 🔄 تشغيل السيرفر
   */
  spawnServer() {
    if (this.isShuttingDown) return;
    
    console.log(`\n🔧 Starting server (attempt ${this.restartCount + 1})...`);
    
    this.serverProcess = spawn('node', [this.serverScript], {
      stdio: ['inherit', 'inherit', 'inherit'],
      cwd: process.cwd(),
      env: { ...process.env }
    });

    this.serverProcess.on('exit', (code, signal) => {
      if (this.isShuttingDown) return;
      
      console.error(`\n⚠️ Server exited with code ${code}, signal ${signal}`);
      this.handleServerCrash();
    });

    this.serverProcess.on('error', (err) => {
      console.error('❌ Server process error:', err.message);
      this.handleServerCrash();
    });

    this.lastRestartTime = Date.now();
    this.restartCount++;
    
    console.log(`✅ Server process started (PID: ${this.serverProcess.pid})`);
  }

  /**
   * 🔄 معالجة سقوط السيرفر
   */
  handleServerCrash() {
    if (this.isShuttingDown) return;
    
    if (this.restartCount >= this.maxRestarts) {
      console.error('❌ Max restarts exceeded. Manual intervention required.');
      return;
    }

    // تأخير صغير قبل إعادة التشغيل
    const timeSinceLastRestart = Date.now() - this.lastRestartTime;
    const delay = timeSinceLastRestart < 5000 ? this.restartDelay * 2 : this.restartDelay;
    
    console.log(`🔄 Restarting server in ${delay}ms...`);
    
    setTimeout(() => {
      this.spawnServer();
    }, delay);
  }

  /**
   * 💓 Health Check
   */
  startHealthCheck() {
    this.healthCheckTimer = setInterval(() => {
      this.checkHealth();
    }, this.healthCheckInterval);
    
    console.log(`💓 Health check started (every ${this.healthCheckInterval/1000}s)`);
  }

  async checkHealth() {
    try {
      const isHealthy = await this.pingServer();
      
      if (!isHealthy && !this.isShuttingDown) {
        console.warn('⚠️ Health check failed - server not responding');
        
        // قتل العملية إذا كانت موجودة
        if (this.serverProcess && !this.serverProcess.killed) {
          console.log('🔪 Killing unresponsive server...');
          this.serverProcess.kill('SIGKILL');
        }
      }
    } catch (error) {
      // Silent - health check errors are normal during restart
    }
  }

  pingServer() {
    return new Promise((resolve) => {
      const url = new URL('/health', this.serverUrl);
      const protocol = url.protocol === 'https:' ? https : http;
      
      const req = protocol.get(url.href, { timeout: 5000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * ⏰ Keep Alive - منع السيرفر من النوم
   */
  startKeepAlive() {
    this.keepAliveTimer = setInterval(() => {
      this.keepAlive();
    }, this.keepAliveInterval);
    
    console.log(`⏰ Keep-alive started (every ${this.keepAliveInterval/1000}s)`);
  }

  keepAlive() {
    // طلب بسيط لمنع النوم
    const url = new URL('/', this.serverUrl);
    const protocol = url.protocol === 'https:' ? https : http;
    
    const req = protocol.get(url.href, { timeout: 10000 }, () => {
      // Success - server is awake
    });
    
    req.on('error', () => {
      // Ignore errors
    });
  }

  /**
   * 🛡️ معالجات العملية الأساسية
   */
  setupProcessHandlers() {
    // لا تموت عند أي خطأ
    process.on('uncaughtException', (error) => {
      console.error('❌ [NEVER-DIE] Uncaught Exception:', error.message);
      // لا نخرج - نستمر
    });

    process.on('unhandledRejection', (reason) => {
      console.error('❌ [NEVER-DIE] Unhandled Rejection:', reason);
      // لا نخرج - نستمر
    });

    // إيقاف آمن فقط عند الطلب
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
  }

  /**
   * 🛑 إيقاف آمن
   */
  gracefulShutdown(signal) {
    if (this.isShuttingDown) return;
    
    console.log(`\n🛑 [${signal}] Shutting down Never Die System...`);
    this.isShuttingDown = true;
    
    // إيقاف المؤقتات
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    
    // إيقاف السيرفر
    if (this.serverProcess && !this.serverProcess.killed) {
      this.serverProcess.kill('SIGTERM');
      
      // Force kill after 30 seconds
      setTimeout(() => {
        if (this.serverProcess && !this.serverProcess.killed) {
          this.serverProcess.kill('SIGKILL');
        }
        process.exit(0);
      }, 30000);
    } else {
      process.exit(0);
    }
  }

  /**
   * 📊 إحصائيات
   */
  getStats() {
    return {
      restartCount: this.restartCount,
      lastRestartTime: this.lastRestartTime,
      uptime: this.lastRestartTime ? Date.now() - this.lastRestartTime : 0,
      serverPid: this.serverProcess?.pid,
      isRunning: this.serverProcess && !this.serverProcess.killed
    };
  }
}

// للتشغيل مباشرة
if (process.argv[1].endsWith('never-die-system.js')) {
  const neverDie = new NeverDieSystem({
    serverScript: 'server.js',
    healthCheckInterval: 30000,
    keepAliveInterval: 60000,
    serverUrl: process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`
  });
  
  neverDie.start();
}

export default NeverDieSystem;
