/**
 * 🏥 Health Monitor - نظام مراقبة ذاتي
 * يراقب السيرفر كل 30 ثانية ويعيد تشغيله إذا سقط
 * يسجل CPU/RAM/Disk ويرسل تنبيهات
 */

import http from 'http';
import os from 'os';
import { execSync, exec } from 'child_process';
import fs from 'fs';

// ============ الإعدادات ============
const CONFIG = {
  HEALTH_URL: process.env.HEALTH_URL || 'http://127.0.0.1:3000/api/health',
  MONITOR_INTERVAL: parseInt(process.env.MONITOR_INTERVAL) || 30000,
  MAX_RESPONSE_TIME: parseInt(process.env.MAX_RESPONSE_TIME) || 10000,
  MAX_FAILURES: parseInt(process.env.MAX_FAILURES) || 3,
  LOG_FILE: '/var/www/Acces/RealisticHonorableDeskscan/logs/health-monitor.log',
  METRICS_FILE: '/var/www/Acces/RealisticHonorableDeskscan/logs/metrics.json',
  PM2_APP_NAME: 'access-network',

  // حدود التنبيه
  CPU_ALERT_THRESHOLD: 90,      // تنبيه عند 90% CPU
  MEMORY_ALERT_THRESHOLD: 85,   // تنبيه عند 85% RAM
  DISK_ALERT_THRESHOLD: 85,     // تنبيه عند 85% Disk
};

// ============ الحالة ============
let failureCount = 0;
let lastRestart = 0;
let totalChecks = 0;
let totalFailures = 0;
let totalRestarts = 0;
let metricsHistory = [];
const MAX_HISTORY = 1440; // 24 ساعة بفحص كل دقيقة

// ============ سجلات ============
function log(level, message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}`;
  console.log(line);

  try {
    const dir = '/var/www/Acces/RealisticHonorableDeskscan/logs';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(CONFIG.LOG_FILE, line + '\n');
  } catch (e) { /* ignore */ }
}

// ============ قياس الموارد ============
function getSystemMetrics() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // CPU usage
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  }
  const cpuPercent = Math.round(100 - (totalIdle / totalTick) * 100);

  // Disk usage
  let diskPercent = 0;
  try {
    const df = execSync('df / --output=pcent 2>/dev/null | tail -1', { encoding: 'utf8' });
    diskPercent = parseInt(df.trim().replace('%', ''));
  } catch (e) { diskPercent = -1; }

  // Load average
  const loadAvg = os.loadavg();

  // PM2 process info
  let pm2Info = { instances: 0, onlineInstances: 0, totalMemory: 0, restarts: 0 };
  try {
    const pm2Data = execSync(`pm2 jlist 2>/dev/null`, { encoding: 'utf8' });
    const processes = JSON.parse(pm2Data);
    const appProcesses = processes.filter(p => p.name === CONFIG.PM2_APP_NAME);
    pm2Info.instances = appProcesses.length;
    pm2Info.onlineInstances = appProcesses.filter(p => p.pm2_env?.status === 'online').length;
    pm2Info.totalMemory = appProcesses.reduce((sum, p) => sum + (p.monit?.memory || 0), 0);
    pm2Info.restarts = appProcesses.reduce((sum, p) => sum + (p.pm2_env?.restart_time || 0), 0);
  } catch (e) { /* ignore */ }

  // Active connections
  let connections = 0;
  try {
    const ss = execSync('ss -s 2>/dev/null | grep estab', { encoding: 'utf8' });
    const match = ss.match(/estab\s+(\d+)/);
    connections = match ? parseInt(match[1]) : 0;
  } catch (e) {}

  // Redis status
  let redisOk = false;
  try {
    const pong = execSync('redis-cli PING 2>/dev/null', { encoding: 'utf8' }).trim();
    redisOk = pong === 'PONG';
  } catch (e) {}

  // PostgreSQL connections
  let pgConnections = 0;
  try {
    const pg = execSync(
      `PGPASSWORD=${process.env.DB_PASSWORD || ''} psql -h 127.0.0.1 -U access_user -d access_db -t -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';" 2>/dev/null`,
      { encoding: 'utf8' }
    );
    pgConnections = parseInt(pg.trim()) || 0;
  } catch (e) {}

  return {
    timestamp: Date.now(),
    cpu: {
      percent: cpuPercent,
      cores: cpus.length,
      loadAvg: loadAvg.map(l => Math.round(l * 100) / 100)
    },
    memory: {
      total: Math.round(totalMem / 1048576),
      used: Math.round(usedMem / 1048576),
      free: Math.round(freeMem / 1048576),
      percent: Math.round((usedMem / totalMem) * 100)
    },
    disk: {
      percent: diskPercent
    },
    pm2: pm2Info,
    network: {
      connections: connections
    },
    services: {
      redis: redisOk,
      postgres: pgConnections >= 0
    },
    uptime: os.uptime()
  };
}

