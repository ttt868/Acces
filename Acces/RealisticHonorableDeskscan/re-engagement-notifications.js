/**
 * Re-Engagement Notification System
 * Sends push notifications to inactive users after 3+ days
 * ONLY when their activity session is NOT active
 * Uses FCM for Cordova users, Web Push for browser-only users (NEVER both)
 */

import webpush from 'web-push';
import { pool } from './db.js';
import fcmService from './fcm-service.js';

// Configure webpush with VAPID keys
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@access-network.com';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
} else {
  console.warn('[RE-ENGAGEMENT] VAPID keys not configured - push notifications disabled');
}

/**
 * Get the appropriate message based on days of inactivity and user language
 * Messages are HONEST - only sent when user truly has no active session
 */
function getMessageForInactivity(days, userLang) {
  const lang = (userLang || 'en').slice(0, 2).toLowerCase();

  const messages = {
    en: {
      short: { title: 'ACCESS Network', body: 'Your activity session is inactive. Start now to collect your bonuses!' },
      medium: { title: 'ACCESS Network', body: 'You haven\'t been active in a while. Your bonuses are waiting!' },
      long: { title: 'ACCESS Network', body: 'Your activity has been paused for days. Resume to keep your progress!' },
      vlong: { title: 'ACCESS Network', body: 'Your account is still active but your session is stopped. Come back!' }
    },
    ar: {
      short: { title: 'ACCESS Network', body: 'نشاطك غير فعّال. ابدأ الآن لجمع نقاطك!' },
      medium: { title: 'ACCESS Network', body: 'لم تكن نشطاً منذ فترة. نقاطك بانتظارك!' },
      long: { title: 'ACCESS Network', body: 'نشاطك متوقف منذ أيام. استأنف للحفاظ على تقدمك!' },
      vlong: { title: 'ACCESS Network', body: 'حسابك نشط لكن جلستك متوقفة. عد وابدأ من جديد!' }
    },
    fr: {
      short: { title: 'ACCESS Network', body: 'Votre session d\'activité est inactive. Commencez pour collecter vos bonus !' },
      medium: { title: 'ACCESS Network', body: 'Vous n\'avez pas été actif depuis un moment. Vos bonus vous attendent !' },
      long: { title: 'ACCESS Network', body: 'Votre activité est en pause depuis des jours. Reprenez pour garder votre progression !' },
      vlong: { title: 'ACCESS Network', body: 'Votre compte est actif mais votre session est arrêtée. Revenez !' }
    },
    de: {
      short: { title: 'ACCESS Network', body: 'Ihre Aktivitätssitzung ist inaktiv. Starten Sie jetzt und sammeln Sie Ihre Boni!' },
      medium: { title: 'ACCESS Network', body: 'Sie waren eine Weile nicht aktiv. Ihre Boni warten auf Sie!' },
      long: { title: 'ACCESS Network', body: 'Ihre Aktivität ist seit Tagen pausiert. Machen Sie weiter!' },
      vlong: { title: 'ACCESS Network', body: 'Ihr Konto ist aktiv, aber Ihre Sitzung ist gestoppt. Kommen Sie zurück!' }
    },
    es: {
      short: { title: 'ACCESS Network', body: 'Tu sesión de actividad está inactiva. ¡Empieza ahora y recoge tus bonos!' },
      medium: { title: 'ACCESS Network', body: 'No has estado activo en un tiempo. ¡Tus bonos te esperan!' },
      long: { title: 'ACCESS Network', body: 'Tu actividad está pausada hace días. ¡Reanuda para mantener tu progreso!' },
      vlong: { title: 'ACCESS Network', body: 'Tu cuenta está activa pero tu sesión está detenida. ¡Vuelve!' }
    },
    tr: {
      short: { title: 'ACCESS Network', body: 'Aktivite oturumunuz aktif değil. Bonuslarınızı toplamak için başlayın!' },
      medium: { title: 'ACCESS Network', body: 'Bir süredir aktif olmadınız. Bonuslarınız bekliyor!' },
      long: { title: 'ACCESS Network', body: 'Aktiviteniz günlerdir duraklatıldı. İlerlemenizi korumak için devam edin!' },
      vlong: { title: 'ACCESS Network', body: 'Hesabınız aktif ama oturumunuz durdu. Geri dönün!' }
    },
    ru: {
      short: { title: 'ACCESS Network', body: 'Ваша сессия активности неактивна. Начните и соберите свои бонусы!' },
      medium: { title: 'ACCESS Network', body: 'Вы давно не были активны. Ваши бонусы ждут!' },
      long: { title: 'ACCESS Network', body: 'Ваша активность приостановлена уже несколько дней. Продолжайте!' },
      vlong: { title: 'ACCESS Network', body: 'Ваш аккаунт активен, но сессия остановлена. Вернитесь!' }
    },
    it: {
      short: { title: 'ACCESS Network', body: 'La tua sessione di attività è inattiva. Inizia ora e raccogli i tuoi bonus!' },
      medium: { title: 'ACCESS Network', body: 'Non sei stato attivo per un po\'. I tuoi bonus ti aspettano!' },
      long: { title: 'ACCESS Network', body: 'La tua attività è in pausa da giorni. Riprendi per mantenere il tuo progresso!' },
      vlong: { title: 'ACCESS Network', body: 'Il tuo account è attivo ma la sessione è ferma. Torna!' }
    },
    pt: {
      short: { title: 'ACCESS Network', body: 'Sua sessão de atividade está inativa. Comece agora e colete seus bônus!' },
      medium: { title: 'ACCESS Network', body: 'Você não esteve ativo por um tempo. Seus bônus estão esperando!' },
      long: { title: 'ACCESS Network', body: 'Sua atividade está pausada há dias. Retome para manter seu progresso!' },
      vlong: { title: 'ACCESS Network', body: 'Sua conta está ativa mas a sessão parou. Volte!' }
    },
    zh: {
      short: { title: 'ACCESS Network', body: '您的活动会话未激活。立即开始领取您的奖金！' },
      medium: { title: 'ACCESS Network', body: '您已有一段时间未活跃。您的奖金在等您！' },
      long: { title: 'ACCESS Network', body: '您的活动已暂停多天。继续保持您的进度！' },
      vlong: { title: 'ACCESS Network', body: '您的账户仍然活跃但会话已停止。回来吧！' }
    },
    ja: {
      short: { title: 'ACCESS Network', body: 'アクティビティセッションが非アクティブです。今すぐ始めてボーナスを集めましょう！' },
      medium: { title: 'ACCESS Network', body: 'しばらくアクティブではありません。ボーナスが待っています！' },
      long: { title: 'ACCESS Network', body: 'アクティビティが数日間停止中です。進捗を維持するために再開しましょう！' },
      vlong: { title: 'ACCESS Network', body: 'アカウントはアクティブですがセッションは停止中です。' }
    },
    ko: {
      short: { title: 'ACCESS Network', body: '활동 세션이 비활성 상태입니다. 지금 시작하여 보너스를 모으세요!' },
      medium: { title: 'ACCESS Network', body: '한동안 활동하지 않았습니다. 보너스가 기다리고 있습니다!' },
      long: { title: 'ACCESS Network', body: '활동이 며칠째 중단되었습니다. 진행 상황을 유지하려면 계속하세요!' },
      vlong: { title: 'ACCESS Network', body: '계정은 활성 상태이지만 세션이 중단되었습니다.' }
    },
    hi: {
      short: { title: 'ACCESS Network', body: 'आपका गतिविधि सत्र निष्क्रिय है। अभी शुरू करें और अपने बोनस इकट्ठा करें!' },
      medium: { title: 'ACCESS Network', body: 'आप कुछ समय से सक्रिय नहीं हैं। आपके बोनस इंतजार कर रहे हैं!' },
      long: { title: 'ACCESS Network', body: 'आपकी गतिविधि कई दिनों से रुकी है। अपनी प्रगति बनाए रखने के लिए फिर से शुरू करें!' },
      vlong: { title: 'ACCESS Network', body: 'खाता सक्रिय है लेकिन सत्र बंद है। वापस आएं!' }
    },
    id: {
      short: { title: 'ACCESS Network', body: 'Sesi aktivitas Anda tidak aktif. Mulai sekarang dan kumpulkan bonus Anda!' },
      medium: { title: 'ACCESS Network', body: 'Anda belum aktif sejak lama. Bonus Anda menunggu!' },
      long: { title: 'ACCESS Network', body: 'Aktivitas Anda dijeda berhari-hari. Lanjutkan untuk menjaga kemajuan Anda!' },
      vlong: { title: 'ACCESS Network', body: 'Akun aktif tapi sesi berhenti. Kembali!' }
    },
    pl: {
      short: { title: 'ACCESS Network', body: 'Twoja sesja aktywności jest nieaktywna. Zacznij teraz i zbieraj swoje bonusy!' },
      medium: { title: 'ACCESS Network', body: 'Nie byłeś aktywny od jakiegoś czasu. Twoje bonusy czekają!' },
      long: { title: 'ACCESS Network', body: 'Twoja aktywność jest wstrzymana od dni. Kontynuuj, aby utrzymać swój postęp!' },
      vlong: { title: 'ACCESS Network', body: 'Konto aktywne ale sesja zatrzymana. Wróć!' }
    }
  };

  const langMsgs = messages[lang] || messages['en'];

  if (days >= 3 && days <= 5) return langMsgs.short;
  if (days >= 6 && days <= 10) return langMsgs.medium;
  if (days >= 11 && days <= 20) return langMsgs.long;
  if (days > 20) return langMsgs.vlong;
  return null;
}

