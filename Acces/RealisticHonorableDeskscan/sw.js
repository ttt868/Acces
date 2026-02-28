// Service Worker for Push Notifications ONLY
// No caching, no offline storage - notifications only

const SW_VERSION = '11.3.0';

// Transaction notification translations
const NOTIFICATION_TRANSLATIONS = {
  en: { newTx: 'New transaction received', amount: 'Amount', from: 'From' },
  ar: { newTx: 'تم استلام معاملة جديدة', amount: 'المبلغ', from: 'من' },
  fr: { newTx: 'Nouvelle transaction reçue', amount: 'Montant', from: 'De' },
  de: { newTx: 'Neue Transaktion erhalten', amount: 'Betrag', from: 'Von' },
  es: { newTx: 'Nueva transacción recibida', amount: 'Cantidad', from: 'De' },
  tr: { newTx: 'Yeni işlem alındı', amount: 'Miktar', from: 'Gönderen' },
  ru: { newTx: 'Получена новая транзакция', amount: 'Сумма', from: 'От' },
  zh: { newTx: '收到新交易', amount: '金额', from: '来自' },
  ja: { newTx: '新しい取引を受信しました', amount: '金額', from: '送信元' },
  ko: { newTx: '새 거래가 수신되었습니다', amount: '금액', from: '발신' },
  pt: { newTx: 'Nova transação recebida', amount: 'Quantia', from: 'De' },
  hi: { newTx: 'नया लेनदेन प्राप्त हुआ', amount: 'राशि', from: 'से' },
  it: { newTx: 'Nuova transazione ricevuta', amount: 'Importo', from: 'Da' },
  id: { newTx: 'Transaksi baru diterima', amount: 'Jumlah', from: 'Dari' },
  pl: { newTx: 'Otrzymano nową transakcję', amount: 'Kwota', from: 'Od' }
};

