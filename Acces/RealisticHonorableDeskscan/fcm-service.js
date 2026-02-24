/**
 * Firebase Cloud Messaging (FCM) Service
 * For sending push notifications to Cordova app
 */

import admin from 'firebase-admin';
import { pool } from './db.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin
let fcmInitialized = false;

try {
  const serviceAccountPath = join(__dirname, 'firebase-service-account.json');
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
  
  fcmInitialized = true;
  console.log('✅ Firebase Admin SDK initialized');
} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin:', error.message);
}

/**
 * Send FCM notification to a specific user
 */
export async function sendFCMNotification(userId, title, body, data = {}) {
  if (!fcmInitialized) {
    console.error('FCM not initialized');
    return { success: false, error: 'FCM not initialized' };
  }

  try {
    // Get user's FCM tokens
    const result = await pool.query(
      'SELECT token FROM fcm_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'No FCM token found for user' };
    }

    const tokens = result.rows.map(row => row.token);
    
    // Send to all user's devices
    const message = {
      notification: {
        title: title,
        body: body
      },
      data: {
        ...data,
        click_action: 'OPEN_APP',
        userId: String(userId)
      },
      android: {
        priority: 'high',
        notification: {
          icon: 'ic_notification',
          color: '#6c5ce7',
          sound: 'default',
          channelId: 'access_notifications'
        }
      },
      tokens: tokens
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    
    console.log(`📱 FCM sent to user ${userId}: ${response.successCount} success, ${response.failureCount} failed`);

    // Only remove tokens with PERMANENT errors (not temporary failures)
    if (response.failureCount > 0) {
      const permanentlyInvalidTokens = [];
      const permanentErrorCodes = [
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token',
      ];
      
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          const errorCode = resp.error.code || '';
          console.log(`📱 [FCM] Token ${idx} error: ${errorCode} - ${resp.error.message}`);
          
          // Only mark as invalid if it's a permanent error
          if (permanentErrorCodes.includes(errorCode)) {
            permanentlyInvalidTokens.push(tokens[idx]);
          }
        }
      });
      
      // Only delete tokens with permanent errors
      if (permanentlyInvalidTokens.length > 0) {
        await pool.query(
          'DELETE FROM fcm_tokens WHERE token = ANY($1)',
          [permanentlyInvalidTokens]
        );
        console.log(`🗑️ Removed ${permanentlyInvalidTokens.length} permanently invalid FCM tokens`);
      }
    }

    return { 
      success: true, 
      successCount: response.successCount,
      failureCount: response.failureCount 
    };
  } catch (error) {
    console.error('FCM send error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send FCM notification with both notification + data payload
 * notification: shown by Android when app is in background
 * data: used by app in foreground for local translation
 */
export async function sendFCMDataNotification(userId, data = {}) {
  if (!fcmInitialized) {
    console.error('FCM not initialized');
    return { success: false, error: 'FCM not initialized' };
  }

  try {
    // Get token AND language from fcm_tokens table
    const result = await pool.query(
      'SELECT token, language FROM fcm_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'No FCM token found for user' };
    }

    const tokens = result.rows.map(row => row.token);
    const userLang = (result.rows[0].language || 'en').substring(0, 2).toLowerCase();

    // Build notification text based on user's language for background display
    const NOTIF_TEXTS = {
      en: { title: 'Access Network', newTx: 'New transaction received', amount: 'Amount', from: 'From' },
      ar: { title: 'Access Network', newTx: 'تم استلام معاملة جديدة', amount: 'المبلغ', from: 'من' },
      fr: { title: 'Access Network', newTx: 'Nouvelle transaction reçue', amount: 'Montant', from: 'De' },
      de: { title: 'Access Network', newTx: 'Neue Transaktion erhalten', amount: 'Betrag', from: 'Von' },
      es: { title: 'Access Network', newTx: 'Nueva transacción recibida', amount: 'Cantidad', from: 'De' },
      tr: { title: 'Access Network', newTx: 'Yeni işlem alındı', amount: 'Miktar', from: 'Gönderen' },
      ru: { title: 'Access Network', newTx: 'Получена новая транзакция', amount: 'Сумма', from: 'От' },
      pl: { title: 'Access Network', newTx: 'Otrzymano nową transakcję', amount: 'Kwota', from: 'Od' },
      it: { title: 'Access Network', newTx: 'Nuova transazione ricevuta', amount: 'Importo', from: 'Da' },
      pt: { title: 'Access Network', newTx: 'Nova transação recebida', amount: 'Quantia', from: 'De' },
      zh: { title: 'Access Network', newTx: '收到新交易', amount: '金额', from: '来自' },
      ja: { title: 'Access Network', newTx: '新しい取引を受信しました', amount: '金額', from: '送信元' },
      ko: { title: 'Access Network', newTx: '새 거래가 수신되었습니다', amount: '금액', from: '발신' },
      hi: { title: 'Access Network', newTx: 'नया लेनदेन प्राप्त हुआ', amount: 'राशि', from: 'से' },
      id: { title: 'Access Network', newTx: 'Transaksi baru diterima', amount: 'Jumlah', from: 'Dari' }
    };

    const texts = NOTIF_TEXTS[userLang] || NOTIF_TEXTS['en'];
    let notifTitle = texts.title;
    let notifBody = texts.newTx;

    // Build body with transaction details if available
    if (data.type === 'transaction_received' && data.amount) {
      const fromShort = data.senderAddress && data.senderAddress.length > 10
        ? `${data.senderAddress.substring(0, 6)}...${data.senderAddress.substring(data.senderAddress.length - 4)}`
        : (data.senderAddress || '');
      notifBody = `${texts.newTx}\n${texts.amount}: ${data.amount} ACCESS\n${texts.from}: ${fromShort}`;
    } else if (data.type === 're-engagement' || data.type === 'reengagement') {
      const daysNum = parseInt(data.daysInactive) || 3;
      const RE_MSGS = {
        en: { short: 'Your activity session is inactive. Start now to collect your bonuses!', medium: 'You haven\'t been active in a while. Your bonuses are waiting!', long: 'Your activity has been paused for days. Resume to keep your progress!', vlong: 'Your account is still active but your session is stopped. Come back!' },
        ar: { short: 'نشاطك غير فعّال. ابدأ الآن لجمع نقاطك!', medium: 'لم تكن نشطاً منذ فترة. نقاطك بانتظارك!', long: 'نشاطك متوقف منذ أيام. استأنف للحفاظ على تقدمك!', vlong: 'حسابك نشط لكن جلستك متوقفة. عد وابدأ من جديد!' },
        fr: { short: 'Votre session d\'activité est inactive. Commencez pour collecter vos bonus !', medium: 'Vous n\'avez pas été actif depuis un moment. Vos bonus vous attendent !', long: 'Votre activité est en pause depuis des jours. Reprenez pour garder votre progression !', vlong: 'Votre compte est actif mais votre session est arrêtée. Revenez !' },
        de: { short: 'Ihre Aktivitätssitzung ist inaktiv. Starten Sie jetzt und sammeln Sie Ihre Boni!', medium: 'Sie waren eine Weile nicht aktiv. Ihre Boni warten auf Sie!', long: 'Ihre Aktivität ist seit Tagen pausiert. Machen Sie weiter!', vlong: 'Ihr Konto ist aktiv, aber Ihre Sitzung ist gestoppt. Kommen Sie zurück!' },
        es: { short: 'Tu sesión de actividad está inactiva. ¡Empieza ahora y recoge tus bonos!', medium: 'No has estado activo en un tiempo. ¡Tus bonos te esperan!', long: 'Tu actividad está pausada hace días. ¡Reanuda para mantener tu progreso!', vlong: 'Tu cuenta está activa pero tu sesión está detenida. ¡Vuelve!' },
        tr: { short: 'Aktivite oturumunuz aktif değil. Bonuslarınızı toplamak için başlayın!', medium: 'Bir süredir aktif olmadınız. Bonuslarınız bekliyor!', long: 'Aktiviteniz günlerdir duraklatıldı. İlerlemenizi korumak için devam edin!', vlong: 'Hesabınız aktif ama oturumunuz durdu. Geri dönün!' },
        ru: { short: 'Ваша сессия активности неактивна. Начните и соберите свои бонусы!', medium: 'Вы давно не были активны. Ваши бонусы ждут!', long: 'Ваша активность приостановлена уже несколько дней. Продолжайте!', vlong: 'Ваш аккаунт активен, но сессия остановлена. Вернитесь!' },
        it: { short: 'La tua sessione di attività è inattiva. Inizia ora e raccogli i tuoi bonus!', medium: 'Non sei stato attivo per un po\'. I tuoi bonus ti aspettano!', long: 'La tua attività è in pausa da giorni. Riprendi per mantenere il tuo progresso!', vlong: 'Il tuo account è attivo ma la sessione è ferma. Torna!' },
        pt: { short: 'Sua sessão de atividade está inativa. Comece agora e colete seus bônus!', medium: 'Você não esteve ativo por um tempo. Seus bônus estão esperando!', long: 'Sua atividade está pausada há dias. Retome para manter seu progresso!', vlong: 'Sua conta está ativa mas a sessão parou. Volte!' },
        zh: { short: '您的活动会话未激活。立即开始领取您的奖金！', medium: '您已有一段时间未活跃。您的奖金在等您！', long: '您的活动已暂停多天。继续保持您的进度！', vlong: '您的账户仍然活跃但会话已停止。回来吧！' },
        ja: { short: 'アクティビティセッションが非アクティブです。今すぐ始めてボーナスを集めましょう！', medium: 'しばらくアクティブではありません。ボーナスが待っています！', long: 'アクティビティが数日間停止中です。進捗を維持するために再開しましょう！', vlong: 'アカウントはアクティブですがセッションは停止中です。' },
        ko: { short: '활동 세션이 비활성 상태입니다. 지금 시작하여 보너스를 모으세요!', medium: '한동안 활동하지 않았습니다. 보너스가 기다리고 있습니다!', long: '활동이 며칠째 중단되었습니다. 진행 상황을 유지하려면 계속하세요!', vlong: '계정은 활성 상태이지만 세션이 중단되었습니다.' },
        hi: { short: 'आपका गतिविधि सत्र निष्क्रिय है। अभी शुरू करें और अपने बोनस इकट्ठा करें!', medium: 'आप कुछ समय से सक्रिय नहीं हैं। आपके बोनस इंतजार कर रहे हैं!', long: 'आपकी गतिविधि कई दिनों से रुकी है। अपनी प्रगति बनाए रखने के लिए फिर से शुरू करें!', vlong: 'खाता सक्रिय है लेकिन सत्र बंद है। वापस आएं!' },
        id: { short: 'Sesi aktivitas Anda tidak aktif. Mulai sekarang dan kumpulkan bonus Anda!', medium: 'Anda belum aktif sejak lama. Bonus Anda menunggu!', long: 'Aktivitas Anda dijeda berhari-hari. Lanjutkan untuk menjaga kemajuan Anda!', vlong: 'Akun aktif tapi sesi berhenti. Kembali!' },
        pl: { short: 'Twoja sesja aktywności jest nieaktywna. Zacznij teraz i zbieraj swoje bonusy!', medium: 'Nie byłeś aktywny od jakiegoś czasu. Twoje bonusy czekają!', long: 'Twoja aktywność jest wstrzymana od dni. Kontynuuj, aby utrzymać swój postęp!', vlong: 'Konto aktywne ale sesja zatrzymana. Wróć!' }
      };
      const msgs = RE_MSGS[userLang] || RE_MSGS['en'];
      if (daysNum >= 21) notifBody = msgs.vlong;
      else if (daysNum >= 10) notifBody = msgs.long;
      else if (daysNum >= 5) notifBody = msgs.medium;
      else notifBody = msgs.short;
    } else if (data.type === 'boost-reminder') {
      const pct = parseInt(data.progressPercent) || 50;
      const BOOST_MSGS = {
        en: { mid: 'Your session is running — activate Boost to multiply your bonuses!', end: 'Your session is nearly over. Activate Boost before it ends!' },
        ar: { mid: 'جلستك قيد التشغيل — فعّل التعزيز لمضاعفة نقاطك!', end: 'جلستك قاربت على الانتهاء. فعّل التعزيز قبل فوات الأوان!' },
        fr: { mid: 'Votre session est en cours — activez le Boost pour multiplier vos bonus !', end: 'Votre session se termine bientôt. Activez le Boost avant la fin !' },
        de: { mid: 'Ihre Sitzung läuft — aktivieren Sie den Boost, um Ihre Boni zu vervielfachen!', end: 'Ihre Sitzung endet bald. Aktivieren Sie den Boost!' },
        es: { mid: '¡Tu sesión está en curso — activa el Boost para multiplicar tus bonos!', end: '¡Tu sesión casi termina. Activa el Boost antes de que acabe!' },
        tr: { mid: 'Oturumunuz devam ediyor — bonuslarınızı artırmak için Boost aktif edin!', end: 'Oturumunuz sona eriyor. Boost hemen aktif edin!' },
        ru: { mid: 'Ваша сессия идёт — активируйте Буст для умножения бонусов!', end: 'Ваша сессия скоро закончится. Активируйте Буст!' },
        zh: { mid: '会话进行中——激活加速以倍增您的奖金！', end: '会话即将结束。赶快激活加速！' },
        ja: { mid: 'セッション進行中 — ブーストでボーナスを倍増させましょう！', end: 'セッションがまもなく終了します。ブーストを有効にしましょう！' },
        ko: { mid: '세션 진행 중 — 부스트를 활성화하여 보너스를 늘리세요!', end: '세션이 곧 끝납니다. 부스트를 활성화하세요!' },
        pt: { mid: 'Sua sessão está ativa — ative o Boost para multiplicar seus bônus!', end: 'Sua sessão está quase no fim. Ative o Boost agora!' },
        hi: { mid: 'आपका सत्र चल रहा है — बूस्ट सक्रिय करें और बोनस बढ़ाएं!', end: 'सत्र समाप्त होने वाला है। अभी बूस्ट सक्रिय करें!' },
        it: { mid: 'La sessione è in corso — attiva il Boost per moltiplicare i tuoi bonus!', end: 'La sessione sta per finire. Attiva il Boost ora!' },
        id: { mid: 'Sesi Anda berjalan — aktifkan Boost untuk melipatgandakan bonus Anda!', end: 'Sesi hampir berakhir. Aktifkan Boost sekarang!' },
        pl: { mid: 'Twoja sesja trwa — aktywuj Boost, aby zwielokrotnić swoje bonusy!', end: 'Sesja dobiega końca. Aktywuj Boost teraz!' }
      };
      const bmsgs = BOOST_MSGS[userLang] || BOOST_MSGS['en'];
      notifBody = pct >= 75 ? bmsgs.end : bmsgs.mid;
    }

    // Transaction: data-only so onMessageReceived ALWAYS fires in Java
    // Java shows notification with setLargeIcon (logo on left)
    // Other types: notification+data (system handles background)
    let message;
    if (data.type === 'transaction_received') {
      message = {
        data: {
          ...data,
          notifTitle: notifTitle,
          notifBody: notifBody,
          click_action: 'OPEN_APP',
          userId: String(userId)
        },
        android: {
          priority: 'high',
        },
        tokens: tokens
      };
    } else {
      message = {
        notification: {
          title: notifTitle,
          body: notifBody
        },
        data: {
          ...data,
          click_action: 'OPEN_APP',
          userId: String(userId)
        },
        android: {
          priority: 'high',
          notification: {
            icon: 'ic_notification',
            color: '#6c5ce7',
            sound: 'default',
            channelId: 'access_notifications',
          }
        },
        tokens: tokens
      };
    }


    const response = await admin.messaging().sendEachForMulticast(message);
    
    console.log(`📱 FCM data sent to user ${userId}: ${response.successCount} success, ${response.failureCount} failed`);

    // Only remove tokens with PERMANENT errors (not temporary failures)
    if (response.failureCount > 0) {
      const permanentlyInvalidTokens = [];
      const permanentErrorCodes = [
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token',
      ];
      
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          const errorCode = resp.error.code || '';
          console.log(`📱 [FCM] Token ${idx} error: ${errorCode} - ${resp.error.message}`);
          
          // Only mark as invalid if it's a permanent error
          if (permanentErrorCodes.includes(errorCode)) {
            permanentlyInvalidTokens.push(tokens[idx]);
          }
        }
      });
      
      // Only delete tokens with permanent errors
      if (permanentlyInvalidTokens.length > 0) {
        await pool.query(
          'DELETE FROM fcm_tokens WHERE token = ANY($1)',
          [permanentlyInvalidTokens]
        );
        console.log(`🗑️ Removed ${permanentlyInvalidTokens.length} permanently invalid FCM tokens`);
      }
    }

    return { 
      success: true, 
      successCount: response.successCount,
      failureCount: response.failureCount 
    };
  } catch (error) {
    console.error('FCM data send error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send FCM notification to multiple users
 */
export async function sendFCMToUsers(userIds, title, body, data = {}) {
  const results = await Promise.all(
    userIds.map(userId => sendFCMNotification(userId, title, body, data))
  );
  
  return {
    total: userIds.length,
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length
  };
}

/**
 * Send FCM to all registered users
 */
export async function sendFCMToAll(title, body, data = {}) {
  if (!fcmInitialized) {
    return { success: false, error: 'FCM not initialized' };
  }

  try {
    const result = await pool.query('SELECT DISTINCT token FROM fcm_tokens');
    
    if (result.rows.length === 0) {
      return { success: false, error: 'No FCM tokens registered' };
    }

    const tokens = result.rows.map(row => row.token);
    
    // FCM allows max 500 tokens per request
    const chunks = [];
    for (let i = 0; i < tokens.length; i += 500) {
      chunks.push(tokens.slice(i, i + 500));
    }

    let totalSuccess = 0;
    let totalFailed = 0;

    for (const chunk of chunks) {
      const message = {
        notification: { title, body },
        data: { ...data, click_action: 'OPEN_APP' },
        android: {
          priority: 'high',
          notification: {
            icon: 'ic_notification',
            color: '#6c5ce7',
            sound: 'default'
          }
        },
        tokens: chunk
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      totalSuccess += response.successCount;
      totalFailed += response.failureCount;
    }

    console.log(`📱 FCM broadcast: ${totalSuccess} success, ${totalFailed} failed`);
    
    return { success: true, successCount: totalSuccess, failureCount: totalFailed };
  } catch (error) {
    console.error('FCM broadcast error:', error);
    return { success: false, error: error.message };
  }
}

export default {
  sendFCMNotification,
  sendFCMDataNotification,
  sendFCMToUsers,
  sendFCMToAll,
  isInitialized: () => fcmInitialized
};
