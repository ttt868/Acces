// Push Notification System for ACCESS Network
// Sends push notifications when user receives ACCESS tokens

// ✅ IMMEDIATE: تخزين دالة عرض Modal عالمياً للاستدعاء المباشر
window.showNotificationModal = function() {
  console.log('🔔 [DIRECT] showNotificationModal() called from window');
  if (typeof showNotificationPromptModal === 'function') {
    showNotificationPromptModal();
  } else {
    console.error('showNotificationPromptModal not defined yet');
    // Fallback: طلب الإذن مباشرة
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(p => console.log('Permission:', p));
    }
  }
};

// Transaction notification translations
const NOTIFICATION_TRANSLATIONS = {
  en: {
    newTransaction: 'New transaction received',
    receivedTitle: 'Received ACCESS',
    fromLabel: 'From',
    amountLabel: 'Amount'
  },
  ar: {
    newTransaction: 'تم استلام معاملة جديدة',
    receivedTitle: 'استلمت ACCESS',
    fromLabel: 'من',
    amountLabel: 'المبلغ'
  },
  fr: {
    newTransaction: 'Nouvelle transaction reçue',
    receivedTitle: 'ACCESS reçu',
    fromLabel: 'De',
    amountLabel: 'Montant'
  },
  de: {
    newTransaction: 'Neue Transaktion erhalten',
    receivedTitle: 'ACCESS erhalten',
    fromLabel: 'Von',
    amountLabel: 'Betrag'
  },
  es: {
    newTransaction: 'Nueva transacción recibida',
    receivedTitle: 'ACCESS recibido',
    fromLabel: 'De',
    amountLabel: 'Cantidad'
  },
  tr: {
    newTransaction: 'Yeni işlem alındı',
    receivedTitle: 'ACCESS alındı',
    fromLabel: 'Gönderen',
    amountLabel: 'Miktar'
  },
  ru: {
    newTransaction: 'Получена новая транзакция',
    receivedTitle: 'Получено ACCESS',
    fromLabel: 'От',
    amountLabel: 'Сумма'
  },
  zh: {
    newTransaction: '收到新交易',
    receivedTitle: '收到 ACCESS',
    fromLabel: '来自',
    amountLabel: '金额'
  },
  ja: {
    newTransaction: '新しい取引を受信しました',
    receivedTitle: 'ACCESS受信',
    fromLabel: '送信元',
    amountLabel: '金額'
  },
  ko: {
    newTransaction: '새 거래가 수신되었습니다',
    receivedTitle: 'ACCESS 수신',
    fromLabel: '발신',
    amountLabel: '금액'
  },
  pt: {
    newTransaction: 'Nova transação recebida',
    receivedTitle: 'ACCESS recebido',
    fromLabel: 'De',
    amountLabel: 'Quantia'
  },
  hi: {
    newTransaction: 'नया लेनदेन प्राप्त हुआ',
    receivedTitle: 'ACCESS प्राप्त',
    fromLabel: 'से',
    amountLabel: 'राशि'
  },
  it: {
    newTransaction: 'Nuova transazione ricevuta',
    receivedTitle: 'ACCESS ricevuto',
    fromLabel: 'Da',
    amountLabel: 'Importo'
  },
  id: {
    newTransaction: 'Transaksi baru diterima',
    receivedTitle: 'ACCESS diterima',
    fromLabel: 'Dari',
    amountLabel: 'Jumlah'
  },
  pl: {
    newTransaction: 'Otrzymano nową transakcję',
    receivedTitle: 'Otrzymano ACCESS',
    fromLabel: 'Od',
    amountLabel: 'Kwota'
  }
};

// Get device language
function getDeviceLanguage() {
  const lang = navigator.language || navigator.userLanguage || 'en';
  return lang.slice(0, 2).toLowerCase();
}

// Get translation for current language
function getNotificationText(key) {
  const lang = getDeviceLanguage();
  const texts = NOTIFICATION_TRANSLATIONS[lang] || NOTIFICATION_TRANSLATIONS['en'];
  return texts[key] || NOTIFICATION_TRANSLATIONS['en'][key];
}

// Format amount: 1000 → 1,000 | 1 → 1 | 0.5 → 0.50 | 1.5 → 1.50
function formatAmountClean(amount) {
  const num = parseFloat(amount);
  if (isNaN(num)) return '0';
  
  // Check if it's a whole number
  if (Number.isInteger(num)) {
    return num.toLocaleString('en-US');
  }
  
  // Has decimals - format with max 8 decimals, remove trailing zeros, but keep min 2
  let formatted = parseFloat(num.toFixed(8)).toString();
  
  const parts = formatted.split('.');
  if (parts[1] && parts[1].length < 2) {
    parts[1] = parts[1].padEnd(2, '0');
  }
  
  // Add thousand separators
  parts[0] = parseInt(parts[0]).toLocaleString('en-US');
  
  return parts.join('.');
}

