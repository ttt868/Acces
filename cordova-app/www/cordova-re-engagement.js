/**
 * Cordova Re-Engagement System
 * Client-side re-engagement notifications for Cordova app
 * Listens to server WebSocket for re-engagement triggers
 */

// Re-engagement messages (same as server but client-side)
const RE_ENGAGEMENT_MESSAGES = {
  en: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Your session is ready! Tap to start a new activity.' },
    { minDays: 5, maxDays: 6, title: 'Welcome back! 👋', body: 'ACCESS Network is waiting for you. Start your session now.' },
    { minDays: 7, maxDays: 10, title: 'We miss you! 💫', body: 'Your ACCESS Network activity awaits. Come back and explore!' }
  ],
  ar: [
    { minDays: 3, maxDays: 4, title: 'ACCESS شبكة', body: 'جلستك جاهزة! اضغط لبدء نشاط جديد.' },
    { minDays: 5, maxDays: 6, title: 'مرحباً بعودتك! 👋', body: 'شبكة ACCESS في انتظارك. ابدأ جلستك الآن.' },
    { minDays: 7, maxDays: 10, title: 'نفتقدك! 💫', body: 'نشاطك في شبكة ACCESS بانتظارك. عُد واستكشف!' }
  ],
  fr: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Votre session est prête ! Appuyez pour démarrer.' },
    { minDays: 5, maxDays: 6, title: 'Bon retour ! 👋', body: 'ACCESS Network vous attend.' },
    { minDays: 7, maxDays: 10, title: 'Vous nous manquez ! 💫', body: 'Votre activité ACCESS Network vous attend.' }
  ],
  es: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: '¡Tu sesión está lista! Toca para iniciar.' },
    { minDays: 5, maxDays: 6, title: '¡Bienvenido! 👋', body: 'ACCESS Network te espera.' },
    { minDays: 7, maxDays: 10, title: '¡Te extrañamos! 💫', body: 'Tu actividad ACCESS Network te espera.' }
  ],
  tr: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Oturumunuz hazır! Başlamak için dokunun.' },
    { minDays: 5, maxDays: 6, title: 'Hoş geldiniz! 👋', body: 'ACCESS Network sizi bekliyor.' },
    { minDays: 7, maxDays: 10, title: 'Sizi özledik! 💫', body: 'ACCESS Network aktiviteniz sizi bekliyor.' }
  ]
};

class CordovaReEngagement {
  constructor() {
    this.lastActivityKey = 'access_last_activity';
    this.wsConnection = null;
    this.userId = null;
    this.checkInterval = null;
  }

  // Initialize the re-engagement system
  initialize() {
    console.log('🔔 Cordova Re-Engagement System initializing...');
    
    // Update last activity on page load
    this.updateLastActivity();
    
    // Listen for user activity
    this.setupActivityListeners();
    
    // Connect to WebSocket for server-triggered re-engagement
    this.connectWebSocket();
    
    // Check for local re-engagement (when app opens after being closed)
    this.checkLocalReEngagement();
    
    console.log('✅ Cordova Re-Engagement System initialized');
  }

  // Update last activity timestamp
  updateLastActivity() {
    const now = Date.now();
    localStorage.setItem(this.lastActivityKey, now.toString());
  }

  // Setup activity listeners
  setupActivityListeners() {
    // Update on user interactions
    ['click', 'touchstart', 'scroll'].forEach(event => {
      document.addEventListener(event, () => this.updateLastActivity(), { passive: true });
    });

    // Update when app comes to foreground
    document.addEventListener('resume', () => {
      console.log('📱 App resumed - checking re-engagement');
      this.checkLocalReEngagement();
      this.updateLastActivity();
    });

    // Update when app goes to background
    document.addEventListener('pause', () => {
      console.log('📱 App paused - saving last activity');
      this.updateLastActivity();
    });
  }

  // Get user's language
  getLanguage() {
    const lang = navigator.language || 'en';
    const shortLang = lang.split('-')[0];
    return RE_ENGAGEMENT_MESSAGES[shortLang] ? shortLang : 'en';
  }

