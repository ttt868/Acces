// State Processing Manager - Static Display Only (No Server Consumption)
class StateProcessingManager {
  constructor() {
    this.isInitialized = false;
    this.initializeWhenReady();
  }

  initializeWhenReady() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initialize());
    } else {
      this.initialize();
    }
  }

  initialize() {
    if (this.isInitialized) return;

    console.log('Initializing State Processing Manager - Static Mode');

    // Set up whitepaper functionality only
    this.setupWhitepaperFunctionality();

    this.isInitialized = true;
  }

  // Setup whitepaper download and view functionality
  setupWhitepaperFunctionality() {
    // Make whitepaper functions globally available
    window.downloadWhitepaper = this.downloadWhitepaper.bind(this);
    window.openWhitepaper = this.openWhitepaper.bind(this);

    console.log('Whitepaper functionality initialized');
  }

  // Download whitepaper function
  downloadWhitepaper() {
    try {
      console.log('Downloading whitepaper...');

      // Create a link to the whitepaper HTML file
      const whitepaperUrl = './whitepaper.html';

      // Open whitepaper in new tab for viewing/printing/saving
      const whitepaperWindow = window.open(whitepaperUrl, '_blank');

      if (whitepaperWindow) {
        console.log('Whitepaper opened in new tab');

        // Show notification about whitepaper access
        if (typeof showNotification === 'function') {
          showNotification('Whitepaper opened in new tab. You can view, print, or save it from there.', 'success');
        }
      } else {
        // Fallback: direct navigation if popup blocked
        console.log('Popup blocked, using direct navigation');
        window.location.href = whitepaperUrl;
      }

    } catch (error) {
      console.error('Error accessing whitepaper:', error);

      if (typeof showNotification === 'function') {
        showNotification('Error accessing whitepaper. Please try again.', 'error');
      }
    }
  }

  // Open whitepaper in modal or new window
  openWhitepaper() {
    try {
      console.log('Opening whitepaper...');

      const whitepaperUrl = './whitepaper.html';

      // Open in new window with specific dimensions
      const whitepaperWindow = window.open(
        whitepaperUrl, 
        'whitepaper',
        'width=900,height=700,scrollbars=yes,resizable=yes,toolbar=no,location=no,status=no'
      );

      if (whitepaperWindow) {
        whitepaperWindow.focus();
        console.log('Whitepaper opened in dedicated window');

        if (typeof showNotification === 'function') {
          showNotification('Whitepaper opened successfully', 'success');
        }
      } else {
        // Fallback to same tab if popup blocked
        this.downloadWhitepaper();
      }

    } catch (error) {
      console.error('Error opening whitepaper:', error);
      this.downloadWhitepaper();
    }
  }

  // Static processing statistics - no server requests
  getProcessingStats() {
    return {
      currentProcessors: 10000,
      currentMined: 250000,
      totalSupply: 25000000,
      processingRate: 0.24
    };
  }

  // Cleanup function
  destroy() {
    // Remove global functions
    if (window.downloadWhitepaper) {
      delete window.downloadWhitepaper;
    }
    if (window.openWhitepaper) {
      delete window.openWhitepaper;
    }

    this.isInitialized = false;
    console.log('State Processing Manager destroyed');
  }
}

// Initialize State Processing Manager - Static Only
window.stateProcessingManager = new StateProcessingManager();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StateProcessingManager;
}

// Static functions only - no server consumption
window.getProcessingStats = function() {
  return { currentProcessors: 10000, currentMined: 250000, totalSupply: 100000000, processingRate: +0.24 };
};

// Disabled functions - no server requests
window.updateProcessingStats = function(statsUpdate) { /* Static values only - no server requests */ };
window.loadProcessingStatsFromUser = function(userData) { /* Static values only - no server requests */ };

console.log('State Processing Manager loaded - Static Mode Only');



