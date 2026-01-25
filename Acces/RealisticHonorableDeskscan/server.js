import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { WebSocketServer } from 'ws';
import { pool, initializeDatabase, saveUser, getUser, processReferral, getUserReferrals, updateProcessingStatus, getProcessingHistory, updateAccumulatedReward, getAccumulatedReward } from './db.js';
import ultraCache from './ultra-cache-system.js';
import WebSocketRPCHandler from './websocket-rpc-handler.js';
import { getGlobalAccessStateStorage } from './access-state-storage.js';
import webpush from 'web-push';
import { startReEngagementScheduler } from './re-engagement-notifications.js';

// ============================================================================
// 📦 إصدار الملفات - غير هذا الرقم فقط لتحديث كل الملفات
// ============================================================================
const ASSETS_VERSION = '14.0';

// ============================================================================
// 🛡️ NEVER DIE PROTECTION - السيرفر لا يسقط أبداً!
// ============================================================================
let serverCrashCount = 0;
const MAX_ERRORS_PER_MINUTE = 100;
let errorCountThisMinute = 0;

// Reset error count every minute
setInterval(() => {
  if (errorCountThisMinute > 0) {
    console.log(`[PROTECTION] Errors this minute: ${errorCountThisMinute}`);
  }
  errorCountThisMinute = 0;
}, 60000);

// 🛡️ حماية من الأخطاء غير المتوقعة - لا تُسقط السيرفر!
process.on('uncaughtException', (error) => {
  serverCrashCount++;
  errorCountThisMinute++;
  
  // Log only if not too many errors
  if (errorCountThisMinute <= 10) {
    console.error(`❌ [CAUGHT] Uncaught Exception #${serverCrashCount}:`, error.message);
  }
  
  // إذا كانت الأخطاء كثيرة جداً، شيء خاطئ بشكل كبير
  if (errorCountThisMinute > MAX_ERRORS_PER_MINUTE) {
    console.error('⚠️ Too many errors! But server continues...');
  }
  
  // 🛡️ لا نستدعي process.exit() - السيرفر يستمر!
});

process.on('unhandledRejection', (reason, promise) => {
  errorCountThisMinute++;
  
  // Log only if not too many errors
  if (errorCountThisMinute <= 10) {
    console.error('❌ [CAUGHT] Unhandled Rejection:', reason);
  }
  
  // 🛡️ لا نستدعي process.exit() - السيرفر يستمر!
});

// 🧹 Memory cleanup كل 5 دقائق
setInterval(() => {
  if (global.gc) {
    global.gc();
  }
  // تنظيف الذاكرة
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  if (heapUsedMB > 400) {
    console.log(`🧹 High memory: ${heapUsedMB}MB - cleaning up...`);
  }
}, 5 * 60 * 1000);

// ============================================================================

// 🏗️ Enterprise Distributed Infrastructure - للتوسع لملايين المستخدمين
import enterpriseInfra from './enterprise-infrastructure.js';

// Configure web-push with VAPID keys
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@access-network.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}
// KYC system removed to reduce resource consumption

// تفعيل الوضع الصامت في الإنتاج
if (process.env.REPL_DEPLOYMENT === '1') {
  console.log = () => {};
  console.warn = () => {};
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize the database with improved error handling
let explorerAPI = null; // Will be initialized after network is ready

// 🏗️ تهيئة البنية التحتية الموزعة للتوسع
let enterpriseInfrastructure = null;

initializeDatabase()
  .then(() => {
    // Initialize earning countdown tables after main database is ready
    return initializeActivityCountdownTables();
  })
  .then(async () => {
    // 🏗️ تهيئة البنية التحتية للملايين
    try {
      enterpriseInfrastructure = await enterpriseInfra.initialize({
        shardCount: 16,              // 16 shard للمعاملات
        maxTxPerBlock: 1000,         // 1000 معاملة/بلوك
        blockInterval: 3000,         // بلوك كل 3 ثوان
        rateLimitMax: 200,           // 200 طلب/دقيقة
        cacheMaxSize: 50000,         // 50 ألف عنصر cache
        maxMemory: 300 * 1024 * 1024 // 300MB حد الذاكرة
      });
    } catch (err) {
      console.warn('⚠️ Enterprise Infrastructure not initialized:', err.message);
    }
  })
  .catch(err => {
    console.error('Critical Error initializing database:', err);
  });


// User session tracking
const activeUsers = new Map();
const userSessions = new Map();

// 🚀 نظام Throttling ذكي لمنع UPDATE المتكررة
const serverAccumulatedThrottle = new Map();
const SERVER_THROTTLE_MS = 10000; // 10 ثواني بين كل UPDATE

// 🚀 Cache للـ API responses لتجنب SELECT المتكررة
const accumulatedApiCache = new Map(); // userId -> { data, timestamp }
const API_CACHE_MS = 5000; // 5 ثوانٍ cache

function getCachedAccumulatedData(userId) {
  const cached = accumulatedApiCache.get(userId);
  if (cached && Date.now() - cached.timestamp < API_CACHE_MS) {
    return cached.data;
  }
  return null;
}

function setCachedAccumulatedData(userId, data) {
  accumulatedApiCache.set(userId, { data, timestamp: Date.now() });
}

// تنظيف cache كل دقيقة
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of accumulatedApiCache.entries()) {
    if (now - entry.timestamp > 60000) accumulatedApiCache.delete(id);
  }
}, 60000);

// 🚀 Safe Query helper with timeout and retry - لمنع Query read timeout
async function safeQuery(query, params = [], timeoutMs = 5000, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await Promise.race([
        pool.query(query, params),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
        )
      ]);
      return result;
    } catch (error) {
      if (error.message === 'Query timeout') {
        console.warn(`⚠️ Query timed out (attempt ${attempt}/${retries}):`, query.substring(0, 50));
      }
      // إعادة المحاولة إذا لم تكن آخر محاولة
      if (attempt < retries) {
        console.log(`🔄 Retrying query... (${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, 500)); // انتظار نصف ثانية قبل إعادة المحاولة
        continue;
      }
      throw error;
    }
  }
}

function shouldSkipServerUpdate(userId) {
  const now = Date.now();
  const lastUpdate = serverAccumulatedThrottle.get(userId) || 0;
  if (now - lastUpdate < SERVER_THROTTLE_MS) return true;
  serverAccumulatedThrottle.set(userId, now);
  return false;
}

// تنظيف كل 5 دقائق
setInterval(() => {
  const now = Date.now();
  for (const [id, time] of serverAccumulatedThrottle.entries()) {
    if (now - time > 60000) serverAccumulatedThrottle.delete(id);
  }
}, 5 * 60 * 1000);

// 🚀 نظام التراكم الذكي - حساب رياضي بدون UPDATE
function calculateAccumulatedReward(startTimeSec, boostMultiplier = 1.0) {
  if (!startTimeSec || startTimeSec <= 0) return 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const processingDuration = 24 * 60 * 60;
  const elapsedSec = nowSec - startTimeSec;
  if (elapsedSec <= 0) return 0;
  if (elapsedSec >= processingDuration) return 0.25 * boostMultiplier;
  return Math.round((0.25 * boostMultiplier * (elapsedSec / processingDuration)) * 100000000) / 100000000;
}

// ============================================================================
// 🛡️ نظام حماية الجلسات الكامل - يحفظ ويستعيد الإحالات النشطة + Ad Boost
// ============================================================================

/**
 * حفظ جميع الجلسات النشطة مع حساب المكافآت الكاملة (base + referrals + boost)
 * يُستدعى عند إيقاف السيرفر (SIGTERM/SIGINT)
 */
async function saveAllActiveSessionsOnShutdown() {
  console.log('🛡️ [SHUTDOWN PROTECTION] Saving all active sessions...');
  
  try {
    // جلب جميع المستخدمين الذين لديهم جلسات نشطة
    const activeSessionsResult = await pool.query(`
      SELECT 
        u.id as user_id,
        u.processing_start_time_seconds,
        u.processing_end_time,
        u.session_locked_boost,
        u.ad_boost_active,
        u.accumulatedreward,
        u.accumulated_processing_reward,
        u.completed_processing_reward
      FROM users u
      WHERE u.processing_active = 1 
        AND u.processing_start_time_seconds > 0
    `);
    
    if (activeSessionsResult.rows.length === 0) {
      console.log('✅ [SHUTDOWN] No active sessions to save');
      return { saved: 0 };
    }
    
    console.log(`📊 [SHUTDOWN] Found ${activeSessionsResult.rows.length} active sessions to protect`);
    
    const nowSec = Math.floor(Date.now() / 1000);
    const processingDuration = 24 * 60 * 60;
    let savedCount = 0;
    
    for (const session of activeSessionsResult.rows) {
      try {
        const userId = session.user_id;
        const startTimeSec = parseInt(session.processing_start_time_seconds) || 0;
        // session_locked_boost يحتوي على boost كامل (base + referrals + ad boost)
        const sessionLockedBoost = parseFloat(session.session_locked_boost) || 1.0;
        
        if (startTimeSec <= 0) continue;
        
        // حساب المكافأة المتراكمة الكاملة باستخدام المضاعف المثبت
        const elapsedSec = nowSec - startTimeSec;
        const baseReward = 0.25;
        const boostedReward = baseReward * sessionLockedBoost;
        const rewardProgress = Math.min(1, Math.max(0, elapsedSec / processingDuration));
        const fullAccumulatedReward = Math.round((boostedReward * rewardProgress) * 100000000) / 100000000;
        
        // حفظ المكافأة الكاملة (مع الإحالات والـ boost)
        await pool.query(`
          UPDATE users 
          SET accumulatedreward = GREATEST(COALESCE(accumulatedreward, 0), $1),
              accumulated_processing_reward = GREATEST(COALESCE(accumulated_processing_reward, 0), $1),
              completed_processing_reward = GREATEST(COALESCE(completed_processing_reward, 0), $1)
          WHERE id = $2
        `, [fullAccumulatedReward, userId]);
        
        console.log(`✅ [SHUTDOWN] User ${userId}: Saved ${fullAccumulatedReward.toFixed(8)} ACCESS (boost: ${sessionLockedBoost.toFixed(2)}x)`);
        savedCount++;
        
      } catch (userError) {
        console.error(`❌ [SHUTDOWN] Error saving user ${session.user_id}:`, userError.message);
      }
    }
    
    console.log(`🛡️ [SHUTDOWN COMPLETE] Protected ${savedCount}/${activeSessionsResult.rows.length} sessions`);
    return { saved: savedCount, total: activeSessionsResult.rows.length };
    
  } catch (error) {
    console.error('❌ [SHUTDOWN] Critical error saving sessions:', error.message);
    return { saved: 0, error: error.message };
  }
}

/**
 * استعادة وحماية الجلسات عند بدء السيرفر
 * يعيد حساب المكافآت للجلسات التي كانت نشطة أثناء إيقاف السيرفر
 * 🛡️ FIXED: يصلح session_locked_boost للمستخدمين مع ad_boost
 */
async function recoverActiveSessionsOnStartup() {
  console.log('🔄 [STARTUP RECOVERY] Checking for sessions that need recovery...');
  
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const processingDuration = 24 * 60 * 60;
    
    // جلب الجلسات التي كانت نشطة ولم تنتهِ بعد (مع معلومات الإحالات)
    const sessionsToRecover = await pool.query(`
      SELECT 
        u.id as user_id,
        u.processing_start_time_seconds,
        u.processing_end_time,
        u.session_locked_boost,
        u.ad_boost_active,
        u.accumulatedreward,
        u.accumulated_processing_reward,
        u.coins,
        (SELECT COUNT(*) FROM referrals r 
         JOIN users ref ON r.referee_id = ref.id 
         WHERE r.referrer_id = u.id 
         AND (ref.processing_active = 1 OR ref.is_active = 1)) as active_referral_count
      FROM users u
      WHERE u.processing_active = 1 
        AND u.processing_start_time_seconds > 0
        AND (u.processing_start_time_seconds + ${processingDuration}) > ${nowSec}
    `);
    
    if (sessionsToRecover.rows.length === 0) {
      console.log('✅ [STARTUP] No sessions need recovery');
      
      // تحقق من الجلسات المنتهية التي تحتاج نقل مكافأة
      await finalizeCompletedSessions();
      return { recovered: 0 };
    }
    
    console.log(`📊 [STARTUP] Found ${sessionsToRecover.rows.length} sessions to verify`);
    
    // استيراد computeHashrateMultiplier
    const { computeHashrateMultiplier } = await import('./db.js');
    
    let recoveredCount = 0;
    
    for (const session of sessionsToRecover.rows) {
      try {
        const userId = session.user_id;
        const startTimeSec = parseInt(session.processing_start_time_seconds) || 0;
        let sessionLockedBoost = parseFloat(session.session_locked_boost) || 1.0;
        const storedAccumulated = parseFloat(session.accumulatedreward) || 0;
        const adBoostActive = session.ad_boost_active || false;
        const activeReferralCount = parseInt(session.active_referral_count) || 0;
        
        // 🛡️ FIX: إذا كان ad_boost نشط ولكن session_locked_boost = 1.0، أعد حسابه!
        if ((adBoostActive || activeReferralCount > 0) && sessionLockedBoost <= 1.0) {
          const boostCalc = computeHashrateMultiplier(activeReferralCount, adBoostActive);
          sessionLockedBoost = boostCalc.multiplier;
          
          // تحديث session_locked_boost في قاعدة البيانات
          await pool.query(
            `UPDATE users SET session_locked_boost = $1 WHERE id = $2`,
            [sessionLockedBoost, userId]
          );
          
          console.log(`🔧 [BOOST FIX] User ${userId}: Fixed session_locked_boost to ${sessionLockedBoost.toFixed(2)}x (ad_boost: ${adBoostActive}, referrals: ${activeReferralCount})`);
        }
        
        // حساب المكافأة الحقيقية حتى الآن
        const elapsedSec = nowSec - startTimeSec;
        const baseReward = 0.25;
        const boostedReward = baseReward * sessionLockedBoost;
        const rewardProgress = Math.min(1, Math.max(0, elapsedSec / processingDuration));
        const calculatedReward = Math.round((boostedReward * rewardProgress) * 100000000) / 100000000;
        
        // إذا كانت المكافأة المحسوبة أكبر من المحفوظة، حدّث
        if (calculatedReward > storedAccumulated) {
          await pool.query(`
            UPDATE users 
            SET accumulatedreward = $1,
                accumulated_processing_reward = $1
            WHERE id = $2
          `, [calculatedReward, userId]);
          
          console.log(`🔄 [RECOVERY] User ${userId}: Updated ${storedAccumulated.toFixed(8)} → ${calculatedReward.toFixed(8)} ACCESS`);
          recoveredCount++;
        }
        
      } catch (userError) {
        console.error(`❌ [RECOVERY] Error recovering user ${session.user_id}:`, userError.message);
      }
    }
    
    // معالجة الجلسات المنتهية
    await finalizeCompletedSessions();
    
    console.log(`🔄 [STARTUP COMPLETE] Recovered ${recoveredCount} sessions`);
    return { recovered: recoveredCount };
    
  } catch (error) {
    console.error('❌ [STARTUP] Error in recovery:', error.message);
    return { recovered: 0, error: error.message };
  }
}

/**
 * معالجة الجلسات المنتهية - نقل المكافأة إلى الرصيد
 */
async function finalizeCompletedSessions() {
  console.log('🏁 [FINALIZE] Checking completed sessions...');
  
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const processingDuration = 24 * 60 * 60;
    
    // جلسات انتهت ولديها مكافأة للنقل
    const completedSessions = await pool.query(`
      SELECT 
        u.id as user_id,
        u.processing_start_time_seconds,
        u.session_locked_boost,
        u.accumulatedreward,
        u.accumulated_processing_reward,
        u.completed_processing_reward,
        u.coins
      FROM users u
      WHERE u.processing_active = 1 
        AND u.processing_start_time_seconds > 0
        AND (u.processing_start_time_seconds + ${processingDuration}) <= ${nowSec}
    `);
    
    if (completedSessions.rows.length === 0) {
      console.log('✅ [FINALIZE] No completed sessions pending');
      return { finalized: 0 };
    }
    
    console.log(`📊 [FINALIZE] Found ${completedSessions.rows.length} completed sessions to finalize`);
    
    let finalizedCount = 0;
    
    for (const session of completedSessions.rows) {
      try {
        const userId = session.user_id;
        const sessionLockedBoost = parseFloat(session.session_locked_boost) || 1.0;
        const currentCoins = parseFloat(session.coins) || 0;
        
        // المكافأة الكاملة = 0.25 × المضاعف
        const fullReward = Math.round((0.25 * sessionLockedBoost) * 100000000) / 100000000;
        const newBalance = Math.round((currentCoins + fullReward) * 100000000) / 100000000;
        
        // نقل المكافأة للرصيد وإنهاء الجلسة
        await pool.query(`
          UPDATE users 
          SET coins = $1,
              processing_active = 0,
              accumulatedreward = 0,
              accumulated_processing_reward = 0,
              completed_processing_reward = 0,
              session_locked_boost = 1.0
          WHERE id = $2
        `, [newBalance, userId]);
        
        console.log(`🏁 [FINALIZE] User ${userId}: +${fullReward.toFixed(8)} ACCESS → Balance: ${newBalance.toFixed(8)}`);
        finalizedCount++;
        
      } catch (userError) {
        console.error(`❌ [FINALIZE] Error finalizing user ${session.user_id}:`, userError.message);
      }
    }
    
    console.log(`🏁 [FINALIZE COMPLETE] Finalized ${finalizedCount} sessions`);
    return { finalized: finalizedCount };
    
  } catch (error) {
    console.error('❌ [FINALIZE] Error:', error.message);
    return { finalized: 0, error: error.message };
  }
}

// ============================================================================
// 🛡️ معالجات إيقاف السيرفر الآمنة (SIGTERM, SIGINT)
// ============================================================================

let isShuttingDown = false;
let shutdownTimeout = null;

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    console.log('⚠️ Already shutting down...');
    return;
  }
  
  isShuttingDown = true;
  console.log(`\n🛑 [${signal}] Graceful shutdown initiated...`);
  
  // ⏰ حد أقصى للإغلاق 30 ثانية
  shutdownTimeout = setTimeout(() => {
    console.log('⏰ Shutdown timeout - forcing exit');
    process.exit(1);
  }, 30000);
  
  try {
    // 1️⃣ إيقاف Server-Side Processing Sync
    try {
      const { serverSideProcessingSync } = await import('./server_side_activity_sync.js');
      console.log('[SHUTDOWN] Stopping server-side processing sync...');
      serverSideProcessingSync.stop();
    } catch (e) {
      // silent - module may not be loaded
    }
    
    // 2️⃣ حفظ بيانات الشبكة (blockchain)
    try {
      if (global.accessNode && global.accessNode.network) {
        console.log('[SHUTDOWN] Saving blockchain data...');
        await global.accessNode.network.saveChain();
        await global.accessNode.network.saveMempool();
      }
    } catch (e) {
      console.log('[SHUTDOWN] Blockchain save skipped:', e.message);
    }
    
    // 3️⃣ حفظ جميع الجلسات النشطة
    const saveResult = await saveAllActiveSessionsOnShutdown();
    console.log(`🛡️ Sessions saved: ${saveResult.saved || 0}`);
    
    // 4️⃣ إغلاق pool قاعدة البيانات بأمان
    await pool.end();
    console.log('✅ Database pool closed');
    
  } catch (error) {
    console.error('❌ Error during shutdown:', error.message);
  }
  
  clearTimeout(shutdownTimeout);
  console.log('👋 Server shutdown complete');
  process.exit(0);
}

// تسجيل معالجات الإيقاف - مركزي في server.js فقط
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// ⚠️ ملاحظة: معالجات uncaughtException و unhandledRejection في بداية الملف

// استعادة الجلسات عند بدء السيرفر (بعد تهيئة DB)
setTimeout(async () => {
  try {
    await recoverActiveSessionsOnStartup();
  } catch (error) {
    console.error('❌ [STARTUP] Recovery failed:', error.message);
  }
}, 5000); // انتظار 5 ثوانٍ للتأكد من جاهزية DB

// ============================================================================


// تهيئة نظام التخزين الدائم المتقدم
import PermanentStorageOnly from './permanent-storage-only.js';
import NetworkStorageManager from './network-storage-manager.js';

// إنشاء مدير التخزين الدائم المحسن
import PurePermanentNetworkStorage from './permanent-storage-only.js';
import { logError, suppressError } from './error-manager.js';

// ✅ Initialize Backup System (Web3 wallet protection)
import { backupSystem } from './backup-system.js';


// قمع الأخطاء الشائعة غير الحرجة
suppressError('column "block_number"');
suppressError('ServiceWorker registration failed');
suppressError('WebSocket disconnected');
suppressError('Presence WebSocket disconnected');
suppressError('column "block_number" does not exist');
suppressError('column "block_number" of relation');
suppressError('errorMissingColumn');



const purePermanentStorage = new PurePermanentNetworkStorage();
const networkStorageManager = new NetworkStorageManager();

// ✅ ACCESS Network State Storage (بدلاً من external_wallets) - Singleton
const accessStateStorage = getGlobalAccessStateStorage();

// تهيئة نظام التخزين الدائم الخالص (مثل إيثريوم/بايننس)
purePermanentStorage.initializePermanentTables().then(() => {
  // ✅ Removed verbose Arabic logging for performance
  // ترحيل البيانات الموجودة
  return purePermanentStorage.migrateToPermanentStorage();
}).then((migrationResult) => {
  if (migrationResult) {
    // ✅ Removed verbose Arabic logging for performance
  }
  
  // التحقق من تكامل البيانات
  return purePermanentStorage.verifyDataIntegrity();
}).then((integrityResult) => {
  if (integrityResult?.isIntegrityValid) {
    // ✅ Removed verbose Arabic logging for performance
  }
  
  // عرض إحصائيات التخزين المتقدم
  const storageStats = networkStorageManager.getStorageStats();
  if (storageStats?.storage_comparison?.performance_mode) {
    // stats available silently
  }
}).catch(error => {
  logError('permanent_storage_init', error, 'warn');
});

// ✅ Removed verbose Arabic logging for performance

// عرض إحصائيات التخزين الدائم مع فحص حالة السحابة
setInterval(async () => {
  try {
    const stats = await permanentStorage.getStorageStats();
    const health = await permanentStorage.getStorageHealth();
    
    if (stats) {
      // تم إزالة رسائل الكونسول المتكررة لتوفير الموارد
      
      if (!health.cloudAvailable) {
        console.warn('☁️ تحذير: التخزين السحابي غير متاح - يتم استخدام التخزين المؤقت');
      }
    }

    // إحصائيات التخزين المتقدم (صامتة لتوفير الموارد)
  } catch (statsError) {
    console.warn('⚠️ تعذر جلب إحصائيات التخزين:', statsError.message);
  }
}, 30 * 60 * 1000); // كل 30 دقيقة

// حفظ دوري للبيانات مع نظام التخزين المتقدم
setInterval(async () => {
  try {
    if (explorerAPI && explorerAPI.network) {
      // حفظ البيانات في نظام التخزين المتقدم
      const latestBlock = explorerAPI.network.getLatestBlock();
      if (latestBlock) {
        await networkStorageManager.saveProfessionalBlock(latestBlock);
      }

      // تنظيف البيانات القديمة
      networkStorageManager.cleanupOldBackups();
    }
  } catch (saveError) {
    console.warn('⚠️ تحذير: فشل في الحفظ الدوري:', saveError.message);
  }
}, 10 * 60 * 1000); // كل 10 دقائق


// WebSocket server instance - will be initialized later
let wss = null;
let wsRPCHandler = null; // WebSocket RPC Handler for Web3 wallet connections

// Send Web Push notification to recipient wallet owner (MODULE LEVEL - accessible from all endpoints)
// Duplicate function removed - using the more complete version below

// Initialize missing database columns and network system
        initializeDatabase()
          .then(async () => {
            try {
              // Add missing columns if they don't exist
              await pool.query(`
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'users' AND column_name = 'last_server_sync'
                  ) THEN
                    ALTER TABLE users ADD COLUMN last_server_sync BIGINT DEFAULT 0;
                  END IF;
                END$$;
              `);

// نظام إشعارات شامل للمحافظ الخارجية - محسن للاستلام
async function notifyExternalWallets(transactionData) {
  try {
    const { default: crypto } = await import('crypto');
    
    // إنشاء Transaction Receipt للمحافظ الخارجية
    const transactionReceipt = {
      transactionHash: transactionData.hash,
      transactionIndex: '0x0',
      blockHash: transactionData.blockHash,
      blockNumber: transactionData.blockNumber,
      from: transactionData.from.toLowerCase(),
      to: transactionData.to.toLowerCase(),
      gasUsed: '0x5208',
      cumulativeGasUsed: '0x5208',
      contractAddress: null,
      logs: [{
        address: '0x0000000000000000000000000000000000000000',
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          '0x000000000000000000000000' + transactionData.from.slice(2).toLowerCase(),
          '0x000000000000000000000000' + transactionData.to.slice(2).toLowerCase()
        ],
        data: '0x' + Math.floor(transactionData.amount * 1e18).toString(16).padStart(64, '0'),
        blockNumber: transactionData.blockNumber,
        transactionHash: transactionData.hash,
        transactionIndex: '0x0',
        blockHash: transactionData.blockHash,
        logIndex: '0x0',
        removed: false
      }],
      status: '0x1',
      type: '0x0'
    };

    // إشعار MetaMask - Transaction Receipt
    const metamaskNotification = {
      jsonrpc: '2.0',
      method: 'eth_subscription',
      params: {
        subscription: 'logs',
        result: transactionReceipt.logs[0]
      }
    };

    // إشعار Trust Wallet - Balance Change
    const trustWalletNotification = {
      type: 'accountsChanged',
      accounts: [transactionData.to.toLowerCase()],
      chainId: '0x5968',
      balance: await getWalletBalance(transactionData.to),
      transaction: {
        hash: transactionData.hash,
        from: transactionData.from.toLowerCase(),
        to: transactionData.to.toLowerCase(),
        value: '0x' + Math.floor(transactionData.amount * 1e18).toString(16),
        type: 'received'
      }
    };

    // إشعار Digital Wallet - Transaction Event
    const walletNotification = {
      type: 'transaction',
      chainId: 22888,
      address: transactionData.to.toLowerCase(),
      hash: transactionData.hash,
      blockNumber: parseInt(transactionData.blockNumber, 16),
      from: transactionData.from.toLowerCase(),
      to: transactionData.to.toLowerCase(),
      value: transactionData.amount,
      timestamp: transactionData.timestamp,
      status: 'confirmed',
      direction: 'received'
    };

    // إشعار عام للمحافظ - Web3 Event
    const web3Event = {
      jsonrpc: '2.0',
      method: 'eth_getTransactionReceipt',
      params: [transactionData.hash],
      result: transactionReceipt
    };

    // إرسال جميع الإشعارات
    const notifications = [
      { type: 'metamask_transaction_receipt', data: metamaskNotification },
      { type: 'trust_wallet_balance_change', data: trustWalletNotification },
      { type: 'coinbase_transaction_event', data: coinbaseNotification },
      { type: 'web3_transaction_receipt', data: web3Event },
      { type: 'external_wallet_received', ...coinbaseNotification }
    ];

    // Track connections we've already sent to (to avoid duplicates)
    const sentConnections = new Set();

    // Broadcast to wss.clients
    if (wss && wss.clients) {
      wss.clients.forEach(client => {
        if (client.readyState === 1) {
          sentConnections.add(client);
          notifications.forEach(notification => {
            try {
              client.send(JSON.stringify(notification));
            } catch (sendErr) {
              console.error('Error sending external wallet notification:', sendErr.message);
            }
          });
        }
      });
    }

    // Also broadcast to activeUsers presence connections
    if (activeUsers && activeUsers.size > 0) {
      for (const [userId, session] of activeUsers.entries()) {
        if (session && session.ws && session.ws.readyState === 1) {
          if (!sentConnections.has(session.ws)) {
            notifications.forEach(notification => {
              try {
                session.ws.send(JSON.stringify(notification));
              } catch (sendErr) {
                console.error(`Error sending external notification to user ${userId}:`, sendErr.message);
              }
            });
          }
        }
      }
    }

    // ✅ Removed verbose Arabic logging for performance
    
  } catch (error) {
    console.error('خطأ في إرسال إشعارات المحافظ الخارجية:', error);
  }
}

// دالة للحصول على رصيد المحفظة
async function getWalletBalance(address) {
  try {
    const { getNetworkNode } = await import('./network-api.js');
    const networkNode = getNetworkNode();
    if (networkNode && networkNode.network) {
      const balance = networkNode.network.getBalance(address.toLowerCase());
      return '0x' + Math.floor(balance * 1e18).toString(16);
    }
    return '0x0';
  } catch (error) {
    return '0x0';
  }
}

// نظام سجل معاملات محسن للمحافظ الخارجية
async function broadcastTransactionLog(transactionData) {
  try {
    // سجل معاملة Transfer Event للمحافظ
    const transferLog = {
      address: '0x0000000000000000000000000000000000000000', // Native token
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer event signature
        '0x000000000000000000000000' + transactionData.from.slice(2).toLowerCase(),
        '0x000000000000000000000000' + transactionData.to.slice(2).toLowerCase()
      ],
      data: '0x' + Math.floor(transactionData.amount * 1e18).toString(16).padStart(64, '0'),
      blockNumber: transactionData.blockNumber,
      transactionHash: transactionData.hash,
      transactionIndex: '0x0',
      blockHash: transactionData.blockHash,
      logIndex: '0x0',
      removed: false
    };

    // سجل transaction history للمحفظة المستقبلة
    const receivedTransactionHistory = {
      hash: transactionData.hash,
      from: transactionData.from.toLowerCase(),
      to: transactionData.to.toLowerCase(),
      value: '0x' + Math.floor(transactionData.amount * 1e18).toString(16),
      gas: '0x5208',
      gasPrice: '0x' + Math.floor(0.00002 * 1e18 / 21000).toString(16), // ✅ صحيح: 952380952 Wei
      input: '0x',
      blockHash: transactionData.blockHash,
      blockNumber: transactionData.blockNumber,
      transactionIndex: '0x0',
      type: '0x0',
      status: '0x1',
      timestamp: '0x' + Math.floor(transactionData.timestamp / 1000).toString(16)
    };

    // إشعار transaction list update للمحافظ
    const transactionListUpdate = {
      jsonrpc: '2.0',
      method: 'eth_getTransactionByHash',
      params: [transactionData.hash],
      result: receivedTransactionHistory
    };

    // إشعار balance update
    const balanceUpdate = {
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [transactionData.to.toLowerCase(), 'latest'],
      result: await getWalletBalance(transactionData.to)
    };

    // إرسال جميع إشعارات السجل للمحافظ
    const logNotifications = [
      { type: 'transfer_log', log: transferLog, targetWallet: transactionData.to.toLowerCase() },
      { type: 'transaction_history', transaction: receivedTransactionHistory, targetWallet: transactionData.to.toLowerCase() },
      { type: 'transaction_list_update', data: transactionListUpdate, targetWallet: transactionData.to.toLowerCase() },
      { type: 'balance_update', data: balanceUpdate, targetWallet: transactionData.to.toLowerCase() },
      { type: 'wallet_activity', walletAddress: transactionData.to.toLowerCase(), activity: 'received', amount: transactionData.amount, hash: transactionData.hash, from: transactionData.from.toLowerCase() }
    ];

    // Track connections we've already sent to (to avoid duplicates)
    const sentConnections = new Set();

    // Broadcast to wss.clients (general WebSocket connections)
    if (wss && wss.clients) {
      wss.clients.forEach(client => {
        if (client.readyState === 1) {
          sentConnections.add(client);
          logNotifications.forEach(notification => {
            try {
              client.send(JSON.stringify(notification));
            } catch (sendErr) {
              console.error('Error sending to wss client:', sendErr.message);
            }
          });
        }
      });
    }

    // Also broadcast to activeUsers presence connections (ensures all connected users receive notifications)
    if (activeUsers && activeUsers.size > 0) {
      let presenceCount = 0;
      for (const [userId, session] of activeUsers.entries()) {
        if (session && session.ws && session.ws.readyState === 1) {
          // Skip if already sent via wss.clients
          if (!sentConnections.has(session.ws)) {
            logNotifications.forEach(notification => {
              try {
                session.ws.send(JSON.stringify(notification));
              } catch (sendErr) {
                console.error(`Error sending to presence user ${userId}:`, sendErr.message);
              }
            });
            presenceCount++;
          }
        }
      }
    }

    // Send Web Push notifications to recipient (background notifications like YouTube)
    await sendWebPushNotificationToRecipient(transactionData);
    
  } catch (error) {
    console.error('خطأ في إرسال سجل المعاملات:', error);
  }
}

// Format amount: 1000 → 1,000 | 1 → 1 | 0.5 → 0.50 | 1.5 → 1.50
function formatAmountSmart(amount) {
  const num = parseFloat(amount);
  if (isNaN(num)) return '0';
  if (num === 0) return '0';
  
  // If it's a whole number, show without decimals with thousand separators
  if (Number.isInteger(num)) {
    return num.toLocaleString('en-US');
  }
  
  // For decimal numbers, show at least 2 decimal places
  let formatted = parseFloat(num.toFixed(8)).toString();
  const parts = formatted.split('.');
  
  // Ensure at least 2 decimal places
  if (parts[1] && parts[1].length < 2) {
    parts[1] = parts[1].padEnd(2, '0');
  }
  
  // Add thousand separators to the integer part
  parts[0] = parseInt(parts[0]).toLocaleString('en-US');
  
  return parts.join('.');
}

// Send Web Push notification to recipient wallet owner
async function sendWebPushNotificationToRecipient(transactionData) {
  try {
    // Silent - reduce console spam
    
    const recipientWallet = transactionData.to.toLowerCase();
    const amount = formatAmountSmart(transactionData.amount || 0);
    const fromAddress = transactionData.from.toLowerCase();
    const fromShort = fromAddress.length > 10 ? 
      `${fromAddress.substring(0, 6)}...${fromAddress.substring(fromAddress.length - 4)}` : fromAddress;

    // Silent - reduce console spam

    // Find user by wallet address
    const userResult = await pool.query(
      'SELECT id FROM users WHERE LOWER(wallet_address) = $1',
      [recipientWallet]
    );

    if (userResult.rows.length === 0) {
      return;
    }

    const userId = userResult.rows[0].id;
    // Silent - reduce console spam

    // Get all active push subscriptions for this user
    const subsResult = await pool.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    );

    // Silent - reduce console spam

    if (subsResult.rows.length === 0) {
      return;
    }

    // Prepare notification payload - FLAT structure for Service Worker
    const payload = JSON.stringify({
      type: 'transaction_received',
      title: 'Received ACCESS',
      body: `From: ${fromShort}\nAmount: ${amount} ACCESS`,
      tag: `access-tx-${transactionData.hash || Date.now()}`,
      hash: transactionData.hash,
      amount: amount,
      from: fromAddress,
      to: recipientWallet,
      timestamp: Date.now()
    });

    // Send to all subscriptions
    let successCount = 0;
    let failCount = 0;

    for (const sub of subsResult.rows) {
      try {
        const subscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        };

        await webpush.sendNotification(subscription, payload);
        successCount++;
      } catch (pushError) {
        failCount++;
        // Silent - reduce console spam
        
        // If subscription is invalid (410 Gone, 404, or 403 Forbidden/VAPID mismatch)
        // DELETE it - Service Worker's pushsubscriptionchange will auto-renew
        if (pushError.statusCode === 410 || pushError.statusCode === 404 || pushError.statusCode === 403) {
          await pool.query(
            'DELETE FROM push_subscriptions WHERE endpoint = $1',
            [sub.endpoint]
          );
          // Silent - reduce console spam
          
          // Mark user for re-subscription notification via WebSocket
          try {
            // The client will auto-renew when they open the app
            // No action needed here - Service Worker handles it
          } catch (e) {
            // Ignore
          }
        }
      }
    }

    // Silent - reduce console spam
  } catch (error) {
    console.error('Error sending Web Push notification:', error);
  }
}

// ✅ Make function globally accessible to fix scope issues
global.sendWebPushNotificationToRecipient = sendWebPushNotificationToRecipient;

              // Import and initialize network system
              try {
                const { startContinuousSync, initializeNetwork, getNetworkNode } = await import('./network-api.js');
                
                // Initialize network first
                const networkNode = initializeNetwork();
                
                // Wait a moment for network to be ready
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Initialize Explorer API after network is ready
                if (networkNode && networkNode.network) {
                  explorerAPI = new ExplorerAPI(networkNode.network);
                } else {
                  // محاولة ثانية بعد انتظار إضافي
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  if (networkNode && networkNode.network) {
                    explorerAPI = new ExplorerAPI(networkNode.network);
                  }
                }
                
                // Start continuous sync system
                startContinuousSync();
                
                // Auto-mine pending transactions every 5 minutes
                setInterval(async () => {
                  try {
                    const { getNetworkNode } = await import('./network-api.js');
                    const networkNode = getNetworkNode();
                    if (networkNode && networkNode.network.pendingTransactions.length > 0) {
                      const processorAddress = '0x0000000000000000000000000000000000000000'; // System address
                      const block = networkNode.network.minePendingTransactions(processorAddress);
                      // Silent - reduce console spam
                    }
                  } catch (processingError) {
                    // Silent - reduce console spam
                  }
                }, 300000); // 5 minutes

                // Comprehensive sync on startup (silent mode)
                setTimeout(async () => {
                  try {
                    const { syncAllBalancesToNetwork } = await import('./network-api.js');
                    await syncAllBalancesToNetwork();
                  } catch (syncError) {
                    console.error('Error in initial sync:', syncError);
                  }
                }, 30000); // 30 seconds after startup

                // 📬 Start Re-Engagement Notification System
                startReEngagementScheduler();

              } catch (networkError) {
                console.error('Warning: Network initialization failed:', networkError);
                console.log('Continuing without ledger - transactions will use database only');
              }

            } catch (err) {
              console.error('Error creating missing columns:', err);
            }
          })
          .catch(err => {
            console.error('Critical Error initializing database:', err);
          });

        // نظام لوجنج محسن ومتقدم - تقليل استهلاك CPU بنسبة 90%+
const smartLogger = {
  cache: new Map(),
  maxCacheSize: 50,
  minLogInterval: 600000,     // 10 دقائق
  criticalInterval: 60000,    // دقيقة للأخطاء
  summaryInterval: 1800000,   // 30 دقيقة للملخصات
  silentMode: true,
  blockedMessages: new Set([
    // رسائل التخزين
    'Data saved Network-style',
    'State saved',
    'Mempool saved',
    'Chain data saved',
    'saved to storage',
    'Network State Balance',
    'Computing status check',
    // رسائل المزامنة المتكررة
    'Batch writing',
    'Batch write completed',
    'Balance synced',
    'Force sync completed',
    'Periodic sync',
    'already synced',
    'Preloading balances',
    'Cache Hit Rate',
    'Synced balance',
    'Block synced',
    'Transaction in cache',
    'NO-CACHE Balance',
    'METAMASK-STYLE',
    'DB block save',
    // رسائل WebSocket
    'WebSocket ping',
    'WebSocket pong',
    'ws connection',
    // رسائل أخرى متكررة
    'Processed cache',
    'Auto-archiving',
    'LevelDB-style',
    'Ethereum-style storage',
    'P2P server started',
  ]),
  
  isBlocked(message) {
    return Array.from(this.blockedMessages).some(blocked => message.includes(blocked));
  },
  
  log(key, message, level = 'info', isCritical = false) {
    // فلترة الرسائل المحظورة
    if (this.isBlocked(message) && !isCritical) {
      this.logQuiet(key);
      return;
    }
    
    const now = Date.now();
    const cached = this.cache.get(key);
    const interval = isCritical ? this.criticalInterval : this.minLogInterval;
    
    if (!cached || (now - cached.lastLogged) > interval) {
      if (level === 'error') {
        console.error(message);
      } else if (level === 'warn') {
        console.warn(message);
      } else if (isCritical) {
        console.log(message);
      }
      
      this.cache.set(key, { lastLogged: now, count: cached ? cached.count + 1 : 1 });
      
      // تنظيف الذاكرة
      if (this.cache.size > this.maxCacheSize) {
        const oldKeys = Array.from(this.cache.keys()).slice(0, 25);
        oldKeys.forEach(key => this.cache.delete(key));
      }
    }
  },
  
  logQuiet(key) {
    const cached = this.cache.get(key);
    if (!cached) {
      this.cache.set(key, { count: 1, lastLogged: Date.now() });
    } else {
      cached.count++;
      // عرض ملخص كل 1000 رسالة محظورة
      if (cached.count % 1000 === 0) {
        console.log(`📊 ملخص: رسائل مخفية ${cached.count} مرة`);
      }
    }
  },
  
  logProcessingStatus(userId, data) {
    // تقليل تكرار رسائل التعدين
    const key = `processing_${userId}`;
    this.logQuiet(key);
  },
  
  logWebSocket(userId, action) {
    const key = `ws_${userId}`;
    if (action === 'error') {
      this.log(key, `WebSocket error for user ${userId}`, 'error', true);
    } else {
      this.logQuiet(key);
    }
  },
  
  logSystem(component, message, level = 'info') {
    const key = `sys_${component}`;
    const isCritical = level === 'error' || level === 'warn';
    this.log(key, `[${component}] ${message}`, level, isCritical);
  }
};

// Helper function to check processing status
async function checkProcessingStatus(userId) {
  try {
    const now = Math.floor(Date.now() / 1000);
    
    // Get user's processing data
    const userResult = await pool.query(
      `SELECT processing_active, processing_start_time_seconds, processing_end_time, 
              accumulatedReward, processing_boost_multiplier
       FROM users WHERE id = $1`,
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return { success: false, error: 'User not found' };
    }
    
    const user = userResult.rows[0];
    const startTimeSec = parseInt(user.processing_start_time_seconds) || 0;
    const processingDuration = 24 * 60 * 60; // 24 hours
    const endTimeSec = startTimeSec > 0 ? startTimeSec + processingDuration : 0;
    
    // Determine if processing should be active
    const shouldBeActive = startTimeSec > 0 && endTimeSec > now;
    const processingActive = shouldBeActive ? 1 : 0;
    
    // Update processing status if needed
    if (parseInt(user.processing_active) !== processingActive) {
      await pool.query(
        'UPDATE users SET processing_active = $1 WHERE id = $2',
        [processingActive, userId]
      );
    }
    
    return {
      success: true,
      processing_active: processingActive,
      start_time: startTimeSec,
      end_time: endTimeSec,
      current_time: now,
      remaining_seconds: Math.max(0, endTimeSec - now)
    };
  } catch (error) {
    console.error('Error in checkProcessingStatus:', error);
    return { success: false, error: error.message };
  }
}

// Helper function to generate a random referral code
function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  console.log('Generated referral code:', code);
  return code;
}

// Function to parse JSON body from request
async function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        resolve(data);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', (error) => {
      reject(error);
    });
  });
}

// Verify user token and resolve to userId
async function verifyToken(token) {
  if (!token) return null;

  let payload = null;

  try {
    if (token.includes('.')) {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(Buffer.from(base64, 'base64').toString('binary').split('').map(c => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      payload = JSON.parse(jsonPayload);
    } else {
      payload = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    }
  } catch (error) {
    console.error('Token decode failed:', error.message);
    return null;
  }

  const email = payload?.email;
  if (!email) return null;

  try {
    const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (!result.rows[0]) return null;
    return { userId: result.rows[0].id, email };
  } catch (dbError) {
    console.error('Token verification DB error:', dbError.message);
    return null;
  }
}

// 🛡️ CRITICAL BALANCE PROTECTION: Audit logging for ALL balance changes
async function logBalanceChange(userId, email, oldBalance, newBalance, operationType, reason = '', ipAddress = null) {
  try {
    const changeAmount = parseFloat(newBalance) - parseFloat(oldBalance);
    
    await pool.query(
      `INSERT INTO balance_audit_log (user_id, email, old_balance, new_balance, change_amount, operation_type, reason, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, email, oldBalance, newBalance, changeAmount, operationType, reason, ipAddress]
    );
    
    // Silent - reduce console spam (audit is saved to database)
  } catch (error) {
    console.error('❌ CRITICAL: Failed to log balance change:', error);
    // Continue execution even if audit logging fails
  }
}

