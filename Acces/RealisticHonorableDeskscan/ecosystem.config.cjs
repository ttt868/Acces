/**
 * 🛡️ PM2 Production Configuration - Never Die System
 * نظام لا يسقط أبداً - يتحمل ملايين المستخدمين
 * 
 * الاستخدام:
 *   pm2 delete all && pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup
 * 
 * عند إضافة سيرفرات جديدة في Hetzner:
 *   1. نسخ المشروع للسيرفر الجديد
 *   2. pm2 start ecosystem.config.cjs
 *   3. أضف IP السيرفر الجديد في Nginx upstream (load balancer)
 */

const os = require('os');
const cpuCount = os.cpus().length;

module.exports = {
  apps: [
    // ========================================
    // 🚀 السيرفر الرئيسي - Cluster Mode
    // نسخة لكل CPU → إذا سقطت واحدة الباقي يشتغل
    // ========================================
    {
      name: 'access-network',
      script: 'server.js',
      cwd: '/var/www/Acces/RealisticHonorableDeskscan',

      // ⚡ Cluster: نسخة لكل CPU = load balancing تلقائي
      instances: cpuCount,          // 2 CPU = 2 نسخ، 4 CPU = 4 نسخ...
      exec_mode: 'cluster',         // Round-robin بين النسخ

      // 🔄 Auto-Restart - لا يموت أبداً
      autorestart: true,
      watch: false,
      max_restarts: 9999,
      min_uptime: '10s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 500,

      // 💾 حماية الذاكرة - إعادة تشغيل قبل الانهيار
      max_memory_restart: '800M',
      node_args: '--max-old-space-size=1024',

      // 🛡️ Graceful Shutdown
      kill_timeout: 30000,
      listen_timeout: 15000,
      shutdown_with_message: true,

      // 📝 Logs
      error_file: '/root/.pm2/logs/access-network-error.log',
      out_file: '/root/.pm2/logs/access-network-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // 🌐 Environment
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        UV_THREADPOOL_SIZE: 16
      },

      // ⏰ إعادة تشغيل يومية 4 صباحاً للتنظيف
      cron_restart: '0 4 * * *',
      instance_var: 'INSTANCE_ID'
    },

    // ========================================
    // 🏥 Health Monitor - يراقب ويعيد التشغيل
    // ========================================
    {
      name: 'access-health-monitor',
      script: 'health-monitor.js',
      cwd: '/var/www/Acces/RealisticHonorableDeskscan',

      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 9999,
      restart_delay: 5000,
      max_memory_restart: '100M',

      env: {
        NODE_ENV: 'production',
        MONITOR_INTERVAL: 30000,
        HEALTH_URL: 'http://127.0.0.1:3000/api/health',
        MAX_RESPONSE_TIME: 10000,
        MAX_FAILURES: 3
      }
    }
  ]
};
