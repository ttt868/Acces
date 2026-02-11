// Professional Offline Detection System - Real ping + smart retry
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

    this.initialize();
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

    // Initial check — if browser says offline, show immediately
    if (!navigator.onLine) {
      this._goOffline();
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
    this.touchMoveHandler = (e) => { e.preventDefault(); e.stopPropagation(); };
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(() => {
    window.offlineDetector = new OfflineDetector();
    console.log('[OfflineDetector] Professional system initialized');
  }, 1000);
});

// Update translations on language change
document.addEventListener('languageChanged', function(event) {
  if (window.offlineDetector && event.detail && event.detail.translator) {
    window.offlineDetector.updateTranslations(event.detail.translator);
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OfflineDetector;
}