// 🔒 PROTECTED balance update with automatic audit logging
async function updateUserBalance(userId, email, newBalance, operationType, reason = '', ipAddress = null) {
  try {
    // Get current balance first
    const currentBalanceResult = await pool.query(
      'SELECT coins FROM users WHERE id = $1',
      [userId]
    );
    
    if (currentBalanceResult.rows.length === 0) {
      throw new Error(`User ${userId} not found`);
    }
    
    const oldBalance = currentBalanceResult.rows[0].coins;
    
    // Update balance
    const updateResult = await pool.query(
      'UPDATE users SET coins = $1 WHERE id = $2 RETURNING coins',
      [newBalance, userId]
    );
    
    // Log the change
    await logBalanceChange(userId, email, oldBalance, newBalance, operationType, reason, ipAddress);
    
    return updateResult.rows[0];
  } catch (error) {
    console.error('❌ CRITICAL: Failed to update balance:', error);
    throw error;
  }
}

// لم نعد نحتاج Firebase - نستخدم Google Identity Services المجاني

// Import the simplified processing countdown system
import { handleSimplifiedProcessingAPI } from './countdown_simplifier.js';
import { initializeActivityCountdownTables, startProcessingCountdown, getProcessingCountdownStatus, completeProcessingCountdown } from './activity_countdown_system.js';

// Import server-side processing sync for continuous background updates
import { serverSideProcessingSync } from './server_side_activity_sync.js';

// Import network functionality
import { initializeNetwork, handleNetworkAPI, getNetworkNode } from './network-api.js';

// Import Explorer API for Etherscan-compatible network explorer
import { ExplorerAPI } from './explorer-api.js';

// Import Explorer API Handler
import { handleExplorerAPI } from './explorer-api-handler.js';

// تحسين استهلاك الموارد - نظام ذكي يتفاعل حسب النشاط
const RESOURCE_OPTIMIZATION = {
  PROCESSING_SYNC_INTERVAL: 600000, // مراقبة عامة كل 10 دقائق
  FINAL_HOUR_MONITORING: 60000, // مراقبة مكثفة للساعة الأخيرة كل دقيقة
  WS_PING_INTERVAL_ACTIVE: 120000, // WebSocket ping للمستخدمين النشطين كل دقيقتين
  WS_PING_INTERVAL_IDLE: 600000, // WebSocket ping للمستخدمين الخاملين كل 10 دقائق
  MEMORY_CHECK_INTERVAL: 900000, // فحص الذاكرة كل 15 دقيقة
  INACTIVITY_CHECK_INTERVAL: 300000, // فحص عدم النشاط كل 5 دقائق
  USER_ACTIVITY_THRESHOLD: 60000, // عتبة النشاط - دقيقة واحدة
  IDLE_USER_THRESHOLD: 300000, // عتبة الخمول - 5 دقائق
  MAX_ACTIVE_CONNECTIONS: 100000, // ✅ زيادة إلى 100,000 اتصال متزامن
  BATCH_OPERATIONS: true,
  CACHE_DURATION: 300000,
  SMART_ACTIVITY_TRACKING: true, // تتبع ذكي للنشاط
  ADAPTIVE_INTERVALS: true, // فترات تتكيف مع النشاط
  NETWORK_SYNC_INTERVAL: 300000 // مزامنة الشبكة كل 5 دقائق
};

// Network synchronization function
async function syncWithNetwork() {
  try {
    const { getNetworkNode } = await import('./network-api.js');
    const networkNode = getNetworkNode();
    
    if (!networkNode || !networkNode.network) {
      return;
    }

    // Get unsynced transactions from database
    const unsyncedTxs = await pool.query(
      `SELECT * FROM transactions 
       WHERE status = 'confirmed' AND (description IS NULL OR description != 'Recorded on Access blockchain')
       ORDER BY timestamp DESC LIMIT 50`
    );

    let syncedCount = 0;
    for (const tx of unsyncedTxs.rows) {
      try {
        // Create network transaction
        const { Transaction } = await import('./network-system.js');
        const networkTx = new Transaction(
          tx.sender_address,
          tx.recipient_address,
          parseFloat(tx.amount),
          parseFloat(tx.gas_fee || 0.00002),
          parseInt(tx.timestamp)
        );
        
        // Add to network if not already there
        const existingTx = networkNode.network.getTransactionByHash(tx.hash);
        if (!existingTx) {
          networkNode.network.pendingTransactions.push(networkTx);
          
          // Update database status
          await pool.query(
            'UPDATE transactions SET status = $1, description = $2 WHERE hash = $3',
            ['network_synced', 'Synced to Access network', tx.hash]
          );
          
          syncedCount++;
        }
      } catch (txError) {
        // Silent - reduce console spam
      }
    }

    // Silent - reduce console spam
  } catch (error) {
    // Silent - reduce console spam
  }
}

// Start network sync interval
setInterval(syncWithNetwork, RESOURCE_OPTIMIZATION.NETWORK_SYNC_INTERVAL);

