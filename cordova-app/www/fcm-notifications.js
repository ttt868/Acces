/**
 * Firebase Cloud Messaging (FCM) for Cordova
 * Push Notifications System for Access Network App
 */

(function() {
  'use strict';

  // Wait for device ready
  document.addEventListener('deviceready', initFCM, false);

  function initFCM() {
    console.log('🔔 Initializing Firebase Cloud Messaging...');

    // Check if plugin is available
    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.firebase || !cordova.plugins.firebase.messaging) {
      console.warn('⚠️ Firebase Messaging plugin not available');
      return;
    }

    const messaging = cordova.plugins.firebase.messaging;

    // Request permission for notifications
    messaging.requestPermission().then(function() {
      console.log('✅ Notification permission granted');
      
      // Get FCM token
      return messaging.getToken();
    }).then(function(token) {
      console.log('🔑 FCM Token:', token);
      
      // Save token to server
      saveFCMTokenToServer(token);
      
    }).catch(function(error) {
      console.error('❌ FCM Error:', error);
    });

    // Listen for token refresh
    messaging.onTokenRefresh(function() {
      messaging.getToken().then(function(token) {
        console.log('🔄 FCM Token refreshed:', token);
        saveFCMTokenToServer(token);
      });
    });

    // Handle foreground messages
    messaging.onMessage(function(payload) {
      console.log('📩 Foreground message received:', payload);
      
      // Show notification manually when app is in foreground
      showLocalNotification(payload);
    });

    // Handle background message tap (opens app)
    messaging.onBackgroundMessage(function(payload) {
      console.log('📩 Background message received:', payload);
    });
  }

  // Save FCM token to server
  function saveFCMTokenToServer(token) {
    // Get user ID from localStorage
    const userStr = localStorage.getItem('accessoireUser');
    if (!userStr) {
      console.log('⏳ No user logged in, will save token after login');
      // Store token temporarily
      localStorage.setItem('pending_fcm_token', token);
      return;
    }

    const user = JSON.parse(userStr);
    const userId = user.id;

    if (!userId) {
      console.log('⏳ No user ID, storing token for later');
      localStorage.setItem('pending_fcm_token', token);
      return;
    }

    console.log('📤 Saving FCM token to server for user:', userId);

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
        console.log('✅ FCM token saved to server');
        localStorage.removeItem('pending_fcm_token');
        localStorage.setItem('fcm_token_saved', 'true');
      } else {
        console.error('❌ Failed to save FCM token:', data.error);
      }
    })
    .catch(function(error) {
      console.error('❌ Error saving FCM token:', error);
    });
  }

  // Show local notification when app is in foreground
  function showLocalNotification(payload) {
    const title = payload.title || payload.notification?.title || 'Access Network';
    const body = payload.body || payload.notification?.body || '';

    // Show as toast/alert since app is in foreground
    if (window.plugins && window.plugins.toast) {
      window.plugins.toast.showLongBottom(title + ': ' + body);
    } else {
      // Fallback: show as custom toast
      showToast(title + ': ' + body);
    }
  }

  // Simple toast notification
  function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:80px;left:20px;right:20px;background:#333;color:white;padding:15px;border-radius:10px;z-index:999999;text-align:center;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.5s';
      setTimeout(function() { toast.remove(); }, 500);
    }, 4000);
  }

  // Function to save pending token after user login
  window.savePendingFCMToken = function() {
    const pendingToken = localStorage.getItem('pending_fcm_token');
    if (pendingToken) {
      console.log('📤 Saving pending FCM token after login...');
      saveFCMTokenToServer(pendingToken);
    }
  };

  // Check and save pending token periodically
  setInterval(function() {
    const pendingToken = localStorage.getItem('pending_fcm_token');
    const userStr = localStorage.getItem('accessoireUser');
    
    if (pendingToken && userStr) {
      const user = JSON.parse(userStr);
      if (user && user.id) {
        saveFCMTokenToServer(pendingToken);
      }
    }
  }, 10000); // Check every 10 seconds

})();