class AccessNotificationSystem {
  constructor() {
    console.log('🔔 [INIT] AccessNotificationSystem constructor called');
    this.isSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    this.permission = 'default';
    this.registration = null;
    this.userWalletAddress = null;
    this.userId = null;
    this.ws = null;
    this.pushSubscription = null;
    console.log('🔔 [INIT] isSupported:', this.isSupported);
  }

  // Initialize the notification system
  async initialize() {
    console.log('🔔 [INIT] initialize() called');
    if (!this.isSupported) {
      console.log('🔔 [INIT] Push notifications not supported on this device');
      return false;
    }

    try {
      // Register Service Worker
      console.log('🔔 [INIT] Registering service worker...');
      this.registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });
      console.log('Service Worker registered for notifications');

      // Wait for service worker to be ready
      await navigator.serviceWorker.ready;

      // Check current permission
      this.permission = Notification.permission;
      
      // Get user wallet address from session
      this.getUserWalletAddress();
      
      // Connect to WebSocket for real-time transaction updates
      this.connectWebSocket();

      // 🔔 Listen for subscription renewal messages from Service Worker
      navigator.serviceWorker.addEventListener('message', async (event) => {
        if (event.data && event.data.type === 'SUBSCRIPTION_RENEWED') {
          console.log('🔄 Received renewed subscription from Service Worker');
          await this.saveRenewedSubscription(event.data.subscription);
        }
      });

      // 🔔 FACEBOOK/INSTAGRAM STYLE: إعادة الاشتراك التلقائية
      // إذا كان الإذن ممنوح سابقاً، نعيد الاشتراك تلقائياً كل مرة
      if (this.permission === 'granted') {
        console.log('🔔 Permission granted, forcing new subscription...');
        // Wait a bit for user data to load
        setTimeout(async () => {
          await this.forceNewSubscription();
        }, 2000);
        this.startAutoRenewalCheck(); // Start checking every 5 minutes
      } else {
        console.log('🔔 Permission status:', this.permission);
      }
      
