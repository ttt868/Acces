/**
 * Firebase Cloud Messaging (FCM) for Cordova
 * Push Notifications System for Access Network App
 * Enhanced version with device language detection (like web)
 */

(function() {
  'use strict';

  let fcmToken = null;
  let messaging = null;

  // ✅ Transaction notification translations (same as notification-system.js)
  const NOTIFICATION_TRANSLATIONS = {
    en: { newTransaction: 'New transaction received', fromLabel: 'From', amountLabel: 'Amount' },
    ar: { newTransaction: 'تم استلام معاملة جديدة', fromLabel: 'من', amountLabel: 'المبلغ' },
    fr: { newTransaction: 'Nouvelle transaction reçue', fromLabel: 'De', amountLabel: 'Montant' },
    de: { newTransaction: 'Neue Transaktion erhalten', fromLabel: 'Von', amountLabel: 'Betrag' },
    es: { newTransaction: 'Nueva transacción recibida', fromLabel: 'De', amountLabel: 'Cantidad' },
    tr: { newTransaction: 'Yeni işlem alındı', fromLabel: 'Gönderen', amountLabel: 'Miktar' },
    ru: { newTransaction: 'Получена новая транзакция', fromLabel: 'От', amountLabel: 'Сумма' },
    zh: { newTransaction: '收到新交易', fromLabel: '来自', amountLabel: '金额' },
    ja: { newTransaction: '新しい取引を受信しました', fromLabel: '送信元', amountLabel: '金額' },
    ko: { newTransaction: '새 거래가 수신되었습니다', fromLabel: '발신', amountLabel: '금액' },
    pt: { newTransaction: 'Nova transação recebida', fromLabel: 'De', amountLabel: 'Quantia' },
    hi: { newTransaction: 'नया लेनदेन प्राप्त हुआ', fromLabel: 'से', amountLabel: 'राशि' },
    it: { newTransaction: 'Nuova transazione ricevuta', fromLabel: 'Da', amountLabel: 'Importo' },
    id: { newTransaction: 'Transaksi baru diterima', fromLabel: 'Dari', amountLabel: 'Jumlah' },
    pl: { newTransaction: 'Otrzymano nową transakcję', fromLabel: 'Od', amountLabel: 'Kwota' }
  };

  // ✅ Re-engagement notification translations (honest activity-inactive messages)
  const REENGAGEMENT_TRANSLATIONS = {
    en: { sessionReady: 'Your activity session is inactive. Start now to collect your bonuses!', welcomeBack: 'You haven\'t been active in a while. Your bonuses are waiting!', missYou: 'Your activity has been paused for days. Resume to keep your progress!' },
    ar: { sessionReady: 'نشاطك غير فعّال. ابدأ الآن لجمع نقاطك!', welcomeBack: 'لم تكن نشطاً منذ فترة. نقاطك بانتظارك!', missYou: 'نشاطك متوقف منذ أيام. استأنف للحفاظ على تقدمك!' },
    fr: { sessionReady: 'Votre session d\'activité est inactive. Commencez pour collecter vos bonus !', welcomeBack: 'Vous n\'avez pas été actif depuis un moment. Vos bonus vous attendent !', missYou: 'Votre activité est en pause depuis des jours. Reprenez pour garder votre progression !' },
    de: { sessionReady: 'Ihre Aktivitätssitzung ist inaktiv. Starten Sie jetzt und sammeln Sie Ihre Boni!', welcomeBack: 'Sie waren eine Weile nicht aktiv. Ihre Boni warten auf Sie!', missYou: 'Ihre Aktivität ist seit Tagen pausiert. Machen Sie weiter!' },
    es: { sessionReady: 'Tu sesión de actividad está inactiva. ¡Empieza ahora y recoge tus bonos!', welcomeBack: 'No has estado activo en un tiempo. ¡Tus bonos te esperan!', missYou: 'Tu actividad está pausada hace días. ¡Reanuda para mantener tu progreso!' },
    tr: { sessionReady: 'Aktivite oturumunuz aktif değil. Bonuslarınızı toplamak için başlayın!', welcomeBack: 'Bir süredir aktif olmadınız. Bonuslarınız bekliyor!', missYou: 'Aktiviteniz günlerdir duraklatıldı. İlerlemenizi korumak için devam edin!' },
    ru: { sessionReady: 'Ваша сессия активности неактивна. Начните и соберите свои бонусы!', welcomeBack: 'Вы давно не были активны. Ваши бонусы ждут!', missYou: 'Ваша активность приостановлена уже несколько дней. Продолжайте!' },
    zh: { sessionReady: '您的活动会话未激活。立即开始领取您的奖金！', welcomeBack: '您已有一段时间未活跃。您的奖金在等您！', missYou: '您的活动已暂停多天。继续保持您的进度！' },
    ja: { sessionReady: 'アクティビティセッションが非アクティブです。今すぐ始めてボーナスを集めましょう！', welcomeBack: 'しばらくアクティブではありません。ボーナスが待っています！', missYou: 'アクティビティが数日間停止中です。進捗を維持するために再開しましょう！' },
    ko: { sessionReady: '활동 세션이 비활성 상태입니다. 지금 시작하여 보너스를 모으세요!', welcomeBack: '한동안 활동하지 않았습니다. 보너스가 기다리고 있습니다!', missYou: '활동이 며칠째 중단되었습니다. 진행 상황을 유지하려면 계속하세요!' },
    pt: { sessionReady: 'Sua sessão de atividade está inativa. Comece agora e colete seus bônus!', welcomeBack: 'Você não esteve ativo por um tempo. Seus bônus estão esperando!', missYou: 'Sua atividade está pausada há dias. Retome para manter seu progresso!' },
    hi: { sessionReady: 'आपका गतिविधि सत्र निष्क्रिय है। अभी शुरू करें और अपने बोनस इकट्ठा करें!', welcomeBack: 'आप कुछ समय से सक्रिय नहीं हैं। आपके बोनस इंतजार कर रहे हैं!', missYou: 'आपकी गतिविधि कई दिनों से रुकी है। अपनी प्रगति बनाए रखने के लिए फिर से शुरू करें!' },
    it: { sessionReady: 'La tua sessione di attività è inattiva. Inizia ora e raccogli i tuoi bonus!', welcomeBack: 'Non sei stato attivo per un po\'. I tuoi bonus ti aspettano!', missYou: 'La tua attività è in pausa da giorni. Riprendi per mantenere il tuo progresso!' },
    id: { sessionReady: 'Sesi aktivitas Anda tidak aktif. Mulai sekarang dan kumpulkan bonus Anda!', welcomeBack: 'Anda belum aktif sejak lama. Bonus Anda menunggu!', missYou: 'Aktivitas Anda dijeda berhari-hari. Lanjutkan untuk menjaga kemajuan Anda!' },
    pl: { sessionReady: 'Twoja sesja aktywności jest nieaktywna. Zacznij teraz i zbieraj swoje bonusy!', welcomeBack: 'Nie byłeś aktywny od jakiegoś czasu. Twoje bonusy czekają!', missYou: 'Twoja aktywność jest wstrzymana od dni. Kontynuuj, aby utrzymać swój postęp!' }
  };

  // ⚡ Boost reminder notification translations
  const BOOST_TRANSLATIONS = {
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

  // Get device language (like web)
  function getDeviceLanguage() {
    var lang = navigator.language || navigator.userLanguage || 'en';
    return lang.substring(0, 2).toLowerCase();
  }

  // Get translation for current device language
  function getTranslation(key) {
    var lang = getDeviceLanguage();
    var texts = NOTIFICATION_TRANSLATIONS[lang] || NOTIFICATION_TRANSLATIONS['en'];
    return texts[key] || NOTIFICATION_TRANSLATIONS['en'][key];
  }

  // Get re-engagement translation
  function getReengagementTranslation(key) {
    var lang = getDeviceLanguage();
    var texts = REENGAGEMENT_TRANSLATIONS[lang] || REENGAGEMENT_TRANSLATIONS['en'];
    return texts[key] || REENGAGEMENT_TRANSLATIONS['en'][key];
  }

  // Get boost reminder translation
  function getBoostTranslation(progressPercent) {
    var lang = getDeviceLanguage();
    var texts = BOOST_TRANSLATIONS[lang] || BOOST_TRANSLATIONS['en'];
    return parseInt(progressPercent) >= 75 ? texts.end : texts.mid;
  }

  // Wait for device ready
  document.addEventListener('deviceready', initFCM, false);

  function initFCM() {
    console.log('🔔 [FCM] Initializing Firebase Cloud Messaging...');

    // Check if plugin is available
    if (typeof cordova === 'undefined') {
      console.warn('⚠️ [FCM] Not in Cordova environment');
      return;
    }

    if (!cordova.plugins || !cordova.plugins.firebase || !cordova.plugins.firebase.messaging) {
      console.warn('⚠️ [FCM] Firebase Messaging plugin not available');
      console.warn('⚠️ [FCM] Available plugins:', Object.keys(cordova.plugins || {}));
      return;
    }

    messaging = cordova.plugins.firebase.messaging;
    console.log('✅ [FCM] Firebase Messaging plugin found');

    // Request permission for notifications
    messaging.requestPermission().then(function() {
      console.log('✅ [FCM] Notification permission granted');
      
      // Get FCM token
      return messaging.getToken();
    }).then(function(token) {
      console.log('🔑 [FCM] Token received:', token ? token.substring(0, 30) + '...' : 'NULL');
      fcmToken = token;
      localStorage.setItem('fcm_token', token);
      
      // Try to save token to server
      saveFCMTokenToServer(token);
      
    }).catch(function(error) {
      console.error('❌ [FCM] Error:', error);
    });

    // Listen for token refresh
    messaging.onTokenRefresh(function() {
      messaging.getToken().then(function(token) {
        console.log('🔄 [FCM] Token refreshed');
        fcmToken = token;
        localStorage.setItem('fcm_token', token);
        localStorage.removeItem('fcm_registered'); // Force re-registration
        saveFCMTokenToServer(token);
      });
    });

    // Handle foreground messages
    messaging.onMessage(function(payload) {
      console.log('📩 [FCM] Foreground message:', payload);
      showInAppNotification(payload);
    });

    // Handle background message tap (opens app)
    messaging.onBackgroundMessage(function(payload) {
      console.log('📩 [FCM] Background message tap:', payload);
    });
  }

  // Save FCM token to server
  function saveFCMTokenToServer(token) {
    if (!token) {
      console.log('⚠️ [FCM] No token to save');
      return;
    }

    // Get user ID from localStorage
    const userStr = localStorage.getItem('accessoireUser');
    if (!userStr) {
      console.log('⏳ [FCM] No user logged in, token stored locally');
      localStorage.setItem('pending_fcm_token', token);
      return;
    }

    let user;
    try {
      user = JSON.parse(userStr);
    } catch (e) {
      console.error('❌ [FCM] Error parsing user:', e);
      localStorage.setItem('pending_fcm_token', token);
      return;
    }

    const userId = user.id;
    if (!userId) {
      console.log('⏳ [FCM] No user ID, token stored locally');
      localStorage.setItem('pending_fcm_token', token);
      return;
    }

    // Always send token to server (server will upsert)
    // Token may have been deleted server-side due to errors
    console.log('📤 [FCM] Saving token for user:', userId);

    // Get app's selected language (preferredLanguage) first, then fall back to device language
    const preferredLang = localStorage.getItem('preferredLanguage');
    const deviceLang = (navigator.language || navigator.userLanguage || 'en').substring(0, 2).toLowerCase();
    const appLang = preferredLang ? preferredLang.substring(0, 2).toLowerCase() : deviceLang;
    console.log('🌐 [FCM] Using language:', appLang, '(preferred:', preferredLang, ', device:', deviceLang, ')');

    fetch('https://accesschain.org/api/fcm/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId,
        token: token,
        platform: 'android',
        language: appLang
      })
    })
    .then(function(response) { return response.json(); })
    .then(function(data) {
      if (data.success) {
        console.log('✅ [FCM] Token registered successfully for user:', userId);
        localStorage.removeItem('pending_fcm_token');
        localStorage.setItem('fcm_registered', 'true');
        localStorage.setItem('fcm_registered_user', String(userId));
      } else {
        console.error('❌ [FCM] Registration failed:', data.error);
      }
    })
    .catch(function(error) {
      console.error('❌ [FCM] Network error:', error);
    });
  }

  // Show in-app notification when app is in foreground
  function showInAppNotification(payload) {
    // Check if this is a transaction notification with data
    var data = payload.data || payload;
    var title = 'Access Network';
    var body = '';

    if (data.type === 'transaction_received' && data.amount) {
      // Translate locally based on current device language (like web)
      var newTxText = getTranslation('newTransaction');
      var fromLabel = getTranslation('fromLabel');
      var amountLabel = getTranslation('amountLabel');
      // Use senderAddress (new) or from (old) for backward compatibility
      var fromShort = data.senderAddress || data.from || 'Unknown';
      if (fromShort.length > 10) {
        fromShort = fromShort.substring(0, 6) + '...' + fromShort.substring(fromShort.length - 4);
      }
      body = newTxText + '\n' + amountLabel + ': ' + data.amount + ' ACCESS\n' + fromLabel + ': ' + fromShort;
    } else if (data.type === 're-engagement' || data.type === 'reengagement') {
      // Re-engagement notification - translate locally
      body = getReengagementTranslation('sessionReady');
    } else if (data.type === 'boost-reminder') {
      // Boost reminder notification - translate locally
      var progress = data.progressPercent || 50;
      title = parseInt(progress) >= 75 ? '⏳' : '⚡';
      title += ' ACCESS Network';
      body = getBoostTranslation(progress);
    } else {
      // Use provided title/body
      title = payload.title || payload.notification?.title || 'Access Network';
      body = payload.body || payload.notification?.body || '';
    }

    // Create toast notification
    var toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:20px;left:10px;right:10px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:15px 20px;border-radius:12px;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.3);animation:fcmSlideDown 0.3s ease;display:flex;align-items:center;gap:12px;';
    toast.innerHTML = '<img src="access-logo-1ipfs.png" style="width:40px;height:40px;border-radius:50%;flex-shrink:0;" onerror="this.style.display=\'none\'">' +
      '<div><div style="font-weight:600;font-size:15px;margin-bottom:4px;">' + title + '</div>' +
      '<div style="font-size:13px;opacity:0.9;white-space:pre-line;">' + body + '</div></div>';
    
    // Add animation style if not exists
    if (!document.getElementById('fcm-animation-style')) {
      const style = document.createElement('style');
      style.id = 'fcm-animation-style';
      style.textContent = '@keyframes fcmSlideDown { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }';
      document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.5s';
      setTimeout(function() { toast.remove(); }, 500);
    }, 5000);
  }

  // Global function to manually trigger token save (call after login)
  window.registerFCMToken = function() {
    console.log('🔄 [FCM] Manual token registration triggered');
    localStorage.removeItem('fcm_registered'); // Force re-registration
    
    const token = fcmToken || localStorage.getItem('fcm_token') || localStorage.getItem('pending_fcm_token');
    if (token) {
      saveFCMTokenToServer(token);
    } else if (messaging) {
      // Try to get token again
      messaging.getToken().then(function(token) {
        fcmToken = token;
        localStorage.setItem('fcm_token', token);
        saveFCMTokenToServer(token);
      }).catch(function(error) {
        console.error('❌ [FCM] Error getting token:', error);
      });
    }
  };

  // Alias for backward compatibility
  window.savePendingFCMToken = window.registerFCMToken;

  // Check periodically for pending token registration
  setInterval(function() {
    const token = localStorage.getItem('pending_fcm_token') || localStorage.getItem('fcm_token');
    const userStr = localStorage.getItem('accessoireUser');
    const alreadyRegistered = localStorage.getItem('fcm_registered');
    const registeredUser = localStorage.getItem('fcm_registered_user');
    
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        if (user && user.id) {
          // Check if registered for different user - need to re-register
          if (registeredUser && registeredUser !== String(user.id)) {
            console.log('👤 [FCM] User changed, re-registering token...');
            localStorage.removeItem('fcm_registered');
          }
          
          if (!alreadyRegistered) {
            saveFCMTokenToServer(token);
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, 5000); // Check every 5 seconds

  // Also check when user data changes (login/logout)
  let lastUserStr = localStorage.getItem('accessoireUser');
  setInterval(function() {
    const currentUserStr = localStorage.getItem('accessoireUser');
    if (currentUserStr !== lastUserStr) {
      lastUserStr = currentUserStr;
      if (currentUserStr) {
        console.log('👤 [FCM] User changed/logged in, registering token...');
        localStorage.removeItem('fcm_registered'); // Force re-registration
        window.registerFCMToken();
      } else {
        // User logged out
        localStorage.removeItem('fcm_registered');
        localStorage.removeItem('fcm_registered_user');
      }
    }
  }, 2000); // Check every 2 seconds

  // ============================================
  // UPDATE FCM LANGUAGE WHEN APP LANGUAGE CHANGES
  // ============================================
  window.updateFCMLanguage = function(newLanguage) {
    console.log('🌐 [FCM] Updating language to:', newLanguage);
    
    // Get stored FCM token
    const token = fcmToken || localStorage.getItem('pending_fcm_token');
    if (!token) {
      console.log('⚠️ [FCM] No token available to update language');
      return;
    }
    
    // Get user ID
    const userStr = localStorage.getItem('accessoireUser');
    if (!userStr) {
      console.log('⚠️ [FCM] No user logged in');
      return;
    }
    
    let userId;
    try {
      const user = JSON.parse(userStr);
      userId = user.id;
    } catch (e) {
      console.error('❌ [FCM] Error parsing user:', e);
      return;
    }
    
    if (!userId) {
      console.log('⚠️ [FCM] No user ID');
      return;
    }
    
    // Get short language code (first 2 chars)
    const langCode = (newLanguage || 'en').substring(0, 2).toLowerCase();
    
    // Update FCM token with new language
    fetch('https://accesschain.org/api/fcm/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId,
        token: token,
        platform: 'android',
        language: langCode
      })
    })
    .then(function(response) { return response.json(); })
    .then(function(data) {
      if (data.success) {
        console.log('✅ [FCM] Language updated to:', langCode);
      } else {
        console.error('❌ [FCM] Language update failed:', data.error);
      }
    })
    .catch(function(error) {
      console.error('❌ [FCM] Network error updating language:', error);
    });
  };

})();