/**
 * Main function: Find inactive users and send re-engagement notifications
 * 
 * RULES (prevents duplicates and misleading content):
 * 1. ONLY send if user has NO active session (processing_active = 0 AND no active activity_session)
 * 2. Cordova users (have FCM token) -> send FCM ONLY, skip Web Push
 * 3. Web-only users (no FCM token) -> send Web Push ONLY
 * 4. NEVER send both FCM + Web Push to the same user
 * 5. Minimum 2-day gap between re-engagement notifications
 */
async function sendReEngagementNotifications() {
  try {
    let successCount = 0;
    let failCount = 0;
    const processedUserIds = new Set();

    // ============================================================
    // PHASE 1: Cordova / FCM users -> send FCM ONLY (no Web Push)
    // ============================================================
    const fcmUsersResult = await pool.query(`
      SELECT DISTINCT ON (u.id)
        u.id as user_id,
        u.language as user_language,
        EXTRACT(EPOCH FROM (NOW() - u.last_login)) / 86400 as days_inactive
      FROM users u
      INNER JOIN fcm_tokens f ON u.id = f.user_id
      LEFT JOIN activity_sessions a ON u.id = a.user_id AND a.is_active = true
      WHERE 
        u.last_login IS NOT NULL
        AND u.last_login < NOW() - INTERVAL '3 days'
        AND a.user_id IS NULL
        AND COALESCE(u.processing_active, 0) = 0
        AND (
          u.last_reengagement_notification IS NULL 
          OR u.last_reengagement_notification < NOW() - INTERVAL '2 days'
        )
      ORDER BY u.id, days_inactive DESC
      LIMIT 100
    `);

    console.log('[RE-ENGAGEMENT] Phase 1: Found ' + fcmUsersResult.rows.length + ' FCM users to notify');

    for (const user of fcmUsersResult.rows) {
      if (processedUserIds.has(user.user_id)) continue;
      processedUserIds.add(user.user_id);

      const daysInactive = Math.floor(user.days_inactive);
      if (daysInactive < 3) continue;

      try {
        const userLang = user.user_language || 'en';
        const message = getMessageForInactivity(daysInactive, userLang);
        if (!message) continue;

        // Send FCM notification with correct title and body directly
        let sent = false;
        if (fcmService && typeof fcmService.sendFCMNotification === 'function') {
          const result = await fcmService.sendFCMNotification(user.user_id, message.title, message.body, {
            type: 're-engagement',
            daysInactive: String(daysInactive)
          });
          if (result && result.success) sent = true;
        }

        if (sent) {
          successCount++;
          await pool.query(
            'UPDATE users SET last_reengagement_notification = NOW() WHERE id = $1',
            [user.user_id]
          );
          console.log('[RE-ENGAGEMENT] FCM sent to user ' + user.user_id + ' (' + daysInactive + ' days inactive)');
        }
      } catch (fcmErr) {
        failCount++;
        console.error('[RE-ENGAGEMENT] FCM error for user ' + user.user_id + ':', fcmErr.message);
      }
    }

    // ============================================================
    // PHASE 2: Web Push ONLY users (have push_subscription but NO FCM token)
    // This ensures Cordova users who also have a push_subscription are SKIPPED
    // ============================================================
    const processedArray = Array.from(processedUserIds);
    const excludeParam = processedArray.length > 0 ? processedArray : [0];

    const webPushUsersResult = await pool.query(`
      SELECT DISTINCT ON (ps.user_id)
        u.id as user_id,
        u.language as user_language,
        EXTRACT(EPOCH FROM (NOW() - u.last_login)) / 86400 as days_inactive,
        ps.endpoint,
        ps.p256dh,
        ps.auth
      FROM users u
      INNER JOIN push_subscriptions ps ON u.id::TEXT = ps.user_id
      LEFT JOIN fcm_tokens f ON u.id = f.user_id
      LEFT JOIN activity_sessions a ON u.id = a.user_id AND a.is_active = true
      WHERE 
        ps.revoked_at IS NULL
        AND f.user_id IS NULL
        AND u.last_login IS NOT NULL
        AND u.last_login < NOW() - INTERVAL '3 days'
        AND a.user_id IS NULL
        AND COALESCE(u.processing_active, 0) = 0
        AND (
          u.last_reengagement_notification IS NULL 
          OR u.last_reengagement_notification < NOW() - INTERVAL '2 days'
        )
        AND u.id != ALL($1::int[])
      ORDER BY ps.user_id, ps.created_at DESC
      LIMIT 100
    `, [excludeParam]);

    console.log('[RE-ENGAGEMENT] Phase 2: Found ' + webPushUsersResult.rows.length + ' Web Push users to notify');

    for (const user of webPushUsersResult.rows) {
      if (processedUserIds.has(user.user_id)) continue;
      processedUserIds.add(user.user_id);

      const daysInactive = Math.floor(user.days_inactive);
      if (daysInactive < 3) continue;

      try {
        const subscription = {
          endpoint: user.endpoint,
          keys: { p256dh: user.p256dh, auth: user.auth }
        };

        const payload = JSON.stringify({
          type: 're-engagement',
          tag: 'reengagement-' + daysInactive + 'days',
          daysInactive: daysInactive,
          url: '/',
          timestamp: Date.now()
        });

        await webpush.sendNotification(subscription, payload);
        successCount++;

        await pool.query(
          'UPDATE users SET last_reengagement_notification = NOW() WHERE id = $1',
          [user.user_id]
        );

        console.log('[RE-ENGAGEMENT] Web Push sent to user ' + user.user_id + ' (' + daysInactive + ' days inactive)');
      } catch (pushError) {
        failCount++;
        // Remove permanently invalid subscriptions
        if (pushError.statusCode === 410 || pushError.statusCode === 404 || pushError.statusCode === 403) {
          try {
            await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [user.endpoint]);
            console.log('[RE-ENGAGEMENT] Removed invalid subscription for user ' + user.user_id);
          } catch (delErr) { /* ignore */ }
        }
        console.error('[RE-ENGAGEMENT] Web Push error for user ' + user.user_id + ':', pushError.message || pushError.statusCode);
      }
    }

    console.log('[RE-ENGAGEMENT] Complete: ' + successCount + ' sent, ' + failCount + ' failed, ' + processedUserIds.size + ' users processed');
    return { sent: successCount, failed: failCount, processed: processedUserIds.size };

  } catch (error) {
    console.error('[RE-ENGAGEMENT] System error:', error);
    return { sent: 0, failed: 0, error: error.message };
  }
}