      return true;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
      return false;
    }
  }

  // 🔔 Save renewed subscription from Service Worker
  async saveRenewedSubscription(subscriptionData) {
    try {
      if (!this.userId) {
        this.getUserWalletAddress();
      }
      
      if (this.userId && subscriptionData) {
        const saveResponse = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: this.userId,
            subscription: subscriptionData
          })
        });
        
        const result = await saveResponse.json();
        if (result.success) {
          console.log('✅ Renewed subscription saved to server');
        }
      }
    } catch (error) {
      console.error('Error saving renewed subscription:', error);
    }
  }

  // 🔔 FACEBOOK/INSTAGRAM STYLE: Force create new subscription every time
  async forceNewSubscription() {
    console.log('🔔 [SUBSCRIBE] forceNewSubscription() called');
    try {
      if (!this.registration) {
        console.log('🔔 [SUBSCRIBE] ERROR: No service worker registration');
        return false;
      }

      // Check if user ID exists
      if (!this.userId) {
        console.log('🔔 [SUBSCRIBE] Getting user wallet address...');
        this.getUserWalletAddress();
      }
      
      console.log('🔔 [SUBSCRIBE] userId:', this.userId);
      
      if (!this.userId) {
        console.log('🔔 [SUBSCRIBE] ⏳ No user ID yet, will retry in 5 seconds');
        setTimeout(() => this.forceNewSubscription(), 5000);
        return false;
      }

      // Get VAPID public key from server
      console.log('🔔 [SUBSCRIBE] Fetching VAPID public key...');
      const response = await fetch('/api/push/public-key');
      const data = await response.json();
      
      if (!data.success || !data.publicKey) {
        console.error('Failed to get VAPID public key');
        return false;
      }

      const vapidPublicKey = this.urlBase64ToUint8Array(data.publicKey);

      // Always unsubscribe old and create new
      const oldSub = await this.registration.pushManager.getSubscription();
      if (oldSub) {
        try {
          await oldSub.unsubscribe();
          console.log('🗑️ Old subscription cleared');
        } catch (e) {
          console.log('Could not unsubscribe old:', e.message);
        }
      }

      // Create fresh subscription
      const subscription = await this.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKey
      });

      this.pushSubscription = subscription;
      console.log('✅ Fresh push subscription created:', subscription.endpoint.substring(0, 50));

      // Save to server
      if (!this.userId) {
        this.getUserWalletAddress();
      }

      console.log('🔔 User ID for subscription:', this.userId);

      if (this.userId) {
        try {
          const saveResponse = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: this.userId,
              subscription: subscription.toJSON()
            })
          });

          const saveData = await saveResponse.json();
          console.log('🔔 Save subscription response:', saveData);
          if (saveData.success) {
            console.log('✅ Push subscription saved to server - READY FOR NOTIFICATIONS');
            // Store in localStorage that we have subscribed on this server
            localStorage.setItem('push_subscription_saved', Date.now().toString());
            // Show success message to user
            // Notification enabled silently
          } else {
            console.error('❌ Failed to save subscription:', saveData.error);
            // Error silently logged
          }
        } catch (saveError) {
          console.error('❌ Error saving subscription:', saveError);
          // Connection error silently logged
        }
      } else {
        console.warn('⚠️ No user ID - subscription created but not saved to server');
        // Login prompt silently logged
        // Retry after user logs in
        setTimeout(() => {
          if (this.userId && this.pushSubscription) {
            this.saveSubscriptionToServer(this.pushSubscription);
          }
        }, 10000);
      }

      return true;
    } catch (error) {
      console.error('Error creating fresh subscription:', error);
      return false;
    }
  }

  // Save subscription to server
  async saveSubscriptionToServer(subscription) {
    try {
      if (!this.userId) {
        this.getUserWalletAddress();
      }
      
      if (!this.userId) {
        console.warn('⚠️ Still no user ID for subscription save');
        return false;
      }

      const saveResponse = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.userId,
          subscription: subscription.toJSON ? subscription.toJSON() : subscription
        })
      });

      const saveData = await saveResponse.json();
      if (saveData.success) {
        console.log('✅ Push subscription saved to server (retry)');
        localStorage.setItem('push_subscription_saved', Date.now().toString());
        localStorage.removeItem('pendingPushSubscription'); // ✅ مسح الاشتراك المعلق
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error saving subscription:', error);
      return false;
    }
  }

  // ✅ حفظ الاشتراك مع إعادة المحاولة
  async saveSubscriptionToServerWithRetry(subscriptionJson) {
    try {
      const saveResponse = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.userId,
          subscription: subscriptionJson
        })
      });

      const saveData = await saveResponse.json();
      if (saveData.success) {
        console.log('✅ Web Push subscription saved to server');
        localStorage.setItem('push_subscription_saved', Date.now().toString());
        localStorage.removeItem('pendingPushSubscription');
      } else {
        console.error('Failed to save push subscription:', saveData.error);
      }
    } catch (error) {
      console.error('Error saving subscription:', error);
    }
  }

  // ✅ انتظار تسجيل دخول المستخدم
  waitForUserLogin() {
    // التحقق كل 3 ثواني لمدة دقيقتين
    let attempts = 0;
    const maxAttempts = 40; // 40 × 3 = 120 ثانية
    
    const checkInterval = setInterval(async () => {
      attempts++;
      this.getUserWalletAddress();
      
      if (this.userId) {
        clearInterval(checkInterval);
        console.log('✅ User logged in, saving pending push subscription...');
        
        const pendingSubscription = localStorage.getItem('pendingPushSubscription');
        if (pendingSubscription) {
          try {
            const subscriptionJson = JSON.parse(pendingSubscription);
            await this.saveSubscriptionToServerWithRetry(subscriptionJson);
          } catch (e) {
            console.error('Error parsing pending subscription:', e);
          }
        }
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        console.log('⏰ User login wait timeout - subscription will be saved on next visit');
      }
    }, 3000);
  }

  // 🔔 Auto-renewal check every 5 minutes - like Facebook/Instagram
  startAutoRenewalCheck() {
    const FIVE_MINUTES = 5 * 60 * 1000;
    
    setInterval(async () => {
      if (this.permission === 'granted') {
        try {
          const currentSub = await this.registration?.pushManager?.getSubscription();
          if (!currentSub) {
            console.log('🔄 No subscription found - creating new one...');
            await this.forceNewSubscription();
          }
        } catch (error) {
          console.log('🔄 Subscription check failed - renewing...');
          await this.forceNewSubscription();
        }
      }
    }, FIVE_MINUTES);
    
    console.log('🔔 Auto-renewal check started (every 5 minutes)');
  }  // 🔔 FACEBOOK/INSTAGRAM STYLE: إعادة الاشتراك التلقائية الذكية
  async autoResubscribe() {
    try {
      if (!this.registration || !this.userId) {
        this.getUserWalletAddress();
      }

      // التحقق من الاشتراك الحالي
      const currentSub = await this.registration?.pushManager?.getSubscription();
      
      if (currentSub) {
        // اختبار صلاحية الاشتراك عبر السيرفر
        const testResponse = await fetch('/api/push/test-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: this.userId,
            endpoint: currentSub.endpoint
          })
        });
        
        const testResult = await testResponse.json();
        
        if (testResult.valid) {
          console.log('✅ Push subscription is still valid');
          this.pushSubscription = currentSub;
          return true;
        }
        
        console.log('⚠️ Push subscription expired/invalid, auto-resubscribing...');
      }

      // إعادة الاشتراك تلقائياً
      await this.subscribeToWebPush();
      console.log('🔔 Auto-resubscribed to push notifications (Facebook/Instagram style)');
      return true;
      
    } catch (error) {
      console.error('Auto-resubscribe error:', error);
      // محاولة الاشتراك العادي كـ fallback
      return await this.subscribeToWebPush();
    }
  }

  // Subscribe to Web Push notifications (like YouTube)
  async subscribeToWebPush() {
    try {
      if (!this.registration) {
        console.log('No service worker registration for web push');
        return false;
      }

      // Get VAPID public key from server
      const response = await fetch('/api/push/public-key');
      const data = await response.json();
      
      if (!data.success || !data.publicKey) {
        console.error('Failed to get VAPID public key:', data.error);
        return false;
      }

      // Convert VAPID key to Uint8Array
      const vapidPublicKey = this.urlBase64ToUint8Array(data.publicKey);

      // ALWAYS unsubscribe old subscription and create new one with current VAPID key
      let subscription = await this.registration.pushManager.getSubscription();
      
      if (subscription) {
        try {
          await subscription.unsubscribe();
          console.log('Old push subscription unsubscribed - creating new one');
        } catch (unsubError) {
          console.log('Could not unsubscribe old subscription:', unsubError.message);
        }
      }

      // Create new subscription with current VAPID key
      subscription = await this.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKey
      });
      console.log('New Web Push subscription created with current VAPID key');

      this.pushSubscription = subscription;

      // Get user ID
      if (!this.userId) {
        this.getUserWalletAddress();
      }

      // ✅ حفظ الاشتراك في localStorage للاستخدام لاحقاً
      const subscriptionJson = subscription.toJSON();
      localStorage.setItem('pendingPushSubscription', JSON.stringify(subscriptionJson));

      if (this.userId) {
        // Send subscription to server
        await this.saveSubscriptionToServerWithRetry(subscriptionJson);
      } else {
        console.log('⚠️ Web Push subscription created but user not logged in - will save after login');
        // ✅ تعيين مستمع لحفظ الاشتراك عند تسجيل الدخول
        this.waitForUserLogin();
      }

      return true;
    } catch (error) {
      console.error('Error subscribing to Web Push:', error);
      return false;
    }
  }

  // Convert base64 VAPID key to Uint8Array
  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // Get user's wallet address and ID from session
  getUserWalletAddress() {
    try {
      const sessionData = localStorage.getItem('accessoireUser');
      if (sessionData) {
        const user = JSON.parse(sessionData);
        if (user) {
          if (user.wallet_address) {
            this.userWalletAddress = user.wallet_address.toLowerCase();
            console.log('Notification system tracking wallet:', this.userWalletAddress);
          }
          if (user.id) {
            this.userId = String(user.id); // ⚠️ Always convert to string for DB compatibility
            console.log('Notification system tracking user ID:', this.userId);
          }
        }
      }
    } catch (error) {
      console.error('Error getting wallet address:', error);
    }
  }

  // Connect to WebSocket for real-time updates
  connectWebSocket() {
    try {
      // Need userId to connect to presence WebSocket
      if (!this.userId) {
        this.getUserWalletAddress();
      }
      
      if (!this.userId) {
        console.log('Notification WebSocket: No user ID, will retry in 5 seconds');
        setTimeout(() => this.connectWebSocket(), 5000);
        return;
      }
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/presence?userId=${this.userId}`;
      
      console.log('Notification WebSocket connecting to:', wsUrl);
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('Notification WebSocket connected successfully for user:', this.userId);
        // Send initial connection message
        try {
          this.ws.send(JSON.stringify({ 
            type: 'connect', 
            userId: this.userId,
            timestamp: Date.now()
          }));
        } catch (err) {
          console.error('Error sending initial notification message:', err);
        }
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleWebSocketMessage(data);
        } catch (e) {
          // Not JSON, ignore
        }
      };
      
      this.ws.onclose = () => {
        console.log('Notification WebSocket disconnected, reconnecting in 5 seconds...');
        setTimeout(() => this.connectWebSocket(), 5000);
      };
      
      this.ws.onerror = (error) => {
        console.error('Notification WebSocket error:', error);
      };
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
    }
  }

  // Handle WebSocket messages
  handleWebSocketMessage(data) {
    // Update wallet address if not set
    if (!this.userWalletAddress) {
      this.getUserWalletAddress();
    }
    
    if (!this.userWalletAddress) return;
    
    // Check for transaction received by current user
    if (data.type === 'wallet_activity' && data.activity === 'received') {
      const targetWallet = (data.walletAddress || '').toLowerCase();
      
      if (targetWallet === this.userWalletAddress) {
        console.log('Received transaction for current user:', data);
        this.notifyTransactionReceived({
          hash: data.hash,
          amount: data.amount,
          from: data.from || 'Unknown'
        });
      }
    }
    
    // Check for transfer_log type
    if (data.type === 'transfer_log' && data.targetWallet) {
      const targetWallet = data.targetWallet.toLowerCase();
      
      if (targetWallet === this.userWalletAddress && data.log) {
        // Parse transfer data from log
        const amount = data.log.data ? parseInt(data.log.data, 16) / 1e18 : 0;
        const fromTopic = data.log.topics && data.log.topics[1] ? data.log.topics[1] : '';
        const from = fromTopic ? '0x' + fromTopic.slice(-40) : 'Unknown';
        
        this.notifyTransactionReceived({
          hash: data.log.transactionHash,
          amount: amount,
          from: from
        });
      }
    }
    
    // Check for transaction_history type
    if (data.type === 'transaction_history' && data.targetWallet && data.transaction) {
      const targetWallet = data.targetWallet.toLowerCase();
      
      if (targetWallet === this.userWalletAddress) {
        const tx = data.transaction;
        const amount = tx.value ? parseInt(tx.value, 16) / 1e18 : 0;
        
        this.notifyTransactionReceived({
          hash: tx.hash,
          amount: amount,
          from: tx.from || 'Unknown'
        });
      }
    }
  }

  // Request notification permission
  async requestPermission() {
    console.log('🔔 [PERMISSION] requestPermission() called');
    if (!this.isSupported) {
      console.log('🔔 [PERMISSION] Not supported, returning false');
      return false;
    }

    try {
      console.log('🔔 [PERMISSION] Requesting browser permission...');
      const permission = await Notification.requestPermission();
      this.permission = permission;
      console.log('🔔 [PERMISSION] Browser response:', permission);
      
      if (permission === 'granted') {
        console.log('🔔 [PERMISSION] ✅ Permission GRANTED - subscribing to Web Push...');
        // Subscribe to Web Push for background notifications
        await this.subscribeToWebPush();
        return true;
      } else {
        console.log('🔔 [PERMISSION] ❌ Permission DENIED or dismissed');
        return false;
      }
    } catch (error) {
      console.error('🔔 [PERMISSION] Error requesting permission:', error);
      return false;
    }
  }

  // Show notification when ACCESS tokens are received
  async notifyTransactionReceived(txData) {
    if (!this.isSupported) {
      console.log('Cannot show notification - not supported');
      return;
    }
    
    // Request permission if not granted
    if (this.permission !== 'granted') {
      const granted = await this.requestPermission();
      if (!granted) {
        console.log('Cannot show notification - permission not granted');
        return;
      }
    }

    try {
      const amount = formatAmountClean(txData.amount || 0);
      const from = txData.from || 'Unknown';
      const fromShort = from.length > 10 ? `${from.substring(0, 6)}...${from.substring(from.length - 4)}` : from;
      
      // Get translated notification text
      const title = 'Access Network';
      const fromLabel = getNotificationText('fromLabel');
      const amountLabel = getNotificationText('amountLabel');
      const newTxText = getNotificationText('newTransaction') || 'New transaction received';
      const body = `${newTxText}\n${amountLabel}: ${amount} ACCESS\n${fromLabel}: ${fromShort}`;

      const options = {
        body: body,
        icon: '/access-logo-1ipfs.png',
        image: '/access-logo-1ipfs.png',
        vibrate: [200, 100, 200, 100, 200],
        tag: `access-tx-${txData.hash || Date.now()}`,
        requireInteraction: true,
        data: {
          type: 'transaction_received',
          hash: txData.hash,
          amount: amount,
          from: from,
          language: getDeviceLanguage(),
          timestamp: Date.now()
        }
      };

      // Show notification via Service Worker
      if (this.registration && this.registration.active) {
        // Send message to service worker to show notification
        this.registration.active.postMessage({
          type: 'SHOW_NOTIFICATION',
          title: title,
          body: body,
          tag: options.tag,
          icon: options.icon,
          data: options.data
        });
        console.log('Notification sent to service worker:', title, body);
      } else if (this.registration) {
        // Try showNotification directly
        await this.registration.showNotification(title, options);
        console.log('Notification shown via registration:', title, body);
      } else {
        // Fallback to direct Notification API
        new Notification(title, options);
        console.log('Notification shown directly:', title, body);
      }
    } catch (error) {
      console.error('Error showing notification:', error);
    }
  }

  // Test notification
  async testNotification() {
    const testData = {
      hash: '0x' + Math.random().toString(16).slice(2, 66),
      amount: 10.5,
      from: '0xabcdef1234567890abcdef1234567890abcdef12'
    };
    
    await this.notifyTransactionReceived(testData);
  }
  
  // Update user wallet address (called when user logs in or wallet changes)
  updateWalletAddress(address) {
    if (address) {
      this.userWalletAddress = address.toLowerCase();
      console.log('Notification wallet address updated:', this.userWalletAddress);
    }
  }
}

// Create global instance
window.accessNotifications = new AccessNotificationSystem();

// Auto-initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🔔 [INIT] DOMContentLoaded - starting notification system...');
  
  // Show debug status
  const debugInfo = {
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'N/A'
  };
  console.log('🔔 [DEBUG] Browser support:', debugInfo);
  
  const initialized = await window.accessNotifications.initialize();
  console.log('🔔 [INIT] Initialize result:', initialized);
  
  if (initialized) {
    // ✅ Check for pending subscription (created but not saved)
    setTimeout(async () => {
      window.accessNotifications.getUserWalletAddress();
      const pendingSubscription = localStorage.getItem('pendingPushSubscription');
      if (pendingSubscription && window.accessNotifications.userId) {
        console.log('🔔 Found pending subscription - saving now...');
        try {
          const subscriptionJson = JSON.parse(pendingSubscription);
          await window.accessNotifications.saveSubscriptionToServerWithRetry(subscriptionJson);
        } catch (e) {
          console.error('Error saving pending subscription:', e);
        }
      }
    }, 2000);

    // Check permission after a short delay
    setTimeout(async () => {
      const currentPermission = Notification.permission;
      console.log('🔔 [PERMISSION CHECK] Current permission:', currentPermission);
      
      if (currentPermission === 'default') {
        // Never asked - show prompt modal (requires user click for modern browsers)
        console.log('🔔 Permission not yet requested - showing prompt modal');
        showNotificationPromptModal(); // ✅ ENABLED - user must click to grant permission
      } else if (currentPermission === 'denied') {
        // Blocked - show message to user
        console.log('🔔 Notifications are blocked. User needs to enable in browser settings.');
        showNotificationBlockedMessage();
      } else if (currentPermission === 'granted') {
        // Already granted - make sure we have a valid subscription
        console.log('🔔 Notifications granted - ensuring subscription...');
        await window.accessNotifications.forceNewSubscription();
      }
    }, 3000);
  } else {
    console.log('🔔 [INIT] ❌ Failed to initialize - showing manual prompt');
    // Show prompt anyway after 5 seconds
    setTimeout(() => {
      console.log('🔔 [FALLBACK] Trying to show modal after init failure...');
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        showNotificationPromptModal(); // ✅ ENABLED
      }
    }, 5000);
  }
  
  // ✅ EMERGENCY FALLBACK: إذا لم يظهر Modal بعد 10 ثواني، حاول مرة أخرى
  setTimeout(() => {
    console.log('🔔 [EMERGENCY] 10s fallback check...');
    const modalExists = document.getElementById('notification-prompt-modal');
    if (!modalExists && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      console.log('🔔 [EMERGENCY] Modal not shown yet - forcing display!');
      showNotificationPromptModal();
    }
  }, 10000);
  
  // ✅ MOBILE FRIENDLY: إظهار Banner ظاهر في أعلى الصفحة بعد ثانيتين
  setTimeout(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      showNotificationBanner();
    }
  }, 2000);
});

// 🔔 Show notification BANNER (visible at top of page - mobile friendly)
function showNotificationBanner() {
  console.log('🔔 [BANNER] showNotificationBanner() called');
  
  // Don't show if already exists
  if (document.getElementById('notification-banner')) {
    console.log('🔔 [BANNER] Already exists');
    return;
  }
  
  // Don't show if permission already granted or denied
  if (Notification.permission !== 'default') {
    console.log('🔔 [BANNER] Permission is:', Notification.permission);
    return;
  }
  
  console.log('🔔 [BANNER] Creating banner...');
  
  const banner = document.createElement('div');
  banner.id = 'notification-banner';
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 15px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: 999999;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  banner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
      <span style="font-size: 24px;">🔔</span>
      <span style="font-size: 14px; font-weight: 500;">Enable notifications to receive alerts when you get ACCESS tokens</span>
    </div>
    <button id="enable-notif-btn" style="
      background: white;
      color: #667eea;
      border: none;
      padding: 10px 20px;
      border-radius: 25px;
      font-weight: bold;
      cursor: pointer;
      font-size: 14px;
      white-space: nowrap;
    ">Enable</button>
    <button id="close-banner-btn" style="
      background: transparent;
      color: white;
      border: none;
      padding: 10px;
      cursor: pointer;
      font-size: 20px;
      margin-left: 10px;
    ">×</button>
  `;
  
  document.body.prepend(banner);
  
  // Enable button
  document.getElementById('enable-notif-btn').addEventListener('click', async () => {
    console.log('🔔 [BANNER] Enable clicked!');
    banner.innerHTML = '<span style="padding: 15px;">⏳ Requesting permission...</span>';
    
    try {
      const permission = await Notification.requestPermission();
      console.log('🔔 [BANNER] Permission result:', permission);
      
      if (permission === 'granted') {
        banner.style.background = 'linear-gradient(135deg, #00c853 0%, #00e676 100%)';
        banner.innerHTML = '<span style="padding: 15px;">✅ Notifications enabled!</span>';
        
        // Subscribe to push
        if (window.accessNotifications) {
          await window.accessNotifications.forceNewSubscription();
        }
        
        setTimeout(() => banner.remove(), 3000);
      } else {
        banner.style.background = 'linear-gradient(135deg, #ff5252 0%, #ff1744 100%)';
        banner.innerHTML = '<span style="padding: 15px;">❌ Notifications blocked. Enable in browser settings.</span>';
        setTimeout(() => banner.remove(), 5000);
      }
    } catch (e) {
      console.error('🔔 [BANNER] Error:', e);
      banner.innerHTML = '<span style="padding: 15px;">❌ Error: ' + e.message + '</span>';
    }
  });
  
  // Close button
  document.getElementById('close-banner-btn').addEventListener('click', () => {
    banner.remove();
    localStorage.setItem('notification_banner_closed', Date.now().toString());
  });
}

// 🔔 Show notification prompt modal (required for modern browsers - needs user click)
function showNotificationPromptModal() {
  console.log('🔔 [MODAL] showNotificationPromptModal() called');
  console.log('🔔 [MODAL] Current permission:', Notification.permission);
  console.log('🔔 [MODAL] sessionStorage notificationPromptShown:', sessionStorage.getItem('notificationPromptShown'));
  
  // Don't show if permission already granted
  if (Notification.permission === 'granted') {
    console.log('🔔 [MODAL] Permission already granted - skipping modal');
    // ✅ لكن تأكد من وجود subscription
    if (window.accessNotifications) {
      window.accessNotifications.forceNewSubscription();
    }
    return;
  }
  
  // Don't show if permission denied
  if (Notification.permission === 'denied') {
    console.log('🔔 [MODAL] Permission denied - showing blocked message instead');
    showNotificationBlockedMessage();
    return;
  }
  
  // ✅ إزالة شرط sessionStorage - نريد إظهار Modal دائماً إذا لم يتم منح الإذن
  // if (sessionStorage.getItem('notificationPromptShown')) {
  //   console.log('🔔 [MODAL] Already shown in this session - skipping');
  //   return;
  // }
  
  console.log('🔔 [MODAL] ✅ Creating notification prompt modal NOW...');
  
  const modal = document.createElement('div');
  modal.id = 'notification-prompt-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 999999;
    animation: fadeIn 0.3s ease;
  `;
  
  modal.innerHTML = `
    <div style="
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border-radius: 20px;
      padding: 30px;
      max-width: 350px;
      width: 90%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.1);
    ">
      <div style="font-size: 60px; margin-bottom: 15px;">🔔</div>
      <h3 style="color: #fff; margin: 0 0 10px 0; font-size: 20px;">Enable Notifications</h3>
      <p style="color: rgba(255, 255, 255, 0.7); margin: 0 0 20px 0; font-size: 14px; line-height: 1.5;">
        Get notified when you receive ACCESS tokens and important updates.
      </p>
      <button id="enable-notifications-btn" style="
        background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%);
        color: white;
        border: none;
        padding: 14px 40px;
        border-radius: 30px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        width: 100%;
        margin-bottom: 10px;
        transition: transform 0.2s, box-shadow 0.2s;
      ">
        Enable Notifications
      </button>
      <button id="skip-notifications-btn" style="
        background: transparent;
        color: rgba(255, 255, 255, 0.5);
        border: none;
        padding: 10px;
        font-size: 14px;
        cursor: pointer;
        width: 100%;
      ">
        Maybe later
      </button>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Enable button - THIS is the user gesture that allows permission request
  document.getElementById('enable-notifications-btn').addEventListener('click', async () => {
    sessionStorage.setItem('notificationPromptShown', 'true');
    modal.remove();
    
    // Now request permission - this works because it's from a click event
    console.log('🔔 User clicked enable - requesting permission...');
    const granted = await window.accessNotifications.requestPermission();
    
    if (granted) {
      showNotificationSuccessToast();
    }
  });
  
  // Skip button
  document.getElementById('skip-notifications-btn').addEventListener('click', () => {
    sessionStorage.setItem('notificationPromptShown', 'true');
    modal.remove();
  });
  
  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      sessionStorage.setItem('notificationPromptShown', 'true');
      modal.remove();
    }
  });
}

