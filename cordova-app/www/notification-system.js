// Push Notification System for ACCESS Network
// Sends push notifications when user receives ACCESS tokens

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
    this.isSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    this.permission = 'default';
    this.registration = null;
    this.userWalletAddress = null;
    this.userId = null;
    this.ws = null;
    this.pushSubscription = null;
  }

  // Initialize the notification system
  async initialize() {
    if (!this.isSupported) {
      console.log('Push notifications not supported on this device');
      return false;
    }

    try {
      // Register Service Worker
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
        await this.forceNewSubscription(); // Always create fresh subscription on load
        this.startAutoRenewalCheck(); // Start checking every 5 minutes
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
    try {
      if (!this.registration) {
        console.log('No service worker registration');
        return false;
      }

      // Get VAPID public key from server
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
      console.log('✅ Fresh push subscription created');

      // Save to server
      if (!this.userId) {
        this.getUserWalletAddress();
      }

      if (this.userId) {
        const saveResponse = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: this.userId,
            subscription: subscription.toJSON()
          })
        });

        const saveData = await saveResponse.json();
        if (saveData.success) {
          console.log('✅ Push subscription saved to server - READY FOR NOTIFICATIONS');
        }
      }

      return true;
    } catch (error) {
      console.error('Error creating fresh subscription:', error);
      return false;
    }
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

      if (this.userId) {
        // Send subscription to server
        const saveResponse = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: this.userId,
            subscription: subscription.toJSON()
          })
        });

        const saveData = await saveResponse.json();
        if (saveData.success) {
          console.log('Web Push subscription saved to server');
        } else {
          console.error('Failed to save push subscription:', saveData.error);
        }
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
            this.userId = user.id;
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
    if (!this.isSupported) {
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      this.permission = permission;
      
      if (permission === 'granted') {
        console.log('Notification permission granted');
        // Subscribe to Web Push for background notifications
        await this.subscribeToWebPush();
        return true;
      } else {
        console.log('Notification permission denied');
        return false;
      }
    } catch (error) {
      console.error('Error requesting permission:', error);
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
  const initialized = await window.accessNotifications.initialize();
  if (initialized) {
    // Request permission after a short delay
    setTimeout(async () => {
      if (Notification.permission === 'default') {
        await window.accessNotifications.requestPermission();
      }
    }, 3000);
  }
});

// Listen for user login/wallet changes
window.addEventListener('storage', (event) => {
  if (event.key === 'accessoireUser') {
    window.accessNotifications.getUserWalletAddress();
  }
});
