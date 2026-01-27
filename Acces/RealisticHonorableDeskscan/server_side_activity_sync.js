import { pool } from './db.js';

/**
 * Server-Side Processing Synchronization Service
 * Updates all active processing sessions continuously, regardless of user presence
 */

// 🛡️ Throttling لمنع UPDATE المتكررة لنفس المستخدم
const userUpdateThrottle = new Map(); // userId -> lastUpdateTime
const UPDATE_THROTTLE_MS = 60000; // دقيقة واحدة بين كل UPDATE لنفس المستخدم

function shouldThrottleUserUpdate(userId) {
  const now = Date.now();
  const lastUpdate = userUpdateThrottle.get(userId) || 0;
  
  if (now - lastUpdate < UPDATE_THROTTLE_MS) {
    return true; // تجاهل هذا التحديث
  }
  
  userUpdateThrottle.set(userId, now);
  return false;
}

// تنظيف throttle map كل 10 دقائق
setInterval(() => {
  const now = Date.now();
  for (const [userId, time] of userUpdateThrottle.entries()) {
    if (now - time > 300000) { // 5 دقائق
      userUpdateThrottle.delete(userId);
    }
  }
}, 600000);

/**
 * دالة تقريب المكافأة لتجنب الأرقام العشرية الطويلة (مثل 0.248883)
 * تقرب إلى 8 أماكن عشرية بشكل دقيق
 */
function roundReward(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return 0;
  }
  // تقريب إلى 8 أماكن عشرية
  return Math.round(amount * 100000000) / 100000000;
}

/**
 * 🔧 دالة تقريب للأعلى لأقرب 0.01
 * مثال: 0.27737 → 0.28
 */
function roundUpToTwoDecimals(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return 0;
  }
  return Math.ceil(amount * 100) / 100;
}

class ServerSideProcessingSync {
  constructor() {
    this.syncInterval = null;
    this.finalHourInterval = null;
    this.veryFinalInterval = null;
    this.syncFrequency = 3600000; // 60 minutes for general updates (further reduced load)
    this.finalHourFrequency = 1200000; // 20 minutes in final hour (further reduced)
    this.veryFinalFrequency = 600000; // 10 minutes in last 10 minutes (further reduced)
    this.isRunning = false;
    this.lastSyncTime = 0;
    this.minSyncGap = 1800000; // 30 minutes between updates (further increased)
    this.activeSessions = new Map();
    this.lastSessionCount = 0;
    this.quietMode = true; // Enable complete silent mode
    this.ultraQuietMode = true; // Ultra quiet mode
    this.maxConcurrentOperations = 1; // Further limit concurrent operations
    this.currentOperations = 0;
    this.skipCount = 0; // Track skipped operations
    this.maxSkips = 3; // Max skips before forcing update
    this.transactionCooldown = false; // Flag to pause processing sync after transactions
    this.cooldownTimer = null;
    this.startupRecoveryDone = false; // Flag to track if startup recovery has been done
  }

  /**
   * Start the optimized processing sync service
   */
  start() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // ✅ CRITICAL: استرداد الجلسات المنتهية عند بدء تشغيل السيرفر
    // هذا يضمن حفظ المكافآت للجلسات التي انتهت أثناء توقف السيرفر
    this.recoverExpiredSessions();

    // Initial lightweight scan to identify active sessions
    this.scanActiveSessions();

    // Regular lightweight sync (every 10 minutes)
    this.syncInterval = setInterval(() => {
      const now = Date.now();
      if (now - this.lastSyncTime < this.minSyncGap) {
        return;
      }
      this.lastSyncTime = now;
      this.scanActiveSessions();
    }, this.syncFrequency);

    // Final hour intensive monitoring (every 5 minutes for sessions near completion)
    this.finalHourInterval = setInterval(() => {
      this.monitorFinalHourSessions();
    }, this.finalHourFrequency);