// ============ فحص الصحة ============
function healthCheck() {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const timeout = setTimeout(() => {
      resolve({ ok: false, error: 'Timeout', responseTime: CONFIG.MAX_RESPONSE_TIME });
    }, CONFIG.MAX_RESPONSE_TIME);

    try {
      const req = http.get(CONFIG.HEALTH_URL, (res) => {
        clearTimeout(timeout);
        const responseTime = Date.now() - startTime;
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          resolve({
            ok: res.statusCode === 200,
            statusCode: res.statusCode,
            responseTime,
            body: body.substring(0, 200)
          });
        });
      });

      req.on('error', (error) => {
        clearTimeout(timeout);
        resolve({ ok: false, error: error.message, responseTime: Date.now() - startTime });
      });

      req.end();
    } catch (error) {
      clearTimeout(timeout);
      resolve({ ok: false, error: error.message, responseTime: Date.now() - startTime });
    }
  });
}

// ============ إعادة تشغيل PM2 ============
function restartApp() {
  const now = Date.now();
  // لا تعيد التشغيل أكثر من مرة كل 60 ثانية
  if (now - lastRestart < 60000) {
    log('WARN', 'Skipping restart - too soon since last restart');
    return;
  }

  lastRestart = now;
  totalRestarts++;

  log('ALERT', `🔄 Restarting ${CONFIG.PM2_APP_NAME} (failure #${failureCount})`);

  try {
    execSync(`pm2 restart ${CONFIG.PM2_APP_NAME} 2>/dev/null`, { timeout: 30000 });
    log('INFO', `✅ ${CONFIG.PM2_APP_NAME} restarted successfully`);
    failureCount = 0;
  } catch (error) {
    log('ERROR', `❌ Restart failed: ${error.message}`);

    // محاولة قتل وإعادة تشغيل
    try {
      execSync(`pm2 delete ${CONFIG.PM2_APP_NAME} 2>/dev/null; pm2 start /var/www/Acces/RealisticHonorableDeskscan/ecosystem.config.cjs --only access-network 2>/dev/null`, { timeout: 30000 });
      log('INFO', '✅ Force-restarted via ecosystem config');
      failureCount = 0;
    } catch (e2) {
      log('CRITICAL', `💀 Force restart also failed: ${e2.message}`);
    }
  }
}

// ============ حفظ القياسات ============
function saveMetrics(metrics) {
  metricsHistory.push(metrics);
  if (metricsHistory.length > MAX_HISTORY) {
    metricsHistory = metricsHistory.slice(-MAX_HISTORY);
  }

  try {
    const summary = {
      current: metrics,
      last24h: {
        avgCpu: Math.round(metricsHistory.reduce((s, m) => s + m.cpu.percent, 0) / metricsHistory.length),
        avgMemory: Math.round(metricsHistory.reduce((s, m) => s + m.memory.percent, 0) / metricsHistory.length),
        maxCpu: Math.max(...metricsHistory.map(m => m.cpu.percent)),
        maxMemory: Math.max(...metricsHistory.map(m => m.memory.percent)),
        checks: totalChecks,
        failures: totalFailures,
        restarts: totalRestarts,
        uptime: metrics.uptime
      },
      history: metricsHistory.slice(-60) // آخر 30 دقيقة
    };

    const dir = '/var/www/Acces/RealisticHonorableDeskscan/logs';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG.METRICS_FILE, JSON.stringify(summary, null, 2));
  } catch (e) { /* ignore */ }
}