// Re-engagement notification translations - HONEST messages (activity inactive)
const RE_ENGAGEMENT_TRANSLATIONS = {
  en: {
    day3: { title: 'ACCESS Network', body: 'Your activity session is inactive. Start now to collect your bonuses!' },
    day7: { title: 'ACCESS Network', body: 'You haven\'t been active in a while. Your bonuses are waiting!' },
    day14: { title: 'ACCESS Network', body: 'Your activity has been paused for days. Resume to keep your progress!' },
    day30: { title: 'ACCESS Network', body: 'Your account is still active but your session is stopped. Come back!' }
  },
  ar: {
    day3: { title: 'ACCESS Network', body: 'نشاطك غير فعّال. ابدأ الآن لجمع نقاطك!' },
    day7: { title: 'ACCESS Network', body: 'لم تكن نشطاً منذ فترة. نقاطك بانتظارك!' },
    day14: { title: 'ACCESS Network', body: 'نشاطك متوقف منذ أيام. استأنف للحفاظ على تقدمك!' },
    day30: { title: 'ACCESS Network', body: 'حسابك نشط لكن جلستك متوقفة. عد وابدأ من جديد!' }
  },
  fr: {
    day3: { title: 'ACCESS Network', body: 'Votre session d\'activité est inactive. Commencez pour collecter vos bonus !' },
    day7: { title: 'ACCESS Network', body: 'Vous n\'avez pas été actif depuis un moment. Vos bonus vous attendent !' },
    day14: { title: 'ACCESS Network', body: 'Votre activité est en pause depuis des jours. Reprenez pour garder votre progression !' },
    day30: { title: 'ACCESS Network', body: 'Votre compte est actif mais votre session est arrêtée. Revenez !' }
  },
  de: {
    day3: { title: 'ACCESS Network', body: 'Ihre Aktivitätssitzung ist inaktiv. Starten Sie jetzt und sammeln Sie Ihre Boni!' },
    day7: { title: 'ACCESS Network', body: 'Sie waren eine Weile nicht aktiv. Ihre Boni warten auf Sie!' },
    day14: { title: 'ACCESS Network', body: 'Ihre Aktivität ist seit Tagen pausiert. Machen Sie weiter!' },
    day30: { title: 'ACCESS Network', body: 'Ihr Konto ist aktiv, aber Ihre Sitzung ist gestoppt. Kommen Sie zurück!' }
  },
  es: {
    day3: { title: 'ACCESS Network', body: 'Tu sesión de actividad está inactiva. ¡Empieza ahora y recoge tus bonos!' },
    day7: { title: 'ACCESS Network', body: 'No has estado activo en un tiempo. ¡Tus bonos te esperan!' },
    day14: { title: 'ACCESS Network', body: 'Tu actividad está pausada hace días. ¡Reanuda para mantener tu progreso!' },
    day30: { title: 'ACCESS Network', body: 'Tu cuenta está activa pero tu sesión está detenida. ¡Vuelve!' }
  },
  tr: {
    day3: { title: 'ACCESS Network', body: 'Aktivite oturumunuz aktif değil. Bonuslarınızı toplamak için başlayın!' },
    day7: { title: 'ACCESS Network', body: 'Bir süredir aktif olmadınız. Bonuslarınız bekliyor!' },
    day14: { title: 'ACCESS Network', body: 'Aktiviteniz günlerdir duraklatıldı. İlerlemenizi korumak için devam edin!' },
    day30: { title: 'ACCESS Network', body: 'Hesabınız aktif ama oturumunuz durdu. Geri dönün!' }
  },
  ru: {
    day3: { title: 'ACCESS Network', body: 'Ваша сессия активности неактивна. Начните и соберите свои бонусы!' },
    day7: { title: 'ACCESS Network', body: 'Вы давно не были активны. Ваши бонусы ждут!' },
    day14: { title: 'ACCESS Network', body: 'Ваша активность приостановлена уже несколько дней. Продолжайте!' },
    day30: { title: 'ACCESS Network', body: 'Ваш аккаунт активен, но сессия остановлена. Вернитесь!' }
  },
  it: {
    day3: { title: 'ACCESS Network', body: 'La tua sessione di attività è inattiva. Inizia ora e raccogli i tuoi bonus!' },
    day7: { title: 'ACCESS Network', body: 'Non sei stato attivo per un po\'. I tuoi bonus ti aspettano!' },
    day14: { title: 'ACCESS Network', body: 'La tua attività è in pausa da giorni. Riprendi per mantenere il tuo progresso!' },
    day30: { title: 'ACCESS Network', body: 'Il tuo account è attivo ma la sessione è ferma. Torna!' }
  },
  pt: {
    day3: { title: 'ACCESS Network', body: 'Sua sessão de atividade está inativa. Comece agora e colete seus bônus!' },
    day7: { title: 'ACCESS Network', body: 'Você não esteve ativo por um tempo. Seus bônus estão esperando!' },
    day14: { title: 'ACCESS Network', body: 'Sua atividade está pausada há dias. Retome para manter seu progresso!' },
    day30: { title: 'ACCESS Network', body: 'Sua conta está ativa mas a sessão parou. Volte!' }
  },
  zh: {
    day3: { title: 'ACCESS Network', body: '您的活动会话未激活。立即开始领取您的奖金！' },
    day7: { title: 'ACCESS Network', body: '您已有一段时间未活跃。您的奖金在等您！' },
    day14: { title: 'ACCESS Network', body: '您的活动已暂停多天。继续保持您的进度！' },
    day30: { title: 'ACCESS Network', body: '您的账户仍然活跃但会话已停止。回来吧！' }
  },
  ja: {
    day3: { title: 'ACCESS Network', body: 'アクティビティセッションが非アクティブです。今すぐ始めてボーナスを集めましょう！' },
    day7: { title: 'ACCESS Network', body: 'しばらくアクティブではありません。ボーナスが待っています！' },
    day14: { title: 'ACCESS Network', body: 'アクティビティが数日間停止中です。進捗を維持するために再開しましょう！' },
    day30: { title: 'ACCESS Network', body: 'アカウントはアクティブですがセッションは停止中です。' }
  },
  ko: {
    day3: { title: 'ACCESS Network', body: '활동 세션이 비활성 상태입니다. 지금 시작하여 보너스를 모으세요!' },
    day7: { title: 'ACCESS Network', body: '한동안 활동하지 않았습니다. 보너스가 기다리고 있습니다!' },
    day14: { title: 'ACCESS Network', body: '활동이 며칠째 중단되었습니다. 진행 상황을 유지하려면 계속하세요!' },
    day30: { title: 'ACCESS Network', body: '계정은 활성 상태이지만 세션이 중단되었습니다.' }
  },
  hi: {
    day3: { title: 'ACCESS Network', body: 'आपका गतिविधि सत्र निष्क्रिय है। अभी शुरू करें और अपने बोनस इकट्ठा करें!' },
    day7: { title: 'ACCESS Network', body: 'आप कुछ समय से सक्रिय नहीं हैं। आपके बोनस इंतजार कर रहे हैं!' },
    day14: { title: 'ACCESS Network', body: 'आपकी गतिविधि कई दिनों से रुकी है। अपनी प्रगति बनाए रखने के लिए फिर से शुरू करें!' },
    day30: { title: 'ACCESS Network', body: 'खाता सक्रिय है लेकिन सत्र बंद है। वापस आएं!' }
  },
  id: {
    day3: { title: 'ACCESS Network', body: 'Sesi aktivitas Anda tidak aktif. Mulai sekarang dan kumpulkan bonus Anda!' },
    day7: { title: 'ACCESS Network', body: 'Anda belum aktif sejak lama. Bonus Anda menunggu!' },
    day14: { title: 'ACCESS Network', body: 'Aktivitas Anda dijeda berhari-hari. Lanjutkan untuk menjaga kemajuan Anda!' },
    day30: { title: 'ACCESS Network', body: 'Akun aktif tapi sesi berhenti. Kembali!' }
  },
  pl: {
    day3: { title: 'ACCESS Network', body: 'Twoja sesja aktywności jest nieaktywna. Zacznij teraz i zbieraj swoje bonusy!' },
    day7: { title: 'ACCESS Network', body: 'Nie byłeś aktywny od jakiegoś czasu. Twoje bonusy czekają!' },
    day14: { title: 'ACCESS Network', body: 'Twoja aktywność jest wstrzymana od dni. Kontynuuj, aby utrzymać swój postęp!' },
    day30: { title: 'ACCESS Network', body: 'Konto aktywne ale sesja zatrzymana. Wróć!' }
  }
};


