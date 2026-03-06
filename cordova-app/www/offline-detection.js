// Professional Offline Detection System - Real ping + smart retry
// All CSS is injected inline — does NOT touch style.css
class OfflineDetector {
  constructor() {
    this.isOnline = true;
    this.offlinePage = null;
    this.isChecking = false;
    this.retryInterval = null;
    this.retryCount = 0;
    this.translator = window.translator || { translate: (key) => key };
    this.PING_TIMEOUT = 6000;
    this.AUTO_RETRY_MS = 8000;
    this.pingUrl = this._getPingUrl();

    this._injectStyles();
    this.initialize();
  }

  // Inject all offline-page CSS into a <style> tag — keeps style.css untouched
  _injectStyles() {
    if (document.getElementById('offline-detection-styles')) return;
    const style = document.createElement('style');
    style.id = 'offline-detection-styles';
    style.textContent = `
      .connection-offline-page{position:fixed;inset:0;display:flex;justify-content:center;align-items:center;z-index:15000;background:#f0f4ff;opacity:0;transform:scale(1.02);transition:opacity .35s ease,transform .35s ease;touch-action:none;user-select:none;-webkit-user-select:none;overscroll-behavior:none}
      .connection-offline-page.is-visible{opacity:1;transform:scale(1)}
      .connection-offline-page.is-exiting{opacity:0;transform:scale(.98)}
      .connection-offline-page::before,.connection-offline-page::after{content:'';position:absolute;border-radius:50%;filter:blur(80px);opacity:.45;animation:offBlobFloat 12s ease-in-out infinite alternate}
      .connection-offline-page::before{width:320px;height:320px;background:#667eea;top:-60px;left:-40px}
      .connection-offline-page::after{width:280px;height:280px;background:#f093fb;bottom:-40px;right:-30px;animation-delay:-6s}
      @keyframes offBlobFloat{0%{transform:translate(0,0) scale(1)}100%{transform:translate(30px,-20px) scale(1.15)}}
      .connection-offline-container{position:relative;z-index:2;width:100%;max-width:420px;padding:24px 16px}
      .connection-offline-hero{background:rgba(255,255,255,.82);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-radius:28px;border:1px solid rgba(255,255,255,.45);box-shadow:0 8px 40px rgba(102,126,234,.12),0 2px 8px rgba(0,0,0,.04);padding:44px 28px 36px;text-align:center}
      .connection-offline-icon-container{position:relative;margin-bottom:28px}
      .connection-offline-icon{width:96px;height:96px;margin:0 auto;background:linear-gradient(135deg,#ef4444,#f97316);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 8px 28px rgba(239,68,68,.35);animation:offIconPulse 2.4s ease-in-out infinite;position:relative;z-index:2}
      .connection-wifi-offline-icon{width:44px;height:44px}
      @keyframes offIconPulse{0%,100%{transform:scale(1);box-shadow:0 8px 28px rgba(239,68,68,.35)}50%{transform:scale(1.06);box-shadow:0 12px 36px rgba(239,68,68,.5)}}
      .connection-signal-waves{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:180px;height:180px;pointer-events:none}
      .connection-wave{position:absolute;inset:0;margin:auto;width:96px;height:96px;border-radius:50%;border:2px solid rgba(239,68,68,.25);animation:offWaveRipple 3s ease-out infinite}
      .connection-wave-2{animation-delay:1s}.connection-wave-3{animation-delay:2s}
      @keyframes offWaveRipple{0%{width:96px;height:96px;opacity:.7}100%{width:220px;height:220px;opacity:0}}
      .connection-offline-content{position:relative;z-index:1}
      .connection-offline-title{font-size:1.5rem;font-weight:800;margin:0 0 8px;color:#1e293b;font-family:'Poppins','Inter',system-ui,sans-serif}
      .connection-offline-subtitle{font-size:.95rem;color:#64748b;margin:0 0 24px;font-weight:500;line-height:1.5}
      .connection-offline-status{margin-bottom:24px}
      .connection-status-indicator{display:inline-flex;align-items:center;gap:10px;padding:10px 20px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.15);border-radius:50px}
      .connection-status-dot{width:10px;height:10px;background:#ef4444;border-radius:50%;animation:offDotBlink 1.4s ease-in-out infinite}
      @keyframes offDotBlink{0%,100%{opacity:1}50%{opacity:.3}}
      .connection-status-text{font-size:.85rem;font-weight:600;color:#475569}
      .connection-offline-actions{margin-bottom:28px}
      .connection-retry-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-width:200px;padding:14px 32px;border:none;border-radius:14px;font-size:1rem;font-weight:700;font-family:'Poppins','Inter',system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,#667eea,#764ba2);box-shadow:0 6px 20px rgba(102,126,234,.35);cursor:pointer;transition:transform .2s,box-shadow .2s,background .3s;position:relative;overflow:hidden}
      .connection-retry-btn::before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent);transform:translateX(-100%);transition:transform .5s}
      .connection-retry-btn:hover::before{transform:translateX(100%)}
      .connection-retry-btn:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(102,126,234,.45)}
      .connection-retry-btn:active{transform:translateY(0) scale(.97)}
      .connection-retry-btn .retry-btn-icon{font-size:1.05rem;transition:transform .3s}
      .connection-retry-btn.is-loading{background:linear-gradient(135deg,#94a3b8,#64748b);box-shadow:0 4px 14px rgba(100,116,139,.3);pointer-events:none}
      .connection-retry-btn.is-loading .retry-btn-icon{animation:offSpinIcon .8s linear infinite}
      @keyframes offSpinIcon{to{transform:rotate(360deg)}}
      .connection-retry-btn.is-success{background:linear-gradient(135deg,#22c55e,#16a34a);box-shadow:0 6px 20px rgba(34,197,94,.4);pointer-events:none}
      .connection-retry-btn.is-failed{background:linear-gradient(135deg,#ef4444,#dc2626);box-shadow:0 6px 20px rgba(239,68,68,.35);animation:offShakeBtn .4s ease}
      @keyframes offShakeBtn{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
      .connection-offline-tips{display:flex;flex-direction:column;gap:8px}
      .connection-tip{display:flex;align-items:center;gap:10px;font-size:.85rem;color:#64748b;margin:0;padding:0}
      .connection-tip i{width:18px;text-align:center;color:#94a3b8;font-size:.9rem}
      /* Dark theme */
      .dark-theme.connection-offline-page,.connection-offline-page.dark-theme{background:#0f172a}
      .dark-theme.connection-offline-page::before{background:#4338ca;opacity:.25}
      .dark-theme.connection-offline-page::after{background:#7c3aed;opacity:.2}
      .dark-theme .connection-offline-hero,.connection-offline-page.dark-theme .connection-offline-hero{background:rgba(30,41,59,.85);border-color:rgba(255,255,255,.08);box-shadow:0 8px 40px rgba(0,0,0,.3)}
      .dark-theme .connection-offline-title,.connection-offline-page.dark-theme .connection-offline-title{color:#f1f5f9}
      .dark-theme .connection-offline-subtitle,.connection-offline-page.dark-theme .connection-offline-subtitle{color:#94a3b8}
      .dark-theme .connection-status-indicator,.connection-offline-page.dark-theme .connection-status-indicator{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.2)}
      .dark-theme .connection-status-text,.connection-offline-page.dark-theme .connection-status-text{color:#cbd5e1}
      .dark-theme .connection-tip,.connection-offline-page.dark-theme .connection-tip{color:#94a3b8}
      .dark-theme .connection-tip i,.connection-offline-page.dark-theme .connection-tip i{color:#64748b}
      .dark-theme .connection-offline-icon,.connection-offline-page.dark-theme .connection-offline-icon{box-shadow:0 8px 28px rgba(239,68,68,.25)}
      .dark-theme .connection-wave,.connection-offline-page.dark-theme .connection-wave{border-color:rgba(239,68,68,.2)}
      /* Responsive */
      @media(max-width:480px){.connection-offline-container{padding:16px 12px}.connection-offline-hero{padding:32px 20px 28px;border-radius:22px}.connection-offline-icon{width:80px;height:80px}.connection-wifi-offline-icon{width:36px;height:36px}.connection-offline-title{font-size:1.25rem}.connection-offline-subtitle{font-size:.88rem}.connection-retry-btn{min-width:180px;padding:12px 24px;font-size:.93rem}}
    `;
    document.head.appendChild(style);
  }

