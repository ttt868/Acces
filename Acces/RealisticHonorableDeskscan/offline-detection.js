// Offline Detection System - Simple and resource-efficient
class OfflineDetector {
  constructor() {
    this.isOnline = navigator.onLine;
    this.offlinePage = null;
    this.translator = window.translator || { translate: (key) => key };

    this.initialize();
  }

  initialize() {
    console.log('Initializing Simple Offline Detection System');

    // Listen for browser events but verify with real connection check
    window.addEventListener('online', () => {
      // Don't trust navigator.onLine alone - verify with real request
      this.checkConnection();
    });
    window.addEventListener('offline', () => this.handleOffline());

    // Make checkConnection globally available for manual retry button
    window.checkConnection = () => this.checkConnection();
  }

  async checkConnection() {
    try {
      // Test actual internet connectivity with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(window.location.origin + '/favicon.ico?' + Date.now(), {
        method: 'HEAD',
        cache: 'no-cache',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        if (!this.isOnline) {
          this.handleOnline();
        }
        return true;
      } else {
        throw new Error('Server not reachable');
      }
    } catch (error) {
      // Real connection test failed - show offline even if navigator.onLine is true
      if (this.isOnline) {
        this.handleOffline();
      }
      return false;
    }
  }

  handleOnline() {
    // Double-check with real connection test before going online
    this.checkConnection().then(isReallyOnline => {
      if (isReallyOnline) {
        console.log('Connection restored - reloading page for smooth experience');
        this.isOnline = true;

        // Hide offline page first
        this.hideOfflinePage();

        // Show success notification briefly before reload
        if (typeof showNotification === 'function') {
          showNotification(this.translator.translate('Connection restored - refreshing...'), 'success');
        }

        // Reload page after a brief delay to ensure smooth transition
        // This prevents glitches and ensures all resources load correctly
        setTimeout(() => {
          window.location.reload();
        }, 500);
      }
    });
  }

  handleOffline() {
    console.log('Connection lost - going offline');
    this.isOnline = false;

    // Show offline page
    this.showOfflinePage();
  }

  showOfflinePage() {
    // Check if offline page already exists
    let offlinePage = document.getElementById('connection-offline-page');

    if (offlinePage) {
      offlinePage.style.display = 'flex';
      // Prevent background scrolling and interaction
      this.preventBackgroundInteraction();
      return;
    }

    // Create offline page if it doesn't exist
    offlinePage = document.createElement('div');
    offlinePage.id = 'connection-offline-page';
    offlinePage.className = 'connection-offline-page';

    // Create structure using safe DOM methods
    const container = document.createElement('div');
    container.className = 'connection-offline-container';

    const hero = document.createElement('div');
    hero.className = 'connection-offline-hero';

    // Icon container
    const iconContainer = document.createElement('div');
    iconContainer.className = 'connection-offline-icon-container';

    const iconDiv = document.createElement('div');
    iconDiv.className = 'connection-offline-icon';

    // SVG icon (safe static content)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.className = 'connection-wifi-offline-icon';
    
    // WiFi paths
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
    
    // Diagonal line
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

    // Signal waves
    const signalWaves = document.createElement('div');
    signalWaves.className = 'connection-signal-waves';
    
    for (let i = 1; i <= 3; i++) {
      const wave = document.createElement('div');
      wave.className = `connection-wave connection-wave-${i}`;
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

    const actions = document.createElement('div');
    actions.className = 'connection-offline-actions';

    const retryBtn = document.createElement('button');
    retryBtn.className = 'connection-retry-btn';
    retryBtn.onclick = () => checkConnection();

    const icon = document.createElement('i');
    icon.className = 'fas fa-sync-alt';

    const span = document.createElement('span');
    span.textContent = this.translator.translate('Try again');

    retryBtn.appendChild(icon);
    retryBtn.appendChild(span);
    actions.appendChild(retryBtn);

    content.appendChild(title);
    content.appendChild(subtitle);
    content.appendChild(actions);

    hero.appendChild(iconContainer);
    hero.appendChild(content);
    container.appendChild(hero);
    offlinePage.appendChild(container);

    document.body.appendChild(offlinePage);
    this.offlinePage = offlinePage;

    // Apply current theme
    this.applyCurrentTheme();

    // Prevent background interaction
    this.preventBackgroundInteraction();
  }

  hideOfflinePage() {
    const offlinePage = document.getElementById('connection-offline-page');
    if (offlinePage) {
      offlinePage.style.display = 'none';
      // Restore background interaction
      this.restoreBackgroundInteraction();
    }
  }

  preventBackgroundInteraction() {
    // Store original styles
    this.originalBodyStyle = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      touchAction: document.body.style.touchAction,
      userSelect: document.body.style.userSelect,
      overscrollBehavior: document.body.style.overscrollBehavior
    };

    // Prevent all body interactions
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.height = '100%';
    document.body.style.touchAction = 'none';
    document.body.style.userSelect = 'none';
    document.body.style.overscrollBehavior = 'none';

    // Also apply to html element
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.touchAction = 'none';
    document.documentElement.style.overscrollBehavior = 'none';

    // Prevent touch events on the entire document
    this.touchStartHandler = (e) => {
      // Only allow touches on the offline page itself
      const offlinePage = document.getElementById('connection-offline-page');
      if (offlinePage && !offlinePage.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    this.touchMoveHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener('touchstart', this.touchStartHandler, { passive: false });
    document.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
    document.addEventListener('wheel', this.touchMoveHandler, { passive: false });
    document.addEventListener('scroll', this.touchMoveHandler, { passive: false });
  }

  restoreBackgroundInteraction() {
    // Restore original body styles
    if (this.originalBodyStyle) {
      document.body.style.overflow = this.originalBodyStyle.overflow;
      document.body.style.position = this.originalBodyStyle.position;
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.touchAction = this.originalBodyStyle.touchAction;
      document.body.style.userSelect = this.originalBodyStyle.userSelect;
      document.body.style.overscrollBehavior = this.originalBodyStyle.overscrollBehavior;
    }

    // Restore html element styles
    document.documentElement.style.overflow = '';
    document.documentElement.style.touchAction = '';
    document.documentElement.style.overscrollBehavior = '';

    // Remove event listeners
    if (this.touchStartHandler) {
      document.removeEventListener('touchstart', this.touchStartHandler);
      document.removeEventListener('touchmove', this.touchMoveHandler);
      document.removeEventListener('wheel', this.touchMoveHandler);
      document.removeEventListener('scroll', this.touchMoveHandler);
    }
  }

  applyCurrentTheme() {
    const offlinePage = document.getElementById('connection-offline-page');
    if (!offlinePage) return;

    // Check if dark theme is active
    const isDarkTheme = document.documentElement.classList.contains('dark-theme') || 
                       document.body.classList.contains('dark-theme');

    if (isDarkTheme) {
      offlinePage.classList.add('dark-theme');
    } else {
      offlinePage.classList.remove('dark-theme');
    }
  }

  // Update translations when language changes
  updateTranslations(translator) {
    this.translator = translator;

    const offlinePage = document.getElementById('connection-offline-page');
    if (offlinePage && offlinePage.style.display !== 'none') {
      // Update text content safely without re-rendering
      const title = offlinePage.querySelector('.connection-offline-title');
      const subtitle = offlinePage.querySelector('.connection-offline-subtitle');
      const retrySpan = offlinePage.querySelector('.connection-retry-btn span');

      if (title) title.textContent = this.translator.translate('No Internet Connection');
      if (subtitle) subtitle.textContent = this.translator.translate('Please check your internet connection and try again');
      if (retrySpan) retrySpan.textContent = this.translator.translate('Try again');
    }
  }

  // Cleanup method
  destroy() {
    // Remove event listeners
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);

    // Restore background interaction
    this.restoreBackgroundInteraction();

    // Remove offline page
    const offlinePage = document.getElementById('connection-offline-page');
    if (offlinePage) {
      offlinePage.remove();
    }

    console.log('Simple Offline Detection System destroyed');
  }
}

// Initialize offline detection system when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  // Wait a bit to ensure other systems are initialized
  setTimeout(() => {
    window.offlineDetector = new OfflineDetector();
    console.log('Simple Offline Detection System initialized');
  }, 1000);
});

// Update translations when language changes
document.addEventListener('languageChanged', function(event) {
  if (window.offlineDetector && event.detail.translator) {
    window.offlineDetector.updateTranslations(event.detail.translator);
  }
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OfflineDetector;
}