// Boost reminder notification translations
const BOOST_REMINDER_TRANSLATIONS = {
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

function getBoostReminderMessage(lang, progressPercent) {
  const shortLang = (lang || 'en').substring(0, 2).toLowerCase();
  const messages = BOOST_REMINDER_TRANSLATIONS[shortLang] || BOOST_REMINDER_TRANSLATIONS.en;
  return progressPercent >= 75 ? messages.end : messages.mid;
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

function getTranslation(lang) {
  const shortLang = (lang || 'en').substring(0, 2).toLowerCase();
  return NOTIFICATION_TRANSLATIONS[shortLang] || NOTIFICATION_TRANSLATIONS.en;
}

function getReEngagementMessage(lang, daysInactive) {
  const shortLang = (lang || 'en').substring(0, 2).toLowerCase();
  const messages = RE_ENGAGEMENT_TRANSLATIONS[shortLang] || RE_ENGAGEMENT_TRANSLATIONS.en;
  if (daysInactive >= 21) return messages.day30;
  if (daysInactive >= 11) return messages.day14;
  if (daysInactive >= 6) return messages.day7;
  return messages.day3;
}

self.addEventListener('install', (event) => {
  console.log('Service Worker: Installed for notifications v' + SW_VERSION);
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activated for notifications');
  // حذف أي كاش قديم إذا وجد
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
      );
    }).then(() => self.clients.claim())
  );
});