// ============ الحلقة الرئيسية ============
async function monitor() {
  totalChecks++;

  // 1. قياس الموارد
  const metrics = getSystemMetrics();
  saveMetrics(metrics);

  // 2. التنبيهات
  if (metrics.cpu.percent > CONFIG.CPU_ALERT_THRESHOLD) {
    log('ALERT', `🔥 CPU عالي: ${metrics.cpu.percent}% (الحد: ${CONFIG.CPU_ALERT_THRESHOLD}%)`);
  }
  if (metrics.memory.percent > CONFIG.MEMORY_ALERT_THRESHOLD) {
    log('ALERT', `🔥 RAM عالية: ${metrics.memory.percent}% (${metrics.memory.used}MB/${metrics.memory.total}MB)`);
  }
  if (metrics.disk.percent > CONFIG.DISK_ALERT_THRESHOLD) {
    log('ALERT', `🔥 Disk ممتلئ: ${metrics.disk.percent}%`);
  }
  if (!metrics.services.redis) {
    log('WARN', '⚠️ Redis غير متاح');
  }

  // 3. فحص التطبيق
  const health = await healthCheck();

  if (health.ok) {
    if (failureCount > 0) {
      log('INFO', `✅ Application recovered after ${failureCount} failures (${health.responseTime}ms)`);
    }
    failureCount = 0;

    // تسجيل بطيء
    if (totalChecks % 20 === 0) { // كل 10 دقائق
      log('INFO', `📊 CPU: ${metrics.cpu.percent}% | RAM: ${metrics.memory.percent}% | PM2: ${metrics.pm2.onlineInstances}/${metrics.pm2.instances} | Connections: ${metrics.network.connections} | Response: ${health.responseTime}ms`);
    }
  } else {
    failureCount++;
    totalFailures++;
    log('WARN', `❌ Health check failed #${failureCount}: ${health.error || `HTTP ${health.statusCode}`} (${health.responseTime}ms)`);

    if (failureCount >= CONFIG.MAX_FAILURES) {
      restartApp();
    }
  }

  // 4. تنظيف logs كبيرة
  if (totalChecks % 720 === 0) { // كل 6 ساعات
    try {
      const logFiles = [
        '/root/.pm2/logs/access-network-out.log',
        '/root/.pm2/logs/access-network-out-0.log',
        '/root/.pm2/logs/access-network-out-1.log'
      ];
      for (const file of logFiles) {
        try {
          const stats = fs.statSync(file);
          if (stats.size > 50 * 1024 * 1024) { // أكبر من 50MB
            log('INFO', `🧹 Truncating large log: ${file} (${Math.round(stats.size / 1048576)}MB)`);
            execSync(`tail -10000 "${file}" > "${file}.tmp" && mv "${file}.tmp" "${file}"`, { timeout: 10000 });
          }
        } catch (e) { /* file not found, ignore */ }
      }
    } catch (e) { /* ignore */ }
  }
}

// ============ بدء التشغيل ============
log('INFO', '🏥 Health Monitor started');
log('INFO', `   Checking: ${CONFIG.HEALTH_URL}`);
log('INFO', `   Interval: ${CONFIG.MONITOR_INTERVAL / 1000}s`);
log('INFO', `   Max failures before restart: ${CONFIG.MAX_FAILURES}`);
log('INFO', `   CPU cores: ${os.cpus().length}`);
log('INFO', `   Total RAM: ${Math.round(os.totalmem() / 1048576)}MB`);

// أول فحص فوري
monitor();

// الحلقة المستمرة
setInterval(monitor, CONFIG.MONITOR_INTERVAL);
