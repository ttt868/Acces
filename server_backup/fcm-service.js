/**
 * Firebase Cloud Messaging (FCM) Service
 * For sending push notifications to Cordova app
 * With multi-language support (15 languages)
 */

import admin from 'firebase-admin';
import { pool } from './db.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================
// NOTIFICATION TRANSLATIONS (15 languages)
// ============================================
const FCM_TRANSLATIONS = {
  en: {
    txTitle: "Transaction Received",
    txBody: "{amount} ACCESS from {sender}",
    reengageTitle: "ACCESS Network",
    reengage3: "Your session is ready! Tap to start a new activity.",
    reengage5: "ACCESS Network is waiting for you. Start your session now.",
    reengage7: "Your ACCESS Network activity awaits. Come back and explore!",
    reengage14: "ACCESS Network has updates for you. Tap to check in!",
    reengageLong: "Your account is still active. Ready to continue?"
  },
  ar: {
    txTitle: "تم استلام معاملة",
    txBody: "{amount} ACCESS من {sender}",
    reengageTitle: "شبكة ACCESS",
    reengage3: "جلستك جاهزة! اضغط لبدء نشاط جديد.",
    reengage5: "شبكة ACCESS في انتظارك. ابدأ جلستك الآن.",
    reengage7: "نشاطك في شبكة ACCESS بانتظارك. عُد واستكشف!",
    reengage14: "لديك تحديثات في شبكة ACCESS. اضغط للاطلاع!",
    reengageLong: "حسابك لا يزال نشطاً. هل أنت مستعد للمتابعة؟"
  },
  fr: {
    txTitle: "Transaction reçue",
    txBody: "{amount} ACCESS de {sender}",
    reengageTitle: "ACCESS Network",
    reengage3: "Votre session est prête ! Appuyez pour démarrer une nouvelle activité.",
    reengage5: "ACCESS Network vous attend. Commencez votre session maintenant.",
    reengage7: "Votre activité ACCESS Network vous attend. Revenez explorer !",
    reengage14: "ACCESS Network a des mises à jour pour vous. Appuyez pour voir !",
    reengageLong: "Votre compte est toujours actif. Prêt à continuer ?"
  },
  de: {
    txTitle: "Transaktion erhalten",
    txBody: "{amount} ACCESS von {sender}",
    reengageTitle: "ACCESS Network",
    reengage3: "Ihre Sitzung ist bereit! Tippen Sie, um eine neue Aktivität zu starten.",
    reengage5: "ACCESS Network wartet auf Sie. Starten Sie jetzt Ihre Sitzung.",
    reengage7: "Ihre ACCESS Network-Aktivität wartet. Kommen Sie zurück und entdecken Sie!",
    reengage14: "ACCESS Network hat Updates für Sie. Tippen Sie zum Einchecken!",
    reengageLong: "Ihr Konto ist noch aktiv. Bereit weiterzumachen?"
  },
  es: {
    txTitle: "Transacción recibida",
    txBody: "{amount} ACCESS de {sender}",
    reengageTitle: "ACCESS Network",
    reengage3: "¡Tu sesión está lista! Toca para iniciar una nueva actividad.",
    reengage5: "ACCESS Network te espera. Comienza tu sesión ahora.",
    reengage7: "Tu actividad en ACCESS Network te espera. ¡Vuelve y explora!",
    reengage14: "ACCESS Network tiene actualizaciones para ti. ¡Toca para ver!",
    reengageLong: "Tu cuenta sigue activa. ¿Listo para continuar?"
  },
  tr: {
    txTitle: "İşlem alındı",
    txBody: "{sender}'dan {amount} ACCESS",
    reengageTitle: "ACCESS Network",
    reengage3: "Oturumunuz hazır! Yeni bir aktivite başlatmak için dokunun.",
    reengage5: "ACCESS Network sizi bekliyor. Oturumunuza şimdi başlayın.",
    reengage7: "ACCESS Network aktiviteniz sizi bekliyor. Geri dönün ve keşfedin!",
    reengage14: "ACCESS Network sizin için güncellemeler var. Kontrol etmek için dokunun!",
    reengageLong: "Hesabınız hala aktif. Devam etmeye hazır mısınız?"
  },
  it: {
    txTitle: "Transazione ricevuta",
    txBody: "{amount} ACCESS da {sender}",
    reengageTitle: "ACCESS Network",
    reengage3: "La tua sessione è pronta! Tocca per iniziare una nuova attività.",
    reengage5: "ACCESS Network ti aspetta. Inizia la tua sessione ora.",
    reengage7: "La tua attività su ACCESS Network ti aspetta. Torna a esplorare!",
    reengage14: "ACCESS Network ha aggiornamenti per te. Tocca per vedere!",
    reengageLong: "Il tuo account è ancora attivo. Pronto a continuare?"
  },
  pt: {
    txTitle: "Transação recebida",
    txBody: "{amount} ACCESS de {sender}",
    reengageTitle: "ACCESS Network",
    reengage3: "Sua sessão está pronta! Toque para iniciar uma nova atividade.",
    reengage5: "ACCESS Network está esperando por você. Comece sua sessão agora.",
    reengage7: "Sua atividade no ACCESS Network está esperando. Volte e explore!",
    reengage14: "ACCESS Network tem atualizações para você. Toque para ver!",
    reengageLong: "Sua conta ainda está ativa. Pronto para continuar?"
  },
  ru: {
    txTitle: "Транзакция получена",
    txBody: "{amount} ACCESS от {sender}",
    reengageTitle: "ACCESS Network",
    reengage3: "Ваша сессия готова! Нажмите, чтобы начать новую активность.",
    reengage5: "ACCESS Network ждет вас. Начните сессию сейчас.",
    reengage7: "Ваша активность в ACCESS Network ждет. Возвращайтесь!",
    reengage14: "ACCESS Network имеет обновления для вас. Нажмите, чтобы проверить!",
    reengageLong: "Ваш аккаунт все еще активен. Готовы продолжить?"
  },
  zh: {
    txTitle: "收到交易",
    txBody: "来自 {sender} 的 {amount} ACCESS",
    reengageTitle: "ACCESS Network",
    reengage3: "您的会话已准备就绪！点击开始新活动。",
    reengage5: "ACCESS Network 正在等您。立即开始您的会话。",
    reengage7: "您的 ACCESS Network 活动正在等待您。回来探索吧！",
    reengage14: "ACCESS Network 有更新给您。点击查看！",
    reengageLong: "您的账户仍然活跃。准备好继续了吗？"
  },
  ja: {
    txTitle: "取引を受信",
    txBody: "{sender}から{amount} ACCESS",
    reengageTitle: "ACCESS Network",
    reengage3: "セッションの準備ができました！タップして新しいアクティビティを開始。",
    reengage5: "ACCESS Network がお待ちしています。今すぐセッションを開始しましょう。",
    reengage7: "ACCESS Network でのアクティビティがお待ちしています。戻ってきてください！",
    reengage14: "ACCESS Network に更新があります。タップして確認！",
    reengageLong: "アカウントはまだアクティブです。続ける準備はできましたか？"
  },
  ko: {
    txTitle: "거래 수신",
    txBody: "{sender}로부터 {amount} ACCESS",
    reengageTitle: "ACCESS Network",
    reengage3: "세션이 준비되었습니다! 탭하여 새 활동을 시작하세요.",
    reengage5: "ACCESS Network가 기다리고 있습니다. 지금 세션을 시작하세요.",
    reengage7: "ACCESS Network 활동이 기다리고 있습니다. 돌아와서 탐험하세요!",
    reengage14: "ACCESS Network에 업데이트가 있습니다. 탭하여 확인하세요!",
    reengageLong: "계정이 아직 활성 상태입니다. 계속할 준비가 되셨나요?"
  },
  hi: {
    txTitle: "लेनदेन प्राप्त",
    txBody: "{sender} से {amount} ACCESS",
    reengageTitle: "ACCESS Network",
    reengage3: "आपका सत्र तैयार है! नई गतिविधि शुरू करने के लिए टैप करें।",
    reengage5: "ACCESS Network आपका इंतजार कर रहा है। अभी अपना सत्र शुरू करें।",
    reengage7: "आपकी ACCESS Network गतिविधि आपका इंतजार कर रही है। वापस आएं!",
    reengage14: "ACCESS Network में आपके लिए अपडेट हैं। देखने के लिए टैप करें!",
    reengageLong: "आपका खाता अभी भी सक्रिय है। जारी रखने के लिए तैयार?"
  },
  id: {
    txTitle: "Transaksi diterima",
    txBody: "{amount} ACCESS dari {sender}",
    reengageTitle: "ACCESS Network",
    reengage3: "Sesi Anda siap! Ketuk untuk memulai aktivitas baru.",
    reengage5: "ACCESS Network menunggu Anda. Mulai sesi Anda sekarang.",
    reengage7: "Aktivitas ACCESS Network Anda menunggu. Kembali dan jelajahi!",
    reengage14: "ACCESS Network punya pembaruan untuk Anda. Ketuk untuk melihat!",
    reengageLong: "Akun Anda masih aktif. Siap melanjutkan?"
  },
  pl: {
    txTitle: "Otrzymano transakcję",
    txBody: "{amount} ACCESS od {sender}",
    reengageTitle: "ACCESS Network",
    reengage3: "Twoja sesja jest gotowa! Dotknij, aby rozpocząć nową aktywność.",
    reengage5: "ACCESS Network czeka na Ciebie. Rozpocznij sesję teraz.",
    reengage7: "Twoja aktywność w ACCESS Network czeka. Wróć i odkrywaj!",
    reengage14: "ACCESS Network ma dla Ciebie aktualizacje. Dotknij, aby sprawdzić!",
    reengageLong: "Twoje konto jest nadal aktywne. Gotowy kontynuować?"
  }
};

