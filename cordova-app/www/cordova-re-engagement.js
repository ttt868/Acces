/**
 * Cordova Re-Engagement System
 * Client-side re-engagement notifications for Cordova app
 * Listens to server WebSocket for re-engagement triggers
 */

// Re-engagement messages (SAME as server - all languages)
const RE_ENGAGEMENT_MESSAGES = {
  en: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Your session is ready! Tap to start a new activity.' },
    { minDays: 5, maxDays: 6, title: 'Welcome back! 👋', body: 'ACCESS Network is waiting for you. Start your session now.' },
    { minDays: 7, maxDays: 10, title: 'We miss you! 💫', body: 'Your ACCESS Network activity awaits. Come back and explore!' },
    { minDays: 11, maxDays: 14, title: 'Long time no see! 🌟', body: 'ACCESS Network has updates for you. Tap to check in!' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Your account is still active. Ready to continue?' }
  ],
  ar: [
    { minDays: 3, maxDays: 4, title: 'ACCESS شبكة', body: 'جلستك جاهزة! اضغط لبدء نشاط جديد.' },
    { minDays: 5, maxDays: 6, title: 'مرحباً بعودتك! 👋', body: 'شبكة ACCESS في انتظارك. ابدأ جلستك الآن.' },
    { minDays: 7, maxDays: 10, title: 'نفتقدك! 💫', body: 'نشاطك في شبكة ACCESS بانتظارك. عُد واستكشف!' },
    { minDays: 11, maxDays: 14, title: 'مدة طويلة! 🌟', body: 'لديك تحديثات في شبكة ACCESS. اضغط للاطلاع!' },
    { minDays: 15, maxDays: 30, title: '🔔 ACCESS شبكة', body: 'حسابك لا يزال نشطاً. هل أنت مستعد للمتابعة؟' }
  ],
  fr: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Votre session est prête ! Appuyez pour démarrer une nouvelle activité.' },
    { minDays: 5, maxDays: 6, title: 'Bon retour ! 👋', body: 'ACCESS Network vous attend. Commencez votre session maintenant.' },
    { minDays: 7, maxDays: 10, title: 'Vous nous manquez ! 💫', body: 'Votre activité ACCESS Network vous attend. Revenez explorer !' },
    { minDays: 11, maxDays: 14, title: 'Ça fait longtemps ! 🌟', body: 'ACCESS Network a des mises à jour pour vous. Appuyez pour voir !' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Votre compte est toujours actif. Prêt à continuer ?' }
  ],
  de: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Ihre Sitzung ist bereit! Tippen Sie, um eine neue Aktivität zu starten.' },
    { minDays: 5, maxDays: 6, title: 'Willkommen zurück! 👋', body: 'ACCESS Network wartet auf Sie. Starten Sie jetzt Ihre Sitzung.' },
    { minDays: 7, maxDays: 10, title: 'Wir vermissen dich! 💫', body: 'Ihre ACCESS Network-Aktivität wartet. Kommen Sie zurück und entdecken Sie!' },
    { minDays: 11, maxDays: 14, title: 'Lange nicht gesehen! 🌟', body: 'ACCESS Network hat Updates für Sie. Tippen Sie zum Einchecken!' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Ihr Konto ist noch aktiv. Bereit weiterzumachen?' }
  ],
  es: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: '¡Tu sesión está lista! Toca para iniciar una nueva actividad.' },
    { minDays: 5, maxDays: 6, title: '¡Bienvenido de nuevo! 👋', body: 'ACCESS Network te espera. Comienza tu sesión ahora.' },
    { minDays: 7, maxDays: 10, title: '¡Te extrañamos! 💫', body: 'Tu actividad en ACCESS Network te espera. ¡Vuelve y explora!' },
    { minDays: 11, maxDays: 14, title: '¡Cuánto tiempo! 🌟', body: 'ACCESS Network tiene actualizaciones para ti. ¡Toca para ver!' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Tu cuenta sigue activa. ¿Listo para continuar?' }
  ],
  tr: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Oturumunuz hazır! Yeni bir aktivite başlatmak için dokunun.' },
    { minDays: 5, maxDays: 6, title: 'Tekrar hoş geldiniz! 👋', body: 'ACCESS Network sizi bekliyor. Oturumunuza şimdi başlayın.' },
    { minDays: 7, maxDays: 10, title: 'Sizi özledik! 💫', body: 'ACCESS Network aktiviteniz sizi bekliyor. Geri dönün ve keşfedin!' },
    { minDays: 11, maxDays: 14, title: 'Uzun zaman oldu! 🌟', body: 'ACCESS Network sizin için güncellemeler var. Kontrol etmek için dokunun!' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Hesabınız hala aktif. Devam etmeye hazır mısınız?' }
  ],
  it: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'La tua sessione è pronta! Tocca per iniziare una nuova attività.' },
    { minDays: 5, maxDays: 6, title: 'Bentornato! 👋', body: 'ACCESS Network ti aspetta. Inizia la tua sessione ora.' },
    { minDays: 7, maxDays: 10, title: 'Ci manchi! 💫', body: 'La tua attività su ACCESS Network ti aspetta. Torna a esplorare!' },
    { minDays: 11, maxDays: 14, title: 'È passato tanto tempo! 🌟', body: 'ACCESS Network ha aggiornamenti per te. Tocca per vedere!' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Il tuo account è ancora attivo. Pronto a continuare?' }
  ],
  ru: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Ваша сессия готова! Нажмите, чтобы начать новую активность.' },
    { minDays: 5, maxDays: 6, title: 'С возвращением! 👋', body: 'ACCESS Network ждет вас. Начните сессию сейчас.' },
    { minDays: 7, maxDays: 10, title: 'Мы скучаем! 💫', body: 'Ваша активность в ACCESS Network ждет. Возвращайтесь!' },
    { minDays: 11, maxDays: 14, title: 'Давно не виделись! 🌟', body: 'У ACCESS Network есть обновления для вас. Нажмите, чтобы посмотреть!' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Ваш аккаунт все еще активен. Готовы продолжить?' }
  ],
  zh: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: '您的会话已准备就绪！点击开始新活动。' },
    { minDays: 5, maxDays: 6, title: '欢迎回来！👋', body: 'ACCESS Network 正在等您。立即开始您的会话。' },
    { minDays: 7, maxDays: 10, title: '我们想念您！💫', body: '您的 ACCESS Network 活动正在等待您。回来探索吧！' },
    { minDays: 11, maxDays: 14, title: '好久不见！🌟', body: 'ACCESS Network 有更新给您。点击查看！' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: '您的账户仍然活跃。准备好继续了吗？' }
  ],
  ja: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'セッションの準備ができました！タップして新しいアクティビティを開始。' },
    { minDays: 5, maxDays: 6, title: 'おかえりなさい！👋', body: 'ACCESS Network がお待ちしています。今すぐセッションを開始しましょう。' },
    { minDays: 7, maxDays: 10, title: 'お待ちしておりました！💫', body: 'ACCESS Network でのアクティビティがお待ちしています。戻ってきてください！' },
    { minDays: 11, maxDays: 14, title: 'お久しぶりです！🌟', body: 'ACCESS Network に更新があります。タップして確認！' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'アカウントはまだアクティブです。続ける準備はできましたか？' }
  ],
  ko: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: '세션이 준비되었습니다! 탭하여 새 활동을 시작하세요.' },
    { minDays: 5, maxDays: 6, title: '다시 오신 것을 환영합니다! 👋', body: 'ACCESS Network가 기다리고 있습니다. 지금 세션을 시작하세요.' },
    { minDays: 7, maxDays: 10, title: '보고 싶었어요! 💫', body: 'ACCESS Network 활동이 기다리고 있습니다. 돌아와서 탐험하세요!' },
    { minDays: 11, maxDays: 14, title: '오랜만이에요! 🌟', body: 'ACCESS Network에 업데이트가 있습니다. 탭하여 확인하세요!' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: '계정이 아직 활성 상태입니다. 계속할 준비가 되셨나요?' }
  ],
  pt: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'Sua sessão está pronta! Toque para iniciar uma nova atividade.' },
    { minDays: 5, maxDays: 6, title: 'Bem-vindo de volta! 👋', body: 'ACCESS Network está esperando você. Comece sua sessão agora.' },
    { minDays: 7, maxDays: 10, title: 'Sentimos sua falta! 💫', body: 'Sua atividade no ACCESS Network aguarda. Volte e explore!' },
    { minDays: 11, maxDays: 14, title: 'Quanto tempo! 🌟', body: 'ACCESS Network tem atualizações para você. Toque para ver!' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'Sua conta ainda está ativa. Pronto para continuar?' }
  ],
  hi: [
    { minDays: 3, maxDays: 4, title: 'ACCESS Network', body: 'आपका सत्र तैयार है! नई गतिविधि शुरू करने के लिए टैप करें।' },
    { minDays: 5, maxDays: 6, title: 'वापसी पर स्वागत है! 👋', body: 'ACCESS Network आपका इंतजार कर रहा है। अभी अपना सत्र शुरू करें।' },
    { minDays: 7, maxDays: 10, title: 'हम आपको याद करते हैं! 💫', body: 'आपकी ACCESS Network गतिविधि आपका इंतजार कर रही है। वापस आएं!' },
    { minDays: 11, maxDays: 14, title: 'बहुत समय हो गया! 🌟', body: 'ACCESS Network में आपके लिए अपडेट हैं। देखने के लिए टैप करें!' },
    { minDays: 15, maxDays: 30, title: 'ACCESS Network 🔔', body: 'आपका खाता अभी भी सक्रिय है। जारी रखने के लिए तैयार?' }
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
