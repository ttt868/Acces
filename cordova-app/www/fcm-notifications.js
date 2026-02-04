/**
 * Firebase Cloud Messaging (FCM) for Cordova
 * Push Notifications System for Access Network App
 * Enhanced version with better token registration
 */

(function() {
  'use strict';

  let fcmToken = null;
  let messaging = null;

  // Wait for device ready
  document.addEventListener('deviceready', initFCM, false);

  function initFCM() {
    console.log('🔔 [FCM] Initializing Firebase Cloud Messaging...');

    // Check if plugin is available
    if (typeof cordova === 'undefined') {
      console.warn('⚠️ [FCM] Not in Cordova environment');
      return;
    }

    if (!cordova.plugins || !cordova.plugins.firebase || !cordova.plugins.firebase.messaging) {
      console.warn('⚠️ [FCM] Firebase Messaging plugin not available');
      console.warn('⚠️ [FCM] Available plugins:', Object.keys(cordova.plugins || {}));
      return;
    }

    messaging = cordova.plugins.firebase.messaging;
    console.log('✅ [FCM] Firebase Messaging plugin found');

    // Request permission for notifications
    messaging.requestPermission().then(function() {
      console.log('✅ [FCM] Notification permission granted');
      
      // Get FCM token
      return messaging.getToken();
    }).then(function(token) {
      console.log('🔑 [FCM] Token received:', token ? token.substring(0, 30) + '...' : 'NULL');
      fcmToken = token;
      localStorage.setItem('fcm_token', token);
      
      // Try to save token to server
      saveFCMTokenToServer(token);
      
    }).catch(function(error) {
      console.error('❌ [FCM] Error:', error);
    });

    // Listen for token refresh
    messaging.onTokenRefresh(function() {
      messaging.getToken().then(function(token) {
        console.log('🔄 [FCM] Token refreshed');
        fcmToken = token;
        localStorage.setItem('fcm_token', token);
        localStorage.removeItem('fcm_registered'); // Force re-registration
        saveFCMTokenToServer(token);
      });
    });

    // Handle foreground messages
    messaging.onMessage(function(payload) {
      console.log('📩 [FCM] Foreground message:', payload);
      showInAppNotification(payload);
    });

    // Handle background message tap (opens app)
    messaging.onBackgroundMessage(function(payload) {
      console.log('📩 [FCM] Background message tap:', payload);
    });
  }

  // Save FCM token to server
  function saveFCMTokenToServer(token) {
    if (!token) {
      console.log('⚠️ [FCM] No token to save');
      return;
    }

    // Get user ID from localStorage
    const userStr = localStorage.getItem('accessoireUser');
    if (!userStr) {
      console.log('⏳ [FCM] No user logged in, token stored locally');
      localStorage.setItem('pending_fcm_token', token);
      return;
    }

    let user;
    try {
      user = JSON.parse(userStr);
    } catch (e) {
      console.error('❌ [FCM] Error parsing user:', e);
      localStorage.setItem('pending_fcm_token', token);
      return;
    }

    const userId = user.id;
    if (!userId) {
      console.log('⏳ [FCM] No user ID, token stored locally');
      localStorage.setItem('pending_fcm_token', token);
      return;
    }

    // Check if already registered for this user
    const registeredUser = localStorage.getItem('fcm_registered_user');
    if (registeredUser === String(userId) && localStorage.getItem('fcm_registered') === 'true') {
      console.log('✅ [FCM] Already registered for user:', userId);
      return;
    }

    console.log('📤 [FCM] Saving token for user:', userId);

    fetch('https://accesschain.org/api/fcm/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId,
        token: token,
        platform: 'android'
      })
    })
    .then(function(response) { return response.json(); })
    .then(function(data) {
      if (data.success) {
        console.log('✅ [FCM] Token registered successfully for user:', userId);
        localStorage.removeItem('pending_fcm_token');
        localStorage.setItem('fcm_registered', 'true');
        localStorage.setItem('fcm_registered_user', String(userId));
      } else {
        console.error('❌ [FCM] Registration failed:', data.error);
      }
    })
    .catch(function(error) {
      console.error('❌ [FCM] Network error:', error);
    });
  }

  // Show in-app notification when app is in foreground
  function showInAppNotification(payload) {
    const title = payload.title || payload.notification?.title || 'Access Network';
    const body = payload.body || payload.notification?.body || '';

    // Create toast notification
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 10px;
      right: 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 15px 20px;
      border-radius: 12px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      animation: fcmSlideDown 0.3s ease;
    `;
    toast.innerHTML = '<div style="font-weight: 600; font-size: 15px; margin-bottom: 4px;">' + title + '</div>' +
      '<div style="font-size: 13px; opacity: 0.9;">' + body + '</div>';
    
    // Add animation style if not exists
    if (!document.getElementById('fcm-animation-style')) {
      const style = document.createElement('style');
      style.id = 'fcm-animation-style';
      style.textContent = '@keyframes fcmSlideDown { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }';
      document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.5s';
      setTimeout(function() { toast.remove(); }, 500);
    }, 5000);
  }

  // Global function to manually trigger token save (call after login)
  window.registerFCMToken = function() {
    console.log('🔄 [FCM] Manual token registration triggered');
    localStorage.removeItem('fcm_registered'); // Force re-registration
    
    const token = fcmToken || localStorage.getItem('fcm_token') || localStorage.getItem('pending_fcm_token');
    if (token) {
      saveFCMTokenToServer(token);
    } else if (messaging) {
      // Try to get token again
      messaging.getToken().then(function(token) {
        fcmToken = token;
        localStorage.setItem('fcm_token', token);
        saveFCMTokenToServer(token);
      }).catch(function(error) {
        console.error('❌ [FCM] Error getting token:', error);
      });
    }
  };

  // Alias for backward compatibility
  window.savePendingFCMToken = window.registerFCMToken;

  // Check periodically for pending token registration
  setInterval(function() {
    const token = localStorage.getItem('pending_fcm_token') || localStorage.getItem('fcm_token');
    const userStr = localStorage.getItem('accessoireUser');
    const alreadyRegistered = localStorage.getItem('fcm_registered');
    const registeredUser = localStorage.getItem('fcm_registered_user');
    
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        if (user && user.id) {
          // Check if registered for different user - need to re-register
          if (registeredUser && registeredUser !== String(user.id)) {
            console.log('👤 [FCM] User changed, re-registering token...');
            localStorage.removeItem('fcm_registered');
          }
          
          if (!alreadyRegistered) {
            saveFCMTokenToServer(token);
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, 5000); // Check every 5 seconds

  // Also check when user data changes (login/logout)
  let lastUserStr = localStorage.getItem('accessoireUser');
  setInterval(function() {
    const currentUserStr = localStorage.getItem('accessoireUser');
    if (currentUserStr !== lastUserStr) {
      lastUserStr = currentUserStr;
      if (currentUserStr) {
        console.log('👤 [FCM] User changed/logged in, registering token...');
        localStorage.removeItem('fcm_registered'); // Force re-registration
        window.registerFCMToken();
      } else {
        // User logged out
        localStorage.removeItem('fcm_registered');
        localStorage.removeItem('fcm_registered_user');
      }
    }
  }, 2000); // Check every 2 seconds

})();
