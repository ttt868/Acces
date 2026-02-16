/**
 * Boost Reminder Notification System
 * Sends a notification to users who have an active session
 * but have NOT activated their ad-boost, reminding them to boost their rewards.
 * 
 * RULES:
 * - Only targets users with processing_active = 1 AND ad_boost_active = false
 * - Session must be at least 40% done (to catch mid-session + near-end)
 * - Minimum 2-day gap between boost reminders per user
 * - Cordova users (FCM) get FCM only, Web users get Web Push only (no duplicates)
 * - Runs every 4 hours
 */

import webpush from 'web-push';
import { pool } from './db.js';
import fcmService from './fcm-service.js';

// Configure webpush
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@access-network.com';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

/**
 * Get boost reminder message based on session progress and language
 */
function getBoostMessage(progressPercent, userLang) {
  const lang = (userLang || 'en').slice(0, 2).toLowerCase();

  // Two tiers: mid-session (40-75%) and near-end (75%+)
  const nearEnd = progressPercent >= 75;

  const messages = {
    en: {
      mid: { title: 'Boost Your Session ⚡', body: 'Your session is running — activate Boost to multiply your bonuses!' },
      end: { title: 'Session Almost Done ⏳', body: 'Your session is nearly over. Activate Boost before it ends!' }
    },
    ar: {
      mid: { title: 'عزّز جلستك ⚡', body: 'جلستك قيد التشغيل — فعّل التعزيز لمضاعفة نقاطك!' },
      end: { title: 'الجلسة على وشك الانتهاء ⏳', body: 'جلستك قاربت على الانتهاء. فعّل التعزيز قبل فوات الأوان!' }
    },
    fr: {
      mid: { title: 'Boostez votre session ⚡', body: 'Votre session est en cours — activez le Boost pour multiplier vos bonus !' },
      end: { title: 'Session presque terminée ⏳', body: 'Votre session se termine bientôt. Activez le Boost avant la fin !' }
    },
    de: {
      mid: { title: 'Sitzung boosten ⚡', body: 'Ihre Sitzung läuft — aktivieren Sie den Boost, um Ihre Boni zu vervielfachen!' },
      end: { title: 'Sitzung fast vorbei ⏳', body: 'Ihre Sitzung endet bald. Aktivieren Sie den Boost!' }
    },
    es: {
      mid: { title: 'Potencia tu sesión ⚡', body: '¡Tu sesión está en curso — activa el Boost para multiplicar tus bonos!' },
      end: { title: 'Sesión casi terminada ⏳', body: '¡Tu sesión casi termina. Activa el Boost antes de que acabe!' }
    },
    tr: {
      mid: { title: 'Oturumunuzu güçlendirin ⚡', body: 'Oturumunuz devam ediyor — bonuslarınızı artırmak için Boost aktif edin!' },
      end: { title: 'Oturum bitmek üzere ⏳', body: 'Oturumunuz sona eriyor. Boost hemen aktif edin!' }
    },
    ru: {
      mid: { title: 'Усильте сессию ⚡', body: 'Ваша сессия идёт — активируйте Буст для умножения бонусов!' },
      end: { title: 'Сессия почти завершена ⏳', body: 'Ваша сессия скоро закончится. Активируйте Буст!' }
    },
    zh: {
      mid: { title: '加速会话 ⚡', body: '会话进行中——激活加速以倍增您的奖金！' },
      end: { title: '会话即将结束 ⏳', body: '会话即将结束。赶快激活加速！' }
    },
    ja: {
      mid: { title: 'セッションをブースト ⚡', body: 'セッション進行中 — ブーストでボーナスを倍増させましょう！' },
      end: { title: 'セッション間もなく終了 ⏳', body: 'セッションがまもなく終了します。ブーストを有効にしましょう！' }
    },
    ko: {
      mid: { title: '세션 부스트 ⚡', body: '세션 진행 중 — 부스트를 활성화하여 보너스를 늘리세요!' },
      end: { title: '세션 곧 종료 ⏳', body: '세션이 곧 끝납니다. 부스트를 활성화하세요!' }
    },
    pt: {
      mid: { title: 'Turbine sua sessão ⚡', body: 'Sua sessão está ativa — ative o Boost para multiplicar seus bônus!' },
      end: { title: 'Sessão quase acabando ⏳', body: 'Sua sessão está quase no fim. Ative o Boost agora!' }
    },
    hi: {
      mid: { title: 'सत्र बूस्ट करें ⚡', body: 'आपका सत्र चल रहा है — बूस्ट सक्रिय करें और बोनस बढ़ाएं!' },
      end: { title: 'सत्र लगभग समाप्त ⏳', body: 'सत्र समाप्त होने वाला है। अभी बूस्ट सक्रिय करें!' }
    },
    it: {
      mid: { title: 'Potenzia la sessione ⚡', body: 'La sessione è in corso — attiva il Boost per moltiplicare i tuoi bonus!' },
      end: { title: 'Sessione quasi finita ⏳', body: 'La sessione sta per finire. Attiva il Boost ora!' }
    },
    id: {
      mid: { title: 'Boost Sesi Anda ⚡', body: 'Sesi Anda berjalan — aktifkan Boost untuk melipatgandakan bonus Anda!' },
      end: { title: 'Sesi Hampir Selesai ⏳', body: 'Sesi hampir berakhir. Aktifkan Boost sekarang!' }
    },
    pl: {
      mid: { title: 'Przyspiesz sesję ⚡', body: 'Twoja sesja trwa — aktywuj Boost, aby zwielokrotnić swoje bonusy!' },
      end: { title: 'Sesja prawie skończona ⏳', body: 'Sesja dobiega końca. Aktywuj Boost teraz!' }
    }
  };

  const langMsgs = messages[lang] || messages['en'];
  return nearEnd ? langMsgs.end : langMsgs.mid;
}