    // Very final minutes intensive monitoring (every minute for sessions in last 10 minutes)
    this.veryFinalInterval = setInterval(() => {
      this.monitorVeryFinalMinutes();
    }, this.veryFinalFrequency);
  }

  /**
   * ✅ استرداد الجلسات المنتهية عند بدء تشغيل السيرفر
   * هذا يضمن حفظ المكافآت للجلسات التي انتهت أثناء توقف السيرفر
   * 🛡️ FIXED: يحسب الإحالات النشطة + ad boost بشكل صحيح
   */
  async recoverExpiredSessions() {
    if (this.startupRecoveryDone) {
      return; // تم الاسترداد بالفعل
    }

    try {
      console.log('[SERVER STARTUP] 🔄 جاري استرداد الجلسات المنتهية أثناء توقف السيرفر...');

      const nowSec = Math.floor(Date.now() / 1000);
      const processingDuration = 24 * 60 * 60; // 24 hours

      // البحث عن الجلسات المنتهية مع عدد الإحالات النشطة
      const expiredSessions = await pool.query(
        `SELECT u.id, u.name, u.processing_start_time_seconds, u.accumulatedReward,
                COALESCE(u.session_locked_boost, u.processing_boost_multiplier, 1.0) as locked_boost,
                COALESCE(u.ad_boost_active, false) as ad_boost_active,
                (SELECT COUNT(*) FROM referrals r 
                 JOIN users ref ON r.referee_id = ref.id 
                 WHERE r.referrer_id = u.id 
                 AND (ref.processing_active = 1 OR ref.is_active = 1)) as active_referral_count
         FROM users u
         WHERE u.processing_active = 1 
         AND u.processing_start_time_seconds IS NOT NULL 
         AND u.processing_start_time_seconds > 0
         AND (${nowSec} - u.processing_start_time_seconds) >= ${processingDuration}`
      );

      if (expiredSessions.rows.length === 0) {
        console.log('[SERVER STARTUP] ✅ لا توجد جلسات منتهية تحتاج استرداد');
        this.startupRecoveryDone = true;
        return;
      }

      console.log(`[SERVER STARTUP] 🔍 تم العثور على ${expiredSessions.rows.length} جلسة منتهية تحتاج معالجة`);

      // استيراد computeHashrateMultiplier
      const { computeHashrateMultiplier } = await import('./db.js');

      let successCount = 0;
      let errorCount = 0;

      for (const session of expiredSessions.rows) {
        try {
          const userId = session.id;
          const userName = session.name || `User ${userId}`;
          const existingAccumulated = parseFloat(session.accumulatedreward || 0);
          const adBoostActive = session.ad_boost_active === true;
          const activeReferralCount = parseInt(session.active_referral_count) || 0;

          // إذا كانت المكافأة المتراكمة موجودة بالفعل، فقط نوقف الجلسة
          if (existingAccumulated > 0.20) {
            console.log(`[RECOVERY] User ${userId} (${userName}): المكافأة موجودة بالفعل ${existingAccumulated.toFixed(8)} ACCESS`);
            
            // فقط نوقف الجلسة إذا كانت لا تزال نشطة
            await pool.query(
              `UPDATE users SET processing_active = 0 WHERE id = $1 AND processing_active = 1`,
              [userId]
            );
            successCount++;
            continue;
          }

          // 🛡️ FIXED: حساب المضاعف الصحيح من الإحالات + ad boost
          const boostCalc = computeHashrateMultiplier(activeReferralCount, adBoostActive);
          const boostMultiplier = boostCalc.multiplier;

          // 🔧 حساب المكافأة النهائية (الجلسة انتهت = 100%)
          const baseReward = 0.25;
          const baseWithBoost = baseReward * boostMultiplier;
          
          // 🔧 FIX: خذ الأعلى بين المتراكم والمبلغ الأساسي، ثم قرب للأعلى لأقرب 0.01
          const maxReward = Math.max(existingAccumulated, baseWithBoost);
          const finalReward = roundUpToTwoDecimals(maxReward);

          console.log(`[RECOVERY] User ${userId} (${userName}): المكافأة ${finalReward.toFixed(2)} ACCESS (accumulated: ${existingAccumulated.toFixed(8)}, boost: ${boostMultiplier.toFixed(2)}x)`);

          // حفظ المكافأة في accumulatedReward فقط
          await pool.query(
            `UPDATE users SET 
             processing_active = 0,
             accumulatedReward = $1::numeric(10,8)
             WHERE id = $2`,
            [finalReward, userId]
          );

          // تنظيف "Collecting..." من التاريخ
          await pool.query(
            `DELETE FROM processing_history 
             WHERE user_id = $1 AND (user_name = 'Collecting...' OR user_name LIKE '%Collecting%')`,
            [userId]
          ).catch(() => {}); // تجاهل الأخطاء

          console.log(`[RECOVERY] ✅ User ${userId} (${userName}): تم حفظ المكافأة ${finalReward.toFixed(2)} ACCESS بنجاح`);
          successCount++;

        } catch (sessionError) {
          console.error(`[RECOVERY] ❌ Error recovering session for user ${session.id}:`, sessionError.message);
          errorCount++;
        }
      }

      console.log(`[SERVER STARTUP] ✅ اكتمل استرداد الجلسات: ${successCount} نجاح, ${errorCount} خطأ`);
      this.startupRecoveryDone = true;

    } catch (error) {
      console.error('[SERVER STARTUP] ❌ Error recovering expired sessions:', error.message);
      this.startupRecoveryDone = true; // لمنع المحاولة مرة أخرى
    }
  }

  /**
   * Stop the optimized sync service
   */
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.finalHourInterval) {
      clearInterval(this.finalHourInterval);
      this.finalHourInterval = null;
    }
    if (this.veryFinalInterval) {
      clearInterval(this.veryFinalInterval);
      this.veryFinalInterval = null;
    }
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    this.isRunning = false;
    this.activeSessions.clear();
    console.log('[OPTIMIZED PROCESSING] Smart sync stopped');
  }

  /**
   * ✅ معالجة الجلسات المنتهية (processing_active = 1 لكن وقتها انتهى)
   * تُستدعى في كل فحص دوري لضمان عدم تفويت أي جلسة
   * 🛡️ FIXED: يحسب الإحالات النشطة + ad boost بشكل صحيح
   */
  async processExpiredSessions(nowSec, processingDuration) {
    try {
      // البحث عن الجلسات المنتهية مع عدد الإحالات النشطة
      const expiredSessions = await Promise.race([
        pool.query(
          `SELECT u.id, u.name, u.processing_start_time_seconds, u.accumulatedReward,
                  COALESCE(u.session_locked_boost, u.processing_boost_multiplier, 1.0) as locked_boost,
                  COALESCE(u.ad_boost_active, false) as ad_boost_active,
                  (SELECT COUNT(*) FROM referrals r 
                   JOIN users ref ON r.referee_id = ref.id 
                   WHERE r.referrer_id = u.id 
                   AND (ref.processing_active = 1 OR ref.is_active = 1)) as active_referral_count
           FROM users u
           WHERE u.processing_active = 1 
           AND u.processing_start_time_seconds IS NOT NULL 
           AND u.processing_start_time_seconds > 0
           AND (${nowSec} - u.processing_start_time_seconds) >= ${processingDuration}
           LIMIT 20`
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Expired sessions query timeout')), 10000)
        )
      ]);

      if (expiredSessions.rows.length === 0) {
        return; // لا توجد جلسات منتهية
      }

      console.log(`[PERIODIC CHECK] 🔄 معالجة ${expiredSessions.rows.length} جلسة منتهية...`);

      // استيراد computeHashrateMultiplier
      const { computeHashrateMultiplier } = await import('./db.js');

      for (const session of expiredSessions.rows) {
        try {
          const userId = session.id;
          const existingAccumulated = parseFloat(session.accumulatedreward || 0);
          const adBoostActive = session.ad_boost_active === true;
          const activeReferralCount = parseInt(session.active_referral_count) || 0;

          // إذا كانت المكافأة المتراكمة موجودة بالفعل (≥0.20)، فقط نوقف الجلسة
          if (existingAccumulated > 0.20) {
            await pool.query(
              `UPDATE users SET processing_active = 0 WHERE id = $1`,
              [userId]
            );
            continue;
          }

          // 🛡️ FIXED: حساب المضاعف الصحيح من الإحالات + ad boost
          const boostCalc = computeHashrateMultiplier(activeReferralCount, adBoostActive);
          const boostMultiplier = boostCalc.multiplier;

          // 🔧 حساب المكافأة النهائية
          const baseReward = 0.25;
          const baseWithBoost = baseReward * boostMultiplier;
          
          // 🔧 FIX: خذ الأعلى بين المتراكم والمبلغ الأساسي، ثم قرب للأعلى لأقرب 0.01
          const maxReward = Math.max(existingAccumulated, baseWithBoost);
          const finalReward = roundUpToTwoDecimals(maxReward);

          // حفظ المكافأة في accumulatedReward فقط وإيقاف الجلسة
          await pool.query(
            `UPDATE users SET 
             processing_active = 0,
             accumulatedReward = $1::numeric(10,8)
             WHERE id = $2`,
            [finalReward, userId]
          );

          // تنظيف "Collecting..." من التاريخ
          pool.query(
            `DELETE FROM processing_history 
             WHERE user_id = $1 AND (user_name = 'Collecting...' OR user_name LIKE '%Collecting%')`,
            [userId]
          ).catch(() => {});

          console.log(`[PERIODIC] ✅ User ${userId}: حفظ ${finalReward.toFixed(2)} ACCESS (accumulated: ${existingAccumulated.toFixed(8)}, boost: ${boostMultiplier.toFixed(2)}x)`);

        } catch (sessionError) {
          console.error(`[PERIODIC] Error processing expired session ${session.id}:`, sessionError.message);
        }
      }

    } catch (error) {
      // Silent fail - لا نريد إيقاف الـ scan بسبب خطأ في معالجة الجلسات المنتهية
      if (!error.message.includes('timeout')) {
        console.error('[PERIODIC] Error processing expired sessions:', error.message);
      }
    }
  }

  /**
   * تفعيل فترة هدوء بعد المعاملات لتجنب التضارب
   */
  startTransactionCooldown() {
    this.transactionCooldown = true;

    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
    }

    // فترة هدوء لمدة 60 ثانية بعد المعاملات
    this.cooldownTimer = setTimeout(() => {
      this.transactionCooldown = false;
      console.log('[PROCESSING SYNC] Transaction cooldown ended, resuming normal operations');
    }, 60000);

    console.log('[PROCESSING SYNC] Transaction cooldown started - pausing processing sync for 60 seconds');
  }

  /**
   * مراقبة مكثفة جداً للدقائق الأخيرة (آخر 10 دقائق)
   */
  async monitorVeryFinalMinutes() {
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const processingDuration = 24 * 60 * 60;
      const veryFinalThreshold = 10 * 60; // آخر 10 دقائق

      // جلب الجلسات في آخر 10 دقائق فقط
      const veryFinalSessions = await pool.query(
        `SELECT id, processing_start_time_seconds, name, accumulatedReward,
                COALESCE(session_locked_boost, processing_boost_multiplier, 1.0) as locked_boost
         FROM users 
         WHERE processing_active = 1 AND processing_start_time_seconds IS NOT NULL 
         AND processing_start_time_seconds > 0
         AND (${nowSec} - processing_start_time_seconds) >= ${processingDuration - veryFinalThreshold}
         AND (${nowSec} - processing_start_time_seconds) < ${processingDuration}`
      );

      if (veryFinalSessions.rows.length === 0) {
        return; // لا توجد جلسات في الدقائق الأخيرة
      }

      console.log(`[VERY FINAL] Intensive monitoring for ${veryFinalSessions.rows.length} sessions in last 10 minutes`);

      for (const session of veryFinalSessions.rows) {
        try {
          const userId = session.id;
          const startTimeSec = parseInt(session.processing_start_time_seconds);
          const elapsedSec = nowSec - startTimeSec;
          const remainingSec = Math.max(0, processingDuration - elapsedSec);

          // إذا انتهى التعدين تماماً أو بقي أقل من 5 ثواني
          if (remainingSec <= 5) {
            console.log(`[COMPLETION] Processing completion for user ${userId} (remaining: ${remainingSec}s)`);
            await this.completeProcessingSession(userId);
            continue;
          }

          // حساب المكافأة مع التعزيز المثبت
          const boostMultiplier = parseFloat(session.locked_boost || 1.0);
          const baseReward = 0.25;
          const boostedReward = baseReward * boostMultiplier;
          
          // ✅ CRITICAL: إذا بقي أقل من دقيقة، نقرب للقيمة النهائية
          let calculatedAccumulated;
          if (remainingSec <= 60) {
            // آخر دقيقة - تقريب تدريجي للقيمة النهائية
            const finalProgress = 1 - (remainingSec / processingDuration);
            calculatedAccumulated = roundReward(boostedReward * Math.min(1, finalProgress + 0.0001));
          } else {
            const progressPercentage = Math.min(1, elapsedSec / processingDuration);
            calculatedAccumulated = roundReward(boostedReward * progressPercentage);
          }

          const remainingMinutes = Math.floor(remainingSec / 60);
          const remainingSecondsDisplay = remainingSec % 60;
          console.log(`[COUNTDOWN] User ${userId}: ${remainingMinutes}:${remainingSecondsDisplay.toString().padStart(2, '0')} remaining, Reward: ${calculatedAccumulated.toFixed(8)} ACCESS (final: ${boostedReward.toFixed(8)})`);

        } catch (userError) {
          console.error(`Error processing final minutes for user ${session.id}:`, userError.message);
        }
      }

    } catch (error) {
      console.error('[VERY FINAL] Error monitoring final minutes:', error.message);
    }
  }

  /**
   * Lightweight scan to identify active sessions - يتم كل 10 دقائق
   */
  async scanActiveSessions() {
    try {
      // تخطي العملية إذا كانت في فترة الهدوء بعد المعاملات
      if (this.transactionCooldown) {
        console.log('[PROCESSING SYNC] Skipping scan during transaction cooldown');
        return;
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const processingDuration = 24 * 60 * 60; // 24 hours

      // ✅ أولاً: معالجة أي جلسات منتهية (processing_active = 1 لكن وقتها انتهى)
      await this.processExpiredSessions(nowSec, processingDuration);

      // Lightweight query for active sessions only مع حماية من انتهاء الوقت
      const activeSessions = await Promise.race([
        pool.query(
          `SELECT id, processing_start_time_seconds, name
           FROM users 
           WHERE processing_active = 1 AND processing_start_time_seconds IS NOT NULL 
           AND processing_start_time_seconds > 0
           AND (${nowSec} - processing_start_time_seconds) < ${processingDuration}
           LIMIT 100`
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Active sessions query timeout')), 15000)
        )
      ]);

      // Update active sessions list
      this.activeSessions.clear();

      for (const session of activeSessions.rows) {
        const userId = session.id;
        const startTimeSec = parseInt(session.processing_start_time_seconds);
        const elapsedSec = nowSec - startTimeSec;
        const remainingSec = processingDuration - elapsedSec;

        this.activeSessions.set(userId, {
          startTime: startTimeSec,
          remainingTime: remainingSec,
          userName: session.name,
          lastChecked: nowSec
        });
      }

      // تحديث أرصدة جميع المستخدمين النشطين (ليس فقط من هم على الصفحة)
      await this.updateAllActiveProcessors(nowSec);

      // Ultra quiet mode - suppress all session tracking messages
      this.lastSessionCount = this.activeSessions.size;

      // Remove expired sessions from tracking
      this.cleanupExpiredSessions(nowSec);

    } catch (error) {
      console.error('[OPTIMIZED PROCESSING] Session scan error:', error.message);
    }
  }

  /**
   * تحديث جميع المستخدمين النشطين في التعدين (حتى المنقطعين) مع حماية من انتهاء الوقت
   */
  async updateAllActiveProcessors(nowSec) {
    let client;
    try {
      const processingDuration = 24 * 60 * 60; // 24 hours

      // Get connection with timeout protection
      client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 10000)
        )
      ]);

      // جلب جميع المستخدمين النشطين في التعدين مع حماية من انتهاء الوقت
      const activeProcessors = await Promise.race([
        client.query(
          `SELECT id, processing_start_time_seconds, name, accumulatedReward, 
                  COALESCE(session_locked_boost, processing_boost_multiplier, 1.0) as locked_boost
           FROM users 
           WHERE processing_active = 1 AND processing_start_time_seconds IS NOT NULL 
           AND processing_start_time_seconds > 0
           AND (${nowSec} - processing_start_time_seconds) < ${processingDuration}
           LIMIT 50` // Limit results to prevent large queries
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout')), 20000)
        )
      ]);

      if (activeProcessors.rows.length === 0) {
        return; // لا يوجد معدنون نشطون
      }

      // Silent - reduce console spam

      // معالجة كل معدن بشكل منفصل مع حماية من انتهاء الوقت
      for (const processor of activeProcessors.rows) {
        try {
          await Promise.race([
            this.updateSingleProcessor(processor, nowSec, processingDuration),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Processor update timeout')), 5000)
            )
          ]);
        } catch (processorError) {
          if (processorError.message.includes('timeout')) {
            console.warn(`Timeout updating processor ${processor.id}, skipping...`);
          } else {
            console.error(`Error updating processor ${processor.id}:`, processorError.message);
          }
        }
      }

    } catch (error) {
      if (error.message.includes('timeout')) {
        console.warn('[BACKGROUND PROCESSING] Database timeout, will retry next cycle');
      } else {
        console.error('[BACKGROUND PROCESSING] Error updating processors:', error.message);
      }
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.error('Error releasing client:', releaseError.message);
        }
      }
    }
  }

  /**
   * تحديث معدن واحد بناءً على الوقت المنقضي - USES LOCKED BOOST
   */
  async updateSingleProcessor(processor, nowSec, processingDuration) {
    const userId = processor.id;
    const startTimeSec = parseInt(processor.processing_start_time_seconds);
    const elapsedSec = nowSec - startTimeSec;
    const remainingSec = Math.max(0, processingDuration - elapsedSec);

    // إذا انتهى التعدين، أكمل الجلسة
    if (remainingSec <= 0) {
      await this.completeProcessingSession(userId);
      return;
    }

    // حساب التقدم
    const progressPercentage = Math.min(1, elapsedSec / processingDuration);

    // SMART BOOST: استخدام المضاعف المثبت من بداية الجلسة
    const boostMultiplier = parseFloat(processor.locked_boost || 1.0);

    // حساب المكافأة المتراكمة باستخدام المضاعف المثبت
    const baseReward = 0.25;
    const boostedReward = baseReward * boostMultiplier;
    // استخدام دالة التقريب لتجنب الأرقام العشرية الطويلة
    const calculatedAccumulated = roundReward(boostedReward * progressPercentage);

    // ✅ NO UPDATE - Just calculate for logging
    // Database is only updated when session COMPLETES
    
    // تسجيل فقط للساعة الأخيرة (للمراقبة فقط)
    if (remainingSec <= 3600 && calculatedAccumulated >= 0.01) {
      // Silent - no logging to reduce noise
    }
  }

  /**
   * مراقبة مكثفة للجلسات في الساعة الأخيرة فقط
   */
  async monitorFinalHourSessions() {
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const processingDuration = 24 * 60 * 60;
      const finalHourThreshold = 60 * 60; // آخر ساعة
      const finalMinutesThreshold = 10 * 60; // آخر 10 دقائق

      // جلب جميع الجلسات في الساعة الأخيرة مباشرة من قاعدة البيانات
      const finalHourSessions = await pool.query(
        `SELECT id, processing_start_time_seconds, name, accumulatedReward,
                COALESCE(session_locked_boost, processing_boost_multiplier, 1.0) as locked_boost
         FROM users 
         WHERE processing_active = 1 AND processing_start_time_seconds IS NOT NULL 
         AND processing_start_time_seconds > 0
         AND (${nowSec} - processing_start_time_seconds) >= ${processingDuration - finalHourThreshold}
         AND (${nowSec} - processing_start_time_seconds) < ${processingDuration}`
      );

      if (finalHourSessions.rows.length === 0) {
        return; // لا توجد جلسات في الساعة الأخيرة
      }

      console.log(`[FINAL HOUR] Intensive monitoring for ${finalHourSessions.rows.length} sessions in final hour`);

      // تحديث مكثف للجلسات في الساعة الأخيرة
      const updates = [];

      for (const session of finalHourSessions.rows) {
        try {
          const userId = session.id;
          const startTimeSec = parseInt(session.processing_start_time_seconds);
          const elapsedSec = nowSec - startTimeSec;
          const remainingSec = Math.max(0, processingDuration - elapsedSec);
          const progressPercentage = Math.min(1, elapsedSec / processingDuration);

          // إذا انتهى التعدين تماماً
          if (remainingSec <= 0) {
            await this.completeProcessingSession(userId);
            continue;
          }

          // حساب المكافأة مع التعزيز المثبت
          const boostMultiplier = parseFloat(session.locked_boost || 1.0);
          const baseReward = 0.25;
          const boostedReward = baseReward * boostMultiplier;
          // استخدام دالة التقريب لدقة الحساب
          const calculatedAccumulated = roundReward(boostedReward * progressPercentage);

          updates.push({
            userId,
            accumulated: calculatedAccumulated,
            progress: progressPercentage,
            boost: boostMultiplier,
            remainingMinutes: Math.floor(remainingSec / 60)
          });

          // تحديث الجلسة المحلية إذا كانت موجودة
          if (this.activeSessions.has(userId)) {
            const sessionData = this.activeSessions.get(userId);
            sessionData.remainingTime = remainingSec;
            sessionData.lastChecked = nowSec;
          }

        } catch (userError) {
          console.error(`Error processing final hour session for user ${session.id}:`, userError.message);
        }
      }

      // تنفيذ التحديثات في batch
      if (updates.length > 0) {
        await this.executeFinalHourUpdates(updates);
      }

    } catch (error) {
      console.error('[OPTIMIZED PROCESSING] Error monitoring final hour:', error.message);
    }
  }

  /**
   * تنفيذ تحديثات الساعة الأخيرة - ✅ معطل لمنع التنافس على قاعدة البيانات
   * المكافأة تُحسب محلياً وتُحفظ فقط عند انتهاء الجلسة
   */
  async executeFinalHourUpdates(updates) {
    // ✅ DISABLED - No database updates during processing
    // Reward is calculated locally and saved only when session completes
    return;
  }

  /**
   * تنظيف الجلسات المنتهية من الذاكرة
   */
  cleanupExpiredSessions(nowSec) {
    let cleanedCount = 0;

    for (const [userId, sessionData] of this.activeSessions) {
      if (sessionData.remainingTime <= 0) {
        this.activeSessions.delete(userId);
        cleanedCount++;
      }
    }

    // Ultra quiet mode - suppress cleanup messages
  }

  /**
   * نسخة محسنة من syncAllActiveProcessing - تستخدم فقط عند الحاجة
   */
  async syncAllActiveProcessing() {
    // ✅ DISABLED - No database updates during processing
    return;
  }

  /**
   * Update processing progress - ✅ معطل لمنع التنافس
   */
  async updateUserProcessingProgress(userId, startTimeSec, nowSec) {
    // ✅ DISABLED - No database updates during processing
    // Reward is calculated locally and saved only when session completes
    return;
  }

  /**
   * Calculate referral boost multiplier for a user with enhanced timeout protection
   */
  async calculateReferralBoost(userId, nowSec) {
    let client;
    try {
      // Get connection with longer timeout
      client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 8000)
        )
      ]);

      // Query with longer timeout and simplified query
      const referralsResponse = await Promise.race([
        client.query(
          `SELECT r.id, u.processing_active, u.processing_end_time, u.is_active 
           FROM referrals r
           JOIN users u ON r.referee_id = u.id
           WHERE r.referrer_id = $1
           LIMIT 10`, // Reduce limit further to speed up query
          [userId]
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout')), 15000)
        )
      ]);

      let activeReferralCount = 0;
      const nowMs = nowSec * 1000;

      referralsResponse.rows.forEach(ref => {
        const processingActive = parseInt(ref.processing_active) || 0;
        const isActive = parseInt(ref.is_active) || 0;
        const endTime = parseInt(ref.processing_end_time) || 0;
        const isActivelyProcessing = (processingActive === 1 || isActive === 1 || (endTime > nowMs));

        if (isActivelyProcessing) {
          activeReferralCount++;
        }
      });

      // Get user's ad boost status and calculate boost multiplier
      const { computeHashrateMultiplier, getAdBoostStatus } = await import('./db.js');
      const adBoostStatus = await getAdBoostStatus(userId);

      // Calculate boost multiplier using centralized function
      const hashrateCalc = computeHashrateMultiplier(activeReferralCount, adBoostStatus.boostActive);
      return hashrateCalc.multiplier;

    } catch (error) {
      if (error.message.includes('timeout')) {
        console.warn(`Referral boost calculation timeout for user ${userId}, using default`);
      } else {
        console.error(`Error calculating referral boost for user ${userId}:`, error.message);
      }
      return 1.0; // Default to no boost on error
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.error('Error releasing client:', releaseError.message);
        }
      }
    }
  }

  /**
   * Complete a processing session and transfer rewards (no history logging here)
   */
  async completeProcessingSession(userId) {
    try {
      console.log(`[SERVER-SIDE PROCESSING] Completing processing session for user ${userId}`);

      // AUTO-CLEANUP: حذف "Collecting..." من التاريخ عند توقف التعدين
      try {
        const cleanupResult = await pool.query(
          `DELETE FROM processing_history 
           WHERE user_id = $1 
           AND (user_name = 'Collecting...' OR user_name LIKE '%Collecting%')`,
          [userId]
        );
        if (cleanupResult.rowCount > 0) {
          console.log(`[AUTO-CLEANUP] Removed ${cleanupResult.rowCount} "Collecting..." entries for user ${userId}`);
        }
      } catch (cleanupError) {
        console.error(`[AUTO-CLEANUP] Error removing Collecting entries:`, cleanupError.message);
      }

      // Import completion function
      const { handleSimplifiedProcessingAPI } = await import('./countdown_simplifier.js');

      // Get current user data including all reward fields AND boost info
      const userResult = await pool.query(
        `SELECT u.accumulatedReward, u.current_processing_reward, u.accumulated_processing_reward, 
                COALESCE(u.session_locked_boost, u.processing_boost_multiplier, 1.0) as locked_boost, 
                u.processing_start_time, u.processing_end_time, u.coins, u.email,
                u.ad_boost_active,
                (SELECT COUNT(*) FROM referrals r 
                 JOIN users ref ON r.referee_id = ref.id 
                 WHERE r.referrer_id = u.id 
                 AND (ref.processing_active = 1 OR ref.is_active = 1)) as active_referrals
         FROM users u WHERE u.id = $1`,
        [userId]
      );

      if (userResult.rows.length > 0) {
        const userData = userResult.rows[0];

        // Get all possible accumulated values
        const accumulatedReward = parseFloat(userData.accumulatedreward || 0);
        const currentProcessingReward = parseFloat(userData.current_processing_reward || 0);
        const accumulatedProcessingReward = parseFloat(userData.accumulated_processing_reward || 0);

        // SMART BOOST: استخدام المضاعف المثبت من بداية الجلسة
        const finalBoostMultiplier = parseFloat(userData.locked_boost || 1.0);
        
        // Get session boost details
        const activeReferrals = parseInt(userData.active_referrals || 0);
        const adBoostActive = userData.ad_boost_active === true;
        const userEmail = userData.email || `User #${userId}`;
        const currentBalance = parseFloat(userData.coins || 0);

        // Get the highest accumulated value
        const highestAccumulated = Math.max(
          accumulatedReward,
          currentProcessingReward,
          accumulatedProcessingReward
        );

        // Calculate minimum guaranteed reward (0.25 with boost)
        const baseReward = 0.25;
        const guaranteedMinimum = baseReward * finalBoostMultiplier;

        // 🔧 FIX: خذ الأعلى ثم قرب للأعلى لأقرب 0.01 (0.27737 → 0.28)
        const maxReward = Math.max(highestAccumulated, guaranteedMinimum);
        const finalReward = roundUpToTwoDecimals(maxReward);

        // ✅ SESSION SUMMARY: Show complete session details at end
        const newBalance = roundUpToTwoDecimals(currentBalance + finalReward);
        const referralBoost = activeReferrals * 0.4;
        const adBoostValue = adBoostActive ? 1.2 : 0;
        
        console.log(`\n📋 ═══════════════════════════════════════════════════════════`);
        console.log(`📋 [SESSION COMPLETED] ${userEmail}`);
        console.log(`📋 ───────────────────────────────────────────────────────────`);
        console.log(`📋   💰 Reward Earned: +${finalReward.toFixed(2)} ACCESS`);
        console.log(`📋   💼 New Balance: ${newBalance.toFixed(2)} ACCESS`);
        console.log(`📋   ⚡ Boost Multiplier: ${finalBoostMultiplier.toFixed(2)}x`);
        console.log(`📋   👥 Active Referrals: ${activeReferrals} (+${referralBoost.toFixed(1)} MH/s)`);
        console.log(`📋   🎬 Ad Boost: ${adBoostActive ? '✅ Active (+1.2 MH/s)' : '❌ Not Used'}`);
        console.log(`📋 ═══════════════════════════════════════════════════════════\n`);

        // Use the simplified countdown completion system (no history logging)
        const mockReq = {
          method: 'POST',
          url: '/api/processing/countdown/complete',
          on: (event, callback) => {
            if (event === 'data') {
              callback(JSON.stringify({ userId, finalReward }));
            } else if (event === 'end') {
              callback();
            }
          }
        };

        const mockRes = {
          writeHead: () => {},
          end: (data) => {
            const result = JSON.parse(data);
            if (result.success) {
              console.log(`[SERVER-SIDE PROCESSING] Processing completed for user ${userId}: ${finalReward.toFixed(8)} ACCESS stored for next session start`);
            } else {
              console.error(`[SERVER-SIDE PROCESSING] Failed to complete processing for user ${userId}: ${result.error}`);
            }
          }
        };

        // Use simplified processing API for completion
        await handleSimplifiedProcessingAPI(mockReq, mockRes, '/api/processing/countdown/complete', 'POST');
      }

    } catch (error) {
      console.error(`[SERVER-SIDE PROCESSING] Error completing processing for user ${userId}:`, error);
    }
  }
}

// Create and export singleton instance
export const serverSideProcessingSync = new ServerSideProcessingSync();

// Auto-start when module is imported
serverSideProcessingSync.start();

// ⚠️ ملاحظة مهمة: لا نضع process.exit() هنا!
// المعالج الرئيسي للـ shutdown موجود في server.js فقط
// هذا يمنع التعارض بين معالجات متعددة
// سيتم استدعاء serverSideProcessingSync.stop() من server.js عند الإغلاق