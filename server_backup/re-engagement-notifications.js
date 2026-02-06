/**
 * Re-Engagement Notification System
 * Sends push notifications to inactive users after 3-7 days
 * Uses existing VAPID/WebPush infrastructure + FCM for Cordova apps
 */

import webpush from 'web-push';
import { pool } from './db.js';
import fcmService from './fcm-service.js';

// Configure webpush with VAPID keys (Updated Jan 2026)
// ⚠️ IMPORTANT: Private key MUST be in .env file only - no fallback for security
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@access-network.com';

// Only configure webpush if keys are available
if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
} else {
  console.warn('⚠️ VAPID keys not configured - push notifications disabled');
}

// Re-engagement messages based on inactivity duration (with multi-language support)
const RE_ENGAGEMENT_MESSAGES = {
  en: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Your session is ready! Tap to start a new activity.', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: 'Welcome back! 👋', body: 'ACCESS Network is waiting for you. Start your session now.', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: 'We miss you! 💫', body: 'Your ACCESS Network activity awaits. Come back and explore!', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: 'Long time no see! 🌟', body: 'ACCESS Network has updates for you. Tap to check in!', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Your account is still active. Ready to continue?', tag: 'reengagement-30days' }
  ],
  ar: [
    { minDays: 3, maxDays: 4, title: 'ACCESS شبكة', body: 'جلستك جاهزة! اضغط لبدء نشاط جديد.', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: 'مرحباً بعودتك! 👋', body: 'شبكة ACCESS في انتظارك. ابدأ جلستك الآن.', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: 'نفتقدك! 💫', body: 'نشاطك في شبكة ACCESS بانتظارك. عُد واستكشف!', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: 'مدة طويلة! 🌟', body: 'لديك تحديثات في شبكة ACCESS. اضغط للاطلاع!', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: '🔔 ACCESS شبكة', body: 'حسابك لا يزال نشطاً. هل أنت مستعد للمتابعة؟', tag: 'reengagement-30days' }
  ],
  fr: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Votre session est prête ! Appuyez pour démarrer une nouvelle activité.', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: 'Bon retour ! 👋', body: 'ACCESS Network vous attend. Commencez votre session maintenant.', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: 'Vous nous manquez ! 💫', body: 'Votre activité ACCESS Network vous attend. Revenez explorer !', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: 'Ça fait longtemps ! 🌟', body: 'ACCESS Network a des mises à jour pour vous. Appuyez pour voir !', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Votre compte est toujours actif. Prêt à continuer ?', tag: 'reengagement-30days' }
  ],
  de: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Ihre Sitzung ist bereit! Tippen Sie, um eine neue Aktivität zu starten.', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: 'Willkommen zurück! 👋', body: 'ACCESS Network wartet auf Sie. Starten Sie jetzt Ihre Sitzung.', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: 'Wir vermissen dich! 💫', body: 'Ihre ACCESS Network-Aktivität wartet. Kommen Sie zurück und entdecken Sie!', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: 'Lange nicht gesehen! 🌟', body: 'ACCESS Network hat Updates für Sie. Tippen Sie zum Einchecken!', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Ihr Konto ist noch aktiv. Bereit weiterzumachen?', tag: 'reengagement-30days' }
  ],
  es: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: '¡Tu sesión está lista! Toca para iniciar una nueva actividad.', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: '¡Bienvenido de nuevo! 👋', body: 'ACCESS Network te espera. Comienza tu sesión ahora.', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: '¡Te extrañamos! 💫', body: 'Tu actividad en ACCESS Network te espera. ¡Vuelve y explora!', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: '¡Cuánto tiempo! 🌟', body: 'ACCESS Network tiene actualizaciones para ti. ¡Toca para ver!', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Tu cuenta sigue activa. ¿Listo para continuar?', tag: 'reengagement-30days' }
  ],
  tr: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Oturumunuz hazır! Yeni bir aktivite başlatmak için dokunun.', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: 'Tekrar hoş geldiniz! 👋', body: 'ACCESS Network sizi bekliyor. Oturumunuza şimdi başlayın.', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: 'Sizi özledik! 💫', body: 'ACCESS Network aktiviteniz sizi bekliyor. Geri dönün ve keşfedin!', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: 'Uzun zaman oldu! 🌟', body: 'ACCESS Network sizin için güncellemeler var. Kontrol etmek için dokunun!', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Hesabınız hala aktif. Devam etmeye hazır mısınız?', tag: 'reengagement-30days' }
  ],
  it: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'La tua sessione è pronta! Tocca per iniziare una nuova attività.', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: 'Bentornato! 👋', body: 'ACCESS Network ti aspetta. Inizia la tua sessione ora.', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: 'Ci manchi! 💫', body: 'La tua attività su ACCESS Network ti aspetta. Torna a esplorare!', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: 'È passato tanto tempo! 🌟', body: 'ACCESS Network ha aggiornamenti per te. Tocca per vedere!', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Il tuo account è ancora attivo. Pronto a continuare?', tag: 'reengagement-30days' }
  ],
  hi: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'आपका सत्र तैयार है! नई गतिविधि शुरू करने के लिए टैप करें।', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: 'वापसी पर स्वागत है! 👋', body: 'ACCESS Network आपका इंतजार कर रहा है। अभी अपना सत्र शुरू करें।', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: 'हम आपको याद करते हैं! 💫', body: 'आपकी ACCESS Network गतिविधि आपका इंतजार कर रही है। वापस आएं!', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: 'बहुत समय हो गया! 🌟', body: 'ACCESS Network में आपके लिए अपडेट हैं। देखने के लिए टैप करें!', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'आपका खाता अभी भी सक्रिय है। जारी रखने के लिए तैयार?', tag: 'reengagement-30days' }
  ],
  zh: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: '您的会话已准备就绪！点击开始新活动。', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: '欢迎回来！👋', body: 'ACCESS Network 正在等您。立即开始您的会话。', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: '我们想念您！💫', body: '您的 ACCESS Network 活动正在等待您。回来探索吧！', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: '好久不见！🌟', body: 'ACCESS Network 有更新给您。点击查看！', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: '您的账户仍然活跃。准备好继续了吗？', tag: 'reengagement-30days' }
  ],
  ja: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'セッションの準備ができました！タップして新しいアクティビティを開始。', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: 'おかえりなさい！👋', body: 'ACCESS Network がお待ちしています。今すぐセッションを開始しましょう。', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: 'お待ちしておりました！💫', body: 'ACCESS Network でのアクティビティがお待ちしています。戻ってきてください！', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: 'お久しぶりです！🌟', body: 'ACCESS Network に更新があります。タップして確認！', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'アカウントはまだアクティブです。続ける準備はできましたか？', tag: 'reengagement-30days' }
  ],
  ko: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: '세션이 준비되었습니다! 탭하여 새 활동을 시작하세요.', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: '다시 오신 것을 환영합니다! 👋', body: 'ACCESS Network가 기다리고 있습니다. 지금 세션을 시작하세요.', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: '보고 싶었어요! 💫', body: 'ACCESS Network 활동이 기다리고 있습니다. 돌아와서 탐험하세요!', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: '오랜만이에요! 🌟', body: 'ACCESS Network에 업데이트가 있습니다. 탭하여 확인하세요!', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: '계정이 아직 활성 상태입니다. 계속할 준비가 되셨나요?', tag: 'reengagement-30days' }
  ],
  pt: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Sua sessão está pronta! Toque para iniciar uma nova atividade.', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: 'Bem-vindo de volta! 👋', body: 'ACCESS Network está esperando por você. Comece sua sessão agora.', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: 'Sentimos sua falta! 💫', body: 'Sua atividade no ACCESS Network está esperando. Volte e explore!', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: 'Há quanto tempo! 🌟', body: 'ACCESS Network tem atualizações para você. Toque para ver!', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Sua conta ainda está ativa. Pronto para continuar?', tag: 'reengagement-30days' }
  ],
  ru: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Ваша сессия готова! Нажмите, чтобы начать новую активность.', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: 'С возвращением! 👋', body: 'ACCESS Network ждет вас. Начните сессию сейчас.', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: 'Мы скучаем по вам! 💫', body: 'Ваша активность в ACCESS Network ждет. Возвращайтесь!', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: 'Давно не виделись! 🌟', body: 'ACCESS Network имеет обновления для вас. Нажмите, чтобы проверить!', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Ваш аккаунт все еще активен. Готовы продолжить?', tag: 'reengagement-30days' }
  ],
  id: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Sesi Anda siap! Ketuk untuk memulai aktivitas baru.', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: 'Selamat datang kembali! 👋', body: 'ACCESS Network menunggu Anda. Mulai sesi Anda sekarang.', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: 'Kami rindu Anda! 💫', body: 'Aktivitas ACCESS Network Anda menunggu. Kembali dan jelajahi!', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: 'Sudah lama! 🌟', body: 'ACCESS Network punya pembaruan untuk Anda. Ketuk untuk melihat!', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Akun Anda masih aktif. Siap melanjutkan?', tag: 'reengagement-30days' }
  ],
  pl: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Twoja sesja jest gotowa! Dotknij, aby rozpocząć nową aktywność.', tag: 'reengagement-3days' },
    { minDays: 5, maxDays: 6, title: 'Witaj ponownie! 👋', body: 'ACCESS Network czeka na Ciebie. Rozpocznij sesję teraz.', tag: 'reengagement-5days' },
    { minDays: 7, maxDays: 10, title: 'Tęsknimy za Tobą! 💫', body: 'Twoja aktywność w ACCESS Network czeka. Wróć i odkrywaj!', tag: 'reengagement-7days' },
    { minDays: 11, maxDays: 14, title: 'Dawno Cię nie było! 🌟', body: 'ACCESS Network ma dla Ciebie aktualizacje. Dotknij, aby sprawdzić!', tag: 'reengagement-14days' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Twoje konto jest nadal aktywne. Gotowy kontynuować?', tag: 'reengagement-30days' }
  ]
};

