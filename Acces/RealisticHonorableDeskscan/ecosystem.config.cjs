/**
 * 🛡️ PM2 Configuration - Auto-Restart & Never Die System
 * هذا الملف يضمن أن السيرفر لا يسقط أبداً!
 * 
 * كيفية الاستخدام:
 * 1. تثبيت PM2: npm install pm2 -g
 * 2. تشغيل: pm2 start ecosystem.config.cjs
 * 3. حفظ: pm2 save
 * 4. إعداد auto-start: pm2 startup
 */

module.exports = {
  apps: [{
    name: 'access-server',
    script: 'server.js',
    
    // ⚡ Auto-Restart Settings
    autorestart: true,           // إعادة تشغيل تلقائية عند السقوط
    watch: false,                // لا تراقب الملفات (للإنتاج)
    max_restarts: 1000,          // عدد ضخم من إعادات التشغيل
    min_uptime: '5s',            // الحد الأدنى قبل اعتبار التشغيل ناجح
    max_memory_restart: '450M',  // إعادة تشغيل قبل الوصول لحد Render
    restart_delay: 1000,         // ثانية واحدة بين المحاولات
    
    // 🔄 Cluster Mode - عدة نسخ للاستقرار
    instances: 1,                // نسخة واحدة (Render Free)
    exec_mode: 'fork',           // أو 'cluster' للخطط المدفوعة
    
    // 🛡️ Error Handling
    kill_timeout: 30000,         // 30 ثانية للإغلاق الآمن
    listen_timeout: 10000,       // 10 ثواني للبدء
    
    // 📝 Logging
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    
    // 🌐 Environment
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    
    // 💓 Health Check (PM2 Plus feature)
    exp_backoff_restart_delay: 100,
    
    // ⏰ Cron Restart - إعادة تشغيل يومية في الساعة 4 صباحاً للتنظيف
    // cron_restart: '0 4 * * *'
  }]
};
