
// Smart Presence Optimizer - reduces resource usage on client side
class PresenceOptimizer {
  constructor() {
    this.isUserActive = true;
    this.lastActivityTime = Date.now();
    this.activityCheckInterval = null;
    this.websocketManager = null;
    
    this.initialize();
  }

  initialize() {
    // Track user activity events
    this.setupActivityTracking();
    
    // Start monitoring user activity
    this.startActivityMonitoring();
    
    console.log('Smart presence optimizer initialized');
  }

  setupActivityTracking() {
    const activityEvents = ['click', 'keydown', 'scroll', 'touchstart', 'mousemove'];
    
    // Throttled activity handler to avoid excessive calls
    let activityTimeout;
    const handleActivity = () => {
      if (activityTimeout) return;
      
      activityTimeout = setTimeout(() => {
        this.updateActivity();
        activityTimeout = null;
      }, 1000); // Throttle to once per second
    };

    // Add event listeners for user activity
    activityEvents.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Track page visibility changes
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.setUserIdle();
      } else {
        this.setUserActive();
      }
    });
  }

  updateActivity() {
    const now = Date.now();
    this.lastActivityTime = now;
    
    if (!this.isUserActive) {
      this.setUserActive();
    }
  }

  setUserActive() {
    if (!this.isUserActive) {
      this.isUserActive = true;
      this.sendActivitySignal('user_active');
      console.log('User became active - optimizing connection');
    }
  }

  setUserIdle() {
    if (this.isUserActive) {
      this.isUserActive = false;
      this.sendActivitySignal('user_idle');
      console.log('User became idle - reducing connection overhead');
    }
  }

  startActivityMonitoring() {
    // Check user activity every 30 seconds
    this.activityCheckInterval = setInterval(() => {
      const timeSinceActivity = Date.now() - this.lastActivityTime;
      
      // Mark as idle after 2 minutes of no activity
      if (timeSinceActivity > 120000 && this.isUserActive) {
        this.setUserIdle();
      }
    }, 30000);
  }

  sendActivitySignal(type) {
    // Send activity signal to WebSocket if available
    if (this.websocketManager && this.websocketManager.socket) {
      try {
        this.websocketManager.socket.send(JSON.stringify({
          type: type,
          timestamp: Date.now()
        }));
      } catch (err) {
        console.error('Error sending activity signal:', err);
      }
    }
  }

  setWebSocketManager(wsManager) {
    this.websocketManager = wsManager;
  }

  destroy() {
    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
    }
    
    console.log('Presence optimizer destroyed');
  }
}

// Make it globally available
window.presenceOptimizer = new PresenceOptimizer();

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PresenceOptimizer;
}