// Show success toast after enabling notifications
function showNotificationSuccessToast() {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #00c853 0%, #00e676 100%);
    color: white;
    padding: 15px 25px;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 200, 83, 0.4);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 600;
    animation: slideDown 0.3s ease;
  `;
  toast.innerHTML = '✅ Notifications enabled successfully!';
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), 4000);
}

// Show message when notifications are blocked
function showNotificationBlockedMessage() {
  return; // DISABLED
  if (sessionStorage.getItem('notificationBlockedShown')) return;
  sessionStorage.setItem('notificationBlockedShown', 'true');
  
  // Create toast message
  const toast = document.createElement('div');
  toast.id = 'notification-blocked-toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
    color: white;
    padding: 15px 25px;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(255, 107, 107, 0.4);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 90%;
    text-align: center;
    cursor: pointer;
  `;
  toast.innerHTML = `
    <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">🔔 الإشعارات محظورة</div>
    <div style="font-size: 12px; opacity: 0.9;">اضغط لتفعيل الإشعارات من إعدادات المتصفح</div>
  `;
  
  toast.onclick = () => {
    // Try to open browser notification settings
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'notifications' }).then(result => {
        console.log('Notification permission status:', result.state);
      });
    }
    toast.remove();
  };
  
  document.body.appendChild(toast);
  
  // Auto-hide after 10 seconds
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 10000);
}