  // Get appropriate message based on days inactive
  getMessageForDays(daysInactive) {
    const lang = this.getLanguage();
    const messages = RE_ENGAGEMENT_MESSAGES[lang] || RE_ENGAGEMENT_MESSAGES.en;
    
    for (const msg of messages) {
      if (daysInactive >= msg.minDays && daysInactive <= msg.maxDays) {
        return msg;
      }
    }
    return null;
  }

  // Check for local re-engagement when app opens
  checkLocalReEngagement() {
    const lastActivity = localStorage.getItem(this.lastActivityKey);
    if (!lastActivity) {
      this.updateLastActivity();
      return;
    }

    const lastActivityTime = parseInt(lastActivity);
    const now = Date.now();
    const daysInactive = Math.floor((now - lastActivityTime) / (1000 * 60 * 60 * 24));

    console.log(`📊 Days inactive: ${daysInactive}`);

    if (daysInactive >= 3) {
      const message = this.getMessageForDays(daysInactive);
      if (message) {
        // Show welcome back notification
        this.showReEngagementNotification(message.title, message.body);
      }
    }
  }

  // Connect to WebSocket for server-triggered notifications
  connectWebSocket() {
    // Get user ID
    try {
      const userStr = localStorage.getItem('accessoireUser');
      if (userStr) {
        const user = JSON.parse(userStr);
        this.userId = user.id;
      }
    } catch (e) {
      console.error('Error getting user ID:', e);
    }

    if (!this.userId) {
      console.log('🔔 Re-Engagement: No user ID, will retry in 10 seconds');
      setTimeout(() => this.connectWebSocket(), 10000);
      return;
    }

    const wsUrl = `${window.WS_BASE_URL || 'wss://accesschain.org'}/reengagement?userId=${this.userId}`;
    
    try {
      this.wsConnection = new WebSocket(wsUrl);
      
      this.wsConnection.onopen = () => {
        console.log('🔔 Re-Engagement WebSocket connected');
      };

      this.wsConnection.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleServerMessage(data);
        } catch (e) {
          // Not JSON, ignore
        }
      };

      this.wsConnection.onclose = () => {
        console.log('🔔 Re-Engagement WebSocket closed, reconnecting in 30 seconds...');
        setTimeout(() => this.connectWebSocket(), 30000);
      };

      this.wsConnection.onerror = (error) => {
        console.error('🔔 Re-Engagement WebSocket error:', error);
      };
    } catch (error) {
      console.error('Error connecting to Re-Engagement WebSocket:', error);
    }
  }

  // Handle messages from server
  handleServerMessage(data) {
    if (data.type === 're-engagement' || data.type === 'reengagement') {
      console.log('🔔 Received re-engagement notification from server:', data);
      this.showReEngagementNotification(
        data.title || 'ACCESS Network',
        data.body || 'We miss you! Come back and explore.'
      );
    }
  }

  // Show re-engagement notification
  showReEngagementNotification(title, body) {
    console.log('🔔 Showing re-engagement notification:', title, body);
    
    // Use the global notification function from cordova-init.js
    if (window.showNativeNotification) {
      window.showNativeNotification(title, body, { type: 're-engagement' });
    } else if (window.showToastNotification) {
      window.showToastNotification(title, body);
    } else {
      // Fallback - create simple toast
      const toast = document.createElement('div');
      toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 15px 25px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(102, 126, 234, 0.4);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        max-width: 90%;
        text-align: center;
      `;
      toast.innerHTML = `
        <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${title}</div>
        <div style="font-size: 12px; opacity: 0.9;">${body}</div>
      `;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 5000);
    }
  }
}

// Create and initialize on DOM ready
if (window.IS_CORDOVA_APP) {
  document.addEventListener('deviceready', () => {
    window.cordovaReEngagement = new CordovaReEngagement();
    window.cordovaReEngagement.initialize();
  });
} else {
  // For testing in browser
  document.addEventListener('DOMContentLoaded', () => {
    window.cordovaReEngagement = new CordovaReEngagement();
    window.cordovaReEngagement.initialize();
  });
}
