/**
 * 🔔 External Keep-Alive Service
 * 
 * استخدم هذا الكود مع خدمة مجانية مثل:
 * - cron-job.org
 * - UptimeRobot (uptimerobot.com)
 * - Pingdom
 * - Better Uptime
 * 
 * أو شغله على جهازك المحلي أو سيرفر آخر
 * لإبقاء السيرفر على Render نشطاً دائماً
 */

import https from 'https';
import http from 'http';

// 🔧 إعدادات
const CONFIG = {
  // ضع رابط موقعك على Render هنا
  serverUrl: process.env.SERVER_URL || 'https://your-app.onrender.com',
  
  // كل 5 دقائق (Render ينام بعد 15 دقيقة)
  intervalMs: 5 * 60 * 1000,
  
  // Endpoints للفحص
  endpoints: ['/health', '/ping', '/']
};

let pingCount = 0;
let lastSuccessTime = null;
let consecutiveFailures = 0;

async function pingServer() {
  pingCount++;
  const endpoint = CONFIG.endpoints[pingCount % CONFIG.endpoints.length];
  const url = CONFIG.serverUrl + endpoint;
  
  console.log(`\n🔔 Ping #${pingCount}: ${url}`);
  
  return new Promise((resolve) => {
    const startTime = Date.now();
    const protocol = url.startsWith('https') ? https : http;
    
    const req = protocol.get(url, { timeout: 30000 }, (res) => {
      const responseTime = Date.now() - startTime;
      
      if (res.statusCode === 200) {
        console.log(`✅ Success! Response: ${res.statusCode} (${responseTime}ms)`);
        lastSuccessTime = new Date();
        consecutiveFailures = 0;
        resolve(true);
      } else {
        console.log(`⚠️ Unexpected response: ${res.statusCode}`);
        consecutiveFailures++;
        resolve(false);
      }
    });
    
    req.on('error', (err) => {
      console.error(`❌ Error: ${err.message}`);
      consecutiveFailures++;
      
      if (consecutiveFailures >= 3) {
        console.error(`🚨 Server might be down! ${consecutiveFailures} consecutive failures`);
      }
      
      resolve(false);
    });
    
    req.on('timeout', () => {
      console.error('❌ Timeout after 30 seconds');
      req.destroy();
      consecutiveFailures++;
      resolve(false);
    });
  });
}

function showStats() {
  console.log('\n📊 Keep-Alive Stats:');
  console.log(`   Total pings: ${pingCount}`);
  console.log(`   Last success: ${lastSuccessTime ? lastSuccessTime.toISOString() : 'Never'}`);
  console.log(`   Consecutive failures: ${consecutiveFailures}`);
}

async function start() {
  console.log('🚀 External Keep-Alive Service Started');
  console.log(`📍 Target: ${CONFIG.serverUrl}`);
  console.log(`⏰ Interval: ${CONFIG.intervalMs / 1000} seconds\n`);
  
  // Ping immediately
  await pingServer();
  
  // Then ping on interval
  setInterval(async () => {
    await pingServer();
  }, CONFIG.intervalMs);
  
  // Show stats every 10 pings
  setInterval(() => {
    if (pingCount % 10 === 0) {
      showStats();
    }
  }, CONFIG.intervalMs);
}

start();

/**
 * 📋 كيفية الاستخدام:
 * 
 * الطريقة 1: cron-job.org (مجاني)
 * 1. اذهب إلى https://cron-job.org
 * 2. أنشئ حساب مجاني
 * 3. أضف cron job جديد:
 *    - URL: https://your-app.onrender.com/health
 *    - Schedule: */5 * * * * (كل 5 دقائق)
 * 
 * الطريقة 2: UptimeRobot (مجاني)
 * 1. اذهب إلى https://uptimerobot.com
 * 2. أنشئ حساب مجاني
 * 3. أضف Monitor جديد:
 *    - Type: HTTP(s)
 *    - URL: https://your-app.onrender.com/health
 *    - Interval: 5 minutes
 * 
 * الطريقة 3: تشغيل هذا الملف
 * SERVER_URL=https://your-app.onrender.com node keep-alive-external.js
 */
