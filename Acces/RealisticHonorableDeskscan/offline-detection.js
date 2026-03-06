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
    if (typeof window.API_BASE_URL !== 'undefined') {
      return window.API_BASE_URL + '/api/health';
    }
    return window.location.origin + '/api/health';
  }

  initialize() {
    console.log('[OfflineDetector] Initializing professional offline detection');

    window.addEventListener('online', () => this._onBrowserOnline());
    window.addEventListener('offline', () => this._onBrowserOffline());

    window.checkConnection = () => this.manualRetry();

    if (!navigator.onLine) {
      this._goOffline();
    }
  }

  // Real connection test via fetch ping
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

  _onBrowserOnline() {
    this._verifyAndRestore();
  }

  _onBrowserOffline() {
    this._goOffline();
  }

  // Manual retry (button click)
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
      setTimeout(() => this._setButtonState('idle'), 2000);
    }
    this.isChecking = false;
  }

  // Auto-verify when browser fires 'online'
  async _verifyAndRestore() {
    const online = await this._ping();
    if (online) {
      this._goOnline();
    }
  }

  // State transitions
  _goOffline() {
    if (!this.isOnline && document.getElementById('connection-offline-page')) return;
    console.log('[OfflineDetector] Connection lost');
    this.isOnline = false;
    this.retryCount = 0;
    this.showOfflinePage();
    this._startAutoRetry();
  }

  _goOnline() {
    if (this.isOnline && !document.getElementById('connection-offline-page')?.style.display !== 'none') return;
    console.log('[OfflineDetector] Connection restored');
    this.isOnline = true;
    this._stopAutoRetry();
    this.hideOfflinePage();

    if (typeof showNotification === 'function') {
      showNotification(this.translator.translate('Connection restored - refreshing...'), 'success');
    }
    setTimeout(() => window.location.reload(), 700);
  }

  // Auto retry in background
  _startAutoRetry() {
    this._stopAutoRetry();
    this.retryInterval = setInterval(async () => {
      if (this.isChecking) return;
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

  // Button visual states
  _setButtonState(state) {
    const btn = document.querySelector('.connection-retry-btn');
    if (!btn) return;

    const iconEl = btn.querySelector('i') || btn.querySelector('.retry-btn-icon');
    const textEl = btn.querySelector('span') || btn.querySelector('.retry-btn-text');
    if (!iconEl || !textEl) return;

    btn.classList.remove('is-loading', 'is-success', 'is-failed');

    switch (state) {
      case 'loading':
        btn.classList.add('is-loading');
        btn.disabled = true;
        iconEl.className = 'fas fa-circle-notch fa-spin';
        iconEl.style.animation = 'retryRotate 0.8s linear infinite';
        textEl.textContent = this.translator.translate('Checking...');
        break;
      case 'success':
        btn.classList.add('is-success');
        btn.disabled = true;
        iconEl.className = 'fas fa-check';
        iconEl.style.animation = 'none';
        textEl.textContent = this.translator.translate('Connected!');
        break;
      case 'failed':
        btn.classList.add('is-failed');
        btn.disabled = false;
        iconEl.className = 'fas fa-times';
        iconEl.style.animation = 'none';
        textEl.textContent = this.translator.translate('No connection');
        break;
      default: // idle
        btn.disabled = false;
        iconEl.className = 'fas fa-sync-alt';
        iconEl.style.animation = 'none';
        textEl.textContent = this.translator.translate('Try again');
    }
  }

  _updateStatusText() {
    const statusEl = document.querySelector('.connection-status-text');
    if (statusEl) {
      statusEl.textContent = this.translator.translate('Searching for connection...');
    }
  }

  showOfflinePage() {
    let offlinePage = document.getElementById('connection-offline-page');

    if (offlinePage) {
      offlinePage.style.display = 'flex';
      this.preventBackgroundInteraction();
      return;
    }

    offlinePage = document.createElement('div');
    offlinePage.id = 'connection-offline-page';
    offlinePage.className = 'connection-offline-page';

    const container = document.createElement('div');
    container.className = 'connection-offline-container';

    const hero = document.createElement('div');
    hero.className = 'connection-offline-hero';

    // Icon container
    const iconContainer = document.createElement('div');
    iconContainer.className = 'connection-offline-icon-container';

    const iconDiv = document.createElement('div');
    iconDiv.className = 'connection-offline-icon';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'connection-wifi-offline-icon');

    const paths = [
      'M50 75 C52 75 54 77 54 79 C54 81 52 83 50 83 C48 83 46 81 46 79 C46 77 48 75 50 75 Z',
      'M50 65 C55 65 59 67 62 71 L67 66 C62 61 56 58 50 58 C44 58 38 61 33 66 L38 71 C41 67 45 65 50 65 Z',
      'M50 48 C59 48 67 52 73 58 L78 53 C70 45 60 40 50 40 C40 40 30 45 22 53 L27 58 C33 52 41 48 50 48 Z',
      'M50 31 C63 31 75 37 83 46 L88 41 C78 31 65 25 50 25 C35 25 22 31 12 41 L17 46 C25 37 37 31 50 31 Z'
    ];

    paths.forEach(pathData => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('fill', 'currentColor');
      svg.appendChild(path);
    });

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '15');
    line.setAttribute('y1', '15');
    line.setAttribute('x2', '85');
    line.setAttribute('y2', '85');
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '4');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);

    iconDiv.appendChild(svg);

    const signalWaves = document.createElement('div');
    signalWaves.className = 'connection-signal-waves';

    for (let i = 1; i <= 3; i++) {
      const wave = document.createElement('div');
      wave.className = 'connection-wave connection-wave-' + i;
      signalWaves.appendChild(wave);
    }

    iconContainer.appendChild(iconDiv);
    iconContainer.appendChild(signalWaves);

    // Content section
    const content = document.createElement('div');
    content.className = 'connection-offline-content';

    const title = document.createElement('h1');
    title.className = 'connection-offline-title';
    title.textContent = this.translator.translate('No Internet Connection');

    const subtitle = document.createElement('p');
    subtitle.className = 'connection-offline-subtitle';
    subtitle.textContent = this.translator.translate('Please check your internet connection and try again');

    // Status indicator
    const statusDiv = document.createElement('div');
    statusDiv.className = 'connection-offline-status';

    const statusIndicator = document.createElement('div');
    statusIndicator.className = 'connection-status-indicator';

    const statusDot = document.createElement('span');
    statusDot.className = 'connection-status-dot';

    const statusText = document.createElement('span');
    statusText.className = 'connection-status-text';
    statusText.textContent = this.translator.translate('Searching for connection...');

    statusIndicator.appendChild(statusDot);
    statusIndicator.appendChild(statusText);
    statusDiv.appendChild(statusIndicator);

    // Retry button
    const actions = document.createElement('div');
    actions.className = 'connection-offline-actions';

    const retryBtn = document.createElement('button');
    retryBtn.className = 'connection-retry-btn';
    retryBtn.onclick = () => this.manualRetry();

    const icon = document.createElement('i');
    icon.className = 'fas fa-sync-alt';

    const span = document.createElement('span');
    span.textContent = this.translator.translate('Try again');

    retryBtn.appendChild(icon);
    retryBtn.appendChild(span);
    actions.appendChild(retryBtn);

    content.appendChild(title);
    content.appendChild(subtitle);
    content.appendChild(statusDiv);
    content.appendChild(actions);

    hero.appendChild(iconContainer);
    hero.appendChild(content);
    container.appendChild(hero);
    offlinePage.appendChild(container);

    document.body.appendChild(offlinePage);
    this.offlinePage = offlinePage;

    this.applyCurrentTheme();
    this.preventBackgroundInteraction();
  }

  hideOfflinePage() {
    const offlinePage = document.getElementById('connection-offline-page');
    if (offlinePage) {
      offlinePage.style.display = 'none';
      this.restoreBackgroundInteraction();
    }
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
      const offlinePage = document.getElementById('connection-offline-page');
      if (offlinePage && !offlinePage.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    this.touchMoveHandler = (e) => {
      const offlinePage = document.getElementById('connection-offline-page');
      if (offlinePage && !offlinePage.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
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
    const offlinePage = document.getElementById('connection-offline-page');
    if (!offlinePage) return;

    const isDarkTheme = document.documentElement.classList.contains('dark-theme') ||
                       document.body.classList.contains('dark-theme');

    if (isDarkTheme) {
      offlinePage.classList.add('dark-theme');
    } else {
      offlinePage.classList.remove('dark-theme');
    }
  }

  updateTranslations(translator) {
    this.translator = translator;

    const offlinePage = document.getElementById('connection-offline-page');
    if (offlinePage && offlinePage.style.display !== 'none') {
      const title = offlinePage.querySelector('.connection-offline-title');
      const subtitle = offlinePage.querySelector('.connection-offline-subtitle');
      const retrySpan = offlinePage.querySelector('.connection-retry-btn span');
      const statusText = offlinePage.querySelector('.connection-status-text');

      if (title) title.textContent = this.translator.translate('No Internet Connection');
      if (subtitle) subtitle.textContent = this.translator.translate('Please check your internet connection and try again');
      if (retrySpan) retrySpan.textContent = this.translator.translate('Try again');
      if (statusText) statusText.textContent = this.translator.translate('Searching for connection...');
    }
  }

  destroy() {
    this._stopAutoRetry();
    window.removeEventListener('online', this._onBrowserOnline);
    window.removeEventListener('offline', this._onBrowserOffline);

    this.restoreBackgroundInteraction();

    const offlinePage = document.getElementById('connection-offline-page');
    if (offlinePage) {
      offlinePage.remove();
    }

    console.log('[OfflineDetector] System destroyed');
  }
}

// Initialize offline detection system when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(() => {
    window.offlineDetector = new OfflineDetector();
    console.log('[OfflineDetector] Professional system initialized');
  }, 1000);
});

// Update translations when language changes
document.addEventListener('languageChanged', function(event) {
  if (window.offlineDetector && event.detail && event.detail.translator) {
    window.offlineDetector.updateTranslations(event.detail.translator);
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OfflineDetector;
}