  _getPingUrl() {
    // Use the app's own healthcheck or a lightweight endpoint
    if (typeof window.API_BASE_URL !== 'undefined') {
      return window.API_BASE_URL + '/api/health';
    }
    return window.location.origin + '/api/health';
  }

  initialize() {
    console.log('[OfflineDetector] Initializing professional offline detection');

    // Listen for browser connectivity events
    window.addEventListener('online', () => this._onBrowserOnline());
    window.addEventListener('offline', () => this._onBrowserOffline());

    // Make retry globally available
    window.checkConnection = () => this.manualRetry();

    // Initial check — if browser says offline, show immediately; otherwise verify with real ping
    if (!navigator.onLine) {
      this._goOffline();
    } else {
      // Even if browser says online, verify with a real ping (important for Cordova cold-start)
      this._ping().then(online => {
        if (!online) this._goOffline();
      });
    }
  }

  // ── Real connection test via fetch ping ──
  async _ping() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.PING_TIMEOUT);
      const res = await fetch(this.pingUrl, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timeout);
      return true;
    } catch {
      return false;
    }
  }

  // ── Browser events ──
  _onBrowserOnline() {
    // Browser says online — verify with real ping
    this._verifyAndRestore();
  }

  _onBrowserOffline() {
    this._goOffline();
  }

  // ── Manual retry (button click) ──
  async manualRetry() {
    if (this.isChecking) return;
    this.isChecking = true;
    this.retryCount++;

    this._setButtonState('loading');

    const online = await this._ping();

    if (online) {
      this._setButtonState('success');
      setTimeout(() => this._goOnline(), 600);
    } else {
      this._setButtonState('failed');
      // Reset button after showing failure
      setTimeout(() => this._setButtonState('idle'), 2000);
    }
    this.isChecking = false;
  }

  // ── Auto-verify when browser fires 'online' ──
  async _verifyAndRestore() {
    const online = await this._ping();
    if (online) {
      this._goOnline();
    }
  }

  // ── State transitions ──
  _goOffline() {
    if (!this.isOnline && document.getElementById('connection-offline-page')) return;
    console.log('[OfflineDetector] Connection lost');
    this.isOnline = false;
    this.retryCount = 0;
    this.showOfflinePage();
    this._startAutoRetry();
  }

  _goOnline() {
    if (this.isOnline && !document.getElementById('connection-offline-page')) return;
    console.log('[OfflineDetector] Connection restored');
    this.isOnline = true;
    this._stopAutoRetry();
    this.hideOfflinePage();

    if (typeof showNotification === 'function') {
      showNotification(this.translator.translate('Connection restored'), 'success');
    }
    // Reload for a clean state
    setTimeout(() => window.location.reload(), 700);
  }

  // ── Auto retry in background ──
  _startAutoRetry() {
    this._stopAutoRetry();
    this.retryInterval = setInterval(async () => {
      if (this.isChecking) return;
      const online = await this._ping();
      if (online) {
        this._goOnline();
      } else {
        // Update status text with attempt count
        this._updateStatusText();
      }
    }, this.AUTO_RETRY_MS);
  }

  _stopAutoRetry() {
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }
  }

  // ── Button visual states ──
  _setButtonState(state) {
    const btn = document.querySelector('.connection-retry-btn');
    if (!btn) return;

    const iconEl = btn.querySelector('.retry-btn-icon');
    const textEl = btn.querySelector('.retry-btn-text');
    if (!iconEl || !textEl) return;

    btn.classList.remove('is-loading', 'is-success', 'is-failed');

    switch (state) {
      case 'loading':
        btn.classList.add('is-loading');
        btn.disabled = true;
        iconEl.className = 'retry-btn-icon fas fa-circle-notch fa-spin';
        textEl.textContent = this.translator.translate('Checking...');
        break;
      case 'success':
        btn.classList.add('is-success');
        btn.disabled = true;
        iconEl.className = 'retry-btn-icon fas fa-check';
        textEl.textContent = this.translator.translate('Connected!');
        break;
      case 'failed':
        btn.classList.add('is-failed');
        btn.disabled = false;
        iconEl.className = 'retry-btn-icon fas fa-times';
        textEl.textContent = this.translator.translate('No connection');
        break;
      default: // idle
        btn.disabled = false;
        iconEl.className = 'retry-btn-icon fas fa-rotate-right';
        textEl.textContent = this.translator.translate('Try Again');
    }
  }

  _updateStatusText() {
    const statusEl = document.querySelector('.connection-status-text');
    if (statusEl) {
      statusEl.textContent = this.translator.translate('Searching for connection...');
    }
  }

  // ── Build offline page DOM ──
  showOfflinePage() {
    let page = document.getElementById('connection-offline-page');
    if (page) {
      page.style.display = 'flex';
      this.preventBackgroundInteraction();
      return;
    }

    page = document.createElement('div');
    page.id = 'connection-offline-page';
    page.className = 'connection-offline-page';

    page.innerHTML = `
      <div class="connection-offline-container">
        <div class="connection-offline-hero">
          <!-- Animated WiFi icon -->
          <div class="connection-offline-icon-container">
            <div class="connection-offline-icon">
              <svg viewBox="0 0 24 24" class="connection-wifi-offline-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 1l22 22"/>
                <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
                <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
                <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
                <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
                <line x1="12" y1="20" x2="12.01" y2="20"/>
              </svg>
            </div>
            <div class="connection-signal-waves">
              <div class="connection-wave connection-wave-1"></div>
              <div class="connection-wave connection-wave-2"></div>
              <div class="connection-wave connection-wave-3"></div>
            </div>
          </div>

          <!-- Content -->
          <div class="connection-offline-content">
            <h1 class="connection-offline-title">${this.translator.translate('No Internet Connection')}</h1>
            <p class="connection-offline-subtitle">${this.translator.translate('Please check your Wi-Fi or mobile data and try again')}</p>

            <!-- Status indicator -->
            <div class="connection-offline-status">
              <div class="connection-status-indicator">
                <span class="connection-status-dot"></span>
                <span class="connection-status-text">${this.translator.translate('Searching for connection...')}</span>
              </div>
            </div>

            <!-- Retry button -->
            <div class="connection-offline-actions">
              <button class="connection-retry-btn" onclick="checkConnection()">
                <i class="retry-btn-icon fas fa-rotate-right"></i>
                <span class="retry-btn-text">${this.translator.translate('Try Again')}</span>
              </button>
            </div>

            <!-- Tips -->
            <div class="connection-offline-tips">
              <p class="connection-tip"><i class="fas fa-wifi"></i> ${this.translator.translate('Check your Wi-Fi connection')}</p>
              <p class="connection-tip"><i class="fas fa-signal"></i> ${this.translator.translate('Enable mobile data')}</p>
              <p class="connection-tip"><i class="fas fa-plane"></i> ${this.translator.translate('Disable airplane mode')}</p>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(page);
    this.offlinePage = page;
    this.applyCurrentTheme();
    this.preventBackgroundInteraction();
    // Animate entrance
    requestAnimationFrame(() => page.classList.add('is-visible'));
  }

  hideOfflinePage() {
    const page = document.getElementById('connection-offline-page');
    if (!page) return;
    page.classList.remove('is-visible');
    page.classList.add('is-exiting');
    setTimeout(() => {
      page.style.display = 'none';
      page.classList.remove('is-exiting');
      this.restoreBackgroundInteraction();
    }, 400);
  }

  preventBackgroundInteraction() {
    this.originalBodyStyle = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      touchAction: document.body.style.touchAction,
      userSelect: document.body.style.userSelect,
      overscrollBehavior: document.body.style.overscrollBehavior
    };
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.height = '100%';
    document.body.style.touchAction = 'none';
    document.body.style.userSelect = 'none';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.touchAction = 'none';
    document.documentElement.style.overscrollBehavior = 'none';

    this.touchStartHandler = (e) => {
      const page = document.getElementById('connection-offline-page');
      if (page && !page.contains(e.target)) { e.preventDefault(); e.stopPropagation(); }
    };
    this.touchMoveHandler = (e) => {
      const page = document.getElementById('connection-offline-page');
      if (page && !page.contains(e.target)) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('touchstart', this.touchStartHandler, { passive: false });
    document.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
    document.addEventListener('wheel', this.touchMoveHandler, { passive: false });
  }

  restoreBackgroundInteraction() {
    if (this.originalBodyStyle) {
      document.body.style.overflow = this.originalBodyStyle.overflow;
      document.body.style.position = this.originalBodyStyle.position;
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.touchAction = this.originalBodyStyle.touchAction;
      document.body.style.userSelect = this.originalBodyStyle.userSelect;
      document.body.style.overscrollBehavior = this.originalBodyStyle.overscrollBehavior;
    }
    document.documentElement.style.overflow = '';
    document.documentElement.style.touchAction = '';
    document.documentElement.style.overscrollBehavior = '';
    if (this.touchStartHandler) {
      document.removeEventListener('touchstart', this.touchStartHandler);
      document.removeEventListener('touchmove', this.touchMoveHandler);
      document.removeEventListener('wheel', this.touchMoveHandler);
    }
  }

  applyCurrentTheme() {
    const page = document.getElementById('connection-offline-page');
    if (!page) return;
    const isDark = document.documentElement.classList.contains('dark-theme') ||
                   document.body.classList.contains('dark-theme');
    page.classList.toggle('dark-theme', isDark);
  }

  updateTranslations(translator) {
    this.translator = translator;
    const page = document.getElementById('connection-offline-page');
    if (!page || page.style.display === 'none') return;
    const t = (k) => translator.translate(k);
    const q = (s) => page.querySelector(s);
    if (q('.connection-offline-title')) q('.connection-offline-title').textContent = t('No Internet Connection');
    if (q('.connection-offline-subtitle')) q('.connection-offline-subtitle').textContent = t('Please check your Wi-Fi or mobile data and try again');
    if (q('.connection-status-text')) q('.connection-status-text').textContent = t('Searching for connection...');
    if (q('.retry-btn-text')) q('.retry-btn-text').textContent = t('Try Again');
    const tips = page.querySelectorAll('.connection-tip');
    const tipTexts = ['Check your Wi-Fi connection', 'Enable mobile data', 'Disable airplane mode'];
    tips.forEach((tip, i) => {
      const icon = tip.querySelector('i');
      if (icon && tipTexts[i]) tip.innerHTML = icon.outerHTML + ' ' + t(tipTexts[i]);
    });
  }

  destroy() {
    this._stopAutoRetry();
    window.removeEventListener('online', this._onBrowserOnline);
    window.removeEventListener('offline', this._onBrowserOffline);
    this.restoreBackgroundInteraction();
    const page = document.getElementById('connection-offline-page');
    if (page) page.remove();
  }
}

// Initialize when DOM is ready (also listen for Cordova deviceready)
function _initOfflineDetector() {
  if (window.offlineDetector) return;
  window.offlineDetector = new OfflineDetector();
  console.log('[OfflineDetector] Professional system initialized');
}

document.addEventListener('DOMContentLoaded', function() {
  setTimeout(_initOfflineDetector, 800);
});

// Cordova deviceready — re-init if DOMContentLoaded missed it
document.addEventListener('deviceready', function() {
  setTimeout(_initOfflineDetector, 500);
}, false);

// Update translations on language change
document.addEventListener('languageChanged', function(event) {
  if (window.offlineDetector && event.detail && event.detail.translator) {
    window.offlineDetector.updateTranslations(event.detail.translator);
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OfflineDetector;
}