// Create HTTP server with proper port binding for deployment compatibility
const PORT = parseInt(process.env.PORT) || 3000;
const HOST = '0.0.0.0'; // Explicitly bind to all interfaces for deployment
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`); // Use URL object for parsing
  const pathname = parsedUrl.pathname;

  // Set comprehensive CORS and FedCM headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Language', 'ar,en,fr');
  
  // TWA verification headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length');
  
  // Simplified headers for Google Identity Services
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Date, ETag');
  
  // Additional security headers for authentication
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // � HEALTH CHECK - فحص صحة السيرفر (لا يُخزَّن في Cache)
  if (pathname === '/api/health') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      timestamp: Date.now(),
      server: 'Access Network' 
    }));
    return;
  }

  // �🌐 DYNAMIC NETWORK CONFIG API - يولّد الروابط ديناميكياً حسب الدومين
  if (pathname === '/api/network/config' || pathname === '/api/chainlist') {
    const baseUrl = req.headers.host ? `https://${req.headers.host}` : '';
    const dynamicConfig = {
      name: 'Access Network',
      chain: 'ACCESS',
      chainId: 22888,
      shortName: 'access',
      networkId: 22888,
      slip44: 22888,
      nativeCurrency: {
        name: 'Access Coin',
        symbol: 'ACCESS',
        decimals: 18
      },
      rpc: [baseUrl + '/rpc'],
      faucets: [],
      infoURL: baseUrl,
      explorers: [
        {
          name: 'Access Network Explorer',
          url: baseUrl + '/access-explorer.html',
          standard: 'EIP3091'
        }
      ],
      icon: 'https://gateway.pinata.cloud/ipfs/bafybeicc2meeaucf6s6zljq2xshulfcd7k3zlid3qwg2hrfbnlc2qexvyi'
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(dynamicConfig, null, 2));
    return;
  }

  // 🚀 RPC ENDPOINT - للمحافظ الخارجية (Trust Wallet, MetaMask, etc.)
  if (pathname === '/rpc' || pathname === '/rpc/') {
    try {
      const { getNetworkNode } = await import('./network-api.js');
      const networkNode = getNetworkNode();
      
      if (!networkNode) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Network node not initialized' },
          id: null
        }));
        return;
      }

      // إعداد headers خاصة بـ RPC
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '-1');
      res.setHeader('ETag', `"${Date.now()}-${Math.random().toString(36)}"`);
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Keep-Alive', 'timeout=120');

      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          try {
            const request = JSON.parse(body);
            const response = await networkNode.processRPCCall(request);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
          } catch (error) {
            console.error('RPC Error:', error);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32600, message: 'Invalid Request' },
              id: null
            }));
          }
        });
        return;
      } else if (req.method === 'GET') {
        // معلومات الشبكة الكاملة للـ GET requests - روابط ديناميكية
        try {
          const network = networkNode.network || networkNode.blockchain;
          const stats = networkNode.getStats ? networkNode.getStats() : {};
          
          // تحديد الرابط الديناميكي من الطلب
          const baseUrl = req.headers.host ? `https://${req.headers.host}` : '';
          
          // استخدام getNetworkInfo مع الرابط الديناميكي
          let networkInfo = {};
          if (network && typeof network.getNetworkInfo === 'function') {
            networkInfo = await network.getNetworkInfo(baseUrl);
          }
          
          // حساب العرض المتداول
          let circulatingSupply = 0;
          try {
            circulatingSupply = network.calculateCirculatingSupply ? await network.calculateCirculatingSupply() : 0;
          } catch (e) {
            circulatingSupply = 0;
          }

          // دمج كل المعلومات - نفس المنفذ 5000 تماماً
          const fullNetworkInfo = {
            // معلومات من getNetworkInfo
            ...networkInfo,
            
            // تحديث الروابط لتناسب /rpc
            rpcUrls: [req.headers.host ? `https://${req.headers.host}/rpc` : '/rpc'],
            blockExplorerUrls: [req.headers.host ? `https://${req.headers.host}/access-explorer.html` : '/access-explorer.html'],
            
            // إحصائيات إضافية
            totalTransactions: stats.totalTransactions || networkInfo.totalTransactions || 0,
            totalBlocks: stats.totalBlocks || 0,
            activeNodes: stats.activeNodes || 0,
            lastUpdate: stats.lastUpdate || Date.now(),
            rpcPort: stats.rpcPort || 'same as main',
            
            // حالة الشبكة
            isRunning: true,
            activeSubscriptions: stats.activeSubscriptions || 0,
            uptime: stats.uptime || 0,
            connectedWalletsCount: stats.connectedWalletsCount || 0,
            
            // تحديث العرض المتداول
            circulatingSupply: circulatingSupply || networkInfo.circulatingSupply || 0,
            
            // endpoint
            endpoint: req.headers.host ? `${req.headers.host}/rpc` : 'localhost:3000/rpc'
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(fullNetworkInfo));
        } catch (infoError) {
          console.error('Error getting full network info:', infoError);
          // Fallback للمعلومات الأساسية
          const basicInfo = {
            chainId: '0x5968',
            networkId: '22888',
            chainName: 'Access Network',
            status: 'active',
            error: infoError.message
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(basicInfo, null, 2));
        }
        return;
      }
    } catch (error) {
      console.error('RPC endpoint error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: null
      }));
      return;
    }
  }

  // Serve assetlinks.json for TWA verification
  if (pathname === '/.well-known/assetlinks.json' && req.method === 'GET') {
    try {
      const assetlinksPath = path.join(__dirname, '.well-known', 'assetlinks.json');
      const assetlinksContent = fs.readFileSync(assetlinksPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(assetlinksContent);
      return;
    } catch (error) {
      console.error('Error serving assetlinks.json:', error);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'assetlinks.json not found' }));
      return;
    }
  }

  // Handle Explorer API requests - delegated to handleExplorerAPI
  // This is now handled below by handleExplorerAPI which supports module=proxy

  // Try handling network API requests
  if (pathname.startsWith('/api/network/')) {
    const handled = await handleNetworkAPI(req, res, pathname, req.method);
    if (handled) {
      return;
    }
  }

  // Handle API key management for explorer users
  if (pathname.startsWith('/api/explorer/api-keys')) {
    try {
      let userId;
      let email;

      // DELETE API key
      if (pathname.match(/^\/api\/explorer\/api-keys\/\d+$/) && req.method === 'DELETE') {
        const body = await parseRequestBody(req);
        email = body.email;
        
        if (!email) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Email required' }));
          return;
        }

        const userResult = await pool.query(
          'SELECT id FROM explorer_users WHERE email = $1',
          [email]
        );

        if (userResult.rows.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'User not found' }));
          return;
        }

        userId = userResult.rows[0].id;
        const keyId = parseInt(pathname.split('/').pop());
        const { deleteApiKey } = await import('./api-key-manager.js');
        
        const result = await deleteApiKey(keyId, userId);

        res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      // For POST requests (list and create)
      const body = await parseRequestBody(req);
      email = body.email;
      
      if (!email) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Email required' }));
        return;
      }

      // Get explorer user
      const userResult = await pool.query(
        'SELECT id FROM explorer_users WHERE email = $1',
        [email]
      );

      if (userResult.rows.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'User not found' }));
        return;
      }

      userId = userResult.rows[0].id;

      // POST - GET all API keys (changed from GET to POST to send email)
      if (pathname === '/api/explorer/api-keys' && req.method === 'POST') {
        const { getUserApiKeys } = await import('./api-key-manager.js');
        const result = await getUserApiKeys(userId);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      // CREATE API key
      if (pathname === '/api/explorer/api-keys/create' && req.method === 'POST') {
        const { keyName } = body;
        const { createApiKey } = await import('./api-key-manager.js');
        
        // Free tier only: 50 requests/hour
        const result = await createApiKey(userId, keyName || 'API Key', 50, 'free');

        // Return 400 for user errors (like MAX_KEYS_REACHED), 500 for server errors
        const statusCode = result.success ? 200 : (result.errorCode === 'MAX_KEYS_REACHED' ? 400 : 500);
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

    } catch (error) {
      console.error('API key management error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Server error' }));
      return;
    }
  }

  // Try handling explorer API requests (BUT NOT /api/leaderboard)
  if ((pathname.startsWith('/api/explorer/') || (pathname.startsWith('/api') && req.url.includes('module='))) 
      && pathname !== '/api/leaderboard') {
    const handled = await handleExplorerAPI(req, res, pathname, req.method);
    if (handled) {
      return;
    }
  }

  // Try handling storage API requests
  if (pathname.startsWith('/api/storage/')) {
    const { handleStorageAPI } = await import('./storage-api.js');
    const handled = await handleStorageAPI(req, res, pathname, req.method);
    if (handled) {
      return;
    }
  }

  // Try handling the request with our simplified processing system first
  if (pathname.startsWith('/api/processing/countdown/')) {
    const handled = await handleSimplifiedProcessingAPI(req, res, pathname, req.method);
    if (handled) {
      return;
    }
  }

  
  // Handle /tx/ URLs from external wallets (redirect to transaction-details.html)
  if (pathname.match(/^\/tx\/[a-fA-F0-9]{64}$/)) {
    const txHash = pathname.split('/')[2];
    console.log(`🔗 External wallet transaction request: /tx/${txHash}`);
    
    // إعادة توجيه إلى صفحة تفاصيل المعاملة مع الـ hash
    const redirectUrl = `/RealisticHonorableDeskscan/transaction-details.html?hash=${txHash}`;
    res.writeHead(302, { 
      'Location': redirectUrl,
      'Cache-Control': 'no-cache'
    });
    res.end();
    return;
  }

  // Handle direct processing countdown system endpoints
  if (pathname === '/api/processing/start-countdown' && req.method === 'POST') {
    try {
      const { userId } = await parseRequestBody(req);
      const result = await startProcessingCountdown(userId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    } catch (error) {
      console.error('Error starting processing countdown:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
      return;
    }
  }

  if (pathname === '/api/processing/countdown-status' && req.method === 'GET') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const userId = url.searchParams.get('userId');
      const result = await getProcessingCountdownStatus(userId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    } catch (error) {
      console.error('Error getting processing countdown status:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
      return;
    }
  }

  if (pathname === '/api/processing/complete-countdown' && req.method === 'POST') {
    try {
      const { userId } = await parseRequestBody(req);
      const result = await completeProcessingCountdown(userId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    } catch (error) {
      console.error('Error completing processing countdown:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
      return;
    }
  }

  // API routes
  if (pathname.startsWith('/api/')) {

    // ========== DAILY MISSIONS ENDPOINTS ==========
    
    // GET /api/missions/reset-timer - Get user's PERSONAL reset timer (managed by server)
    // Each user has their own 24-hour cycle starting from first activity
    if (pathname === '/api/missions/reset-timer' && req.method === 'GET') {
      try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const decoded = await verifyToken(token);
        if (!decoded) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        const userId = decoded.userId;
        const nowMs = Date.now();
        const CYCLE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in ms
        
        // Get user's mission cycle start time
        const result = await pool.query(
          'SELECT mission_cycle_start FROM user_missions WHERE user_id = $1',
          [userId]
        );
        
        let cycleStart = result.rows[0]?.mission_cycle_start;
        let remainingMs = 0;
        let cycleActive = false;
        
        if (cycleStart) {
          cycleStart = parseInt(cycleStart);
          const cycleEnd = cycleStart + CYCLE_DURATION;
          
          if (nowMs < cycleEnd) {
            // Cycle still active
            remainingMs = cycleEnd - nowMs;
            cycleActive = true;
          } else {
            // Cycle expired - user can start new one
            cycleActive = false;
            remainingMs = 0;
          }
        }
        
        // Return server time to prevent client tampering
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          cycle_active: cycleActive,
          remaining_ms: remainingMs,
          remaining_seconds: Math.floor(remainingMs / 1000),
          server_time: nowMs,
          cycle_start: cycleStart || null,
          cycle_end: cycleStart ? cycleStart + CYCLE_DURATION : null
        }));
        return;
      } catch (error) {
        console.error('Error getting mission reset timer:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error' }));
        return;
      }
    }
    
    // GET /api/missions/status - Get user's missions status
    if (pathname === '/api/missions/status' && req.method === 'GET') {
      try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const decoded = await verifyToken(token);
        if (!decoded) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        const userId = decoded.userId;
        const nowMs = Date.now();
        const CYCLE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in ms
        
        // Get or create missions record using PostgreSQL
        let result = await pool.query('SELECT * FROM user_missions WHERE user_id = $1', [userId]);
        let missions = result.rows[0];

        if (!missions) {
          // Create new record
          await pool.query(
            `INSERT INTO user_missions (user_id, streak, last_claim_date, daily_claimed, completed_missions, bonus_claimed, mission_cycle_start)
             VALUES ($1, 0, NULL, false, '{}', false, NULL)`, [userId]
          );
          missions = { streak: 0, last_claim_date: null, daily_claimed: false, completed_missions: {}, bonus_claimed: false, mission_cycle_start: null };
        }

        // Check for PERSONAL cycle reset (not global midnight)
        const cycleStart = missions.mission_cycle_start ? parseInt(missions.mission_cycle_start) : null;
        let needsReset = false;
        let shouldResetStreak = false;
        
        if (cycleStart) {
          const cycleEnd = cycleStart + CYCLE_DURATION;
          if (nowMs >= cycleEnd) {
            // Personal cycle expired - reset daily missions
            needsReset = true;
            
            // ✅ FIX: إذا مر أكثر من 48 ساعة (يومين)، أعد تعيين الـ streak
            // لأن المستخدم فوّت يوماً كاملاً
            const twoDays = 2 * CYCLE_DURATION;
            if (nowMs >= cycleStart + twoDays) {
              shouldResetStreak = true;
            }
          }
        }
        
        if (needsReset) {
          // Reset daily tasks BUT KEEP permanent missions (social media)
          const permanentMissions = ['follow_twitter', 'join_telegram'];
          const currentCompleted = missions.completed_missions || {};
          const savedPermanent = {};
          
          // Preserve permanent missions that were completed
          permanentMissions.forEach(missionId => {
            if (currentCompleted[missionId]) {
              savedPermanent[missionId] = currentCompleted[missionId];
            }
          });
          
          // ✅ FIX: إعادة تعيين الـ streak إذا فات أكثر من يوم
          if (shouldResetStreak) {
            await pool.query(
              `UPDATE user_missions SET daily_claimed = false, completed_missions = $1, bonus_claimed = false, mission_cycle_start = NULL, streak = 0
               WHERE user_id = $2`, [JSON.stringify(savedPermanent), userId]
            );
            missions.streak = 0;
          } else {
            await pool.query(
              `UPDATE user_missions SET daily_claimed = false, completed_missions = $1, bonus_claimed = false, mission_cycle_start = NULL
               WHERE user_id = $2`, [JSON.stringify(savedPermanent), userId]
            );
          }
          
          missions.daily_claimed = false;
          missions.completed_missions = savedPermanent;
          missions.bonus_claimed = false;
          missions.mission_cycle_start = null;
        }

        // Calculate remaining time for this user's personal cycle
        let remainingMs = 0;
        let cycleActive = false;
        if (missions.mission_cycle_start) {
          const cs = parseInt(missions.mission_cycle_start);
          const ce = cs + CYCLE_DURATION;
          if (nowMs < ce) {
            remainingMs = ce - nowMs;
            cycleActive = true;
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          streak: missions.streak,
          lastClaimDate: missions.last_claim_date,
          dailyClaimed: missions.daily_claimed,
          completedMissions: missions.completed_missions || {},
          bonusClaimed: missions.bonus_claimed,
          // Personal cycle info
          cycleActive: cycleActive,
          cycleRemainingMs: remainingMs,
          cycleRemainingSeconds: Math.floor(remainingMs / 1000),
          cycleStart: missions.mission_cycle_start,
          serverTime: nowMs
        }));
        return;
      } catch (error) {
        console.error('Error getting missions status:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
        return;
      }
    }

    // POST /api/missions/claim-daily - Claim daily login reward
    if (pathname === '/api/missions/claim-daily' && req.method === 'POST') {
      try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const decoded = await verifyToken(token);
        if (!decoded) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        const userId = decoded.userId;
        
        // Get current missions
        let result = await pool.query('SELECT * FROM user_missions WHERE user_id = $1', [userId]);
        let missions = result.rows[0];

        if (!missions) {
          // ✅ إنشاء سجل تلقائي للمستخدم
          await pool.query(
            `INSERT INTO user_missions (user_id, streak, last_claim_date, daily_claimed, completed_missions, bonus_claimed)
             VALUES ($1, 0, NULL, false, '{}', false)`, [userId]
          );
          result = await pool.query('SELECT * FROM user_missions WHERE user_id = $1', [userId]);
          missions = result.rows[0];
        }

        if (missions.daily_claimed) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Already claimed today' }));
          return;
        }

        // Calculate streak and reward
        // ✅ FIX: استخدام الدورة الشخصية (24 ساعة) بدلاً من التاريخ
        let newStreak = missions.streak;
        const today = new Date();
        const nowMs = Date.now();
        const lastCycleStart = missions.mission_cycle_start ? parseInt(missions.mission_cycle_start) : null;
        const CYCLE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
        
        if (!lastCycleStart) {
          // ✅ FIX: إذا لا يوجد دورة سابقة، زد الـ streak بـ 1
          // streak = 0 → newStreak = 1 (اليوم الأول)
          // streak = 1 → newStreak = 2 (اليوم الثاني)
          newStreak = Math.min(missions.streak + 1, 7);
          if (newStreak === 0) newStreak = 1; // للأمان
        } else {
          // تحقق من الوقت منذ آخر دورة
          const timeSinceLastCycle = nowMs - lastCycleStart;
          
          if (timeSinceLastCycle < CYCLE_DURATION) {
            // لا يزال في نفس الدورة - هذا لا يجب أن يحدث لأن daily_claimed = false
            // لكن للأمان، حافظ على الـ streak
            newStreak = missions.streak;
          } else if (timeSinceLastCycle < CYCLE_DURATION * 2) {
            // في الدورة التالية (24-48 ساعة) - زيادة الـ streak
            newStreak = Math.min(missions.streak + 1, 7);
          } else {
            // فات أكثر من يومين - إعادة الـ streak إلى 1
            newStreak = 1;
          }
        }

        // Rewards based on streak day
        const streakRewards = { 1: 0.01, 2: 0.02, 3: 0.03, 4: 0.04, 5: 0.05, 6: 0.06, 7: 0.15 };
        const reward = streakRewards[newStreak] || 0.01;

        // Update user coins
        await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [reward, userId]);

        // ✅ FIX: دائماً ابدأ دورة جديدة عند claim-daily
        // لأن هذا هو بداية يوم جديد للمستخدم
        await pool.query(
          `UPDATE user_missions SET streak = $1, last_claim_date = $2, daily_claimed = true, mission_cycle_start = $3
           WHERE user_id = $4`, [newStreak, today.toISOString(), nowMs, userId]
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, streak: newStreak, reward, cycleStarted: true }));
        return;
      } catch (error) {
        console.error('Error claiming daily:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
        return;
      }
    }

    // POST /api/missions/verify-social - Verify social media task
    if (pathname === '/api/missions/verify-social' && req.method === 'POST') {
      try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const decoded = await verifyToken(token);
        if (!decoded) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        const userId = decoded.userId;
        const { missionId, verificationTime, socialUsername } = await parseRequestBody(req);

        // === SECURITY CHECK 1: Validate username format ===
        if (!socialUsername || typeof socialUsername !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Username is required' }));
          return;
        }

        const cleanUsername = socialUsername.trim().toLowerCase();
        
        // Must start with @ and be at least 3 characters
        if (!cleanUsername.startsWith('@') || cleanUsername.length < 3) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid username format. Must start with @' }));
          return;
        }

        // Only allow valid username characters (letters, numbers, underscores)
        const usernameWithoutAt = cleanUsername.substring(1);
        if (!/^[a-z0-9_]{2,30}$/.test(usernameWithoutAt)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid username. Only letters, numbers and underscores allowed' }));
          return;
        }

        // === SECURITY CHECK 2: Minimum time check (3 seconds) ===
        if (verificationTime < 3000) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'please_complete_task_first' }));
          return;
        }

        // === SECURITY CHECK 3: Platform-specific validation ===
        const platform = missionId === 'follow_twitter' ? 'twitter' : 'telegram';
        
        // For Telegram - verify username format is valid for Telegram
        if (platform === 'telegram') {
          // Telegram usernames must be 5-32 characters
          if (usernameWithoutAt.length < 5 || usernameWithoutAt.length > 32) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Telegram username must be 5-32 characters' }));
            return;
          }
          
          // Telegram usernames cannot start with a number
          if (/^[0-9]/.test(usernameWithoutAt)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Telegram username cannot start with a number' }));
            return;
          }
        }
        
        // For Twitter - just validate format (no external API check)
        if (platform === 'twitter') {
          // Twitter usernames must be 1-15 characters
          if (usernameWithoutAt.length < 1 || usernameWithoutAt.length > 15) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Twitter username must be 1-15 characters' }));
            return;
          }
        }

        // === SECURITY CHECK 4: Create table for tracking used usernames ===
        await pool.query(`
          CREATE TABLE IF NOT EXISTS social_usernames (
            id SERIAL PRIMARY KEY,
            platform VARCHAR(20) NOT NULL,
            username VARCHAR(50) NOT NULL,
            user_id INTEGER NOT NULL,
            mission_id VARCHAR(50) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(platform, username)
          )
        `);

        // === SECURITY CHECK 5: Check if username already used by another user ===
        const existingUsername = await pool.query(
          'SELECT user_id FROM social_usernames WHERE platform = $1 AND username = $2',
          [platform, cleanUsername]
        );

        if (existingUsername.rows.length > 0) {
          if (existingUsername.rows[0].user_id !== userId) {
            // This username was used by a DIFFERENT user
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: 'This username has already been used by another account!',
              code: 'USERNAME_ALREADY_USED'
            }));
            return;
          }
          // Same user trying to use same username - they already completed this
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Already completed' }));
          return;
        }

        let result = await pool.query('SELECT * FROM user_missions WHERE user_id = $1', [userId]);
        let missions = result.rows[0];

        if (!missions) {
          // ✅ إنشاء سجل تلقائي للمستخدم
          await pool.query(
            `INSERT INTO user_missions (user_id, streak, last_claim_date, daily_claimed, completed_missions, bonus_claimed)
             VALUES ($1, 0, NULL, false, '{}', false)`, [userId]
          );
          result = await pool.query('SELECT * FROM user_missions WHERE user_id = $1', [userId]);
          missions = result.rows[0];
        }

        const completedMissions = missions.completed_missions || {};
        
        if (completedMissions[missionId]) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Already completed' }));
          return;
        }

        // === SAVE USERNAME TO PREVENT REUSE ===
        try {
          await pool.query(
            'INSERT INTO social_usernames (platform, username, user_id, mission_id) VALUES ($1, $2, $3, $4)',
            [platform, cleanUsername, userId, missionId]
          );
        } catch (insertError) {
          // If insert fails due to duplicate, username was just used
          if (insertError.code === '23505') { // Unique violation
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: 'This username has already been used by another account!',
              code: 'USERNAME_ALREADY_USED'
            }));
            return;
          }
          throw insertError;
        }

        // Mark as completed
        completedMissions[missionId] = true;
        const reward = 0.02;

        // Update user coins
        await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [reward, userId]);

        // START PERSONAL CYCLE: If this is user's first mission, start their 24h cycle
        const cycleCheck = await pool.query(
          'SELECT mission_cycle_start FROM user_missions WHERE user_id = $1',
          [userId]
        );
        const existingCycle = cycleCheck.rows[0]?.mission_cycle_start;
        const nowMs = Date.now();
        
        if (!existingCycle || (nowMs - existingCycle) > 24 * 60 * 60 * 1000) {
          // No cycle or cycle expired - start new personal cycle
          await pool.query(
            'UPDATE user_missions SET completed_missions = $1, mission_cycle_start = $2 WHERE user_id = $3',
            [JSON.stringify(completedMissions), nowMs, userId]
          );
        } else {
          // Cycle active - just update missions
          await pool.query('UPDATE user_missions SET completed_missions = $1 WHERE user_id = $2', 
            [JSON.stringify(completedMissions), userId]
          );
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, reward }));
        return;
      } catch (error) {
        // ✅ SILENT: Hide timeout errors for social verification
        if (error.message && (error.message.includes('timeout') || error.message.includes('canceling'))) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Please try again', code: 'TIMEOUT' }));
          return;
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Verification failed' }));
        return;
      }
    }

    // POST /api/missions/check - Check activity-based mission
    if (pathname === '/api/missions/check' && req.method === 'POST') {
      const client = await pool.connect();
      try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const decoded = await verifyToken(token);
        if (!decoded) {
          client.release();
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        const userId = decoded.userId;
        const { missionId } = await parseRequestBody(req);
        
        let result = await client.query('SELECT * FROM user_missions WHERE user_id = $1', [userId]);
        let missions = result.rows[0];

        if (!missions) {
          // ✅ إنشاء سجل تلقائي للمستخدم
          await client.query(
            `INSERT INTO user_missions (user_id, streak, last_claim_date, daily_claimed, completed_missions, bonus_claimed)
             VALUES ($1, 0, NULL, false, '{}', false)`, [userId]
          );
          result = await client.query('SELECT * FROM user_missions WHERE user_id = $1', [userId]);
          missions = result.rows[0];
        }

        const completedMissions = missions.completed_missions || {};
        
        if (completedMissions[missionId]) {
          client.release();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ completed: true, message: 'Already completed' }));
          return;
        }

        let taskCompleted = false;
        let reward = 0.02;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (missionId === 'complete_activity') {
          // Check if user has COMPLETED a processing session today
          // OR has an ACTIVE session that started today
          const activityResult = await client.query(
            `SELECT processing_active, processing_start_time_seconds, 
                    COALESCE(completed_processing_reward, 0) as completed_processing_reward, 
                    COALESCE(processing_accumulated, 0) as processing_accumulated,
                    COALESCE(accumulatedReward, 0) as accumulatedReward, 
                    processing_completed_time
             FROM users WHERE id = $1`,
            [userId]
          );
          if (activityResult.rows[0]) {
            const user = activityResult.rows[0];
            const nowSec = Math.floor(Date.now() / 1000);
            const todayStart = Math.floor(today.getTime() / 1000);
            
            // Option 1: Has active session that started today
            const startTime = parseInt(user.processing_start_time_seconds) || 0;
            const isActive = user.processing_active === 1;
            const startedToday = startTime >= todayStart;
            
            // Option 2: Completed a session today (has accumulated reward)
            const hasCompletedReward = parseFloat(user.completed_processing_reward) > 0 ||
                                       parseFloat(user.processing_accumulated) > 0.001 ||
                                       parseFloat(user.accumulatedReward) > 0.001;
            
            // Option 3: Check processing history for today
            const historyCheck = await client.query(
              `SELECT id FROM processing_history 
               WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
               LIMIT 1`,
              [userId]
            );
            const hasHistoryToday = historyCheck.rows.length > 0;
            
            taskCompleted = (isActive && startedToday) || hasCompletedReward || hasHistoryToday;
          }
        } else if (missionId === 'send_transaction') {
          // Check if user sent a transaction today
          // Get user's wallet address first
          const userWalletResult = await client.query(
            'SELECT wallet_address FROM users WHERE id = $1',
            [userId]
          );
          const userAddress = userWalletResult.rows[0]?.wallet_address;
          
          // Search by both sender (userId) OR sender_address (wallet address)
          const txResult = await client.query(
            `SELECT id FROM transactions 
             WHERE (sender = $1 OR sender_address = $2 OR LOWER(sender_address) = LOWER($2))
             AND timestamp >= $3
             LIMIT 1`,
            [userId, userAddress, today.getTime()]
          );
          taskCompleted = txResult.rows.length > 0;
        } else if (missionId === 'invite_friend') {
          // Check if user got a new referral TODAY (daily mission)
          // referrals table uses 'date' column (bigint timestamp), not 'created_at'
          const todayTimestamp = today.getTime();
          const referralResult = await client.query(
            `SELECT id FROM referrals 
             WHERE referrer_id = $1 
             AND date >= $2
             LIMIT 1`,
            [userId, todayTimestamp]
          );
          
          if (referralResult.rows.length > 0) {
            taskCompleted = true;
          } else {
            // Fallback: check users table for users referred today
            // users table has 'created_at' column
            const userResult = await client.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
            if (userResult.rows[0] && userResult.rows[0].referral_code) {
              const referredUsers = await client.query(
                `SELECT id FROM users 
                 WHERE referred_by = $1 
                 AND created_at >= $2
                 LIMIT 1`,
                [userResult.rows[0].referral_code, today]
              );
              taskCompleted = referredUsers.rows.length > 0;
            }
          }
        }

        if (taskCompleted) {
          completedMissions[missionId] = true;

          // Update user coins
          await client.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [reward, userId]);

          // START PERSONAL CYCLE: If this is user's first mission, start their 24h cycle
          const cycleCheck = await client.query(
            'SELECT mission_cycle_start FROM user_missions WHERE user_id = $1',
            [userId]
          );
          const existingCycle = cycleCheck.rows[0]?.mission_cycle_start;
          const nowMs = Date.now();
          
          if (!existingCycle || (nowMs - existingCycle) > 24 * 60 * 60 * 1000) {
            // No cycle or cycle expired - start new personal cycle
            await client.query(
              'UPDATE user_missions SET completed_missions = $1, mission_cycle_start = $2 WHERE user_id = $3',
              [JSON.stringify(completedMissions), nowMs, userId]
            );
          } else {
            // Cycle active - just update missions
            await client.query('UPDATE user_missions SET completed_missions = $1 WHERE user_id = $2', 
              [JSON.stringify(completedMissions), userId]
            );
          }

          client.release();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ completed: true, reward }));
        } else {
          client.release();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ completed: false, message: 'Task not completed yet' }));
        }
        return;
      } catch (error) {
        client.release();
        console.error('Error checking mission:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
        return;
      }
    }

    // POST /api/missions/complete-visit - Complete visit mission
    if (pathname === '/api/missions/complete-visit' && req.method === 'POST') {
      const client = await pool.connect();
      try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const decoded = await verifyToken(token);
        if (!decoded) {
          client.release();
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        const userId = decoded.userId;
        const { missionId } = await parseRequestBody(req);

        let result = await client.query('SELECT * FROM user_missions WHERE user_id = $1', [userId]);
        let missions = result.rows[0];

        if (!missions) {
          // ✅ إنشاء سجل تلقائي للمستخدم
          await client.query(
            `INSERT INTO user_missions (user_id, streak, last_claim_date, daily_claimed, completed_missions, bonus_claimed)
             VALUES ($1, 0, NULL, false, '{}', false)`, [userId]
          );
          result = await client.query('SELECT * FROM user_missions WHERE user_id = $1', [userId]);
          missions = result.rows[0];
        }

        const completedMissions = missions.completed_missions || {};
        
        if (completedMissions[missionId]) {
          client.release();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, alreadyCompleted: true }));
          return;
        }

        const reward = 0.01;
        completedMissions[missionId] = true;

        // Update user coins
        await client.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [reward, userId]);

        // START PERSONAL CYCLE: If this is user's first mission, start their 24h cycle
        const cycleCheck = await client.query(
          'SELECT mission_cycle_start FROM user_missions WHERE user_id = $1',
          [userId]
        );
        const existingCycle = cycleCheck.rows[0]?.mission_cycle_start;
        const nowMs = Date.now();
        
        if (!existingCycle || (nowMs - existingCycle) > 24 * 60 * 60 * 1000) {
          // No cycle or cycle expired - start new personal cycle
          await client.query(
            'UPDATE user_missions SET completed_missions = $1, mission_cycle_start = $2 WHERE user_id = $3',
            [JSON.stringify(completedMissions), nowMs, userId]
          );
        } else {
          // Cycle active - just update missions
          await client.query('UPDATE user_missions SET completed_missions = $1 WHERE user_id = $2', 
            [JSON.stringify(completedMissions), userId]
          );
        }

        client.release();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, reward }));
        return;
      } catch (error) {
        client.release();
        console.error('Error completing visit:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
        return;
      }
    }

    // POST /api/missions/claim-bonus - Claim daily bonus
    if (pathname === '/api/missions/claim-bonus' && req.method === 'POST') {
      try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const decoded = await verifyToken(token);
        if (!decoded) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        const userId = decoded.userId;

        let result = await pool.query('SELECT * FROM user_missions WHERE user_id = $1', [userId]);
        let missions = result.rows[0];

        if (!missions) {
          // ✅ إنشاء سجل تلقائي للمستخدم
          await pool.query(
            `INSERT INTO user_missions (user_id, streak, last_claim_date, daily_claimed, completed_missions, bonus_claimed)
             VALUES ($1, 0, NULL, false, '{}', false)`, [userId]
          );
          result = await pool.query('SELECT * FROM user_missions WHERE user_id = $1', [userId]);
          missions = result.rows[0];
        }

        if (missions.bonus_claimed) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bonus already claimed' }));
          return;
        }

        // Check if all tasks completed
        const completedMissions = missions.completed_missions || {};
        const completedCount = Object.keys(completedMissions).filter(k => completedMissions[k]).length;
        
        if (completedCount < 7 || !missions.daily_claimed) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Complete all tasks first' }));
          return;
        }

        const bonusReward = 0.05;

        // Update user coins
        await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [bonusReward, userId]);

        // Update missions
        await pool.query('UPDATE user_missions SET bonus_claimed = true WHERE user_id = $1', [userId]);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, reward: bonusReward }));
        return;
      } catch (error) {
        console.error('Error claiming bonus:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
        return;
      }
    }

    // ========== WEB PUSH NOTIFICATION ENDPOINTS ==========
    
    // GET /api/push/public-key - Returns VAPID public key for client subscription
    if (pathname === '/api/push/public-key' && req.method === 'GET') {
      try {
        const publicKey = process.env.VAPID_PUBLIC_KEY;
        if (!publicKey) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'VAPID keys not configured' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, publicKey }));
        return;
      } catch (error) {
        console.error('Error getting VAPID public key:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // POST /api/push/subscribe - Save push subscription to database
    if (pathname === '/api/push/subscribe' && req.method === 'POST') {
      try {
        console.log('🔔 [PUSH] Received subscription request');
        const { userId, subscription } = await parseRequestBody(req);
        console.log('🔔 [PUSH] userId:', userId, 'endpoint:', subscription?.endpoint?.substring(0, 50));
        
        if (!userId || !subscription || !subscription.endpoint) {
          console.log('🔔 [PUSH] ERROR: Missing userId or subscription');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'userId and valid subscription required' }));
          return;
        }

        const userAgent = req.headers['user-agent'] || '';
        const p256dh = subscription.keys?.p256dh || '';
        const auth = subscription.keys?.auth || '';

        // Save subscription to database (upsert on endpoint)
        await pool.query(`
          INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (endpoint) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            user_agent = EXCLUDED.user_agent,
            revoked_at = NULL
        `, [userId, subscription.endpoint, p256dh, auth, userAgent]);

        console.log('🔔 [PUSH] ✅ Subscription saved for userId:', userId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Push subscription saved' }));
        return;
      } catch (error) {
        console.error('Error saving push subscription:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // DELETE /api/push/unsubscribe - Remove push subscription
    if (pathname === '/api/push/unsubscribe' && req.method === 'DELETE') {
      try {
        const { endpoint } = await parseRequestBody(req);
        
        if (!endpoint) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'endpoint required' }));
          return;
        }

        // Mark subscription as revoked instead of deleting
        await pool.query(`
          UPDATE push_subscriptions SET revoked_at = NOW() WHERE endpoint = $1
        `, [endpoint]);

        console.log('Push subscription revoked');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Push subscription removed' }));
        return;
      } catch (error) {
        console.error('Error removing push subscription:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // POST /api/push/renew-subscription - Auto-renew expired subscription (Facebook/Instagram style)
    if (pathname === '/api/push/renew-subscription' && req.method === 'POST') {
      try {
        const { oldEndpoint, newSubscription } = await parseRequestBody(req);
        
        if (!newSubscription || !newSubscription.endpoint) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'newSubscription required' }));
          return;
        }

        let userId = null;
        
        // Find user by old endpoint
        if (oldEndpoint) {
          const oldSubResult = await pool.query(
            'SELECT user_id FROM push_subscriptions WHERE endpoint = $1',
            [oldEndpoint]
          );
          if (oldSubResult.rows.length > 0) {
            userId = oldSubResult.rows[0].user_id;
            // Delete old subscription
            await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [oldEndpoint]);
            // Silent - reduce console spam
          }
        }

        if (userId) {
          // Save new subscription
          const userAgent = req.headers['user-agent'] || '';
          const p256dh = newSubscription.keys?.p256dh || '';
          const auth = newSubscription.keys?.auth || '';

          await pool.query(`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (endpoint) DO UPDATE SET
              user_id = EXCLUDED.user_id,
              p256dh = EXCLUDED.p256dh,
              auth = EXCLUDED.auth,
              user_agent = EXCLUDED.user_agent,
              revoked_at = NULL,
              updated_at = NOW()
          `, [userId, newSubscription.endpoint, p256dh, auth, userAgent]);

          // Silent - reduce console spam
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Subscription renewed', userId }));
        } else {
          // No old subscription found - client will handle saving
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'No old subscription found', needsClientSave: true }));
        }
        return;
      } catch (error) {
        console.error('Error renewing push subscription:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // ========== ACTIVITY AD CONFIGURATION ENDPOINT (مستقل عن Boost) ==========
    
    // GET /api/ad-config - إرسال معرف الإعلان للواجهة الأمامية
    if (pathname === '/api/ad-config' && req.method === 'GET') {
      try {
        // تحميل Ad Unit ID من .env
        const adUnitId = process.env.GOOGLE_AD_UNIT_ID || '/22639388115/rewarded_web_example';
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          adUnitId: adUnitId,
          message: 'Ad configuration loaded successfully'
        }));
        return;
      } catch (error) {
        console.error('Error loading ad config:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Failed to load ad configuration',
          adUnitId: '/22639388115/rewarded_web_example' // fallback
        }));
        return;
      }
    }

    // ========== AD BOOST SYSTEM ENDPOINTS ==========
    
    // GET /api/ad-boost/check - Check if user is eligible to watch an ad
    if (pathname === '/api/ad-boost/check' && req.method === 'GET') {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const userId = url.searchParams.get('userId');

        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'userId parameter required' }));
          return;
        }

        const { checkAdBoostEligibility } = await import('./db.js');
        const eligibility = await checkAdBoostEligibility(parseInt(userId));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...eligibility }));
        return;
      } catch (error) {
        console.error('Error checking ad boost eligibility:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // POST /api/ad-boost/grant - Grant boost after ad completion
    if (pathname === '/api/ad-boost/grant' && req.method === 'POST') {
      try {
        const { userId, transactionId, adCompleted } = await parseRequestBody(req);

        if (!userId || !transactionId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'userId and transactionId required' }));
          return;
        }

        // STRICT: Verify ad was actually completed
        if (adCompleted !== true) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Ad must be completed fully before boost can be granted' 
          }));
          return;
        }

        // Get IP and user agent for fraud detection
        const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];

        const { grantAdBoost } = await import('./db.js');
        const result = await grantAdBoost(parseInt(userId), transactionId, ipAddress, userAgent);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      } catch (error) {
        console.error('Error granting ad boost:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // GET /api/ad-boost/status - Get current ad boost status
    if (pathname === '/api/ad-boost/status' && req.method === 'GET') {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const userId = url.searchParams.get('userId');

        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'userId parameter required' }));
          return;
        }

        const { getAdBoostStatus } = await import('./db.js');
        const status = await getAdBoostStatus(parseInt(userId));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...status }));
        return;
      } catch (error) {
        console.error('Error getting ad boost status:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // ========== END AD BOOST ENDPOINTS ==========

    // GET /api/user/wallet/:address - Get user by wallet address (including external addresses) with unified address handling
    if (pathname.startsWith('/api/user/wallet/') && req.method === 'GET') {
      try {
        const walletAddress = decodeURIComponent(pathname.replace('/api/user/wallet/', '')).toLowerCase();
        // Silent - reduce console spam

        // First check if the wallet address exists in local database using unified address
        const result = await pool.query(
          'SELECT id, email, name, avatar, coins, referral_code FROM users WHERE LOWER(wallet_address) = $1',
          [walletAddress]
        );

        if (result.rows.length > 0) {
          // Return local user data
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            user: result.rows[0],
            wallet_found: true,
            wallet_type: 'local'
          }));
          return;
        }

        // If not found locally, check if it's an external wallet using unified address
        const externalWalletCheck = await pool.query(
          'SELECT address, user_agent, chain_id, first_seen, last_activity FROM external_wallets WHERE LOWER(address) = $1',
          [walletAddress]
        );

        if (externalWalletCheck.rows.length > 0) {
          const externalWallet = externalWalletCheck.rows[0];
          
          // Try to get balance from network
          let balance = 0;
          try {
            const { getNetworkNode } = await import('./network-api.js');
            const networkNode = getNetworkNode();
            if (networkNode && networkNode.network) {
              balance = networkNode.network.getBalance(walletAddress);
            }
          } catch (networkError) {
            console.warn('Could not get network balance:', networkError.message);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            user: {
              wallet_address: externalWallet.address,
              coins: balance,
              user_agent: externalWallet.user_agent,
              chain_id: externalWallet.chain_id,
              first_seen: externalWallet.first_seen,
              last_activity: externalWallet.last_activity
            },
            wallet_found: true,
            wallet_type: 'external'
          }));
          return;
        }

        // If wallet not found anywhere
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Wallet address not found',
          wallet_found: false 
        }));
        return;
      } catch (error) {
        console.error('Error finding user by wallet address:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Server error' }));
        return;
      }
    }

    // POST /api/user/update-wallet - Update user wallet address and private key
    if (pathname === '/api/user/update-wallet' && req.method === 'POST') {
      try {
        const { userId, walletAddress, privateKey } = await parseRequestBody(req);

        if (!userId || !walletAddress) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing required parameters' }));
          return;
        }

        // Check if user exists
        const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);

        if (userCheck.rows.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'User not found' }));
          return;
        }

        // Ensure the wallet columns exist
        try {
          await pool.query(`
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'users' AND column_name = 'wallet_address'
              ) THEN
                ALTER TABLE users ADD COLUMN wallet_address TEXT;
              END IF;

              IF NOT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'users' AND column_name = 'wallet_private_key'
              ) THEN
                ALTER TABLE users ADD COLUMN wallet_private_key TEXT;
              END IF;

              IF NOT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'users' AND column_name = 'wallet_created_at'
              ) THEN
                ALTER TABLE users ADD COLUMN wallet_created_at BIGINT;
              END IF;
            END$$;
          `);

          smartLogger.log('wallet_init', 'Wallet columns ensured in users table');
        } catch (err) {
          console.error('Error checking/adding wallet columns:', err);
          // Continue anyway - we'll try the update
        }

        const currentTime = Date.now();

        // Update user's wallet information with private key
        await pool.query(
          'UPDATE users SET wallet_address = $1, wallet_private_key = $2, wallet_created_at = $3 WHERE id = $4',
          [walletAddress, privateKey, currentTime, userId]
        );

        // ✅ Removed verbose logging for performance

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Wallet updated successfully',
          walletAddress: walletAddress,
          updatedAt: currentTime
        }));
        return;
      } catch (error) {
        console.error('Error updating wallet:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // GET /api/user/wallet-key/:userId - Get user wallet private key
    if (pathname.startsWith('/api/user/wallet-key/') && req.method === 'GET') {
      try {
        const userId = pathname.replace('/api/user/wallet-key/', '');
        // Silent - reduce console spam

        const result = await pool.query(
          'SELECT wallet_address, wallet_private_key, wallet_created_at FROM users WHERE id = $1',
          [userId]
        );

        if (result.rows.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'User not found' }));
          return;
        }

        const walletData = result.rows[0];

        // If no wallet data is stored yet
        if (!walletData.wallet_address || !walletData.wallet_private_key) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'No wallet data found for this user',
            shouldCreateNew: true
          }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          walletAddress: walletData.wallet_address,
          privateKey: walletData.wallet_private_key,
          createdAt: walletData.wallet_created_at
        }));
        return;
      } catch (error) {
        console.error('Error retrieving wallet key:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }
    // POST /api/wallet/auto-create/:userId - Auto-create wallet for existing users
    if (pathname.startsWith('/api/wallet/auto-create/') && req.method === 'POST') {
      try {
        const userId = pathname.replace('/api/wallet/auto-create/', '');
        const body = await parseRequestBody(req);
        const email = body.email;

        // Silent - reduce console spam

        // Import wallet manager
        const { generateWalletForNewUser } = await import('./wallet-manager.js');
        
        // Generate wallet
        const wallet = await generateWalletForNewUser(parseInt(userId), email);
        
        if (wallet && wallet.wallet_address) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            wallet_address: wallet.wallet_address,
            message: 'Wallet created successfully'
          }));
          // Silent - reduce console spam
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Could not create wallet'
          }));
        }
        return;
      } catch (error) {
        console.error('Error auto-creating wallet:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // GET /api/user/:email - Get user by email
    if (pathname.startsWith('/api/user/') && req.method === 'GET') {
      try {
        const email = decodeURIComponent(pathname.replace('/api/user/', ''));

        const user = await getUser(email);
        if (!user) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'User not found', success: false }));
          return;
        }

        // التأكد من وجود تاريخ إنشاء الحساب
        if (!user.account_created_date && user.id) {
          try {
            // إضافة تاريخ إنشاء الحساب للحسابات القديمة
            const currentTime = Date.now();
            await pool.query(
              'UPDATE users SET account_created_date = $1 WHERE id = $2',
              [currentTime, user.id]
            );
            user.account_created_date = currentTime;
            const formattedDate = new Date(currentTime).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
          } catch (updateError) {
            console.error('Error adding creation date to existing user:', updateError);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ user: user, success: true }));
        return;
      } catch (error) {
        console.error('Database error in /api/user/:email:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Database error', success: false }));
        return;
      }
    }

    // GET /api/referral/:email - Get referral code by email
    if (pathname.startsWith('/api/referral/') && req.method === 'GET') {
      try {
        const email = decodeURIComponent(pathname.replace('/api/referral/', ''));
        const user = await getUser(email);
        if (user) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ referralCode: user.referral_code, success: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'User not found', success: false }));
        }
      } catch (error) {
        console.error('Database error in /api/referral/:email:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Database error', success: false }));
      }
      return;
    }


    // 🔒 ACCOUNT CREATION DATE IS IMMUTABLE AFTER FIRST SET
    // This date is set ONLY during account creation and NEVER updated
    // No endpoint exists or should exist to modify creation dates of existing accounts
    
    // POST /api/user/update-creation-date - REMOVED INTENTIONALLY
    // Account creation dates are immutable for data integrity
    if (pathname === '/api/user/update-creation-date' && req.method === 'POST') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false, 
        error: 'Account creation date is immutable and cannot be modified after account creation',
        reason: 'Data integrity protection - creation dates are permanent'
      }));
      return;
    }

    // POST /api/account/delete - Delete user account permanently
    if (pathname === '/api/account/delete' && req.method === 'POST') {
      try {
        const { email, userId, reason, feedback } = await parseRequestBody(req);

        if (!email || !userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing required parameters' }));
          return;
        }

        // Get user data before deletion (for logging)
        const userData = await safeQuery('SELECT * FROM users WHERE id = $1', [userId]);

        if (userData.rows.length > 0) {
          // 🔥 مسح جميع الـ caches قبل الحذف من قاعدة البيانات
          try {
            // مسح من ultraCache
            if (ultraCache && ultraCache.userCache) {
              ultraCache.userCache.delete(email);
              ultraCache.userCache.delete(email.toLowerCase());
            }
            // مسح من accumulated API cache
            if (accumulatedApiCache) {
              accumulatedApiCache.delete(userId);
              accumulatedApiCache.delete(String(userId));
            }
            // مسح من activeUsers
            if (activeUsers) {
              activeUsers.delete(userId);
              activeUsers.delete(String(userId));
            }
            // مسح من userSessions
            if (userSessions) {
              userSessions.delete(userId);
              userSessions.delete(String(userId));
              userSessions.delete(email);
              userSessions.delete(email.toLowerCase());
            }
            // مسح من userStatusCache
            if (typeof userStatusCache !== 'undefined' && userStatusCache) {
              // مسح أي مفتاح يحتوي على userId
              for (const key of userStatusCache.keys()) {
                if (key.startsWith(userId + '_') || key.startsWith(String(userId) + '_')) {
                  userStatusCache.delete(key);
                }
              }
            }
            // مسح من serverAccumulatedThrottle
            if (serverAccumulatedThrottle) {
              serverAccumulatedThrottle.delete(userId);
              serverAccumulatedThrottle.delete(String(userId));
            }
            console.log(`🗑️ All caches cleared for user: ${email} (ID: ${userId})`);
          } catch (cacheError) {
            console.log('Cache clear warning:', cacheError.message);
          }

          // Delete from all tables (without transaction to avoid timeout)
          try {
            await safeQuery('DELETE FROM processing_history WHERE user_id = $1', [userId]);
          } catch (e) { /* table might not exist */ }
          
          try {
            await safeQuery('DELETE FROM transactions WHERE sender = $1 OR recipient = $1', [userId]);
          } catch (e) { /* table might not exist */ }
          
          try {
            await safeQuery('DELETE FROM referrals WHERE referrer_id = $1 OR referee_id = $1', [userId]);
          } catch (e) { /* table might not exist */ }
          
          // Delete user last
          await safeQuery('DELETE FROM users WHERE id = $1', [userId]);

          console.log(`✅ Account deleted permanently for user: ${email} (ID: ${userId}), Reason: ${reason}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: 'Account deleted successfully' 
        }));
        return;

      } catch (error) {
        console.error('Error deleting account:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // POST /api/auth/signin - User sign in
    if (pathname === '/api/auth/signin' && req.method === 'POST') {
      try {
        const { email, password } = await parseRequestBody(req);
        
        if (!email || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Email and password are required' }));
          return;
        }

        // Get user from database
        const userResult = await pool.query(
          'SELECT id, email, name, password_hash FROM users WHERE email = $1',
          [email.toLowerCase()]
        );

        if (userResult.rows.length === 0) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Invalid email or password' }));
          return;
        }

        const user = userResult.rows[0];
        
        // For now, simple password check (in production, use bcrypt)
        if (!user.password_hash) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Please use Google sign in or contact support' }));
          return;
        }

        // Simple password verification (replace with bcrypt in production)
        const crypto = await import('crypto');
        const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
        
        if (user.password_hash !== hashedPassword) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Invalid email or password' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: 'Sign in successful',
          user: {
            id: user.id,
            email: user.email,
            name: user.name
          }
        }));
        return;
      } catch (error) {
        console.error('Sign in error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Server error' }));
        return;
      }
    }

    // POST /api/auth/signup - User sign up  
    if (pathname === '/api/auth/signup' && req.method === 'POST') {
      try {
        const { name, email, password } = await parseRequestBody(req);
        
        if (!name || !email || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Name, email and password are required' }));
          return;
        }

        // Validate password requirements
        if (password.length < 8) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Password must be at least 8 characters long' }));
          return;
        }

        if (!/[A-Z]/.test(password)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Password must contain at least one uppercase letter' }));
          return;
        }

        if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Password must contain at least one special character' }));
          return;
        }

        // Check if user already exists
        const existingUser = await pool.query(
          'SELECT id FROM users WHERE email = $1',
          [email.toLowerCase()]
        );

        if (existingUser.rows.length > 0) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Account with this email already exists' }));
          return;
        }

        // Hash password (simple hash for demo - use bcrypt in production)
        const crypto = await import('crypto');
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

        // Generate referral code
        const referralCode = generateReferralCode();

        // Add password_hash column if it doesn't exist
        try {
          await pool.query(`
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'users' AND column_name = 'password_hash'
              ) THEN
                ALTER TABLE users ADD COLUMN password_hash TEXT;
              END IF;
            END$$;
          `);
        } catch (columnError) {
          console.error('Error adding password_hash column:', columnError);
        }

        // Create user account
        const result = await pool.query(
          `INSERT INTO users (email, name, password_hash, referral_code, coins, privacy_accepted, privacy_accepted_date, account_created_date)
           VALUES ($1, $2, $3, $4, 0, true, $5, $5)
           RETURNING id, email, name`,
          [email.toLowerCase(), name, passwordHash, referralCode, Date.now()]
        );

        const newUser = result.rows[0];

        // ✅ AUTO-CREATE WALLET for new user
        try {
          const { generateWalletForNewUser } = await import('./wallet-manager.js');
          await generateWalletForNewUser(newUser.id, newUser.email);
          // ✅ Removed verbose logging for performance
        } catch (walletError) {
          console.error('Warning: Could not auto-create wallet:', walletError);
          // Don't fail signup if wallet creation fails
        }

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: 'Account created successfully',
          user: {
            id: newUser.id,
            email: newUser.email,
            name: newUser.name
          }
        }));
        return;
      } catch (error) {
        console.error('Sign up error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Server error' }));
        return;
      }
    }

    // POST /api/users - Create or update user
    if (pathname === '/api/users' && req.method === 'POST') {
      try {
        const userData = await parseRequestBody(req);

        // ✅ SIMPLE CHECK: موجود في DB = موجود، غير موجود = جديد
        const existingUser = await pool.query(
          'SELECT * FROM users WHERE email = $1',
          [userData.email]
        );

        // ✅ EXISTING USER: موجود بالفعل - إرجاع البيانات مباشرة (رمز الإحالة من DB)
        if (existingUser.rows.length > 0) {
          const existingUserData = existingUser.rows[0];
          // ✅ Removed verbose logging for performance
          
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ user: existingUserData, success: true }));
          return;
        }

        // ✅ NEW USER: المستخدم غير موجود - إنشاء حساب جديد مع رمز إحالة جديد
        // ✅ Removed verbose logging for performance
        
        // 🔑 إنشاء رمز إحالة جديد للمستخدم الجديد فقط (السيرفر المسؤول الوحيد عن الرمز)
        const newReferralCode = generateReferralCode();

        // Initially set coins to 0. Will add bonus if referral code is valid
        const initialCoins = 0;
        userData.coins = initialCoins;
        userData.referral_code = newReferralCode;

        // Set creation date for new accounts ONLY - use actual current date/time
        const accountCreatedDate = Date.now(); // Current timestamp in milliseconds
        userData.account_created_date = accountCreatedDate;
        
        // التأكد من وجود العمود account_created_date
        try {
          await pool.query(`
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'users' AND column_name = 'account_created_date'
              ) THEN
                ALTER TABLE users ADD COLUMN account_created_date BIGINT;
              END IF;
            END$$;
          `);
        } catch (columnError) {
          console.error('Error ensuring account_created_date column:', columnError);
        }

        // Use transaction to prevent race conditions
        await pool.query('BEGIN');
        
        try {
          // Double-check if user exists within transaction
          const doubleCheck = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [userData.email]
          );
          
          if (doubleCheck.rows.length > 0) {
            await pool.query('ROLLBACK');
            console.log(`User ${userData.email} was created by another request, returning existing user`);
            
            const existingUserData = await pool.query(
              'SELECT * FROM users WHERE email = $1',
              [userData.email]
            );
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ user: existingUserData.rows[0], success: true }));
            return;
          }
          
          // Use name directly - already UTF-8 encoded from JWT
          const safeName = userData.name || userData.email.split('@')[0];
          
          const result = await pool.query(
            `INSERT INTO users (email, name, avatar, referral_code, coins, privacy_accepted, privacy_accepted_date, account_created_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [userData.email, safeName, userData.avatar, newReferralCode, initialCoins, userData.privacyAccepted || false, userData.privacyAccepted ? Date.now() : null, accountCreatedDate]
          );
          
          await pool.query('COMMIT');
          
          const savedUser = result.rows[0];

        // ✅ AUTO-CREATE WALLET for new user (Google OAuth)
        try {
          const { generateWalletForNewUser } = await import('./wallet-manager.js');
          await generateWalletForNewUser(savedUser.id, savedUser.email);
          // ✅ Removed verbose logging for performance
        } catch (walletError) {
          console.error('Warning: Could not auto-create wallet:', walletError);
          // Don't fail signup if wallet creation fails
        }

        // ✅ Removed verbose logging for performance

        // ✅ SIMPLE REFERRAL: معالجة الإحالة بشكل مباشر
        let referralSuccess = false;
        if (userData.referrerCode && userData.referrerCode.trim() !== '') {
          // ✅ Removed verbose logging for performance

          try {
            // البحث عن المُحيل
            const referrer = await pool.query(
              'SELECT id, email FROM users WHERE referral_code = $1 AND id != $2',
              [userData.referrerCode.trim(), savedUser.id]
            );

            if (referrer.rows.length > 0) {
              const referrerData = referrer.rows[0];
              
              // إضافة 0.15 للمُحيل
              await pool.query(
                'UPDATE users SET coins = COALESCE(coins, 0) + 0.15 WHERE id = $1',
                [referrerData.id]
              );
              
              // إضافة 0.15 للمستخدم الجديد
              await pool.query(
                'UPDATE users SET coins = COALESCE(coins, 0) + 0.15 WHERE id = $1',
                [savedUser.id]
              );
              
              // حفظ سجل الإحالة (UNIQUE constraint على referee_id يمنع التكرار)
              await pool.query(
                'INSERT INTO referrals (referrer_id, referee_id, date, coins, status) VALUES ($1, $2, $3, $4, $5)',
                [referrerData.id, savedUser.id, Date.now(), 0.15, 'completed']
              );

              savedUser.coins = '0.15000000'; // تحديث الرصيد في الاستجابة
              referralSuccess = true;
              // Silent - reduce console spam
            } else {
              // Silent - reduce console spam
            }
          } catch (referralError) {
            // Silent - reduce console spam
          }
        }

        // إرسال الاستجابة مع رسالة المكافأة
        const response = { user: savedUser, success: true };
        if (referralSuccess) {
          response.bonusMessage = 'You received 0.15 points bonus for registering with a referral code!';
        }
        
        res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(response));
        return;
          
        } catch (transactionError) {
          await pool.query('ROLLBACK');
          console.error('Transaction error during user creation:', transactionError);
          
          // If it's a duplicate key error, try to get the existing user
          if (transactionError.code === '23505') {
            try {
              const existingUserData = await pool.query(
                'SELECT * FROM users WHERE email = $1',
                [userData.email]
              );
              
              if (existingUserData.rows.length > 0) {
                console.log(`Returning existing user after duplicate key error: ${userData.email}`);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ user: existingUserData.rows[0], success: true }));
                return;
              }
            } catch (fetchError) {
              console.error('Error fetching existing user after duplicate key error:', fetchError);
            }
          }
          
          throw transactionError;
        }
      } catch (error) {
        console.error('API error in /api/users:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error' }));
        return;
      }
    }

    // POST /api/auth/google - Save user from Google OAuth
    if (pathname === '/api/auth/google' && req.method === 'POST') {
      try {
        const { email, name, googleId, picture } = await parseRequestBody(req);
        
        if (!email || !googleId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Email and Google ID are required' }));
          return;
        }

        // Check if user exists
        const existingUser = await pool.query(
          'SELECT * FROM users WHERE email = $1 OR google_id = $2',
          [email, googleId]
        );

        let user;
        if (existingUser.rows.length > 0) {
          // Update existing user
          user = existingUser.rows[0];
          await pool.query(
            `UPDATE users 
             SET name = $1, avatar = $2, google_id = $3, updated_at = CURRENT_TIMESTAMP
             WHERE id = $4`,
            [name || user.name, picture || user.avatar, googleId, user.id]
          );
          // Silent - reduce console spam
        } else {
          // Create new user
          const referralCode = generateReferralCode();
          const accountCreatedDate = Date.now();
          
          const result = await pool.query(
            `INSERT INTO users (email, name, avatar, google_id, referral_code, coins, privacy_accepted, privacy_accepted_date, account_created_date, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, 0, true, $6, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING *`,
            [email, name || email.split('@')[0], picture, googleId, referralCode, accountCreatedDate]
          );
          
          user = result.rows[0];
          // Silent - reduce console spam

          // Auto-create wallet for new user
          try {
            const { generateWalletForNewUser } = await import('./wallet-manager.js');
            await generateWalletForNewUser(user.id, user.email);
            // Silent - reduce console spam
          } catch (walletError) {
            // Silent - reduce console spam
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatar: user.avatar,
            googleId: user.google_id,
            referralCode: user.referral_code
          }
        }));
        return;
      } catch (error) {
        console.error('Google auth error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Server error' }));
        return;
      }
    }

    // POST /api/auth/explorer-google - Save Explorer user from Google OAuth (separate from mining users)
    if (pathname === '/api/auth/explorer-google' && req.method === 'POST') {
      try {
        const { email, name, googleId, picture } = await parseRequestBody(req);
        
        if (!email || !googleId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Email and Google ID are required' }));
          return;
        }

        // Check if explorer user exists
        const existingUser = await pool.query(
          'SELECT * FROM explorer_users WHERE email = $1 OR google_id = $2',
          [email, googleId]
        );

        let user;
        const now = Date.now();
        
        if (existingUser.rows.length > 0) {
          // Update existing explorer user
          user = existingUser.rows[0];
          await pool.query(
            `UPDATE explorer_users 
             SET name = $1, avatar = $2, google_id = $3, last_login = $4
             WHERE id = $5`,
            [name || user.name, picture || user.avatar, googleId, now, user.id]
          );
          // Silent - reduce console spam
        } else {
          // Create new explorer user
          const result = await pool.query(
            `INSERT INTO explorer_users (email, name, avatar, google_id, created_at, last_login)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [email, name || email.split('@')[0], picture, googleId, now, now]
          );
          
          user = result.rows[0];
          // Silent - reduce console spam
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            picture: user.avatar,
            googleId: user.google_id
          }
        }));
        return;
      } catch (error) {
        console.error('Explorer Google auth error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Server error' }));
        return;
      }
    }

    // GET /api/referrals/:userId - Get user referrals
    if (pathname.startsWith('/api/referrals/') && req.method === 'GET') {
      try {
        const userId = parseInt(pathname.replace('/api/referrals/', ''));
        // ✅ Removed verbose console.log for performance

        const referrals = await getUserReferrals(userId);

        // Format Dates and enhance with up-to-date processing status
        const getRefereeData = async (userIds) => {
          if (!userIds || userIds.length === 0) return {};

          try {
            // Get the latest processing status for all referred users in a single query
            const result = await pool.query(
              'SELECT id, processing_active, processingactive, processing_end_time FROM users WHERE id = ANY($1)',
              [userIds]
            );

            // Convert to a map for easy lookup
            const userDataMap = {};
            result.rows.forEach(row => {
              const now = Date.now();
              const endTime = parseInt(row.processing_end_time) || 0;

              // Calculate if active based on all possible conditions
              const isActive = (
                row.processing_active == 1 || 
                row.processingactive == 1 || 
                String(row.processing_active) === '1' ||
                String(row.processingactive) === '1' ||
                (endTime > now)
              ) ? 1 : 0;

              userDataMap[row.id] = {
                processing_active: isActive,
                processingactive: isActive,
                is_active: isActive
              };
            });

            return userDataMap;
          } catch (err) {
            console.error('Error fetching referee data:', err);
            return {};          }
        };

        // Extract all user IDs from referrals
        const userIds = referrals.map(ref => ref.user_id).filter(id => id);

        // Get latest processing status for all referees
        const refereeDataMap = await getRefereeData(userIds);

        // Helper function for consistent referral date formatting
        function formatReferralDate(timestamp) {
          let date;
          if (timestamp) {
            date = new Date(parseInt(timestamp));
          } else {
            date = new Date();
          }
          
          // Ensure we have a valid date
          if (isNaN(date.getTime())) {
            date = new Date();
          }
          
          // Manual formatting to completely bypass server locale settings
          const year = date.getFullYear();
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const day = date.getDate().toString().padStart(2, '0');
          
          // Always return in YYYY/MM/DD format
          return `${year}/${month}/${day}`;
        }

        // Format referrals with the latest processing status
        const formattedReferrals = referrals.map(ref => {
          // Use consistent date formatting
          const joinDate = formatReferralDate(ref.date);

          // Protect email display
          const email = ref.email.replace(/(.{3}).*(@.*)/, '$1***$2');

          // Get up-to-date processing status from our map of all referred users
          let processingActive = 0;

          if (ref.user_id && refereeDataMap[ref.user_id]) {
            processingActive = refereeDataMap[ref.user_id].processing_active;
          } else {
            // Fallbackto original data if not in our fresh lookup
            const now = Date.now();
            const endTime = parseInt(refref.processing_end_time) || 0;

            processingActive = (
              ref.processing_active == 1 || 
              ref.processingactive == 1 || 
              ref.is_active == 1 || 
              String(ref.processing_active) === '1' ||
              String(ref.processingactive) === '1' ||
              String(ref.is_active) === '1' ||
              (endTime > now)
            ) ? 1 : 0;
          }

          // Referral user status - message reduced for performance

          return {
            id: ref.id || ref.user_id,
            email: email,
            name: ref.name,
            avatar: ref.avatar,
            date: joinDate,
            processing_active: processingActive,
            processingactive: processingActive,
            is_active: processingActive
          };
        });


        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ referrals: formattedReferrals }));
        return;
      } catch (error) {
        console.error('Database error in /api/referrals/:userId:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Database error' }));
        return;
      }
    }

    // GET /api/leaderboard - Get top referrers leaderboard
    if (pathname === '/api/leaderboard' && req.method === 'GET') {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const period = url.searchParams.get('period') || 'all';
        
        let timeFilter = '';
        const now = Date.now();
        
        // Calculate time filters based on period
        if (period === 'today') {
          const startOfDay = new Date();
          startOfDay.setHours(0, 0, 0, 0);
          timeFilter = `AND r.date >= '${startOfDay.getTime()}'`;
        } else if (period === 'weekly') {
          const startOfWeek = new Date();
          startOfWeek.setDate(startOfWeek.getDate() - 7);
          startOfWeek.setHours(0, 0, 0, 0);
          timeFilter = `AND r.date >= '${startOfWeek.getTime()}'`;
        }
        
        // Query to get top referrers with their actual reward amounts
        const query = `
          SELECT 
            u.id,
            u.email,
            u.name as username,
            u.avatar,
            COUNT(r.id) as referralCount,
            COALESCE(SUM(r.coins), 0) as referralRewards
          FROM users u
          LEFT JOIN referrals r ON u.id = r.referrer_id
          WHERE 1=1 ${timeFilter}
          GROUP BY u.id, u.email, u.name, u.avatar
          HAVING COUNT(r.id) > 0
          ORDER BY referralCount DESC
          LIMIT 50
        `;
        
        const result = await pool.query(query);
        
        // Format the leaderboard data
        const leaderboard = result.rows.map(user => ({
          id: user.id,
          email: user.email,
          username: user.username || user.email?.split('@')[0] || 'User',
          profileImage: user.avatar || null,
          avatar: user.avatar || null,
          referralCount: parseInt(user.referralcount) || 0,
          referralRewards: parseFloat(user.referralrewards) || 0
        }));
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true,
          period: period,
          leaderboard: leaderboard 
        }));
        return;
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Failed to fetch leaderboard',
          leaderboard: []
        }));
        return;
      }
    }

    // PUT /api/users/:userId/lastpayout - Update user's last payout
    if (pathname.match(/^\/api\/users\/\d+\/lastpayout$/) && req.method === 'PUT') {
      try {
        const userId = parseInt(pathname.split('/')[3]);
        const timestamp = Date.now();
        await pool.query(
          'UPDATE users SET last_payout = $1, processing_end_time = $2, processing_active = $3 WHERE id = $4',
          [timestamp, timestamp + (24 * 60 * 60 * 1000), 0, userId]
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, timestamp }));
        return;
      } catch (error) {
        console.error('Database error in /api/users/:userId/lastpayout:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Database error' }));
        return;
      }
    }

    // POST /api/relay/status or /api/processing/status - Check processing status using server time only
    if ((pathname === '/api/relay/status' || pathname === '/api/processing/status') && req.method === 'POST') {
      try {
        const { userId } = await parseRequestBody(req);
        
        // ✅ Removed verbose console.log for performance
        
        // 🔧 Smart timeout: 20 seconds for free/slow databases
        const queryTimeout = 20000;
        
        // Get all necessary processing data with adaptive timeout protection
        const userStatus = await Promise.race([
          pool.query(
            `SELECT 
               processing_active, 
               processing_end_time,
               processing_cooldown, 
               processing_start_time,
               processing_start_time_seconds, 
               last_payout,
               coins,
               COALESCE(accumulatedReward, 0) as accumulatedreward,
               COALESCE(accumulated_processing_reward, 0) as accumulated_processing_reward,
               COALESCE(completed_processing_reward, 0) as completed_processing_reward,
               processing_boost_multiplier,
               COALESCE(session_locked_boost, processing_boost_multiplier, 1.0) as session_locked_boost,
               COALESCE(last_server_sync, 0) as last_server_sync
             FROM users 
             WHERE id = $1`,
            [userId]
          ),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Processing status query timeout')), queryTimeout)
          )
        ]);

        if (!userStatus.rows[0]) {
          console.log(`[LINE 1759] ERROR: User ${userId} not found in database`);
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'User not found' }));
          return;
        }

        const user = userStatus.rows[0];
        const currentTimeMs = Date.now();
        const currentTimeSec = Math.floor(currentTimeMs / 1000);
        
        // استخدام نظام الثواني إذا كان متاحاً
        const startTimeSec = parseInt(user.processing_start_time_seconds) || 0;
        const processingDuration = 24 * 60 * 60; // 24 ساعة بالثواني
        const endTimeSec = startTimeSec > 0 ? startTimeSec + processingDuration : 0;
        
        // تحديد حالة التعدين بناءً على وقت الخادم
        let processing_active = 0;
        let remainingSec = 0;
        
        if (startTimeSec > 0) {
          remainingSec = Math.max(0, endTimeSec - currentTimeSec);
          processing_active = remainingSec > 0 ? 1 : 0;
          
          // تحديث حالة التعدين في قاعدة البيانات إذا لزم الأمر - مع timeout
          const storedProcessingActive = parseInt(user.processing_active) || 0;
          if (storedProcessingActive !== processing_active) {
            try {
              await Promise.race([
                pool.query(
                  'UPDATE users SET processing_active = $1, last_server_sync = $2 WHERE id = $3',
                  [processing_active, currentTimeSec, userId]
                ),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Update timeout')), 3000))
              ]);
            } catch (updateErr) {
              // تجاهل خطأ التحديث - الحالة ستُحسب من الوقت
              console.log(`[STATUS] Update skipped due to timeout for user ${userId}`);
            }
            
            // AUTO-CLEANUP: إذا أصبح التعدين غير نشط، احذف "Collecting..." من التاريخ
            if (processing_active === 0) {
              try {
                await Promise.race([
                  pool.query(
                    `DELETE FROM processing_history 
                     WHERE user_id = $1 
                     AND (user_name = 'Collecting...' OR user_name LIKE '%Collecting%')`,
                    [userId]
                  ),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Cleanup timeout')), 2000))
                ]);
              } catch (cleanupError) {
                // تجاهل خطأ التنظيف
              }
            }
          }
        }

        // User processing status check - message reduced for performance

        // Note: Orphaned reward transfer has been removed to prevent duplicate rewards

        // Current server time in both formats - ensure proper timestamp handling
        let nowMs = Date.now(); // milliseconds
        let nowSec = Math.floor(nowMs / 1000); // seconds
        
        // Validate timestamps to prevent 1970 epoch issues
        if (nowMs < 1000000000000) { // If timestamp is too small, use current time
          console.error('Invalid timestamp detected, using current time');
          nowMs = Date.now();
          nowSec = Math.floor(nowMs / 1000);
        }
        
        // Get processing data using seconds-based system if available
        let startTimeSecFromDB = parseInt(userStatus.rows[0].processing_start_time_seconds) || 0;
        
        // Fall back to millisecond values if seconds not available (backward compatibility)
        const startTimeMs = parseInt(userStatus.rows[0].processing_start_time) || 0;
        const endTimeMs = parseInt(userStatus.rows[0].processing_end_time) || 0;
        
        // Determine if processing is active based purely on server time
        // Priority: Use seconds-based system if available
        remainingSec = 0;
        let remainingMs = 0;
        let durationSec = processingDuration;
        let durationMs = processingDuration * 1000;
        
        // Seconds-based determination (primary approach)
        if (startTimeSecFromDB > 0) {
            // Calculate remaining time
            remainingSec = Math.max(0, endTimeSec - nowSec);
            remainingMs = remainingSec * 1000;
            
            // If within the active processing period
            if (remainingSec > 0) {
                processing_active = 1;
                
                // Update processing_active flag to 1 if needed - with timeout
                if (parseInt(userStatus.rows[0].processing_active) !== 1) {
                    try {
                        await Promise.race([
                            pool.query(
                                'UPDATE users SET processing_active = 1::integer, last_server_sync = $1 WHERE id = $2',
                                [nowSec, userId]
                            ),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Update timeout')), 3000))
                        ]);
                    } catch (e) { /* تجاهل timeout */ }
                }
            } else {
                // Processing completed - session ended
                processing_active = 0;
                
                // Set cooldown period (24 hours after end time)
                const cooldownTimeSec = endTimeSec;
                
                // ✅ CLEAR ALL ad boost data when session ends - with timeout
                try {
                    await Promise.race([
                        pool.query(
                            `UPDATE users SET 
                             processing_active = 0::integer, 
                             processing_cooldown = $1,
                             ad_boost_active = FALSE,
                             ad_boost_granted_at = NULL,
                             ad_boost_session_start = NULL,
                             last_ad_watch_timestamp = NULL,
                             session_locked_boost = 1.0
                             WHERE id = $2`,
                            [cooldownTimeSec * 1000, userId]
                        ),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Session end update timeout')), 3000))
                    ]);
                } catch (e) { /* تجاهل timeout - الحالة محسوبة من الوقت */ }
                
            }
        } 
        // Fall back to milliseconds system (backward compatibility)
        else if (endTimeMs > 0) {
            remainingMs = Math.max(0, endTimeMs - nowMs);
            remainingSec = Math.floor(remainingMs / 1000);
            
            if (remainingMs > 0) {
                processing_active = 1;
                
                // Update processing_active flag to 1 if needed - with timeout
                if (parseInt(userStatus.rows[0].processing_active) !== 1) {
                    try {
                        await Promise.race([
                            pool.query(
                                'UPDATE users SET processing_active = 1::integer WHERE id = $1',
                                [userId]
                            ),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Update timeout')), 3000))
                        ]);
                    } catch (e) { /* تجاهل */ }
                }
                
                // Also update seconds-based fields to enable migration to new system
                if (startTimeSecFromDB === 0) {
                    const estimatedStartTimeSec = Math.floor(startTimeMs / 1000);
                    try {
                        await Promise.race([
                            pool.query(
                                'UPDATE users SET processing_start_time_seconds = $1 WHERE id = $2',
                                [estimatedStartTimeSec, userId]
                            ),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Migration timeout')), 3000))
                        ]);
                    } catch (e) { /* تجاهل */ }
                }
            } else {
                // Processing completed - session ended
                processing_active = 0;
                
                // ✅ CLEAR ALL ad boost data in legacy system - with timeout
                try {
                    await Promise.race([
                        pool.query(
                            `UPDATE users SET 
                             processing_active = 0::integer,
                             ad_boost_active = FALSE,
                             ad_boost_granted_at = NULL,
                             ad_boost_session_start = NULL,
                             last_ad_watch_timestamp = NULL,
                             session_locked_boost = 1.0
                             WHERE id = $1`,
                            [userId]
                        ),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Legacy update timeout')), 3000))
                    ]);
                } catch (e) { /* تجاهل */ }
                
            }
        }

        // Get cooldown information
        const cooldownTimeMs = parseInt(userStatus.rows[0].processing_cooldown) || 0;
        const cooldownTimeSec = Math.floor(cooldownTimeMs / 1000);
        const inCooldown = cooldownTimeSec > nowSec;
        const cooldownRemainingMs = inCooldown ? (cooldownTimeSec - nowSec) * 1000 : 0;
        const cooldownRemainingSec = inCooldown ? cooldownTimeSec - nowSec : 0;

        // Calculate if user can start processing
        const canMine = !inCooldown && processing_active === 0;

        // Check same-day processing
        const today = new Date(nowMs).toISOString().split('T')[0];
        const lastPayout = parseInt(userStatus.rows[0].last_payout) || 0;
        const lastPayoutDate = lastPayout ? new Date(lastPayout).toISOString().split('T')[0] : null;
        const claimedToday = lastPayoutDate === today;

        // Smart logging for processing status (reduced frequency)
        smartLogger.logProcessingStatus(userId, {
          processing_active,
          remaining: remainingSec,
          can_mine: canMine
        });

     
       
        // SMART BOOST: استخدام المضاعف المثبت من بداية الجلسة (IMMUTABLE)
        // session_locked_boost يتم تعيينه عند بدء التعدين ولا يتغير حتى نهاية الجلسة
        const sessionLockedBoost = parseFloat(user.session_locked_boost || 1.0);
        const boostMultiplier = sessionLockedBoost;
        
        // التحقق من حالة Ad Boost (للعرض فقط)
        const { getAdBoostStatus } = await import('./db.js');
        const adBoostStatus = await getAdBoostStatus(userId);
        const hasAdBoost = adBoostStatus.boostActive || false;
        
        // حساب عدد الإحالات النشطة من المضاعف المثبت (للعرض فقط)
        let activeReferralCount = 0;
        if (processing_active === 1 && boostMultiplier > 1.0) {
          const baseHashrate = 10;
          const boostPerReferral = 0.4;
          const totalHashrate = boostMultiplier * baseHashrate;
          
          // إذا كان هناك Ad Boost, اطرح 1.2 من الهاشريت الكلي
          const hashrateFromReferrals = hasAdBoost ? (totalHashrate - baseHashrate - 1.2) : (totalHashrate - baseHashrate);
          activeReferralCount = Math.max(0, Math.round(hashrateFromReferrals / boostPerReferral));
        }
        
        // Get stored accumulated reward values with proper error handling - include completed_processing_reward
        const storedAccumulated = parseFloat(userStatus.rows[0].accumulatedreward || 0);
        const storedAltAccumulated = parseFloat(userStatus.rows[0].accumulated_processing_reward || 0);
        const storedCompleted = parseFloat(userStatus.rows[0].completed_processing_reward || 0);
        // Return the highest value among all reward fields with proper rounding
        const currentAccumulated = Math.round(Math.max(storedAccumulated, storedAltAccumulated, storedCompleted) * 100000000) / 100000000;

        // SERVER-SIDE ONLY: حساب المكافأة المتراكمة باستخدام المضاعف المثبت
        let serverAccumulation = currentAccumulated; // البدء بالقيمة الحالية
        let displayAccumulation = 0.00; // قيمة نظيفة للعرض
        
        if (processing_active === 1 && startTimeSec > 0) {
            const baseReward = 0.25; // المكافأة الأساسية
            const boostedReward = baseReward * sessionLockedBoost; // تطبيق المضاعف المثبت
            const elapsedSec = nowSec - startTimeSec;
            const rewardProgress = Math.min(1, elapsedSec / processingDuration);
            // تقريب المكافأة لتجنب الأرقام العشرية الطويلة مثل 0.248883
            serverAccumulation = Math.round((boostedReward * rewardProgress) * 100000000) / 100000000;
            
            // CLEAN DISPLAY: Only show accumulated if it's >= 0.01 (looks professional)
            displayAccumulation = serverAccumulation >= 0.01 ? serverAccumulation : 0.00;
            
            // ✅ NO UPDATE HERE - Just calculate and return
            // Database is only updated when session COMPLETES
        } else {
            serverAccumulation = currentAccumulated; // Use stored value if not actively processing
            displayAccumulation = serverAccumulation >= 0.01 ? serverAccumulation : 0.00;
        }

        // Respond with all necessary information, including both seconds and milliseconds formats
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          processing_active: processing_active,
          processingActive: processing_active.toString(),
          
          // Time fields in seconds (new format)
          start_time: startTimeSecFromDB, 
          end_time: endTimeSec,
          current_time: nowSec,
          server_time: nowSec,
          remaining_seconds: remainingSec,
          duration_seconds: durationSec,
          cooldown_until_seconds: cooldownTimeSec,
          cooldown_remaining_seconds: cooldownRemainingSec,
          
          // Legacy fields in milliseconds (for backward compatibility)
          processing_end_time: endTimeMs || (endTimeSec * 1000),
          processing_start_time: startTimeMs || (startTimeSecFromDB * 1000),
          processing_cooldown: cooldownTimeMs,
          processing_remaining: remainingMs,
          processing_duration: durationMs,
          cooldown_until: cooldownTimeMs || (cooldownTimeSec * 1000),
          cooldown_remaining: cooldownRemainingMs,
          
          // Status flags
          in_cooldown: inCooldown,
          can_mine: canMine,
          claimed_today: claimedToday,
          last_payout: lastPayout,
          
          // Reward data - SERVER-CALCULATED VALUE with CLEAN DISPLAY
          accumulatedReward: displayAccumulation,
          raw_accumulated: serverAccumulation, // Internal tracking only
          
          // Boost data - include these for client visibility
          active_referrals: activeReferralCount,
          boost_multiplier: boostMultiplier,
          base_reward: 0.25,
          boosted_reward: 0.25 * boostMultiplier,
          
          // Ad boost information
          ad_boost_active: hasAdBoost,
          ad_boost_value: hasAdBoost ? 1.2 : 0,
          
          // Add metadata about time system used
          using_seconds_system: startTimeSecFromDB > 0,
          time_system: startTimeSecFromDB > 0 ? 'seconds' : 'milliseconds'
        }));
        return;
      } catch (error) {
        console.error('Error checking processing status:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error',
          error_details: error.message,
          server_time: Math.floor(Date.now() / 1000)
        }));
        return;
      }
    }

    // POST /api/processing/start - Start processing without adding any rewards to balance
    if (pathname === '/api/processing/start' && req.method === 'POST') {
      try {
        const { userId } = await parseRequestBody(req);
        const now = Math.floor(Date.now() / 1000);
        const processingDuration = 24 * 60 * 60; // 24 hours

        // Silent - reduce console spam

        // Check if user exists
        const userStatus = await pool.query(
          `SELECT id, processing_active, coins, processing_start_time_seconds, processing_end_time FROM users WHERE id = $1`,
          [userId]
        );

        if (!userStatus.rows[0]) {
          console.log(`[LINE 1856] ERROR: User ${userId} not found in database`);
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'User not found' }));
          return;
        }

        const userData = userStatus.rows[0];
        const currentUserCoins = parseFloat(userData.coins || 0);
        const currentProcessingActive = parseInt(userData.processing_active || 0);
        const currentStartTime = parseInt(userData.processing_start_time_seconds || 0);
        const endTimeMs = parseInt(userData.processing_end_time || 0);
        const nowMs = Date.now();

        // ═══════════════════════════════════════════════════════════════
        // 🔒🔒🔒 حماية صارمة متعددة الطبقات - لا يمكن تجاوزها 🔒🔒🔒
        // ═══════════════════════════════════════════════════════════════

        // 🔒 طبقة 1: فحص end_time - الأدق
        if (endTimeMs > nowMs) {
          const remainingSeconds = Math.floor((endTimeMs - nowMs) / 1000);
          console.log(`🔒 BLOCKED [LAYER 1]: User ${userId} has active session (end_time), ${remainingSeconds}s remaining`);
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'لديك جلسة نشطة بالفعل',
            error_en: 'You already have an active processing session',
            processing_active: 1,
            remaining_seconds: remainingSeconds,
            coins: currentUserCoins,
            already_processing: true
          }));
          return;
        }

        // 🔒 طبقة 2: فحص processing_active + start_time
        if (currentProcessingActive === 1 && currentStartTime > 0) {
          const processingDurationCheck = 24 * 60 * 60;
          const endTimeFromStart = currentStartTime + processingDurationCheck;
          const remainingTime = Math.max(0, endTimeFromStart - now);
          
          if (remainingTime > 0) {
            console.log(`🔒 BLOCKED [LAYER 2]: User ${userId} has active session (start_time), ${remainingTime}s remaining`);
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: 'لديك جلسة نشطة بالفعل',
              error_en: 'You already have an active processing session',
              processing_active: 1,
              remaining_seconds: remainingTime,
              coins: currentUserCoins,
              already_processing: true
            }));
            return;
          }
        }

        // 🔒 طبقة 3: منع البدء السريع المتكرر (حماية من الضغط المتكرر)
        const MIN_SESSION_GAP = 10; // 10 ثواني على الأقل بين المحاولات
        const timeSinceLastStart = now - currentStartTime;
        
        if (currentStartTime > 0 && timeSinceLastStart < MIN_SESSION_GAP && timeSinceLastStart > 0) {
          console.log(`🔒 BLOCKED [LAYER 3]: User ${userId} rapid start attempt (${timeSinceLastStart}s since last)`);
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'انتظر قليلاً قبل المحاولة مرة أخرى',
            error_en: 'Please wait before trying again',
            wait_seconds: MIN_SESSION_GAP - timeSinceLastStart,
            already_processing: false
          }));
          return;
        }

        // ═══════════════════════════════════════════════════════════════
        // 🔒 طبقة 4: قفل قاعدة البيانات لمنع race condition
        // ═══════════════════════════════════════════════════════════════
        // فحص نهائي ذري مع UPDATE لضمان عدم وجود جلسة نشطة
        const atomicCheck = await pool.query(
          `UPDATE users 
           SET processing_active = processing_active 
           WHERE id = $1 
           AND (processing_active = 0 OR processing_active IS NULL OR processing_end_time < $2)
           RETURNING id`,
          [userId, nowMs]
        );
        
        if (atomicCheck.rowCount === 0) {
          console.log(`🔒 BLOCKED [LAYER 4]: User ${userId} - atomic check failed, session still active`);
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'لديك جلسة نشطة بالفعل',
            error_en: 'You already have an active processing session',
            already_processing: true
          }));
          return;
        }

        // ═══════════════════════════════════════════════════════════════
        // ✅ كل الفحوصات مرت - يمكن بدء جلسة جديدة
        // ═══════════════════════════════════════════════════════════════
        console.log(`✅ [SESSION START] User ${userId} passed all 4 layers - starting new session`);

        // SMART BOOST LOCKING: Calculate boost multiplier at session start and lock it
        const referralsResponse = await pool.query(
          `SELECT r.id, u.processing_active, u.processing_end_time, u.is_active 
           FROM referrals r
           JOIN users u ON r.referee_id = u.id
           WHERE r.referrer_id = $1`,
          [userId]
        );
        
        // Count CURRENTLY active referrals at session start
        let activeReferralCount = 0;
        // nowMs already defined above
        referralsResponse.rows.forEach(ref => {
          const refProcessingActive = parseInt(ref.processing_active) || 0;
          const refIsActive = parseInt(ref.is_active) || 0;
          const refEndTime = parseInt(ref.processing_end_time) || 0;
          const isActivelyProcessing = (refProcessingActive === 1 || refIsActive === 1 || (refEndTime > nowMs));
          if (isActivelyProcessing) {
            activeReferralCount++;
          }
        });
        
        // ✅ CLEAN START: Clear any old ad boost data from previous session
        // ✅ Reset session_locked_boost to 1.0 (base value, no boost)
        await pool.query(`
          UPDATE users 
          SET ad_boost_active = FALSE,
              ad_boost_granted_at = NULL,
              ad_boost_session_start = NULL,
              last_ad_watch_timestamp = NULL,
              session_locked_boost = 1.0
          WHERE id = $1`,
          [userId]
        );
        
        // Silent - reduce console spam
        
        // No ad boost for this new session unless user watches an ad
        const adBoostActiveForSession = false;
        
        // ✅ UNIFIED BOOST: Calculate using single function
        const { computeHashrateMultiplier } = await import('./db.js');
        const hashrateCalc = computeHashrateMultiplier(activeReferralCount, adBoostActiveForSession);
        const lockedBoostMultiplier = hashrateCalc.multiplier;
        
        // ✅ LOG: Show active referrals boost (like ad boost)
        if (activeReferralCount > 0) {
          const referralHashrateBoost = activeReferralCount * 0.4;
          console.log(`✅ [REFERRAL BOOST] Granted to user ${userId}: +${referralHashrateBoost.toFixed(1)} MH/s from ${activeReferralCount} active referral(s)`);
        }

        // CRITICAL: Get completed_processing_reward and transfer to balance BEFORE starting new session
        const rewardCheck = await pool.query(
          `SELECT coins, completed_processing_reward, accumulatedReward, accumulated_processing_reward 
           FROM users WHERE id = $1`,
          [userId]
        );
        
        const currentCoins = parseFloat(rewardCheck.rows[0]?.coins || 0);
        const completedReward = parseFloat(rewardCheck.rows[0]?.completed_processing_reward || 0);
        const storedAccumulated = parseFloat(rewardCheck.rows[0]?.accumulatedreward || 0);
        const storedAltAccumulated = parseFloat(rewardCheck.rows[0]?.accumulated_processing_reward || 0);
        
        // Get the highest accumulated value for proper transfer
        const maxAccumulated = Math.max(completedReward, storedAccumulated, storedAltAccumulated);
        const roundedReward = Math.round(maxAccumulated * 100000000) / 100000000;
        
        // Silent - reduce console spam

        // Transfer completed reward to balance if exists
        let newBalance = currentCoins;
        if (roundedReward > 0) {
          newBalance = Math.round((currentCoins + roundedReward) * 100000000) / 100000000;
          // Silent - reduce console spam
          
          // Update balance with the completed reward
          await pool.query(
            'UPDATE users SET coins = $1 WHERE id = $2',
            [newBalance, userId]
          );
        }

        // Start processing session with LOCKED boost
        // ✅ ONLY clear reward fields if we transferred a reward (roundedReward > 0)
        // ✅ If no reward was transferred, keep accumulated fields intact
        if (roundedReward > 0) {
          await pool.query(`
            UPDATE users 
            SET processing_active = 1, 
                processing_start_time_seconds = $1,
                processing_start_time = $2,
                processing_end_time = $3,
                accumulatedReward = 0,
                accumulated_processing_reward = 0,
                completed_processing_reward = 0,
                baseAccumulatedReward = 0,
                processing_boost_multiplier = $4,
                session_locked_boost = $4
            WHERE id = $5`,
            [now, now * 1000, (now + processingDuration) * 1000, lockedBoostMultiplier, userId]
          );
          // Silent - reduce console spam
        } else {
          // No transfer, just start new session without resetting reward fields
          await pool.query(`
            UPDATE users 
            SET processing_active = 1, 
                processing_start_time_seconds = $1,
                processing_start_time = $2,
                processing_end_time = $3,
                baseAccumulatedReward = 0,
                processing_boost_multiplier = $4,
                session_locked_boost = $4
            WHERE id = $5`,
            [now, now * 1000, (now + processingDuration) * 1000, lockedBoostMultiplier, userId]
          );
          // Silent - reduce console spam
        }

        // Silent - reduce console spam

        // Add "Collecting..." history entry only
        await pool.query(
          'INSERT INTO processing_history (user_id, amount, timestamp, user_name, date) VALUES ($1, 0, $2, $3, $4)',
          [userId, now * 1000, 'Collecting...', new Date(now * 1000).toISOString()]
        );

        // Silent - reduce console spam

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          processing_active: 1,
          start_time: now,
          end_time: now + processingDuration,
          remaining_seconds: processingDuration,
          coins: newBalance, // Updated balance with transferred reward
          previous_balance: currentCoins,
          transferred_reward: roundedReward,
          message: roundedReward > 0 
            ? `Processing started. ${roundedReward.toFixed(8)} ACCESS added to your balance.`
            : 'Point processing started successfully'
        }));

        // Silent - reduce console spam
        return;
      } catch (error) {
        console.error(`[LINE 1920] ERROR in processing start for user ${userId}:`, error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // POST /api/update-processing - Update processing status
    if (pathname === '/api/update-processing' && req.method === 'POST') {
      try {
        const userData = await parseRequestBody(req);
        const { userId, forceStatus } = userData;
        const now = Date.now();

        // First, check the current processing status
        const userStatus = await pool.query(
          'SELECT processing_active, processing_start_time, processing_end_time FROM users WHERE id = $1',
          [userId]
        );

        if (!userStatus.rows[0]) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'User not found' }));
          return;
        }

        const currentEndTime = parseInt(userStatus.rows[0].processing_end_time) || 0;
        const currentStartTime = parseInt(userStatus.rows[0].processing_start_time) || 0;

        // Check if processing should be active based on time range
        const shouldBeActive = currentEndTime > now && currentStartTime <= now;

        // If force status is provided, use that; otherwise determine based on time
        const newStatus = forceStatus !== undefined ? forceStatus : (shouldBeActive ? 1 : 0);

        console.log(`Updating processing status for user ${userId}: setting processing_active=${newStatus}, current endTime=${currentEndTime}, now=${now}, shouldBeActive=${shouldBeActive}`);

        // Update with the correct status
        await pool.query(
          'UPDATE users SET processing_active = $1::integer WHERE id = $2',
          [newStatus, userId]
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          processing_active: newStatus,
          should_be_active: shouldBeActive,
          current_time: now
        }));
        return;
      } catch (error) {
        console.error('Database error in /api/update-processing:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }


    // GET /api/network/sync-balance/:userId - مزامنة رصيد المستخدم مع الشبكة
    if (pathname.match(/^\/api\/network\/sync-balance\/\d+$/) && req.method === 'GET') {
      try {
        const userId = pathname.split('/')[4];
        const { syncUserBalanceWithNetwork } = await import('./network-api.js');
        
        const synced = await syncUserBalanceWithNetwork(parseInt(userId));
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          synced: synced,
          message: synced ? 'تم مزامنة الرصيد' : 'الرصيد مُزامن مسبقاً'
        }));
      } catch (error) {
        console.error('خطأ في مزامنة الرصيد:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }

    // POST /api/network/migrate-balances - ترحيل جميع الأرصدة إلى الشبكة
    if (pathname === '/api/network/migrate-balances' && req.method === 'POST') {
      try {
        const { migrateBalancesToNetwork } = await import('./network-api.js');
        
        await migrateBalancesToNetwork();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'تم ترحيل جميع الأرصدة إلى البلوكتشين بنجاح'
        }));
      } catch (error) {
        console.error('خطأ في ترحيل الأرصدة:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }

    // POST /api/network/sync-all-balances - مزامنة شاملة لجميع الأرصدة
    if (pathname === '/api/network/sync-all-balances' && req.method === 'POST') {
      try {
        const { syncAllBalancesToNetwork } = await import('./network-api.js');
        
        const result = await syncAllBalancesToNetwork();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        console.error('خطأ في المزامنة الشاملة:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }

    // GET /api/network/balance-status/:userId - حالة مزامنة رصيد المستخدم
    if (pathname.match(/^\/api\/blockchain\/balance-status\/\d+$/) && req.method === 'GET') {
      try {
        const userId = pathname.split('/')[4];
        const { ensureUserBalanceSync, getNetworkNode } = await import('./network-api.js');
        
        // الحصول على بيانات المستخدم
        const userResult = await pool.query(
          'SELECT coins, wallet_address FROM users WHERE id = $1',
          [userId]
        );

        if (userResult.rows.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'المستخدم غير موجود' }));
          return;
        }

        const user = userResult.rows[0];
        const dbBalance = parseFloat(user.coins || 0);
        let networkBalance = 0;

        // الحصول على رصيد البلوك تشين
        const networkNode = getNetworkNode();
        if (networkNode && user.wallet_address) {
          networkBalance = networkNode.network.getBalance(user.wallet_address);
        }

        const isSynced = Math.abs(dbBalance - networkBalance) < 0.00000001;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          userId: userId,
          walletAddress: user.wallet_address,
          databaseBalance: dbBalance,
          networkBalance: networkBalance,
          isSynced: isSynced,
          difference: Math.abs(dbBalance - networkBalance)
        }));
      } catch (error) {
        console.error('خطأ في فحص حالة الرصيد:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }

    // POST /api/network/force-sync/:userId - فرض مزامنة رصيد مستخدم محدد
    if (pathname.match(/^\/api\/blockchain\/force-sync\/\d+$/) && req.method === 'POST') {
      try {
        const userId = pathname.split('/')[4];
        const { ensureUserBalanceSync } = await import('./network-api.js');
        
        const synced = await ensureUserBalanceSync(parseInt(userId));
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          userId: userId,
          synced: synced,
          message: synced ? 'تم مزامنة الرصيد بنجاح' : 'الرصيد مُزامن مسبقاً'
        }));
      } catch (error) {
        console.error('خطأ في فرض المزامنة:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }

    // POST /api/network/sync-transactions - مزامنة المعاملات مع البلوك تشين
    if (pathname === '/api/network/sync-transactions' && req.method === 'POST') {
      try {
        const { syncTransactionsToNetwork } = await import('./network-api.js');
        
        await syncTransactionsToNetwork();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'تم مزامنة المعاملات مع البلوك تشين بنجاح'
        }));
      } catch (error) {
        console.error('خطأ في مزامنة المعاملات:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });

    // API للمعاملات المستلمة للمحافظ الخارجية
    if (pathname === '/api/wallet/received-transactions' && method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const walletAddress = url.searchParams.get('address');
      
      if (!walletAddress) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({
          success: false,
          error: 'عنوان المحفظة مطلوب'
        }));
        return;
      }

      try {
        // البحث عن المعاملات المستلمة
        const receivedTransactions = await pool.query(`
          SELECT 
            hash,
            sender_address as from_address,
            recipient_address as to_address,
            amount,
            timestamp,
            status,
            block_hash,
            gas_fee
          FROM transactions 
          WHERE recipient_address = $1 
          ORDER BY timestamp DESC 
          LIMIT 50
        `, [walletAddress.toLowerCase()]);

        const formattedTransactions = receivedTransactions.rows.map(tx => ({
          hash: tx.hash,
          from: tx.from_address,
          to: tx.to_address,
          value: '0x' + Math.floor(parseFloat(tx.amount) * 1e18).toString(16),
          gas: '0x5208',
          gasPrice: '0x' + Math.floor(parseFloat(tx.gas_fee || 0.00002) * 1e18 / 21000).toString(16), // ✅ صحيح: gasPrice per unit
          input: '0x',
          blockHash: tx.block_hash,
          blockNumber: '0x' + Math.floor(tx.timestamp / 1000).toString(16),
          transactionIndex: '0x0',
          status: '0x1', // success
          type: 'received'
        }));

        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({
          success: true,
          transactions: formattedTransactions,
          count: formattedTransactions.length
        }));
      } catch (error) {
        console.error('خطأ في جلب المعاملات المستلمة:', error);
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({
          success: false,
          error: 'خطأ في الخادم'
        }));
      }
      return;
    }

        res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }

    // POST /api/transaction/record - Record transaction between users

    // GET /api/wallet/:address - Get wallet info by address (local and external)
    if (pathname.startsWith('/api/wallet/') && req.method === 'GET') {
      try {
        const walletAddress = decodeURIComponent(pathname.replace('/api/wallet/', ''));
        console.log('Looking up wallet info for address:', walletAddress);

        // التحقق من صحة تنسيق العنوان
        if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Invalid wallet address format' 
          }));
          return;
        }

        // توحيد العنوان إلى أحرف صغيرة
        const normalizedAddress = walletAddress.toLowerCase();

        // First check in users table for wallet address
        const userResult = await pool.query(
          'SELECT id as user_id, email, name, coins as balance FROM users WHERE LOWER(wallet_address) = $1',
          [normalizedAddress]
        );

        if (userResult.rows.length > 0) {
          const userData = userResult.rows[0];

          // Fetch transaction history for this wallet
          const transactionsResult = await pool.query(
            `SELECT * FROM transactions 
             WHERE LOWER(sender_address) = $1 OR LOWER(recipient_address) = $1
             ORDER BY timestamp DESC
             LIMIT 50`,
            [normalizedAddress]
          ).catch(err => {
            console.log('Error fetching transactions:', err.message);
            return { rows: [] };
          });

          // Return local user data and transactions
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            wallet_found: true,
            wallet_type: 'local',
            user: userData,
            transactions: transactionsResult.rows
          }));
          return;
        }

        // ✅ Check balance from ACCESS State Trie (no external_wallets needed)
        try {
          // الحصول على الرصيد مباشرة من State Trie
          const balanceWei = await accessStateStorage.getBalance(normalizedAddress);
          const balance = parseFloat(balanceWei) / 1e18; // تحويل من Wei إلى ACCESS

          if (balance > 0 || true) { // دائماً نرجع المعلومات حتى لو الرصيد 0
            // Fetch regular transaction history
            const transactionsResult = await pool.query(
              `SELECT * FROM transactions 
               WHERE LOWER(sender_address) = $1 OR LOWER(recipient_address) = $1
               ORDER BY timestamp DESC
               LIMIT 50`,
              [normalizedAddress]
            ).catch(err => {
              console.log('Error fetching transactions:', err.message);
              return { rows: [] };
            });

            // إحصائيات المعاملات
            const outgoingTx = transactionsResult.rows.filter(tx => tx.direction === 'outgoing').length;
            const incomingTx = transactionsResult.rows.filter(tx => tx.direction === 'incoming').length;

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              wallet_found: true,
              wallet_type: 'external',
              user: {
                wallet_address: normalizedAddress,
                balance: balance,
                // ✅ لا نحتاج user_agent, chain_id - فقط الرصيد من State Trie
              },
              transactions: transactionsResult.rows,
              transaction_stats: {
                total: transactionsResult.rows.length,
                sent: outgoingTx,
                received: incomingTx
              }
            }));
            return;
          }
        } catch (stateError) {
          console.warn('Could not get balance from State Trie:', stateError.message);
        }

        // محاولة الحصول على الرصيد من البلوك تشين حتى لو لم تكن المحفظة مسجلة
        let networkBalance = 0;
        try {
          const { getNetworkNode } = await import('./network-api.js');
          const networkNode = getNetworkNode();
          if (networkNode && networkNode.network) {
            networkBalance = networkNode.network.getBalance(normalizedAddress);
          }
        } catch (networkError) {
          console.warn('Could not get blockchain balance:', networkError.message);
        }

        // إذا كان هناك رصيد في البلوك تشين، سجل المحفظة كمحفظة خارجية
        if (networkBalance > 0) {
          try {
            await pool.query(
              `INSERT INTO external_wallets (address, balance, first_seen, last_activity, is_active)
               VALUES ($1, $2, $3, $3, true)
               ON CONFLICT (address) DO UPDATE SET balance = $2, last_activity = $3`,
              [normalizedAddress, networkBalance.toFixed(8), Date.now()]
            );

            // External wallet registered - message reduced for performance

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              wallet_found: true,
              wallet_type: 'external',
              auto_registered: true,
              user: {
                wallet_address: normalizedAddress,
                balance: networkBalance,
                user_agent: 'Auto-detected',
                chain_id: '0x5968',
                first_seen: Date.now(),
                last_activity: Date.now()
              },
              transactions: []
            }));
            return;
          } catch (regError) {
            console.error('Error auto-registering wallet:', regError);
          }
        }

        // Wallet not found anywhere
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          wallet_found: false, 
          error: 'Wallet address not found in local or external registries' 
        }));
      } catch (error) {
        console.error('Error fetching wallet info:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error processing wallet lookup' 
        }));
      }
      return;
    }

    // POST /api/wallet/generate - Generate a new wallet
    if (pathname === '/api/wallet/generate' && req.method === 'POST') {
      try {
        const { handleGenerateWallet } = await import('./wallet-api.js');
        const data = await parseRequestBody(req);

        // Process the request
        const result = await handleGenerateWallet({ body: data }, res);

        // Send the response
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
      } catch (error) {
        console.error('Error handling wallet generation:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error generating wallet' 
        }));
      }
      return;
    }

    // POST /api/wallet/import - Import an existing wallet
    if (pathname === '/api/wallet/import' && req.method === 'POST') {
      try {
        const { handleImportWallet } = await import('./wallet-api.js');
        const data = await parseRequestBody(req);

        // Process the request
        const result = await handleImportWallet({ body: data }, res);

        // Send the response
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
      } catch (error) {
        console.error('Error handling wallet import:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error importing wallet' 
        }));
      }
      return;
    }

    // GET /api/user/:userId/wallets - Get all wallets for a user
    if (pathname.match(/^\/api\/user\/\d+\/wallets$/) && req.method === 'GET') {
      try {
        const { handleGetUserWallets } = await import('./wallet-api.js');
        const userId = pathname.split('/')[3];

        // Process the request
        const result = await handleGetUserWallets({ params: { userId } }, res);

        // Send the response
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
      } catch (error) {
        console.error('Error getting user wallets:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error retrieving user wallets' 
        }));
      }
      return;
    }

    // POST /api/wallet/check-external - Check if address is external wallet with unified address handling
    if (pathname === '/api/wallet/check-external' && req.method === 'POST') {
      try {
        let { address } = await parseRequestBody(req);
        
        if (!address || !address.startsWith('0x')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Invalid wallet address' 
          }));
          return;
        }

        // توحيد العنوان
        address = address.toLowerCase();

        // التحقق من وجود العنوان في قاعدة البيانات المحلية باستخدام العنوان الموحد
        const localWalletCheck = await pool.query(
          'SELECT id FROM users WHERE LOWER(wallet_address) = $1',
          [address]
        );

        const isLocalWallet = localWalletCheck.rows.length > 0;

        // التحقق من وجود العنوان في قاعدة المحافظ الخارجية باستخدام العنوان الموحد
        const externalWalletCheck = await pool.query(
          'SELECT address, balance, last_activity FROM external_wallets WHERE LOWER(address) = $1',
          [address]
        );

        const isExternalWallet = externalWalletCheck.rows.length > 0;

        // الحصول على الرصيد من البلوك تشين
        let networkBalance = 0;
        try {
          const { getNetworkNode } = await import('./network-api.js');
          const networkNode = getNetworkNode();
          if (networkNode && networkNode.network) {
            networkBalance = networkNode.network.getBalance(address);
          }
        } catch (error) {
          console.warn('Could not get blockchain balance:', error.message);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          address: address,
          isLocalWallet: isLocalWallet,
          isExternalWallet: isExternalWallet,
          isKnownWallet: isLocalWallet || isExternalWallet,
          canSendTo: true, // يمكن الإرسال لأي عنوان صحيح
          networkBalance: networkBalance,
          walletInfo: {
            type: isLocalWallet ? 'local' : (isExternalWallet ? 'external' : 'unknown'),
            hasActivity: isExternalWallet,
            lastActivity: isExternalWallet ? externalWalletCheck.rows[0].last_activity : null
          }
        }));
      } catch (error) {
        console.error('Error checking external wallet:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error checking wallet' 
        }));
      }
      return;
    }

    // GET /api/user/:userId/transactions - Get all transactions for a user across all wallets
    if (pathname.match(/^\/api\/user\/\d+\/transactions$/) && req.method === 'GET') {
      try {
        const userId = parseInt(pathname.split('/')[3]);
        // Silent - reduce console spam

        // Get total count first
        const countResult = await pool.query(
          `SELECT COUNT(*) as total FROM transactions t WHERE t.sender = $1 OR t.recipient = $1`,
          [userId]
        );
        const totalCount = parseInt(countResult.rows[0]?.total) || 0;

        // Get all transactions for this user from the database
        const transactionsResult = await pool.query(
          `SELECT t.*, 
                 CASE WHEN t.sender = $1 THEN 'outgoing' 
                      WHEN t.recipient = $1 THEN 'incoming' 
                      ELSE 'unknown' END as direction
           FROM transactions t
           WHERE t.sender = $1 OR t.recipient = $1
           ORDER BY t.timestamp DESC`,
          [userId]
        );

        // Convert numeric amounts to proper numbers and add useful fields
        const transactions = transactionsResult.rows.map(tx => {
          // Format date consistently
          const date = new Date(parseInt(tx.timestamp));
          const year = date.getFullYear();
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const day = date.getDate().toString().padStart(2, '0');
          const hours = date.getHours().toString().padStart(2, '0');
          const minutes = date.getMinutes().toString().padStart(2, '0');
          const seconds = date.getSeconds().toString().padStart(2, '0');
          const formattedDate = `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
          
          return {
            ...tx,
            amount: parseFloat(tx.amount),
            gas_fee: parseFloat(tx.gas_fee || 0),
            date: formattedDate,
            is_outgoing: tx.direction === 'outgoing',
            // Extra fields needed by the frontend
            sender_id: tx.sender,
            recipient_id: tx.recipient,
            from: tx.sender_address,
            to: tx.recipient_address,
            hash: tx.hash,
            timestamp: parseInt(tx.timestamp)
          };
        });

        // Silent - reduce console spam

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          transactions: transactions,
          totalCount: totalCount
        }));
      } catch (error) {
        console.error('Error getting user transactions:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error retrieving user transactions' 
        }));
      }
      return;
    }

    // GET /api/wallet/:address/transactions - Get transactions for a wallet
    if (pathname.match(/^\/api\/wallet\/[^\/]+\/transactions$/) && req.method === 'GET') {
      try {
        const address = decodeURIComponent(pathname.split('/')[3]);
        // Silent - reduce console spam

        // التحقق من صحة العنوان
        if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Invalid wallet address format' 
          }));
          return;
        }

        // توحيد العنوان
        const normalizedAddress = address.toLowerCase();

        // Get total count first
        const countResult = await pool.query(
          `SELECT COUNT(*) as total FROM transactions t WHERE LOWER(t.sender_address) = $1 OR LOWER(t.recipient_address) = $1`,
          [normalizedAddress]
        );
        const totalCount = parseInt(countResult.rows[0]?.total) || 0;

        // البحث عن جميع المعاملات لهذا العنوان (الواردة والصادرة)
        const transactionsResult = await pool.query(
          `SELECT t.*, 
                  CASE 
                    WHEN LOWER(t.sender_address) = $1 THEN 'outgoing' 
                    WHEN LOWER(t.recipient_address) = $1 THEN 'incoming' 
                    ELSE 'unknown' 
                  END as direction,
                  CASE 
                    WHEN LOWER(t.sender_address) = $1 THEN 'sent'
                    WHEN LOWER(t.recipient_address) = $1 THEN 'received'
                    ELSE 'unknown'
                  END as transaction_type
           FROM transactions t
           WHERE LOWER(t.sender_address) = $1 OR LOWER(t.recipient_address) = $1
           ORDER BY t.timestamp DESC`,
          [normalizedAddress]
        );

        // تنسيق المعاملات
        const transactions = transactionsResult.rows.map(tx => {
          const date = new Date(parseInt(tx.timestamp));
          const year = date.getFullYear();
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const day = date.getDate().toString().padStart(2, '0');
          const hours = date.getHours().toString().padStart(2, '0');
          const minutes = date.getMinutes().toString().padStart(2, '0');
          const seconds = date.getSeconds().toString().padStart(2, '0');
          const formattedDate = `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
          
          return {
            ...tx,
            amount: parseFloat(tx.amount),
            gas_fee: parseFloat(tx.gas_fee || 0),
            date: formattedDate,
            is_outgoing: tx.direction === 'outgoing',
            is_incoming: tx.direction === 'incoming',
            transaction_type: tx.transaction_type || tx.direction,
            from: tx.sender_address,
            to: tx.recipient_address,
            hash: tx.hash,
            timestamp: parseInt(tx.timestamp)
          };
        });

        // Silent - reduce console spam

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          transactions: transactions,
          wallet_address: address,
          transaction_count: transactions.length,
          totalCount: totalCount
        }));
      } catch (error) {
        console.error('Error getting wallet transactions:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error retrieving wallet transactions' 
        }));


    // API خاص للمحافظ الخارجية - الحصول على المعاملات المستلمة
    if (pathname === '/api/external-wallet/received-transactions' && req.method === 'GET') {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const walletAddress = url.searchParams.get('address');
        
        if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'عنوان محفظة صحيح مطلوب'
          }));
          return;
        }

        const normalizedAddress = walletAddress.toLowerCase();

        // البحث عن المعاملات المستلمة من قاعدة البيانات
        const receivedTxs = await pool.query(`
          SELECT 
            hash,
            sender_address as from_address,
            recipient_address as to_address,
            amount,
            timestamp,
            status,
            block_hash,
            gas_fee,
            description
          FROM transactions 
          WHERE LOWER(recipient_address) = $1 
          AND status = 'confirmed'
          ORDER BY timestamp DESC
        `, [normalizedAddress]);

        // تنسيق المعاملات للمحافظ الخارجية
        const formattedTransactions = receivedTxs.rows.map(tx => ({
          hash: tx.hash,
          from: tx.from_address,
          to: tx.to_address,
          value: '0x' + Math.floor(parseFloat(tx.amount) * 1e18).toString(16),
          gas: '0x5208',
          gasPrice: '0x' + Math.floor(parseFloat(tx.gas_fee || 0.00002) * 1e18 / 21000).toString(16), // ✅ صحيح: gasPrice per unit
          input: '0x',
          blockHash: tx.block_hash,
          blockNumber: '0x' + Math.floor(tx.timestamp / 1000).toString(16),
          transactionIndex: '0x0',
          status: '0x1',
          type: '0x0',
          timestamp: '0x' + Math.floor(tx.timestamp / 1000).toString(16),
          direction: 'received',
          confirmed: true
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          address: normalizedAddress,
          transactions: formattedTransactions,
          count: formattedTransactions.length,
          message: 'معاملات الاستلام للمحفظة الخارجية'
        }));
      } catch (error) {
        console.error('خطأ في جلب معاملات الاستلام:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'خطأ في الخادم'
        }));
      }
      return;
    }

    // API لإشعار المحافظ الخارجية بمعاملة مستلمة جديدة
    if (pathname === '/api/external-wallet/notify-received' && req.method === 'POST') {
      try {
        const { walletAddress, transactionHash, amount, fromAddress } = await parseRequestBody(req);
        
        if (!walletAddress || !transactionHash || !amount || !fromAddress) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'معاملات مطلوبة مفقودة'
          }));
          return;
        }

        // إنشاء بيانات المعاملة للإشعار
        const transactionData = {
          hash: transactionHash,
          from: fromAddress.toLowerCase(),
          to: walletAddress.toLowerCase(),
          amount: parseFloat(amount),
          timestamp: Date.now(),
          blockNumber: '0x' + Math.floor(Date.now() / 1000).toString(16),
          blockHash: '0x' + require('crypto').randomBytes(32).toString('hex')
        };

        // إرسال إشعارات للمحافظ الخارجية
        await notifyExternalWallets(transactionData);
        await broadcastTransactionLog(transactionData);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'تم إرسال إشعارات الاستلام للمحافظ الخارجية',
          walletAddress: walletAddress,
          transactionHash: transactionHash
        }));
      } catch (error) {
        console.error('خطأ في إشعار المحافظ الخارجية:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'خطأ في الخادم'
        }));
      }
      return;
    }


      }
      return;
    }

    // POST /api/user/update-coins - Update user's coin balance
    if (pathname === '/api/user/update-coins' && req.method === 'POST') {
      try {
        const { userId, coins } = await parseRequestBody(req);

        if (!userId || typeof coins !== 'number') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Missing or invalid parameters' 
          }));
          return;
        }

        // Update user's coins in database
        const result = await pool.query(
          'UPDATE users SET coins = $1 WHERE id = $2 RETURNING coins',
          [coins, userId]
        );

        if (result.rows.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'User not found' 
          }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Coins updated successfully',
          coins: result.rows[0].coins
        }));
      } catch (error) {
        console.error('Error updating user coins:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error processing coins update' 
        }));
      }
      return;
    }
    
    // GET /api/transactions/:userId - Get all transactions for a user
    if (pathname.match(/^\/api\/transactions\/\d+$/) && req.method === 'GET') {
      try {
        const userId = parseInt(pathname.split('/')[3]);
        // Silent - reduce console spam

        // Check if user exists and get their wallet address
        const userCheck = await pool.query('SELECT id, wallet_address FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'User not found' 
          }));
          return;
        }

        const userWalletAddress = userCheck.rows[0].wallet_address;

        // Get all transactions for this user from the database with enhanced error handling
        let transactionsResult;
        try {
          // محسّن للتعامل مع المحافظ الخارجية والمحلية
          if (userWalletAddress) {
            // البحث باستخدام user ID ورقم المحفظة
            transactionsResult = await pool.query(
              `SELECT t.*, 
                      CASE 
                        WHEN (t.sender = $1 OR LOWER(t.sender_address) = LOWER($2)) THEN 'outgoing' 
                        WHEN (t.recipient = $1 OR LOWER(t.recipient_address) = LOWER($2)) THEN 'incoming' 
                        ELSE 'unknown' 
                      END as direction
               FROM transactions t
               WHERE (t.sender = $1 OR t.recipient = $1 OR 
                      LOWER(t.sender_address) = LOWER($2) OR 
                      LOWER(t.recipient_address) = LOWER($2))
               ORDER BY t.timestamp DESC`,
              [userId, userWalletAddress]
            );
          } else {
            // البحث باستخدام user ID فقط
            transactionsResult = await pool.query(
              `SELECT t.*,
                      CASE 
                        WHEN t.sender = $1 THEN 'outgoing' 
                        WHEN t.recipient = $1 THEN 'incoming' 
                        ELSE 'unknown' 
                      END as direction
               FROM transactions t
               WHERE t.sender = $1 OR t.recipient = $1
               ORDER BY t.timestamp DESC`,
              [userId]
            );
          }
        } catch (queryError) {
          console.error('Error in transaction query:', queryError);

          // Fallback to simpler query
          try {
            transactionsResult = await pool.query(
              `SELECT t.*,
                      CASE 
                        WHEN t.sender = $1 THEN 'outgoing' 
                        WHEN t.recipient = $1 THEN 'incoming' 
                        ELSE 'unknown' 
                      END as direction
               FROM transactions t
               WHERE (t.sender = $1 OR t.recipient = $1) AND t.sender IS NOT NULL AND t.recipient IS NOT NULL
               ORDER BY t.timestamp DESC`,
              [userId]
            );
          } catch (fallbackError) {
            console.error('Error in fallback transaction query:', fallbackError);
            throw new Error('Failed to retrieve transactions after fallback attempt');
          }
        }

    // Helper function for consistent date formatting on server side
        function formatServerTransactionDate(timestamp) {
          if (!timestamp) return '';
          
          const date = new Date(parseInt(timestamp));
          
          // Ensure we have a valid date
          if (isNaN(date.getTime())) return '';
          
          // Manual formatting to completely bypass server locale settings
          const year = date.getFullYear();
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const day = date.getDate().toString().padStart(2, '0');
          const hours = date.getHours().toString().padStart(2, '0');
          const minutes = date.getMinutes().toString().padStart(2, '0');
          const seconds = date.getSeconds().toString().padStart(2, '0');
          
          // Always return in English format: YYYY/MM/DD HH:MM:SS
          return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
        }

        // دالة تنسيق ذكية للأرقام على الخادم
        function formatAmountSmart(amount) {
          const num = parseFloat(amount || 0);
          let formatted = num.toFixed(8);
          formatted = formatted.replace(/\.?0+$/, '');
          return formatted || '0';
        }

        // Convert numeric amounts to proper numbers with smart formatting
        const transactions = transactionsResult.rows.map(tx => {
          // Use consistent date formatting
          const formattedDate = formatServerTransactionDate(tx.timestamp);
          
          return {
            ...tx,
            amount: formatAmountSmart(tx.amount), // تنسيق ذكي للمبلغ
            gas_fee: formatAmountSmart(tx.gas_fee), // تنسيق ذكي لرسوم الغاز
            date: formattedDate,
            is_outgoing: tx.direction === 'outgoing' || tx.sender === userId,
            // Extra fields needed by the frontend
            sender_id: tx.sender,
            recipient_id: tx.recipient,
            from: tx.sender_address,
            to: tx.recipient_address,
            hash: tx.hash || `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
            timestamp: parseInt(tx.timestamp)
          };
        });


        // Silent - reduce console spam

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          transactions: transactions
        }));
      } catch (error) {
        console.error('Error getting user transactions:', error);
        res.writeHead(500, { 'Content-Type': 'applicationjson' });
        res.end(JSON.stringify({ 
          success: false,           error: 'Server error retrieving user transactions' 
        }));
      }
      return;
    }

    // POST /api/wallet/set-active - Set active wallet for user
    if (pathname === '/api/wallet/set-active' && req.method === 'POST') {
      try {
        const { handleSetActiveWallet } = await import('./wallet-api.js');
        const data = await parseRequestBody(req);

        // Process the request
        const result = await handleSetActiveWallet({ body: data }, res);

        // Send the response
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
      } catch (error) {
        console.error('Error setting active wallet:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error setting active wallet' 
        }));
      }
      return;
    }

    // POST /api/user/sync-balance - Sync user balance
    if (pathname === '/api/user/sync-balance' && req.method === 'POST') {
      try {
        const { userId, balance } = await parseRequestBody(req);

        if (!userId || balance === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Missing required parameters' 
          }));
          return;
        }

        // Update user's balance in database
        await pool.query(
          'UPDATE users SET coins = $1 WHERE id = $2',
          [balance, userId]
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Balance synchronized successfully',
          balance: balance
        }));
      } catch (error) {
        console.error('Error syncing user balance:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error processing balance sync' 
        }));
      }
      return;
    }

    // POST /api/user/update-coins - Update user's coin balance
    if (pathname === '/api/user/update-coins' && req.method === 'POST') {
      try {
        const { userId, coins } = await parseRequestBody(req);

        if (!userId || typeof coins !== 'number') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Missing or invalid parameters' 
          }));
          return;
        }

        // Update user's coins in database
        const result = await pool.query(
          'UPDATE users SET coins = $1 WHERE id = $2 RETURNING coins',
          [coins, userId]
        );

        if (result.rows.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'User not found' 
          }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Coins updated successfully',
          coins: result.rows[0].coins
        }));
      } catch (error) {
        console.error('Error updating user coins:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error processing coins update' 
        }));
      }
      return;
    }
    
    // GET /api/network/network-info - Get real blockchain network information
    if (pathname === '/api/network/network-info' && req.method === 'GET') {
      try {
        const { getNetworkNode } = await import('./network-api.js');
        const networkNode = getNetworkNode();
        
        if (networkNode && networkNode.network) {
          const networkInfo = await networkNode.network.getNetworkInfo();
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            network: {
              chainId: networkInfo.chainId,
              networkId: networkInfo.networkId,
              blockHeight: networkInfo.blockHeight,
              totalSupply: networkInfo.totalSupply,
              circulatingSupply: networkInfo.circulatingSupply,
              gasPrice: networkInfo.gasPrice,
              isOnline: true,
              rpcEndpoint: '/rpc',
              explorerUrl: `${req.headers.host}/blockchain-explorer`
            },
            stats: {
              totalBlocks: networkInfo.blockHeight + 1,
              totalTransactions: networkInfo.totalTransactions || 0,
              activeNodes: networkInfo.peers || 1,
              hashRate: networkInfo.hashRate || 0
            }
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            data: {
              blockHeight: 0,
              totalSupply: '25000000',
              circulatingSupply: '25000000',
              totalTransactions: 0,
              tps: 0.0,
              blockTime: 15,
              activeNodes: 1,
              hashRate: 0
            }
          }));
          return;
        }
      } catch (error) {
        console.error('Error getting blockchain network info:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Network network not available',
          network: {
            chainId: 'access-mainnet-1',
            networkId: 1,
            isOnline: false
          }
        }));
      }
      return;
    }

    // GET /api/network/balance/:address - الرصيد محسوب من البلوكتشين فقط
    if (pathname.match(/^\/api\/blockchain\/balance\/0x[a-fA-F0-9]{40}$/) && req.method === 'GET') {
      try {
        const address = pathname.split('/')[4];
        const { getNetworkNode } = await import('./network-api.js');
        const networkNode = getNetworkNode();
        
        if (networkNode && networkNode.network) {
          // الرصيد محسوب دائماً من حالة البلوكتشين (Network State)
          const balance = networkNode.network.getBalance(address);
          
          // لا نحفظ الرصيد في قاعدة البيانات - نحسبه دائماً من الشبكة
          // فقط نسجل أن العنوان تم فحصه
          await pool.query(
            'UPDATE external_wallets SET last_sync = $1 WHERE address = $2',
            [Date.now(), address.toLowerCase()]
          ).catch(() => {}); // تجاهل الأخطاء
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            address: address,
            balance: balance,
            balanceFormatted: `${balance.toFixed(8)} ACCESS`,
            source: 'blockchain_state',
            calculation_method: 'network_state',
            message: 'الرصيد محسوب من حالة الشبكة مباشرة - مثل Ethereum'
          }));
        } else {
          throw new Error('Network not available');
        }
      } catch (error) {
        console.error('Error calculating balance from blockchain state:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }

    // GET /api/network/block/:number - Get block by number
    if (pathname.match(/^\/api\/blockchain\/block\/(latest|\d+|0x[a-fA-F0-9]+)$/) && req.method === 'GET') {
      try {
        const blockNumber = pathname.split('/')[4];
        const { getNetworkNode } = await import('./network-api.js');
        const networkNode = getNetworkNode();
        
        if (networkNode && networkNode.network) {
          let blockIndex;
          if (blockNumber === 'latest') {
            blockIndex = networkNode.network.chain.length - 1;
          } else if (blockNumber.startsWith('0x')) {
            blockIndex = parseInt(blockNumber, 16);
          } else {
            blockIndex = parseInt(blockNumber);
          }
          
          const block = networkNode.network.getBlockByIndex(blockIndex);
          if (block) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              block: {
                number: block.index,
                hash: block.hash,
                timestamp: block.timestamp,
                transactions: block.transactions.length,
                previousHash: block.previousHash
              }
            }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Block not found' }));
          }
        } else {
          throw new Error('Network not available');
        }
      } catch (error) {
        console.error('Error getting block:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }

    // GET /api/transactions - Get all transactions from database
    if (pathname === '/api/transactions' && req.method === 'GET') {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const limit = parseInt(url.searchParams.get('limit')) || 1000;
        
        console.log(`📊 Fetching all transactions from database (limit: ${limit})`);
        
        const result = await pool.query(`
          SELECT 
            tx_hash, 
            from_address, 
            to_address, 
            amount, 
            timestamp, 
            block_index, 
            block_hash,
            gas_fee,
            status
          FROM transactions 
          ORDER BY timestamp DESC
          LIMIT $1
        `, [limit]);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          data: result.rows.map(row => ({
            tx_hash: row.tx_hash,
            hash: row.tx_hash,
            from_address: row.from_address,
            from: row.from_address,
            to_address: row.to_address,
            to: row.to_address,
            amount: parseFloat(row.amount || 0),
            value: parseFloat(row.amount || 0),
            timestamp: row.timestamp ? (typeof row.timestamp === 'object' ? row.timestamp.getTime() : parseInt(row.timestamp)) : Date.now(),
            block_index: row.block_index,
            blockNumber: row.block_index,
            block_hash: row.block_hash,
            blockHash: row.block_hash,
            gas_fee: parseFloat(row.gas_fee || 0.00002),
            fee: parseFloat(row.gas_fee || 0.00002),
            status: row.status || 'confirmed'
          })),
          count: result.rows.length
        }));
      } catch (error) {
        console.error('Error fetching all transactions:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: error.message,
          data: []
        }));
      }
      return;
    }

    // GET /api/nft/mints - Get NFT mints from database
    if (pathname === '/api/nft/mints' && req.method === 'GET') {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const limit = parseInt(url.searchParams.get('limit')) || 100;
        const contract = url.searchParams.get('contract');
        
        console.log(`🖼️ Fetching NFT mints from database (limit: ${limit})`);
        
        let query = `
          SELECT 
            tx_hash,
            contract_address,
            minter_address,
            recipient_address,
            token_id,
            token_uri,
            nft_name,
            nft_symbol,
            nft_image_url,
            block_number,
            block_hash,
            timestamp,
            created_at
          FROM nft_mints
        `;
        
        const params = [limit];
        
        if (contract) {
          query += ` WHERE contract_address = $2`;
          params.push(contract.toLowerCase());
        }
        
        query += ` ORDER BY timestamp DESC LIMIT $1`;
        
        const result = await pool.query(query, params);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          mints: result.rows.map(row => ({
            txHash: row.tx_hash,
            contractAddress: row.contract_address,
            minter: row.minter_address,
            recipient: row.recipient_address,
            tokenId: row.token_id,
            tokenUri: row.token_uri,
            nftName: row.nft_name,
            nftSymbol: row.nft_symbol,
            nftImage: row.nft_image_url,
            blockNumber: row.block_number,
            blockHash: row.block_hash,
            timestamp: row.timestamp ? (typeof row.timestamp === 'object' ? row.timestamp.getTime() : parseInt(row.timestamp)) : Date.now()
          })),
          count: result.rows.length
        }));
      } catch (error) {
        console.error('Error fetching NFT mints:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: error.message,
          mints: []
        }));
      }
      return;
    }

    // GET /api/network/transactions/recent - Get recent transactions with statistics
    if (pathname === '/api/network/transactions/recent' && req.method === 'GET') {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const limit = parseInt(url.searchParams.get('limit')) || 10000;
        
        console.log(`📊 Fetching recent transactions for statistics (limit: ${limit})`);
        
        const result = await pool.query(`
          SELECT 
            tx_hash, 
            from_address, 
            to_address, 
            amount, 
            timestamp, 
            block_index, 
            block_hash,
            gas_fee,
            status
          FROM transactions 
          ORDER BY timestamp DESC
          LIMIT $1
        `, [limit]);

        const transactions = result.rows.map(row => ({
          hash: row.tx_hash,
          from: row.from_address,
          to: row.to_address,
          amount: parseFloat(row.amount || 0),
          value: parseFloat(row.amount || 0),
          timestamp: row.timestamp ? (typeof row.timestamp === 'object' ? row.timestamp.getTime() : parseInt(row.timestamp)) : Date.now(),
          blockNumber: row.block_index,
          blockHash: row.block_hash,
          gasFee: parseFloat(row.gas_fee || 0.00002),
          status: row.status || 'confirmed'
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          transactions: transactions,
          count: transactions.length
        }));
      } catch (error) {
        console.error('Error fetching recent transactions:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: error.message,
          transactions: []
        }));
      }
      return;
    }

    // GET /api/network/transaction/:hash - Get transaction by hash
    if (pathname.startsWith('/api/network/transaction/') && req.method === 'GET') {
      try {
        const hash = pathname.split('/').pop();
        console.log(`🔍 Looking for transaction: ${hash}`);
        
        const { getNetworkNode } = await import('./network-api.js');
        const networkNode = getNetworkNode();
        
        if (networkNode && networkNode.network) {
          let transaction = null;
          
          // Check pending transactions first
          const pending = networkNode.network.pendingTransactions || [];
          transaction = pending.find(tx => tx.hash === hash);
          
          // If not found in pending, check all blocks
          if (!transaction && networkNode.network.chain) {
            for (let i = networkNode.network.chain.length - 1; i >= 0; i--) {
              const block = networkNode.network.chain[i];
              if (block.transactions) {
                transaction = block.transactions.find(tx => tx.hash === hash);
                if (transaction) {
                  transaction.blockNumber = block.index;
                  transaction.blockHash = block.hash;
                  transaction.confirmations = networkNode.network.chain.length - block.index;
                  break;
                }
              }
            }
          }
          
          if (transaction) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              data: transaction
            }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: 'Transaction not found'
            }));
          }
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Transaction not found'
          }));
          return;
        }
      } catch (error) {
        console.error('❌ Transaction API error:', error);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Transaction not found'
        }));
      }
      return;
    }

    // GET /api/network/mempool - Get pending transactions
    if (pathname === '/api/network/mempool' && req.method === 'GET') {
      try {
        const { getNetworkNode } = await import('./network-api.js');
        const networkNode = getNetworkNode();
        
        if (networkNode && networkNode.network) {
          const pending = networkNode.network.pendingTransactions || [];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            pendingCount: pending.length,
            transactions: pending.map(tx => ({
              amount: tx.amount,
              fromAddress: tx.fromAddress?.substring(0, 10) + '...',
              toAddress: tx.toAddress?.substring(0, 10) + '...',
              timestamp: tx.timestamp
            }))
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            pendingCount: 0,
            transactions: []
          }));
          return;
        }
      } catch (error) {
        console.error('Error getting mempool:', error);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          pendingCount: 0,
          transactions: []
        }));
      }
      return;
    }

    // POST /api/network/mine - Mine a new block
    if (pathname === '/api/network/mine' && req.method === 'POST') {
      try {
        const { processorAddress } = await parseRequestBody(req);
        const { getNetworkNode } = await import('./network-api.js');
        const networkNode = getNetworkNode();
        
        if (networkNode && networkNode.network) {
          if (!processorAddress) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Processor address required' }));
            return;
          }
          
          const block = networkNode.network.minePendingTransactions(processorAddress);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            blockNumber: block.index,
            blockHash: block.hash,
            reward: networkNode.network.processingReward,
            transactionsProcessed: block.transactions.length
          }));
        } else {
          throw new Error('Network not available');
        }
      } catch (error) {
        console.error('Error processing block:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }

    // POST /api/network/send-external - Send to external networks (ready for future integration)
    if (pathname === '/api/network/send-external' && req.method === 'POST') {
      try {
        const { to, amount, network, fromAddress, privateKey } = await parseRequestBody(req);
        
        // Validate required fields
        if (!to || !amount || !network || !fromAddress) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Missing required parameters: to, amount, network, fromAddress'
          }));
          return;
        }

        // For now, only support Access network
        if (network !== 'access') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Only Access network is currently supported. ETH, BNB, SOL coming soon.',
            supportedNetworks: ['access'],
            comingSoon: ['eth', 'bnb', 'sol', 'polygon', 'avalanche']
          }));
          return;
        }

        // Process Access network transaction through blockchain
        const { getNetworkNode } = await import('./network-api.js');
        const networkNode = getNetworkNode();
        
        if (!networkNode) {
          throw new Error('Network not available');
        }

        // Create transaction on real blockchain
        const transaction = {
          fromAddress: fromAddress,
          toAddress: to,
          amount: parseFloat(amount),
          timestamp: Date.now(),
          network: 'access'
        };

        // Add to blockchain pending transactions
        const txHash = networkNode.network.addTransaction(transaction);
        
        // Also record in database for backwards compatibility
        await pool.query(
          `INSERT INTO transactions 
          (sender, recipient, sender_address, recipient_address, amount, timestamp, hash, description, gas_fee, status) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [null, null, fromAddress, to, amount, Date.now(), txHash, `External send to ${network}`, 0.00002, 'pending']
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          transactionHash: txHash,
          network: network,
          message: 'Transaction added to blockchain network',
          explorer: `${req.headers.host}/blockchain-explorer/tx/${txHash}`
        }));

      } catch (error) {
        console.error('Error sending external transaction:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
      }
      return;
    }

    // GET /api/network/supported-networks - Get supported networks for external sending
    if (pathname === '/api/network/supported-networks' && req.method === 'GET') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          networks: {
            active: [
              {
                id: 'access',
                name: 'Access Network',
                symbol: 'ACCESS',
                rpcUrl: '/rpc',
                gasPrice: '0.00002',
                chainId: 'access-mainnet-1',
                explorerUrl: `${req.headers.host}/blockchain-explorer`,
                status: 'active'
              }
            ],
            comingSoon: [
              {
                id: 'eth',
                name: 'Ethereum',
                symbol: 'ETH',
                status: 'development'
              },
              {
                id: 'bnb',
                name: 'Binance Smart Chain',
                symbol: 'BNB',
                status: 'planned'
              },
              {
                id: 'sol',
                name: 'Solana',
                symbol: 'SOL',
                status: 'planned'
              },
              {
                id: 'polygon',
                name: 'Polygon',
                symbol: 'MATIC',
                status: 'planned'
              }
            ]
          }
        }));
      } catch (error) {
        console.error('Error getting supported networks:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Server error' }));
      }
      return;
    }

    // GET /api/server/time - Simple endpoint to get server time in both formats
    if (pathname === '/api/server/time' && req.method === 'GET') {
      try {
        const nowMs = Date.now();
        const nowSec = Math.floor(nowMs / 1000);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          time: nowMs,             // Milliseconds 
          time_seconds: nowSec,    // Seconds
          formatted: new Date(nowMs).toISOString(),
          timestamp_ms: nowMs,     // Explicit milliseconds
          timestamp_seconds: nowSec // Explicit seconds
        }));
      } catch (error) {
        console.error('Error serving server time:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Server error' }));
      }
      return;
    }

    // GET /api/explorer/status - Explorer API status and documentation
    if (pathname === '/api/explorer/status' && req.method === 'GET') {
      try {
        const isAvailable = explorerAPI !== null;
        const networkNode = getNetworkNode();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: isAvailable ? '1' : '0',
          message: isAvailable ? 'Explorer API is available' : 'Explorer API not initialized',
          explorer_api_available: isAvailable,
          blockchain_available: !!networkNode,
          supported_modules: [
            'account - Get account balance and transaction history',
            'transaction - Get transaction details and receipts',
            'block - Get block information and rewards',
            'stats - Get network statistics and token supply'
          ],
          example_urls: [
            `/api?module=account&action=balance&address=0x...`,
            `/api?module=account&action=txlist&address=0x...`,
            `/api?module=transaction&action=gettxreceiptstatus&txhash=0x...`,
            `/api?module=stats&action=tokensupply`
          ],
          network_info: networkNode ? {
            chain_length: networkNode.network.chain.length,
            pending_transactions: networkNode.network.pendingTransactions.length
          } : null
        }));
      } catch (error) {
        console.error('Error getting explorer status:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: '0',
          message: 'Error getting explorer status: ' + error.message
        }));
      }
      return;
    }

    // POST /api/processing/cleanup - Clean up stale processing sessions
    if (pathname === '/api/processing/cleanup' && req.method === 'POST') {
      try {
        const { userId } = await parseRequestBody(req);
        
        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Missing userId parameter' 
          }));
          return;
        }
        
        console.log(`Cleaning up processing sessions for user ${userId}`);
        
        // Get a client from the pool
        const client = await pool.connect();
        
        try {
          // Start a transaction for consistency
          await client.query('BEGIN');
          
          // First, reset any active processing session for this user
          await client.query(
            'UPDATE processing_sessions SET is_active = FALSE, remaining = 0 WHERE user_id = $1',
            [userId]
          );
          
          // Then, reset any active processing flags in the users table
          await client.query(
            'UPDATE users SET processing_active = 0, processingactive = 0, is_active = 0, processing_remaining_seconds = 0 WHERE id = $1',
            [userId]
          );
          
          // Commit the transaction
          await client.query('COMMIT');
          
          console.log(`Successfully cleaned up processing sessions for user ${userId}`);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            message: 'Processing sessions cleaned up successfully',
            userId: userId
          }));
        } catch (error) {
          // Rollback on error
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        console.error('Error cleaning up processing sessions:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error processing processing cleanup',
          details: error.message
        }));
      }
      return;
    }

    

    // Enhanced transaction record API - دعم حقيقي للمحافظ الخارجية مع منع التكرار وتوحيد العناوين
    if (pathname === '/api/transaction/record' && req.method === 'POST') {
      try {
        const data = await parseRequestBody(req);
        let { 
          sender, 
          recipient, 
          senderAddress, 
          recipientAddress, 
          amount, 
          timestamp, 
          hash,
          description,
          input,
          isExternalRecipient = false,
          isExternalSender = false
        } = data;

        // توحيد العناوين فوراً لمنع التصادم
        if (senderAddress && typeof senderAddress === 'string') {
          senderAddress = senderAddress.toLowerCase();
        }
        if (recipientAddress && typeof recipientAddress === 'string') {
          recipientAddress = recipientAddress.toLowerCase();
        }

        // ⭐ إنشاء hash على server-side إذا لم يُرسل من client (منع التكرار)
        if (!hash) {
          const nonce = Math.floor(Math.random() * 1000000);
          const hashData = `${senderAddress || sender}-${recipientAddress || recipient}-${amount}-${timestamp || Date.now()}-${nonce}`;
          hash = crypto.createHash('sha256').update(hashData).digest('hex');
          // Silent - reduce console spam
        } else {
          // Silent - reduce console spam
        }

        // التحقق من تكرار المعاملة أولاً لمنع المعالجة المتكررة
        if (hash) {
          const existingTransaction = await pool.query(
            'SELECT id FROM transactions WHERE hash = $1',
            [hash]
          );

          if (existingTransaction.rows.length > 0) {
            // Silent - reduce console spam
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false, 
              error: 'Transaction already processed',
              transactionHash: hash,
              duplicate: true
            }));
            return;
          }
        }

        // التحقق الأساسي من الحقول المطلوبة
        if ((!sender && !senderAddress) || (!recipient && !recipientAddress) || !amount) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Missing required transaction parameters' 
          }));
          return;
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Invalid amount' 
          }));
          return;
        }

        const gasFee = 0.00002;

        // تحسين تحديد المحافظ الخارجية مع التحقق من العنوان الموحد
        const realExternalRecipient = recipientAddress && 
          recipientAddress.startsWith('0x') && 
          recipientAddress.length === 42 && 
          (!recipient || recipient === null || recipient === undefined || recipient === 'undefined');

        const realExternalSender = senderAddress && 
          senderAddress.startsWith('0x') && 
          senderAddress.length === 42 && 
          (!sender || sender === null || sender === undefined || sender === 'undefined');

        // للمحافظ الخارجية: التحقق من الوجود مع العنوان الموحد - لا ننشئ عناوين جديدة
        let isRegisteredExternalWallet = false;
        if (realExternalRecipient) {
          try {
            // البحث باستخدام العنوان الموحد (أحرف صغيرة)
            const externalCheck = await pool.query(
              'SELECT address FROM external_wallets WHERE LOWER(address) = $1',
              [recipientAddress.toLowerCase()]
            );
            isRegisteredExternalWallet = externalCheck.rows.length > 0;
            
            // إذا لم تكن المحفظة مسجلة، لا ننشئها - فقط نمرر المعاملة
            if (!isRegisteredExternalWallet) {
              // Silent - reduce console spam
              // لا ننشئ المحفظة تلقائياً - نتركها للنظام الذي يدير المحافظ
            } else {
              // Silent - reduce console spam
            }
          } catch (extError) {
            console.error('Error checking external wallet:', extError);
            // نتابع المعاملة حتى لو فشل التحقق
          }
        }

        // تحديد نوع المعاملة
        const isExternalTransaction = realExternalSender || realExternalRecipient;
        const isMixedTransaction = (sender && realExternalRecipient) || (recipient && realExternalSender);

        let senderData = null;
        let recipientData = null;
        let senderName = 'External Wallet';
        let recipientName = 'External Wallet';

        // جلب بيانات المرسل (إذا كان محلي)
        if (sender) {
          const senderDataResult = await pool.query(
            'SELECT id, name, coins FROM users WHERE id = $1',
            [sender]
          );
          
          if (senderDataResult.rows.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false, 
              error: 'Sender not found'
            }));
            return;
          }
          
          senderData = senderDataResult.rows[0];
          senderName = senderData.name || `User ${sender}`;
        }

        // جلب بيانات المستقبل (إذا كان محلي)
        if (recipient && recipient !== null && recipient !== undefined && recipient !== 'undefined') {
          const recipientDataResult = await pool.query(
            'SELECT id, name, coins FROM users WHERE id = $1',
            [recipient]
          );
          
          if (recipientDataResult.rows.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false, 
              error: 'Recipient not found'
            }));
            return;
          }
          
          recipientData = recipientDataResult.rows[0];
          recipientName = recipientData.name || `User ${recipient}`;
        }

        // للمحافظ الخارجية، تحديد الأسماء من العناوين
        if (realExternalSender && senderAddress) {
          senderName = `External (${senderAddress.substring(0, 8)}...${senderAddress.substring(senderAddress.length - 6)})`;
        }
        
        if (realExternalRecipient && recipientAddress) {
          recipientName = `External (${recipientAddress.substring(0, 8)}...${recipientAddress.substring(recipientAddress.length - 6)})`;
        }

        const senderBalanceOld = senderData ? parseFloat(senderData.coins || 0) : 0;
        const recipientBalanceOld = recipientData ? parseFloat(recipientData.coins || 0) : 0;

        // تحديد نوع المعاملة للسجل
        let transactionType = 'Local';
        if (isExternalTransaction || isMixedTransaction) {
          transactionType = realExternalSender && realExternalRecipient ? 'External' : 'Mixed';
        }

        // Silent - reduce console spam
        
        // التأكد من أن sender و recipient يمكن أن يكونا null للمحافظ الخارجية
        const safeSender = (sender && sender !== 'undefined' && sender !== undefined) ? sender : null;
        const safeRecipient = (recipient && recipient !== 'undefined' && recipient !== undefined) ? recipient : null;

        // التحقق من كفاية الرصيد للمرسل المحلي فقط
        if (senderData && senderBalanceOld < (numericAmount + gasFee)) {
          // Silent - reduce console spam
          
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Insufficient balance to complete transaction'
          }));
          return;
        }

        // بدء معاملة قاعدة البيانات مع حماية شاملة من التكرار
        const client = await pool.connect();
        
        try {
          await client.query('BEGIN');

          // التحقق من وجود المعاملة - تحديثها بدلاً من إنشاء مكررة
          let transactionId;
          if (hash) {
            const existingTx = await client.query(
              'SELECT id, status FROM transactions WHERE hash = $1 OR tx_hash = $1',
              [hash]
            );

            if (existingTx.rows.length > 0) {
              // المعاملة موجودة - تحديث حالتها فقط
              const updateResult = await client.query(
                `UPDATE transactions 
                SET status = $1, 
                    formatted_date = $2,
                    is_external_sender = $3,
                    is_external_recipient = $4,
                    description = COALESCE(description, $5)
                WHERE hash = $6 OR tx_hash = $6
                RETURNING id`,
                [
                  'confirmed',
                  new Date(timestamp).toISOString(),
                  realExternalSender || false,
                  realExternalRecipient || false,
                  description || `${transactionType} transaction`,
                  hash
                ]
              );
              transactionId = updateResult.rows[0].id;
              // Silent - reduce console spam
            } else {
              // معاملة جديدة - إنشاؤها
              const insertResult = await client.query(
                `INSERT INTO transactions 
                (sender, recipient, sender_address, recipient_address, amount, timestamp, hash, tx_hash, description, gas_fee, status, formatted_date, is_external_sender, is_external_recipient, input) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                RETURNING id`,
                [
                  safeSender, 
                  safeRecipient, 
                  senderAddress || null, 
                  recipientAddress || null, 
                  numericAmount, 
                  timestamp, 
                  hash,
                  hash,
                  description || `${transactionType} transaction`, 
                  gasFee,
                  'confirmed',
                  new Date(timestamp).toISOString(),
                  realExternalSender || false,
                  realExternalRecipient || false,
                  input || null
                ]
              );
              transactionId = insertResult.rows[0].id;
              // Silent - reduce console spam
            }
          }

          // تحديث الأرصدة للمحافظ المحلية والخارجية
          let recipientBalanceNew = recipientBalanceOld;
          let senderBalanceNew = senderBalanceOld;
          let externalRecipientBalanceNew = 0;

          // ✅ حساب الرصيد الجديد الصحيح قبل إرسال الإشعارات
          if (recipientData) {
            recipientBalanceNew = parseFloat((recipientBalanceOld + numericAmount).toFixed(8));
          }
          if (senderData) {
            senderBalanceNew = Math.max(0, parseFloat((senderBalanceOld - numericAmount - gasFee).toFixed(8)));
          }

          // نظام إشعارات فائق السرعة والدقة - يدعم معالجة آلاف المعاملات في الثانية
          if (wss) {
            try {
              // حزمة إشعارات شاملة للمستقبل المحلي
              if (recipient && recipient !== null && recipient !== undefined && recipient !== 'undefined') {
                const fastNotifications = [
                  // إشعار أساسي محسن
                  {
                    type: 'balance_received',
                    userId: recipient,
                    amount: numericAmount,
                    senderAddress: senderAddress,
                    transactionHash: hash,
                    timestamp: timestamp,
                    message: `تم استلام ${numericAmount.toFixed(8)} Access`,
                    messageKey: 'transaction_received',
                    messageParams: [numericAmount.toFixed(8)],
                    highSpeed: true,
                    newBalance: recipientBalanceNew
                  },
                  // إشعار تحديث الرصيد الفوري
                  {
                    type: 'instant_balance_update',
                    userId: recipient,
                    oldBalance: recipientBalanceOld,
                    newBalance: recipientBalanceNew,
                    difference: numericAmount,
                    transactionHash: hash,
                    fastUpdate: true
                  },
                  // إشعار للواجهة الأمامية
                  {
                    type: 'ui_refresh_required',
                    userId: recipient,
                    component: 'balance',
                    data: {
                      balance: recipientBalanceNew,
                      transaction: {
                        hash: hash,
                        amount: numericAmount,
                        from: senderAddress
                      }
                    }
                  },
                  // إشعار للمحافظ الخارجية - Web3 Events
                  {
                    type: 'wallet_notification',
                    walletAddress: recipientAddress,
                    balance: recipientBalanceNew,
                    transaction: {
                      hash: hash,
                      amount: numericAmount,
                      from: senderAddress,
                      to: recipientAddress
                    },
                    chainId: '0x5968',
                    networkId: '22888'
                  },
                  // إشعار خاص للمحافظ الخارجية - معاملة مستلمة
                  {
                    type: 'external_wallet_received',
                    walletAddress: recipientAddress,
                    transactionHash: hash,
                    amount: numericAmount,
                    from: senderAddress,
                    to: recipientAddress,
                    blockNumber: '0x' + Math.floor(Date.now() / 1000).toString(16),
                    blockHash: hash,
                    timestamp: timestamp,
                    chainId: '0x5968',
                    networkId: '22888',
                    // إضافة تفاصيل Web3 للمحافظ
                    web3Event: {
                      address: recipientAddress,
                      topics: [
                        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer event signature
                        '0x' + senderAddress.slice(2).padStart(64, '0'), // from address
                        '0x' + recipientAddress.slice(2).padStart(64, '0') // to address
                      ],
                      data: '0x' + Math.floor(numericAmount * 1e18).toString(16).padStart(64, '0')
                    }
                  }
                ];

                // إرسال الإشعارات فقط للمستخدم المستلم (لتجنب التكرار)
                const clientPromises = Array.from(wss.clients).map(client => {
                  return new Promise((resolve) => {
                    // فقط أرسل للمستخدم المستلم (recipient) وليس لجميع العملاء
                    if (client.readyState === 1 && client.userId && client.userId.toString() === recipient.toString()) {
                      try {
                        // إرسال جميع الإشعارات للمستلم فقط
                        fastNotifications.forEach(notification => {
                          client.send(JSON.stringify(notification));
                        });
                        console.log(`📨 Notifications sent to recipient userId: ${recipient}`);
                      } catch (clientError) {
                        console.error('خطأ في إرسال إشعار للعميل:', clientError);
                      }
                    }
                    resolve();
                  });
                });

                // انتظار إرسال جميع الإشعارات
                await Promise.all(clientPromises);

                // إرسال إشعارات Web3 متقدمة للمحافظ الخارجية
                const blockNumber = '0x' + Math.floor(Date.now() / 1000).toString(16);
                const { randomBytes } = await import('crypto');
                const blockHash = '0x' + randomBytes(32).toString('hex');
                
                const transactionData = {
                  hash: hash,
                  from: senderAddress,
                  to: recipientAddress,
                  amount: numericAmount,
                  blockNumber: blockNumber,
                  blockHash: blockHash,
                  timestamp: timestamp
                };

                // إشعارات فورية للمحافظ الخارجية (with error protection)
                try {
                  if (typeof notifyExternalWallets === 'function') {
                    await notifyExternalWallets(transactionData);
                  }
                  if (typeof broadcastTransactionLog === 'function') {
                    await broadcastTransactionLog(transactionData);
                  }
                } catch (notifyError) {
                  console.warn('External wallet notification skipped:', notifyError.message);
                }

                // إشعار خاص للمحفظة المستقبلة
                if (wss && wss.clients) {
                  const receivedNotification = {
                    type: 'external_received_transaction',
                    walletAddress: recipientAddress.toLowerCase(),
                    transactionHash: hash,
                    amount: numericAmount,
                    from: senderAddress.toLowerCase(),
                    timestamp: timestamp,
                    status: 'confirmed',
                    chainId: '0x5968',
                    networkId: '22888',
                    message: `استلمت ${numericAmount.toFixed(8)} ACCESS`,
                    showNotification: true
                  };

                  wss.clients.forEach(client => {
                    if (client.readyState === 1) {
                      client.send(JSON.stringify(receivedNotification));
                    }
                  });
                }

                // Silent - reduce console spam

                // إرسال جميع الإشعارات بالتوازي للسرعة القصوى
            Array.from(wss.clients).map(client => {
                  return new Promise((resolve) => {
                    if (client.readyState === 1) {
                      try {
                        // إرسال جميع الإشعارات دفعة واحدة
                        fastNotifications.forEach(notification => {
                          client.send(JSON.stringify(notification));
                        });
                        resolve(true);
                      } catch (wsError) {
                        console.error('خطأ في إرسال إشعار WebSocket:', wsError);
                        resolve(false);
                      }
                    } else {
                      resolve(false);
                    }
                  });
                });

                // تنفيذ جميع الإرسالات بالتوازي
                await Promise.all(clientPromises);
              }

              // إشعارات خاصة للمحافظ الخارجية (Coinbase, Trust, MetaMask)
              if (realExternalRecipient && isRegisteredExternalWallet) {
                const externalWalletNotifications = [
                  // إشعار Coinbase Wallet المحسن
                  {
                    type: 'coinbase_balance_update',
                    walletAddress: recipientAddress,
                    amount: numericAmount,
                    newBalance: externalRecipientBalanceNew,
                    transactionHash: hash,
                    chainId: '0x5968',
                    networkId: '22888',
                    forceUIRefresh: true,
                    timestamp: timestamp
                  },
                  // إشعار Trust Wallet
                  {
                    type: 'trust_wallet_update',
                    walletAddress: recipientAddress,
                    balance: externalRecipientBalanceNew,
                    transaction: {
                      hash: hash,
                      amount: numericAmount
                    }
                  },
                  // إشعار MetaMask
                  {
                    type: 'metamask_balance_change',
                    address: recipientAddress,
                    balance: '0x' + Math.floor(externalRecipientBalanceNew * 1e18).toString(16),
                    chainId: '0x5968'
                  },
                  // إشعار عام للمحافظ
                  {
                    type: 'universal_wallet_update',
                    address: recipientAddress,
                    balance: externalRecipientBalanceNew,
                    symbol: 'ACCESS',
                    decimals: 18,
                    network: 'Access Network',
                    fastSync: true
                  }
                ];

                // إرسال الإشعارات للمحافظ الخارجية بالتوازي
                const externalPromises = Array.from(wss.clients).map(client => {
                  return new Promise((resolve) => {
                    if (client.readyState === 1) {
                      try {
                        externalWalletNotifications.forEach(notification => {
                          client.send(JSON.stringify(notification));
                        });
                        resolve(true);
                      } catch (error) {
                        resolve(false);
                      }
                    } else {
                      resolve(false);
                    }
                  });
                });

                await Promise.all(externalPromises);
                // Silent - reduce console spam
              }

              // Silent - reduce console spam
            } catch (notificationError) {
              console.error('خطأ في إرسال الإشعار:', notificationError);
            }
          }

          // تحديث رصيد المستقبل مع قفل لمنع التi�ديثات المتضاربة
          if (recipientData) {
            recipientBalanceNew = parseFloat((recipientBalanceOld + numericAmount).toFixed(8));
            
            // استخدام SELECT FOR UPDATE لمنع التحديثات المتضاربة
            const lockResult = await client.query(
              'SELECT coins FROM users WHERE id = $1 FOR UPDATE',
              [recipient]
            );
            
            const currentBalance = parseFloat(lockResult.rows[0].coins || 0);
            const finalBalance = parseFloat((currentBalance + numericAmount).toFixed(8));
            
            await client.query(
              'UPDATE users SET coins = $1 WHERE id = $2',
              [finalBalance, recipient]
            );

            recipientBalanceNew = finalBalance;
            // Silent - reduce console spam
          }

          // تحديث رصيد المرسل مع قفل لمنع التحديثات المتضاربة
          if (senderData) {
            // استخدام SELECT FOR UPDATE لمنع التحديثات المتضاربة
            const lockResult = await client.query(
              'SELECT coins FROM users WHERE id = $1 FOR UPDATE',
              [sender]
            );
            
            const currentBalance = parseFloat(lockResult.rows[0].coins || 0);
            const finalBalance = Math.max(0, parseFloat((currentBalance - numericAmount - gasFee).toFixed(8)));
            
            await client.query(
              'UPDATE users SET coins = $1 WHERE id = $2',
              [finalBalance, sender]
            );

            senderBalanceNew = finalBalance;
            // Silent - reduce console spam
          }

          // للمحافظ الخارجية: استخدام network state فقط (NO CACHE)
          if (realExternalRecipient) {
            try {
              // ⚡ Network state is the only source - no permanentStorage needed
              // Silent - reduce console spam

              // البحث عن المحفظة باستخدام العنوان الموحد
              const activityResult = await client.query(
                'SELECT address, transaction_count FROM external_wallets WHERE LOWER(address) = $1',
                [recipientAddress.toLowerCase()]
              );

              if (activityResult.rows.length > 0) {
                // المحفظة موجودة - تحديث النشاط وتسجيل المعاملة الواردة
                await client.query(
                  `UPDATE external_wallets 
                   SET last_activity = $1, 
                       last_transaction = $2,
                       transaction_count = COALESCE(transaction_count, 0) + 1
                   WHERE LOWER(address) = $3`,
                  [Date.now(), hash, recipientAddress.toLowerCase()]
                );
                // ✅ Removed verbose logging for performance
              } else {
                // المحفظة غير موجودة - سيتم إنشاؤها تلقائياً في network state
                // ✅ Removed verbose Arabic logging for performance
              }

              // ✅ Removed verbose logging for performance

              // إشعار للمحافظ الخارجية (MetaMask, Trust Wallet, etc.) - حتى للمحافظ غير المسجلة
              if (wss) {
                try {
                  const externalUpdateMessage = JSON.stringify({
                    type: 'external_wallet_transaction',
                    walletAddress: recipientAddress,
                    amount: numericAmount,
                    transactionHash: hash,
                    timestamp: timestamp,
                    message: `Received ${numericAmount.toFixed(8)} ACCESS`,
                    network: 'Access Network',
                    balanceSource: 'blockchain_state' // الرصيد من حالة الشبكة
                  });

                  wss.clients.forEach(client => {
                    if (client.readyState === 1) {
                      try {
                        client.send(externalUpdateMessage);
                      } catch (wsError) {
                        console.error('خطأ في إرسال إشعار محفظة خارجية:', wsError);
                      }
                    }
                  });

                  // Silent - reduce console spam
                } catch (notificationError) {
                  console.error('خطأ في إرسال الإشعار للمحفظة الخارجية:', notificationError);
                }
              }

            } catch (externalActivityError) {
              console.error('Error handling external wallet activity:', externalActivityError);
              // المعاملة تستمر حتى لو فشلت معالجة المحفظة الخارجية
            }
          }

          // معالجة المحفظة الخارجية المرسلة أيضاً
          if (realExternalSender) {
            try {
              const senderActivityResult = await client.query(
                'SELECT address, transaction_count FROM external_wallets WHERE LOWER(address) = $1',
                [senderAddress.toLowerCase()]
              );

              if (senderActivityResult.rows.length > 0) {
                // تحديث نشاط المحفظة المرسلة
                await client.query(
                  `UPDATE external_wallets 
                   SET last_activity = $1, 
                       last_transaction = $2,
                       transaction_count = COALESCE(transaction_count, 0) + 1
                   WHERE LOWER(address) = $3`,
                  [Date.now(), hash, senderAddress.toLowerCase()]
                );
                // Silent - reduce console spam
              } else {
                // تسجيل المحفظة المرسلة تلقائياً
                try {
                  await client.query(
                    `INSERT INTO external_wallets 
                    (address, user_agent, chain_id, first_seen, last_activity, balance, is_active, transaction_count, last_transaction)
                    VALUES ($1, $2, $3, $4, $4, $5, true, 1, $6)`,
                    [senderAddress.toLowerCase(), 'Auto-registered (outgoing tx)', '0x5968', Date.now(), 0, hash]
                  );
                  // Silent - reduce console spam
                } catch (regError) {
                  // Silent - reduce console spam
                }
              }
            } catch (senderError) {
              console.error('Error handling external sender wallet:', senderError);
            }
          }

          // ⭐ إضافة جميع المعاملات إلى الشبكة (داخلية وخارجية ومختلطة) - مثل Ethereum/BSC
          // هذا يضمن أن جميع المعاملات تظهر في المستكشف وتُسجل في البلوكتشين
          try {
            const { getNetworkNode } = await import('./network-api.js');
            const networkNode = getNetworkNode();
            
            if (networkNode && networkNode.network) {
              // ⚡ تحديث network state بأرصدة المستخدمين الداخليين
              if (senderData && senderAddress) {
                const internalSenderBalance = parseFloat(senderBalanceNew || 0);
                networkNode.network.updateBalance(senderAddress, internalSenderBalance);
                // Silent - reduce console spam
              }
              
              if (recipientData && recipientAddress) {
                const internalRecipientBalance = parseFloat(recipientBalanceNew || 0);
                networkNode.network.updateBalance(recipientAddress, internalRecipientBalance);
                // Silent - reduce console spam
              }
              
              // ❌ REMOVED: تحديث رصيد المحافظ الخارجية - يتم بالفعل في processTransactionImmediately
              // هذا الكود كان يسبب إضافة الرصيد مرتين للمستقبل!
              // if (realExternalRecipient && recipientAddress && !recipientData) {
              //   const currentBalance = networkNode.network.getBalance(recipientAddress) || 0;
              //   const newExternalBalance = parseFloat(currentBalance) + parseFloat(numericAmount);
              //   networkNode.network.updateBalance(recipientAddress, newExternalBalance);
              // }
              
              // إنشاء معاملة الشبكة
              const { Transaction } = await import('./network-system.js');
              
              // تحديد المرسل الفعلي
              const effectiveSender = senderAddress || null;
              const effectiveRecipient = recipientAddress || null;
              
              const networkTx = new Transaction(
                effectiveSender,
                effectiveRecipient,
                numericAmount,
                gasFee,
                timestamp
              );
              
              // ⭐ CRITICAL: تعيين الـ hash الموجود من قاعدة البيانات لمنع إنشاء hash جديد
              networkTx.hash = hash;
              networkTx.txId = hash;
              networkTx.transactionHash = hash;
              networkTx.id = hash;
              
              // تعيين معلومات إضافية
              networkTx.isExternalSender = realExternalSender || false;
              networkTx.isExternalRecipient = realExternalRecipient || false;
              networkTx.isLocalTransaction = !isExternalTransaction && !isMixedTransaction;
              networkTx.mixedTransaction = isMixedTransaction || false;
              networkTx.rpcValidated = true;
              
              // إضافة للشبكة (سيستخدم الـ hash الموجود بدلاً من إنشاء واحد جديد)
              const txHash = networkNode.network.addTransaction(networkTx);
              // Silent - reduce console spam
              
              // REMOVED: updateExternalWalletBalances - Using State Trie only like Ethereum
            }
          } catch (networkError) {
            console.error('🚫 Network integration error:', networkError);
            // المتابعة بدون الشبكة
          }

          // Silent - reduce console spam (Transaction Results)

          await client.query('COMMIT');

          // Silent - reduce console spam

          // 📱 إرسال Web Push Notification للمستلم (مثل YouTube)
          try {
            const transactionDataForPush = {
              hash: hash,
              from: senderAddress,
              to: recipientAddress,
              amount: numericAmount,
              blockNumber: '0x' + Math.floor(Date.now() / 1000).toString(16),
              blockHash: '0x' + crypto.randomBytes(32).toString('hex'),
              timestamp: timestamp
            };
            
            await global.sendWebPushNotificationToRecipient(transactionDataForPush);
            // Silent - reduce console spam
          } catch (pushError) {
            console.warn('Web Push notification failed (non-critical):', pushError.message);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            message: 'Transaction recorded successfully',
            transaction_hash: hash,
            amount: numericAmount,
            gas_fee: gasFee,
            total_deducted: numericAmount + gasFee,
            sender_balance_old: senderBalanceOld,
            sender_balance_new: senderBalanceNew,
            recipient_balance_old: recipientBalanceOld,
            recipient_balance_new: recipientBalanceNew,
            timestamp: timestamp
          }));

        } catch (err) {
          await client.query('ROLLBACK');
          console.error('خطأ في قاعدة البيانات أثناء معالجة المعاملة:', err);
          throw err;
        } finally {
          client.release();
          
          // تفعيل فترة هدوء في نظام التعدين بعد المعاملة لتجنب التضارب
          try {
            const { serverSideProcessingSync } = await import('./server_side_activity_sync.js');
            serverSideProcessingSync.startTransactionCooldown();
          } catch (cooldownError) {
            console.warn('Could not start transaction cooldown:', cooldownError.message);
          }
        }
      } catch (error) {
        console.error('خطأ في تسجيل المعاملة:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error while processing transaction'
        }));
      }
      return;
    }

    // New endpoint: Get all transactions for a user (across all their wallets)
    if (pathname.match(/^\/api\/user\/[^\/]+\/transactions$/) && req.method === 'GET') {
      try {
        const userIdOrEmail = pathname.split('/')[3];
        console.log(`Fetching transactions for user ID or email: ${userIdOrEmail}`);

        let userIdNumber;

        // Check if userId is numeric
        if (/^\d+$/.test(userIdOrEmail)) {
          userIdNumber = parseInt(userIdOrEmail);
        } else {
          // If not numeric, try to look up user by email
          const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [userIdOrEmail]);
          if (userResult.rows.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false, 
              error: 'User not found' 
            }));
            return;
          }
          userIdNumber = userResult.rows[0].id;
        }

        // Get all transactions for this user from the database
        const transactionsResult = await pool.query(
          `SELECT t.*, 
                 CASE WHEN t.sender = $1 THEN 'outgoing' 
                      WHEN t.recipient = $1 THEN 'incoming' 
                      ELSE 'unknown' END as direction
           FROM transactions t
           WHERE t.sender = $1::text OR t.recipient = $1::text OR t.sender = $2::integer OR t.recipient = $2::integer
           ORDER BY t.timestamp DESC`,
          [userIdNumber.toString(), userIdNumber]
        );

        // Convert numeric amounts to proper numbers
        const transactions = transactionsResult.rows.map(tx => ({
          ...tx,
          amount: parseFloat(tx.amount),
          gas_fee: parseFloat(tx.gas_fee || 0),
          timestamp: parseInt(tx.timestamp),
          hash: tx.hash,
          from: tx.sender_address,
          to: tx.recipient_address,
          date: new Date(parseInt(tx.timestamp)).toISOString(),
          is_outgoing: tx.direction === 'outgoing',
          sender_id: tx.sender,
          recipient_id: tx.recipient,
          sender_address: tx.sender_address, 
          recipient_address: tx.recipient_address
        }));

        console.log(`Retrieved ${transactions.length} transactions for user ${userIdNumber}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          transactions: transactions
        }));
      } catch (error) {
        console.error('Error getting user transactions:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Server error retrieving user transactions' 
        }));
      }
      return;
    }

    // PUT /api/users/:userId/lastpayout - Update last payout time
    if (pathname.match(/^\/api\/users\/\d+\/lastpayout$/) && req.method === 'PUT') {
      try {
        const userId = parseInt(pathname.split('/')[3]);
        const data = await parseRequestBody(req);
        const timestamp = Date.now();

        await pool.query(
          'UPDATE users SET last_payout = $1, processing_active = 0::integer, processing_start_time = NULL WHERE id = $2',
          [timestamp, userId]
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      } catch (error) {
        console.error('Database error in /api/users/:userId/lastpayout:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
        return;
      }
    }


    // POST /api/processing/payout - Process processing payout
    if (pathname === '/api/processing/payout' && req.method === 'POST') {
      try {
        const { userId } = await parseRequestBody(req);
        const timestamp = Date.now();

        await pool.query(
          'UPDATE users SET processing_active = 0::integer, processing_start_time = NULL, last_payout = $1 WHERE id = $2',
          [timestamp, userId]
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, timestamp }));
        return;
      } catch (error) {
        console.error('Database error in /api/processing/payout:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // POST /api/activity/sync-final-accumulated - 🚀 Lightweight endpoint to sync final accumulated value at session end
    if (pathname === '/api/activity/sync-final-accumulated' && req.method === 'POST') {
      try {
        const { userId, finalAccumulated } = await parseRequestBody(req);
        
        if (!userId || finalAccumulated === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false }));
          return;
        }
        
        // 🛡️ الحصول على session_locked_boost للتحقق من القيمة الصحيحة
        const userResult = await pool.query(
          `SELECT processing_start_time_seconds, session_locked_boost FROM users WHERE id = $1`,
          [userId]
        );
        
        const clientRewardValue = parseFloat(finalAccumulated);
        let rewardValue = clientRewardValue;
        
        // 🛡️ إذا كان هناك session_locked_boost، تحقق من أن المكافأة صحيحة
        if (userResult.rows.length > 0) {
          const sessionLockedBoost = parseFloat(userResult.rows[0].session_locked_boost) || 1.0;
          const startTimeSec = parseInt(userResult.rows[0].processing_start_time_seconds) || 0;
          
          if (startTimeSec > 0 && sessionLockedBoost > 1.0) {
            // حساب المكافأة الصحيحة من السيرفر
            const nowSec = Math.floor(Date.now() / 1000);
            const processingDuration = 24 * 60 * 60;
            const elapsedSec = nowSec - startTimeSec;
            const baseReward = 0.25;
            const boostedReward = baseReward * sessionLockedBoost;
            const rewardProgress = Math.min(1, Math.max(0, elapsedSec / processingDuration));
            const serverCalculatedReward = Math.round((boostedReward * rewardProgress) * 100000000) / 100000000;
            
            // استخدم القيمة الأعلى (من العميل أو السيرفر)
            rewardValue = Math.max(clientRewardValue, serverCalculatedReward);
            
            if (serverCalculatedReward > clientRewardValue) {
              console.log(`🛡️ [BOOST PROTECTION] User ${userId}: Client sent ${clientRewardValue.toFixed(8)}, server calculated ${serverCalculatedReward.toFixed(8)} (boost: ${sessionLockedBoost.toFixed(2)}x)`);
            }
          }
        }
        
        // ✅ تحديث القيمة النهائية + إيقاف الجلسة + تنظيف "Collecting..."
        await pool.query(
          `UPDATE users 
           SET processing_active = 0,
               processing_accumulated = GREATEST(COALESCE(processing_accumulated, 0), $1),
               accumulatedReward = GREATEST(COALESCE(accumulatedReward, 0), $1),
               completed_processing_reward = GREATEST(COALESCE(completed_processing_reward, 0), $1)
           WHERE id = $2`,
          [rewardValue, userId]
        );
        
        // ✅ تنظيف "Collecting..." من التاريخ
        pool.query(
          `DELETE FROM processing_history 
           WHERE user_id = $1 AND (user_name = 'Collecting...' OR user_name LIKE '%Collecting%')`,
          [userId]
        ).catch(() => {}); // Silent fail
        
        console.log(`✅ Final accumulated synced for user ${userId}: ${rewardValue.toFixed(8)} ACCESS - session ended`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, saved: rewardValue }));
        return;
      } catch (error) {
        console.error('Error syncing final accumulated:', error);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false }));
        return;
      }
    }

    // ✅ POST /api/activity/sync-accumulated - 🚀 Lightweight periodic sync of accumulated value
    // يُستدعى كل 5 دقائق لحفظ الرصيد المتراكم تحسباً لإغلاق الصفحة المفاجئ
    if (pathname === '/api/activity/sync-accumulated' && req.method === 'POST') {
      try {
        const { userId, accumulated } = await parseRequestBody(req);
        
        if (!userId || accumulated === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false }));
          return;
        }
        
        // 🛡️ حساب المكافأة الصحيحة من السيرفر (مع الإحالات والـ boost)
        const userResult = await pool.query(
          `SELECT processing_start_time_seconds, session_locked_boost FROM users WHERE id = $1 AND processing_active = 1`,
          [userId]
        );
        
        const clientAccumulatedValue = parseFloat(accumulated);
        let accumulatedValue = clientAccumulatedValue;
        
        // 🛡️ إذا كان هناك session_locked_boost، احسب القيمة الصحيحة
        if (userResult.rows.length > 0) {
          const sessionLockedBoost = parseFloat(userResult.rows[0].session_locked_boost) || 1.0;
          const startTimeSec = parseInt(userResult.rows[0].processing_start_time_seconds) || 0;
          
          if (startTimeSec > 0) {
            const nowSec = Math.floor(Date.now() / 1000);
            const processingDuration = 24 * 60 * 60;
            const elapsedSec = nowSec - startTimeSec;
            const baseReward = 0.25;
            const boostedReward = baseReward * sessionLockedBoost;
            const rewardProgress = Math.min(1, Math.max(0, elapsedSec / processingDuration));
            const serverCalculatedReward = Math.round((boostedReward * rewardProgress) * 100000000) / 100000000;
            
            // استخدم القيمة الأعلى
            accumulatedValue = Math.max(clientAccumulatedValue, serverCalculatedReward);
          }
        }
        
        // تحديث الرصيد المتراكم فقط إذا كان أكبر من القيمة المحفوظة
        await pool.query(
          `UPDATE users 
           SET accumulatedReward = GREATEST(COALESCE(accumulatedReward, 0), $1),
               processing_accumulated = GREATEST(COALESCE(processing_accumulated, 0), $1)
           WHERE id = $2 AND processing_active = 1`,
          [accumulatedValue, userId]
        );
        
        // Silent - لا نريد spam في الـ console
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      } catch (error) {
        // Silent fail
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false }));
        return;
      }
    }

    // POST /api/processing/accumulate - Update accumulated processing reward
    if (pathname === '/api/processing/accumulate' && req.method === 'POST') {
      try {
        const { userId, amount } = await parseRequestBody(req);
        
        if (!userId || amount === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Missing userId or amount' 
          }));
          return;
        }
        
        // Update accumulated reward
        const result = await updateAccumulatedReward(userId, parseFloat(amount));
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      } catch (error) {
        console.error('Error updating accumulated reward:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: error.message 
        }));
        return;
      }
    }
    
    // GET /api/processing/accumulated/:userId - SERVER-SIDE processing accumulation (works offline) with timeout protection
    if (pathname.match(/^\/api\/processing\/accumulated\/\d+$/) && req.method === 'GET') {
      try {
        const userId = parseInt(pathname.split('/')[4]);
        const nowSec = Math.floor(Date.now() / 1000);
        
        // 🚀 تحقق من الـ cache أولاً
        const cachedData = getCachedAccumulatedData(userId);
        if (cachedData) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(cachedData));
          return;
        }
        
        // Get user's processing status using server-side calculation with timeout protection
        const userResult = await Promise.race([
          pool.query(
            `SELECT processing_active, processing_start_time_seconds, accumulatedReward, processing_boost_multiplier, completed_processing_reward, ad_boost_active
             FROM users WHERE id = $1`,
            [userId]
          ),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), 15000)
          )
        ]);
        
        if (userResult.rows.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'User not found' }));
          return;
        }
        
        const user = userResult.rows[0];
        const processingActive = parseInt(user.processing_active) || 0;
        const startTimeSec = parseInt(user.processing_start_time_seconds) || 0;
        const storedAccumulated = parseFloat(user.accumulatedreward || 0);
        const storedBoostMultiplier = parseFloat(user.processing_boost_multiplier || 1.0);
        const completedReward = parseFloat(user.completed_processing_reward || 0);
        
        let serverCalculatedReward = 0;
        let activeReferralCount = 0;
        let boostMultiplier = 1.0;
        let adBoostStatus = null;
        
        // SERVER-SIDE CALCULATION: Only if processing is active
        if (processingActive === 1 && startTimeSec > 0) {
          // Count active referrals for boost with timeout protection
          const referralsResponse = await Promise.race([
            pool.query(
              `SELECT r.id, u.processing_active, u.processing_end_time, u.is_active 
               FROM referrals r
               JOIN users u ON r.referee_id = u.id
               WHERE r.referrer_id = $1
               LIMIT 10`, // Limit results to prevent timeout
              [userId]
            ),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Referrals query timeout')), 10000)
            )
          ]).catch(() => ({ rows: [] })); // Return empty on timeout
          
          const nowMs = nowSec * 1000;
          referralsResponse.rows.forEach(ref => {
            const refProcessingActive = parseInt(ref.processing_active) || 0;
            const refIsActive = parseInt(ref.is_active) || 0;
            const refEndTime = parseInt(ref.processing_end_time) || 0;
            const isActivelyProcessing = (refProcessingActive === 1 || refIsActive === 1 || (refEndTime > nowMs));
            
            if (isActivelyProcessing) {
              activeReferralCount++;
            }
          });
          
          // Get user's ad boost status and calculate boost multiplier
          const { computeHashrateMultiplier, getAdBoostStatus } = await import('./db.js');
          adBoostStatus = await getAdBoostStatus(userId);
          const hashrateCalc = computeHashrateMultiplier(activeReferralCount, adBoostStatus.boostActive);
          boostMultiplier = hashrateCalc.multiplier;
          
          // Calculate reward based on elapsed time (SERVER-SIDE ONLY)
          const processingDuration = 24 * 60 * 60; // 24 hours in seconds
          const elapsedSec = nowSec - startTimeSec;
          const baseReward = 0.25;
          const boostedReward = baseReward * boostMultiplier;
          
          // ✅ FIX: حساب المكافأة بناءً على الوقت المنقضي
          if (elapsedSec >= processingDuration) {
            serverCalculatedReward = boostedReward;
          } else {
            const progressPercentage = elapsedSec / processingDuration;
            // تقريب المكافأة لتجنب الأرقام العشرية الطويلة
            serverCalculatedReward = Math.round((boostedReward * progressPercentage) * 100000000) / 100000000;
          }
          
          // ✅ FIX: تصحيح المبلغ في قاعدة البيانات إذا كان ناقصاً
          // إذا كانت القيمة المحسوبة أكبر من المحفوظة، نحدث قاعدة البيانات
          if (serverCalculatedReward > storedAccumulated) {
            pool.query(
              `UPDATE users 
               SET accumulatedReward = $1,
                   processing_accumulated = $1
               WHERE id = $2`,
              [serverCalculatedReward, userId]
            ).catch(() => {}); // Silent update
          }
          
          
        } else {
          // Not actively processing - check if there's a completed reward to display
          if (completedReward > 0) {
            serverCalculatedReward = completedReward;
          } else {
            serverCalculatedReward = storedAccumulated;
          }
          boostMultiplier = storedBoostMultiplier;
        }
        
        // 🚀 تجميع البيانات للـ response والـ cache
        const responseData = {
          success: true,
          accumulatedReward: serverCalculatedReward,
          completedReward: completedReward,
          activeReferrals: activeReferralCount,
          hashrate: parseFloat((boostMultiplier * 10).toFixed(1)), // Use computed multiplier
          boostedReward: parseFloat((0.25 * boostMultiplier).toFixed(8)),
          hasBoost: activeReferralCount > 0 || (processingActive === 1 && adBoostStatus?.boostActive),
          adBoostActive: processingActive === 1 && (adBoostStatus?.boostActive || user.ad_boost_active || false), // EXPLICIT ad boost status
          processingActive: processingActive === 1,
          serverCalculated: true, // Flag to indicate this is server-calculated
          lastServerUpdate: nowSec
        };
        
        // 🚀 حفظ في الـ cache
        setCachedAccumulatedData(userId, responseData);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responseData));
        return;
      } catch (error) {
        // ✅ SILENT: Hide timeout errors (non-critical, client calculates locally)
        if (error.message && (error.message.includes('timeout') || error.message.includes('canceling'))) {
          // Return cached data or default values silently
          const cachedData = getCachedAccumulatedData(userId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(cachedData || {
            success: true,
            accumulatedReward: 0,
            processingActive: true,
            serverCalculated: false
          }));
          return;
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false }));
        return;
      }
    }

    // POST /api/processing/history/cleanup-collecting - Clean up collecting entries
    if (pathname === '/api/processing/history/cleanup-collecting' && req.method === 'POST') {
      try {
        const { userId } = await parseRequestBody(req);
        
        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing userId' }));
          return;
        }

        // Remove all "Collecting..." entries from processing history
        const cleanupResult = await pool.query(
          `DELETE FROM processing_history 
           WHERE user_id = $1 
           AND (user_name = 'Collecting...' OR user_name LIKE '%Collecting%')`,
          [userId]
        );

        console.log(`Cleaned up ${cleanupResult.rowCount} collecting entries for user ${userId}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          removedEntries: cleanupResult.rowCount,
          message: 'Collecting entries cleaned up successfully'
        }));
        return;
      } catch (error) {
        console.error('Error cleaning up collecting entries:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // POST /api/processing/save-completed - Save completed processing reward WITHOUT transferring to balance
    if (pathname === '/api/processing/save-completed' && req.method === 'POST') {
      try {
        const { userId, completedReward } = await parseRequestBody(req);
        
        if (!userId || completedReward === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing userId or completedReward' }));
          return;
        }

        const rewardAmount = parseFloat(completedReward);
        
        // Save completed reward in database WITHOUT transferring to balance
        // Also clean up "Collecting..." entries from history
        // ✅ FIX: تصفير processing_end_time و processing_start_time_seconds للسماح ببدء جلسة جديدة
        await pool.query('BEGIN');
        
        try {
          await pool.query(
            `UPDATE users SET 
             processing_active = 0,
             processing_end_time = 0,
             processing_start_time_seconds = 0,
             processing_start_time = NULL,
             completed_processing_reward = $1::numeric(10,8),
             accumulatedReward = $1::numeric(10,8)
             WHERE id = $2`,
            [rewardAmount, userId]
          );

          // Clean up "Collecting..." entries
          await pool.query(
            `DELETE FROM processing_history 
             WHERE user_id = $1 AND (user_name = 'Collecting...' OR user_name LIKE '%Collecting%')`,
            [userId]
          );

          await pool.query('COMMIT');
          
          // Silent - reduce console spam
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            completedReward: rewardAmount,
            message: 'Completed reward saved. Will transfer when user starts new activity.'
          }));
          return;
        } catch (error) {
          await pool.query('ROLLBACK');
          throw error;
        }
      } catch (error) {
        console.error('Error saving completed processing reward:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // POST /api/processing/countdown/complete - Complete processing countdown and transfer rewards
    if (pathname === '/api/processing/countdown/complete' && req.method === 'POST') {
      try {
        const { userId, amount } = await parseRequestBody(req);
        
        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing userId' }));
          return;
        }

        // Import the completeProcessing function
        const { completeProcessing } = await import('./db.js');
        
        // Complete processing and transfer accumulated reward to permanent balance
        const result = await completeProcessing(userId, amount);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      } catch (error) {
        console.error('Error completing processing countdown:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // GET /api/processing/countdown/status - Get processing countdown status
    if (pathname === '/api/processing/countdown/status' && req.method === 'GET') {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const userId = url.searchParams.get('userId');
        
        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing userId' }));
          return;
        }

        // Get processing status from database
        const userStatus = await pool.query(
          `SELECT 
             processing_active, 
             processing_end_time,
             processing_start_time,
             processing_start_time_seconds,
             last_payout,
             COALESCE(accumulatedReward, 0) as accumulated_processing_reward
           FROM users 
           WHERE id = $1`,
          [userId]
        );

        if (!userStatus.rows[0]) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'User not found' }));
          return;
        }

        const nowMs = Date.now();
        const nowSec = Math.floor(nowMs / 1000);
        const user = userStatus.rows[0];
        
        // Use seconds-based system if available
        const startTimeSec = parseInt(user.processing_start_time_seconds) || 0;
        const processingDuration = 24 * 60 * 60; // 24 hours in seconds
        const endTimeSec = startTimeSec > 0 ? startTimeSec + processingDuration : 0;
        
        // Calculate remaining time
        const remainingSec = Math.max(0, endTimeSec - nowSec);
        const processing_active = remainingSec > 0 ? 1 : 0;
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          processing_active: processing_active,
          remaining_seconds: remainingSec,
          duration_seconds: processingDuration,
          start_time: startTimeSec,
          end_time: endTimeSec,
          current_time: nowSec,
          accumulated_reward: parseFloat(user.accumulated_processing_reward || 0),
          can_mine: processing_active === 0
        }));
        return;
      } catch (error) {
        console.error('Error getting processing countdown status:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // POST /api/processing/countdown/start - Start processing countdown
    if (pathname === '/api/processing/countdown/start' && req.method === 'POST') {
      try {
        const { userId } = await parseRequestBody(req);
        
        console.log(`🔒 [START REQUEST] User ${userId} requesting to start processing session`);
        
        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing userId' }));
          return;
        }

        const now = Math.floor(Date.now() / 1000);
        const nowMs = Date.now();
        const processingDuration = 24 * 60 * 60; // 24 hours in seconds

        // 🔒 CRITICAL: بدء transaction فوراً وقفل الصف
        await pool.query('BEGIN');
        
        try {
          // 🔒 قفل الصف ومنع أي طلب آخر من الوصول
          const checkResult = await pool.query(
            'SELECT processing_active, processing_start_time_seconds, processing_end_time FROM users WHERE id = $1 FOR UPDATE NOWAIT',
            [userId]
          );

          if (checkResult.rows.length === 0) {
            await pool.query('ROLLBACK');
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'User not found' }));
            return;
          }
          
          const user = checkResult.rows[0];
          const endTimeMs = parseInt(user.processing_end_time) || 0;
          const startTimeSec = parseInt(user.processing_start_time_seconds) || 0;
          const processingActive = parseInt(user.processing_active) || 0;
          
          console.log(`🔒 [DB CHECK] User ${userId}: processing_active=${processingActive}, end_time=${endTimeMs}`);
          
          // 🔒 فحص 1: هل processing_end_time في المستقبل؟
          if (endTimeMs > nowMs) {
            const remainingSec = Math.floor((endTimeMs - nowMs) / 1000);
            console.log(`🔒 BLOCKED: User ${userId} - processing_end_time still in future (${remainingSec}s remaining)`);
            await pool.query('ROLLBACK');
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false, 
              error: 'User already has an active processing session',
              remaining_seconds: remainingSec,
              already_active: true
            }));
            return;
          }
          
          // 🔒 فحص 2: هل بدأت جلسة في آخر 24 ساعة ولم تنتهِ بعد؟
          if (startTimeSec > 0) {
            const endTimeSec = startTimeSec + processingDuration;
            if (endTimeSec > now) {
              const remainingSec = endTimeSec - now;
              console.log(`🔒 BLOCKED: User ${userId} - session started recently (${remainingSec}s remaining)`);
              await pool.query('ROLLBACK');
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                success: false, 
                error: 'User already has an active processing session',
                remaining_seconds: remainingSec,
                already_active: true
              }));
              return;
            }
          }
          
          // 🔒 فحص 3: هل processing_active = 1؟
          if (processingActive === 1) {
            console.log(`🔒 BLOCKED: User ${userId} - processing_active = 1`);
            await pool.query('ROLLBACK');
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false, 
              error: 'User already has an active processing session',
              already_active: true
            }));
            return;
          }

          const endTime = now + processingDuration;
          
          console.log(`✅ [APPROVED] User ${userId} - starting new session (end_time will be ${endTime * 1000})`);
          
          // ✅ أولاً: جلب الرصيد المتراكم من الجلسة السابقة لنقله
          const accumulatedResult = await pool.query(
            'SELECT coins, COALESCE(completed_processing_reward, 0) as accumulated, COALESCE(accumulatedReward, 0) as accumulated_alt FROM users WHERE id = $1',
            [userId]
          );
          
          let currentBalance = parseFloat(accumulatedResult.rows[0]?.coins || 0);
          const accumulated = parseFloat(accumulatedResult.rows[0]?.accumulated || 0);
          const accumulatedAlt = parseFloat(accumulatedResult.rows[0]?.accumulated_alt || 0);
          const rewardToTransfer = Math.max(accumulated, accumulatedAlt);
          let newBalance = currentBalance;
          let rewardTransferred = 0;
          
          // ✅ نقل المكافأة المتراكمة للرصيد الأساسي
          if (rewardToTransfer > 0.0001) {
            newBalance = parseFloat((currentBalance + rewardToTransfer).toFixed(8));
            rewardTransferred = rewardToTransfer;
            console.log(`💰 [TRANSFER] User ${userId}: ${rewardToTransfer.toFixed(8)} accumulated reward → balance (${currentBalance.toFixed(8)} → ${newBalance.toFixed(8)})`);
            
            // Add to processing history
            await pool.query(
              'INSERT INTO processing_history (user_id, amount, timestamp, user_name, date) VALUES ($1, $2, $3, $4, $5)',
              [userId, rewardToTransfer, now * 1000, 'Completed', new Date(now * 1000).toISOString()]
            );
          }
          
          // ✅ بدء الجلسة الجديدة وتحديث الرصيد وإزالة المتراكم + مسح boost
          await pool.query(
            `UPDATE users 
             SET processing_active = 1,
                 processing_start_time_seconds = $1,
                 processing_start_time = $2,
                 processing_end_time = $3,
                 coins = $4,
                 completed_processing_reward = 0,
                 accumulatedReward = 0,
                 processing_accumulated = 0,
                 ad_boost_active = FALSE,
                 ad_boost_granted_at = NULL,
                 ad_boost_session_start = NULL,
                 last_ad_watch_timestamp = NULL,
                 session_locked_boost = 1.0
             WHERE id = $5`,
            [now, now * 1000, endTime * 1000, newBalance, userId]
          );
          
          // Add "Collecting..." entry to processing history
          await pool.query(
            'INSERT INTO processing_history (user_id, amount, timestamp, user_name, date) VALUES ($1, $2, $3, $4, $5)',
            [userId, 0, now * 1000, 'Collecting...', new Date(now * 1000).toISOString()]
          );
          
          await pool.query('COMMIT');
          console.log(`✅ Processing session started for user ${userId}, balance: ${newBalance.toFixed(8)}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            processing_active: 1,
            remaining_seconds: processingDuration,
            start_time: now,
            end_time: endTime,
            // ✅ إرسال الرصيد الجديد للواجهة
            reward_transferred: rewardTransferred,
            new_balance: newBalance,
            old_balance: currentBalance
          }));
          return;
          
        } catch (txError) {
          await pool.query('ROLLBACK');
          
          // 🔒 إذا كان الخطأ بسبب قفل الصف (NOWAIT)، يعني هناك طلب آخر قيد التنفيذ
          if (txError.code === '55P03') {
            console.log(`🔒 BLOCKED: User ${userId} - row locked by another request`);
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false, 
              error: 'User already has an active processing session',
              already_active: true
            }));
            return;
          }
          throw txError;
        }
      } catch (error) {
        console.error('Error starting processing countdown:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // POST /api/processing/complete - Handle processing completion and add rewards
    if (pathname === '/api/processing/complete' && req.method === 'POST') {
      try {
        const { userId, completed, forceStop, addReward, accumulated } = await parseRequestBody(req);
        console.log(`Received processing completion request for user ${userId}, completed: ${completed}, forceStop: ${forceStop}, addReward: ${addReward}, accumulated: ${accumulated}`);

        // First check if user exists
        const userCheck = await pool.query('SELECT id, coins, accumulatedReward, accumulated_processing_reward FROM users WHERE id = $1', [userId]);

        if (userCheck.rows.length === 0) {
          console.log(`User ID ${userId} not found in database`);
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'User not found',
            userId: userId
          }));
          return;
        }

        const currentUserData = userCheck.rows[0];
        const currentBalance = parseFloat(currentUserData.coins || 0);
        const storedAccumulated = parseFloat(currentUserData.accumulatedreward || currentUserData.accumulated_processing_reward || 0);
        console.log(`Current user data: coins=${currentBalance}, accumulated=${storedAccumulated}`);

        // If accumulated is provided, update it first to ensure latest value is stored
        if (accumulated !== undefined) {
          try {
            await updateAccumulatedReward(userId, parseFloat(accumulated));
            console.log(`Updated accumulated processing reward for user ${userId} to ${accumulated}`);
          } catch (accError) {
            console.error(`Error updating accumulated processing reward for user ${userId}:`, accError);
          }
        }

        // Only reset processing status - rewards are handled by countdown/complete endpoint
        console.log(`Processing completion request for user ${userId} - only resetting status, no reward transfer here`);
        
        if (completed === true) {
          // If not adding reward, just reset processing status
          try {
            // Start transaction
            await pool.query('BEGIN');

            // Reset all processing-related flags
            await pool.query(
              'UPDATE users SET processing_active = 0, processingactive = 0, is_active = 0 WHERE id = $1',
              [userId]
            );

            // Clear ad boost when session ends
            const { clearAdBoost } = await import('./db.js');
            await clearAdBoost(userId);
            console.log(`[AD BOOST] Cleared ad boost for user ${userId} on manual stop`);

            // If forceStop is true, also clear timestamps to prevent auto-restart
            if (forceStop) {
              console.log(`Force stopping processing for user ${userId} - clearing all processing timestamps`);
              await pool.query(
                'UPDATE users SET processing_start_time = NULL, processing_start_time_seconds = NULL WHERE id = $1',
                [userId]
              );
            }

            // Commit transaction
            await pool.query('COMMIT');

            console.log(`Successfully stopped processing for user ${userId} without transferring reward`);
          } catch (dbError) {
            await pool.query('ROLLBACK');
            console.error(`Database error when updating user ${userId}:`, dbError);
            throw dbError;
          }
        }

        // Prepare response - rewards are handled by countdown/complete endpoint
        const responseData = { 
          success: true, 
          message: 'Processing status updated - rewards handled by countdown system',
          timestamp: Date.now(),
          userId: userId,
          completed: true,
          force_applied: forceStop || false,
          note: 'Rewards are processed by /api/processing/countdown/complete endpoint'
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responseData));
        return;
      } catch (error) {
        console.error('Error processing processing completion:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // GET /api/processing/history/:userId - Get processing history for user
    if (pathname.match(/^\/api\/processing\/history\/\d+$/) && req.method === 'GET') {
      try {
        const userId = parseInt(pathname.split('/')[4]);
        const url = new URL(req.url, `http://${req.headers.host}`);
        const limit = url.searchParams.get('limit');
        
        let query = 'SELECT * FROM processing_history WHERE user_id = $1 ORDER BY timestamp DESC';
        const params = [userId];
        
        // Add limit if specified
        if (limit && !isNaN(parseInt(limit))) {
          query += ' LIMIT $2';
          params.push(parseInt(limit));
        }
        
        const result = await pool.query(query, params);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, history: result.rows }));
        return;
      } catch (error) {
        console.error('Error fetching processing history:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }
    
    // POST /api/processing/history/add - Add a new history entry
    if (pathname === '/api/processing/history/add' && req.method === 'POST') {
      try {
        const { userId, amount, timestamp, userName } = await parseRequestBody(req);
        
        if (!userId || amount === undefined || !timestamp) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing required parameters' }));
          return;
        }
        
        // Insert new history entry
        const result = await pool.query(
          'INSERT INTO processing_history (user_id, amount, timestamp, user_name, date) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [userId, amount, timestamp, userName || 'Processing', new Date().toISOString()]
        );
        
        console.log(`Added new processing history entry for user ${userId} with ID ${result.rows[0].id}`);
        
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: 'History entry added successfully',
          entryId: result.rows[0].id
        }));
        return;
      } catch (error) {
        console.error('Error adding processing history entry:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }
    
    // POST /api/processing/history/update - Update an existing history entry
    if (pathname === '/api/processing/history/update' && req.method === 'POST') {
      try {
        const { entryId, userId, amount, userName } = await parseRequestBody(req);
        
        if (!entryId || !userId || amount === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing required parameters' }));
          return;
        }
        
        // Update existing history entry
        const result = await pool.query(
          'UPDATE processing_history SET amount = $1, user_name = $2 WHERE id = $3 AND user_id = $4 RETURNING id',
          [amount, userName || null, entryId, userId]
        );
        
        if (result.rows.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'History entry not found or not owned by user' }));
          return;
        }
        
        console.log(`Updated processing history entry ${entryId} for user ${userId} with amount ${amount}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: 'History entry updated successfully'
        }));
        return;
      } catch (error) {
        console.error('Error updating processing history entry:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // POST /api/processing/history/cleanup-collecting - Remove all "Collecting..." entries from database
    if (pathname === '/api/processing/history/cleanup-collecting' && req.method === 'POST') {
      try {
        const { userId } = await parseRequestBody(req);
        
        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing required parameter: userId' }));
          return;
        }

        // Remove all "Collecting..." entries for this user
        const deleteResult = await pool.query(
          `DELETE FROM processing_history 
           WHERE user_id = $1 
           AND (user_name = 'Collecting...' 
                OR user_name LIKE '%Collecting%' 
                OR amount = 0)
           RETURNING id`,
          [userId]
        );

        const deletedCount = deleteResult.rows.length;
        console.log(`Cleaned up ${deletedCount} "Collecting..." entries for user ${userId}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: `Successfully cleaned up ${deletedCount} collecting entries`,
          deletedCount: deletedCount
        }));
        return;

      } catch (error) {
        console.error('Error cleaning up collecting processing history entries:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: error.message
        }));
        return;
      }
    }

    // POST /api/processing/history/update-collecting - Update 'Collecting...' entries to actual amounts
    if (pathname === '/api/processing/history/update-collecting' && req.method === 'POST') {
      try {
        const { userId, amount, sessionDate } = await parseRequestBody(req);
        
        if (!userId || amount === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing required parameters: userId and amount' }));
          return;
        }

        // Start a transaction to ensure consistency
        await pool.query('BEGIN');

        try {
          let updateResult;
          
          if (sessionDate) {
            // Update specific session by date
            const targetDate = new Date(sessionDate).toISOString().split('T')[0];
            updateResult = await pool.query(
              `UPDATE processing_history 
               SET user_name = $1, amount = $2
               WHERE user_id = $3 
               AND (user_name = 'Collecting...' OR user_name LIKE '%Collecting%') 
               AND date::date = $4::date
               RETURNING id, timestamp, date`,
              [`+${parseFloat(amount).toFixed(8)} ACCESS`, amount, userId, targetDate]
            );
          } else {
            // Update the most recent 'Collecting...' entry
            updateResult = await pool.query(
              `UPDATE processing_history 
               SET user_name = $1, amount = $2
               WHERE id = (
                 SELECT id FROM processing_history 
                 WHERE user_id = $3 
                 AND (user_name = 'Collecting...' OR user_name LIKE '%Collecting%')
                 ORDER BY timestamp DESC 
                 LIMIT 1
               )
               RETURNING id, timestamp, date`,
              [`+${parseFloat(amount).toFixed(8)} ACCESS`, amount, userId]
            );
          }

          if (updateResult.rows.length === 0) {
            await pool.query('ROLLBACK');
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false, 
              error: 'No "Collecting..." entries found to update',
              created: false
            }));
            return;
          }

          // Commit the transaction
          await pool.query('COMMIT');

          const updatedEntry = updateResult.rows[0];
          console.log(`Updated "Collecting..." entry for user ${userId} (ID: ${updatedEntry.id}) with amount: +${parseFloat(amount).toFixed(8)} ACCESS`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            message: 'Successfully updated collecting entry with actual amount',
            entryId: updatedEntry.id,
            amount: parseFloat(amount),
            timestamp: updatedEntry.timestamp,
            date: updatedEntry.date,
            created: false,
            updated: true
          }));
          return;

        } catch (error) {
          await pool.query('ROLLBACK');
          throw error;
        }

      } catch (error) {
        console.error('Error updating collecting processing history entry:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: error.message,
          created: false
        }));
        return;
      }
    }

    // POST /api/profile/delete-photo - Set user profile photo to default avatar
    if (pathname === '/api/profile/delete-photo' && req.method === 'POST') {
      try {
        const { userId } = await parseRequestBody(req);

        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'User ID is required' }));
          return;
        }

        console.log(`Profile photo reset to default request for user ID: ${userId}`);

        // Default avatar SVG - new clean user icon
        const defaultAvatar = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2M2YzZjNiIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMTIiIHI9IjciIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMTAgMzBjMC01IDQtOCAxMC04czEwIDMgMTAgOHYxYzAgMS0xIDItMiAyaC0xNmMtMSAwLTIgLTEtMi0ydi0xeiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==';

        // Begin transaction for consistency
        await pool.query('BEGIN');

        try {
          // Check current avatar first


    // GET /api/external-wallet/balance/:address - Get external wallet balance
    if (pathname.match(/^\/api\/external-wallet\/balance\/0x[a-fA-F0-9]{40}$/) && req.method === 'GET') {
      try {
        const walletAddress = pathname.split('/')[4];
        console.log(`Checking external wallet balance for: ${walletAddress}`);

        // التحقق من وجود المحفظة في قاعدة البيانات
        const externalWalletResult = await pool.query(
          'SELECT address, balance, last_activity, transaction_count FROM external_wallets WHERE address = $1',
          [walletAddress]
        );

        if (externalWalletResult.rows.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'External wallet not found',
            address: walletAddress,
            registered: false
          }));
          return;
        }

        const walletData = externalWalletResult.rows[0];
        const balance = parseFloat(walletData.balance || 0);

        // التحقق من رصيد البلوك تشين أيضاً
        let networkBalance = balance;
        try {
          const { getNetworkNode } = await import('./network-api.js');
          const networkNode = getNetworkNode();
          
          if (networkNode && networkNode.network) {
            networkBalance = networkNode.network.getBalance(walletAddress);
            
            // إذا كان رصيد البلوك تشين مختلف، قم بالمزامنة
            if (Math.abs(networkBalance - balance) > 0.00000001) {
              await pool.query(
                'UPDATE external_wallets SET balance = $1 WHERE address = $2',
                [networkBalance, walletAddress]
              );
              // Wallet balance synchronized - message reduced for performance
            }
          }
        } catch (networkError) {
          console.warn('Could not get blockchain balance:', networkError.message);
          networkBalance = balance; // استخدم الرصيد من قاعدة البيانات
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          address: walletAddress,
          balance: networkBalance,
          balanceFormatted: `${networkBalance.toFixed(8)} ACCESS`,
          databaseBalance: balance,
          lastActivity: walletData.last_activity,
          transactionCount: walletData.transaction_count || 0,
          registered: true,
          network: 'Access Network',
          chainId: '0x5968'
        }));
      } catch (error) {
        console.error('Error checking external wallet balance:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'Server error checking wallet balance'
        }));
      }
      return;
    }

    // GET /api/external-wallet/debug/:address - Debug external wallet info
    if (pathname.match(/^\/api\/external-wallet\/debug\/0x[a-fA-F0-9]{40}$/) && req.method === 'GET') {
      try {
        const walletAddress = pathname.split('/')[4];
        console.log(`🔍 فحص تفاصيل المحفظة الخارجية: ${walletAddress}`);

        // التحقق من البلوك تشين
        let networkBalance = 0;
        let blockchainTransactions = [];
        try {
          const { getNetworkNode } = await import('./network-api.js');
          const networkNode = getNetworkNode();
          if (networkNode && networkNode.network) {
            networkBalance = networkNode.network.getBalance(walletAddress);
            blockchainTransactions = networkNode.network.getAllTransactionsForWallet(walletAddress);
            
            // Account balance retrieved - message reduced for performance
            // Transaction records found - message reduced for performance
          }
        } catch (networkError) {
          console.error('خطأ في الوصول للبلوك تشين:', networkError.message);
        }

        // التحقق من قاعدة البيانات
        const externalWalletResult = await pool.query(
          'SELECT * FROM external_wallets WHERE address = $1',
          [walletAddress]
        );

        const dbTransactionsResult = await pool.query(
          'SELECT * FROM transactions WHERE from_address = $1 OR to_address = $1 ORDER BY timestamp DESC LIMIT 10',
          [walletAddress]
        );

        const debugInfo = {
          address: walletAddress,
          blockchain: {
            balance: networkBalance.toFixed(8),
            transactionCount: blockchainTransactions.length,
            isValid: networkBalance >= 0
          },
          database: {
            isRegistered: externalWalletResult.rows.length > 0,
            storedBalance: externalWalletResult.rows[0]?.balance || 0,
            transactionCount: dbTransactionsResult.rows.length,
            lastActivity: externalWalletResult.rows[0]?.last_activity || null
          },
          recent_transactions: dbTransactionsResult.rows.slice(0, 5).map(tx => ({
            hash: tx.tx_hash,
            from: tx.from_address,
            to: tx.to_address,
            amount: parseFloat(tx.amount).toFixed(8),
            timestamp: new Date(parseInt(tx.timestamp)).toLocaleString('ar-SA')
          }))
        };

        console.log(`🔍 تفاصيل المحفظة الخارجية:`, JSON.stringify(debugInfo, null, 2));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          debug_info: debugInfo,
          recommendations: [
            debugInfo.network.balance > 0 ? 'المحفظة تحتوي على رصيد في البلوك تشين' : 'المحفظة فارغة في البلوك تشين',
            debugInfo.database.isRegistered ? 'المحفظة مسجلة في قاعدة البيانات' : 'المحفظة غير مسجلة في قاعدة البيانات',
            debugInfo.recent_transactions.length > 0 ? `توجد ${debugInfo.recent_transactions.length} معاملات حديثة` : 'لا توجد معاملات حديثة'
          ]
        }));
      } catch (error) {
        console.error('خطأ في فحص المحفظة الخارجية:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
      }
      return;
    }

    // POST /api/external-wallet/register - Register external wallet for tracking
    if (pathname === '/api/external-wallet/register' && req.method === 'POST') {
      try {
        const { address, userAgent, chainId } = await parseRequestBody(req);

        if (!address || !address.startsWith('0x') || address.length !== 42) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Invalid wallet address format'
          }));
          return;
        }

        const currentTime = Date.now();

        // تسجيل أو تحديث المحفظة الخارجية
        await pool.query(
          `INSERT INTO external_wallets 
          (address, user_agent, chain_id, first_seen, last_activity, balance, is_active, transaction_count)
          VALUES ($1, $2, $3, $4, $4, $5, true, 0)
          ON CONFLICT (address) 
          DO UPDATE SET
            user_agent = EXCLUDED.user_agent,
            last_activity = EXCLUDED.last_activity,
            is_active = true,
            connection_count = COALESCE(external_wallets.connection_count, 0) + 1`,
          [address, userAgent || 'Manual Registration', chainId || '0x5968', currentTime, 0]
        );

        // الحصول على الرصيد من البلوك تشين
        let balance = 0;
        try {
          const { getNetworkNode } = await import('./network-api.js');
          const networkNode = getNetworkNode();
          
          if (networkNode && networkNode.network) {
            balance = networkNode.network.getBalance(address);
            
            // تحديث الرصيد في قاعدة البيانات
            await pool.query(
              'UPDATE external_wallets SET balance = $1 WHERE address = $2',
              [balance, address]
            );
          }
        } catch (networkError) {
          console.warn('Could not get initial blockchain balance:', networkError.message);
        }

        console.log(`🔗 Registered external wallet: ${address} with balance: ${balance.toFixed(8)} ACCESS`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'External wallet registered successfully',
          address: address,
          balance: balance,
          balanceFormatted: `${balance.toFixed(8)} ACCESS`,
          registered: true,
          timestamp: currentTime
        }));
      } catch (error) {
        console.error('Error registering external wallet:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'Server error registering wallet'
        }));
      }
      return;
    }


          const currentResult = await pool.query(
            'SELECT avatar FROM users WHERE id = $1',
            [userId]
          );

          if (currentResult.rows.length === 0) {
            await pool.query('ROLLBACK');
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'User not found' }));
            return;
          }

          const currentAvatar = currentResult.rows[0].avatar;

          // Check if already has default avatar or no avatar
          if (!currentAvatar || currentAvatar === defaultAvatar) {
            await pool.query('ROLLBACK');
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false, 
              error: 'No profile photo to delete',
              message: 'User already has default avatar'
            }));
            return;
          }

          // Set avatar to default instead of null
          const result = await pool.query(
            'UPDATE users SET avatar = $1 WHERE id = $2 RETURNING id, email',
            [defaultAvatar, userId]
          );

          // Also clear QR code data if it exists (since avatar changed)
          await pool.query(
            'UPDATE users SET qrcode_data = NULL, qrcode_timestamp = NULL WHERE id = $1',
            [userId]
          );

          // Commit the transaction
          await pool.query('COMMIT');

          console.log(`Profile photo reset to default for user: ${result.rows[0].email}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            message: 'Profile photo reset to default',
            avatar: defaultAvatar
          }));
        } catch (error) {
          await pool.query('ROLLBACK');
          throw error;
        }
      } catch (error) {
        console.error('Error resetting profile photo:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message || 'Server error' }));
      }
      return;
    }

    // PUT /api/users/update-profile - Update user profile (OPTIMIZED - no transaction needed)
    if ((pathname === '/api/users/update-profile' || pathname === '/api/user/update-profile' || pathname === '/api/update-profile') && (req.method === 'PUT' || req.method === 'POST')) {
      try {
        const data = await parseRequestBody(req);
        const { userId, name, avatar } = data;

        console.log(`Profile update request received for user ID: ${userId}`);

        if (!userId) {
          console.log('Profile update failed: No user ID provided');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'User ID is required' }));
          return;
        }

        // Handle updates with null fields - allowing name-only or avatar-only updates
        console.log(`Fields to update: name=${name !== undefined}, avatar=${avatar !== undefined}`);

        // 🚀 OPTIMIZED: استخدام safeQuery بدلاً من transaction (أسرع وأخف)
        try {
          // 1. First update the users table - زيادة timeout إلى 10 ثواني
          const updateUserResult = await safeQuery(
            `UPDATE users 
             SET name = CASE WHEN $1::text IS NOT NULL THEN $1 ELSE name END,
                 avatar = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE avatar END 
             WHERE id = $3 
             RETURNING id, name, avatar, email, coins, referral_code`,
            [name, avatar, userId],
            10000
          );

          if (updateUserResult.rows.length === 0) {
            console.log(`No user found with ID: ${userId}`);
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'User not found' }));
            return;
          }

          const updatedUser = updateUserResult.rows[0];
          console.log(`User table updated successfully for user: ${updatedUser.email}`);

          // 2. Update the processing_history table if name is provided (non-blocking, no need to wait)
          if (name !== undefined) {
            console.log(`Updating user name in processing_history for user ID: ${userId}`);
            // Only update entries that don't contain "Collecting..." or other special system entries
            // 🚀 Non-blocking update - لا ننتظر الانتهاء
            safeQuery(
              "UPDATE processing_history SET user_name = $1 WHERE user_id = $2 AND user_name NOT LIKE '%Collecting...%' AND user_name NOT LIKE '%Processing Started%' AND user_name NOT LIKE '%Processing Reward%'",
              [name, userId],
              3000
            ).catch(() => {}); // تجاهل الأخطاء - ليس ضرورياً
          }

          // Send successful response
          // Ensure we return a consistent user object format that matches what the client expects
          const standardizedUser = {
            id: updatedUser.id,
            email: updatedUser.email,
            name: updatedUser.name,
            avatar: updatedUser.avatar,
            coins: updatedUser.coins,
            referral_code: updatedUser.referral_code,
            referralCode: updatedUser.referral_code, // Include both formats for compatibility
            processing_active: updatedUser.processing_active || 0,
            processingActive: updatedUser.processing_active || 0,
            last_payout: updatedUser.last_payout,
            lastPayout: updatedUser.last_payout,
            language: updatedUser.language || 'en'
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            message: 'Profile updated successfully',
            user: standardizedUser
          }));
        } catch (error) {
          throw error;
        }
      } catch (error) {
        console.error('Error updating user profile:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message || 'Server error' }));
      }
      return;
    }

    // Handle OPTIONS for profile update routes for CORS
    if ((pathname === '/api/users/update-profile' || pathname === '/api/user/update-profile' || pathname === '/api/update-profile') && req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'PUT, POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      });
      res.end();
      return;
    }

    // Handle OAuth2 callback from Google
    if (pathname === '/oauth2callback' || pathname.startsWith('/oauth2callback')) {
      const urlParams = new URLSearchParams(parsedUrl.search);
      const code = urlParams.get('code');
      const error = urlParams.get('error');

      if (error) {
        console.error('OAuth2 error:', error);
        res.writeHead(302, { 'Location': '/?error=oauth_error' });
        res.end();
        return;
      }

      if (code) {
        try {
          // Exchange code for tokens
          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code: code,
              client_id: GOOGLE_CLIENT_ID,
              client_secret: GOOGLE_CLIENT_SECRET,
              redirect_uri: `${req.headers.origin || `http://${req.headers.host}`}`,
              grant_type: 'authorization_code'
            })
          });

          const tokenData = await tokenResponse.json();

          if (tokenData.access_token) {
            // Get user info
            const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
              headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
            });

            const userData = await userResponse.json();

            // Create a simple JWT-like token for frontend
            const userToken = Buffer.from(JSON.stringify({
              email: userData.email,
              name: userData.name,
              picture: userData.picture,
              timestamp: Date.now()
            })).toString('base64');

            // Redirect with user data
            const redirectUrl = `/?token=${encodeURIComponent(userToken)}`;
            res.writeHead(302, { 'Location': redirectUrl });
            res.end();
            return;
          }
        } catch (err) {
          console.error('Error processing OAuth2 callback:', err);
        }
      }

      // Fallback redirect
      res.writeHead(302, { 'Location': '/?error=auth_failed' });
      res.end();
      return;
    }

    // GET /api/oauth-config - Secure Google OAuth configuration endpoint
    if (pathname === '/api/oauth-config' && req.method === 'GET') {
      const googleClientId = process.env.GOOGLE_CLIENT_ID;
      
      if (!googleClientId) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false,
          error: 'GOOGLE_CLIENT_ID environment variable not configured',
          message: 'Please configure Google OAuth credentials through environment variables'
        }));
        return;
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true,
        clientId: googleClientId,
        message: 'Google OAuth configuration loaded securely'
      }));
      return;
    }

    // GET /api/auth-config - Google Identity Services config (legacy support)
    if (pathname === '/api/auth-config' && req.method === 'GET') {
      const googleClientId = process.env.GOOGLE_CLIENT_ID;
      
      if (!googleClientId) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false,
          error: 'GOOGLE_CLIENT_ID environment variable not configured',
          auth_system: 'google_identity_services',
          message: 'Please configure Google OAuth credentials through environment variables'
        }));
        return;
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true, 
        auth_system: 'google_identity_services',
        client_id: googleClientId,
        message: 'Google Identity Services authentication ready'
      }));
      return;
    }

    // Enhanced health check endpoint for deployments and monitoring
    if (pathname === '/health' || pathname === '/ping') {
      // 🏗️ إضافة إحصائيات البنية التحتية
      let infraStats = null;
      if (enterpriseInfrastructure) {
        try {
          infraStats = enterpriseInfrastructure.getHealthStatus();
        } catch (e) {}
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'ok',
        timestamp: Date.now(),
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0',
        auth_system: 'google_identity_services',
        uptime: process.uptime(),
        memory_usage: process.memoryUsage().rss / 1024 / 1024,
        deployment_id: process.env.REPL_ID || 'unknown',
        port: process.env.PORT || PORT,
        deployment_success: true,
        message: 'AccessoireCrypto deployment is running successfully',
        infrastructure: infraStats
      }));
      return;
    }
    
    // 🏗️ Enterprise Stats endpoint
    if (pathname === '/api/enterprise/stats' && req.method === 'GET') {
      if (enterpriseInfrastructure) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(enterpriseInfrastructure.getStats()));
      } else {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Infrastructure not initialized' }));
      }
      return;
    }
    
    // 🏗️ Prometheus metrics endpoint
    if (pathname === '/metrics' && req.method === 'GET') {
      if (enterpriseInfrastructure) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(enterpriseInfrastructure.getPrometheusMetrics());
      } else {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('# Infrastructure not initialized');
      }
      return;
    }

    // KYC system removed to reduce resource consumption

    // POST /api/user/qrcode/save - DEPRECATED: QR codes are now generated dynamically
    // This endpoint is kept for backward compatibility but does nothing
    if (pathname === '/api/user/qrcode/save' && req.method === 'POST') {
      try {
        const data = await parseRequestBody(req);
        const { userId, walletAddress } = data;
        
        // ✅ OPTIMIZED: QR code is generated dynamically from wallet_address
        // No need to save HTML to database - saves resources!
        console.log(`QR code generation skipped for user ${userId} - dynamic generation enabled`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: 'QR codes are now generated dynamically',
          wallet_address: walletAddress
        }));
        return;
      } catch (error) {
        console.error('Error saving QR code data:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: error.message,
          details: 'Database error occurred while saving QR code data'
        }));
      }
      return;
    }

    // GET /api/user/qrcode/:userId - OPTIMIZED: Return wallet_address only, QR generated client-side
    if (pathname.match(/^\/api\/user\/qrcode\/\d+$/) && req.method === 'GET') {
      try {
        const userId = pathname.split('/')[4];
        
        // ✅ OPTIMIZED: Only fetch wallet_address - QR code is generated dynamically on client
        const result = await pool.query(
          `SELECT id, wallet_address FROM users WHERE id = $1`,
          [userId]
        );

        if (result.rows.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'User not found' 
          }));
          return;
        }

        const userData = result.rows[0];
        const walletAddress = userData.wallet_address;

        // Return only wallet_address - client will generate QR dynamically
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          wallet_address: walletAddress,
          // Signal to client that QR should be generated locally
          generate_qr_locally: true
        }));
      } catch (error) {
        console.error('Error retrieving QR code data:', error);

        // Even in case of error, return a usable response with whatever information we have
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: error.message,
          error_type: 'server_error',
          wallet_address: null, // Client will need to use its own cached value
          needs_generation: true
        }));
      }
      return;
    }

    // Endpoint لمزامنة الأرصدة من blockchain إلى قاعدة البيانات
    if (pathname === '/api/admin/sync-balances' && req.method === 'POST') {
      try {
        console.log('🔄 Starting balance synchronization from blockchain to database...');
        
        // التأكد من وجود blockchain instance
        if (!global.accessNode || !global.accessNode.blockchain) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Blockchain not initialized yet' 
          }));
          return;
        }

        // الحصول على جميع الأرصدة من blockchain state (المصدر الوحيد للحقيقة)
        const blockchainBalances = global.accessNode.blockchain.getAllBalances();
        console.log(`📊 Found ${Object.keys(blockchainBalances).length} addresses in blockchain state`);

        let syncedCount = 0;
        let updatedBalances = [];

        // مزامنة كل عنوان من blockchain إلى قاعدة البيانات
        for (const [address, blockchainBalance] of Object.entries(blockchainBalances)) {
          try {
            // تحديث قاعدة البيانات external_wallets
            const result = await pool.query(`
              INSERT INTO external_wallets
              (address, balance, last_activity, is_active, chain_id)
              VALUES ($1, $2, $3, true, '0x5968')
              ON CONFLICT (address) DO UPDATE SET
              balance = EXCLUDED.balance,
              last_activity = EXCLUDED.last_activity,
              is_active = true
            `, [
              address.toLowerCase(),
              blockchainBalance.toFixed(8),
              Date.now()
            ]);

            syncedCount++;
            updatedBalances.push({
              address: address,
              balance: blockchainBalance.toFixed(8)
            });

            console.log(`✅ Synced ${address}: ${blockchainBalance.toFixed(8)} ACCESS`);
          } catch (err) {
            console.error(`Error syncing ${address}:`, err.message);
          }
        }

        console.log(`✅ Balance synchronization complete: ${syncedCount}/${Object.keys(blockchainBalances).length} addresses`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true,
          synced: syncedCount,
          total: Object.keys(blockchainBalances).length,
          balances: updatedBalances
        }));
      } catch (error) {
        console.error('Error syncing balances:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: error.message 
        }));
      }
      return;
    }

 

    // Default route handler
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
    return;
  }

  // Handle static file requests
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  // Check if the URL might be a directory or missing extension
  if (!path.extname(filePath)) {
    // If no extension, try to serve as HTML
    filePath = path.join(__dirname, pathname, 'index.html');
  }

  // Get file extension
  const extname = String(path.extname(filePath)).toLowerCase();

  // Content type mapping
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.svg': 'image/svg+xml',
    '.json': 'application/json'
  };

  // Set content type
  const contentType = contentTypes[extname] || 'text/plain';

  // Read and serve the file
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // Page not found
        fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
          if (err) {
            res.writeHead(500);
            res.end('Server Error: ' + err.code);
            return;
          }
          res.writeHead(200, { 
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Permissions-Policy': 'identity-credentials-get=*, publickey-credentials-get=*'
          });
          res.end(content, 'utf-8');
        });
      } else {
        // Server error
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      // Success - serve HTML files with Google Identity Services config
      if (contentType === 'text/html') {
        let htmlContent = content.toString('utf-8');

        // 🔄 إضافة إصدار تلقائي لكل ملفات JS و CSS المحلية
        htmlContent = htmlContent.replace(/src="([^"]+\.js)"/g, (match, file) => {
          // لا نضيف إصدار للملفات الخارجية (http/https)
          if (file.startsWith('http')) return match;
          // لا نضيف إصدار إذا كان موجوداً
          if (file.includes('?v=')) return match;
          return `src="${file}?v=${ASSETS_VERSION}"`;
        });
        htmlContent = htmlContent.replace(/href="([^"]+\.css)"/g, (match, file) => {
          if (file.startsWith('http')) return match;
          if (file.includes('?v=')) return match;
          return `href="${file}?v=${ASSETS_VERSION}"`;
        });

        res.writeHead(200, { 
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Permissions-Policy': 'identity-credentials-get=*, publickey-credentials-get=*'
        });
        res.end(htmlContent, 'utf-8');
      } else {
        // For non-HTML files, serve with no-cache headers
        res.writeHead(200, { 
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(content, 'utf-8');
      }
    }
  });
});

// Define fallback ports - FIXED to avoid conflicts
const FALLBACK_PORTS = [3000, 8080, 30001, 30002, 30003];

// RPC is now handled via /rpc endpoint on the main port

// Log deployment mode and environment
if (process.env.NODE_ENV === 'production') {
  // production mode
}

// Actually start the server with proper error handling
let portIndex = 0;

function startServer(port) {
  // Ensure port is a number and in valid range
  port = parseInt(port, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    port = 8080;
  }

  // Always bind to 0.0.0.0 to ensure the server is accessible
  // This is critical for deployments
  const httpServer = server.listen(port, '0.0.0.0')
    .on('listening', () => {
      // Initialize blockchain after server starts
      try {
        initializeNetwork();
      } catch (error) {
        console.error('Error initializing blockchain:', error);
      }

      // Log different messages based on environment
      if (process.env.NODE_ENV === 'production') {
        // production mode
      }

      // Setup WebSocket server for real-time presence tracking
      initializeWebSockets(httpServer);
    })
    .on('error', (err) => {
      console.error(`Server failed to start on port ${port}:`, err.message);

      // Try next fallback port
      portIndex++;
      if (portIndex < FALLBACK_PORTS.length) {
        const nextPort = FALLBACK_PORTS[portIndex];
        console.log(`Trying fallback port ${nextPort}...`);
        startServer(nextPort);
      } else {
        console.error('All ports failed. Could not start server.');
        process.exit(1);
      }
    });
}

startServer(PORT);

// Initialize WebSocket server for real-time user presence tracking
function initializeWebSockets(httpServer) {
  // Initialize WebSocket RPC Handler for Web3 wallet connections (Trust Wallet, MetaMask, etc.)
  wsRPCHandler = new WebSocketRPCHandler();

  // Connect network events to WebSocket RPC Handler
  if (global.accessNode && global.accessNode.network) {
    const network = global.accessNode.network;
    
    // Broadcast pending transactions to subscribed wallets
    network.on('transaction', (transaction) => {
      if (wsRPCHandler) {
        wsRPCHandler.broadcastNewPendingTransaction(transaction);
      }
    });

    // Broadcast new blocks to subscribed wallets
    network.on('blockMined', (block) => {
      if (wsRPCHandler) {
        wsRPCHandler.broadcastNewBlock(block);
      }
    });

    // Broadcast balance changes to subscribed wallets
    network.on('balanceChanged', (balanceData) => {
      if (wsRPCHandler) {
        wsRPCHandler.notifyBalanceChange(balanceData.address);
      }
    });
  }

  // Create a single WebSocketServer instance and assign to global variable
  wss = new WebSocketServer({ 
    noServer: true, // Don't attach to server automatically
    clientTracking: true,
    perMessageDeflate: false,
    // Add more robust handling for WebSocket connections
    maxPayload: 1024 * 1024, // 1MB max payload
    pingTimeout: 30000, // 30 second ping timeout
    pingInterval: 25000 // 25 second ping interval
  });

  // Manually handle upgrade events to prevent duplicate handling
  httpServer.removeAllListeners('upgrade');
  httpServer.on('upgrade', (request, socket, head) => {
    // Check if this is a Web3 RPC connection or regular user presence connection
    const url = request.url || '';
    
    if (url.includes('/rpc') || url.includes('/ws-rpc') || url.includes('/web3')) {
      // This is a Web3 RPC connection (Trust Wallet, MetaMask, etc.)
      wss.handleUpgrade(request, socket, head, (ws) => {
        const clientId = 'wallet_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        console.log(`🔗 New Web3 wallet connection: ${clientId}`);
        wsRPCHandler.handleNewClient(ws, clientId);
      });
    } else {
      // Regular user presence connection
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  // Handle server-level errors
  wss.on('error', (error) => {
    console.error('WebSocket server error:', error.message);
  });

  // Keep track of connection attempts to prevent connection flooding
  const connectionAttempts = new Map();

  // Clean up connection attempts every 5 minutes
  setInterval(() => {
    const cutoffTime = Date.now() - (5 * 60 * 1000); // 5 minutes ago
    connectionAttempts.forEach((timestamp, key) => {
      if (timestamp < cutoffTime) {
        connectionAttempts.delete(key);
      }
    });
  }, 5 * 60 * 1000);

  wss.on('connection', (ws, req) => {
    try {
      // Add keep-alive feature to prevent timeouts
      ws.isAlive = true;

      // Parse the URL to get user ID with robust error handling
      let userId;
      try {
        if (!req.url) {
          console.error('WebSocket request missing URL');
          ws.close(1008, 'Missing request URL');
          return;
        }
        
        // Extract userId using multiple parsing methods
        const url = req.url;
        
        // Method 1: Direct regex extraction (most reliable)
        const userIdMatch = url.match(/[?&]userId=([^&]*)/);
        if (userIdMatch) {
          userId = decodeURIComponent(userIdMatch[1]);
        }
        
        // Method 2: URLSearchParams fallback
        if (!userId) {
          try {
            const queryString = url.split('?')[1];
            if (queryString) {
              const params = new URLSearchParams(queryString);
              userId = params.get('userId');
            }
          } catch (paramError) {
            console.log('URLSearchParams parsing failed:', paramError.message);
          }
        }
        
        // Method 3: Manual split fallback
        if (!userId) {
          try {
            const parts = url.split('userId=');
            if (parts.length > 1) {
              userId = parts[1].split('&')[0];
            }
          } catch (splitError) {
            console.log('Manual split parsing failed:', splitError.message);
          }
        }

        // Client IP for rate limiting
        const clientIP = req.headers['x-forwarded-for'] || 
                        req.connection.remoteAddress || 
                        'unknown';

        const connectionKey = `${userId}-${clientIP}`;

        // Basic rate limiting  
        if (!userId) {
          console.log('WebSocket connection without userId, closing');
          ws.close(1008, 'Missing userId parameter');
          return;
        }

      // Check existing connection for this user
      const existingSession = activeUsers.get(userId);
      if (existingSession) {
        // Close old connection gracefully if it exists
        try {
          if (existingSession.ws && 
              existingSession.ws.readyState !== ws.CLOSED && 
              existingSession.ws.readyState !== ws.CLOSING) {
            existingSession.ws.close(1000, 'New connection established');
          }

          // Clear the heartbeat interval
          if (existingSession.heartbeatInterval) {
            clearInterval(existingSession.heartbeatInterval);
          }
        } catch (err) {
          console.error(`Error closing existing WebSocket for user ${userId}:`, err.message);
        }
      }

      // Suppressed WebSocket connection messages

      // Store the connection and set user as active with smart resource management
      const userSession = {
        ws, 
        lastSeen: Date.now(),
        lastActivity: Date.now(),
        clientIP,
        isActiveUser: true, // Track if user is actively using the app
        heartbeatInterval: null,
        currentPingInterval: RESOURCE_OPTIMIZATION.WS_PING_INTERVAL_ACTIVE
      };

      // Smart heartbeat system that adapts to user activity
      const setupSmartHeartbeat = (session) => {
        if (session.heartbeatInterval) {
          clearInterval(session.heartbeatInterval);
        }

        session.heartbeatInterval = setInterval(() => {
          const now = Date.now();
          const timeSinceActivity = now - session.lastActivity;
          
          // Determine if user is currently active or idle
          const isCurrentlyActive = timeSinceActivity < RESOURCE_OPTIMIZATION.USER_ACTIVITY_THRESHOLD;
          
          // Adapt ping interval based on activity
          const newInterval = isCurrentlyActive ? 
            RESOURCE_OPTIMIZATION.WS_PING_INTERVAL_ACTIVE : 
            RESOURCE_OPTIMIZATION.WS_PING_INTERVAL_IDLE;

          // Only restart interval if it needs to change (saves resources)
          if (newInterval !== session.currentPingInterval) {
            session.currentPingInterval = newInterval;
            // Silent - reduce console spam
            setupSmartHeartbeat(session); // Restart with new interval
            return;
          }

          // Standard heartbeat check
          if (ws.isAlive === false) {
            console.log(`Terminating inactive WebSocket for user ${userId}`);
            return ws.terminate();
          }

          ws.isAlive = false;

          // Send ping only if connection is healthy and user was recently active
          if (ws.readyState === ws.OPEN) {
            try {
              // Skip ping for very idle users to save resources
              if (timeSinceActivity < RESOURCE_OPTIMIZATION.IDLE_USER_THRESHOLD) {
                ws.ping();
              } else {
                // For very idle users, just mark as alive without ping
                ws.isAlive = true;
              }
            } catch (err) {
              console.error(`Error sending ping to user ${userId}:`, err.message);
            }
          }
        }, userSession.currentPingInterval);
      };

      setupSmartHeartbeat(userSession);
      activeUsers.set(userId, userSession);

      // Update user status in database to active (with better error handling)
      updateUserActiveStatus(userId, true).catch(err => {
        console.error(`Error updating active status for user ${userId}:`, err.message);
      });

      // Immediately send a connection acknowledgment to client
      try {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ 
            type: 'connected', 
            userId,
            timestamp: Date.now(),
            message: 'Connection successful'
          }));
        }
      } catch (err) {
        console.error(`Error sending connection confirmation to user ${userId}:`, err.message);
      }

      // Handle messages from client with smart activity tracking
      ws.on('message', (message) => {
        try {
          let data;

          // Handle both string and binary messages
          if (typeof message === 'string') {
            data = JSON.parse(message);
          } else {
            data = JSON.parse(message.toString());
          }

          // Smart activity tracking - update both timestamps
          const userSession = activeUsers.get(userId);
          if (userSession) {
            const now = Date.now();
            userSession.lastSeen = now;
            
            // Only update activity for meaningful interactions (not just heartbeats)
            if (data.type !== 'heartbeat' && data.type !== 'ping') {
              userSession.lastActivity = now;
              userSession.isActiveUser = true;
            }
          }

          if (data.type === 'heartbeat') {
            // Mark connection as alive
            ws.isAlive = true;

            // Respond to heartbeat only if user is active (save bandwidth for idle users)
            if (ws.readyState === ws.OPEN && userSession && userSession.isActiveUser) {
              try {
                ws.send(JSON.stringify({ 
                  type: 'heartbeat_ack', 
                  time: Date.now() 
                }));
              } catch (err) {
                console.error(`Error acknowledging heartbeat from user ${userId}:`, err.message);
              }
            }
          } else if (data.type === 'ping') {
            // Respond with pong to verify connection
            if (ws.readyState === ws.OPEN) {
              try {
                ws.send(JSON.stringify({ 
                  type: 'pong', 
                  time: Date.now()
                }));
              } catch (err) {
                console.error(`Error sending pong to user ${userId}:`, err.message);
              }
            }
          } else if (data.type === 'user_active') {
            // Explicit user activity signal
            if (userSession) {
              userSession.lastActivity = Date.now();
              userSession.isActiveUser = true;
            }
          } else if (data.type === 'user_idle') {
            // Explicit user idle signal
            if (userSession) {
              userSession.isActiveUser = false;
            }
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error.message);
          // Don't close connection for message parsing errors
        }
      });

      // Handle connection close
      ws.on('close', (code, reason) => {
        // Only log unusual disconnections
        if (code !== 1000) {
          smartLogger.logWebSocket(userId, `disconnected (code: ${code})`);
        }

        // Clean up resources
        const userSession = activeUsers.get(userId);
        if (userSession && userSession.heartbeatInterval) {
          clearInterval(userSession.heartbeatInterval);
        }

        // Remove user from active users map
        activeUsers.delete(userId);

        // Delay the database update slightly to allow for reconnections
        setTimeout(() => {
          // Only update status if user hasn't reconnected
          if (!activeUsers.has(userId)) {
            updateUserActiveStatus(userId, false).catch(err => {
              console.error(`Error updating inactive status for user ${userId}:`, err.message);
            });
          }
        }, 2000); // 2 second grace period
      });

      // Add explicit error handler for each connection
      ws.on('error', (err) => {
        console.error(`WebSocket error for user ${userId}:`, err.message);

        // Don't immediately close - allow reconnection logic to work
        // But mark the connection as problematic
        ws.isAlive = false;
      });
      } catch (error) {
        console.error('Error handling WebSocket connection URL parsing:', error.message);
        console.error('Request URL was:', req.url || 'undefined');
        if (ws.readyState === ws.OPEN) {
          ws.close(1011, 'URL parsing error');
        }
        return;
      }

      // Store userId as a property on the websocket for error handling
      ws.userId = userId;

      // Handle pong responses to track connection
      ws.on('pong', () => {
        // Mark as alive when pong is received
        ws.isAlive = true;

        const userSession = activeUsers.get(userId);
        if (userSession) {
          userSession.lastSeen = Date.now();
        }
      });

    } catch (error) {
      console.error('Error handling WebSocket connection:', error.message);
      if (ws.readyState === ws.OPEN) {
        ws.close(1011, 'Server error occurred');
      }
    }
  });

  // Smart inactive session cleanup - adapts to user activity patterns
  let lastCleanupTime = Date.now();
  let dbUpdateQueue = new Set(); // Queue for batch database updates
  
  const performSmartCleanup = () => {
    const now = Date.now();
    const baseInactivityThreshold = 10 * 60 * 1000; // 10 minutes base threshold
    
    // Only perform cleanup if there are active users
    if (activeUsers.size === 0) {
      return;
    }

    // Separate users by activity level for different handling
    const veryIdleUsers = [];
    const idleUsers = [];
    const disconnectedUsers = [];
    
    for (const [userId, session] of activeUsers.entries()) {
      const timeSinceLastSeen = now - session.lastSeen;
      const timeSinceActivity = now - (session.lastActivity || session.lastSeen);
      
      // Check if WebSocket is actually disconnected
      if (!session.ws || session.ws.readyState === session.ws.CLOSED || session.ws.readyState === session.ws.CLOSING) {
        disconnectedUsers.push({ userId, session });
      }
      // Very idle users (no activity for 15+ minutes)
      else if (timeSinceActivity > 15 * 60 * 1000) {
        veryIdleUsers.push({ userId, session });
      }
      // Idle users (no recent activity but connection alive)
      else if (timeSinceLastSeen > baseInactivityThreshold) {
        idleUsers.push({ userId, session });
      }
      // Mark idle users for potential database status update
      else if (timeSinceActivity > RESOURCE_OPTIMIZATION.IDLE_USER_THRESHOLD) {
        session.isActiveUser = false;
      }
    }

    // Process disconnected users immediately (high priority)
    disconnectedUsers.forEach(({ userId, session }) => {
      cleanupUserSession(userId, session, 'disconnected');
    });

    // Process very idle users (medium priority) 
    if (veryIdleUsers.length > 0) {
      console.log(`Cleaning up ${veryIdleUsers.length} very idle users`);
      veryIdleUsers.forEach(({ userId, session }) => {
        cleanupUserSession(userId, session, 'very_idle');
      });
    }

    // Process idle users more conservatively (low priority)
    if (idleUsers.length > 3) { // Only if many idle users
      console.log(`Cleaning up ${Math.min(3, idleUsers.length)} idle users (batch limit)`);
      idleUsers.slice(0, 3).forEach(({ userId, session }) => {
        cleanupUserSession(userId, session, 'idle');
      });
    }

    // Batch database updates every few cleanup cycles
    if (dbUpdateQueue.size > 0 && (now - lastCleanupTime) > 60000) { // Every minute
      processBatchDatabaseUpdates();
      lastCleanupTime = now;
    }
  };

  // Helper function to cleanup user session
  const cleanupUserSession = (userId, session, reason) => {
    try {
      if (session.ws && session.ws.readyState === session.ws.OPEN) {
        session.ws.close(1000, `Session cleanup: ${reason}`);
      }

      if (session.heartbeatInterval) {
        clearInterval(session.heartbeatInterval);
      }

      activeUsers.delete(userId);
      dbUpdateQueue.add(userId); // Queue for batch database update

    } catch (err) {
      console.error(`Error cleaning up user ${userId}:`, err.message);
    }
  };

  // Batch database updates to reduce query load
  const processBatchDatabaseUpdates = async () => {
    if (dbUpdateQueue.size === 0) return;

    const userIds = Array.from(dbUpdateQueue);
    dbUpdateQueue.clear();

    try {
      // Batch update all users in single query
      await pool.query(
        'UPDATE users SET is_active = 0, processingactive = 0 WHERE id = ANY($1)',
        [userIds]
      );
      console.log(`Batch updated ${userIds.length} users to offline status`);
    } catch (err) {
      console.error('Error in batch database update:', err.message);
      // Re-queue failed updates
      userIds.forEach(id => dbUpdateQueue.add(id));
    }
  };

  // Run smart cleanup with adaptive intervals
  setInterval(performSmartCleanup, RESOURCE_OPTIMIZATION.INACTIVITY_CHECK_INTERVAL);
}

// Helper function to update user's active status in database with smart caching
const userStatusCache = new Map();
const STATUS_CACHE_DURATION = 60000; // Cache status for 1 minute

async function updateUserActiveStatus(userId, isActive) {
  try {
    const now = Date.now();
    const cacheKey = `${userId}_${isActive}`;
    const cached = userStatusCache.get(cacheKey);
    
    // Skip update if same status was recently set (avoid redundant queries)
    if (cached && (now - cached.timestamp) < STATUS_CACHE_DURATION) {
      return;
    }

    // Update is_active status in database
    await pool.query(
      'UPDATE users SET is_active = $1::integer, processingactive = $1::integer WHERE id = $2',
      [isActive ? 1 : 0, userId]
    );

    // Cache the status update
    userStatusCache.set(cacheKey, { timestamp: now });
    
    // Clean old cache entries periodically
    if (userStatusCache.size > 100) {
      for (const [key, value] of userStatusCache.entries()) {
        if (now - value.timestamp > STATUS_CACHE_DURATION * 2) {
          userStatusCache.delete(key);
        }
      }
    }

    // Suppressed user status update messages
  } catch (error) {
    // ✅ SILENT: Ignore all errors for status updates (non-critical)
  }
}