// Default fallback messages (all languages)
const DEFAULT_LONG_INACTIVE_MESSAGES = {
  en: { title: 'ACCESS Network', body: 'Your session is ready whenever you are!', tag: 'reengagement-long' },
  ar: { title: 'ACCESS شبكة', body: 'جلستك جاهزة متى ما كنت مستعداً!', tag: 'reengagement-long' },
  fr: { title: 'ACCESS Network', body: 'Votre session est prête quand vous l\'êtes !', tag: 'reengagement-long' },
  de: { title: 'ACCESS Network', body: 'Ihre Sitzung ist bereit, wann immer Sie es sind!', tag: 'reengagement-long' },
  es: { title: 'ACCESS Network', body: '¡Tu sesión está lista cuando tú lo estés!', tag: 'reengagement-long' },
  tr: { title: 'ACCESS Network', body: 'Oturumunuz hazır olduğunuzda hazır!', tag: 'reengagement-long' },
  it: { title: 'ACCESS Network', body: 'La tua sessione è pronta quando lo sei tu!', tag: 'reengagement-long' },
  hi: { title: 'ACCESS Network', body: 'जब आप तैयार हों तब आपका सत्र तैयार है!', tag: 'reengagement-long' },
  zh: { title: 'ACCESS Network', body: '您的会话随时为您准备就绪！', tag: 'reengagement-long' },
  ja: { title: 'ACCESS Network', body: 'いつでもセッションの準備ができています！', tag: 'reengagement-long' },
  ko: { title: 'ACCESS Network', body: '언제든지 세션 준비가 되어 있습니다!', tag: 'reengagement-long' },
  pt: { title: 'ACCESS Network', body: 'Sua sessão está pronta quando você estiver!', tag: 'reengagement-long' },
  ru: { title: 'ACCESS Network', body: 'Ваша сессия готова, когда вы готовы!', tag: 'reengagement-long' },
  id: { title: 'ACCESS Network', body: 'Sesi Anda siap kapan pun Anda siap!', tag: 'reengagement-long' },
  pl: { title: 'ACCESS Network', body: 'Twoja sesja jest gotowa, gdy tylko będziesz!', tag: 'reengagement-long' }
};