/**
 * Clean up old/expired push subscriptions
 */
async function cleanupOldSubscriptions() {
  try {
    // Delete subscriptions older than 30 days
    const oldResult = await pool.query(
      "DELETE FROM push_subscriptions WHERE updated_at < NOW() - INTERVAL '30 days' AND revoked_at IS NULL"
    );
    
    // Delete duplicate subscriptions (keep latest per user)
    const dupResult = await pool.query(`
      DELETE FROM push_subscriptions 
      WHERE id NOT IN (
        SELECT DISTINCT ON (user_id) id 
        FROM push_subscriptions 
        WHERE revoked_at IS NULL 
        ORDER BY user_id, created_at DESC
      ) AND revoked_at IS NULL
    `);
    
    // Delete revoked subscriptions older than 7 days
    const revokedResult = await pool.query(
      "DELETE FROM push_subscriptions WHERE revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '7 days'"
    );
    
    const totalDeleted = (oldResult.rowCount || 0) + (dupResult.rowCount || 0) + (revokedResult.rowCount || 0);
    if (totalDeleted > 0) {
      console.log('[RE-ENGAGEMENT] Cleanup: removed ' + totalDeleted + ' old subscriptions');
    }
    return { deleted: totalDeleted };
  } catch (error) {
    console.error('[RE-ENGAGEMENT] Cleanup error:', error.message);
    return { deleted: 0, error: error.message };
  }
}

