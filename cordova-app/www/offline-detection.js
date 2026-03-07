// Professional Offline Detection System for Cordova
// Robust multi-cycle support — works reliably on repeated on/off
// All CSS is injected inline — does NOT touch style.css
class OfflineDetector {
  constructor() {
    this.isOnline = true;
    this.isChecking = false;
    this.retryInterval = null;
    this.retryCount = 0;
    this._bgLocked = false;
    this._handlers = null;
    this.translator = window.translator || { translate: (key) => key };
    this.PING_TIMEOUT = 6000;
    this.AUTO_RETRY_MS = 8000;
    this.pingUrl = this._getPingUrl();

    this._injectStyles();
    this.initialize();
  }

  _injectStyles() {
    if (document.getElementById('offline-detection-styles')) return;
    const style = document.createElement('style');
    style.id = 'offline-detection-styles';
    style.textContent = `
      .connection-offline-page{position:fixed;inset:0;display:flex;justify-content:center;align-items:center;z-index:1500000;background:#f0f4ff;opacity:0;transform:scale(1.02);transition:opacity .35s ease,transform .35s ease;touch-action:none;user-select:none;-webkit-user-select:none;overscroll-behavior:none}
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
    if (typeof window.API_BASE_URL !== 'undefined') {
      return window.API_BASE_URL + '/api/health';
    }
    return window.location.origin + '/api/health';
  }

  initialize() {
    console.log('[OfflineDetector] Initializing');

    window.addEventListener('online', () => this._onBrowserOnline());
    window.addEventListener('offline', () => this._onBrowserOffline());

    // Cordova network events
    document.addEventListener('online', () => this._onBrowserOnline(), false);
    document.addEventListener('offline', () => this._onBrowserOffline(), false);

    // Re-check connection on app resume (back from background)
    document.addEventListener('resume', () => this._onAppResume(), false);

    window.checkConnection = () => this.manualRetry();

    // Initial check
    if (!navigator.onLine) {
      this._goOffline();
    } else {
      this._ping().then(online => {
        if (!online) this._goOffline();
      });
    }
  }

  // ── Real connection test ──
  async _ping() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.PING_TIMEOUT);
      await fetch(this.pingUrl, {
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

  // ── Browser/Cordova events ──
  _onBrowserOnline() {
    this._verifyAndRestore();
  }

  _onBrowserOffline() {
    this._goOffline();
  }

  // ── App resume: re-check connectivity silently ──
  _onAppResume() {
    console.log('[OfflineDetector] App resumed from background');
    // Small delay to let network stack settle after resume
    setTimeout(async () => {
      if (!navigator.onLine) {
        // Definitely offline
        if (this.isOnline) this._goOffline();
        return;
      }
      // Browser says online — verify with real ping
      const online = await this._ping();
      if (online) {
        if (!this.isOnline) this._goOnline();
      } else {
        if (this.isOnline) this._goOffline();
      }
    }, 300);
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
      setTimeout(() => {
        this.isChecking = false;
        this._goOnline();
      }, 600);
    } else {
      this._setButtonState('failed');
      setTimeout(() => {
        this._setButtonState('idle');
        this.isChecking = false;
      }, 2000);
    }
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
    // Always allow showing offline page — remove stale page first if needed
    const existingPage = document.getElementById('connection-offline-page');
    if (!this.isOnline && existingPage && existingPage.classList.contains('is-visible')) {
      return; // Already showing
    }

    console.log('[OfflineDetector] Connection lost');
    this.isOnline = false;
    this.isChecking = false;
    this.retryCount = 0;

    // Always require PIN verification after any offline→online transition
    // Cold start: _pinUnlocked is undefined — PIN hasn't been verified yet
    // Active session: reset unlock state to require re-verification
    // This ensures PIN is NEVER bypassed after an offline period
    if (window._pinUnlocked) {
      window._pinUnlocked = false;
    }
    window._pinPendingAfterOffline = true;
    console.log('[OfflineDetector] PIN will be required after reconnection');

    // Clean up any leftover hidden page from previous cycle
    if (existingPage) {
      existingPage.remove();
    }
    this._unlockBackground();

    // Offline page z-index (1500000) > PIN z-index (999999)
    // Offline always shows on top; when it hides, PIN is revealed underneath
    this._showOfflinePage();
    this._startAutoRetry();
  }

  _goOnline() {
    if (this.isOnline && !document.getElementById('connection-offline-page')) return;
    console.log('[OfflineDetector] Connection restored');
    this.isOnline = true;
    this.isChecking = false;
    this._stopAutoRetry();
    this._hideOfflinePage();

    if (typeof showNotification === 'function') {
      showNotification(this.translator.translate('Connection restored'), 'success');
    }

    // Data refresh is handled AFTER offline page is fully removed
    // See _hideOfflinePage() → page.remove() callback
  }

  // ── Refresh session/data after coming back online ──
  _refreshAfterReconnect() {
    // Small delay to ensure DOM/background is fully restored
    setTimeout(() => {
      try {
        if (window.currentUser && window.currentUser.email && typeof window.loadUserData === 'function') {
          console.log('[OfflineDetector] Refreshing user data after reconnect');
          window.loadUserData(window.currentUser.email);
        }
        if (typeof window.updateDashboard === 'function') {
          window.updateDashboard();
        }
      } catch (e) {
        console.warn('[OfflineDetector] Post-reconnect refresh error:', e);
      }
    }, 300);
  }

  // ── Auto retry in background ──
  _startAutoRetry() {
    this._stopAutoRetry();
    this._autoRetryCount = 0;
    this.retryInterval = setInterval(async () => {
      if (this.isChecking) return;
      this._autoRetryCount++;
      const online = await this._ping();
      if (online) {
        this._goOnline();
      } else {
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
        textEl.textContent = this.translator.translate('Try again');
    }
  }

  _updateStatusText() {
    const statusEl = document.querySelector('.connection-status-text');
    if (statusEl) {
      statusEl.textContent = this.translator.translate('Searching for connection...');
    }
  }

  // ── Create offline page (always fresh) ──
  _showOfflinePage() {
    const page = document.createElement('div');
    page.id = 'connection-offline-page';
    page.className = 'connection-offline-page';

    page.innerHTML = `
      <div class="connection-offline-container">
        <div class="connection-offline-hero">
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
          <div class="connection-offline-content">
            <h1 class="connection-offline-title">${this.translator.translate('No Internet Connection')}</h1>
            <p class="connection-offline-subtitle">${this.translator.translate('Please check your Wi-Fi or mobile data and try again')}</p>
            <div class="connection-offline-status">
              <div class="connection-status-indicator">
                <span class="connection-status-dot"></span>
                <span class="connection-status-text">${this.translator.translate('Searching for connection...')}</span>
              </div>
            </div>
            <div class="connection-offline-actions">
              <button class="connection-retry-btn" onclick="checkConnection()">
                <i class="retry-btn-icon fas fa-rotate-right"></i>
                <span class="retry-btn-text">${this.translator.translate('Try again')}</span>
              </button>
            </div>
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
    this._applyTheme(page);
    this._lockBackground();
    // Animate entrance on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        page.classList.add('is-visible');
      });
    });
  }

  _hideOfflinePage() {
    const page = document.getElementById('connection-offline-page');
    if (!page) {
      this._unlockBackground();
      return;
    }

    // Show success state briefly before hiding
    const icon = page.querySelector('.connection-offline-icon');
    const title = page.querySelector('.connection-offline-title');
    const subtitle = page.querySelector('.connection-offline-subtitle');
    const statusDot = page.querySelector('.connection-status-dot');
    const statusText = page.querySelector('.connection-status-text');

    if (icon) icon.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
    if (icon) icon.style.boxShadow = '0 8px 28px rgba(34, 197, 94, .35)';
    if (title) title.textContent = this.translator.translate('Connection restored');
    if (subtitle) subtitle.textContent = '';
    if (statusDot) { statusDot.style.background = '#22c55e'; statusDot.style.animation = 'none'; }
    if (statusText) statusText.textContent = this.translator.translate('Connected!');

    // Hide actions & tips
    const actions = page.querySelector('.connection-offline-actions');
    const tips = page.querySelector('.connection-offline-tips');
    if (actions) actions.style.display = 'none';
    if (tips) tips.style.display = 'none';

    // ── Prepare PIN lock screen BEHIND the offline page during green state ──
    // Offline z-index (1500000) > PIN z-index (999999)
    // PIN shows underneath — invisible until offline page fades out = zero flash
    let pinActivated = false;
    if (window._pinPendingAfterOffline) {
      window._pinPendingAfterOffline = false;

      // Ensure user session is available from localStorage cache
      // On cold start, script.js may have set currentUser already,
      // but as a safety net, load it ourselves if missing
      if (!window.currentUser && typeof window.loadUserSession === 'function') {
        const cached = window.loadUserSession();
        if (cached && cached.id) {
          window.currentUser = cached;
          console.log('[OfflineDetector] Restored currentUser from localStorage');
        }
      }

      // Show PIN lock screen behind offline page (sync from local cache)
      if (window.currentUser && typeof window.loadPinStatus === 'function') {
        window.loadPinStatus(); // Sync part: loads cache → showLockScreen()
      }
      pinActivated = typeof window.isPinLocked === 'function' && window.isPinLocked();

      if (pinActivated) {
        window._pendingOfflineRefresh = true;
        console.log('[OfflineDetector] PIN lock ready behind offline page — seamless transition');
      } else {
        console.log('[OfflineDetector] PIN not needed — will refresh data directly');
      }
    }

    // Brief green state, then fade out — PIN is already prepared underneath
    setTimeout(() => {
      page.classList.remove('is-visible');
      page.classList.add('is-exiting');

      setTimeout(() => {
        page.remove();
        this._unlockBackground();

        // Data refresh: deferred to after PIN unlock, or immediate
        if (!pinActivated) {
          this._refreshAfterReconnect();
        }
        // If pinActivated, data refresh happens in hideLockScreen()
      }, 400);
    }, 800);
  }

  // ── Background lock/unlock (simple, no stacking) ──
  _lockBackground() {
    if (this._bgLocked) return;
    this._bgLocked = true;

    this._savedBody = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      width: document.body.style.width,
      height: document.body.style.height,
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

    const blockOutside = (e) => {
      const pg = document.getElementById('connection-offline-page');
      if (pg && !pg.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    this._handlers = { blockOutside };

    document.addEventListener('touchstart', blockOutside, { passive: false, capture: true });
    document.addEventListener('touchmove', blockOutside, { passive: false, capture: true });
    document.addEventListener('wheel', blockOutside, { passive: false, capture: true });
  }

  _unlockBackground() {
    if (!this._bgLocked) return;
    this._bgLocked = false;

    if (this._savedBody) {
      document.body.style.overflow = this._savedBody.overflow;
      document.body.style.position = this._savedBody.position;
      document.body.style.width = this._savedBody.width;
      document.body.style.height = this._savedBody.height;
      document.body.style.touchAction = this._savedBody.touchAction;
      document.body.style.userSelect = this._savedBody.userSelect;
      document.body.style.overscrollBehavior = this._savedBody.overscrollBehavior;
      this._savedBody = null;
    }

    document.documentElement.style.overflow = '';
    document.documentElement.style.touchAction = '';
    document.documentElement.style.overscrollBehavior = '';

    if (this._handlers) {
      document.removeEventListener('touchstart', this._handlers.blockOutside, { capture: true });
      document.removeEventListener('touchmove', this._handlers.blockOutside, { capture: true });
      document.removeEventListener('wheel', this._handlers.blockOutside, { capture: true });
      this._handlers = null;
    }
  }

  _applyTheme(page) {
    if (!page) return;
    const isDark = document.documentElement.classList.contains('dark-theme') ||
                   document.body.classList.contains('dark-theme');
    page.classList.toggle('dark-theme', isDark);
  }

  updateTranslations(translator) {
    this.translator = translator;
    const page = document.getElementById('connection-offline-page');
    if (!page) return;
    const t = (k) => translator.translate(k);
    const q = (s) => page.querySelector(s);
    if (q('.connection-offline-title')) q('.connection-offline-title').textContent = t('No Internet Connection');
    if (q('.connection-offline-subtitle')) q('.connection-offline-subtitle').textContent = t('Please check your Wi-Fi or mobile data and try again');
    if (q('.connection-status-text')) q('.connection-status-text').textContent = t('Searching for connection...');
    if (q('.retry-btn-text')) q('.retry-btn-text').textContent = t('Try again');
    const tips = page.querySelectorAll('.connection-tip');
    const tipTexts = ['Check your Wi-Fi connection', 'Enable mobile data', 'Disable airplane mode'];
    tips.forEach((tip, i) => {
      const icon = tip.querySelector('i');
      if (icon && tipTexts[i]) tip.innerHTML = icon.outerHTML + ' ' + t(tipTexts[i]);
    });
  }

  destroy() {
    this._stopAutoRetry();
    this._unlockBackground();
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

document.addEventListener('deviceready', function() {
  setTimeout(_initOfflineDetector, 500);
}, false);

document.addEventListener('languageChanged', function(event) {
  if (window.offlineDetector && event.detail && event.detail.translator) {
    window.offlineDetector.updateTranslations(event.detail.translator);
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OfflineDetector;
}