// Get translation for a language
function getT(lang) {
  const shortLang = (lang || 'en').substring(0, 2).toLowerCase();
  return FCM_TRANSLATIONS[shortLang] || FCM_TRANSLATIONS.en;
}

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
        'messaging/invalid-argument'
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
 * Send FCM notification with data payload
 * Includes notification for background display + data for foreground handling
 * Auto-translates based on user's language preference
 */
export async function sendFCMDataNotification(userId, data = {}) {
  if (!fcmInitialized) {
    console.error('FCM not initialized');
    return { success: false, error: 'FCM not initialized' };
  }

  try {
    // Get FCM tokens AND device language from fcm_tokens
    // Language is stored in fcm_tokens.language when token is registered
    const result = await pool.query(
      `SELECT f.token, COALESCE(f.language, u.language, 'en') as language 
       FROM fcm_tokens f 
       LEFT JOIN users u ON f.user_id = u.id 
       WHERE f.user_id = $1`,
      [parseInt(userId)]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'No FCM token found for user' };
    }

    const tokens = result.rows.map(row => row.token);
    const userLang = result.rows[0]?.language || 'en';
    const t = getT(userLang);
    
    console.log(`📱 [FCM] User ${userId} device language: ${userLang}`);
    
    // Build notification title/body based on type WITH TRANSLATION
    let notifTitle = "Access Network";
    let notifBody = "New notification";
    
    if (data.type === "transaction_received" && data.amount) {
      const senderShort = data.sender ? data.sender.substring(0, 6) + "..." + data.sender.slice(-4) : "???";
      notifTitle = t.txTitle;
      notifBody = t.txBody.replace("{amount}", data.amount).replace("{sender}", senderShort);
    } else if (data.type === "re-engagement") {
      const days = parseInt(data.daysInactive) || 3;
      notifTitle = t.reengageTitle;
      // 5 different messages like web notifications
      if (days <= 4) notifBody = t.reengage3;        // 3-4 days
      else if (days <= 6) notifBody = t.reengage5;   // 5-6 days
      else if (days <= 10) notifBody = t.reengage7;  // 7-10 days
      else if (days <= 14) notifBody = t.reengage14; // 11-14 days
      else notifBody = t.reengageLong;               // 15-30 days
    }
    
    console.log(`📱 [FCM] User ${userId} lang=${userLang} → "${notifTitle}"`);
    
    // Message with notification + data payload
    const message = {
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
          color: '#f7931a',
          sound: 'default',
          channelId: 'access_notifications'
        }
      },
      tokens: tokens
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    
    console.log(`📱 FCM data sent to user ${userId}: ${response.successCount} success, ${response.failureCount} failed`);

    // Only remove tokens with PERMANENT errors (not temporary failures)
    if (response.failureCount > 0) {
      const permanentlyInvalidTokens = [];
      const permanentErrorCodes = [
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token',
        'messaging/invalid-argument'
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