/**
 * Get the appropriate message based on days of inactivity and user's language
 */
function getMessageForInactivity(days, userLang = 'en') {
  // Get language code (first 2 characters)
  const lang = (userLang || 'en').slice(0, 2).toLowerCase();
  const messages = RE_ENGAGEMENT_MESSAGES[lang] || RE_ENGAGEMENT_MESSAGES['en'];
  
  for (const msg of messages) {
    if (days >= msg.minDays && days <= msg.maxDays) {
      return msg;
    }
  }
  // Default message for very long inactivity
  if (days > 30) {
    return DEFAULT_LONG_INACTIVE_MESSAGES[lang] || DEFAULT_LONG_INACTIVE_MESSAGES['en'];
  }
  return null;
}

/**
 * Find inactive users and send re-engagement notifications
 */
async function sendReEngagementNotifications() {
  try {

    // Find users who haven't been active for 3+ days
    // Join users with push_subscriptions to get only users with valid subscriptions
    // Language priority: push_subscriptions.language > users.language > 'en'
    const inactiveUsers = await pool.query(`
      SELECT DISTINCT 
        u.id as user_id,
        u.wallet_address,
        u.last_login,
        COALESCE(ps.language, u.language, 'en') as user_language,
        EXTRACT(EPOCH FROM (NOW() - u.last_login)) / 86400 as days_inactive,
        ps.endpoint,
        ps.p256dh,
        ps.auth
      FROM users u
      INNER JOIN push_subscriptions ps ON u.id::TEXT = ps.user_id
      WHERE 
        ps.revoked_at IS NULL
        AND u.last_login IS NOT NULL
        AND u.last_login < NOW() - INTERVAL '3 days'
        AND (
          u.last_reengagement_notification IS NULL 
          OR u.last_reengagement_notification < NOW() - INTERVAL '2 days'
        )
      ORDER BY days_inactive DESC
      LIMIT 100
    `);

    if (inactiveUsers.rows.length === 0) {
      return { sent: 0, failed: 0 };
    }

    let successCount = 0;
    let failCount = 0;
    const processedUsers = new Set();

    for (const user of inactiveUsers.rows) {
      // Skip if already processed this user (multiple subscriptions)
      if (processedUsers.has(user.user_id)) continue;
      processedUsers.add(user.user_id);

      const daysInactive = Math.floor(user.days_inactive);
      
      // Skip if not in the right range for a message
      if (daysInactive < 3) continue;

      try {
        const subscription = {
          endpoint: user.endpoint,
          keys: {
            p256dh: user.p256dh,
            auth: user.auth
          }
        };

        // Send data with preferred language from database
        const payload = JSON.stringify({
          type: 're-engagement',
          tag: `reengagement-${daysInactive}days`,
          daysInactive: daysInactive,
          language: user.user_language || 'en',
          url: '/',
          timestamp: Date.now()
        });

        await webpush.sendNotification(subscription, payload);
        successCount++;

        // 🔥 Also send FCM notification for Cordova app users
        // Send as data-only so app can translate based on device language
        try {
          if (fcmService && typeof fcmService.sendFCMDataNotification === 'function') {
            await fcmService.sendFCMDataNotification(user.user_id, {
              type: 're-engagement',
              daysInactive: String(daysInactive),
              timestamp: String(Date.now())
            });
            console.log(`📱 [FCM RE-ENGAGEMENT] Data sent to user ${user.user_id}`);
          } else if (fcmService && typeof fcmService.sendFCMNotification === 'function') {
            // Fallback: use server-side translation
            const userLang = user.user_language || 'en';
            const message = getMessageForInactivity(daysInactive, userLang);
            if (message) {
              await fcmService.sendFCMNotification(user.user_id, message.title, message.body);
              console.log(`📱 [FCM RE-ENGAGEMENT] Sent to user ${user.user_id} (${userLang})`);
            }
          }
        } catch (fcmError) {
          // Silent - FCM failure shouldn't block Web Push success
        }

        // Update last_reengagement_notification timestamp
        await pool.query(
          'UPDATE users SET last_reengagement_notification = NOW() WHERE id = $1',
          [user.user_id]
        );

        console.log(`📬 [RE-ENGAGEMENT] ✅ Sent to user ${user.user_id} (${daysInactive} days inactive)`);

      } catch (pushError) {
        failCount++;

        // Remove invalid subscriptions
        if (pushError.statusCode === 410 || pushError.statusCode === 404 || pushError.statusCode === 403) {
          await pool.query(
            'DELETE FROM push_subscriptions WHERE endpoint = $1',
            [user.endpoint]
          );
        }
      }
    }

    return { sent: successCount, failed: failCount };

  } catch (error) {
    console.error('📬 [RE-ENGAGEMENT] Error:', error);
    return { sent: 0, failed: 0, error: error.message };
  }
}