// 🔔 FACEBOOK/INSTAGRAM STYLE: Auto-renew subscription when it expires
// This is THE KEY to making push notifications work like big apps
self.addEventListener('pushsubscriptionchange', async (event) => {
  console.log('🔄 Push subscription changed/expired - auto-renewing...');
  
  event.waitUntil((async () => {
    try {
      // Get VAPID public key from server
      const response = await fetch('/api/push/public-key');
      const data = await response.json();
      
      if (!data.success || !data.publicKey) {
        console.error('Failed to get VAPID public key for renewal');
        return;
      }
      
      // Convert VAPID key to Uint8Array
      const vapidPublicKey = urlBase64ToUint8Array(data.publicKey);
      
      // Create new subscription
      const newSubscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKey
      });
      
      console.log('✅ New subscription created automatically');
      
      // Get user ID from IndexedDB or localStorage via client
      const clients = await self.clients.matchAll({ type: 'window' });
      if (clients.length > 0) {
        // Ask client for user ID
        clients[0].postMessage({
          type: 'SUBSCRIPTION_RENEWED',
          subscription: newSubscription.toJSON()
        });
      }
      
      // Also try to save directly to server
      try {
        // Try to get userId from the old subscription's endpoint stored in DB
        await fetch('/api/push/renew-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            oldEndpoint: event.oldSubscription?.endpoint,
            newSubscription: newSubscription.toJSON()
          })
        });
        console.log('✅ Subscription renewed on server');
      } catch (saveError) {
        console.log('Will save subscription when client is active');
      }
      
    } catch (error) {
      console.error('Auto-renewal failed:', error);
    }
  })());
});

// Helper function for VAPID key conversion
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// No caching - pass all requests to network
self.addEventListener('fetch', (event) => {
  return;
});

// Handle push notifications from server
self.addEventListener('push', (event) => {
  console.log('Push notification received:', event);
  
  // If no data, this is a silent test push - don't show notification
  if (!event.data) {
    console.log('Silent push received (no data) - ignoring');
    return;
  }
  
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    console.error('Error parsing push data:', e);
    return; // Don't show notification if data is invalid
  }

  // Don't show notification if no meaningful content
  if (!data.type && !data.hash && !data.amount && !data.daysInactive) {
    console.log('Push with empty data - ignoring');
    return;
  }

  // Get language from push data (site preference) or fallback to device language
  const deviceLang = data.language || self.navigator?.language?.slice(0, 2) || 'en';
  
  let title = 'Access Network';
  let body = '';
  
  // Handle different notification types
  if (data.type === 'transaction_received' && data.amount) {
    // Transaction notification
    const t = getTranslation(deviceLang);
    const fromAddr = data.from || data.senderAddress || '';
    const fromShort = fromAddr && fromAddr.length > 10 ? 
      `${fromAddr.substring(0, 6)}...${fromAddr.substring(fromAddr.length - 4)}` : 
      (fromAddr || '???');
    body = `${t.newTx}\n${t.amount}: ${formatAmountSmart(data.amount)} ACCESS\n${t.from}: ${fromShort}`;
  } else if (data.type === 're-engagement' && data.daysInactive) {
    console.log('RE-ENGAGEMENT DEBUG: type=', data.type, 'daysInactive=', data.daysInactive, 'lang=', deviceLang);
    // Re-engagement notification - translate based on device language
    const msg = getReEngagementMessage(deviceLang, data.daysInactive);
    title = msg.title;
    body = msg.body;
  } else if (data.type === 'boost-reminder') {
    // Boost reminder notification - translate based on device language
    const progress = parseInt(data.progressPercent) || 50;
    const boostMsg = getBoostReminderMessage(deviceLang, progress);
    title = boostMsg.title;
    body = boostMsg.body;
  } else if (data.body) {
    body = data.body;
    if (data.title) title = data.title;
  } else {
    const t = getTranslation(deviceLang);
    body = t.newTx;
  }

  const options = {
    body: body,
    icon: '/access-logo-1ipfs.png',
    badge: '/access-store-96.png',
    vibrate: [200, 100, 200],
    tag: data.tag || 'access-notification',
    requireInteraction: true,
    data: data
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event.notification.tag);
  event.notification.close();

  // Open the app or focus existing window
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Try to focus existing window
        for (let client of clientList) {
          if ('focus' in client) {
            return client.focus();
          }
        }
        // Open new window if none exists
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
  );
});

// Handle messages from the main page to show notifications
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, icon, data } = event.data;
    
    self.registration.showNotification(title, {
      body: body,
      icon: icon || '/access-logo-1ipfs.png',
      tag: tag || 'access-notification',
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: data || {}
    });
  }
});