/**
 * Main function: Find users with active sessions who haven't activated boost
 * and send them a reminder notification
 */
async function sendBoostReminderNotifications() {
  try {
    let successCount = 0;
    let failCount = 0;
    const processedUserIds = new Set();
    const nowSec = Math.floor(Date.now() / 1000);

    // ============================================================
    // PHASE 1: FCM users (Cordova) -> FCM only
    // ============================================================
    const fcmUsersResult = await pool.query(`
      SELECT DISTINCT ON (u.id)
        u.id as user_id,
        u.language as user_language,
        u.processing_start_time_seconds,
        u.processing_duration_seconds
      FROM users u
      INNER JOIN fcm_tokens f ON u.id = f.user_id
      WHERE 
        u.processing_active = 1
        AND COALESCE(u.ad_boost_active, false) = false
        AND u.processing_start_time_seconds IS NOT NULL
        AND u.processing_duration_seconds IS NOT NULL
        AND u.processing_duration_seconds > 0
        AND (
          u.last_boost_reminder IS NULL 
          OR u.last_boost_reminder < NOW() - INTERVAL '2 days'
        )
      ORDER BY u.id
      LIMIT 100
    `);

    console.log('[BOOST-REMINDER] Phase 1: Found ' + fcmUsersResult.rows.length + ' FCM users to check');

    for (const user of fcmUsersResult.rows) {
      if (processedUserIds.has(user.user_id)) continue;

      const startSec = parseInt(user.processing_start_time_seconds) || 0;
      const durationSec = parseInt(user.processing_duration_seconds) || 86400;
      const elapsed = nowSec - startSec;
      const progressPercent = Math.min(100, Math.round((elapsed / durationSec) * 100));

      // Only send if session is 40%+ done
      if (progressPercent < 40) continue;

      processedUserIds.add(user.user_id);

      try {
        const userLang = user.user_language || 'en';
        const message = getBoostMessage(progressPercent, userLang);

        let sent = false;
        if (fcmService && typeof fcmService.sendFCMNotification === 'function') {
          const result = await fcmService.sendFCMNotification(user.user_id, message.title, message.body, {
            type: 'boost-reminder',
            progressPercent: String(progressPercent)
          });
          if (result && result.success) sent = true;
        }

        if (sent) {
          successCount++;
          await pool.query(
            'UPDATE users SET last_boost_reminder = NOW() WHERE id = $1',
            [user.user_id]
          );
          console.log('[BOOST-REMINDER] FCM sent to user ' + user.user_id + ' (' + progressPercent + '% done)');
        }
      } catch (err) {
        failCount++;
        console.error('[BOOST-REMINDER] FCM error for user ' + user.user_id + ':', err.message);
      }
    }

    // ============================================================
    // PHASE 2: Web Push ONLY users (no FCM = browser only)
    // ============================================================
    const excludeArray = Array.from(processedUserIds);
    const excludeParam = excludeArray.length > 0 ? excludeArray : [0];

    const webPushUsersResult = await pool.query(`
      SELECT DISTINCT ON (ps.user_id)
        u.id as user_id,
        u.language as user_language,
        u.processing_start_time_seconds,
        u.processing_duration_seconds,
        ps.endpoint,
        ps.p256dh,
        ps.auth
      FROM users u
      INNER JOIN push_subscriptions ps ON u.id::TEXT = ps.user_id
      LEFT JOIN fcm_tokens f ON u.id = f.user_id
      WHERE 
        ps.revoked_at IS NULL
        AND f.user_id IS NULL
        AND u.processing_active = 1
        AND COALESCE(u.ad_boost_active, false) = false
        AND u.processing_start_time_seconds IS NOT NULL
        AND u.processing_duration_seconds IS NOT NULL
        AND u.processing_duration_seconds > 0
        AND (
          u.last_boost_reminder IS NULL 
          OR u.last_boost_reminder < NOW() - INTERVAL '2 days'
        )
        AND u.id != ALL($1::int[])
      ORDER BY ps.user_id, ps.created_at DESC
      LIMIT 100
    `, [excludeParam]);

    console.log('[BOOST-REMINDER] Phase 2: Found ' + webPushUsersResult.rows.length + ' Web Push users to check');

    for (const user of webPushUsersResult.rows) {
      if (processedUserIds.has(user.user_id)) continue;

      const startSec = parseInt(user.processing_start_time_seconds) || 0;
      const durationSec = parseInt(user.processing_duration_seconds) || 86400;
      const elapsed = nowSec - startSec;
      const progressPercent = Math.min(100, Math.round((elapsed / durationSec) * 100));

      if (progressPercent < 40) continue;

      processedUserIds.add(user.user_id);

      try {
        const subscription = {
          endpoint: user.endpoint,
          keys: { p256dh: user.p256dh, auth: user.auth }
        };

        const payload = JSON.stringify({
          type: 'boost-reminder',
          tag: 'boost-reminder',
          progressPercent: progressPercent,
          url: '/',
          timestamp: Date.now()
        });

        await webpush.sendNotification(subscription, payload);
        successCount++;

        await pool.query(
          'UPDATE users SET last_boost_reminder = NOW() WHERE id = $1',
          [user.user_id]
        );

        console.log('[BOOST-REMINDER] Web Push sent to user ' + user.user_id + ' (' + progressPercent + '% done)');
      } catch (pushError) {
        failCount++;
        if (pushError.statusCode === 410 || pushError.statusCode === 404 || pushError.statusCode === 403) {
          try {
            await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [user.endpoint]);
          } catch (delErr) { /* ignore */ }
        }
        console.error('[BOOST-REMINDER] Web Push error for user ' + user.user_id + ':', pushError.message || pushError.statusCode);
      }
    }

    console.log('[BOOST-REMINDER] Complete: ' + successCount + ' sent, ' + failCount + ' failed, ' + processedUserIds.size + ' users processed');
    return { sent: successCount, failed: failCount, processed: processedUserIds.size };

  } catch (error) {
    console.error('[BOOST-REMINDER] System error:', error);
    return { sent: 0, failed: 0, error: error.message };
  }
}

/**
 * Ensure the tracking column exists
 */
async function ensureBoostReminderColumn() {
  try {
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_boost_reminder TIMESTAMP');
  } catch (error) {
    // Column likely already exists
  }
}

/**
 * Start the boost reminder scheduler
 * - First run: 2 minutes after startup
 * - Then every 4 hours
 */
function startBoostReminderScheduler() {
  ensureBoostReminderColumn();

  // Initial run after 2 minutes
  setTimeout(() => {
    sendBoostReminderNotifications().catch(err => {
      console.error('[BOOST-REMINDER] Initial run error:', err);
    });
  }, 120000);

  // Run every 4 hours
  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  setInterval(() => {
    sendBoostReminderNotifications().catch(err => {
      console.error('[BOOST-REMINDER] Scheduled run error:', err);
    });
  }, FOUR_HOURS);

  console.log('[BOOST-REMINDER] Scheduler started: runs every 4 hours');
}

export {
  sendBoostReminderNotifications,
  startBoostReminderScheduler,
  ensureBoostReminderColumn
};