/**
 * Clean up old/expired push subscriptions
 * - Removes subscriptions older than 30 days that haven't been updated
 * - Keeps only the latest subscription per user to avoid duplicates
 * Runs daily - very lightweight operation
 */
async function cleanupOldSubscriptions() {
  try {

    // Delete subscriptions older than 30 days
    const oldResult = await pool.query(`
      DELETE FROM push_subscriptions 
      WHERE updated_at < NOW() - INTERVAL '30 days'
      AND revoked_at IS NULL
    `);

    // Delete duplicate subscriptions per user, keep only the latest
    const dupResult = await pool.query(`
      DELETE FROM push_subscriptions 
      WHERE id NOT IN (
        SELECT DISTINCT ON (user_id) id 
        FROM push_subscriptions 
        WHERE revoked_at IS NULL
        ORDER BY user_id, created_at DESC
      )
      AND revoked_at IS NULL
    `);

    // Delete revoked subscriptions older than 7 days
    const revokedResult = await pool.query(`
      DELETE FROM push_subscriptions 
      WHERE revoked_at IS NOT NULL 
      AND revoked_at < NOW() - INTERVAL '7 days'
    `);

    const totalDeleted = (oldResult.rowCount || 0) + (dupResult.rowCount || 0) + (revokedResult.rowCount || 0);
    
    return { deleted: totalDeleted };
  } catch (error) {
    return { deleted: 0, error: error.message };
  }
}

/**
 * Ensure the users table has the required column
 */
async function ensureReEngagementColumn() {
  try {
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS last_reengagement_notification TIMESTAMP
    `);
  } catch (error) {
    // silently continue
  }
}

/**
 * Start the re-engagement notification scheduler
 * Runs every 6 hours to check for inactive users
 * Also runs daily cleanup of old subscriptions
 */
function startReEngagementScheduler() {
  // Ensure database column exists
  ensureReEngagementColumn();

  // Run immediately on start (after 30 seconds delay)
  setTimeout(() => {
    sendReEngagementNotifications();
  }, 30000);

  // Run cleanup on start (after 1 minute)
  setTimeout(() => {
    cleanupOldSubscriptions();
  }, 60000);

  // Then run re-engagement every 6 hours
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    sendReEngagementNotifications();
  }, SIX_HOURS);

  // Run cleanup once daily (every 24 hours)
  const ONE_DAY = 24 * 60 * 60 * 1000;
  setInterval(() => {
    cleanupOldSubscriptions();
  }, ONE_DAY);
}

export {
  sendReEngagementNotifications,
  startReEngagementScheduler,
  ensureReEngagementColumn,
  cleanupOldSubscriptions
};