/**
 * Ensure the users table has the required column
 */
async function ensureReEngagementColumn() {
  try {
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reengagement_notification TIMESTAMP');
  } catch (error) {
    // Column likely already exists, silently continue
  }
}

/**
 * Start the re-engagement notification scheduler
 * - First run: 30 seconds after startup
 * - Then every 6 hours
 * - Cleanup runs daily
 */
function startReEngagementScheduler() {
  ensureReEngagementColumn();

  // Initial run after 30 seconds
  setTimeout(() => {
    sendReEngagementNotifications().catch(err => {
      console.error('[RE-ENGAGEMENT] Initial run error:', err);
    });
  }, 30000);

  // Initial cleanup after 60 seconds
  setTimeout(() => {
    cleanupOldSubscriptions().catch(err => {
      console.error('[RE-ENGAGEMENT] Initial cleanup error:', err);
    });
  }, 60000);

  // Schedule every 6 hours
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    sendReEngagementNotifications().catch(err => {
      console.error('[RE-ENGAGEMENT] Scheduled run error:', err);
    });
  }, SIX_HOURS);

  // Cleanup daily
  const ONE_DAY = 24 * 60 * 60 * 1000;
  setInterval(() => {
    cleanupOldSubscriptions().catch(err => {
      console.error('[RE-ENGAGEMENT] Scheduled cleanup error:', err);
    });
  }, ONE_DAY);

  console.log('[RE-ENGAGEMENT] Scheduler started: runs every 6 hours, cleanup daily');
}

export {
  sendReEngagementNotifications,
  startReEngagementScheduler,
  ensureReEngagementColumn,
  cleanupOldSubscriptions
};