// Show notification status to user (visible on phone)
function showNotificationStatus(message, type = 'info') {
  // Remove old status if exists
  const old = document.getElementById('notification-status-toast');
  if (old) old.remove();
  
  const colors = {
    success: 'linear-gradient(135deg, #00c853 0%, #00e676 100%)',
    error: 'linear-gradient(135deg, #ff5252 0%, #ff1744 100%)',
    warning: 'linear-gradient(135deg, #ff9800 0%, #ffc107 100%)',
    info: 'linear-gradient(135deg, #2196f3 0%, #03a9f4 100%)'
  };
  
  const toast = document.createElement('div');
  toast.id = 'notification-status-toast';
  toast.style.cssText = `
    position: fixed;
    top: 70px;
    left: 50%;
    transform: translateX(-50%);
    background: ${colors[type] || colors.info};
    color: white;
    padding: 12px 20px;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    text-align: center;
    max-width: 85%;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 5000);
}

// Listen for user login/wallet changes (cross-tab only)
window.addEventListener('storage', async (event) => {
  if (event.key === 'accessoireUser') {
    window.accessNotifications.getUserWalletAddress();
    
    // ✅ Try to save pending subscription after login
    const pendingSubscription = localStorage.getItem('pendingPushSubscription');
    if (pendingSubscription && window.accessNotifications.userId) {
      console.log('🔔 User logged in - saving pending push subscription...');
      try {
        const subscriptionJson = JSON.parse(pendingSubscription);
        await window.accessNotifications.saveSubscriptionToServerWithRetry(subscriptionJson);
      } catch (e) {
        console.error('Error saving pending subscription:', e);
      }
    }
    
    // Try to save existing subscription after login
    if (window.accessNotifications.pushSubscription) {
      window.accessNotifications.saveSubscriptionToServer(window.accessNotifications.pushSubscription);
    }
  }
});

// ✅ NEW: Listen for custom userLoggedIn event (same-tab)
window.addEventListener('userLoggedIn', async (event) => {
  console.log('🔔 [EVENT] userLoggedIn event received');
  window.accessNotifications.getUserWalletAddress();
  
  if (window.accessNotifications.userId) {
    // Save any pending subscription
    const pendingSubscription = localStorage.getItem('pendingPushSubscription');
    if (pendingSubscription) {
      console.log('🔔 [EVENT] Saving pending subscription for user:', window.accessNotifications.userId);
      try {
        const subscriptionJson = JSON.parse(pendingSubscription);
        await window.accessNotifications.saveSubscriptionToServerWithRetry(subscriptionJson);
      } catch (e) {
        console.error('Error saving pending subscription:', e);
      }
    }
    
    // Also ensure we have a subscription if permission is granted
    if (Notification.permission === 'granted' && !window.accessNotifications.pushSubscription) {
      console.log('🔔 [EVENT] Creating new subscription after login...');
      await window.accessNotifications.forceNewSubscription();
    }
  }
});

// ✅ NEW: Continuous polling for userId (every 5 seconds)
// This catches cases where storage event doesn't fire (same tab)
let _pushPollingStarted = false;
function startPushSubscriptionPolling() {
  if (_pushPollingStarted) return;
  _pushPollingStarted = true;
  
  console.log('🔔 [POLLING] Starting continuous userId check (every 5 seconds)');
  
  setInterval(async () => {
    // Skip if already have userId and subscription is saved
    if (localStorage.getItem('push_subscription_saved') && window.accessNotifications.userId) {
      return;
    }
    
    // Check for userId
    const prevUserId = window.accessNotifications.userId;
    window.accessNotifications.getUserWalletAddress();
    
    // If userId just became available
    if (!prevUserId && window.accessNotifications.userId) {
      console.log('🔔 [POLLING] userId now available:', window.accessNotifications.userId);
      
      // Check for pending subscription
      const pendingSubscription = localStorage.getItem('pendingPushSubscription');
      if (pendingSubscription) {
        console.log('🔔 [POLLING] Saving pending subscription...');
        try {
          const subscriptionJson = JSON.parse(pendingSubscription);
          await window.accessNotifications.saveSubscriptionToServerWithRetry(subscriptionJson);
        } catch (e) {
          console.error('Error saving pending subscription:', e);
        }
      } else if (Notification.permission === 'granted') {
        // Create new subscription
        console.log('🔔 [POLLING] Creating subscription for newly logged in user...');
        await window.accessNotifications.forceNewSubscription();
      }
    }
  }, 5000);
}

// Start polling after page load
if (document.readyState === 'complete') {
  startPushSubscriptionPolling();
} else {
  window.addEventListener('load', startPushSubscriptionPolling);
}
