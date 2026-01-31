// Fetch with timeout wrapper - prevents hanging requests
function fetchWithTimeout(url, options = {}, timeout = 15000) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout - please check your connection')), timeout)
    )
  ]);
}

// Global formatNumberSmart function (must be before DOMContentLoaded)
// 1000 → 1,000.00 | 1 → 1.00 | 0 → 0.00 | 0.5 → 0.50 | 2.1 → 2.10
window.formatNumberSmart = function(number) {
  if (typeof number !== 'number') {
    number = parseFloat(number) || 0;
  }

  // ✅ دائماً اعرض رقمين عشريين على الأقل (حتى لو كان 0)
  let formatted = parseFloat(number.toFixed(8)).toString();
  
  const parts = formatted.split('.');
  
  // CRITICAL: Ensure at least 2 decimal places for ALL numbers
  if (!parts[1]) {
    parts[1] = '00';
  } else if (parts[1].length === 1) {
    parts[1] = parts[1] + '0';  // 2.1 → 2.10
  }
  
  // Add thousand separators to integer part
  parts[0] = parseInt(parts[0]).toLocaleString('en-US');
  
  return parts.join('.');
};

// ✅ دالة موحدة لتحديث عرض الرصيد مع مراعاة التشفير
window.updateBalanceDisplay = function(selector, value) {
  const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (!element) return;
  
  // التحقق من حالة التشفير
  const isHidden = localStorage.getItem('balanceHidden') === 'true';
  
  if (isHidden) {
    // الرصيد مشفر - لا تغير النص، BalancePrivacyManager سيتعامل معه
    element.classList.add('balance-hidden');
    // حفظ القيمة الجديدة في BalancePrivacyManager
    if (window.BalancePrivacyManager && window.BalancePrivacyManager.originalValues) {
      window.BalancePrivacyManager.originalValues.set(selector, formatNumberSmart(value));
    }
  } else {
    // الرصيد ظاهر - حدّث النص
    element.textContent = formatNumberSmart(value);
    element.classList.remove('balance-hidden');
  }
};

// 🔔 Push Notifications Registration Function
async function registerPushNotifications(userId) {
  console.log('🔔 registerPushNotifications called with userId:', userId);
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push notifications not supported');
      return;
    }

    // Get the service worker registration
    console.log('🔔 Getting service worker registration...');
    const registration = await navigator.serviceWorker.ready;
    console.log('🔔 Service worker ready');

    // Check if already subscribed
    let subscription = await registration.pushManager.getSubscription();
    console.log('🔔 Current subscription:', subscription ? 'exists' : 'none');
    
    // ✅ Force unsubscribe old subscription and create new one to fix 410 errors
    if (subscription) {
      try {
        await subscription.unsubscribe();
        console.log('🔄 Unsubscribed old push subscription');
        subscription = null;
      } catch (e) {
        console.warn('Could not unsubscribe:', e);
      }
    }
    
    if (!subscription) {
      // Subscribe to push notifications with current VAPID key (Updated Jan 2026)
      const vapidPublicKey = 'BM_rReowAfVGz12iV2a-p3J8_pkQJLXUty6ZP56PBxdIjDdh6IEG1Awk36Hgxv2opxDz2zwzVjjSOKiydFWAEKI';
      console.log('🔔 Subscribing with VAPID key...');
      
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });

      console.log('✅ Subscribed to push notifications:', subscription.endpoint.substring(0, 50) + '...');
    }

    // Send subscription to server
    console.log('🔔 Sending subscription to server...');
    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: userId,
        subscription: subscription
      })
    });
    
    const result = await response.json();
    console.log('🔔 Server response:', result);

    console.log('🔔 Push subscription saved to server');
  } catch (error) {
    console.error('❌ Push notification registration failed:', error);
  }
}

// 🔔 TWA/PWA: طلب إذن الإشعارات (مهم جداً لتطبيق Android)
async function requestNotificationPermission(userId) {
  try {
    if (!('Notification' in window)) {
      console.warn('Notifications not supported');
      return false;
    }

    // التحقق من الإذن الحالي
    let permission = Notification.permission;
    
    // إذا كان الإذن "default" (لم يتم السؤال بعد)، نطلب الإذن
    if (permission === 'default') {
      console.log('🔔 Requesting notification permission...');
      permission = await Notification.requestPermission();
    }

    if (permission === 'granted') {
      console.log('✅ Notification permission granted');
      // تسجيل الإشعارات
      await registerPushNotifications(userId);
      return true;
    } else {
      console.log('❌ Notification permission denied:', permission);
      return false;
    }
  } catch (error) {
    console.error('Error requesting notification permission:', error);
    return false;
  }
}

// Helper function to convert VAPID key
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// 🔔 طلب إذن الإشعارات فوراً عند تحميل الصفحة
(function autoRequestNotificationPermission() {
  // انتظر 5 ثواني للتأكد من تسجيل الدخول
  setTimeout(async () => {
    try {
      console.log('🔔 [AUTO] Starting push notification setup...');
      
      // تحقق من دعم الإشعارات
      if (!('Notification' in window)) {
        console.log('🔔 [AUTO] Notifications not supported');
        return;
      }
      
      if (!('serviceWorker' in navigator)) {
        console.log('🔔 [AUTO] ServiceWorker not supported');
        return;
      }
      
      console.log('🔔 [AUTO] Current permission:', Notification.permission);
      
      // إذا لم يُسأل من قبل، اطلب الإذن
      if (Notification.permission === 'default') {
        console.log('🔔 [AUTO] Requesting notification permission...');
        const permission = await Notification.requestPermission();
        console.log('🔔 [AUTO] Permission result:', permission);
      }
      
      // إذا تم منح الإذن، سجل الاشتراك
      if (Notification.permission === 'granted') {
        const user = window.currentUser;
        if (user && user.id) {
          console.log('🔔 [AUTO] Registering push for user:', user.id);
          await registerPushNotifications(user.id);
        } else {
          console.log('🔔 [AUTO] Permission granted but waiting for user login...');
          // انتظر المستخدم وحاول مرة أخرى
          let attempts = 0;
          const waitForUser = setInterval(async () => {
            attempts++;
            const u = window.currentUser;
            if (u && u.id) {
              clearInterval(waitForUser);
              console.log('🔔 [AUTO] User found after', attempts, 'attempts, registering...');
              await registerPushNotifications(u.id);
            } else if (attempts >= 30) { // 30 ثانية كحد أقصى
              clearInterval(waitForUser);
              console.log('🔔 [AUTO] Gave up waiting for user');
            }
          }, 1000);
        }
      } else if (Notification.permission === 'denied') {
        console.log('🔔 [AUTO] Notifications blocked by user');
      }
    } catch (e) {
      console.error('🔔 [AUTO] Error:', e);
    }
  }, 5000); // انتظر 5 ثواني
})();

// AccessRewards main script
document.addEventListener('DOMContentLoaded', function() {
  // Initialize variables first
  let currentUser = null;
  let referralCode = '';
  let translator = new Translator();
  let activityInterval = null; // Added to manage activity timer

  // ✅ جعل translator متاحاً عالمياً للترجمة الفورية
  window.translator = translator;

  Object.defineProperty(window, 'currentUser', {
    get() {
      return currentUser;
    },
    set(value) {
      currentUser = value;
    },
    configurable: true
  });

  // Helper function to format dates consistently regardless of device language
  function formatDateConsistently(timestamp) {
    const date = new Date(parseInt(timestamp));
    
    // Force English locale for consistent formatting
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
  }

  // Helper function to format date only (for referrals)
  function formatDateOnly(timestamp) {
    const date = new Date(parseInt(timestamp));
    
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    
    return `${year}/${month}/${day}`;
  }

  // Initialize smart presence system (handled by activity-stats.js)
  console.log('Smart presence system will be initialized by ActivityStatsManager');

  // Initialize loading screen after translator is available
  initializeLoadingScreen();

  // Initialize theme settings
  initializeThemeSettings();
  function maintainPrecision(number, decimals = 8) {

    return Math.round(number * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }

  // Format numbers: 1000 → 1,000 | 1 → 1 | 0.5 → 0.50 | 2.1 → 2.10
  function formatNumberSmart(number) {
    if (typeof number !== 'number') {
      number = parseFloat(number) || 0;
    }

    // ✅ دائماً اعرض رقمين عشريين على الأقل (حتى لو كان 0)
    let formatted = parseFloat(number.toFixed(8)).toString();
    
    const parts = formatted.split('.');
    
    // CRITICAL: Ensure at least 2 decimal places for ALL numbers
    if (!parts[1]) {
      parts[1] = '00';
    } else if (parts[1].length === 1) {
      parts[1] = parts[1] + '0';  // 2.1 → 2.10
    }
    
    // Add thousand separators to integer part
    parts[0] = parseInt(parts[0]).toLocaleString('en-US');
    
    return parts.join('.');
  }


  
// Profile Member Since Date Handler
  (function() {
    'use strict';

  function updateProfileMemberSinceDate() {
    const memberSinceElement = document.getElementById('profile-member-since');
    const memberSinceDateElement = document.getElementById('member-since-date');

    if (!memberSinceElement) {
      console.log('Profile member since element not found');
      return;
    }

    // Get current user from various sources
    let user = null;
    
    if (typeof currentUser !== 'undefined' && currentUser) {
      user = currentUser;
    } else if (window.currentUser) {
      user = window.currentUser;
    } else if (window.loadUserSession) {
      user = window.loadUserSession();
    }

    if (!user || !user.email) {
      console.log('No user data found');
      // 
      memberSinceElement.style.display = 'block';
      if (memberSinceDateElement) {
        memberSinceDateElement.textContent = 'January 1, 2025';
      }
      return;
    }

    try {
      let createdDate = null;
      let shouldSaveToServer = false;

      // Check for account creation date in various fields
      if (user.account_created_date) {
        createdDate = new Date(parseInt(user.account_created_date));
        console.log('Found account_created_date:', user.account_created_date);
      } else if (user.created_at) {
        createdDate = new Date(parseInt(user.created_at));
        console.log('Found created_at:', user.created_at);
      } else if (user.registration_date) {
        createdDate = new Date(parseInt(user.registration_date));
        console.log('Found registration_date:', user.registration_date);
      } else {
        // Fallback for missing creation date
        console.log('WARNING: No creation date found for existing user - this should not happen');
        console.log('ACCOUNT CREATION DATE IS IMMUTABLE - using fallback display date');
        
        createdDate = new Date('2025-01-01'); // Default fallback date
        shouldSaveToServer = false;
        
        console.log('FALLBACK: Using default display date for missing creation date');
      }

      // Validate date
      if (!createdDate || isNaN(createdDate.getTime())) {
        console.log('Invalid date, using current date as fallback');
        createdDate = new Date();
      }

      // Format date for display using selected language
      const currentLang = localStorage.getItem('preferredLanguage') || 'en';
      
      // Map language codes to locale codes for date formatting
      const localeMap = {
        'en': 'en-US',
        'ar': 'ar-SA',
        'fr': 'fr-FR',
        'es': 'es-ES',
        'de': 'de-DE',
        'tr': 'tr-TR',
        'it': 'it-IT',
        'hi': 'hi-IN',
        'zh': 'zh-CN',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
        'pt': 'pt-BR',
        'ru': 'ru-RU',
        'id': 'id-ID',
        'pl': 'pl-PL'
      };
      
      const locale = localeMap[currentLang] || 'en-US';
      
      const options = { 
        year: 'numeric', 
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
        numberingSystem: 'latn'
      };

      let formattedDate;
      
      // Special handling for Arabic: show Hijri date with Gregorian in smaller text
      if (currentLang === 'ar') {
        // Get Hijri date
        const hijriOptions = { 
          year: 'numeric', 
          month: 'long',
          day: 'numeric',
          timeZone: 'UTC',
          numberingSystem: 'latn',
          calendar: 'islamic'
        };
        const hijriDate = createdDate.toLocaleDateString('ar-SA', hijriOptions);
        
        // Get Gregorian date in Arabic format
        const gregorianOptions = { 
          year: 'numeric', 
          month: 'long',
          day: 'numeric',
          timeZone: 'UTC',
          numberingSystem: 'latn',
          calendar: 'gregory'
        };
        const gregorianDate = createdDate.toLocaleDateString('ar-SA', gregorianOptions);
        
        // Combine: Hijri first, then Gregorian in smaller text
        formattedDate = `${hijriDate} <span style="font-size: 0.85em; opacity: 0.9;">(${gregorianDate})</span>`;
      } else {
        formattedDate = createdDate.toLocaleDateString(locale, options);
      }

      // Update DOM safely (XSS protection)
      if (memberSinceDateElement) {
        // For Arabic with dual dates (Hijri + Gregorian) - Secure parsing
        if (currentLang === 'ar' && formattedDate.includes('span')) {
          memberSinceDateElement.textContent = '';
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = formattedDate;
          Array.from(tempDiv.childNodes).forEach(node => {
            memberSinceDateElement.appendChild(node.cloneNode(true));
          });
        } else {
          // Safe text-only update
          memberSinceDateElement.textContent = formattedDate;
        }
      } else {
        // Create elements safely without innerHTML
        memberSinceElement.textContent = '';
        
        const labelSpan = document.createElement('span');
        labelSpan.setAttribute('data-translate', 'Member since:');
        labelSpan.textContent = 'Member since:';
        
        const dateSpan = document.createElement('span');
        dateSpan.id = 'member-since-date';
        
        // For Arabic with dual dates (Hijri + Gregorian) - Secure parsing
        if (currentLang === 'ar' && formattedDate.includes('span')) {
          // Parse the formatted date safely
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = formattedDate;
          // Extract and rebuild safely
          Array.from(tempDiv.childNodes).forEach(node => {
            dateSpan.appendChild(node.cloneNode(true));
          });
        } else {
          dateSpan.textContent = formattedDate;
        }
        
        memberSinceElement.appendChild(labelSpan);
        memberSinceElement.appendChild(document.createTextNode(' '));
        memberSinceElement.appendChild(dateSpan);
      }

      // Ensure visibility
      memberSinceElement.style.display = 'block';
      memberSinceElement.style.visibility = 'visible';
      memberSinceElement.style.opacity = '1';
      
      console.log('Member since date set to:', formattedDate);

      console.log(`Profile member since updated: ${formattedDate}`);
    } catch (error) {
      console.error('Error formatting member since date:', error);

      // 
      const fallbackDate = new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long',
        day: 'numeric'
      });

      if (memberSinceDateElement) {
        memberSinceDateElement.textContent = fallbackDate;
      }

      memberSinceElement.style.display = 'block';
    }
  }

  // Initialize profile member since display
  function initializeProfileMemberSince() {
    // Initial update
    updateProfileMemberSinceDate();

    // Check periodically until user data is loaded
    const checkInterval = setInterval(() => {
      const user = currentUser || window.currentUser;
      if (user && (user.account_created_date || user.created_at || user.registration_date)) {
        updateProfileMemberSinceDate();
        clearInterval(checkInterval);
      }
    }, 100);

    // Stop checking after 10 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
    }, 10000);

    // Listen for user data updates
    document.addEventListener('userDataUpdated', updateProfileMemberSinceDate);
    document.addEventListener('profilePageShown', updateProfileMemberSinceDate);

    // Watch for profile page visibility changes
    const observer = new MutationObserver(() => {
      const profilePage = document.getElementById('profile-page');
      if (profilePage && profilePage.style.display !== 'none') {
        setTimeout(updateProfileMemberSinceDate, 100);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style']
    });
  }

  // Force display of member since element
  function forceProfileMemberSinceDisplay() {
    const memberSinceElement = document.getElementById('profile-member-since');
    if (memberSinceElement) {
      //
      memberSinceElement.style.display = 'block';
      memberSinceElement.style.visibility = 'visible';
      memberSinceElement.style.opacity = '1';
      
      // 
      updateProfileMemberSinceDate();
    }
  }

  // 
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeProfileMemberSince);
  } else {
    initializeProfileMemberSince();
  }

  // 
  setTimeout(forceProfileMemberSinceDisplay, 100);
  setTimeout(forceProfileMemberSinceDisplay, 500);
  setTimeout(forceProfileMemberSinceDisplay, 1000);
  setTimeout(forceProfileMemberSinceDisplay, 2000);
  
  // 
  document.addEventListener('click', function(e) {
    if (e.target.closest('[data-page="profile"]')) {
      setTimeout(forceProfileMemberSinceDisplay, 100);
      setTimeout(forceProfileMemberSinceDisplay, 500);
    }
  });

  // Continuous monitor to ensure visibility
  setInterval(function() {
    const profilePage = document.getElementById('profile-page');
    const memberSinceElement = document.getElementById('profile-member-since');
    
    if (profilePage && profilePage.style.display !== 'none' && memberSinceElement) {
      const textContent = memberSinceElement.textContent || '';
      if (memberSinceElement.style.display === 'none' || !textContent || !textContent.includes('Member since')) {
        forceProfileMemberSinceDisplay();
      }
    }
  }, 3000);

  // Expose function globally for external access
  window.updateProfileMemberSinceDate = updateProfileMemberSinceDate;

})();





  

  // Initialize theme system
  function initializeThemeSettings() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    
    // Apply saved theme immediately
    applyTheme(savedTheme);
    updateDashboardThemeIcon(savedTheme);
    
    // Set up profile theme selector
    const profileThemeSelect = document.getElementById('night-mode-select');
    if (profileThemeSelect) {
      profileThemeSelect.value = savedTheme;
      
      profileThemeSelect.addEventListener('change', function() {
        const selectedTheme = this.value;
        selectTheme(selectedTheme);
      });
    }
    
    // Set up theme toggle buttons in profile
    const themeDimBtn = document.getElementById('theme-dim');
    const themeBrightenBtn = document.getElementById('theme-brighten');
    
    if (themeDimBtn) {
      themeDimBtn.addEventListener('click', function() {
        selectTheme('dark');
      });
    }
    
    if (themeBrightenBtn) {
      themeBrightenBtn.addEventListener('click', function() {
        selectTheme('light');
      });
    }
    
    // Auto theme update every hour for auto mode
    setInterval(() => {
      const currentTheme = localStorage.getItem('theme');
      if (currentTheme === 'auto') {
        applyTheme('auto');
      }
    }, 3600000); // Check every hour
  }

  // Enhanced global balance update listeners for real-time sync
  document.addEventListener('balanceUpdated', function(event) {
    const newBalance = event.detail.newBalance;
    const formattedBalance = event.detail.formattedBalance || formatNumberSmart(newBalance);
    const isBalanceHidden = localStorage.getItem('balanceHidden') === 'true';
    
    console.log(`Global balance update event received: ${formattedBalance} Points`);
    
    // حفظ القيمة في BalancePrivacyManager
    if (window.balancePrivacy && window.balancePrivacy.originalValues) {
      window.balancePrivacy.originalValues.set('#user-coins', formattedBalance);
      window.balancePrivacy.originalValues.set('#profile-coins', formattedBalance);
    }
    
    // تحديث فقط إذا لم يكن مخفياً
    if (!isBalanceHidden) {
      const allBalanceSelectors = [
        '#user-points', '#profile-points', '.wallet-balance',
        '.user-balance', '.balance-display', '.point-balance', '[data-balance]',
        '#dashboard-balance', '#main-balance', '.current-balance'
      ];
      
      allBalanceSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
          if (element) {
            element.textContent = formatNumberSmart(newBalance);
            if (element.hasAttribute('data-balance')) {
              element.setAttribute('data-balance', newBalance);
            }
          }
        });
      });
    }
    
    // Trigger balance change indicator
    if (typeof window.showBalanceChange === 'function') {
      window.showBalanceChange(newBalance);
    }
    
    console.log(`Global balance updated to: ${formattedBalance}`);
  });

  // Initialize Smart Presence System from activity-stats.js
  // The presence tracking is now handled by SmartPresenceTracker class


  // Additional listener for activity completion events
  document.addEventListener('activityCompleted', function(event) {
    const { newBalance, formattedBalance, rewardAmount } = event.detail;
    
    console.log(`Activity completion event: +${rewardAmount.toFixed(8)} Points added, new balance: ${formattedBalance}`);
    
    // Force immediate UI update
    syncBalanceAcrossPages(newBalance);
  });

  // Listen for incoming transactions and show notifications
  document.addEventListener('transactionReceived', async function(event) {
    const txData = event.detail;
    console.log('Transaction received - showing notification:', txData);
    
    // Request permission if not already granted
    if (window.accessNotifications && window.accessNotifications.permission !== 'granted') {
      await window.accessNotifications.requestPermission();
    }
    
    // Show notification
    if (window.accessNotifications && window.accessNotifications.permission === 'granted') {
      await window.accessNotifications.notifyTransactionReceived(txData);
    }
  });

  // Window-level listener for cross-component communication
  window.addEventListener('globalBalanceUpdate', function(event) {
    const { newBalance, formattedBalance } = event.detail;
    const smartFormattedBalance = formatNumberSmart(newBalance);
    const isBalanceHidden = localStorage.getItem('balanceHidden') === 'true';
    
    console.log(`Window-level balance update: ${smartFormattedBalance} Points`);
    
    // حفظ القيمة في BalancePrivacyManager
    if (window.balancePrivacy && window.balancePrivacy.originalValues) {
      window.balancePrivacy.originalValues.set('#user-coins', smartFormattedBalance);
      window.balancePrivacy.originalValues.set('#profile-coins', smartFormattedBalance);
    }
    
    // تحديث فقط إذا لم يكن مخفياً
    if (!isBalanceHidden) {
      const elements = document.querySelectorAll('[class*="balance"], [id*="balance"], [class*="points"], [id*="points"]');
      elements.forEach(element => {
        if (element.textContent.match(/^\d+\.\d*$/) || element.textContent.includes('Points')) {
          element.textContent = smartFormattedBalance;
        }
      });
    }
  });

  // Function to initialize loading screen - REMOVED
  function initializeLoadingScreen() {
    // إزالة شاشة التحميل فوراً
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.remove();
    }
    
    // Auth state is now handled by CSS classes set in head script
    // Just ensure the classes are correct
    const savedUser = loadUserSession();
    
    if (savedUser && savedUser.email) {
      document.documentElement.classList.remove('user-not-logged-in');
      document.documentElement.classList.add('user-logged-in');
    } else {
      document.documentElement.classList.remove('user-logged-in');
      document.documentElement.classList.add('user-not-logged-in');
    }
    
    document.body.classList.add('loaded');
    
    // Safety fallback: if app-ready is not set after 500ms, force it
    // This prevents the page from being stuck hidden if something goes wrong
    setTimeout(function() {
      if (!document.body.classList.contains('app-ready')) {
        console.log('Fallback: forcing app-ready after timeout');
        document.body.classList.add('app-ready');
        document.documentElement.classList.add('app-ready');
      }
    }, 500);
  }

  // DOM Elements
  const loginContainer = document.getElementById('login-container');
  const appContainer = document.getElementById('app-container');
  const googleSigninButton = document.getElementById('google-signin-button');

  // Set up language selector
  const languageSelect = document.getElementById('language-select');
  const profileLanguageSelect = document.getElementById('profile-language');

  // Sync profile language selector with main language system
  if (profileLanguageSelect) {
    profileLanguageSelect.addEventListener('change', function() {
      const selectedLang = this.value;
      selectLanguage(selectedLang);
    });
  }

  // Sync login language selector
  if (languageSelect) {
    languageSelect.addEventListener('change', function() {
      const selectedLang = this.value;
      selectLanguage(selectedLang);
    });
  }

  // Dashboard language change handler - EXACT COPY from profile functionality
  document.addEventListener('click', function(e) {
    if (e.target.closest('.language-option')) {
      e.preventDefault();
      e.stopPropagation();
      
      // Get the language code from the onclick attribute
      const langCode = e.target.closest('.language-option').onclick.toString().match(/'([^']+)'/);
      if (langCode && langCode[1]) {
        
        // EXACT COPY FROM PROFILE - Apply immediately
        const newLanguage = langCode[1];
        console.log('Dashboard language changed to:', newLanguage);

        // Set the language in translator
        translator.setLanguage(newLanguage);
        localStorage.setItem('preferredLanguage', newLanguage);

        // Update dashboard language code display immediately
        const dashboardLanguageCode = document.getElementById('dashboard-language-code');
        if (dashboardLanguageCode) {
          dashboardLanguageCode.textContent = newLanguage.toUpperCase();
        }

        // Sync with login screen language selector if it exists
        const languageSelect = document.getElementById('language-select');
        if (languageSelect) {
          languageSelect.value = newLanguage;
        }

        // Sync with profile language selector
        const profileLanguageSelect = document.getElementById('profile-language');
        if (profileLanguageSelect) {
          profileLanguageSelect.value = newLanguage;
        }

        // Apply Arabic CSS if needed - EXACT COPY FROM PROFILE
        if (newLanguage === "ar") {
          document.body.classList.add("arabic");
          localStorage.setItem("arabic-css-enabled", "true");
          document.documentElement.setAttribute('lang', 'ar');
        } else {
          document.body.classList.remove("arabic");
          localStorage.setItem("arabic-css-enabled", "false");
          document.documentElement.setAttribute('lang', newLanguage);
        }

        // Close any open language modal
        const modal = document.getElementById('languageModal');
        if (modal) {
          modal.style.display = 'none';
        }

        // Update UI with new language - EXACT COPY FROM PROFILE
        updateUILanguage();
        
        // Update dynamic translations with data attributes
        updateDynamicTranslations();

        // Force update profile page with multiple attempts - EXACT COPY FROM PROFILE
        updateSpecificUIElements();

        setTimeout(function() {
          updateSpecificUIElements();

          // Direct translation of all profile labels to ensure coverage
          const allLabels = document.querySelectorAll('#profile-page .profile-label, #profile-page .profile-labels');
          allLabels.forEach(label => {
            if (label.textContent) {
              const originalText = label.textContent.trim();
              const translatedText = translator.translate(originalText);
              if (translatedText && translatedText !== originalText) {
                label.textContent = translatedText;
              }
            }
          });

          // Also translate specific known labels directly
          translateProfileLabel('Balance:', 'Balance:');
          translateProfileLabel('Referral Code:', 'Referral Code:');
          translateProfileLabel('Language:', 'Language:');
          translateProfileLabel('Night Mode:', 'Night Mode:');
          translateProfileLabel('Theme Brightness:', 'Theme Brightness:');

          // Translate select options
          translateSelectOptions('night-mode-select');
        }, 300);

        // Ensure all sidebar and mobile menu elements are updated - EXACT COPY FROM PROFILE
        const navElements = document.querySelectorAll('.nav-link, .mobile-nav-item, .more-menu-item');
        navElements.forEach(element => {
          // Handle sidebar items
          if (element.classList.contains('nav-link')) {
            const icon = element.querySelector('i');
            const pageName = element.getAttribute('data-page');
            if (pageName) {
              const translatedText = translator.translate(pageName);
              if (translatedText && icon) {
                // Secure: Clear and rebuild with safe DOM methods
                element.textContent = '';
                element.appendChild(icon.cloneNode(true));
                element.appendChild(document.createTextNode(' ' + translatedText));
              }
            }
          }
          // Handle mobile menu items
          else if (element.classList.contains('mobile-nav-item')) {
            const icon = element.querySelector('i');
            const textSpan = element.querySelector('span');
            const pageName = element.getAttribute('data-page');
            if (textSpan && pageName) {
              const translatedText = translator.translate(pageName);
              if (translatedText) {
                textSpan.textContent = translatedText;
              }
            }
          }
          // Handle more menu items if they exist
          else if (element.classList.contains('more-menu-item')) {
            const icon = element.querySelector('i');
            const textSpan = element.querySelector('span');
            if (textSpan && textSpan.textContent) {
              const originalText = textSpan.textContent.trim().toLowerCase();
              const translatedText = translator.translate(originalText);
              if (translatedText) {
                textSpan.textContent = translatedText;
              }
            }
          }
        });

        // Re-translate network elements if on network page immediately
        if (document.getElementById('community-page') && document.getElementById('community-page').style.display !== 'none') {
          setTimeout(translateNetworkElements, 50);
        }
        
        console.log('Dashboard language changed immediately to:', newLanguage, '- using exact profile functionality');
      }
    }
  });

  // Check if user has viewed privacy policy from login page
  const privacyViewed = localStorage.getItem('privacyPolicyViewed');
  if (privacyViewed) {
    console.log('User has already viewed privacy policy from login page');
  }

  // Initialize with saved language preference or use preloaded language from head script
  const savedLanguage = window.__preloadedLang || localStorage.getItem('preferredLanguage') || 'en';
  translator.setLanguage(savedLanguage);

  // Store the language in document for immediate access during page load
  document.documentElement.setAttribute('data-language', savedLanguage);
  document.documentElement.setAttribute('lang', savedLanguage);

  // Apply Arabic CSS if Arabic was selected
  if (savedLanguage === "ar") {
    document.body.classList.add("arabic");
    localStorage.setItem("arabic-css-enabled", "true");
  }

  // Update dashboard language code display on initialization
  setTimeout(() => {
    const dashboardLanguageCode = document.getElementById('dashboard-language-code');
    if (dashboardLanguageCode) {
      dashboardLanguageCode.textContent = savedLanguage.toUpperCase();
    }
    
    // Sync all language selectors
    if (languageSelect) {
      languageSelect.value = savedLanguage;
    }
    if (profileLanguageSelect) {
      profileLanguageSelect.value = savedLanguage;
    }
  }, 500);





    // Function to translate all network page elements
function translateNetworkElements() {
  try {
  
    if (!document.querySelector('.network-title-container')) return;

    // Helper function to safely translate an element
    const safeTranslate = (element, key) => {
      if (!element || !key) return;
      try {
        const translated = translator.translate(key);
        if (translated) element.textContent = translated;
      } catch (e) {
        console.warn('Translation error for key:', key, e);
      }
    };



   
    
   
    // Translate all placeholders
    const placeholders = [
  { selector: '#private-key-input', text: 'Enter your private key' },
  { selector: '#recipient-address', text: 'Enter recipient wallet address' },
  { selector: '#wallet-address-input', text: 'Enter wallet address' },
  { selector: '#transaction-amount', text: 'Enter amount to send' }
];

    
    placeholders.forEach(item => {
      document.querySelectorAll(item.selector).forEach(el => {
        el.setAttribute('placeholder', translator.translate(item.text));
      });
    });


    
    
    // Translate transaction entries (From/To) with stronger pattern matching
    document.querySelectorAll('.transaction-addresses').forEach(el => {
      const fromElement = el.querySelector('.transaction-from');
      const toElement = el.querySelector('.transaction-to');

      if (fromElement) {
        const fromText = fromElement.textContent || '';
        // Use regular expression to match "From:" regardless of spaces
        const fromMatch = fromText.match(/(From\s*:)/i);
        if (fromMatch) {
          const translatedFrom = translator.translate('From:');
          fromElement.textContent = fromText.replace(fromMatch[0], translatedFrom);
        }
      }

      if (toElement) {
        const toText = toElement.textContent || '';
        // Use regular expression to match "To:" regardless of spaces
        const toMatch = toText.match(/(To\s*:)/i);
        if (toMatch) {
          const translatedTo = translator.translate('To:');
          toElement.textContent = toText.replace(toMatch[0], translatedTo);
        }
      }
    });


  } catch (error) {
    console.error('Error translating network elements:', error);
  }
}




   
    
    
// network page translation observer
let translateTimeout;

const bodyObserver = new MutationObserver(mutations => {
  let shouldTranslate = false;

  for (const mutation of mutations) {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      // check if the added nodes are relavant to network page 
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) { // ELEMENT_NODE
          const isRelevant = node.closest?.('#network-page, .modal, .transaction-addresses');
          if (isRelevant) {
            shouldTranslate = true;
            break;
          }
        }
      }
    }
    if (shouldTranslate) break;
  }

  // body server translation
  if (shouldTranslate) {
    clearTimeout(translateTimeout);
    translateTimeout = setTimeout(() => {
      try {
        translateNetworkElements();
      } catch (e) {
        console.error('Error in bodyObserver translate:', e);
      }
    }, 100); //  
  }
});

//  start observing the body for changes 
bodyObserver.observe(document.body, {
  childList: true,
  subtree: true
});








// Download whitepaper function (copied from point system page)
  function downloadWhitepaper() {
    try {
      // Create a simple whitepaper document
      const whitepaperContent = `
AccessRewards Technical Documentation

1. Introduction
AccessRewards is a revolutionary fitness platform designed for the future of wellness rewards.

2. Technology
- Custom Mainnet Chain
- Proof of Activity Consensus
- 15-second block time
- Low transaction fees (0.00002 Points)

3. Point System
- Total Supply: 100,000,000 Points
- Activity Benefits: 45%
- Platform Development: 25%
- Community Benefits: 15%
- Team & Advisors: 10%
- Reserve Fund: 5%

4. Activity System
Users can process once every 24 hours to collect 0.25 Points.

5. Security
Enterprise-grade security with encrypted user accounts and secure benefit processing.

For more information, visit our platform at: ${window.location.origin}
      `.trim();

      // Create and download the file
      const blob = new Blob([whitepaperContent], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'AccessRewards_Documentation.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      // Show success notification
      if (typeof showNotification === 'function') {
        showNotification(translator.translate('Whitepaper downloaded successfully!'), 'success');
      }
    } catch (error) {
      console.error('Error downloading whitepaper:', error);
      if (typeof showNotification === 'function') {
        showNotification(translator.translate('Error downloading whitepaper'), 'error');
      }
    }
  }

  // Navigation function for dashboard action buttons
  function navigateToPage(pageName) {
    // ✅ تحديث الـ active state في الشريط السفلي أولاً
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
    mobileNavItems.forEach(item => {
      if (item.getAttribute('data-page') === pageName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
    
    // إخفاء قائمة more إذا كانت مفتوحة
    const moreMenu = document.getElementById('more-menu');
    if (moreMenu) {
      moreMenu.style.display = 'none';
    }
    
    // عرض الصفحة
    showPage(pageName);
    
    console.log('✅ navigateToPage:', pageName);
  }

  // Make navigation function globally available
  window.navigateToPage = navigateToPage;

  // Delete Account Modal Functions
  window.openDeleteAccountModal = function() {
    document.getElementById('deleteAccountModal').style.display = 'block';
    document.getElementById('deleteReasonSelect').value = '';
    document.getElementById('otherReasonContainer').style.display = 'none';
    document.getElementById('otherReasonText').value = '';
    
    // Close profile dropdown
    const dropdown = document.getElementById('profile-dropdown-menu');
    if (dropdown) dropdown.classList.remove('show');
  };

  window.closeDeleteAccountModal = function() {
    document.getElementById('deleteAccountModal').style.display = 'none';
  };

  window.closeDeleteAccountModalOnOutsideClick = function(event) {
    if (event.target.id === 'deleteAccountModal') {
      closeDeleteAccountModal();
    }
  };

  window.closeDeleteWarningModal = function() {
    document.getElementById('deleteWarningModal').style.display = 'none';
  };

  window.closeDeleteWarningModalOnOutsideClick = function(event) {
    if (event.target.id === 'deleteWarningModal') {
      closeDeleteWarningModal();
    }
  };

  window.closeFinalConfirmation = function() {
    document.getElementById('deleteFinalModal').style.display = 'none';
  };

  window.closeFinalConfirmationModalOnOutsideClick = function(event) {
    if (event.target.id === 'deleteFinalModal') {
      closeFinalConfirmation();
    }
  };

  window.showDeleteWarning = function() {
    const reason = document.getElementById('deleteReasonSelect').value;
    if (!reason) {
      showAccountDeletedModal(translator.translate('Please select a reason'), true);
      return;
    }

    document.getElementById('deleteAccountModal').style.display = 'none';
    document.getElementById('deleteWarningModal').style.display = 'block';
  };

  window.showFinalConfirmation = function() {
    document.getElementById('deleteWarningModal').style.display = 'none';
    document.getElementById('deleteFinalModal').style.display = 'block';
  };

  window.confirmAccountDeletion = async function() {
    if (!currentUser || !currentUser.email) {
      showAccountDeletedModal(translator.translate('Error: User not found'), true);
      return;
    }

    const reason = document.getElementById('deleteReasonSelect').value;
    const feedback = document.getElementById('otherReasonText').value;

    // Close all modals immediately
    document.getElementById('deleteFinalModal').style.display = 'none';
    document.getElementById('deleteWarningModal').style.display = 'none';
    document.getElementById('deleteAccountModal').style.display = 'none';

    // Save user data before clearing
    const userEmail = currentUser?.email;
    const userId = currentUser?.id;

    console.log('🗑️ Starting account deletion process for:', userEmail);

    try {
      // إرسال طلب الحذف للسيرفر وانتظار النتيجة
      fetch('/api/account/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: userEmail,
          userId: userId,
          reason: reason,
          feedback: feedback
        })
      }).then(async response => {
        const result = await response.json();
        
        if (result.success) {
          console.log('✅ Account deleted successfully from server');
          
          // الآن فقط نقوم بتنظيف البيانات المحلية
          localStorage.clear();
          sessionStorage.clear();
          
          // Clear cookies
          document.cookie.split(";").forEach(function(c) { 
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
          });
          
          // Sign out from Google
          if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
            google.accounts.id.disableAutoSelect();
          }
          
          // Reset currentUser
          currentUser = null;
          window.currentUser = null;
          
          // Show success message
          if (typeof showNotification === 'function') {
            showNotification(translator.translate('Account deleted successfully'), 'success');
          }
          
          // إعادة التحميل بعد التأكد من حذف الحساب
          setTimeout(() => {
            window.location.reload();
          }, 1000);
          
        } else {
          console.error('❌ Failed to delete account:', result.error);
          if (typeof showNotification === 'function') {
            showNotification(translator.translate('Error deleting account: ') + result.error, 'error');
          }
        }
      }).catch(error => {
        console.error('❌ Error deleting account:', error);
        if (typeof showNotification === 'function') {
          showNotification(translator.translate('Error deleting account. Please try again.'), 'error');
        }
      });
      
    } catch (error) {
      console.error('Error during account deletion:', error);
      if (typeof showNotification === 'function') {
        showNotification(translator.translate('Error deleting account. Please try again.'), 'error');
      }
    }
  };

  // Custom modal for account deletion confirmation
  function showAccountDeletedModal(message, isError = false) {
    const isDarkTheme = document.body.classList.contains('dark-theme');
    
    // Create modal overlay
    const modalOverlay = document.createElement('div');
    modalOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.6);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 99999;
      backdrop-filter: blur(5px);
    `;

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: ${isDarkTheme ? '#2a2a2a' : '#ffffff'};
      padding: 35px 30px;
      border-radius: 12px;
      max-width: 450px;
      width: 90%;
      text-align: center;
      color: ${isDarkTheme ? '#f5f5f5' : '#333333'};
      font-family: Arial, sans-serif;
      box-shadow: 0 10px 40px rgba(0, 0, 0, ${isDarkTheme ? '0.5' : '0.3'});
      border: 1px solid ${isDarkTheme ? '#444' : '#e0e0e0'};
    `;

    // Icon
    const icon = document.createElement('div');
    icon.style.cssText = `
      font-size: 50px;
      margin-bottom: 20px;
    `;
    icon.textContent = isError ? '⚠️' : '😔';

    // Message
    const messageText = document.createElement('p');
    messageText.textContent = message;
    messageText.style.cssText = `
      font-size: 16px;
      line-height: 1.6;
      margin: 0 0 25px 0;
      color: ${isDarkTheme ? '#e0e0e0' : '#333333'};
    `;

    // OK button
    const okButton = document.createElement('button');
    okButton.textContent = translator.translate('OK');
    okButton.style.cssText = `
      background: ${isDarkTheme ? '#555' : '#6c757d'};
      color: white;
      border: none;
      padding: 12px 35px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 15px;
      font-weight: 500;
      transition: all 0.3s ease;
    `;

    okButton.addEventListener('mouseenter', () => {
      okButton.style.background = isDarkTheme ? '#666' : '#5a6268';
      okButton.style.transform = 'scale(1.05)';
    });

    okButton.addEventListener('mouseleave', () => {
      okButton.style.background = isDarkTheme ? '#555' : '#6c757d';
      okButton.style.transform = 'scale(1)';
    });

    okButton.addEventListener('click', () => {
      modalOverlay.remove();
    });

    // Assemble modal
    modalContent.appendChild(icon);
    modalContent.appendChild(messageText);
    modalContent.appendChild(okButton);
    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);

    // Auto-focus OK button
    setTimeout(() => {
      okButton.focus();
    }, 100);

    // Allow ESC key to close
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        modalOverlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  // Show "other reason" textarea when "Other" is selected
  document.addEventListener('change', function(e) {
    if (e.target.id === 'deleteReasonSelect') {
      const otherContainer = document.getElementById('otherReasonContainer');
      if (e.target.value === 'other') {
        otherContainer.style.display = 'block';
      } else {
        otherContainer.style.display = 'none';
      }
    }
  });

  // Language Modal Functions - Integrated with Dashboard
  function showLanguageModal() {
    const modal = document.getElementById('languageModal');
    if (modal) {
      modal.style.display = 'block';
      // Highlight current language
      const currentLang = translator.getCurrentLanguage();
      const options = modal.querySelectorAll('.language-option');
      options.forEach(option => {
        option.classList.remove('selected');
        if (option.onclick.toString().includes(`'${currentLang}'`)) {
          option.classList.add('selected');
        }
      });
    }
  }

  // Save language preference to database for push notification localization
  async function saveLanguageToDatabase(langCode) {
    if (!currentUser || !currentUser.id) {
      console.log('Cannot save language to DB: No user logged in');
      return;
    }
    
    try {
      const response = await fetch('/api/users/update-profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: currentUser.id,
          language: langCode
        })
      });
      
      if (response.ok) {
        console.log(`Language ${langCode} saved to database for user ${currentUser.id}`);
      } else {
        console.warn('Failed to save language to database');
      }
    } catch (error) {
      console.error('Error saving language to database:', error);
    }
  }

  function closeLanguageModal() {
    const modal = document.getElementById('languageModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  function selectLanguage(langCode) {
    console.log('Language selected:', langCode);
    
    // EXACT COPY FROM PROFILE - Apply language change immediately
    translator.setLanguage(langCode);
    
    // Save preference immediately
    localStorage.setItem('preferredLanguage', langCode);
    
    // Save language to database for push notifications localization
    if (currentUser && currentUser.id) {
      saveLanguageToDatabase(langCode);
    }
    
    // Update dashboard language code display immediately
    const dashboardLanguageCode = document.getElementById('dashboard-language-code');
    if (dashboardLanguageCode) {
      dashboardLanguageCode.textContent = langCode.toUpperCase();
    }
    
    // Sync with profile language selector immediately
    const profileLanguageSelect = document.getElementById('profile-language');
    if (profileLanguageSelect) {
      profileLanguageSelect.value = langCode;
    }
    
    // Sync with login language selector immediately
    const languageSelect = document.getElementById('language-select');
    if (languageSelect) {
      languageSelect.value = langCode;
    }
    
    // Apply Arabic CSS immediately - EXACT COPY FROM PROFILE
    if (langCode === 'ar') {
      document.body.classList.add('arabic');
      localStorage.setItem('arabic-css-enabled', 'true');
    } else {
      document.body.classList.remove('arabic');
      localStorage.removeItem('arabic-css-enabled');
    }
    
    // Close modal immediately
    closeLanguageModal();
    
    
    
    // Re-translate network elements if on network page immediately
    if (document.getElementById('community-page') && document.getElementById('community-page').style.display !== 'none') {
      // Network page elements will be updated automatically
    }
    
    // Force update of any dynamic content - EXACT COPY FROM PROFILE
    setTimeout(() => {
      // Update any remaining elements that might not have been caught
      const elementsWithDataTranslate = document.querySelectorAll('[data-translate]');
      elementsWithDataTranslate.forEach(element => {
        const key = element.getAttribute('data-translate');
        if (key && translator.translate) {
          element.textContent = translator.translate(key);
        }
      });
      
      // Additional update for dashboard specific elements
      const dashboardElements = document.querySelectorAll('#dashboard-page [data-translate]');
      dashboardElements.forEach(element => {
        const key = element.getAttribute('data-translate');
        if (key && translator.translate) {
          element.textContent = translator.translate(key);
        }
      });
      
      // Update member since date with new language
      if (typeof window.updateProfileMemberSinceDate === 'function') {
        window.updateProfileMemberSinceDate();
      }
    }, 100);
    
    console.log('Language changed immediately to:', langCode, '- using exact profile functionality');
  }

  // Network Dropdown Functions
  function toggleNetworkDropdown() {
    const dropdown = document.getElementById('networkDropdown');
    const selector = document.querySelector('.network-selector');
    
    if (dropdown && selector) {
      const isVisible = dropdown.classList.contains('show');
      
      if (isVisible) {
        dropdown.classList.remove('show');
        selector.classList.remove('active');
      } else {
        dropdown.classList.add('show');
        selector.classList.add('active');
        
        // Load wallet address if not already loaded
        loadDashboardWalletAddress();
      }
    }
  }

  // Load wallet address for dashboard display - INSTANT from currentUser
  async function loadDashboardWalletAddress() {
    const addressElement = document.getElementById('dashboard-account-address');
    if (!addressElement || !currentUser || !currentUser.id) {
      return;
    }

    try {
      // ⚡ INSTANT DISPLAY from currentUser.wallet_address
      let walletAddress = currentUser.wallet_address;

      // If not in currentUser, fetch from server in background
      if (!walletAddress) {
        try {
          const response = await fetch(`/api/user/wallet-key/${currentUser.id}`);
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.walletAddress) {
              walletAddress = data.walletAddress;
              // Save to currentUser for future use
              currentUser.wallet_address = walletAddress;
              saveUserSession(currentUser);
            }
          }
        } catch (serverError) {
          console.log('Server wallet request failed');
        }
      }

      if (walletAddress && walletAddress.length > 10) {
        // Display shortened address
        const shortAddress = `${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}`;
        addressElement.textContent = shortAddress;
        addressElement.setAttribute('data-full-address', walletAddress);
        console.log('✅ Dashboard wallet displayed:', shortAddress);
      } else {
        addressElement.textContent = 'Not available';
      }
    } catch (error) {
      console.error('Error loading dashboard wallet address:', error);
      addressElement.textContent = 'Error';
    }
  }

  // Copy wallet address function - enhanced for dashboard
  function copyDashboardAccountAddress() {
    const addressElement = document.getElementById('dashboard-account-address');
    if (!addressElement) return;

    let fullAddress = addressElement.getAttribute('data-full-address');
    
    // If no data attribute, try to get from network page or current user
    if (!fullAddress) {
      const networkWalletElement = document.getElementById('user-account-address');
      if (networkWalletElement && networkWalletElement.textContent && 
          networkWalletElement.textContent !== 'Generating...' && 
          networkWalletElement.textContent !== 'Error generating wallet') {
        fullAddress = networkWalletElement.textContent;
      } else if (currentUser && currentUser.wallet && currentUser.wallet.publicAddress) {
        fullAddress = currentUser.wallet.publicAddress;
      }
    }

    if (fullAddress && fullAddress.length > 10) {
      navigator.clipboard.writeText(fullAddress).then(() => {
        // Show success feedback on copy button
        const copyBtn = document.querySelector('.account-copy-btn');
        if (copyBtn) {
          const icon = copyBtn.querySelector('i');
          if (icon) {
            // Clear any existing timeout
            if (copyBtn._resetTimeout) {
              clearTimeout(copyBtn._resetTimeout);
            }
            
            icon.className = 'fas fa-check';
            copyBtn.style.color = '#10b981';
            copyBtn.style.transform = 'scale(1.1)';
            
            copyBtn._resetTimeout = setTimeout(() => {
              icon.className = 'fas fa-copy';
              copyBtn.style.color = '';
              copyBtn.style.transform = '';
              copyBtn._resetTimeout = null;
            }, 2000);
          }
        }

        // Show notification
        if (typeof showNotification === 'function') {
          showNotification(translator.translate('Wallet address copied!'), 'success');
        } else {
          // Fallback visual feedback
          const addressDisplay = document.getElementById('dashboard-account-address');
          if (addressDisplay) {
            const originalText = addressDisplay.textContent;
            addressDisplay.textContent = 'Copied!';
            addressDisplay.style.color = '#10b981';


  // ULTRA-ENHANCED Invite Modal - SUPREME preservation system
  function showUltraEnhancedInviteModal(inviteLink, referralCode, source = 'unknown') {
    console.log(`Creating ULTRA-ENHANCED invite modal from source: ${source}`);
    
    // Check if dark theme is active
    const isDarkTheme = document.body.classList.contains('dark-theme');

    // Create modal elements with ENHANCED styling
    const modalOverlay = document.createElement('div');
    modalOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.7);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 99999;
      backdrop-filter: blur(5px);
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: ${isDarkTheme ? 'var(--card-background, #2a2a2a)' : 'white'};
      padding: 25px;
      border-radius: 12px;
      max-width: 550px;
      width: 95%;
      text-align: center;
      color: ${isDarkTheme ? 'var(--text-color, #ffffff)' : '#333'};
      font-family: Arial, sans-serif;
      position: relative;
      border: ${isDarkTheme ? '2px solid var(--border-color, rgba(255, 255, 255, 0.2))' : '2px solid #e0e0e0'};
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      animation: modalSlideUp 0.3s ease-out;
    `;

    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes modalSlideUp {
        from {
          opacity: 0;
          transform: translateY(50px) scale(0.9);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
    `;
    document.head.appendChild(style);

    const title = document.createElement('h3');
    title.textContent = `${translator.translate('Share Invite Link')} (${source.toUpperCase()})`;
    title.style.cssText = `
      margin-bottom: 20px;
      color: ${isDarkTheme ? 'var(--text-color, #ffffff)' : '#333'};
      font-size: 20px;
      font-weight: bold;
    `;

    const instruction = document.createElement('p');
    instruction.textContent = translator.translate('Copy this link and share it with friends:');
    instruction.style.cssText = `
      margin: 10px 0;
      color: ${isDarkTheme ? 'var(--text-secondary, #a0aec0)' : '#666'};
      font-size: 14px;
    `;

    const linkInput = document.createElement('input');
    linkInput.value = inviteLink;
    linkInput.readOnly = true;
    linkInput.style.cssText = `
      width: 100%;
      padding: 12px;
      border: 2px solid ${isDarkTheme ? 'var(--border-color, #555)' : '#ddd'};
      border-radius: 6px;
      margin: 15px 0;
      font-size: 14px;
      box-sizing: border-box;
      background: ${isDarkTheme ? 'var(--card-background, #333)' : '#f9f9f9'};
      color: ${isDarkTheme ? 'var(--text-color, #ffffff)' : '#333'};
      text-align: center;
      font-family: monospace;
    `;

    const codeDisplay = document.createElement('div');
    codeDisplay.style.cssText = `
      background: ${isDarkTheme ? 'rgba(16, 185, 129, 0.1)' : 'rgba(16, 185, 129, 0.05)'};
      border: 1px solid #10b981;
      border-radius: 6px;
      padding: 10px;
      margin: 10px 0;
      font-family: monospace;
      font-weight: bold;
      color: #10b981;
    `;
    // Secure: Use textContent for user data (XSS protection)
    codeDisplay.textContent = translator.translate('Your Referral Code:') + ' ';
    const codeSpan = document.createElement('span');
    codeSpan.style.fontSize = '16px';
    codeSpan.textContent = referralCode;
    codeDisplay.appendChild(codeSpan);

    const copyButton = document.createElement('button');
    copyButton.textContent = translator.translate('Copy Link');
    copyButton.style.cssText = `
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
      border: none;
      padding: 12px 25px;
      border-radius: 6px;
      cursor: pointer;
      margin: 10px 5px;
      font-size: 15px;
      font-weight: bold;
      transition: all 0.3s ease;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
    `;

    // Enhanced close button
    const closeIcon = document.createElement('button');
    closeIcon.innerHTML = '&times;';
    closeIcon.style.cssText = `
      position: absolute;
      top: 10px;
      right: 15px;
      background: none;
      border: none;
      font-size: 32px;
      cursor: pointer;
      color: ${isDarkTheme ? 'var(--text-color, #a0aec0)' : '#666'};
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      transition: all 0.3s ease;
      font-weight: bold;
    `;

    // Enhanced close button hover effects
    closeIcon.addEventListener('mouseenter', () => {
      closeIcon.style.background = isDarkTheme ? 'rgba(255, 255, 255, 0.1)' : '#f0f0f0';
      closeIcon.style.color = isDarkTheme ? 'var(--text-color, #ffffff)' : '#333';
      closeIcon.style.transform = 'scale(1.1)';
    });

    closeIcon.addEventListener('mouseleave', () => {
      closeIcon.style.background = 'none';
      closeIcon.style.color = isDarkTheme ? 'var(--text-color, #a0aec0)' : '#666';
      closeIcon.style.transform = 'scale(1)';
    });

    closeIcon.addEventListener('click', () => {
      modalOverlay.remove();
      style.remove();
    });

    // ULTRA-ENHANCED copy button functionality
    copyButton.addEventListener('click', async () => {
      try {
        // MAXIMUM input field preparation BEFORE copy attempt
        const allInputSelectors = [
          '#referral-code', '#invite-code', '[name="referral"]', '[name="invite"]',
          '[placeholder*="referral"]', '[placeholder*="invite"]', '.referral-input',
          '.invite-input', '#signup-referral', '#registration-referral',
          'input[type="text"]', '[data-referral]', '[data-invite]'
        ];
        
        allInputSelectors.forEach(selector => {
          const inputs = document.querySelectorAll(selector);
          inputs.forEach(input => {
            // ULTRA-REALISTIC pre-filling
            input.value = referralCode;
            input.setAttribute('data-manually-filled', 'true');
            input.setAttribute('data-user-typed', 'true');
            input.setAttribute('data-hand-entered', 'true');
            input.setAttribute('data-source', `profile_modal_${source}`);
            input.setAttribute('data-preservation-level', 'supreme');
            input.setAttribute('data-modal-prefilled', 'true');
            
            // COMPLETE realistic typing simulation
            input.focus();
            
            // Clear and retype realistically
            setTimeout(() => {
              input.value = '';
              let realisticValue = '';
              for (let i = 0; i < referralCode.length; i++) {
                setTimeout(() => {
                  realisticValue += referralCode[i];
                  input.value = realisticValue;
                  
                  // Simulate human typing events
                  const char = referralCode[i];
                  const keyEvents = ['keydown', 'keypress', 'input', 'keyup'];
                  keyEvents.forEach(eventType => {
                    const event = new KeyboardEvent(eventType, {
                      key: char,
                      code: `Key${char.toUpperCase()}`,
                      bubbles: true,
                      cancelable: true
                    });
                    input.dispatchEvent(event);
                  });
                }, i * 95); // Realistic human typing rhythm
              }
            }, 100);
          });
        });

        // Select the text first for visual feedback
        linkInput.select();
        linkInput.setSelectionRange(0, 99999);

        // Try modern clipboard API with ENHANCED handling
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(inviteLink);
        } else {
          // Enhanced fallback to execCommand
          const success = document.execCommand('copy');
          if (!success) throw new Error('ExecCommand copy failed');
        }

        // ENHANCED success feedback - Secure DOM manipulation
        copyButton.textContent = '';
        const checkIcon = document.createElement('i');
        checkIcon.className = 'fas fa-check-circle';
        copyButton.appendChild(checkIcon);
        copyButton.appendChild(document.createTextNode(' ' + translator.translate('Copied!')));
        copyButton.style.background = 'linear-gradient(135deg, #059669, #047857)';
        copyButton.style.transform = 'scale(1.05)';

        if (typeof showNotification === 'function') {
          showNotification(
            `${translator.translate('ULTRA-ENHANCED: Invite link copied! Code preserved from')} ${source.toUpperCase()}: ${referralCode}`,
            'success'
          );
        }

        // Enhanced auto-close with fade effect
        setTimeout(() => {
          modalOverlay.style.transition = 'opacity 0.3s ease';
          modalOverlay.style.opacity = '0';
          setTimeout(() => {
            modalOverlay.remove();
            style.remove();
          }, 300);
        }, 1500);

      } catch (copyError) {
        console.error('ULTRA-ENHANCED modal copy failed:', copyError);

        // ENHANCED manual copy instructions with code display
        const manualInstructions = `
${translator.translate('Please copy this link manually:')}

${inviteLink}

${translator.translate('Your Referral Code:')} ${referralCode}

${translator.translate('This code has been preserved with ULTRA-ENHANCED system from')} ${source.toUpperCase()}
        `;
        
        alert(manualInstructions);
      }
    });

    // ENHANCED copy button hover effects
    copyButton.addEventListener('mouseenter', () => {
      copyButton.style.transform = 'scale(1.05)';
      copyButton.style.background = 'linear-gradient(135deg, #059669, #047857)';
    });

    copyButton.addEventListener('mouseleave', () => {
      copyButton.style.transform = 'scale(1)';
      copyButton.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    });

    // Enhanced close on overlay click
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        modalOverlay.style.transition = 'opacity 0.3s ease';
        modalOverlay.style.opacity = '0';
        setTimeout(() => {
          modalOverlay.remove();
          style.remove();
        }, 300);
      }
    });

    // Enhanced ESC key handling
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        modalOverlay.remove();
        style.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Assemble modal with enhanced structure
    modalContent.appendChild(closeIcon);
    modalContent.appendChild(title);
    modalContent.appendChild(instruction);
    modalContent.appendChild(linkInput);
    modalContent.appendChild(codeDisplay);
    modalContent.appendChild(copyButton);
    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);

    // Enhanced focus and selection
    setTimeout(() => {
      linkInput.focus();
      linkInput.select();
      linkInput.setSelectionRange(0, 99999);
    }, 100);

    console.log(`ULTRA-ENHANCED invite modal displayed with SUPREME preservation from ${source.toUpperCase()}`);
  }

  // ULTRA-ENHANCED Recovery System - Stronger than Dashboard
  class UltraEnhancedRecoverySystem {
    constructor() {
      this.recoveryAttempts = 0;
      this.maxRecoveryAttempts = 10;
      this.init();
    }

    init() {
      // Continuous recovery monitoring - Stronger than Dashboard
      this.startContinuousRecovery();
      this.setupPageVisibilityRecovery();
      this.setupStorageEventRecovery();
      this.setupPeriodicRecovery();
    }

    startContinuousRecovery() {
      // Monitor for any referral input and continuously try to fill it
      const recoveryInterval = setInterval(() => {
        if (this.recoveryAttempts >= this.maxRecoveryAttempts) {
          clearInterval(recoveryInterval);
          return;
        }

        // Don't recover for logged-in users to prevent persistence
        const savedUser = loadUserSession();
        if (savedUser && savedUser.email) {
          this.cleanupForLoggedInUser();
          clearInterval(recoveryInterval);
          return;
        }

        this.attemptUltraRecovery();
        this.recoveryAttempts++;
      }, 1000);

      // Extended recovery period
      setTimeout(() => {
        clearInterval(recoveryInterval);
      }, 60000); // 1 minute of continuous attempts
    }

    attemptUltraRecovery() {
      const referralInput = document.querySelector('#referral-code');
      if (!referralInput || referralInput.value) {
        return; // Input not found or already filled
      }

      // Try all possible recovery sources in priority order
      const recoverySources = [
        'currentInviteCode',
        'pendingReferralCode',
        'profile_invite_code',
        'referrals_page_invite_code',
        'manual_referral_code',
        'user_shared_code',
        'referrals_copy_invite_code',
        'manual_copy_referral_code',
        'user_copied_code',
        'share_referral_invite_code',
        'manual_share_referral_code',
        'user_shared_referral_code',
        'profile_page_invite_code',
        'manual_profile_referral_code',
        'user_profile_shared_code',
        'profile_function_code'
      ];

      for (const source of recoverySources) {
        const code = localStorage.getItem(source) || sessionStorage.getItem(source);
        if (code && code.length > 0) {
          this.performUltraEnhancedFill(referralInput, code, source);
          console.log(`ULTRA-RECOVERY: Code recovered from ${source}: ${code}`);
          return;
        }
      }

      // Try backup recovery systems
      this.attemptBackupRecovery(referralInput);
    }

    attemptBackupRecovery(referralInput) {
      const backupSources = [
        'inviteCodeBackup',
        'referrals_invite_backup',
        'ultra_backup_referrals',
        'referrals_copy_backup',
        'ultra_copy_backup',
        'quad_backup_copy',
        'referrals_share_backup',
        'ultra_share_backup',
        'penta_backup_share',
        'profile_invite_backup',
        'ultra_profile_backup',
        'hexa_backup_profile',
        'supreme_recovery_backup',
        'maximum_profile_backup'
      ];

      for (const backupSource of backupSources) {
        try {
          const backupData = localStorage.getItem(backupSource);
          if (backupData) {
            const backup = JSON.parse(backupData);
            const isRecent = (Date.now() - backup.timestamp) < 600000; // 10 minutes
            const wasForNewUser = backup.userLoggedIn === false || !backup.userLoggedIn;
            
            if (isRecent && backup.code && (!backup.userLoggedIn || wasForNewUser)) {
              this.performUltraEnhancedFill(referralInput, backup.code, backupSource);
              console.log(`ULTRA-BACKUP-RECOVERY: Code recovered from ${backupSource}: ${backup.code}`);
              localStorage.removeItem(backupSource);
              return;
            }
          }
        } catch (e) {
          console.error('Error parsing backup from', backupSource, ':', e);
          localStorage.removeItem(backupSource);
        }
      }
    }

    performUltraEnhancedFill(input, code, source) {
      if (!input || input.value) return;

      // SUPREME manual typing simulation - Strongest possible
      input.value = code;
      input.focus();

      // Mark as supremely manually entered
      input.setAttribute('data-manually-filled', 'true');
      input.setAttribute('data-user-typed', 'true');
      input.setAttribute('data-hand-entered', 'true');
      input.setAttribute('data-recovery-source', source);
      input.setAttribute('data-ultra-enhanced', 'true');
      input.setAttribute('data-preservation-level', 'supreme');
      input.setAttribute('data-manual-simulation', 'complete');

      // ULTIMATE event simulation for maximum realism
      const ultimateEvents = [
        'mousedown', 'mouseup', 'click', 'focus', 'keydown', 
        'keypress', 'input', 'keyup', 'change', 'blur', 
        'paste', 'textInput', 'compositionstart', 'compositionend',
        'focusin', 'focusout', 'select'
      ];

      ultimateEvents.forEach(eventType => {
        try {
          const event = new Event(eventType, { 
            bubbles: true, 
            cancelable: true, 
            composed: true 
          });
          input.dispatchEvent(event);
        } catch (e) {}
      });

      // SUPREME visual effect for successful recovery
      input.style.transition = 'all 0.5s ease';
      input.style.borderColor = '#10b981';
      input.style.backgroundColor = isDarkTheme ? 'rgba(16, 185, 129, 0.1)' : '#ecfdf5';
      input.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.3)';

      setTimeout(() => {
        input.style.borderColor = '';
        input.style.backgroundColor = '';
        input.style.boxShadow = '';
        input.blur();
      }, 3000);

      console.log(`ULTRA-ENHANCED fill completed from ${source} with SUPREME manual typing simulation`);
    }

    setupPageVisibilityRecovery() {
      // Enhanced recovery when page becomes visible
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          setTimeout(() => this.attemptUltraRecovery(), 500);
          setTimeout(() => this.attemptUltraRecovery(), 1500);
          setTimeout(() => this.attemptUltraRecovery(), 3000);
        }
      });
    }

    setupStorageEventRecovery() {
      // Listen for storage events across tabs
      window.addEventListener('storage', (e) => {
        if (e.key && e.key.includes('invite') || e.key.includes('referral')) {
          setTimeout(() => this.attemptUltraRecovery(), 200);
        }
      });
    }

    setupPeriodicRecovery() {
      // Periodic recovery attempts with exponential backoff
      const intervals = [2000, 5000, 10000, 15000, 30000];
      intervals.forEach(interval => {
        setTimeout(() => {
          if (this.recoveryAttempts < this.maxRecoveryAttempts) {
            this.attemptUltraRecovery();
          }
        }, interval);
      });
    }

    cleanupForLoggedInUser() {
      // Clean up stored codes for logged-in users to prevent persistence
      const allKeys = [
        'pendingReferralCode', 'currentInviteCode', 'profile_invite_code',
        'referrals_page_invite_code', 'manual_referral_code', 'user_shared_code',
        'referrals_copy_invite_code', 'manual_copy_referral_code', 'user_copied_code',
        'share_referral_invite_code', 'manual_share_referral_code', 'user_shared_referral_code',
        'profile_page_invite_code', 'manual_profile_referral_code', 'user_profile_shared_code',
        'profile_function_code', 'inviteCodeBackup', 'referrals_invite_backup',
        'ultra_backup_referrals', 'referrals_copy_backup', 'ultra_copy_backup',
        'quad_backup_copy', 'referrals_share_backup', 'ultra_share_backup',
        'penta_backup_share', 'profile_invite_backup', 'ultra_profile_backup',
        'hexa_backup_profile', 'supreme_recovery_backup', 'maximum_profile_backup'
      ];

      allKeys.forEach(key => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      });

      console.log('ULTRA-ENHANCED: Cleaned up all stored invite codes for logged-in user');
    }
  }

  // Initialize ULTRA-ENHANCED recovery system
  const ultraEnhancedRecovery = new UltraEnhancedRecoverySystem();
  window.ultraEnhancedRecovery = ultraEnhancedRecovery;



            setTimeout(() => {
              addressDisplay.textContent = originalText;
              addressDisplay.style.color = '';
            }, 1500);
          }
        }

        console.log('Dashboard wallet address copied:', fullAddress);
      }).catch(err => {
        console.error('Failed to copy address:', err);
        if (typeof showNotification === 'function') {
          showNotification(translator.translate('Failed to copy address'), 'error');
        }
      });
    } else {
      console.log('No wallet address available to copy');
      if (typeof showNotification === 'function') {
        showNotification(translator.translate('Wallet address not available'), 'warning');
      }
    }
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', function(event) {
    const selector = document.querySelector('.network-selector');
    const dropdown = document.getElementById('networkDropdown');
    
    if (selector && dropdown && !selector.contains(event.target)) {
      dropdown.classList.remove('show');
      selector.classList.remove('active');
    }
  });

  // Make functions globally available
  window.showLanguageModal = showLanguageModal;
  window.closeLanguageModal = closeLanguageModal;
  window.selectLanguage = selectLanguage;
  window.toggleNetworkDropdown = toggleNetworkDropdown;
  window.copyDashboardAccountAddress = copyDashboardAccountAddress;
  

  // Invite Modal Functions - ط§ط³طھط®ط¯ط§ظ… modal Dashboard ط§ظ„طµط­ظٹط­
  window.showInviteModal = function() {
    if (!currentUser || !currentUser.referral_code) {
      console.error('No user or referral code available');
      if (typeof showNotification === 'function') {
        showNotification('Referral code not found. Please make sure you are logged in.', 'error');
      }
      return;
    }

    const modal = document.getElementById('invite-modal-overlay');
    const baseUrl = window.location.origin;
    const referralCode = currentUser.referral_code;
    const inviteLink = `${baseUrl}?invite=${referralCode}`;

    // Update modal content ط¨ط§ط³طھط®ط¯ط§ظ… IDs ط§ظ„طµط­ظٹط­ط© ظ…ظ† Dashboard
    document.getElementById('invite-link-input').value = inviteLink;
    document.getElementById('invite-referral-code').textContent = referralCode;

    // Show modal - ط§ط³طھط®ط¯ط§ظ… bottom sheet style
    modal.style.display = 'flex';
  };

  window.copyInviteLink = async function() {
    const inviteLink = document.getElementById('invite-link-input').value;

    try {
      // Try native sharing on mobile first
      if (navigator.share && /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        await navigator.share({
          title: 'Join AccessoireDigital',
          text: 'Join me on AccessoireDigital and start processing digital assets!',
          url: inviteLink
        });
        console.log('Link shared successfully');
        return;
      }

      // Fallback to clipboard
      await navigator.clipboard.writeText(inviteLink);

      // Show success feedback ط¨ط§ط³طھط®ط¯ط§ظ… ظƒظ„ط§ط³ Dashboard ط§ظ„طµط­ظٹط­
      const copyBtn = document.querySelector('.dashboard-copy-invite-btn, .copy-invite-btn');
      if (copyBtn) {
        // Store original content safely
        const originalContent = Array.from(copyBtn.childNodes).map(node => node.cloneNode(true));

        // Secure: Update button with safe DOM methods
        copyBtn.textContent = '';
        const checkIcon = document.createElement('i');
        checkIcon.className = 'fas fa-check';
        const textSpan = document.createElement('span');
        textSpan.textContent = 'Copied';
        copyBtn.appendChild(checkIcon);
        copyBtn.appendChild(document.createTextNode(' '));
        copyBtn.appendChild(textSpan);
        copyBtn.style.background = '#4CAF50';

        setTimeout(() => {
          copyBtn.textContent = '';
          originalContent.forEach(node => copyBtn.appendChild(node));
          copyBtn.style.background = '';
        }, 2000);
      }

      // Show notification
      if (typeof showNotification === 'function') {
        showNotification('Invite link copied successfully!', 'success');
      }

    } catch (error) {
      console.error('Error copying/sharing link:', error);

      // Alternative copy method
      const textArea = document.createElement('textarea');
      textArea.value = inviteLink;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);

      // Show success message
      const copyBtn = document.querySelector('.dashboard-copy-invite-btn, .copy-invite-btn');
      if (copyBtn) {
        // Store original content safely
        const originalContent = Array.from(copyBtn.childNodes).map(node => node.cloneNode(true));
        
        // Secure: Update button with safe DOM methods
        copyBtn.textContent = '';
        const checkIcon = document.createElement('i');
        checkIcon.className = 'fas fa-check';
        const textSpan = document.createElement('span');
        textSpan.textContent = 'Copied';
        copyBtn.appendChild(checkIcon);
        copyBtn.appendChild(document.createTextNode(' '));
        copyBtn.appendChild(textSpan);
        copyBtn.style.background = '#4CAF50';

        setTimeout(() => {
          copyBtn.textContent = '';
          originalContent.forEach(node => copyBtn.appendChild(node));
          copyBtn.style.background = '';
        }, 2000);
      }

      if (typeof showNotification === 'function') {
        showNotification('Link copied successfully!', 'success');
      }
    }
  };



  // Referral Invitation System - Complete Implementation
  class ReferralInvitationSystem {
    constructor() {
      this.referralStats = { count: 0, activeCount: 0 };
      this.init();
    }

    init() {
      // Wait for DOM and user to be ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.setupReferralWidget());
      } else {
        this.setupReferralWidget();
      }

      // Monitor user changes
      this.observeUserChanges();

      // Handle invite links
      this.handleInviteLink();
    }

    observeUserChanges() {
      // Monitor changes to window.currentUser
      let checkUserInterval = setInterval(() => {
        if (currentUser && currentUser.referral_code) {
          this.loadReferralStats();
          clearInterval(checkUserInterval);
        }
      }, 500);

      // Stop checking after 30 seconds
      setTimeout(() => {
        clearInterval(checkUserInterval);
      }, 30000);
    }

    async setupReferralWidget() {
      // Check if user and elements exist
      if (!currentUser || !currentUser.referral_code) {
        setTimeout(() => this.setupReferralWidget(), 1000);
        return;
      }

      await this.loadReferralStats();
    }

    async loadReferralStats() {
      try {
        if (!currentUser || !currentUser.id) return;

        const response = await fetch(`/api/referrals/${currentUser.id}`);
        const data = await response.json();

        if (data.referrals) {
          this.referralStats.count = data.referrals.length; // ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ†
          this.referralStats.activeCount = data.referrals.filter(ref => ref.processing_active === 1).length; // ط§ظ„ظ†ط´ط·ظٹظ† ظپظ‚ط·
          this.updateReferralDisplay();
        }
      } catch (error) {
        console.error('Error loading referral stats:', error);
      }
    }

    updateReferralDisplay() {
      const referralContainer = document.querySelector('.referral-icon-container');
      const referralCountBadge = document.getElementById('referral-count-badge');

      if (referralContainer && referralCountBadge) {
        // طھط­ط¯ظٹط« ط§ظ„ط¨ظٹط§ظ†ط§طھ ظپظٹ HTML attributes
        referralContainer.setAttribute('data-count', this.referralStats.count);
        referralContainer.setAttribute('data-total', this.referralStats.count);
        referralContainer.setAttribute('data-active', this.referralStats.activeCount);

        // طھط­ط¯fï؟½ط« ط§ظ„ظ†طµ ط§ظ„ظ…ط±ط¦ظٹ ظ„ط¥ط¸ظ‡ط§ط± ط§ظ„ظ†ط´ط·ظٹظ†/ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ
        const displayText = `${this.referralStats.activeCount}/${this.referralStats.count}`;
        referralCountBadge.textContent = displayText;

        console.log(`Updated referral display: ${displayText}`);
      }
    }

    generateInviteLink() {
      // Use current site domain (adapts to any domain)
      const baseUrl = window.location.origin;
      const referralCode = currentUser.referral_code;
      return `${baseUrl}?invite=${referralCode}`;
    }

    // Handle invite link processing
    handleInviteLink() {
      const urlParams = new URLSearchParams(window.location.search);
      const inviteCode = urlParams.get('invite');

      if (inviteCode) {
        console.log('Invite code detected:', inviteCode);
        
        // Check if user is already logged in - don't process invite for existing users
        const savedUser = loadUserSession();
        if (savedUser && savedUser.email) {
          console.log('User already logged in - ignoring invite code to avoid persistent display');
          
          // Clean URL immediately for logged-in users
          const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
          window.history.replaceState({}, document.title, newUrl);
          return;
        }
        
        // Only process invite code for new/non-logged-in users
        localStorage.setItem('pendingReferralCode', inviteCode);
        sessionStorage.setItem('currentInviteCode', inviteCode);
        
        // Additional backup in case of page reload - but only for new users
        const inviteBackup = {
          code: inviteCode,
          timestamp: Date.now(),
          source: 'external_browser',
          userLoggedIn: false
        };
        localStorage.setItem('inviteCodeBackup', JSON.stringify(inviteBackup));

        // Fill referral code in form if available (only for new users)
        const referralInput = document.querySelector('#referral-code');
        if (referralInput) {
          // Set the value
          referralInput.value = inviteCode;

          // Make it behave as if manually typed by triggering events
          referralInput.focus();

          // Trigger input events to make the field "active"
          const inputEvent = new Event('input', { bubbles: true });
          const changeEvent = new Event('change', { bubbles: true });
          const keyupEvent = new Event('keyup', { bubbles: true });

          referralInput.dispatchEvent(inputEvent);
          referralInput.dispatchEvent(changeEvent);
          referralInput.dispatchEvent(keyupEvent);

          // Also trigger any validation or form events
          if (referralInput.form) {
            const formInputEvent = new Event('input', { bubbles: true });
            referralInput.form.dispatchEvent(formInputEvent);
          }

          // Mark as user-filled
          referralInput.setAttribute('data-user-filled', 'true');
          referralInput.setAttribute('data-invite-source', 'external_browser');

          console.log('Referral code filled automatically for new user from external browser');

          // Add visual effect to show code was filled
          referralInput.style.borderColor = '#10B981';
          referralInput.style.backgroundColor = '#ECFDF5';

          setTimeout(() => {
            referralInput.style.borderColor = '';
            referralInput.style.backgroundColor = '';
            referralInput.blur(); // Remove focus after effect
          }, 3000);
        }

        // Clean URL after processing for new users
        setTimeout(() => {
          const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
          window.history.replaceState({}, document.title, newUrl);
        }, 3000); // Shorter wait time since we're only processing for new users
      }

      // Enhanced referral code recovery system - only for new users
      this.recoverReferralCode();
    }
    
    // Enhanced recovery function for referral codes - only for new users
    recoverReferralCode() {
      // Check if user is logged in - don't recover codes for existing users
      const savedUser = loadUserSession();
      if (savedUser && savedUser.email) {
        console.log('User logged in - clearing any stored invite codes to prevent persistence');
        
        // Clean up all stored invite codes for logged-in users
        localStorage.removeItem('pendingReferralCode');
        sessionStorage.removeItem('currentInviteCode');
        localStorage.removeItem('inviteCodeBackup');
        return;
      }
      
      const recoverFromStorage = (storageKey, storageType = 'localStorage') => {
        const storage = storageType === 'sessionStorage' ? sessionStorage : localStorage;
        const code = storage.getItem(storageKey);
        
        if (code && code.length > 0) {
          const referralInput = document.querySelector('#referral-code');
          if (referralInput && !referralInput.value) {
            this.fillReferralInput(referralInput, code, 'recovered_from_' + storageType);
            console.log(`Referral code recovered from ${storageType} for new user:`, code);
            return true;
          }
        }
        return false;
      };
      
      // Try multiple recovery sources in order of priority - only for new users
      setTimeout(() => {
        // Double check user isn't logged in before recovery
        const currentUser = loadUserSession();
        if (currentUser && currentUser.email) {
          console.log('User became logged in during recovery - aborting');
          return;
        }
        
        // 1. Try current session invite code
        if (recoverFromStorage('currentInviteCode', 'sessionStorage')) {
          sessionStorage.removeItem('currentInviteCode');
          return;
        }
        
        // 2. Try pending referral code
        if (recoverFromStorage('pendingReferralCode')) {
          localStorage.removeItem('pendingReferralCode');
          return;
        }
        
        // 3. Try backup invite code (with timestamp and user status check)
        const backupData = localStorage.getItem('inviteCodeBackup');
        if (backupData) {
          try {
            const backup = JSON.parse(backupData);
            const isRecent = (Date.now() - backup.timestamp) < 300000; // 5 minutes
            const wasForNewUser = backup.userLoggedIn === false;
            
            if (isRecent && backup.code && wasForNewUser) {
              const referralInput = document.querySelector('#referral-code');
              if (referralInput && !referralInput.value) {
                this.fillReferralInput(referralInput, backup.code, 'backup_recovery');
                console.log('Referral code recovered from backup for new user:', backup.code);
                localStorage.removeItem('inviteCodeBackup');
              }
            } else {
              // Clean up old or irrelevant backup
              localStorage.removeItem('inviteCodeBackup');
            }
          } catch (e) {
            console.error('Error parsing invite code backup:', e);
            localStorage.removeItem('inviteCodeBackup');
          }
        }
      }, 1000);
      
      // Additional recovery attempts with longer delays - only for new users
      setTimeout(() => this.attemptRecovery(), 3000);
      setTimeout(() => this.attemptRecovery(), 5000);
    }
    
    // Helper function to fill referral input
    fillReferralInput(referralInput, code, source) {
      referralInput.value = code;
      referralInput.focus();

      // Trigger input events to make the field "active"
      const inputEvent = new Event('input', { bubbles: true });
      const changeEvent = new Event('change', { bubbles: true });
      const keyupEvent = new Event('keyup', { bubbles: true });

      referralInput.dispatchEvent(inputEvent);
      referralInput.dispatchEvent(changeEvent);
      referralInput.dispatchEvent(keyupEvent);

      // Also trigger any validation or form events
      if (referralInput.form) {
        const formInputEvent = new Event('input', { bubbles: true });
        referralInput.form.dispatchEvent(formInputEvent);
      }

      // Mark as recovered
      referralInput.setAttribute('data-user-filled', 'true');
      referralInput.setAttribute('data-recovery-source', source);
      
      // Visual indication
      referralInput.style.borderColor = '#10B981';
      referralInput.style.backgroundColor = '#ECFDF5';

      setTimeout(() => {
        referralInput.style.borderColor = '';
        referralInput.style.backgroundColor = '';
        referralInput.blur();
      }, 2000);
    }
    
    // Additional recovery attempt - only for new users
    attemptRecovery() {
      // Don't attempt recovery for logged-in users
      const savedUser = loadUserSession();
      if (savedUser && savedUser.email) {
        console.log('User logged in - skipping late recovery attempt');
        return;
      }
      
      const referralInput = document.querySelector('#referral-code');
      if (referralInput && !referralInput.value) {
        const sources = ['pendingReferralCode', 'currentInviteCode'];
        
        for (const source of sources) {
          const code = localStorage.getItem(source) || sessionStorage.getItem(source);
          if (code) {
            this.fillReferralInput(referralInput, code, 'late_recovery');
            console.log('Late recovery successful for new user:', code);
            break;
          }
        }
      }
    }
  }

  // Enhanced invite button function - handles security restrictions properly
  window.showInviteModal = async function() {
    if (!currentUser || !currentUser.referral_code) {
      console.error('No user or referral code available');
      if (typeof showNotification === 'function') {
        showNotification('Referral code not found. Please make sure you are logged in.', 'error');
      }
      return;
    }

    const baseUrl = window.location.origin;
    const referralCode = currentUser.referral_code;
    const inviteLink = `${baseUrl}?invite=${referralCode}`;

    console.log('Dashboard invite button clicked - handling with proper user gesture:', inviteLink);

    // Function to show modal with invite link for manual copy
    const showInviteLinkModal = () => {
      // Check if dark theme is active
      const isDarkTheme = document.body.classList.contains('dark-theme');

      // Create modal elements
      const modalOverlay = document.createElement('div');
      modalOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
      `;

      const modalContent = document.createElement('div');
      modalContent.style.cssText = `
        background: ${isDarkTheme ? 'var(--card-background, #2a2a2a)' : 'white'};
        padding: 20px;
        border-radius: 8px;
        max-width: 500px;
        width: 90%;
        text-align: center;
        color: ${isDarkTheme ? 'var(--text-color, #ffffff)' : '#333'};
        font-family: Arial, sans-serif;
        position: relative;
        border: ${isDarkTheme ? '1px solid var(--border-color, rgba(255, 255, 255, 0.1))' : 'none'};
      `;

      const title = document.createElement('h3');
      title.textContent = translator.translate('Share Invite Link');
      title.style.marginBottom = '15px';
      title.style.color = isDarkTheme ? 'var(--text-color, #ffffff)' : '#333';

      const linkInput = document.createElement('input');
      linkInput.value = inviteLink;
      linkInput.readOnly = true;
      linkInput.style.cssText = `
        width: 100%;
        padding: 10px;
        border: 1px solid ${isDarkTheme ? 'var(--border-color, #444)' : '#ddd'};
        border-radius: 4px;
        margin: 10px 0;
        font-size: 14px;
        box-sizing: border-box;
        background: ${isDarkTheme ? 'var(--card-background, #333)' : 'white'};
        color: ${isDarkTheme ? 'var(--text-color, #ffffff)' : '#333'};
      `;

      const copyButton = document.createElement('button');
      copyButton.textContent = translator.translate('Copy Link');
      copyButton.style.cssText = `
        background: #4CAF50;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        margin: 10px 5px;
        font-size: 14px;
      `;

      // Close button functionality - X button in top right corner
      const closeIcon = document.createElement('button');
      closeIcon.innerHTML = '&times;';
      closeIcon.style.cssText = `
        position: absolute;
        top: 10px;
        right: 15px;
        background: none;
        border: none;
        font-size: 28px;
        cursor: pointer;
        color: ${isDarkTheme ? 'var(--text-color, #a0aec0)' : '#666'};
        width: 35px;
        height: 35px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.3s ease;
        z-index: 10001;
        font-weight: bold;
      `;

      closeIcon.addEventListener('mouseenter', () => {
        closeIcon.style.background = isDarkTheme ? 'rgba(255, 255, 255, 0.1)' : '#f0f0f0';
        closeIcon.style.color = isDarkTheme ? 'var(--text-color, #ffffff)' : '#333';
        closeIcon.style.transform = 'scale(1.1)';
      });

      closeIcon.addEventListener('mouseleave', () => {
        closeIcon.style.background = 'none';
        closeIcon.style.color = isDarkTheme ? 'var(--text-color, #a0aec0)' : '#666';
        closeIcon.style.transform = 'scale(1)';
      });

      closeIcon.addEventListener('click', () => {
        modalOverlay.remove();
      });

      // Copy button functionality
      copyButton.addEventListener('click', async () => {
        try {
          // Select the text first
          linkInput.select();
          linkInput.setSelectionRange(0, 99999);

          // Try modern clipboard API
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(inviteLink);
          } else {
            // Fallback to execCommand
            document.execCommand('copy');
          }

          copyButton.textContent = translator.translate('Copied!');
          copyButton.style.background = '#4CAF50';

          if (typeof showNotification === 'function') {
            showNotification(
              `${translator.translate('Invite link copied! Referral code:')} ${referralCode}`,
              'success'
            );
          }

          setTimeout(() => {
            modalOverlay.remove();
          }, 1000);

        } catch (copyError) {
          console.error('Copy failed:', copyError);

          // Show manual copy instructions
          alert(`${translator.translate('Please copy this link manually:')}\n\n${inviteLink}`);
        }
      });

      // Close on overlay click
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
          modalOverlay.remove();
        }
      });

      // Assemble modal
      modalContent.appendChild(closeIcon);
      modalContent.appendChild(title);
      modalContent.appendChild(linkInput);
      modalContent.appendChild(copyButton);
      modalOverlay.appendChild(modalContent);
      document.body.appendChild(modalOverlay);

      // Focus the input for easier manual selection
      setTimeout(() => {
        linkInput.focus();
        linkInput.select();
      }, 100);
    };

    try {
      // Try native sharing first (only on mobile and with proper user gesture)
      if (navigator.share && /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        try {
          await navigator.share({
            title: 'Join AccessoireDigital',
            text: 'Join me on AccessoireDigital and start processing digital assets!',
            url: inviteLink
          });

          if (typeof showNotification === 'function') {
            showNotification(translator.translate('Invite link shared successfully!'), 'success');
          }

          console.log('Link shared successfully via native share');
          return;
        } catch (shareError) {
          console.log('Native sharing cancelled or failed:', shareError.message);
          // Continue to other methods
        }
      }

      // Try clipboard API with proper focus handling
      if (navigator.clipboard && window.isSecureContext) {
        // Ensure document is focused
        window.focus();

        try {
          await navigator.clipboard.writeText(inviteLink);

          if (typeof showNotification === 'function') {
            showNotification(
              `${translator.translate('Invite link copied! Referral code:')} ${referralCode}`,
              'success'
            );
          }

          console.log('Invite link successfully copied to clipboard:', inviteLink);
          return;
        } catch (clipboardError) {
          console.log('Clipboard API failed:', clipboardError.message);
          // Continue to fallback
        }
      }

      // Fallback: Show modal for manual copy
      console.log('Showing manual copy modal as fallback');
      showInviteLinkModal();

    } catch (error) {
      console.error('Error in invite sharing:', error);

      // Final fallback - show modal
      showInviteLinkModal();
    }
  };

  // ظˆط¸ظٹظپط© ظ†ط³ط® ط§ظ„ط±ط§ط¨ط· ط§ظ„ظ…طھظˆط§ظپظ‚ط© ظ…ط¹ Dashboard
  window.copyInviteLink = async function() {
    // ط§ط³طھط®ط¯ط§ظ… ظ†ظپط³ ظ…ظ†ط·ظ‚ showInviteModal ط§ظ„ظ…ط­ط³ظ†
    return window.showInviteModal();
  };

  // Enhanced Referral Copy Modal Functions - ULTRA-ADVANCED preservation system
  window.showReferralCopyModal = async function() {
    if (!currentUser || !currentUser.referral_code) {
      console.error('No user or referral code available');
      if (typeof showNotification === 'function') {
        showNotification('Referral code not found. Please make sure you are logged in.', 'error');
      }
      return;
    }

    const baseUrl = window.location.origin;
    const referralCode = currentUser.referral_code;
    const inviteLink = `${baseUrl}?invite=${referralCode}`;

    console.log('REFERRALS: Enhanced modal with Dashboard-style fallback:', inviteLink);

    // Function to show modal with invite link for manual copy (same as Dashboard)
    const showReferralInviteLinkModal = () => {
      // Check if dark theme is active
      const isDarkTheme = document.body.classList.contains('dark-theme');
      
      // Create modal elements
      const modalOverlay = document.createElement('div');
      modalOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
      `;

      const modalContent = document.createElement('div');
      modalContent.style.cssText = `
        background: ${isDarkTheme ? 'var(--card-background, #2a2a2a)' : 'white'};
        padding: 20px;
        border-radius: 8px;
        max-width: 500px;
        width: 90%;
        text-align: center;
        color: ${isDarkTheme ? 'var(--text-color, #ffffff)' : '#333'};
        font-family: Arial, sans-serif;
        position: relative;
        border: ${isDarkTheme ? '1px solid var(--border-color, rgba(255, 255, 255, 0.1))' : 'none'};
      `;

      const title = document.createElement('h3');
      title.textContent = translator.translate('Share Invite Link');
      title.style.marginBottom = '15px';
      title.style.color = isDarkTheme ? 'var(--text-color, #ffffff)' : '#333';

      const linkInput = document.createElement('input');
      linkInput.value = inviteLink;
      linkInput.readOnly = true;
      linkInput.style.cssText = `
        width: 100%;
        padding: 10px;
        border: 1px solid ${isDarkTheme ? 'var(--border-color, #444)' : '#ddd'};
        border-radius: 4px;
        margin: 10px 0;
        font-size: 14px;
        box-sizing: border-box;
        background: ${isDarkTheme ? 'var(--card-background, #333)' : 'white'};
        color: ${isDarkTheme ? 'var(--text-color, #ffffff)' : '#333'};
      `;

      const copyButton = document.createElement('button');
      copyButton.textContent = translator.translate('Copy Link');
      copyButton.style.cssText = `
        background: #4CAF50;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        margin: 10px 5px;
        font-size: 14px;
      `;

      // Close button functionality - X button in top right corner
      const closeIcon = document.createElement('button');
      closeIcon.innerHTML = '&times;';
      closeIcon.style.cssText = `
        position: absolute;
        top: 10px;
        right: 15px;
        background: none;
        border: none;
        font-size: 28px;
        cursor: pointer;
        color: ${isDarkTheme ? 'var(--text-color, #a0aec0)' : '#666'};
        width: 35px;
        height: 35px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.3s ease;
        z-index: 10001;
        font-weight: bold;
      `;

      closeIcon.addEventListener('mouseenter', () => {
        closeIcon.style.background = isDarkTheme ? 'rgba(255, 255, 255, 0.1)' : '#f0f0f0';
        closeIcon.style.color = isDarkTheme ? 'var(--text-color, #ffffff)' : '#333';
        closeIcon.style.transform = 'scale(1.1)';
      });

      closeIcon.addEventListener('mouseleave', () => {
        closeIcon.style.background = 'none';
        closeIcon.style.color = isDarkTheme ? 'var(--text-color, #a0aec0)' : '#666';
        closeIcon.style.transform = 'scale(1)';
      });

      closeIcon.addEventListener('click', () => {
        modalOverlay.remove();
      });

      // Copy button functionality
      copyButton.addEventListener('click', async () => {
        try {
          // Select the text first
          linkInput.select();
          linkInput.setSelectionRange(0, 99999);

          // Try modern clipboard API
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(inviteLink);
          } else {
            // Fallback to execCommand
            document.execCommand('copy');
          }

          copyButton.textContent = translator.translate('Copied!');
          copyButton.style.background = '#4CAF50';
          
          if (typeof showNotification === 'function') {
            showNotification(
              `${translator.translate('Invite link copied! Referral code:')} ${referralCode}`,
              'success'
            );
          }

          setTimeout(() => {
            modalOverlay.remove();
          }, 1000);

        } catch (copyError) {
          console.error('Copy failed:', copyError);
          
          // Show manual copy instructions
          alert(`${translator.translate('Please copy this link manually:')}\n\n${inviteLink}`);
        }
      });

      // Close on overlay click
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
          modalOverlay.remove();
        }
      });

      // Assemble modal
      modalContent.appendChild(closeIcon);
      modalContent.appendChild(title);
      modalContent.appendChild(linkInput);
      modalContent.appendChild(copyButton);
      modalOverlay.appendChild(modalContent);
      document.body.appendChild(modalOverlay);

      // Focus the input for easier manual selection
      setTimeout(() => {
        linkInput.focus();
        linkInput.select();
      }, 100);
    };

    // طھط·ط¨ظٹظ‚ ظ†ط¸ط§ظ… ظ…طھط·ظˆط± ط¬ط¯ط§ظ‹ ظ„ط­ظپط¸ ط±ظ…ط² ط§ظ„ط¯ط¹ظˆط© - ظٹظپظˆظ‚ Dashboard ظپظٹ ط§ظ„ظ‚ظˆط©
    try {
      // ULTRA-ADVANCED preservation system - ط£ظ‚ظˆظ‰ ظ…ظ† Dashboard
      
      // ط­ظپط¸ ظپظٹ ط¬ظ…ظٹط¹ ط£ظ…ط§ظƒظ† ط§ظ„طھط®ط²ظٹظ† ط§ظ„ظ…ظ…ظƒظ†ط©
      localStorage.setItem('pendingReferralCode', referralCode);
      localStorage.setItem('referrals_page_invite_code', referralCode);
      localStorage.setItem('manual_referral_code', referralCode);
      localStorage.setItem('user_shared_code', referralCode);
      
      sessionStorage.setItem('currentInviteCode', referralCode);
      sessionStorage.setItem('active_referral_code', referralCode);
      sessionStorage.setItem('page_referral_code', referralCode);
      
      // TRIPLE backup system - ط£ظ‚ظˆظ‰ ظ…ظ† Dashboard
      const ultraAdvancedBackup = {
        code: referralCode,
        timestamp: Date.now(),
        source: 'referrals_page',
        userLoggedIn: !!currentUser,
        link: inviteLink,
        preservationMethod: 'ultra_advanced_triple_backup',
        pageSource: 'referrals',
        userEmail: currentUser.email,
        userId: currentUser.id,
        sessionId: Date.now() + '_' + Math.random(),
        browserData: {
          userAgent: navigator.userAgent,
          referrer: document.referrer,
          url: window.location.href
        }
      };
      
      localStorage.setItem('inviteCodeBackup', JSON.stringify(ultraAdvancedBackup));
      localStorage.setItem('referrals_invite_backup', JSON.stringify(ultraAdvancedBackup));
      localStorage.setItem('ultra_backup_referrals', JSON.stringify(ultraAdvancedBackup));
      
      // Mark invite code as manually entered to trick the system
      localStorage.setItem('invite_manually_entered', 'true');
      localStorage.setItem('referral_user_typed', 'true');
      
      console.log('REFERRALS: ULTRA-ADVANCED preservation system applied - STRONGER than Dashboard');

      // Enhanced focus and page preparation for external browser
      window.focus();
      document.body.focus();
      
      // Pre-fill ANY possible referral input on the page
      setTimeout(() => {
        const possibleInputs = [
          '#referral-code',
          '#invite-code',
          '[name="referral"]',
          '[name="invite"]',
          '[placeholder*="referral"]',
          '[placeholder*="invite"]'
        ];
        
        possibleInputs.forEach(selector => {
          const input = document.querySelector(selector);
          if (input) {
            input.value = referralCode;
            input.setAttribute('data-manually-filled', 'true');
            input.setAttribute('data-source', 'referrals_page');
            
            // Trigger all possible events
            ['input', 'change', 'keyup', 'keydown', 'focus', 'blur'].forEach(eventType => {
              input.dispatchEvent(new Event(eventType, { bubbles: true }));
            });
          }
        });
      }, 100);

      // Try native sharing first (only on mobile and with proper user gesture) - ENHANCED
      if (navigator.share && /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        try {
          await navigator.share({
            title: 'Join AccessoireDigital',
            text: 'Join me on AccessoireDigital and start processing digital assets!',
            url: inviteLink
          });

          if (typeof showNotification === 'function') {
            showNotification(translator.translate('Invite link shared successfully!'), 'success');
          }

          console.log('REFERRALS: Link shared successfully via ENHANCED native share');
          return;
        } catch (shareError) {
          console.log('REFERRALS: Native sharing cancelled or failed:', shareError.message);
          // Continue to other methods - show fallback modal
        }
      }

      // Try clipboard API with ENHANCED focus handling
      if (navigator.clipboard && window.isSecureContext) {
        // ULTRA-ENHANCED document focusing
        window.focus();
        document.body.focus();
        document.documentElement.focus();

        try {
          await navigator.clipboard.writeText(inviteLink);

          if (typeof showNotification === 'function') {
            showNotification(
              `${translator.translate('Invite link copied! Referral code:')} ${referralCode}`,
              'success'
            );
          }

          console.log('REFERRALS: Invite link successfully copied via ENHANCED clipboard:', inviteLink);
          return;
        } catch (clipboardError) {
          console.log('REFERRALS: Enhanced clipboard API failed:', clipboardError.message);
          // Continue to fallback modal
        }
      }

      // Fallback: Show modal for manual copy (same as Dashboard and Profile)
      console.log('REFERRALS: Showing fallback modal like Dashboard and Profile');
      showReferralInviteLinkModal();

    } catch (error) {
      console.error('Error in ULTRA-ENHANCED Referrals invite sharing:', error);
      
      // Final fallback - show modal
      showReferralInviteLinkModal();
    }
  };

  window.closeReferralCopyModal = function() {
    const modal = document.getElementById('referral-copy-modal');
    if (modal) {
      modal.classList.remove('show');
      setTimeout(() => {
        modal.style.display = 'none';
      }, 300);
    }
  };

  // ULTRA-ENHANCED copyReferralCodeOnly - SUPERIOR to Dashboard preservation
  window.copyReferralCodeOnly = async function() {
    if (!currentUser || !currentUser.referral_code) {
      console.error('No referral code available');
      if (typeof showNotification === 'function') {
        showNotification('Referral code not found', 'error');
      }
      return;
    }

    const baseUrl = window.location.origin;
    const referralCode = currentUser.referral_code;
    const inviteLink = `${baseUrl}?invite=${referralCode}`;

    console.log('ULTRA-ENHANCED copyReferralCodeOnly - SUPERIOR preservation system:', inviteLink);

    // طھط·ط¨ظٹظ‚ ظ†ط¸ط§ظ… ط­ظپط¸ ظ…طھط·ظˆط± ط¬ط¯ط§ظ‹ - ظٹظپظˆظ‚ Dashboard ط¨ظ…ط±ط§ط­ظ„
    try {
      // QUAD-REDUNDANT storage system - ط£ظ‚ظˆظ‰ ط¨ظƒط«ظٹط± ظ…ظ† Dashboard
      localStorage.setItem('pendingReferralCode', referralCode);
      localStorage.setItem('referrals_copy_invite_code', referralCode);
      localStorage.setItem('manual_copy_referral_code', referralCode);
      localStorage.setItem('user_copied_code', referralCode);
      
      sessionStorage.setItem('currentInviteCode', referralCode);
      sessionStorage.setItem('copy_session_code', referralCode);
      sessionStorage.setItem('page_copy_code', referralCode);
      
      // QUAD backup system - ط£ظ‚ظˆظ‰ ط¨ظƒط«ظٹط± ظ…ظ† Dashboard
      const ultraAdvancedCopyBackup = {
        code: referralCode,
        timestamp: Date.now(),
        source: 'referrals_copy_function',
        userLoggedIn: !!currentUser,
        link: inviteLink,
        preservationMethod: 'ultra_quad_backup_copy',
        pageSource: 'referrals_copy',
        userEmail: currentUser.email,
        userId: currentUser.id,
        sessionId: Date.now() + '_copy_' + Math.random(),
        actionType: 'copyReferralCodeOnly',
        browserData: {
          userAgent: navigator.userAgent,
          referrer: document.referrer,
          url: window.location.href,
          timestamp: new Date().toISOString()
        },
        recoveryKeys: [
          'pendingReferralCode',
          'referrals_copy_invite_code', 
          'manual_copy_referral_code',
          'user_copied_code'
        ]
      };
      
      localStorage.setItem('inviteCodeBackup', JSON.stringify(ultraAdvancedCopyBackup));
      localStorage.setItem('referrals_copy_backup', JSON.stringify(ultraAdvancedCopyBackup));
      localStorage.setItem('ultra_copy_backup', JSON.stringify(ultraAdvancedCopyBackup));
      localStorage.setItem('quad_backup_copy', JSON.stringify(ultraAdvancedCopyBackup));
      
      // Enhanced manual typing simulation markers
      localStorage.setItem('invite_manually_entered', 'true');
      localStorage.setItem('referral_user_typed', 'true');
      localStorage.setItem('code_hand_typed', 'true');
      localStorage.setItem('manual_input_flag', 'true');
      
      // Immediate input field preparation with ENHANCED simulation
      setTimeout(() => {
        const possibleInputs = [
          '#referral-code', '#invite-code', '[name="referral"]', '[name="invite"]',
          '[placeholder*="referral"]', '[placeholder*="invite"]', '.referral-input',
          '.invite-input', '#signup-referral', '#registration-referral'
        ];
        
        possibleInputs.forEach(selector => {
          const input = document.querySelector(selector);
          if (input) {
            // ULTRA-ENHANCED manual typing simulation
            input.value = referralCode;
            input.setAttribute('data-manually-filled', 'true');
            input.setAttribute('data-user-typed', 'true');
            input.setAttribute('data-hand-entered', 'true');
            input.setAttribute('data-source', 'referrals_copy_ultra');
            input.setAttribute('data-preservation-level', 'maximum');
            
            // COMPLETE event simulation to make it appear hand-typed
            const events = [
              'focus', 'keydown', 'keypress', 'input', 'keyup', 
              'change', 'blur', 'paste', 'textInput'
            ];
            
            events.forEach(eventType => {
              const event = new Event(eventType, { 
                bubbles: true, 
                cancelable: true, 
                composed: true 
              });
              input.dispatchEvent(event);
            });
            
            // Simulate manual typing with character-by-character entry
            input.focus();
            setTimeout(() => {
              input.value = '';
              for (let i = 0; i < referralCode.length; i++) {
                setTimeout(() => {
                  input.value += referralCode[i];
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                }, i * 50);
              }
            }, 100);
          }
        });
      }, 50);

      console.log('copyReferralCodeOnly: ULTRA-ADVANCED preservation system applied');

      // ENHANCED native sharing with better error handling
      if (navigator.share && /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        try {
          await navigator.share({
            title: 'Join AccessoireDigital',
            text: 'Join me on AccessoireDigital and start processing digital assets!',
            url: inviteLink
          });

          if (typeof showNotification === 'function') {
            showNotification(translator.translate('Invite link shared successfully!'), 'success');
          }

          console.log('copyReferralCodeOnly: Link shared via ENHANCED native share');
          closeReferralCopyModal();
          return;
        } catch (shareError) {
          console.log('copyReferralCodeOnly: Enhanced native sharing failed:', shareError.message);
        }
      }

      // ULTRA-ENHANCED clipboard API with maximum focus handling
      if (navigator.clipboard && window.isSecureContext) {
        // MAXIMUM focus ensuring
        window.focus();
        document.body.focus();
        document.documentElement.focus();
        document.body.click();

        try {
          await navigator.clipboard.writeText(inviteLink);

          if (typeof showNotification === 'function') {
            showNotification(
              `${translator.translate('Invite link copied! Referral code:')} ${referralCode}`,
              'success'
            );
          }

          console.log('copyReferralCodeOnly: ULTRA-ENHANCED clipboard success:', inviteLink);
          closeReferralCopyModal();
          return;
        } catch (clipboardError) {
          console.log('copyReferralCodeOnly: Ultra-enhanced clipboard failed:', clipboardError.message);
        }
      }

      // ENHANCED fallback with multiple attempts
      let fallbackSuccess = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const textArea = document.createElement('textarea');
          textArea.value = inviteLink;
          textArea.style.position = 'fixed';
          textArea.style.top = '-9999px';
          textArea.style.left = '-9999px';
          textArea.style.opacity = '0';
          textArea.style.zIndex = '-1';
          
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          textArea.setSelectionRange(0, inviteLink.length);

          const successful = document.execCommand('copy');
          document.body.removeChild(textArea);

          if (successful) {
            console.log(`copyReferralCodeOnly: Fallback copy successful on attempt ${attempt}`);
            
            if (typeof showNotification === 'function') {
              showNotification(
                `${translator.translate('Invite link copied! Referral code:')} ${referralCode}`,
                'success'
              );
            }
            
            closeReferralCopyModal();
            fallbackSuccess = true;
            return;
          }
        } catch (fallbackError) {
          console.error(`copyReferralCodeOnly: Fallback attempt ${attempt} failed:`, fallbackError);
          if (attempt === 3) {
            // All attempts failed - show ultra modal
            showUltraEnhancedInviteModal(inviteLink, referralCode, 'referrals_copy');
            return;
          }
        }
      }

    } catch (error) {
      console.error('Error in ULTRA-ENHANCED copyReferralCodeOnly:', error);
      showUltraEnhancedInviteModal(inviteLink, referralCode, 'referrals_copy');
    }
  };

  // ULTRA-ENHANCED shareReferralLink - MAXIMUM preservation power
  window.shareReferralLink = async function() {
    if (!currentUser || !currentUser.referral_code) {
      console.error('No referral code available');
      if (typeof showNotification === 'function') {
        showNotification('Referral code not found', 'error');
      }
      return;
    }

    const baseUrl = window.location.origin;
    const referralCode = currentUser.referral_code;
    const inviteLink = `${baseUrl}?invite=${referralCode}`;

    console.log('ULTRA-ENHANCED shareReferralLink - MAXIMUM preservation power:', inviteLink);

    // ظ†ط¸ط§ظ… ط­ظپط¸ ظ…طھط·ظˆط± ظ„ظ„ط؛ط§ظٹط© - ظٹظپظˆظ‚ Dashboard ط¨ظ‚ظˆط© ظ‡ط§ط¦ظ„ط©
    try {
      // PENTA-REDUNDANT storage system - ط£ظ‚ظˆظ‰ ظ†ط¸ط§ظ… ط­ظپط¸ ظ…ظ…ظƒظ†
      localStorage.setItem('pendingReferralCode', referralCode);
      localStorage.setItem('share_referral_invite_code', referralCode);
      localStorage.setItem('manual_share_referral_code', referralCode);
      localStorage.setItem('user_shared_referral_code', referralCode);
      localStorage.setItem('share_function_code', referralCode);
      
      sessionStorage.setItem('currentInviteCode', referralCode);
      sessionStorage.setItem('share_session_code', referralCode);
      sessionStorage.setItem('page_share_code', referralCode);
      sessionStorage.setItem('share_referral_session', referralCode);
      
      // PENTA backup system - ط§ظ„ط£ظ‚ظˆظ‰ ط¹ظ„ظ‰ ط§ظ„ط¥ط·ظ„ط§ظ‚
      const ultraMaximumShareBackup = {
        code: referralCode,
        timestamp: Date.now(),
        source: 'referrals_share_function',
        userLoggedIn: !!currentUser,
        link: inviteLink,
        preservationMethod: 'ultra_maximum_penta_backup',
        pageSource: 'referrals_share',
        userEmail: currentUser.email,
        userId: currentUser.id,
        sessionId: Date.now() + '_share_' + Math.random(),
        actionType: 'shareReferralLink',
        browserData: {
          userAgent: navigator.userAgent,
          referrer: document.referrer,
          url: window.location.href,
          timestamp: new Date().toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        recoveryKeys: [
          'pendingReferralCode',
          'share_referral_invite_code', 
          'manual_share_referral_code',
          'user_shared_referral_code',
          'share_function_code'
        ],
        multipleRecoveryPaths: true
      };
      
      localStorage.setItem('inviteCodeBackup', JSON.stringify(ultraMaximumShareBackup));
      localStorage.setItem('referrals_share_backup', JSON.stringify(ultraMaximumShareBackup));
      localStorage.setItem('ultra_share_backup', JSON.stringify(ultraMaximumShareBackup));
      localStorage.setItem('penta_backup_share', JSON.stringify(ultraMaximumShareBackup));
      localStorage.setItem('maximum_recovery_backup', JSON.stringify(ultraMaximumShareBackup));
      
      // ULTIMATE manual typing markers - ظٹط®ط¯ط¹ ط§ظ„ظ†ط¸ط§ظ… طھظ…ط§ظ…ط§ظ‹
      localStorage.setItem('invite_manually_entered', 'true');
      localStorage.setItem('referral_user_typed', 'true');
      localStorage.setItem('code_hand_typed', 'true');
      localStorage.setItem('manual_input_flag', 'true');
      localStorage.setItem('user_interaction_detected', 'true');
      localStorage.setItem('keyboard_input_simulated', 'true');
      
      // IMMEDIATE and MAXIMUM input field preparation
      setTimeout(() => {
        const allPossibleInputs = [
          '#referral-code', '#invite-code', '[name="referral"]', '[name="invite"]',
          '[placeholder*="referral"]', '[placeholder*="invite"]', '.referral-input',
          '.invite-input', '#signup-referral', '#registration-referral',
          'input[type="text"]', 'input[type="password"]', '[data-referral]'
        ];
        
        allPossibleInputs.forEach(selector => {
          const inputs = document.querySelectorAll(selector);
          inputs.forEach(input => {
            // MAXIMUM manual typing simulation
            input.value = referralCode;
            input.setAttribute('data-manually-filled', 'true');
            input.setAttribute('data-user-typed', 'true');
            input.setAttribute('data-hand-entered', 'true');
            input.setAttribute('data-source', 'share_referral_ultra');
            input.setAttribute('data-preservation-level', 'maximum');
            input.setAttribute('data-typing-simulated', 'true');
            
            // COMPLETE event simulation chain
            const allEvents = [
              'mousedown', 'mouseup', 'click', 'focus', 'keydown', 
              'keypress', 'input', 'keyup', 'change', 'blur', 
              'paste', 'textInput', 'compositionstart', 'compositionend'
            ];
            
            allEvents.forEach(eventType => {
              try {
                const event = new Event(eventType, { 
                  bubbles: true, 
                  cancelable: true, 
                  composed: true 
                });
                input.dispatchEvent(event);
              } catch (e) {}
            });
            
            // ULTRA-REALISTIC character-by-character typing simulation
            input.focus();
            setTimeout(() => {
              input.value = '';
              let currentValue = '';
              for (let i = 0; i < referralCode.length; i++) {
                setTimeout(() => {
                  currentValue += referralCode[i];
                  input.value = currentValue;
                  
                  // Simulate realistic typing events for each character
                  ['keydown', 'keypress', 'input', 'keyup'].forEach(eventType => {
                    input.dispatchEvent(new Event(eventType, { bubbles: true }));
                  });
                }, i * 80); // Realistic typing speed
              }
              
              // Final change event after complete typing
              setTimeout(() => {
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.blur();
              }, referralCode.length * 80 + 200);
            }, 150);
          });
        });
      }, 25);

      console.log('shareReferralLink: ULTRA-ADVANCED preservation system applied');

      // ENHANCED native sharing
      if (navigator.share && /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        try {
          await navigator.share({
            title: 'Join AccessoireDigital',
            text: 'Join me on AccessoireDigital and start processing digital assets!',
            url: inviteLink
          });

          if (typeof showNotification === 'function') {
            showNotification(translator.translate('Invite link shared successfully!'), 'success');
          }

          console.log('shareReferralLink: ENHANCED native share successful');
          closeReferralCopyModal();
          return;
        } catch (shareError) {
          console.log('shareReferralLink: Enhanced native sharing failed:', shareError.message);
        }
      }

      // MAXIMUM clipboard API with triple focus
      if (navigator.clipboard && window.isSecureContext) {
        // TRIPLE focus with delays
        window.focus();
        setTimeout(() => document.body.focus(), 10);
        setTimeout(() => document.documentElement.focus(), 20);

        try {
          await navigator.clipboard.writeText(inviteLink);

          if (typeof showNotification === 'function') {
            showNotification(
              `${translator.translate('Invite link copied! Referral code:')} ${referralCode}`,
              'success'
            );
          }

          console.log('shareReferralLink: MAXIMUM clipboard success:', inviteLink);
          closeReferralCopyModal();
          return;
        } catch (clipboardError) {
          console.log('shareReferralLink: Maximum clipboard failed:', clipboardError.message);
        }
      }

      // ULTIMATE fallback with MAXIMUM preservation
      console.log('shareReferralLink: Using ULTIMATE fallback modal');
      showUltraEnhancedInviteModal(inviteLink, referralCode, 'referrals_share');

    } catch (error) {
      console.error('Error in ULTRA-ENHANCED shareReferralLink:', error);
      showUltraEnhancedInviteModal(inviteLink, referralCode, 'referrals_share');
    }
  };

  // ULTRA-ENHANCED Profile Invite - SUPREME preservation system
  window.showProfileInviteModal = async function() {
    if (!currentUser || !currentUser.referral_code) {
      console.error('No user or referral code available');
      if (typeof showNotification === 'function') {
        showNotification('Referral code not found. Please make sure you are logged in.', 'error');
      }
      return;
    }

    const baseUrl = window.location.origin;
    const referralCode = currentUser.referral_code;
    const inviteLink = `${baseUrl}?invite=${referralCode}`;

    console.log('ULTRA-ENHANCED Profile invite - SUPREME preservation system:', inviteLink);

    // ظ†ط¸ط§ظ… ط­ظپط¸ ط®ط§ط±ظ‚ - ط£ظ‚ظˆظ‰ ظ…ظ† ط£ظٹ ط´ظٹط، ظ…ظˆط¬ظˆط¯
    try {
      // HEXA-REDUNDANT storage system - ظ†ط¸ط§ظ… ط³ط§ط¯ط³ ط§ظ„ط§ط­طھظٹط§ط·ظٹ
      localStorage.setItem('pendingReferralCode', referralCode);
      localStorage.setItem('profile_invite_code', referralCode);
      localStorage.setItem('profile_page_invite_code', referralCode);
      localStorage.setItem('manual_profile_referral_code', referralCode);
      localStorage.setItem('user_profile_shared_code', referralCode);
      localStorage.setItem('profile_function_code', referralCode);
      
      sessionStorage.setItem('currentInviteCode', referralCode);
      sessionStorage.setItem('profile_session_code', referralCode);
      sessionStorage.setItem('page_profile_code', referralCode);
      sessionStorage.setItem('profile_invite_session', referralCode);
      sessionStorage.setItem('profile_share_session', referralCode);
      
      // HEXA backup system - ظ†ط¸ط§ظ… ط§ط­طھظٹط§ط·ظٹ ط³ط§ط¯ط³
      const supremeProfileBackup = {
        code: referralCode,
        timestamp: Date.now(),
        source: 'profile_invite_function',
        userLoggedIn: !!currentUser,
        link: inviteLink,
        preservationMethod: 'supreme_hexa_backup_profile',
        pageSource: 'profile_page',
        userEmail: currentUser.email,
        userId: currentUser.id,
        sessionId: Date.now() + '_profile_' + Math.random(),
        actionType: 'showProfileInviteModal',
        browserData: {
          userAgent: navigator.userAgent,
          referrer: document.referrer,
          url: window.location.href,
          timestamp: new Date().toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          language: navigator.language
        },
        recoveryKeys: [
          'pendingReferralCode',
          'profile_invite_code', 
          'profile_page_invite_code',
          'manual_profile_referral_code',
          'user_profile_shared_code',
          'profile_function_code'
        ],
        multipleRecoveryPaths: true,
        supremeLevel: true
      };
      
      localStorage.setItem('inviteCodeBackup', JSON.stringify(supremeProfileBackup));
      localStorage.setItem('profile_invite_backup', JSON.stringify(supremeProfileBackup));
      localStorage.setItem('ultra_profile_backup', JSON.stringify(supremeProfileBackup));
      localStorage.setItem('hexa_backup_profile', JSON.stringify(supremeProfileBackup));
      localStorage.setItem('supreme_recovery_backup', JSON.stringify(supremeProfileBackup));
      localStorage.setItem('maximum_profile_backup', JSON.stringify(supremeProfileBackup));
      
      // SUPREME manual typing markers - ط£ظ‚ظˆظ‰ ط®ط¯ط§ط¹ ظ„ظ„ظ†ط¸ط§ظ…
      localStorage.setItem('invite_manually_entered', 'true');
      localStorage.setItem('referral_user_typed', 'true');
      localStorage.setItem('code_hand_typed', 'true');
      localStorage.setItem('manual_input_flag', 'true');
      localStorage.setItem('user_interaction_detected', 'true');
      localStorage.setItem('keyboard_input_simulated', 'true');
      localStorage.setItem('profile_manual_entry', 'true');
      localStorage.setItem('hand_typed_from_profile', 'true');
      
      // IMMEDIATE and SUPREME input field preparation
      setTimeout(() => {
        const comprehensiveInputs = [
          '#referral-code', '#invite-code', '[name="referral"]', '[name="invite"]',
          '[placeholder*="referral"]', '[placeholder*="invite"]', '.referral-input',
          '.invite-input', '#signup-referral', '#registration-referral',
          'input[type="text"]', '[data-referral]', '[data-invite]',
          '.signup-form input', '.registration-form input'
        ];
        
        comprehensiveInputs.forEach(selector => {
          const inputs = document.querySelectorAll(selector);
          inputs.forEach(input => {
            // SUPREME manual typing simulation
            input.value = referralCode;
            input.setAttribute('data-manually-filled', 'true');
            input.setAttribute('data-user-typed', 'true');
            input.setAttribute('data-hand-entered', 'true');
            input.setAttribute('data-source', 'profile_invite_ultra');
            input.setAttribute('data-preservation-level', 'supreme');
            input.setAttribute('data-typing-simulated', 'true');
            input.setAttribute('data-profile-source', 'true');
            
            // ULTIMATE event simulation
            const ultimateEvents = [
              'mousedown', 'mouseup', 'click', 'focus', 'keydown', 
              'keypress', 'input', 'keyup', 'change', 'blur', 
              'paste', 'textInput', 'compositionstart', 'compositionend',
              'focusin', 'focusout', 'select'
            ];
            
            ultimateEvents.forEach(eventType => {
              try {
                const event = new Event(eventType, { 
                  bubbles: true, 
                  cancelable: true, 
                  composed: true 
                });
                input.dispatchEvent(event);
              } catch (e) {}
            });
            
            // SUPREME character-by-character realistic typing
            input.focus();
            setTimeout(() => {
              input.value = '';
              let typedValue = '';
              for (let i = 0; i < referralCode.length; i++) {
                setTimeout(() => {
                  typedValue += referralCode[i];
                  input.value = typedValue;
                  
                  // Simulate REALISTIC human typing for each character
                  const char = referralCode[i];
                  const keyboardEvent = new KeyboardEvent('keydown', {
                    key: char,
                    code: `Key${char.toUpperCase()}`,
                    bubbles: true,
                    cancelable: true
                  });
                  input.dispatchEvent(keyboardEvent);
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  
                }, i * 90); // Human-like typing speed with variation
              }
              
              // Final realistic completion
              setTimeout(() => {
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('blur', { bubbles: true }));
              }, referralCode.length * 90 + 300);
            }, 200);
          });
        });
      }, 10);

      console.log('Profile: ULTRA-ADVANCED preservation system applied');

      // ENHANCED native sharing
      if (navigator.share && /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        try {
          await navigator.share({
            title: 'Join AccessoireDigital',
            text: 'Join me on AccessoireDigital and start processing digital assets!',
            url: inviteLink
          });

          if (typeof showNotification === 'function') {
            showNotification(translator.translate('Invite link shared successfully!'), 'success');
          }

          console.log('Profile: ENHANCED native share successful');
          return;
        } catch (shareError) {
          console.log('Profile: Enhanced native sharing failed:', shareError.message);
        }
      }

      // SUPREME clipboard API with maximum focus handling
      if (navigator.clipboard && window.isSecureContext) {
        // SUPREME focus ensuring with multiple attempts
        for (let i = 0; i < 3; i++) {
          setTimeout(() => {
            window.focus();
            document.body.focus();
            document.documentElement.focus();
            document.body.click();
          }, i * 50);
        }

        try {
          await navigator.clipboard.writeText(inviteLink);

          if (typeof showNotification === 'function') {
            showNotification(
              `${translator.translate('Invite link copied! Referral code:')} ${referralCode}`,
              'success'
            );
          }

          console.log('Profile: SUPREME clipboard success:', inviteLink);
          return;
        } catch (clipboardError) {
          console.log('Profile: Supreme clipboard failed:', clipboardError.message);
        }
      }

      // SUPREME fallback modal
      console.log('Profile: Using SUPREME fallback modal');
      showUltraEnhancedInviteModal(inviteLink, referralCode, 'profile');

    } catch (error) {
      console.error('Error in ULTRA-ENHANCED Profile invite:', error);
      showUltraEnhancedInviteModal(inviteLink, referralCode, 'profile');
    }
  };

  // Enhanced Invite Link Modal - Same as Dashboard showInviteLinkModal
  function showEnhancedInviteLinkModal(inviteLink, referralCode) {
    // Check if dark theme is active
    const isDarkTheme = document.body.classList.contains('dark-theme');

    // Create modal elements - EXACT copy from Dashboard
    const modalOverlay = document.createElement('div');
    modalOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: ${isDarkTheme ? 'var(--card-background, #2a2a2a)' : 'white'};
      padding: 20px;
      border-radius: 8px;
      max-width: 500px;
      width: 90%;
      text-align: center;
      color: ${isDarkTheme ? 'var(--text-color, #ffffff)' : '#333'};
      font-family: Arial, sans-serif;
      position: relative;
      border: ${isDarkTheme ? '1px solid var(--border-color, rgba(255, 255, 255, 0.1))' : 'none'};
    `;

    const title = document.createElement('h3');
    title.textContent = translator.translate('Share Invite Link');
    title.style.marginBottom = '15px';
    title.style.color = isDarkTheme ? 'var(--text-color, #ffffff)' : '#333';

    const linkInput = document.createElement('input');
    linkInput.value = inviteLink;
    linkInput.readOnly = true;
    linkInput.style.cssText = `
      width: 100%;
      padding: 10px;
      border: 1px solid ${isDarkTheme ? 'var(--border-color, #444)' : '#ddd'};
      border-radius: 4px;
      margin: 10px 0;
      font-size: 14px;
      box-sizing: border-box;
      background: ${isDarkTheme ? 'var(--card-background, #333)' : 'white'};
      color: ${isDarkTheme ? 'var(--text-color, #ffffff)' : '#333'};
    `;

    const copyButton = document.createElement('button');
    copyButton.textContent = translator.translate('Copy Link');
    copyButton.style.cssText = `
      background: #4CAF50;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      margin: 10px 5px;
      font-size: 14px;
    `;

    // Close button functionality - X button in top right corner - EXACT copy
    const closeIcon = document.createElement('button');
    closeIcon.innerHTML = '&times;';
    closeIcon.style.cssText = `
      position: absolute;
      top: 10px;
      right: 15px;
      background: none;
      border: none;
      font-size: 28px;
      cursor: pointer;
      color: ${isDarkTheme ? 'var(--text-color, #a0aec0)' : '#666'};
      width: 35px;
      height: 35px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      transition: all 0.3s ease;
      z-index: 10001;
      font-weight: bold;
    `;

    closeIcon.addEventListener('mouseenter', () => {
      closeIcon.style.background = isDarkTheme ? 'rgba(255, 255, 255, 0.1)' : '#f0f0f0';
      closeIcon.style.color = isDarkTheme ? 'var(--text-color, #ffffff)' : '#333';
      closeIcon.style.transform = 'scale(1.1)';
    });

    closeIcon.addEventListener('mouseleave', () => {
      closeIcon.style.background = 'none';
      closeIcon.style.color = isDarkTheme ? 'var(--text-color, #a0aec0)' : '#666';
      closeIcon.style.transform = 'scale(1)';
    });

    closeIcon.addEventListener('click', () => {
      modalOverlay.remove();
    });

    // Copy button functionality - EXACT copy from Dashboard
    copyButton.addEventListener('click', async () => {
      try {
        // Select the text first
        linkInput.select();
        linkInput.setSelectionRange(0, 99999);

        // Try modern clipboard API
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(inviteLink);
        } else {
          // Fallback to execCommand
          document.execCommand('copy');
        }

        copyButton.textContent = translator.translate('Copied!');
        copyButton.style.background = '#4CAF50';

        if (typeof showNotification === 'function') {
          showNotification(
            `${translator.translate('Invite link copied! Referral code:')} ${referralCode}`,
            'success'
          );
        }

        setTimeout(() => {
          modalOverlay.remove();
        }, 1000);

      } catch (copyError) {
        console.error('Enhanced modal copy failed:', copyError);

        // Show manual copy instructions
        alert(`${translator.translate('Please copy this link manually:')}\n\n${inviteLink}`);
      }
    });

    // Close on overlay click - EXACT copy
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        modalOverlay.remove();
      }
    });

    // Assemble modal - EXACT copy
    modalContent.appendChild(closeIcon);
    modalContent.appendChild(title);
    modalContent.appendChild(linkInput);
    modalContent.appendChild(copyButton);
    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);

    // Focus the input for easier manual selection
    setTimeout(() => {
      linkInput.focus();
      linkInput.select();
    }, 100);

    console.log('Enhanced invite modal displayed using complete Dashboard logic');
  }

  // Utility function to copy referral code
  window.copyReferralCode = function(event) {
    // Get the button that was clicked (or find any available copy button)
    let clickedButton = null;

    if (event && event.currentTarget) {
      clickedButton = event.currentTarget;
    } else {
      // Try to find any copy button if no event is provided
      const possibleButtons = [
        document.getElementById('copy-referral'),
        document.getElementById('copy-ref-code'),
        document.querySelector('.copy-referral-btn'),
        document.querySelector('[onclick*="copyReferralCode"]'),
        document.querySelector('button[data-action="copy-referral"]')
      ];

      clickedButton = possibleButtons.find(btn => btn !== null);
    }

    // Find the referral code to copy
    let refCode = null;
    let refCodeElement = null;

    // Check for referrals page specific elements first
    if (clickedButton && (clickedButton.closest('.referral-stats-card') || clickedButton.closest('.referrals-page'))) {
      // For referrals page, try multiple selectors
      refCodeElement = document.querySelector('.referral-code-text') || 
                     document.querySelector('.my-referral-code') ||
                     document.getElementById('referral-code-display') ||
                     document.getElementById('my-referral-code');
    } else if (clickedButton && clickedButton.id === 'copy-referral') {
      refCodeElement = document.getElementById('referral-code-display');
    } else if (clickedButton && clickedButton.closest('.profile-value')) {
      refCodeElement = document.getElementById('profile-referral-code');
    } else {
      // Try multiple possible referral code elements
      const possibleElements = [
        document.getElementById('user-referral-code'),
        document.getElementById('referral-code-display'),
        document.getElementById('profile-referral-code'),
        document.querySelector('.referral-code-display'),
        document.querySelector('.user-referral-code')
      ];

      refCodeElement = possibleElements.find(el => el && el.textContent && el.textContent.trim());
    }

    // Check if element exists and has content
    if (refCodeElement && refCodeElement.textContent) {
      refCode = refCodeElement.textContent.trim();
    }

    // Additional fallback: check for referral code in various other locations
    if (!refCode) {
      const fallbackSelectors = [
        '.referral-code',
        '[data-referral-code]',
        '.my-code',
        '#my-referral-code-text'
      ];

      for (const selector of fallbackSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent && element.textContent.trim()) {
          refCode = element.textContent.trim();
          break;
        }
        if (element && element.getAttribute('data-referral-code')) {
          refCode = element.getAttribute('data-referral-code');
          break;
        }
      }
    }

    // Fallback: try to get referral code from currentUser object
    if (!refCode && currentUser && currentUser.referral_code) {
      refCode = currentUser.referral_code;
    }

    // If still no referral code found, show error
    if (!refCode) {
      console.error('Referral code not found');
      if (typeof showNotification === 'function') {
        showNotification('Referral code not found', 'error');
      }
      return;
    }

    // Copy to clipboard and show confirmation
    navigator.clipboard.writeText(refCode).then(() => {
      // Prevent multiple rapid clicks
      if (clickedButton && clickedButton.disabled) return;

      // Disable button temporarily to prevent rapid clicks
      if (clickedButton) {
        clickedButton.disabled = true;

        // Save original button content to restore later
        // Store original content safely
        const originalContent = Array.from(clickedButton.childNodes).map(node => node.cloneNode(true));

        // Show confirmation checkmark - Secure DOM manipulation
        clickedButton.textContent = '';
        const checkIcon = document.createElement('i');
        checkIcon.className = 'fas fa-check';
        clickedButton.appendChild(checkIcon);
        clickedButton.style.color = '#10b981';

        // Clear any existing timeout for this button
        if (clickedButton.resetTimeout) {
          clearTimeout(clickedButton.resetTimeout);
        }

        // Restore original button after 2 seconds
        clickedButton.resetTimeout = setTimeout(() => {
          clickedButton.textContent = '';
          originalContent.forEach(node => clickedButton.appendChild(node));
          clickedButton.style.color = '';
          clickedButton.disabled = false;
          clickedButton.resetTimeout = null;
        }, 2000);
      }

      // Show success notification
      if (typeof showNotification === 'function') {
        showNotification(translator.translate('Referral code copied!'), 'success');
      }

      console.log('Referral code copied:', refCode);
    }).catch(err => {
      console.error('Failed to copy referral code:', err);
      if (clickedButton) {
        clickedButton.disabled = false; // Re-enable on error
      }
      if (typeof showNotification === 'function') {
        showNotification('Failed to copy referral code', 'error');
      }
    });
  };

  // Initialize referral system
  const referralInvitationSystem = new ReferralInvitationSystem();

  // Make it globally available
  window.referralSystem = referralInvitationSystem;

  // Theme Modal Functions - Integrated with Dashboard and Profile
  function showThemeModal() {
    const modal = document.getElementById('themeModal');
    if (modal) {
      modal.style.display = 'block';
      // Highlight current theme
      const currentTheme = localStorage.getItem('theme') || 'light';
      const options = modal.querySelectorAll('.theme-option');
      options.forEach(option => {
        option.classList.remove('selected');
        if (option.onclick.toString().includes(`'${currentTheme}'`)) {
          option.classList.add('selected');
        }
      });
    }
  }
  // Initialize referral system
 

  // Make it globally available
  window.referralSystem = referralInvitationSystem;

  // Theme Modal Functions - Integrated with Dashboard and Profile
  function showThemeModal() {
    const modal = document.getElementById('themeModal');
    if (modal) {
      modal.style.display = 'block';
      // Highlight current theme
      const currentTheme = localStorage.getItem('theme') || 'light';
      const options = modal.querySelectorAll('.theme-option');
      options.forEach(option => {
        option.classList.remove('selected');
        if (option.onclick.toString().includes(`'${currentTheme}'`)) {
          option.classList.add('selected');
        }
      });
    }
  }

  function closeThemeModal() {
    const modal = document.getElementById('themeModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  function selectTheme(themeMode) {
    console.log('Theme selected:', themeMode);
    
    // Save theme preference
    localStorage.setItem('theme', themeMode);
    
    // Apply theme immediately
    applyTheme(themeMode);
    
    // Update dashboard theme icon
    updateDashboardThemeIcon(themeMode);
    
    // Sync with profile theme selector
    const profileThemeSelect = document.getElementById('night-mode-select');
    if (profileThemeSelect) {
      profileThemeSelect.value = themeMode;
    }
    
    // Close modal
    closeThemeModal();
    
    console.log('Theme changed to:', themeMode);
  }

  function applyTheme(themeMode) {
    const body = document.body;
    const html = document.documentElement;
    
    // Remove existing theme classes
    body.classList.remove('dark-theme', 'light-theme');
    html.classList.remove('dark-theme', 'light-theme');
    
    if (themeMode === 'auto') {
      // Auto mode based on time (6 PM to 6 AM = dark)
      const currentHour = new Date().getHours();
      const isDarkTime = currentHour >= 18 || currentHour < 6;
      
      if (isDarkTime) {
        body.classList.add('dark-theme');
        html.classList.add('dark-theme');
      } else {
        body.classList.add('light-theme');
        html.classList.add('light-theme');
      }
    } else if (themeMode === 'dark') {
      body.classList.add('dark-theme');
      html.classList.add('dark-theme');
    } else {
      body.classList.add('light-theme');
      html.classList.add('light-theme');
    }
  }

  function updateDashboardThemeIcon(themeMode) {
    const dashboardThemeIcon = document.getElementById('dashboard-theme-icon');
    if (dashboardThemeIcon) {
      // Remove existing classes
      dashboardThemeIcon.classList.remove('fa-sun', 'fa-moon', 'fa-adjust');
      
      // Add appropriate icon based on theme
      if (themeMode === 'light') {
        dashboardThemeIcon.classList.add('fa-sun');
      } else if (themeMode === 'dark') {
        dashboardThemeIcon.classList.add('fa-moon');
      } else { // auto
        dashboardThemeIcon.classList.add('fa-adjust');
      }
    }
  }

  // Make theme functions globally available
  window.showThemeModal = showThemeModal;
  window.closeThemeModal = closeThemeModal;
  window.selectTheme = selectTheme;

  // ط¯ط§ظ„ط© طھط­ط¯ظٹط« ط¹ظ…ظ„ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ… ظ…ط¹ ط§ظ„طھظ†ط³ظٹظ‚ ط§ظ„ط°ظƒظٹ
  function updateUserCoins(newCoins) {
    if (currentUser) {
      currentUser.coins = parseFloat(newCoins);
      saveUserSession(currentUser);
    }

    // تحديث جميع عناصر عرض الرصيد بالتنسيق الذكي
    const smartFormatted = formatNumberSmart(newCoins);
    const isBalanceHidden = localStorage.getItem('balanceHidden') === 'true';
    
    // حفظ القيمة في BalancePrivacyManager
    if (window.balancePrivacy && window.balancePrivacy.originalValues) {
      window.balancePrivacy.originalValues.set('#user-coins', smartFormatted);
      window.balancePrivacy.originalValues.set('#profile-coins', smartFormatted);
    }
    
    // تحديث فقط إذا لم يكن مخفياً
    if (!isBalanceHidden) {
      const coinElements = document.querySelectorAll('#user-coins, #profile-coins, .wallet-balance, .balance-display, .user-balance');
      coinElements.forEach(element => {
        if (element) {
          element.textContent = smartFormatted;
        }
      });
    }

    console.log(`User coins updated to: ${smartFormatted} Points`);
  }

  // Global checkProcessingStatus function - moved to global scope for accessibility
  async function checkProcessingStatus() {
    try {
      if (!currentUser || !currentUser.id) {
        console.log("Cannot check processing status: No user is logged in");
        return;
      }

      // Make sure we consistently pass the completed flag to server
      const completedFlag = currentUser.processing_completed === true;
      console.log(`Checking processing status for user ${currentUser.id}, processing_completed=${completedFlag}`);

      // Check for accumulated processing benefits if user is actively processing
      // 🚫 تم نقل التحكم في accumulated-coins إلى calculateAndDisplayLocally فقط
      if (currentUser.processing_active === 1 && !completedFlag) {
        try {
          const accResponse = await fetch(`/api/processing/accumulated/${currentUser.id}`);
          if (accResponse.ok) {
            const accData = await accResponse.json();
            if (accData.success) {
              // 🚫 لا نكتب على accumulated-coins هنا - يتم التحكم فيه من calculateAndDisplayLocally فقط
              // const accumulatedCoinsElement = document.getElementById('accumulated-coins');
              // if (accumulatedCoinsElement && accData.accumulatedReward !== undefined) {
              //   accumulatedCoinsElement.textContent = formatNumberSmart(accData.accumulatedReward);
              // }
              
              // نحفظ القيمة في الذاكرة فقط
              if (accData.accumulatedReward !== undefined) {
                currentUser.processing_accumulated = accData.accumulatedReward;
                saveUserSession(currentUser);
              }
            }
          }
        } catch (accError) {
          console.error('Error fetching accumulated benefits:', accError);
        }
      }

      let endpoint = '/api/relay/status';
      let data;
      let success = false;

      // Try multiple endpoints with better error handling
      const endpoints = [
        '/api/relay/status',
        '/api/processing/status',
        '/api/processing/countdown/status/' + currentUser.id
      ];

      for (const endpoint of endpoints) {
        try {
          console.log(`Trying endpoint: ${endpoint}`);

          // Adjust request method based on endpoint type
          if (endpoint.includes('/countdown/status/')) {
            // This is a GET endpoint
            const response = await fetch(endpoint);

            if (response.ok) {
              data = await response.json();
              success = true;
              console.log(`Successfully used endpoint: ${endpoint}`);
              break;
            }
            console.log(`Endpoint ${endpoint} returned ${response.status}`);
          } else {
            // This is a POST endpoint
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                userId: currentUser.id,
                completed: completedFlag
              })
            });

            if (response.ok) {
              data = await response.json();
              success = true;
              console.log(`Successfully used endpoint: ${endpoint}`);
              break;
            }
            console.log(`Endpoint ${endpoint} returned ${response.status}`);
          }
        } catch (error) {
          console.error(`Error with endpoint ${endpoint}:`, error);
        }
      }

      // If all endpoints failed, use local fallback
      if (!success) {
        console.log('All endpoints failed, using local fallback');

        // Create minimal data object for fallback
        data = {
          success: true,
          processing_active: currentUser.processing_active || 0,
          remaining_seconds: currentUser.processing_remaining_seconds || 0,
          current_time: Date.now(),
          server_time: Date.now(),
          accumulated_processing_benefit: parseFloat(currentUser.processing_accumulated || 0)
        };

        // If we have more detailed data in the user object, use it
        if (currentUser.processing_start_time) {
          data.processing_start_time = parseInt(currentUser.processing_start_time);
        }

        if (currentUser.processing_end_time) {
          data.processing_end_time = parseInt(currentUser.processing_end_time);
        }
      }

      if (data.success) {
        // Process the data and update UI accordingly
        const serverTime = data.current_time || Date.now();
        
        // Update current user with server data but preserve completed flag
        const wasCompleted = currentUser.processing_completed === true;
        
        if (wasCompleted) {
          currentUser.processing_active = 0;
        } else {
          currentUser.processing_active = data.processing_active;
        }
        
        currentUser.processing_end_time = data.processing_end_time;
        currentUser.processing_cooldown = data.processing_cooldown;
        currentUser.processing_completed = wasCompleted;
        currentUser.processing_remaining_seconds = data.remaining_seconds;
        currentUser.processing_start_time = data.processing_start_time;
        
        saveUserSession(currentUser);
        
        // IMPORTANT: Update dashboard timer with fresh data immediately
        console.log(`Updating dashboard timer with fresh server data: ${data.remaining_seconds}s`);
        updateDashboardProcessingTimer(data.remaining_seconds || 0);
        
        
        // dashboard 
        if (data.processing_active === 1 && (data.remaining_seconds || 0) > 0) {
          startDashboardCountdown(data.remaining_seconds);
        }
      }
    } catch (error) {
      console.error('Error checking processing status:', error);
    }
  }

  // ⚡ PRELOAD: تحميل بيانات صفحة Activity مسبقاً عند تسجيل الدخول
  // هذا يجعل الصفحة جاهزة فوراً عند دخولها
  window.activityPreloadData = null;
  
  async function preloadActivityData(userId) {
    if (!userId) return;
    
    console.log('⚡ PRELOAD: جاري تحميل بيانات Activity مسبقاً...');
    
    try {
      // تحميل حالة الجلسة والمكافأة المتراكمة بالتوازي
      const [statusResponse, accumulatedResponse] = await Promise.all([
        fetch(`/api/processing/countdown/status/${userId}`),
        fetch(`/api/processing/accumulated/${userId}`)
      ]);
      
      const statusData = statusResponse.ok ? await statusResponse.json() : null;
      const accumulatedData = accumulatedResponse.ok ? await accumulatedResponse.json() : null;
      
      // حفظ البيانات للاستخدام لاحقاً
      window.activityPreloadData = {
        status: statusData,
        accumulated: accumulatedData,
        timestamp: Date.now()
      };
      
      // تحديث currentUser مباشرة إذا كانت هناك جلسة نشطة
      if (statusData && statusData.processing_active === 1 && statusData.remaining_seconds > 0) {
        currentUser.processing_active = 1;
        currentUser.processing_end_time = Date.now() + (statusData.remaining_seconds * 1000);
        currentUser.processing_remaining_seconds = statusData.remaining_seconds;
        saveUserSession(currentUser);
      }
      
      if (accumulatedData && accumulatedData.success) {
        currentUser.processing_accumulated = accumulatedData.accumulatedReward || 0;
        currentUser.accumulatedReward = accumulatedData.accumulatedReward || 0;
      }
      
      console.log('⚡ PRELOAD: تم تحميل بيانات Activity بنجاح:', {
        hasActiveSession: statusData?.processing_active === 1,
        remainingSeconds: statusData?.remaining_seconds || 0,
        accumulated: accumulatedData?.accumulatedReward || 0
      });
      
    } catch (error) {
      console.warn('⚡ PRELOAD: فشل تحميل بيانات Activity:', error);
      window.activityPreloadData = null;
    }
  }

  // Initialize processing page
  async function initializeActivityPage() {
    const processingButton = document.getElementById('toggle-activity');
    const processingStatus = document.getElementById('activity-status');
    const countdownTimer = document.getElementById('countdown-timer');
    const processingAnimation = document.getElementById('activity-animation');
    const accumulatedCoinsElement = document.getElementById('accumulated-coins');

    // ✅ CRITICAL FIX: تسجيل click handler فوراً - قبل أي return!
    if (processingButton && !processingButton._clickRegistered) {
      processingButton._clickRegistered = true;
      console.log('🎯 REGISTERING CLICK HANDLER');
      
      processingButton.onclick = async function() {
        console.log('🔘 BUTTON CLICKED!');
        if (!currentUser || !currentUser.id) {
          showNotification('جاري التحميل...', 'info');
          return;
        }
        
        const btn = this;
        btn.classList.add('disabled');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + translator.translate('Processing...');
        
        // ✅ دالة بدء النشاط الفعلية
        async function startActivityNow() {
          try {
            const resp = await fetch('/api/processing/countdown/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: currentUser.id })
            });
            const data = await resp.json();
            
            if (resp.ok && data.success) {
              // يتحقق من كلا الاسمين: reward_transferred (server.js) و previous_reward_transferred (simplifier)
              const transferredReward = data.reward_transferred || data.previous_reward_transferred || 0;
              
              // ✅ أولاً: رسالة بدء النشاط بنجاح
              showNotification(translator.translate('Point processing started successfully!'), 'success');
              
              // ✅ ثانياً: رسالة المكافأة السابقة (بعد ثانية واحدة)
              if (transferredReward > 0.0001) {
                setTimeout(() => {
                  showNotification(`${translator.translate('Previous processing reward of')} ${formatNumberSmart(transferredReward)} ${translator.translate('Points has been added to your balance!')}`, 'success');
                }, 1500);
                
                // تحديث الرصيد في الواجهة
                if (data.new_balance !== undefined) {
                  currentUser.coins = data.new_balance;
                  const isBalanceHidden = localStorage.getItem('balanceHidden') === 'true';
                  if (!isBalanceHidden) {
                    const balanceElements = document.querySelectorAll('#user-balance, #dashboard-balance, .user-balance, #user-coins');
                    balanceElements.forEach(el => {
                      if (el) el.textContent = formatNumberSmart(data.new_balance);
                    });
                  }
                }
              }
              
              // ✅ تصفير العرض فوراً قبل أي شيء آخر
              const accumulatedCoinsEl = document.getElementById('accumulated-coins');
              if (accumulatedCoinsEl) {
                accumulatedCoinsEl.textContent = formatNumberSmart(0);
              }
              
              // ✅ لا نغير الـ hashrate أبداً - الإحالات النشطة تبقى كما هي
              // فقط نزيل الـ ad boost attributes لأنه يحتاج مشاهدة إعلان جديد
              const hashrateValue = document.getElementById('hashrate-value');
              const dashboardHashrateValue = document.getElementById('dashboard-hashrate-value');
              
              // فقط إزالة ad boost - لا نغير القيمة الظاهرة
              if (hashrateValue) {
                hashrateValue.removeAttribute('data-ad-boost-active');
                hashrateValue.removeAttribute('data-ad-boost-value');
              }
              if (dashboardHashrateValue) {
                dashboardHashrateValue.removeAttribute('data-ad-boost-active');
                dashboardHashrateValue.removeAttribute('data-ad-boost-value');
              }
              
              // ✅ مسح بيانات الـ ad boost فقط (الإحالات تبقى)
              if (window.localBoostData) {
                // نحافظ على multiplier الإحالات، فقط نزيل ad boost
                window.localBoostData.adBoostActive = false;
                window.localBoostData.startTimeFixed = false;
              }
              
              // تحديث حالة المستخدم
              currentUser.processing_active = 1;
              currentUser.processing_end_time = Date.now() + (data.remaining_seconds * 1000);
              currentUser.processing_start_time_seconds = Math.floor(Date.now() / 1000);
              currentUser.processing_accumulated = 0;
              currentUser.accumulatedReward = 0;
              saveUserSession(currentUser);
              
              // تحديث الزر
              btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + translator.translate('Activity...');
              
              // بدء العد التنازلي والتجميع
              startCountdown(data.remaining_seconds * 1000);
              startGradualAccumulation();
            } else if (resp.status === 409) {
              showNotification(translator.translate('You already have an active processing session'), 'info');
              if (data.remaining_seconds > 0) startCountdown(data.remaining_seconds * 1000);
            } else {
              showNotification(data.error || translator.translate('Error'), 'error');
              btn.classList.remove('disabled');
              btn.disabled = false;
              btn.innerHTML = '<i class="fas fa-play"></i> ' + translator.translate('Start Activity');
            }
          } catch (e) {
            console.error(e);
            btn.classList.remove('disabled');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-play"></i> ' + translator.translate('Start Activity');
          }
        }
        
        // ✅ عرض الإعلان أولاً ثم بدء النشاط
        console.log('📺 التحقق من حالة الإعلان...');
        console.log('📺 showActivityAd:', typeof window.showActivityAd);
        console.log('📺 canShowActivityAd:', typeof window.canShowActivityAd, window.canShowActivityAd ? window.canShowActivityAd() : 'N/A');
        console.log('📺 activityAdEvent:', !!window.activityAdEvent);
        
        if (window.showActivityAd) {
          console.log('📺 محاولة عرض الإعلان...');
          const adShown = window.showActivityAd(function() {
            console.log('📺 الإعلان انتهى - بدء النشاط الآن');
            startActivityNow();
          });
          
          if (!adShown) {
            console.log('📺 الإعلان لم يُعرض - بدء النشاط مباشرة');
            // الـ callback تم تنفيذه بالفعل داخل showActivityAd
          }
        } else {
          console.log('📺 نظام الإعلانات غير متاح - بدء النشاط مباشرة');
          startActivityNow();
        }
      };
    }

    // ✅ تحديد حالة الجلسة من البيانات المحلية
    const serverNow = Date.now();
    const processingEndTime = parseInt(currentUser?.processing_end_time) || 0;
    const sessionActive = processingEndTime > 0 && serverNow < processingEndTime;
    
    console.log('🔍 initializeActivityPage:', {
      processingEndTime,
      serverNow,
      sessionActive,
      diff: processingEndTime - serverNow
    });

    // ✅ CRITICAL: فتح الزر فوراً إذا انتهت الجلسة - قبل أي return
    if (processingButton && !sessionActive) {
      console.log('🔓 Session ended/inactive - Enabling button IMMEDIATELY');
      processingButton.classList.remove('disabled');
      processingButton.disabled = false;
      processingButton.removeAttribute('disabled');
      processingButton.style.pointerEvents = 'auto';
      processingButton.style.opacity = '1';
      processingButton.setAttribute('data-server-verified', 'true');
      
      // تحديث نص الزر
      processingButton.textContent = '';
      const icon = document.createElement('i');
      icon.className = 'fas fa-play';
      processingButton.appendChild(icon);
      processingButton.appendChild(document.createTextNode(' ' + translator.translate('Start Activity')));
      
      // تحديث الحالة
      if (processingStatus) {
        processingStatus.textContent = translator.translate('Processing available');
      }
      if (processingAnimation) {
        processingAnimation.style.display = 'none';
      }
      if (countdownTimer) {
        countdownTimer.textContent = '00:00:00';
      }
      
      // ✅ جلب وعرض accumulatedReward من السيرفر
      if (currentUser && currentUser.id && accumulatedCoinsElement) {
        (async () => {
          try {
            const accResp = await fetch(`/api/processing/accumulated/${currentUser.id}`);
            if (accResp.ok) {
              const accData = await accResp.json();
              // عرض accumulatedReward مباشرة
              const accumulatedReward = parseFloat(accData.accumulatedReward || 0);
              
              if (accumulatedReward > 0) {
                accumulatedCoinsElement.textContent = formatNumberSmart(accumulatedReward);
                console.log('✅ Displaying saved reward:', accumulatedReward);
                // حفظ في الذاكرة
                currentUser.processing_accumulated = accumulatedReward;
                currentUser.accumulatedReward = accumulatedReward;
              }
            }
          } catch (e) {
            console.warn('Could not fetch accumulated reward:', e);
          }
        })();
      }
      
      // مسح البيانات القديمة (لكن ليس المكافأة!)
      if (currentUser) {
        currentUser.processing_active = 0;
        currentUser.processing_end_time = 0;
        saveUserSession(currentUser);
      }
      
      // ✅ إذا الجلسة منتهية، لا نحتاج لتهيئة أخرى - الزر جاهز
      return;
    }

    // If processing interval is already running, don't reinitialize
    // This prevents the counter from resetting when returning to the activity page
    if (activityInterval) {
      console.log('Earning interval already running, skipping reinitialization');
      return;
    }

    // Check if we already have gradual reward or accumulation intervals running
    if (window.gradualRewardInterval || window.accumulationInterval) {
      console.log('Processing intervals already active, skipping reinitialization');
      return;
    }

    // Track page transitions to avoid unnecessary reloads
    window.lastActivityPageVisit = window.lastActivityPageVisit || 0;
    const now = Date.now();
    const isQuickReturn = (now - window.lastActivityPageVisit) < 5000; // Within 5 seconds
    window.lastActivityPageVisit = now;

    if (isQuickReturn && document.getElementById('countdown-timer') && 
        document.getElementById('countdown-timer').textContent !== 'Loading...' &&
        document.getElementById('countdown-timer').textContent !== '00:00:00') {
      console.log('Quick return to activity page, preserving current timer state');
      return;
    }

    // Helper function to update button safely
    const updateButtonSafely = (iconClass, text) => {
      processingButton.textContent = '';
      const icon = document.createElement('i');
      icon.className = iconClass;
      processingButton.appendChild(icon);
      processingButton.appendChild(document.createTextNode(' ' + text));
    };

    // ⚡ FAST: استخدام البيانات المحملة مسبقاً إذا كانت متاحة وحديثة (أقل من 30 ثانية)
    const preloadedData = window.activityPreloadData;
    const preloadFresh = preloadedData && (Date.now() - preloadedData.timestamp) < 30000;
    
    if (preloadFresh && preloadedData.status) {
      console.log('⚡ FAST: استخدام البيانات المحملة مسبقاً');
      
      // عرض المكافأة المتراكمة فوراً
      if (preloadedData.accumulated && preloadedData.accumulated.success) {
        const displayedReward = parseFloat(preloadedData.accumulated.accumulatedReward || 0);
        if (accumulatedCoinsElement && displayedReward > 0) {
          accumulatedCoinsElement.textContent = formatNumberSmart(displayedReward);
        }
      }
      
      if (preloadedData.status.processing_active === 1 && preloadedData.status.remaining_seconds > 0) {
        // جلسة نشطة - عرض العد التنازلي
        const remainingMs = preloadedData.status.remaining_seconds * 1000;
        const endTime = Date.now() + remainingMs;
        
        processingStatus.textContent = translator.translate('Processing in progress...');
        updateButtonSafely('fas fa-spinner fa-spin', translator.translate('Activity...'));
        processingButton.classList.add('disabled');
        processingButton.disabled = true;
        processingAnimation.style.display = 'block';
        startCountdown(remainingMs, Date.now() - ((86400 - preloadedData.status.remaining_seconds) * 1000), endTime);
        if (!window.accumulationInterval) {
          startGradualAccumulation();
        }
        
        // مسح البيانات المحملة مسبقاً
        window.activityPreloadData = null;
        return;
      } else {
        // لا توجد جلسة نشطة - تفعيل الزر
        processingStatus.textContent = translator.translate('Processing available');
        updateButtonSafely('fas fa-play', translator.translate('Start Activity'));
        processingButton.classList.remove('disabled');
        processingButton.disabled = false;
        processingButton.setAttribute('data-server-verified', 'true');
        if (countdownTimer) countdownTimer.textContent = '24:00:00';
        processingAnimation.style.display = 'none';
        
        // مسح البيانات المحملة مسبقاً
        window.activityPreloadData = null;
        return;
      }
    }

    // استخدام البيانات المحلية للعرض السريع فقط
    const localNow = Date.now();
    const localEndTime = parseInt(currentUser.processing_end_time) || 0;
    const processingStartTime = parseInt(currentUser.processing_start_time) || 0;

    if (localEndTime && localNow < localEndTime) {
      // جلسة نشطة محلياً - عرض العد التنازلي
      const timeLeft = localEndTime - localNow;
      processingStatus.textContent = translator.translate('Processing in progress...');
      updateButtonSafely('fas fa-spinner fa-spin', translator.translate('Activity...'));
      processingButton.classList.add('disabled');
      processingButton.disabled = true;
      processingAnimation.style.display = 'block';
      startCountdown(timeLeft, processingStartTime, processingEndTime);
      if (!window.accumulationInterval) {
        startGradualAccumulation(processingStartTime, processingEndTime);
      }
    } else {
      // ✅ للمستخدمين الجدد أو بدون جلسة نشطة - تفعيل الزر مباشرة
      // 🔒 لكن نتحقق من السيرفر فقط إذا كان لدينا userId
      
      if (!currentUser || !currentUser.id) {
        // 🔒 مستخدم جديد بدون ID - الزر يبقى مغلقاً حتى يتم إنشاء المستخدم
        console.log('🔒 No user ID yet, button stays disabled');
        processingStatus.textContent = 'Loading...';
        updateButtonSafely('fas fa-spinner fa-spin', translator.translate('Loading...'));
        processingButton.classList.add('disabled');
        processingButton.disabled = true;
        processingButton.setAttribute('data-server-verified', 'false');
      } else {
        // مستخدم موجود - نتحقق من السيرفر
        processingStatus.textContent = 'Checking status...';
        updateButtonSafely('fas fa-spinner fa-spin', translator.translate('Loading...'));
        processingButton.classList.add('disabled');
        processingButton.disabled = true;
        processingButton.setAttribute('data-server-verified', 'false');
        
        // 🔒 CRITICAL: التحقق من السيرفر قبل تفعيل الزر
        try {
          const verifyResponse = await fetchWithTimeout(`/api/processing/countdown/status/${currentUser.id}`, {}, 10000);
          if (verifyResponse.ok) {
            const verifyData = await verifyResponse.json();
            if (verifyData.processing_active === 1 && verifyData.remaining_seconds > 0) {
              // 🔒 جلسة نشطة على السيرفر - تحديث المحلي
              console.log(`🔒 SERVER CHECK: Active session found (${verifyData.remaining_seconds}s remaining)`);
              const serverEndTime = Date.now() + (verifyData.remaining_seconds * 1000);
              currentUser.processing_active = 1;
              currentUser.processing_end_time = serverEndTime;
              saveUserSession(currentUser);
              
              processingStatus.textContent = translator.translate('Processing in progress...');
              updateButtonSafely('fas fa-spinner fa-spin', translator.translate('Activity...'));
              processingButton.classList.add('disabled');
              processingButton.disabled = true;
              processingAnimation.style.display = 'block';
              startCountdown(verifyData.remaining_seconds * 1000, Date.now() - ((86400 - verifyData.remaining_seconds) * 1000), serverEndTime);
              if (!window.accumulationInterval) {
                startGradualAccumulation();
              }
            } else {
              // ✅ لا توجد جلسة نشطة - يمكن تفعيل الزر
              console.log('✅ SERVER CHECK: No active session, enabling button');
              processingStatus.textContent = translator.translate('Processing available');
              updateButtonSafely('fas fa-play', translator.translate('Start Activity'));
              processingButton.classList.remove('disabled');
              processingButton.disabled = false;
              processingButton.setAttribute('data-server-verified', 'true');
            }
          } else {
            // ✅ خطأ في الاتصال - نفتح الزر لأن السيرفر سيحمي
            console.log('⚠️ SERVER CHECK: Connection error, enabling button (server will protect)');
            processingStatus.textContent = translator.translate('Processing available');
            updateButtonSafely('fas fa-play', translator.translate('Start Activity'));
            processingButton.classList.remove('disabled');
            processingButton.disabled = false;
            processingButton.setAttribute('data-server-verified', 'false');
          }
        } catch (error) {
          console.error('⚠️ SERVER CHECK ERROR:', error);
          // ✅ خطأ في الاتصال - نفتح الزر لأن السيرفر سيحمي
          processingStatus.textContent = translator.translate('Processing available');
          updateButtonSafely('fas fa-play', translator.translate('Start Activity'));
          processingButton.classList.remove('disabled');
          processingButton.disabled = false;
          processingButton.setAttribute('data-server-verified', 'false');
        }
      }
      if (countdownTimer) countdownTimer.textContent = '24:00:00';
      processingAnimation.style.display = 'none';
    }

    // ✅ CRITICAL FIX: Always fetch and display accumulated reward from server
    // This ensures the value persists across page reloads
    if (currentUser && currentUser.id) {
      try {
        const accResponse = await fetch(`/api/processing/accumulated/${currentUser.id}`);
        if (accResponse.ok) {
          const accData = await accResponse.json();
          if (accData.success) {
            const displayedReward = parseFloat(accData.accumulatedReward || 0);
            if (accumulatedCoinsElement) {
              if (displayedReward > 0) {
                accumulatedCoinsElement.textContent = formatNumberSmart(displayedReward);
                // Save to session for quick access
                currentUser.processing_accumulated = displayedReward;
                currentUser.accumulatedReward = displayedReward;
                saveUserSession(currentUser);
                console.log(`✅ Loaded accumulated reward from server: ${formatNumberSmart(displayedReward)}`);
              } else {
                accumulatedCoinsElement.textContent = formatNumberSmart(0);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error fetching accumulated reward on page load:', error);
        // Fallback to local data if server fetch fails
        const localAccumulated = parseFloat(user.processing_accumulated || user.accumulatedReward || 0);
        if (accumulatedCoinsElement && localAccumulated > 0) {
          accumulatedCoinsElement.textContent = formatNumberSmart(localAccumulated);
        }
      }
    }



   // Track when the processing button was last clicked to differentiate between
   // automatic page loads and manual user interactions
   window.lastProcessingButtonClick = 0;
   
   // ✅ DEBUG: Log button state at initialization
   console.log('🎯 BUTTON INITIALIZED:', {
     id: processingButton.id,
     disabled: processingButton.disabled,
     classList: Array.from(processingButton.classList),
     html: processingButton.innerHTML.substring(0, 50)
   });

   // Processing button click handler - Simple and clean
processingButton.addEventListener('click', async function(e) {
  console.log('🔘 BUTTON CLICKED!');
  
  // ✅ SIMPLE: فقط تحقق من userId
  if (!currentUser?.id) {
    showNotification('Please wait, loading user data...', 'info');
    return;
  }
  
  console.log('✅ Starting activity for user:', currentUser.id);

  // ✅ الحماية موجودة في السيرفر (/api/processing/countdown/start)
  // السيرفر سيمنع أي محاولة لبدء جلسة مزدوجة (409 Conflict)
  // لذلك لا حاجة للتحقق المسبق هنا - نستمر مباشرة للبدء السلس
  console.log('✅ Proceeding to start processing (server will validate)...');

  // ❌ تم إزالة العلم المعقد - السيرفر يحمي من الجلسات المزدوجة
  
  // Disable button immediately to prevent double clicks
  processingButton.classList.add('disabled');
  processingButton.disabled = true;
  const originalButtonHTML = processingButton.innerHTML;

  // ============================================
  // 🎬 عرض الإعلان أولاً قبل بدء النشاط (مستقل عن Boost)
  // ============================================
  let adWasShown = false;
  if (window.canShowActivityAd && window.canShowActivityAd()) {
    console.log('📺 عرض إعلان Activity قبل بدء النشاط...');
    adWasShown = true;
    
    // 🔄 انتظار إغلاق الإعلان (لا نوقف التدفق لأكثر من 15 ثانية)
    await new Promise((resolve) => {
      const adShown = window.showActivityAd(() => {
        console.log('📺 تم إغلاق الإعلان - callback executed');
        resolve();
      });
      
      // إذا لم يُعرض الإعلان، نستمر مباشرة
      if (!adShown) {
        console.log('📺 الإعلان لم يُعرض - متابعة');
        resolve();
      }
      
      // timeout احتياطي 15 ثانية (كافي للإعلان)
      setTimeout(resolve, 15000);
    });
  }

  try {
    // Define formatSecondsToTime function here to ensure it's available when needed
    const formatSecondsToTime = (seconds) => {
      // Ensure we're dealing with a reasonable number
      seconds = Math.min(Math.max(0, Math.floor(seconds)), 86400); // Limit to 24 hours max and ensure integer

      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;

      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Record this button click time
    window.lastProcessingButtonClick = Date.now();
    console.log('PROCESSING BUTTON CLICKED - Starting processing session');

    // ✅ لا نستدعي /complete هنا!
    // السيرفر في /api/processing/countdown/start ينقل المتراكم تلقائياً
    // هذا يمنع الإضافة المزدوجة للرصيد
    console.log('[SCRIPT] Proceeding directly to /start (server handles accumulated transfer)');
    
    // Reset all timers before starting new processing session
    if (activityInterval) {
      clearInterval(activityInterval);
      activityInterval = null;
      console.log('Cleared existing processing interval');
    }

    if (window.gradualRewardInterval) {
      clearInterval(window.gradualRewardInterval);
      window.gradualRewardInterval = null;
    }

    if (window.accumulationInterval) {
      clearInterval(window.accumulationInterval);
      window.accumulationInterval = null;
    }
    if (window.boostCheckInterval) {
      clearInterval(window.boostCheckInterval);
      window.boostCheckInterval = null;
    }

    // Helper function to update button safely
    const updateButtonSafely = (iconClass, text) => {
      processingButton.textContent = '';
      const icon = document.createElement('i');
      icon.className = iconClass;
      processingButton.appendChild(icon);
      processingButton.appendChild(document.createTextNode(' ' + text));
    };

    // Show starting state
    processingStatus.textContent = 'Starting processing...';
    updateButtonSafely('fas fa-spinner fa-spin', translator.translate('Starting...'));
    processingButton.classList.add('disabled');

    // STEP 2: إرسال طلب بدء الجلسة للسيرفر
    console.log(`[SCRIPT] Sending start request to server for user ${currentUser.id}`);
    
    const response = await fetchWithTimeout('/api/processing/countdown/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    }, 10000); // timeout آمن 10 ثواني

    console.log(`[SCRIPT] Processing start response status: ${response.status}`);

    // 🔒 SECURITY: Handle 409 Conflict - session already active
    if (response.status === 409) {
      const conflictData = await response.json();
      console.log(`🔒 BLOCKED BY SERVER: Session already active (${conflictData.remaining_seconds}s remaining)`);
      showNotification(translator.translate('You already have an active processing session'), 'warning');
      
      // Update local state to match server
      if (conflictData.remaining_seconds > 0) {
        currentUser.processing_active = 1;
        currentUser.processing_end_time = Date.now() + (conflictData.remaining_seconds * 1000);
        saveUserSession(currentUser);
        
        // Restart countdown with correct time
        processingAnimation.style.display = 'block';
        startCountdown(conflictData.remaining_seconds * 1000, 
          currentUser.processing_start_time, 
          currentUser.processing_end_time);
        
        // Restart accumulation
        if (!window.accumulationInterval) {
          startGradualAccumulation();
        }
      }
      
      // 🔒 الزر يبقى مغلقاً لأن هناك جلسة نشطة
      processingButton.classList.add('disabled');
      processingButton.disabled = true;
      // window.processingSessionStarting = false; // تم إزالته
      return;
    }

    // 🔒 SECURITY: Handle 429 Too Many Requests - rapid start attempt
    if (response.status === 429) {
      console.log(`🔒 BLOCKED BY SERVER: Too many attempts`);
      
      // 🔒 الزر يبقى مغلقاً
      processingButton.classList.add('disabled');
      processingButton.disabled = true;
      // window.processingSessionStarting = false; // تم إزالته
      return;
    }

    if (!response.ok) {
      console.log(`[SCRIPT] Processing start failed: ${response.status}`);
      
      // 🔒 خطأ - الزر يبقى مغلقاً
      processingButton.classList.add('disabled');
      processingButton.disabled = true;
      // window.processingSessionStarting = false; // تم إزالته
      return;
    }

    const data = await response.json();
    console.log(`[SCRIPT] Server approved start:`, data);

    if (data.success) {
      // ✅ السيرفر وافق على بدء جلسة جديدة
      
      // ✅ تحديث الرصيد من السيرفر دائماً
      if (data.new_balance !== undefined) {
        console.log(`💰 Updating balance from server: ${data.new_balance}`);
        
        // ✅ إذا تم نقل مكافأة متراكمة، اعرض إشعار
        if (data.reward_transferred && data.reward_transferred > 0.0001) {
          console.log(`💰 Server transferred accumulated reward: ${data.reward_transferred}`);
          showNotification(`${translator.translate('Previous processing reward of')} ${formatNumberSmart(data.reward_transferred)} ${translator.translate('Points has been added to your balance!')}`, 'success');
        }
        
        // تحديث الرصيد في الذاكرة
        currentUser.coins = data.new_balance;
        saveUserSession(currentUser);
        
        // ✅ تحديث جميع عناصر الرصيد في الواجهة فوراً (مع مراعاة التشفير)
        const formattedBalance = formatNumberSmart(data.new_balance);
        const isBalanceHidden = localStorage.getItem('balanceHidden') === 'true';
        
        // ✅ حفظ القيمة في BalancePrivacyManager دائماً (حتى لو مخفي)
        if (window.balancePrivacy && window.balancePrivacy.originalValues) {
          window.balancePrivacy.originalValues.set('#user-coins', formattedBalance);
          window.balancePrivacy.originalValues.set('#profile-coins', formattedBalance);
          window.balancePrivacy.originalValues.set('#Transfer-balance', formattedBalance);
        }
        
        // تحديث العناصر فقط إذا لم يكن مخفياً
        if (!isBalanceHidden) {
          const userCoinsElements = document.querySelectorAll('#user-coins');
          userCoinsElements.forEach(el => { if (el) el.textContent = formattedBalance; });
          
          const profileCoins = document.getElementById('profile-coins');
          if (profileCoins) profileCoins.textContent = formattedBalance;
          
          const dashboardBalance = document.getElementById('dashboard-balance');
          if (dashboardBalance) dashboardBalance.textContent = formattedBalance;
          
          const walletBalance = document.getElementById('wallet-balance');
          if (walletBalance) walletBalance.textContent = formattedBalance;
          
          // تحديث أي عناصر أخرى بالـ class
          document.querySelectorAll('.points-value, .balance-amount, [data-balance]').forEach(el => {
            if (el) el.textContent = formattedBalance;
          });
        }
        
        console.log(`✅ Balance UI updated to: ${formattedBalance}`);
        
        // ✅ إطلاق حدث تحديث الرصيد للأنظمة الأخرى
        window.dispatchEvent(new CustomEvent('balanceUpdated', {
          detail: { 
            newBalance: data.new_balance, 
            formattedBalance: formattedBalance,
            rewardAmount: data.reward_transferred || 0
          }
        }));
      }
      
      // Reset all processing completion flags
      currentUser.processing_completed = false;
      window.processingCompletionRecorded = false;
      window.processingRewardRecorded = false;
      window.processingSessionStartTime = Date.now();
      
      // Update user state with server data
      currentUser.processing_active = 1;
      currentUser.processing_remaining_seconds = data.remaining_seconds;
      currentUser.processing_accumulated = 0;
      currentUser.accumulatedReward = 0;
      currentUser.processing_end_time = Date.now() + (data.remaining_seconds * 1000);
      currentUser.processing_start_time_seconds = Math.floor(Date.now() / 1000);
      
      // ✅ FIXED: Save session referral data for localBoostData initialization
      currentUser.session_active_referrals = data.activeReferrals || 0;
      currentUser.session_ad_boost = false; // Always false at start
      
      saveUserSession(currentUser);

      // Update UI
      processingStatus.textContent = translator.translate('Processing in progress...');
      updateButtonSafely('fas fa-spinner fa-spin', translator.translate('Activity...'));
      processingButton.classList.add('disabled');
      processingAnimation.style.display = 'block';

      // Reset accumulated display
      if (document.getElementById('accumulated-coins')) {
        document.getElementById('accumulated-coins').textContent = formatNumberSmart(0);
      }

      // ✅ FIXED: عرض الـ hashrate الصحيح فوراً من بيانات السيرفر
      const hashrateValue = document.getElementById('hashrate-value');
      const dashboardHashrateValue = document.getElementById('dashboard-hashrate-value');
      const serverHashrate = data.hashrate || 10.0;
      const serverReferrals = data.activeReferrals || 0;
      
      if (hashrateValue) {
        hashrateValue.textContent = serverHashrate.toFixed(1);
        hashrateValue.removeAttribute('data-ad-boost-active');
        hashrateValue.removeAttribute('data-ad-boost-value');
        if (serverReferrals > 0) {
          hashrateValue.style.color = '#38b2ac';
        } else {
          hashrateValue.style.color = '';
        }
      }
      if (dashboardHashrateValue) {
        dashboardHashrateValue.textContent = serverHashrate.toFixed(1);
        dashboardHashrateValue.removeAttribute('data-ad-boost-active');
        dashboardHashrateValue.removeAttribute('data-ad-boost-value');
        if (serverReferrals > 0) {
          dashboardHashrateValue.style.color = '#38b2ac';
        } else {
          dashboardHashrateValue.style.color = '';
        }
      }
      
      console.log(`✅ Session started with hashrate: ${serverHashrate} MH/s (${serverReferrals} referrals, no ad boost)`);

      // Start countdown and accumulation
      startCountdown(data.remaining_seconds * 1000);
      startGradualAccumulation();

      // window.processingSessionStarting = false; // تم إزالته
      
      // ✅ إشعار بدء النشاط - فوري بدون تأخير
      showNotification(translator.translate('Point processing started successfully!'), 'success');
      
      console.log(`✅ Processing session started successfully`);
    } else {
      // Server returned success=false
      console.log(`[SCRIPT] Server rejected start: ${data.error}`);
      showNotification(data.error || 'Failed to start processing', 'error');
      processingStatus.textContent = translator.translate('Processing available');
      updateButtonSafely('fas fa-play', translator.translate('Start Activity'));
      // ✅ السيرفر رفض لكن أكد أنه لا توجد جلسة - يمكن فتح الزر
      processingButton.classList.remove('disabled');
      processingButton.disabled = false;
      processingAnimation.style.display = 'none';
      // window.processingSessionStarting = false; // تم إزالته
    }
  } catch (error) {
    console.error('❌ Error during processing (connection/timeout):', error);
    
    // ✅ عند حدوث خطأ - نتحقق من السيرفر لمعرفة الحالة الحقيقية
    try {
      const statusCheck = await fetch(`/api/processing/countdown/status/${currentUser.id}`);
      if (statusCheck.ok) {
        const statusData = await statusCheck.json();
        if (statusData.success && statusData.processing_active && statusData.remaining_seconds > 0) {
          // ✅ هناك جلسة نشطة - نبدأ العد التنازلي
          console.log('✅ Active session found after error, resuming...');
          startCountdown(statusData.remaining_seconds * 1000);
          startGradualAccumulation();
          processingButton.classList.add('disabled');
          processingButton.disabled = true;
        } else {
          // ✅ لا توجد جلسة نشطة - نفتح الزر
          console.log('✅ No active session, enabling button');
          processingButton.classList.remove('disabled');
          processingButton.disabled = false;
          processingAnimation.style.display = 'none';
        }
      } else {
        // ✅ خطأ في التحقق - نفتح الزر للمحاولة مرة أخرى
        processingButton.classList.remove('disabled');
        processingButton.disabled = false;
        processingAnimation.style.display = 'none';
      }
    } catch (checkError) {
      // ✅ فشل التحقق - نفتح الزر
      processingButton.classList.remove('disabled');
      processingButton.disabled = false;
      processingAnimation.style.display = 'none';
    }
    
    // Clear the starting flag
    // window.processingSessionStarting = false; // تم إزالته
  }
});

// Function to handle gradual accumulation display - 🚀 OPTIMIZED CLIENT-SIDE CALCULATION
function startGradualAccumulation() {
  console.log('Starting OPTIMIZED CLIENT-SIDE accumulation system (no server polling)');

  // Always clear any existing intervals to prevent duplicates
  if (window.accumulationInterval) {
    clearInterval(window.accumulationInterval);
    window.accumulationInterval = null;
  }
  if (window.boostCheckInterval) {
    clearInterval(window.boostCheckInterval);
    window.boostCheckInterval = null;
  }

  const accumulatedCoinsElement = document.getElementById('accumulated-coins');
  const hashrateElement = document.getElementById('hashrate-display');
  const hashrateValueElement = document.getElementById('hashrate-value');

  // 🚀 Local state for client-side calculation - متاح عالمياً للتحديث الفوري
  // ✅ FIXED: Use session start data if available (from currentUser set by start response)
  const initialReferrals = parseInt(currentUser.session_active_referrals) || 0;
  const initialMultiplier = initialReferrals > 0 ? (1.0 + initialReferrals * 0.04) : 1.0;
  
  window.localBoostData = {
    startTimeSec: Math.floor(currentUser.processing_start_time_seconds || Date.now() / 1000),
    multiplier: initialMultiplier, // Use referrals-based multiplier from start
    activeReferrals: initialReferrals,
    adBoostActive: false, // Always false at session start
    startTimeFixed: false  // 🔒 لمنع تغيير وقت البداية بعد الضبط
  };
  const localBoostData = window.localBoostData;
  
  console.log(`✅ localBoostData initialized: multiplier=${initialMultiplier}, referrals=${initialReferrals}, adBoost=false`);

  // Start with zero display
  if (accumulatedCoinsElement) {
    accumulatedCoinsElement.textContent = formatNumberSmart(0);
  }

  // Refresh processing history to show new Collecting... entry
  addProcessingHistoryEntry();

  // 🚀 LIGHTWEIGHT: Fetch boost data only (no accumulated calculation on server)
  async function fetchBoostData() {
    try {
      if (!currentUser || !currentUser.id) return null;

      const response = await fetch(`/api/processing/accumulated/${currentUser.id}`);
      if (!response.ok) return null;

      const data = await response.json();
      if (data.success) {
        localBoostData.activeReferrals = data.activeReferrals || 0;
        localBoostData.adBoostActive = data.adBoostActive || false;
        
        let multiplier = 1.0;
        if (localBoostData.activeReferrals > 0) {
          multiplier += localBoostData.activeReferrals * 0.04;
        }
        if (localBoostData.adBoostActive) {
          multiplier += 0.12;
        }
        localBoostData.multiplier = multiplier;

        // 🔒 تثبيت وقت البداية مرة واحدة فقط - لمنع القفزات
        if (!localBoostData.startTimeFixed) {
          const userStartTime = parseInt(currentUser.processing_start_time_seconds) || 0;
          if (userStartTime > 0) {
            localBoostData.startTimeSec = userStartTime;
          }
          localBoostData.startTimeFixed = true;
        }

        console.log(`[BOOST UPDATE] Multiplier: ${multiplier.toFixed(2)}x, Referrals: ${localBoostData.activeReferrals}, AdBoost: ${localBoostData.adBoostActive}`);
        return data;
      }
      return null;
    } catch (error) {
      console.error('Error fetching boost data:', error);
      return null;
    }
  }

  // 🚀 CLIENT-SIDE CALCULATION - runs every second WITHOUT server request
  let lastCalculatedValue = 0;
  let lastElapsedSec = 0; // 🔒 حماية من تراجع الوقت
  
  function calculateAndDisplayLocally() {
    const nowSec = Math.floor(Date.now() / 1000);
    const processingDuration = 24 * 60 * 60; // 86400 ثانية
    const elapsedSec = nowSec - localBoostData.startTimeSec;
    
    if (elapsedSec <= 0) return;
    
    // 🔒 CRITICAL: منع التراجع في الوقت (حماية من تغيير ساعة الجهاز)
    const safeElapsedSec = Math.max(elapsedSec, lastElapsedSec);
    lastElapsedSec = safeElapsedSec;
    
    // حساب المكافأة الأساسية مع الـ boost
    const baseReward = 0.25;
    const boostedReward = baseReward * localBoostData.multiplier;
    
    // ✅ حساب دقيق: المكافأة لكل ثانية
    // 0.25 ACCESS ÷ 86400 ثانية = 0.0000028935... ACCESS/ثانية
    // مع الـ boost: (0.25 × multiplier) ÷ 86400
    const rewardPerSecond = boostedReward / processingDuration;
    
    let calculatedAccumulated;
    
    // ✅ FIX: إذا مر 24 ساعة أو أكثر، أعطِ القيمة الكاملة
    // عند الوصول للثانية الأخيرة (00:00:00) نعرض القيمة الكاملة
    if (safeElapsedSec >= processingDuration) {
      calculatedAccumulated = boostedReward; // 100% من المكافأة
    }
    // الحساب العادي: عدد الثواني × المكافأة لكل ثانية
    else {
      calculatedAccumulated = rewardPerSecond * safeElapsedSec;
      // تقريب لـ 8 أماكن عشرية
      calculatedAccumulated = Math.round(calculatedAccumulated * 100000000) / 100000000;
    }
    
    // 🔒 CRITICAL: منع التراجع في القيمة نهائياً
    if (calculatedAccumulated < lastCalculatedValue) {
      calculatedAccumulated = lastCalculatedValue;
    }
    lastCalculatedValue = calculatedAccumulated;

    // تحديث العرض
    if (accumulatedCoinsElement) {
      accumulatedCoinsElement.textContent = formatNumberSmart(calculatedAccumulated);
    }

    // ✅ تحديث hashrate في Activity و Dashboard معاً
    const totalHashrate = 10.0 * localBoostData.multiplier;
    
    if (hashrateElement && hashrateValueElement) {
      hashrateElement.style.display = 'flex';
      hashrateElement.style.visibility = 'visible';
      hashrateElement.style.opacity = '1';
      hashrateValueElement.textContent = totalHashrate.toFixed(1);
      
      if (localBoostData.adBoostActive) {
        hashrateValueElement.setAttribute('data-ad-boost-active', 'true');
        hashrateValueElement.setAttribute('data-ad-boost-value', '1.2');
      } else {
        hashrateValueElement.removeAttribute('data-ad-boost-active');
        hashrateValueElement.removeAttribute('data-ad-boost-value');
      }
    }
    
    // ✅ تحديث Dashboard hashrate أيضاً
    const dashboardHashrateValue = document.getElementById('dashboard-hashrate-value');
    if (dashboardHashrateValue) {
      dashboardHashrateValue.textContent = totalHashrate.toFixed(1);
      if (localBoostData.adBoostActive) {
        dashboardHashrateValue.setAttribute('data-ad-boost-active', 'true');
        dashboardHashrateValue.setAttribute('data-ad-boost-value', '1.2');
      } else {
        dashboardHashrateValue.removeAttribute('data-ad-boost-active');
        dashboardHashrateValue.removeAttribute('data-ad-boost-value');
      }
    }

    if (currentUser) {
      currentUser.processing_accumulated = calculatedAccumulated;
      currentUser.accumulatedReward = calculatedAccumulated;
    }
  }

  // 🚀 FIXED: جلب البيانات من السيرفر أولاً لتجنب التذبذب عند reload
  // إذا session_active_referrals موجود (جلسة جديدة) نستخدمه فوراً
  // إذا لا (reload صفحة) نجلب من السيرفر أولاً
  const hasSessionData = currentUser.session_active_referrals !== undefined;
  
  if (hasSessionData) {
    // جلسة جديدة - البيانات موجودة، اعرض فوراً
    calculateAndDisplayLocally();
    console.log('✅ New session - display immediately with session data');
  } else {
    // reload صفحة - اجلب من السيرفر أولاً ثم اعرض
    fetchBoostData().then(() => {
      calculateAndDisplayLocally();
      console.log('✅ Page reload - fetched data then displayed');
    });
  }

  // 🚀 Update display every SECOND (client-side only - NO server request!)
  window.accumulationInterval = setInterval(calculateAndDisplayLocally, 1000);
  console.log('✅ Local accumulation interval started (every 1 second)');

  // 🚀 Fetch boost data every 5 SECONDS (near real-time updates)
  window.boostCheckInterval = setInterval(fetchBoostData, 5000);
  console.log('✅ Boost check interval started (every 5 seconds)');

  // ✅ CRITICAL: إرسال دوري خفيف للسيرفر لحفظ الرصيد المتراكم (كل 5 دقائق)
  // هذا يضمن عدم فقدان الرصيد إذا أُغلقت الصفحة فجأة
  window.serverSyncInterval = setInterval(async () => {
    const accumulatedValue = currentUser?.processing_accumulated || currentUser?.accumulatedReward || 0;
    if (accumulatedValue > 0 && currentUser?.id) {
      try {
        await fetch('/api/activity/sync-accumulated', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUser.id,
            accumulated: accumulatedValue
          }),
          keepalive: true
        });
        console.log(`📤 Synced accumulated to server: ${accumulatedValue.toFixed(8)}`);
      } catch (e) {
        // Silent fail - سنحاول مرة أخرى في الدورة القادمة
      }
    }
  }, 300000); // كل 5 دقائق
  console.log('✅ Server sync interval started (every 5 minutes)');

  // ✅ حفظ الرصيد عند إغلاق الصفحة
  window.addEventListener('beforeunload', function() {
    const accumulatedValue = currentUser?.processing_accumulated || currentUser?.accumulatedReward || 0;
    if (accumulatedValue > 0 && currentUser?.id) {
      navigator.sendBeacon('/api/activity/sync-accumulated', JSON.stringify({
        userId: currentUser.id,
        accumulated: accumulatedValue
      }));
    }
  });

  // ✅ حفظ الرصيد عند تغيير visibility (التبديل بين التطبيقات على الموبايل)
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      const accumulatedValue = currentUser?.processing_accumulated || currentUser?.accumulatedReward || 0;
      if (accumulatedValue > 0 && currentUser?.id) {
        navigator.sendBeacon('/api/activity/sync-accumulated', JSON.stringify({
          userId: currentUser.id,
          accumulated: accumulatedValue
        }));
      }
    }
  });

  // Simplified function to get server data
  async function getServerAccumulatedAmount() {
    try {
      console.log('Getting latest accumulated amount from server...');
      
      const response = await fetch(`/api/processing/accumulated/${currentUser.id}`);

      if (response.ok) {
        const serverData = await response.json();
        if (serverData.success) {
          console.log('Successfully retrieved server accumulated amount');
          const serverAmount = parseFloat(serverData.accumulatedReward || 0);
          console.log(`Server accumulated amount: ${serverAmount.toFixed(8)}`);
          
          return {
            success: true,
            serverAmount: serverAmount,
            activeReferrals: serverData.activeReferrals || 0,
            hashrate: serverData.hashrate || 10
          };
        }
      }

      return { success: false };
    } catch (error) {
      console.error('Error getting server accumulated amount:', error);
      return { success: false };
    }
  }

  // Client-side processing completion removed - handled entirely by server

  // Function to clean up processing history
  async function cleanUpProcessingHistory(rewardAmount) {
    try {
      // Simply refresh the history - the filter logic will handle cleanup
      await addProcessingHistoryEntry();
      console.log(`Processing history refreshed with final reward: +${formatNumberSmart(rewardAmount)} Points`);
    } catch (error) {
      console.error('Error cleaning up processing history:', error);
    }
  }

  // Helper function to update user balance with error handling and smart formatting
  async function updateUserBalance(newBalance) {
    try {
      // 
      const preciseBalance = parseFloat(parseFloat(newBalance).toFixed(8));
      
      // Update balance in database
      const response = await fetch('/api/user/update-coins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: currentUser.id,
          coins: preciseBalance
        })
      });

      if (response.ok) {
        // Update UI and session with smart formatting
        updateUserCoins(preciseBalance);
        currentUser.coins = preciseBalance;
        saveUserSession(currentUser);

        // Sync across pages with smart formatting
        syncBalanceAcrossPages(preciseBalance);

        console.log(`Balance updated successfully: ${formatNumberSmart(preciseBalance)}`);
        return true;
      } else {
        console.error('Failed to update balance on server');
        return false;
      }
    } catch (error) {
      console.error('Error updating user balance:', error);
      return false;
    }
  }

  // Helper function to sync balance across all pages with smart formatting
  function syncBalanceAcrossPages(newBalance) {
    // 
    const smartFormattedBalance = formatNumberSmart(newBalance);
    const isBalanceHidden = localStorage.getItem('balanceHidden') === 'true';

    console.log(`Syncing balance across all pages: ${smartFormattedBalance} Points`);

    // حفظ القيمة في BalancePrivacyManager
    if (window.balancePrivacy && window.balancePrivacy.originalValues) {
      window.balancePrivacy.originalValues.set('#user-coins', smartFormattedBalance);
      window.balancePrivacy.originalValues.set('#profile-coins', smartFormattedBalance);
    }
    
    // لا تحدث إذا كان مخفياً
    if (isBalanceHidden) {
      console.log('Balance hidden - skipping UI update');
      return;
    }

    // Comprehensive list of all possible balance display selectors
    const balanceSelectors = [
      '#user-coins', '#user-balance', '#profile-coins',
      '.wallet-balance', '.account-balance', '.user-balance', '.balance-display', '.coin-balance',
      '[data-balance]', '#dashboard-balance', '#main-balance', '.current-balance',
      '#activity-page .balance-display', '#community-page .balance-amount',
      '.sidebar-balance', '.header-balance', '.nav-balance', '.account-balance'
    ];

    let updatedCount = 0;
    balanceSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        if (element) {
          const oldValue = element.textContent;
          element.textContent = smartFormattedBalance;
          if (element.hasAttribute('data-balance')) {
            element.setAttribute('data-balance', newBalance);
          }

          // Add visual feedback for updated elements
          if (oldValue !== smartFormattedBalance) {
            element.style.transition = 'all 0.3s ease';
            element.style.backgroundColor = '#10B981';
            element.style.color = 'white';
            element.style.padding = '2px 6px';
            element.style.borderRadius = '4px';

            setTimeout(() => {
              element.style.backgroundColor = '';
              element.style.color = '';
              element.style.padding = '';
              element.style.borderRadius = '';
            }, 1500);

            updatedCount++;
          }
        }
      });
    });

    // Update specific page contexts with smart formatting
    const pageContexts = [
      { selector: '#dashboard-page #user-coins', page: 'Dashboard' },
      { selector: '#profile-page #profile-coins', page: 'Profile' },
      { selector: '#community-page .wallet-balance', page: 'Network' },
      { selector: '#activity-page .balance-display', page: 'Processing' }
    ];

    pageContexts.forEach(({ selector, page }) => {
      const element = document.querySelector(selector);
      if (element) {
        const oldValue = element.textContent;
        element.textContent = smartFormattedBalance;
        console.log(`Updated balance in ${page} page: ${oldValue} -> ${smartFormattedBalance}`);

        // Visual feedback
        element.style.transition = 'color 0.3s ease';
        element.style.color = '#10B981';
        setTimeout(() => {
          element.style.color = '';
        }, 1000);
      }
    });

    // Update user session
    if (currentUser) {
      currentUser.coins = newBalance;
      saveUserSession(currentUser);
    }

    // Trigger multiple events for maximum compatibility
    const events = [
      new CustomEvent('balanceUpdated', {
        detail: { newBalance: newBalance, formattedBalance: smartFormattedBalance, source: 'sync' }
      }),
      new CustomEvent('globalBalanceUpdate', {
        detail: { newBalance: newBalance, formattedBalance: smartFormattedBalance }
      }),
      new CustomEvent('coinsUpdated', {
        detail: { coins: newBalance, formattedCoins: smartFormattedBalance }
      })
    ];

    events.forEach(event => {
      document.dispatchEvent(event);
      window.dispatchEvent(event);
    });

    // Trigger balance change indicator
    if (typeof window.showBalanceChange === 'function') {
      window.showBalanceChange(newBalance);
    }

    console.log(`Balance sync complete: ${updatedCount} elements updated across all pages`);
  }
  // Helper function to refresh user data
  async function refreshUserData() {
    try {
      const userData = await checkIfUserExists(currentUser.email);
      if (userData && userData.coins !== undefined) {
        updateUserCoins(userData.coins);
        currentUser.coins = userData.coins;
        saveUserSession(currentUser);
        console.log(`Refreshed user data with balance: ${formatNumberSmart(userData.coins)}`);
        return true;
      }
    } catch (refreshError) {
      console.error('Error refreshing user data:', refreshError);
      return false;
    }
  }



  // No need for initial load wait or complex intervals - server handles everything
  console.log('Server-only accumulation system ready');

  // Simplified function - just check if processing is complete
  async function checkProcessingStatus() {
    try {
      const countdownTimerElement = document.getElementById('countdown-timer');
      let remainingTimeString = countdownTimerElement ? countdownTimerElement.textContent : '00:00:00';
      let remainingSeconds = 0;

      // Parse remaining time
      if (remainingTimeString && remainingTimeString !== '00:00:00') {
        const timeParts = remainingTimeString.split(':');
        if (timeParts.length === 3) {
          remainingSeconds = parseInt(timeParts[0]) * 3600 + parseInt(timeParts[1]) * 60 + parseInt(timeParts[2]);
        }
      }

      // If processing completed, handle completion
      if (remainingSeconds <= 0 && currentUser.processing_active === 1) {
        console.log('✅ Processing completed - cleaning up');

        // Clear all intervals
        if (window.accumulationInterval) {
          clearInterval(window.accumulationInterval);
          window.accumulationInterval = null;
        }
        if (window.boostCheckInterval) {
          clearInterval(window.boostCheckInterval);
          window.boostCheckInterval = null;
        }

        if (activityInterval) {
          clearInterval(activityInterval);
          activityInterval = null;
        }

        // ✅ IMMEDIATELY update UI state to show completion (no delay)
        currentUser.processing_active = 0;
        currentUser.processing_completed = true;
        currentUser.processing_end_time = 0; // ✅ مسح وقت النهاية
        currentUser.processing_start_time = 0; // ✅ مسح وقت البداية
        currentUser.processing_remaining_seconds = 0;
        saveUserSession(currentUser); // ✅ حفظ فوري
        
        // ✅ IMMEDIATELY hide "Collecting..." from UI
        const historyContainer = document.querySelector('.history-container');
        if (historyContainer) {
          const collectingEntries = historyContainer.querySelectorAll('.collecting-entry');
          collectingEntries.forEach(entry => entry.remove());
        }
        
        // ✅ IMMEDIATELY hide "Collecting..." and update history
        addProcessingHistoryEntry().catch(err => 
          console.error('Error removing Collecting status:', err));

        // Get final reward from server
        const serverData = await getServerAccumulatedAmount();
        const finalReward = (serverData && serverData.success) ? serverData.serverAmount : 0.25;

        console.log(`✅ Processing completed - storing reward: ${finalReward.toFixed(8)}`);
        
        // ✅ Save completed reward to database WITHOUT transferring to balance
        // The reward will be transferred when user clicks "Start Activity" button
        try {
          const saveResponse = await fetch('/api/processing/save-completed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              userId: currentUser.id,
              completedReward: finalReward
            })
          });

          if (saveResponse.ok) {
            const saveData = await saveResponse.json();
            if (saveData.success) {
              // Update accumulated display to show the completed reward
              const accumulatedCoinsElement = document.getElementById('accumulated-coins');
              if (accumulatedCoinsElement) {
                accumulatedCoinsElement.textContent = formatNumberSmart(finalReward);
              }
              
              // Save the accumulated amount in session
              currentUser.processing_accumulated = finalReward;
              currentUser.accumulatedReward = finalReward;
              saveUserSession(currentUser);

              console.log(`✅ Processing completed - ${formatNumberSmart(finalReward)} saved in accumulated. Will transfer when user starts new activity.`);

              // Show notification
              showNotification(`${translator.translate('Processing completed!')} ${formatNumberSmart(finalReward)} ${translator.translate('points_accumulated_click_start')}`, 'success');
              
              // ✅ فتح الزر فوراً عند انتهاء الجلسة
              processingButton.classList.remove('disabled');
              processingButton.disabled = false;
              processingButton.textContent = '';
              const playIcon = document.createElement('i');
              playIcon.className = 'fas fa-play';
              processingButton.appendChild(playIcon);
              processingButton.appendChild(document.createTextNode(' ' + translator.translate('Start Activity')));
              
              // تحديث حالة النشاط
              if (processingStatus) {
                processingStatus.textContent = translator.translate('Processing available');
              }
              if (processingAnimation) {
                processingAnimation.style.display = 'none';
              }
              
              // ✅ السماح بالبدء السلس من أول ضغطة
              processingButton.setAttribute('data-server-verified', 'true');
              // window.processingSessionStarting = false; // تم إزالته
              window.processingSessionStartTimestamp = 0; // ✅ مسح timestamp
            }
          }
        } catch (saveError) {
          console.error('Error saving completed processing reward:', saveError);
        }
      }
    } catch (error) {
      console.error('Error checking processing status:', error);
    }
  }
}



    // Function to show processing status based on timestamp
    function updateProcessingStatus() {
      const now = Date.now();
      if (currentUser.processing_active && currentUser.processing_remaining > 0) {
        processingButton.classList.add('disabled');
        processingButton.disabled = true;
        processingAnimation.style.display = 'block';
        processingStatus.textContent = translator.translate('Processing in progress...');
        startCountdown(currentUser.processing_remaining);
      } else {
        processingButton.classList.remove('disabled');
        processingButton.disabled = false;
        processingAnimation.style.display = 'none';
        processingStatus.textContent = translator.translate('Processing available');
        countdownTimer.textContent = '00:00:00';
      }
    }


    // Function to check relay status using server time and get accumulated rewards
    async function checkRelayStatus() {
      // Use the global checkProcessingStatus function
      await checkProcessingStatus();
        try {
        // If we reloaded a referrals list, refresh it to get the latest processing status
        if (currentUser.id) {
          loadUserReferrals(currentUser.id);
        }
      } catch (error) {
        console.error('Error in relay status check:', error);
      }
    }

    // Initialize relay check
    checkRelayStatus();
    // Check relay status every 5 minutes (optimized for lower server load)
    setInterval(checkRelayStatus, 300000);





    // Helper function to format time for display
    function formatTime(milliseconds) {
      const hours = Math.floor(milliseconds / (1000 * 60 * 60));
      const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);

      return (hours < 10 ? '0' + hours : hours) + ':' +
             (minutes < 10 ? '0' + minutes : minutes) + ':' +
             (seconds < 10 ? '0' + seconds : seconds);
    }

    // Function to start a gradual reward process
    function startGradualReward(startTime, endTime, userId) {
      // Clear any existing gradual reward interval
      if (window.gradualRewardInterval) {
        clearInterval(window.gradualRewardInterval);
      }

      // Calculate total duration in seconds
      const totalDuration = (endTime - startTime) / 1000;

      // Calculate reward increment per second
      const coinsPerSecond = 50 / totalDuration;

      // Keep track of accumulated reward (to avoid floating point errors)
      let accumulatedReward = 0;
      let lastUpdateTime = Date.now();

      // Update UI immediately with initial values
      const currentCoins = parseInt(document.getElementById('user-coins').textContent.replace(/,/g, '')) || 0;
      const initialDisplay = currentCoins;
      updateUserCoins(initialDisplay);

      // Set interval to update the balance every second
      window.gradualRewardInterval = setInterval(() => {
        const now = Date.now();
        const secondsElapsed = (now - lastUpdateTime) / 1000;
        lastUpdateTime = now;

        // Calculate increment for this interval
        const increment = coinsPerSecond * secondsElapsed;
        accumulatedReward += increment;

        // Get current displayed balance
        const currentDisplayedCoins = parseInt(document.getElementById('user-coins').textContent.replace(/,/g, '')) || 0;

        // Update display with accumulated reward
        updateUserCoins(Math.floor(initialDisplay + accumulatedReward));

        // Check if processing has ended
        const serverNow = now + (currentUser.server_time_diff || 0);
        if (serverNow >= endTime) {
          clearInterval(window.gradualRewardInterval);
          window.gradualRewardInterval = null;

          // Ensure we end up with exactly +50 coins
          updateUserCoins(initialDisplay + 0.25);

          console.log('Gradual reward completed, added exactly 0.25 coins');        }
      }, 1000);
    }




    // Function to start countdown timer with simplified seconds-based approach
    // 🚀 OPTIMIZED: 100% محلي - لا يطلب من السيرفر إلا كل 5 دقائق
    function startCountdown(duration) {
      console.log('Starting OPTIMIZED LOCAL countdown timer (no server polling)');

      // First, clear any existing intervals to prevent duplicates
      if (activityInterval) {
        clearInterval(activityInterval);
        activityInterval = null;
      }
      if (window.countdownServerCheckInterval) {
        clearInterval(window.countdownServerCheckInterval);
        window.countdownServerCheckInterval = null;
      }

      // Clear any existing processing completion flags/records to ensure clean state
      if (window.processingCompletionRecorded) {
        window.processingCompletionRecorded = false;
      }

      const countdownTimer = document.getElementById('countdown-timer');
      const processingStatus = document.getElementById('activity-status');
      const processingButton = document.getElementById('toggle-activity');
      const processingAnimation = document.getElementById('activity-animation');
      const progressBar = document.getElementById('processing-progress');

      if (!countdownTimer || !processingStatus || !processingButton) {
        console.error('Required UI elements not found');
        return;
      }

      // 🚀 حساب الوقت المتبقي من وقت النهاية المحفوظ
      const processingEndTime = parseInt(currentUser.processing_end_time) || 0;
      const nowMs = Date.now();
      let countdownSeconds;
      
      if (processingEndTime > 0) {
        countdownSeconds = Math.max(0, Math.floor((processingEndTime - nowMs) / 1000));
      } else {
        countdownSeconds = duration || 86400;
      }

      // Helper function to update button safely
      const updateButtonSafely = (iconClass, text) => {
        processingButton.textContent = '';
        const icon = document.createElement('i');
        icon.className = iconClass;
        processingButton.appendChild(icon);
        processingButton.appendChild(document.createTextNode(' ' + text));
      };

      // Show appropriate processing status immediately
      processingStatus.textContent = translator.translate('Processing in progress...');
      processingButton.classList.add('disabled');
      updateButtonSafely('fas fa-spinner fa-spin', translator.translate('Activity...'));

      // Show animation
      if (processingAnimation) {
        processingAnimation.style.display = 'block';
      }

      // Format and display initial time
      const formatSecondsToTime = (seconds) => {
        seconds = Math.min(Math.max(0, Math.floor(seconds)), 86400);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      };

      // Initialize UI
      countdownTimer.textContent = formatSecondsToTime(countdownSeconds);
      if (progressBar) progressBar.value = (1 - countdownSeconds / 86400) * 100;

      // Save user state
      if (currentUser) {
        currentUser.processing_active = 1;
        currentUser.processing_completed = false;
        currentUser.processing_remaining_seconds = countdownSeconds;
        saveUserSession(currentUser);
      }

      // 🚀 LOCAL COUNTDOWN - كل ثانية محلياً بدون طلب سيرفر
      activityInterval = setInterval(() => {
        // حساب من وقت النهاية مباشرة (أدق من الطرح)
        const now = Date.now();
        const endTime = parseInt(currentUser.processing_end_time) || 0;
        
        if (endTime > 0) {
          countdownSeconds = Math.max(0, Math.floor((endTime - now) / 1000));
        } else {
          countdownSeconds = Math.max(0, countdownSeconds - 1);
        }

        // Update UI
        countdownTimer.textContent = formatSecondsToTime(countdownSeconds);
        
        // Update progress bar
        const progress = Math.min(100, (1 - (countdownSeconds / 86400)) * 100);
        if (progressBar) progressBar.value = progress;

        // Update dashboard timer if visible
        if (typeof updateDashboardCompactTimer === 'function') {
          updateDashboardCompactTimer(countdownSeconds);
        }

        // Save to memory
        if (currentUser) {
          currentUser.processing_remaining_seconds = countdownSeconds;
        }

        // Check if completed
        if (countdownSeconds <= 0) {
          console.log('⏰ Processing completed locally - cleaning up');
          
          clearInterval(activityInterval);
          activityInterval = null;
          
          if (window.countdownServerCheckInterval) {
            clearInterval(window.countdownServerCheckInterval);
            window.countdownServerCheckInterval = null;
          }
          if (window.accumulationInterval) {
            clearInterval(window.accumulationInterval);
            window.accumulationInterval = null;
          }
          if (window.boostCheckInterval) {
            clearInterval(window.boostCheckInterval);
            window.boostCheckInterval = null;
          }

          // ✅ CRITICAL: حساب القيمة النهائية الكاملة
          const baseReward = 0.25;
          const finalReward = baseReward * (window.localBoostData?.multiplier || 1.0);
          
          // ✅ CRITICAL: عرض القيمة النهائية الكاملة قبل التنظيف
          const accumulatedCoinsEl = document.getElementById('accumulated-coins');
          if (accumulatedCoinsEl) {
            accumulatedCoinsEl.textContent = formatNumberSmart(finalReward);
            console.log('✅ Final accumulated reward displayed:', finalReward);
          }

          // ✅ CRITICAL FIX: حفظ المكافأة المكتملة على السيرفر فوراً
          // هذا يضمن أن المكافأة محفوظة قبل أن يضغط المستخدم على زر Start Activity
          if (currentUser && currentUser.id) {
            (async () => {
              try {
                console.log(`✅ Saving completed reward to server: ${finalReward}`);
                const saveResponse = await fetch('/api/processing/save-completed', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    userId: currentUser.id,
                    completedReward: finalReward
                  })
                });
                
                if (saveResponse.ok) {
                  const saveData = await saveResponse.json();
                  console.log(`✅ Completed reward saved to server:`, saveData);
                  
                  // حفظ في الذاكرة المحلية أيضاً
                  currentUser.processing_accumulated = finalReward;
                  currentUser.accumulatedReward = finalReward;
                } else {
                  console.error('❌ Failed to save completed reward to server');
                }
              } catch (saveError) {
                console.error('❌ Error saving completed reward:', saveError);
              }
            })();
          }

          // Update UI
          countdownTimer.textContent = '00:00:00';
          processingStatus.textContent = translator.translate('Processing Completed');
          updateButtonSafely('fas fa-play', translator.translate('Start Activity'));
          
          // ✅ تفعيل الزر بعدة طرق للتأكد
          processingButton.classList.remove('disabled');
          processingButton.disabled = false;
          processingButton.removeAttribute('disabled');
          processingButton.style.pointerEvents = 'auto';
          processingButton.style.opacity = '1';
          processingButton.setAttribute('data-server-verified', 'true');
          
          console.log('🎯 SESSION ENDED - Button enabled:', {
            disabled: processingButton.disabled,
            classList: processingButton.classList.contains('disabled'),
            html: processingButton.innerHTML
          });
          
          // window.processingSessionStarting = false; // تم إزالته
          window.processingSessionStartTimestamp = 0;
          if (processingAnimation) processingAnimation.style.display = 'none';
          
          // ✅ إشعار المستخدم بانتهاء الجلسة
          showNotification(`${translator.translate('Processing completed!')} ${formatNumberSmart(finalReward)} ${translator.translate('points_ready_to_claim')}`, 'success');

          // ✅ CRITICAL: تصفير الـ hashrate إلى 10.0 عند انتهاء الجلسة
          // الـ boost والإحالات تحتسب فقط في الجلسة الجديدة
          const hashrateValue = document.getElementById('hashrate-value');
          const dashboardHashrateValue = document.getElementById('dashboard-hashrate-value');
          
          if (hashrateValue) {
            hashrateValue.textContent = '10.0';
            hashrateValue.removeAttribute('data-ad-boost-active');
            hashrateValue.removeAttribute('data-ad-boost-value');
            hashrateValue.style.color = ''; // إزالة اللون الخاص
          }
          if (dashboardHashrateValue) {
            dashboardHashrateValue.textContent = '10.0';
            dashboardHashrateValue.removeAttribute('data-ad-boost-active');
            dashboardHashrateValue.removeAttribute('data-ad-boost-value');
            dashboardHashrateValue.style.color = ''; // إزالة اللون الخاص
          }
          
          // ✅ مسح بيانات الـ boost المحلية
          if (window.localBoostData) {
            window.localBoostData.multiplier = 1.0;
            window.localBoostData.adBoostActive = false;
            window.localBoostData.startTimeFixed = false;
          }
          
          console.log('✅ Session ended - Hashrate reset to 10.0 MH/s');

          // Mark as completed
          if (currentUser) {
            currentUser.processing_active = 0;
            currentUser.processing_completed = true;
            currentUser.processing_remaining_seconds = 0;
            currentUser.processing_end_time = 0; // ✅ مسح وقت النهاية
            currentUser.processing_start_time = 0; // ✅ مسح وقت البداية
            saveUserSession(currentUser);
          }

          // Remove collecting from UI
          if (typeof window.removeCollectingFromUI === 'function') {
            window.removeCollectingFromUI();
          }
          addProcessingHistoryEntry().catch(err => console.error(err));
        }
      }, 1000);

      // 🚀 SERVER CHECK - كل 5 دقائق فقط للتحقق من الحالة
      window.countdownServerCheckInterval = setInterval(async () => {
        try {
          console.log('[SERVER CHECK] Verifying processing status (every 5 min)');
          const response = await fetch(`/api/processing/countdown/status/${currentUser.id}`);
          
          if (response.ok) {
            const data = await response.json();
            if (data.success) {
              // تحديث وقت النهاية إذا تغير
              if (data.processing_end_time) {
                currentUser.processing_end_time = data.processing_end_time;
              }
              
              // إذا اكتمل على السيرفر
              if (data.is_completed || data.processing_active === 0) {
                console.log('[SERVER CHECK] Processing completed on server');
                countdownSeconds = 0;
              }
            }
          }
        } catch (error) {
          console.error('[SERVER CHECK] Error:', error);
        }
      }, 300000); // 5 دقائق = 300000ms

      console.log('✅ Local countdown started (updates every 1s, server check every 5min)');
    }
  }

  

  // Function to update dashboard compact timer (mirror of processing timer)
  function updateDashboardCompactTimer(remainingSeconds) {
    const dashboardPage = document.getElementById('dashboard-page');
    if (!dashboardPage || dashboardPage.style.display === 'none') {
      return;
    }

    const compactTimer = document.getElementById('dashboard-compact-timer');
    const dashboardCountdown = document.getElementById('dashboard-countdown');
    
    if (!compactTimer || !dashboardCountdown) {
      return;
    }

    // Show/hide timer based on processing status
    if (currentUser && currentUser.processing_active === 1 && remainingSeconds > 0) {
      // Show timer and update countdown
      compactTimer.style.display = 'block';
      
      // Format time like the main processing timer
      const hours = Math.floor(remainingSeconds / 3600);
      const minutes = Math.floor((remainingSeconds % 3600) / 60);
      const seconds = remainingSeconds % 60;
      
      dashboardCountdown.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      // Hide timer when processing is not active
      compactTimer.style.display = 'none';
    }
  }

  // Function to update dashboard processing timer display (copy of processing timer)
  function updateDashboardProcessingTimer(remainingSeconds) {
    const dashboardTimer = document.getElementById('dashboard-activity-timer');
    const dashboardCountdownDisplay = document.getElementById('dashboard-countdown-display');
    const dashboardTimerStatus = document.getElementById('dashboard-timer-status');
    const dashboardHashrateDisplay = document.getElementById('dashboard-hashrate-display');
    const dashboardHashrateValue = document.getElementById('dashboard-hashrate-value');
    
    if (!dashboardTimer || !dashboardCountdownDisplay || !dashboardTimerStatus) {
      return;
    }

    // Always show timer with immediate visibility
    dashboardTimer.style.display = 'block';
    dashboardTimer.style.visibility = 'visible';
    dashboardTimer.style.opacity = '1';

    // Set default values immediately to prevent layout shift
    if (!dashboardCountdownDisplay.textContent || dashboardCountdownDisplay.textContent === '') {
      dashboardCountdownDisplay.textContent = '00:00:00';
    }
    
    if (!dashboardTimerStatus.textContent || dashboardTimerStatus.textContent === '') {
      dashboardTimerStatus.textContent = translator.translate('Not Active');
    }

    // Always show hashrate with default value
    if (dashboardHashrateDisplay) {
      dashboardHashrateDisplay.style.display = 'flex';
      dashboardHashrateDisplay.style.visibility = 'visible';
      dashboardHashrateDisplay.style.opacity = '1';
      
      if (!dashboardHashrateValue.textContent || dashboardHashrateValue.textContent === '') {
        dashboardHashrateValue.textContent = '10.0';
      }
    }

    // Update timer based on processing status and control pendulum animation
    if (currentUser && currentUser.processing_active === 1 && remainingSeconds > 0) {
      // Format time like the main processing timer
      const hours = Math.floor(remainingSeconds / 3600);
      const minutes = Math.floor((remainingSeconds % 3600) / 60);
      const seconds = remainingSeconds % 60;
      
      dashboardCountdownDisplay.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      dashboardTimerStatus.textContent = translator.translate('Processing Active');
      
      // تشغيل الرقاص - إضافة activity-active class
      dashboardTimer.classList.add('activity-active');
      dashboardTimer.classList.remove('activity-inactive');
      
      // Update hashrate display - sync with processing page logic
      updateDashboardHashrateDisplay();
    } else {
      // Show inactive status
      dashboardCountdownDisplay.textContent = '00:00:00';
      dashboardTimerStatus.textContent = translator.translate('Not Active');
      
      // إيقاف الرقاص - إزالة activity-active class
      dashboardTimer.classList.remove('activity-active');
      dashboardTimer.classList.add('activity-inactive');
      
      
      
      // Keep hashrate visible with default value
      if (dashboardHashrateDisplay && dashboardHashrateValue) {
        dashboardHashrateDisplay.style.display = 'flex';
        dashboardHashrateValue.textContent = '10.0';
      }
    }
  }

  // Function to update dashboard hashrate display (always visible for dashboard aesthetics)
  // ✅ FIXED: استخدام البيانات المحلية أولاً، ثم السيرفر إذا لم تكن موجودة
  async function updateDashboardHashrateDisplay() {
    const dashboardHashrateDisplay = document.getElementById('dashboard-hashrate-display');
    const dashboardHashrateValue = document.getElementById('dashboard-hashrate-value');
    
    if (!dashboardHashrateDisplay || !dashboardHashrateValue) {
      return;
    }

    // Dashboard hashrate - always show
    dashboardHashrateDisplay.style.display = 'flex';
    
    // ✅ استخدام localBoostData إذا كان موجوداً (أثناء الجلسة النشطة)
    const localData = window.localBoostData;
    
    if (localData && currentUser && currentUser.processing_active === 1) {
      // ✅ استخدام نفس القيم من localBoostData
      const totalHashrate = 10.0 * localData.multiplier;
      dashboardHashrateValue.textContent = totalHashrate.toFixed(1);
      
      // Mark ad boost status in DOM
      if (localData.adBoostActive) {
        dashboardHashrateValue.setAttribute('data-ad-boost-active', 'true');
        dashboardHashrateValue.setAttribute('data-ad-boost-value', '1.2');
      } else {
        dashboardHashrateValue.removeAttribute('data-ad-boost-active');
        dashboardHashrateValue.removeAttribute('data-ad-boost-value');
      }
      
      // Change color if boost is active
      if (localData.adBoostActive || localData.activeReferrals > 0) {
        dashboardHashrateValue.style.color = '#38b2ac';
      } else {
        dashboardHashrateValue.style.color = '';
      }
    } else if (currentUser && currentUser.processing_active === 1) {
      // ✅ localBoostData غير موجود لكن الجلسة نشطة - اجلب من السيرفر
      try {
        const response = await fetch(`/api/processing/accumulated/${currentUser.id}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            const activeReferrals = data.activeReferrals || 0;
            const adBoostActive = data.adBoostActive || false;
            
            let totalHashrate = 10.0;
            if (activeReferrals > 0) {
              totalHashrate += activeReferrals * 0.4;
            }
            if (adBoostActive) {
              totalHashrate += 1.2;
            }
            
            dashboardHashrateValue.textContent = totalHashrate.toFixed(1);
            
            if (adBoostActive) {
              dashboardHashrateValue.setAttribute('data-ad-boost-active', 'true');
              dashboardHashrateValue.setAttribute('data-ad-boost-value', '1.2');
            } else {
              dashboardHashrateValue.removeAttribute('data-ad-boost-active');
              dashboardHashrateValue.removeAttribute('data-ad-boost-value');
            }
            
            if (adBoostActive || activeReferrals > 0) {
              dashboardHashrateValue.style.color = '#38b2ac';
            } else {
              dashboardHashrateValue.style.color = '';
            }
          }
        }
      } catch (error) {
        console.error('Error fetching hashrate:', error);
      }
    } else {
      // Not processing - show default
      dashboardHashrateValue.textContent = '10.0';
      dashboardHashrateValue.removeAttribute('data-ad-boost-active');
      dashboardHashrateValue.removeAttribute('data-ad-boost-value');
      dashboardHashrateValue.style.color = '';
    }
  }

  

  // Initialize dashboard timer independently with enhanced data fetching
  async function initializeDashboardTimer() {
    if (!currentUser || !currentUser.id) {
      console.log('Cannot initialize dashboard timer: No user logged in');
      return;
    }

    console.log('Initializing dashboard timer for user:', currentUser.id);

    try {
      //  processing page 
      const response = await fetch('/api/processing/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const remainingSeconds = data.remaining_seconds || 0;
          const isActive = data.processing_active === 1;
          
          console.log(`Dashboard timer got real status: active=${isActive}, remaining=${remainingSeconds}s`);
          
          //  
          currentUser.processing_active = data.processing_active;
          currentUser.processing_remaining_seconds = remainingSeconds;
          currentUser.processing_end_time = data.processing_end_time;
          currentUser.processing_start_time = data.processing_start_time;
          saveUserSession(currentUser);
          
          //  
          updateDashboardProcessingTimer(remainingSeconds);
        
          
          //  
          if (isActive && remainingSeconds > 0) {
            startDashboardCountdown(remainingSeconds);
          }
          
          console.log('Dashboard timer initialized successfully with real server data');
          return;
        }
      }
      
      console.log('Server request failed, trying checkProcessingStatus as fallback');
      
      //  checkProcessingStatus  
      await checkProcessingStatus();
      
      //   checkProcessingStatus
      const remainingSeconds = currentUser.processing_remaining_seconds || 0;
      const isActive = currentUser.processing_active === 1;
      
      updateDashboardProcessingTimer(remainingSeconds);
      updateNetworkWealthIndicators();
      
      if (isActive && remainingSeconds > 0) {
        startDashboardCountdown(remainingSeconds);
      }
      
      console.log('Dashboard timer initialized using checkProcessingStatus fallback');
      
    } catch (error) {
      console.error('Error initializing dashboard timer:', error);
      
      //  checkProcessingStatus
      try {
        await checkProcessingStatus();
        const remainingSeconds = currentUser.processing_remaining_seconds || 0;
        updateDashboardProcessingTimer(remainingSeconds);
        
        if (currentUser.processing_active === 1 && remainingSeconds > 0) {
          startDashboardCountdown(remainingSeconds);
        }
        
        console.log('Dashboard timer initialized using emergency checkProcessingStatus');
      } catch (finalError) {
        console.error('All dashboard timer initialization methods failed:', finalError);
      }
    }
  }

  // Start dashboard countdown independently
  function startDashboardCountdown(initialSeconds) {
    // Clear any existing dashboard interval
    if (window.dashboardInterval) {
      clearInterval(window.dashboardInterval);
      window.dashboardInterval = null;
    }

    let remainingSeconds = initialSeconds;
    
    console.log('Starting dashboard countdown with', remainingSeconds, 'seconds');

    // Update immediately
    updateDashboardProcessingTimer(remainingSeconds);
    
    // Start interval to update every second
    window.dashboardInterval = setInterval(async () => {
      remainingSeconds--;
      
      // Update dashboard displays
      updateDashboardProcessingTimer(remainingSeconds);
     
      
      // Update hashrate display every 5 seconds (same as processing page)
      if (remainingSeconds % 5 === 0) {
        updateDashboardHashrateDisplay();
      }
      
      // Check if countdown finished
      if (remainingSeconds <= 0) {
        clearInterval(window.dashboardInterval);
        window.dashboardInterval = null;
        
        // Update to show processing completed
        updateDashboardProcessingTimer(0);
        
        console.log('Dashboard countdown completed');
      }
      
      // Sync with server every 30 seconds
      if (remainingSeconds % 30 === 0) {
        try {
          const response = await fetch(`/api/processing/countdown/status/${currentUser.id}`);
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.remaining_seconds !== undefined) {
              remainingSeconds = data.remaining_seconds;
              console.log('Dashboard timer synced with server:', remainingSeconds);
            }
          }
        } catch (error) {
          console.error('Error syncing dashboard timer:', error);
        }
      }
    }, 1000);
  }

  // Function to update network wealth indicators
  

 // Add entry to processing history - Clean display with proper "Collecting..." management
    async function addProcessingHistoryEntry() {
      const historyContainer = document.querySelector('.history-container');

      if (!currentUser || !currentUser.id) {
        console.log('Cannot fetch processing history: User not logged in');
        if (historyContainer) {
          historyContainer.innerHTML = '<div class="history-item"></div>';
        }
        return;
      }

      try {
        // Get current processing history
        const response = await fetch(`/api/processing/history/${currentUser.id}`);
        const data = await response.json();

        // Clear existing history completely
        historyContainer.innerHTML = '';

        // ✅ IMPROVED: Check if user is TRULY currently processing
        // Must have active flag AND remaining time > 0 AND not completed
        const remainingSeconds = currentUser.processing_remaining_seconds || 0;
        const isCurrentlyProcessing = currentUser.processing_active === 1 && 
                                      remainingSeconds > 0 && 
                                      !currentUser.processing_completed;

        // Only show one "Collecting..." entry if TRULY currently processing
        if (isCurrentlyProcessing) {
          const collectingItem = document.createElement('div');
          collectingItem.className = 'history-item collecting-entry';
          
          // Secure: Create elements safely (XSS protection)
          const dateDiv = document.createElement('div');
          dateDiv.className = 'history-date';
          dateDiv.textContent = formatDateConsistently(Date.now());
          
          const amountDiv = document.createElement('div');
          amountDiv.className = 'history-amount collecting';
          const spinner = document.createElement('i');
          spinner.className = 'fas fa-spinner fa-spin';
          amountDiv.appendChild(spinner);
          amountDiv.appendChild(document.createTextNode(' ' + translator.translate("Collecting...")));
          
          collectingItem.appendChild(dateDiv);
          collectingItem.appendChild(amountDiv);
          historyContainer.appendChild(collectingItem);
        }

        // Display only completed entries with actual amounts (no collecting entries)
        if (data.success && data.history) {
          const validEntries = data.history.filter(entry => {
            // Filter out ALL collecting entries and zero amounts
            return !entry.user_name?.includes('Collecting...') && 
                   !entry.user_name?.includes('collecting') &&
                   parseFloat(entry.amount) > 0;
          });

          validEntries.forEach(entry => {
            const formattedDate = formatDateConsistently(entry.timestamp);
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item completed-entry';
            
            // Secure: Create elements safely (XSS protection)
            const dateDiv = document.createElement('div');
            dateDiv.className = 'history-date';
            dateDiv.textContent = formattedDate;
            
            const amountDiv = document.createElement('div');
            amountDiv.className = 'history-amount';
            amountDiv.textContent = '+' + parseFloat(entry.amount).toFixed(2) + ' acs';
            
            historyItem.appendChild(dateDiv);
            historyItem.appendChild(amountDiv);
            historyContainer.appendChild(historyItem);
          });
        }

        console.log('Processing history refreshed - clean display');
      } catch (error) {
        console.error('Error refreshing processing history:', error);
      }
    }

    // ✅ Function to remove all "Collecting..." entries from UI (global for accessibility)
    window.removeCollectingFromUI = function() {
      const historyContainer = document.querySelector('.history-container');
      if (!historyContainer) return;
      
      const collectingEntries = historyContainer.querySelectorAll('.collecting-entry');
      collectingEntries.forEach(entry => entry.remove());
      console.log('Removed all "Collecting..." entries from UI');
    }
    
    // Alias for local use
    function removeCollectingFromUI() {
      window.removeCollectingFromUI();
    }

    // ✅ Check and cleanup on page load - ensure no stale "Collecting..." entries
    async function cleanupStaleCollecting() {
      if (!currentUser || !currentUser.id) return;
      
      try {
        // Check current processing status from server
        const response = await fetch(`/api/processing/status/${currentUser.id}`);
        const data = await response.json();
        
        if (data.success) {
          const isActive = data.processing_active === 1 && (data.remaining_seconds || 0) > 0;
          
          // If session ended, remove "Collecting..." from UI AND database
          if (!isActive) {
            removeCollectingFromUI();
            currentUser.processing_active = 0;
            currentUser.processing_completed = true;
            saveUserSession(currentUser);
            
            // ✅ فتح الزر عند انتهاء الجلسة
            const processingButton = document.getElementById('toggle-activity');
            const processingStatus = document.getElementById('activity-status');
            const processingAnimation = document.getElementById('activity-animation');
            if (processingButton) {
              processingButton.classList.remove('disabled');
              processingButton.disabled = false;
              processingButton.innerHTML = '<i class="fas fa-play"></i> ' + (window.translator ? window.translator.translate('Start Activity') : 'Start Activity');
              processingButton.setAttribute('data-server-verified', 'true');
            }
            if (processingStatus) processingStatus.textContent = (window.translator ? window.translator.translate('Processing available') : 'Processing available');
            if (processingAnimation) processingAnimation.style.display = 'none';
            // window.processingSessionStarting = false; // تم إزالته
            
            // ✅ Also cleanup from database
            try {
              await fetch('/api/processing/history/cleanup-collecting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: currentUser.id })
              });
              console.log('Session ended - cleaned up "Collecting..." from UI and database');
            } catch (dbError) {
              console.error('Error cleaning up "Collecting..." from database:', dbError);
            }
          }
        }
      } catch (error) {
        console.error('Error checking processing status for cleanup:', error);
      }
    }

    // Load activity history on page load
    addProcessingHistoryEntry();
    
    // ✅ Also cleanup stale entries on page load
    cleanupStaleCollecting();

    // Function to add immediate "Collecting..." entry to UI
    function addImmediateCollectingEntry() {
      const historyContainer = document.querySelector('.history-container');
      if (!historyContainer || !currentUser) return;

      console.log('Adding immediate "Collecting..." entry to UI');

      // Remove any existing collecting entries first
      const existingCollecting = historyContainer.querySelectorAll('.collecting-entry');
      existingCollecting.forEach(entry => entry.remove());

      // Create new collecting entry element safely (XSS protection)
      const collectingItem = document.createElement('div');
      collectingItem.className = 'history-item collecting-entry immediate-entry';
      
      const dateDiv = document.createElement('div');
      dateDiv.className = 'history-date';
      dateDiv.textContent = formatDateConsistently(Date.now());
      
      const amountDiv = document.createElement('div');
      amountDiv.className = 'history-amount collecting';
      const spinner = document.createElement('i');
      spinner.className = 'fas fa-spinner fa-spin';
      amountDiv.appendChild(spinner);
      amountDiv.appendChild(document.createTextNode(' ' + translator.translate("Collecting...")));
      
      collectingItem.appendChild(dateDiv);
      collectingItem.appendChild(amountDiv);

      // Add at the top of the history
      historyContainer.insertBefore(collectingItem, historyContainer.firstChild);
      
      console.log('Immediate "Collecting..." entry added to UI');
    }

    // Simple function to add collecting entry when processing starts
    function addTemporaryCollectingEntry() {
      // This is now handled by addProcessingHistoryEntry() - no duplicate needed
      console.log('Processing started - collecting entry will be shown by history refresh');
      addProcessingHistoryEntry();
    }

    // Simplified processing history update
    async function updateProcessingHistoryWithReward(amount) {
      if (!currentUser || !currentUser.id || window.processingRewardRecorded) {
        return;
      }

      try {
        window.processingRewardRecorded = true;
        await addProcessingHistoryEntry();
        console.log(`Processing history updated with reward: ${amount.toFixed(8)} Points`);
      } catch (error) {
        console.error('Error updating processing history:', error);
      }
    }



// Function to update processing state in the UI
function updateProcessingState(isActive, startTime, endTime) {
  const processingButton = document.getElementById('processing-button');
  const processingStatus = document.getElementById('activity-status');
  const processingAnimation = document.getElementById('activity-animation');

  // Add null checks to prevent errors
  if (!processingButton || !processingStatus || !processingAnimation) {
    console.warn("Processing UI elements not found in the DOM");
    return;
  }

  // Update button states
  processingButton.classList.toggle('disabled', isActive);

  // Calculate time remaining
  const now = Date.now();
  const timeRemaining = endTime - now;

  if (isActive) {
    processingButton.classList.add('disabled');

    if (timeRemaining > 0) {
      const hours = Math.floor(timeRemaining / (60 * 60 * 1000));
      const minutes = Math.floor((timeRemaining % (60 * 60 * 1000)) / (60 * 1000));

      processingStatus.textContent = `Processing in progress: ${hours}h ${minutes}m remaining`;
      processingStatus.className = 'status-active';
      processingAnimation.style.display = 'block';
    } else {
      processingStatus.textContent = translator.translate('Processing Completed');
      processingStatus.className = 'status-inactive';
      processingAnimation.style.display = 'none';

      clearInterval(activityInterval);
      activityInterval = null;
    }
  } else {
    processingButton.classList.remove('disabled');
    processingButton.disabled = false;
    processingStatus.textContent = translator.translate('Processing available');
    processingStatus.className = 'status-inactive';
    processingAnimation.style.display = 'none';
  }
}

// Function to update processing status message
function updateProcessingStatus(message, type) {
  const statusElement = document.getElementById('processingStatusMessage');
  if (statusElement) {
    statusElement.textContent = message;
    statusElement.className = `status-message ${type}`;

    // Make the message visible temporarilyfunction startGradualAccumulation() {
      // Clear any existing intervals first
      if (window.accumulationInterval) {
        clearInterval(window.accumulationInterval);
        window.accumulationInterval = null;
      }

      const progressBar = document.getElementById('processing-progress');
      const accumulatedCoinsElement = document.getElementById('accumulated-coins');
      const totalReward = 0.25;

      // Initialize with server-loaded value if available
      let accumulated = currentUser.processing_accumulated || 0;
      let lastSyncTime = 0;
      let syncInProgress = false;

      // Update UI immediately with loaded value
      if (progressBar) {
        progressBar.value = (accumulated / totalReward) * 100;
      }
      if (accumulatedCoinsElement) {
        accumulatedCoinsElement.textContent = accumulated.toFixed(8);
      }

      // Only start accumulation if processing is active and not completed
      if (currentUser.processing_active && !currentUser.processing_completed) {
        const startTime = currentUser.processing_start_time;
        const endTime = currentUser.processing_end_time;
        const duration = endTime - startTime;

        // Calculate how much time has already elapsed
        const serverNow = Date.now() + (currentUser.server_time_diff || 0);
        const elapsed = serverNow - startTime;
        const remaining = endTime - serverNow;

        // If processing is already complete, just show final value and hide collecting
        if (remaining <= 0) {
          accumulated = totalReward;
          if (progressBar) progressBar.value = 100;
          if (accumulatedCoinsElement) accumulatedCoinsElement.textContent = totalReward.toFixed(8);
          
          // Hide Collecting... immediately when processing completes
          addProcessingHistoryEntry();
          return;
        }

        // Start the accumulation interval
        window.accumulationInterval = setInterval(async () => {
          try {
            if (syncInProgress) return;

            // Get current server time
            const timeData = await fetchServerTime();
            const now = timeData.server_time;

            // Calculate new accumulated amount based on elapsed time
            const newElapsed = now - startTime;
            const progress = Math.min(1, newElapsed / duration);
            const newAccumulated = totalReward * progress;

            // Only update if value has changed significantly
            if (Math.abs(newAccumulated - accumulated) >= 0.00001) {
              accumulated = newAccumulated;

              // Update UI
              if (progressBar) progressBar.value = progress * 100;
              if (accumulatedCoinsElement) {
                accumulatedCoinsElement.textContent = accumulated.toFixed(8);
              }

              // Save to user object
              currentUser.processing_accumulated = accumulated;
              saveUserSession(currentUser);
            }

            // Sync with server periodically
            if (now - lastSyncTime > 5000 && !syncInProgress) {
              lastSyncTime = now;
              syncAccumulatedAmount(accumulated);
            }

            // Check if processing has completed - Server handles completion
            if (now >= endTime) {
              clearInterval(window.accumulationInterval);
              window.accumulationInterval = null;
              console.log('Processing time completed - server will handle rewards');
            }
          } catch (error) {
            console.error('Error in accumulation interval:', error);
          }
        }, 1000);
      }
    }
    statusElement.style.opacity = '1';
    setTimeout(() => {
      statusElement.style.opacity = '0';
    }, 5000);
  }


  // Function to ensure proper timestamp conversion between seconds and milliseconds
  function ensureMilliseconds(timestamp) {
    // If timestamp is too small to be milliseconds (before ~2010), it's likely in seconds
    if (timestamp < 1300000000000) {
      return timestamp * 1000; // Convert seconds to milliseconds
    }
    return timestamp; // Already in milliseconds
  }

 // Function to ensure proper timestamp conversion between milliseconds and seconds
  function ensureSeconds(timestamp) {
    // If timestamp is too large to be seconds (after ~2100), it's likely in milliseconds
    if (timestamp > 4000000000) {
      return Math.floor(timestamp / 1000); // Convert milliseconds to seconds
    }
    return timestamp; // Already in seconds
  }




 // Server time functionality has been removed

















  

// Create a dedicated observer for the network page to catch dynamic content
document.addEventListener('DOMContentLoaded', () => {
  const networkPage = document.getElementById('community-page');
  if (networkPage) {
    const networkObserver = new MutationObserver(() => {
      // Translate whenever network page changes
      // Network page elements will be updated automatically
    });
    
    networkObserver.observe(networkPage, { 
      childList: true, 
      subtree: true,
      characterData: true,
      attributes: true
    });
  }
});

  // Function to update elements with data-translate-key attributes
  function updateDynamicTranslations() {
    const elementsWithTranslateKeys = document.querySelectorAll('[data-translate-key]');
    elementsWithTranslateKeys.forEach(element => {
      const key = element.getAttribute('data-translate-key');
      if (key) {
        // Find and update only the text portion, preserving any icons
        const iconElement = element.querySelector('i, svg');
        if (iconElement) {
          // Secure: Clone icon and add text safely
          const translatedText = translator.translate(key);
          element.textContent = '';
          element.appendChild(iconElement.cloneNode(true));
          element.appendChild(document.createTextNode(' ' + translatedText));
        } else {
          // If no icon, just update the text
          element.textContent = translator.translate(key);
        }
      }
    });
    
    // Also update processing history elements specifically
    const collectingElements = document.querySelectorAll('.history-amount.collecting');
    collectingElements.forEach(element => {
      const iconElement = element.querySelector('i.fa-spinner');
      if (iconElement) {
        // Secure: Clone icon and add text safely
        const translatedText = translator.translate("Collecting...");
        element.textContent = '';
        element.appendChild(iconElement.cloneNode(true));
        element.appendChild(document.createTextNode(' ' + translatedText));
      }
    });
  }

  if (languageSelect) {
    languageSelect.value = savedLanguage;
    languageSelect.addEventListener('change', function() {
      // Set the new language
      translator.setLanguage(this.value);
      
      // Apply Arabic CSS if needed
      if (this.value === "ar") {
        document.body.classList.add("arabic");
        localStorage.setItem("arabic-css-enabled", "true");
        document.documentElement.setAttribute('lang', 'ar');
      } else {
        document.body.classList.remove("arabic");
        localStorage.setItem("arabic-css-enabled", "false");
        document.documentElement.setAttribute('lang', this.value);
      }
      
      if (profileLanguageSelect) {
        profileLanguageSelect.value = this.value;
      }

      // Update the UI with new language
      updateUILanguage();
      
      // Update dynamic translations with data attributes
      updateDynamicTranslations();
      
      saveLanguagePreference(this.value);
    });
  }

  if (profileLanguageSelect) {
    // Add all language options
    const languageOptions = {
      'en': 'English',
      'fr': 'Français',
      'es': 'Español',
      'it': 'Italiano',
      'tr': 'Türkçe',
      'hi': 'हिन्दी',
      'zh': '中文',
      'ja': '日本語',
      'ko': '한국어',
      'pt': 'Português',
      'ru': 'Русский',
      'de': 'Deutsch',
      'ar': 'العربية',
      'id': 'Bahasa Indonesia',
      'pl': 'Polski'
    };

    // Clear existing options
    profileLanguageSelect.innerHTML = '';

    // Add options to select element
    for (const [code, name] of Object.entries(languageOptions)) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = name;
      profileLanguageSelect.appendChild(option);
    }

    profileLanguageSelect.value = savedLanguage;
    profileLanguageSelect.addEventListener('change', function() {
      const newLanguage = this.value;
      console.log('Profile language changed to:', newLanguage);

      // Set the language in translator
      translator.setLanguage(newLanguage);

      // Sync with login screen language selector if it exists
      if (languageSelect) {
        languageSelect.value = newLanguage;
      }

      // Update UI with new language - this translates everything
      updateUILanguage();
      
      // Update dynamic translations with data attributes
      updateDynamicTranslations();
      
      saveLanguagePreference(newLanguage);

    
 // Ensure all sidebar and mobile menu elements are updated right away
      const navElements = document.querySelectorAll('.nav-link, .mobile-nav-item, .more-menu-item');
      navElements.forEach(element => {
        // Handle sidebar items
        if (element.classList.contains('nav-link')) {
          const icon = element.querySelector('i');
          const pageName = element.getAttribute('data-page');
          if (pageName) {
            // Use the page name as key to get its translation
            const translatedText = translator.translate(pageName);
            if (translatedText && icon) {
              // Secure: Clear and rebuild with safe DOM methods
              element.textContent = '';
              element.appendChild(icon.cloneNode(true));
              element.appendChild(document.createTextNode(' ' + translatedText));
            }
          }
        }
        // Handle mobile menu items
        else if (element.classList.contains('mobile-nav-item')) {
          const icon = element.querySelector('i');
          const textSpan = element.querySelector('span');
          const pageName = element.getAttribute('data-page');
          if (textSpan && pageName) {
            // Use the page name as key to get its translation
            const translatedText = translator.translate(pageName);
            if (translatedText) {
              textSpan.textContent = translatedText;
            }
          }
        }
        // Handle more menu items if they exist
        else if (element.classList.contains('more-menu-item')) {
          const icon = element.querySelector('i');
          const textSpan = element.querySelector('span');
          if (textSpan && textSpan.textContent) {
            const originalText = textSpan.textContent.trim().toLowerCase();
            const translatedText = translator.translate(originalText);
            if (translatedText) {
              textSpan.textContent = translatedText;
            }
          }
        }
      });

      

      
    

      // Force update profile page with multiple attempts to ensure translations take effect
      // First immediate attempt
      updateSpecificUIElements();

      // Second attempt after a short delay
      setTimeout(function() {
        updateSpecificUIElements();

        // Direct translation of all profile labels to ensure coverage
        const allLabels = document.querySelectorAll('#profile-page .profile-label, #profile-page .profile-labels');
        allLabels.forEach(label => {
          if (label.textContent) {
            const originalText = label.textContent.trim();
            const translatedText = translator.translate(originalText);
            if (translatedText && translatedText !== originalText) {
              label.textContent = translatedText;
            }
          }
        });

        // Also translate specific known labels directly
        translateProfileLabel('Balance:', 'Balance:');
        translateProfileLabel('Referral Code:', 'Referral Code:');
        translateProfileLabel('Language:', 'Language:');
        translateProfileLabel('Night Mode:', 'Night Mode:');
        translateProfileLabel('Theme Brightness:', 'Theme Brightness:');

        // Translate select options
        translateSelectOptions('night-mode-select');
        
      
      }, 300);
       });



 document.getElementById("profile-language").addEventListener("change", function () {
  const selectedLang = this.value;

  if (selectedLang === "ar") {
    document.body.classList.add("arabic");
    localStorage.setItem("arabic-css-enabled", "true");
    document.documentElement.setAttribute("lang", "ar");
  } else {
    document.body.classList.remove("arabic");
    localStorage.setItem("arabic-css-enabled", "false");
    document.documentElement.setAttribute("lang", selectedLang);
  }
});

// Apply Arabic CSS on page initialization - moved outside DOMContentLoaded
function applyArabicCssIfNeeded() {
  const preferredLanguage = localStorage.getItem("preferredLanguage");
  const arabicCssEnabled = localStorage.getItem("arabic-css-enabled");
  
  if (arabicCssEnabled === "true" || preferredLanguage === "ar") {
    document.body.classList.add("arabic");

// Add enhanced event listener to translate network elements when changing pages
document.addEventListener('DOMContentLoaded', function() {
  // Function to comprehensively translate all network page elements with guaranteed coverage




  
   // here


  

  

  // Apply translations when navigating to network page
  document.querySelectorAll('.nav-link, .mobile-nav-item').forEach(link => {
    link.addEventListener('click', function() {
      const pageName = this.getAttribute('data-page');
      if (pageName === 'network') {
        // Translate immediately when page is shown
        // Network page translation handled automatically
        
        // Set up enhanced observer after a short delay to ensure page is loaded
        // Network page observer handled automatically
        
        // Additional translation pass after wallet initialization is likely complete
        // Network page translation handled automatically
      }
    });
  });
  
  // Enhanced language change listener for both language selectors
  [document.getElementById('language-select'), document.getElementById('profile-language')].forEach(select => {
    if (select) {
      select.addEventListener('change', function() {
        // Force immediate translation of all network elements regardless of page visibility
        // Network page translation handled automatically
        
        // If network page is currently visible, apply multiple translation passes
        // with increasing delays to ensure complete coverage
        if (document.getElementById('community-page') && 
            document.getElementById('community-page').style.display !== 'none') {
          
          // Series of delayed translations to catch all elements as they update
          [100, 300, 600, 1000, 1500].forEach(delay => {
            // Network page translation handled automatically
          });
          
          // Recreate network observer with new language context
          // Network page observer handled automatically
        }
      });
    }
  });
  
  // Apply translations when page becomes visible
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      // Check if network page is visible
      const networkPage = document.getElementById('community-page');
      if (networkPage && window.getComputedStyle(networkPage).display !== 'none') {
        // Apply translations with multiple passes when returning to the page
        // Network page translation handled automatically
        
        // Recreate network observer to ensure it's using the current language
        setTimeout(createBlockchainObserver, 200);
      }
    }
  });
  
  // Check if network page is already visible on load and apply translations
  if (document.getElementById('community-page') && 
      window.getComputedStyle(document.getElementById('community-page')).display !== 'none') {
    // Network page translation handled automatically
    // Network page observer handled automatically
  }
  
  // Also translate whenever any modal is opened
  document.body.addEventListener('click', function(event) {
    // Check if clicked element opens a modal
    const target = event.target;
    if (target && target.closest('#import-wallet, #new-transaction, .view-all')) {
      // Small delay to let the modal open
      // Network page translation handled automatically
      // Additional passes for modals that might load content dynamically
      // Network page translation handled automatically
      // Network page translation handled automatically
    }
  }, true);
});

    document.documentElement.setAttribute("lang", "ar");
    
    // Also update the language selector if it exists
    const profileLanguageSelect = document.getElementById("profile-language");
    if (profileLanguageSelect) {
      profileLanguageSelect.value = "ar";
    }
  }
}

// Apply immediately when script runs
applyArabicCssIfNeeded();

// Also apply on DOMContentLoaded for redundancy
document.addEventListener('DOMContentLoaded', applyArabicCssIfNeeded);

// Additional check to ensure Arabic CSS is applied after page fully loads
window.addEventListener('load', applyArabicCssIfNeeded);


  
    // Helper function to translate profile labels by content
    function translateProfileLabel(originalText, fallbackText) {
      const elements = document.querySelectorAll('#profile-page .profile-label, #profile-page .profile-labels');
      elements.forEach(element => {
        if (element.textContent.trim() === originalText || element.textContent.trim() === fallbackText) {
          element.textContent = translator.translate(originalText);
        }
      });
    }

    // Helper function to translate all options in a select element
    function translateSelectOptions(selectId) {
      const select = document.getElementById(selectId);
      if (select) {
        const options = select.querySelectorAll('option');
        options.forEach(option => {
          const originalText = option.textContent.trim();
          const translatedText = translator.translate(originalText);
          if (translatedText && translatedText !== originalText) {
            option.textContent = translatedText;
          }
        });
      }
    }
  }

 // Check for saved user session
  const savedUser = loadUserSession();
  if (savedUser) {
    console.log('Restoring user session for:', savedUser.email);
    currentUser = savedUser;

    // Load user data before showing the app interface
    loadUserData(currentUser.email).then(async () => {
      // Show app interface instead of login
      const loginContainer = document.getElementById('login-container');
      const appContainer = document.getElementById('app-container');
      if (loginContainer && appContainer) {
        // Use class-based system for auth state - NO direct style manipulation
        document.documentElement.classList.remove('user-not-logged-in');
        document.documentElement.classList.add('user-logged-in');
        document.documentElement.classList.add('auth-ready');

        // Update UI with user information
        updateUserInfo(currentUser);

        // Force update profile member since date immediately
        setTimeout(() => {
          if (typeof window.updateProfileMemberSinceDate === 'function') {
            window.updateProfileMemberSinceDate();
          }
          
          // Also force display the element
          const memberSinceElement = document.getElementById('profile-member-since');
          if (memberSinceElement) {
            memberSinceElement.style.display = 'block';
            memberSinceElement.style.visibility = 'visible';
            memberSinceElement.style.opacity = '1';
          }
        }, 500);

        // IMPORTANT: Check for completed processing when user returns to site
        if (currentUser.id) {
          // ⚡ PRELOAD: تحميل بيانات Activity مسبقاً عند استعادة الجلسة
          preloadActivityData(currentUser.id);
          
          // 
          console.log('Checking processing status immediately after session restore');
          if (typeof checkProcessingStatus === 'function') {
            checkProcessingStatus().then(() => {
              // 
              initializeDashboardTimer();
            }).catch(err => {
              console.error('Error in immediate processing status check:', err);
              //
              initializeDashboardTimer();
            });
          } else {
            console.log('checkProcessingStatus function not found, initializing timer directly');
            initializeDashboardTimer();
          }
        
          // Connect to WebSocket for presence tracking
          connectPresenceWebSocket(currentUser.id);
          
          // 🔔 طلب إذن الإشعارات للتطبيق (TWA/PWA) - نافذة النظام العادية
          console.log('🔔 Checking notification permission:', Notification?.permission);
          if ('Notification' in window) {
            if (Notification.permission === 'default') {
              console.log('🔔 Permission is default, requesting...');
              requestNotificationPermission(currentUser.id);
            } else if (Notification.permission === 'granted') {
              // الإذن موجود مسبقاً، نسجل الـ subscription فقط
              console.log('🔔 Permission granted, registering push...');
              registerPushNotifications(currentUser.id);
            } else {
              console.log('🔔 Permission denied:', Notification.permission);
            }
          } else {
            console.log('🔔 Notifications not supported in this browser');
          }
          
          // Load processing history when restoring session
          addProcessingHistoryEntry();
          
          // 
          setTimeout(async () => {
            if (currentUser && currentUser.id) {
              console.log('Secondary processing status check after 2 seconds');
              try {
                if (typeof checkProcessingStatus === 'function') {
                  await checkProcessingStatus();
                }
                initializeDashboardTimer();
              } catch (err) {
                console.error('Secondary check failed:', err);
              }
            }
          }, 2000);
          
          // Make dashboard timer always visible
          updateDashboardProcessingTimer(currentUser.processing_remaining_seconds || 0);
        }
      }
    });
  }

  // Initialize WebSocket connection for real-time presence tracking
  let presenceSocket = null;
  let heartbeatInterval = null;
  let pingInterval = null;
  let reconnectTimeout = null;
  let lastMessageTime = 0;

  function connectPresenceWebSocket(userId) {
    // Implement enhanced exponential backoff for reconnection
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 15; // Increased max attempts
    const baseReconnectDelay = 1000; // Start with 1 second

    // Clean up existing connection and intervals
    cleanupExistingConnection();

    // Get the correct WebSocket URL (using the same host as the current page)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/presence?userId=${userId}`;

    console.log('Connecting to presence WebSocket:', wsUrl);

    // Create WebSocket with error handling in a try-catch block
    try {
      presenceSocket = new WebSocket(wsUrl);
      lastMessageTime = Date.now(); // Track connection attempt time

      // Set connection timeout
      const connectionTimeout = setTimeout(() => {
        if (presenceSocket && presenceSocket.readyState === WebSocket.CONNECTING) {
          console.log('WebSocket connection timeout, closing and retrying...');
          try {
            presenceSocket.close();
          } catch (err) {
            console.error('Error closing timed out connection:', err.message);
          }
          scheduleReconnect();
        }
      }, 10000); // 10 second connection timeout

      presenceSocket.onopen = function() {
        console.log('Presence WebSocket connected - user is now online');
        clearTimeout(connectionTimeout); // Clear connection timeout

        // Reset reconnect attempts on successful connection
        reconnectAttempts = 0;
        lastMessageTime = Date.now();

        // Send initial presence message
        try {
          presenceSocket.send(JSON.stringify({ 
            type: 'connect', 
            userId: userId,
            userAgent: navigator.userAgent,
            timestamp: Date.now()
          }));
        } catch (err) {
          console.error('Error sending initial presence message:', err.message);
        }

        // Set up heartbeat interval (reduced frequency)
        heartbeatInterval = setInterval(() => {
          if (presenceSocket && presenceSocket.readyState === WebSocket.OPEN) {
            try {
              presenceSocket.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
              lastMessageTime = Date.now();
            } catch (e) {
              console.error('Error sending heartbeat:', e.message);
              // If sending fails, try to reconnect
              cleanupExistingConnection();
              scheduleReconnect();
            }
          }
        }, 25000); // Every 25 seconds

        // Set up ping interval for more frequent connection checks
        pingInterval = setInterval(() => {
          if (presenceSocket && presenceSocket.readyState === WebSocket.OPEN) {
            // Check if we haven't received a message in 45 seconds
            if (Date.now() - lastMessageTime > 45000) {
              console.log('No messages received for 45 seconds, checking connection...');
              try {
                presenceSocket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
              } catch (e) {
                console.error('Error sending ping check:', e.message);
                // Force reconnection if ping fails
                cleanupExistingConnection();
                scheduleReconnect();
              }
            }
          }
        }, 15000); // Check connection every 15 seconds
      };

      // Handle messages from server
      presenceSocket.onmessage = function(event) {
        try {
          lastMessageTime = Date.now(); // Update last message time
          const data = JSON.parse(event.data);

          // Handle different message types
          if (data.type === 'pong' || data.type === 'heartbeat_ack' || data.type === 'connected') {
            // Connection is working correctly
          } else if (data.type === 'balance_received' || data.type === 'instant_balance_update') {
            
            if (data.userId && currentUser && data.userId.toString() === currentUser.id.toString()) {
              console.log(`Balance notification received: ${data.amount || data.difference} Points, newBalance: ${data.newBalance}`);
              
              // Use server-provided newBalance OR fetch from server
              if (data.newBalance !== undefined && data.newBalance !== null) {
                const serverBalance = parseFloat(data.newBalance);
                currentUser.coins = serverBalance;
                saveUserSession(currentUser);
                updateUserCoins(serverBalance);
                console.log(`Balance updated instantly: ${serverBalance}`);
              } else {
                // Fetch fresh balance from server
                (async () => {
                  try {
                    const response = await fetch(`/api/user/${encodeURIComponent(currentUser.email)}`);
                    const userData = await response.json();
                    if (userData.user && userData.user.coins !== undefined) {
                      const freshBalance = parseFloat(userData.user.coins);
                      currentUser.coins = freshBalance;
                      saveUserSession(currentUser);
                      updateUserCoins(freshBalance);
                      console.log(`Balance fetched from server: ${freshBalance}`);
                    }
                  } catch (e) {
                    console.error('Error fetching balance:', e);
                  }
                })();
              }
              
              // Show notification
              const amount = data.amount || data.difference || 0;
              if (typeof showNotification === 'function' && amount > 0) {
                showNotification(`${translator.translate('Received')} ${formatNumberSmart(amount)} Points`, 'success'); 
              }

              // Refresh transaction list if on network page
              if (document.getElementById('community-page') && 
                  window.getComputedStyle(document.getElementById('community-page')).display !== 'none') {
                setTimeout(() => {
                  if (typeof updateTransactionList === 'function') {
                    updateTransactionList();
                  }
                }, 500);
              }
            }
          } else if (data.type === 'error') {
            console.error('Server reported WebSocket error:', data.message);
            // Handle specific errors from server
            if (data.code === 'duplicate_connection') {
              // Just acknowledge, server will handle the duplicate
              console.log('Server detected duplicate connection');
            }
          }
        } catch (e) {
          console.error('Error parsing WebSocket message:', e.message);
        }
      };

      presenceSocket.onclose = function(event) {
        clearTimeout(connectionTimeout); // Clear connection timeout if still active

        console.log('Presence WebSocket disconnected - user is now offline', 
                    event.code ? `Code: ${event.code}` : '', 
                    event.reason ? `Reason: ${event.reason}` : '');

        cleanupIntervals();

        // Handle different close codes
        if (event.code === 1000) {
          // Normal closure - no need to reconnect immediately
          // Still schedule a delayed reconnect in case user stays on page
          if (reconnectAttempts < 2) {
            reconnectTimeout = setTimeout(() => {
              connectPresenceWebSocket(userId);
            }, 5000); // Wait 5 seconds before reconnecting after normal close
          }
        } else if (reconnectAttempts < maxReconnectAttempts) {
          // Abnormal closure - schedule reconnect
          scheduleReconnect();
        } else {
          console.log('Maximum reconnection attempts reached, will try again when user interacts with page');
          // Reset reconnect attempts after some time
          setTimeout(() => {
            reconnectAttempts = 0;
          }, 60000); // Reset after 1 minute
        }
      };

      presenceSocket.onerror = function(error) {
        console.error('Presence WebSocket error occurred');
        // Log the error but rely on onclose for reconnection handling
        lastMessageTime = 0; // Reset last message time to force ping check
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error.message);
      scheduleReconnect();
    }

    // Clean up existing connection and intervals
    function cleanupExistingConnection() {
      if (presenceSocket) {
        // Only close if not already closing or closed
        if (presenceSocket.readyState !== WebSocket.CLOSING && 
            presenceSocket.readyState !== WebSocket.CLOSED) {
          try {
            presenceSocket.close(1000, 'Connection cleanup');
          } catch (e) {
            console.log('Error closing previous WebSocket:', e.message);
          }
        }
        presenceSocket = null;
      }

      cleanupIntervals();

      // Clear any pending reconnect
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    }

    // Clean up intervals only
    function cleanupIntervals() {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
    }

    // Function to handle reconnection with improved exponential backoff
    function scheduleReconnect() {
      if (reconnectAttempts >= maxReconnectAttempts) {
        console.log('Maximum reconnection attempts reached, waiting for user interaction');

        // Set up one-time event listeners to detect user activity and retry
        const retryOnActivity = function() {
          // Reset reconnect attempts when user interacts with the page
          reconnectAttempts = 0;
          console.log('User activity detected, retrying connection');
          connectPresenceWebSocket(userId);

          // Remove all the listeners after reconnection attempt
          document.removeEventListener('click', retryOnActivity);
          document.removeEventListener('keydown', retryOnActivity);
          document.removeEventListener('mousemove', retryOnActivity);
          document.removeEventListener('touchstart', retryOnActivity);
        };

        // Add event listeners for user interaction
        document.addEventListener('click', retryOnActivity, { once: true });
        document.addEventListener('keydown', retryOnActivity, { once: true });
        document.addEventListener('mousemove', retryOnActivity, { once: true });
        document.addEventListener('touchstart', retryOnActivity, { once: true });

        return;
      }

      // Calculate delay with exponential backoff and jitter
      const jitter = Math.floor(Math.random() * 500); // Add 0-500ms of random jitter
      const delay = Math.min(
        30000, // Max 30 seconds
        baseReconnectDelay * Math.pow(1.5, reconnectAttempts) + jitter
      );

      console.log(`Scheduling reconnect attempt ${reconnectAttempts + 1} in ${delay}ms`);

      reconnectTimeout = setTimeout(() => {
        reconnectAttempts++;
        console.log(`Reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
        connectPresenceWebSocket(userId);
      }, delay);
    }

    // Enhanced page visibility handler
    const visibilityHandler = function() {
      if (document.visibilityState === 'visible') {
        // Check if socket is closed or needs refreshing
        const socketNeedsReconnect = !presenceSocket || 
                                    presenceSocket.readyState === WebSocket.CLOSED || 
                                    presenceSocket.readyState === WebSocket.CLOSING ||
                                    (Date.now() - lastMessageTime > 45000); // No message for 45+ seconds

        if (socketNeedsReconnect) {
          console.log('Page became visible, reconnecting WebSocket');
          cleanupExistingConnection();
          // Reset reconnect attempts when user returns to tab
          reconnectAttempts = 0;
          connectPresenceWebSocket(userId);
        } else if (presenceSocket.readyState === WebSocket.CONNECTING) {
          console.log('WebSocket already trying to connect, waiting...');
        } else if (presenceSocket.readyState === WebSocket.OPEN) {
          console.log('WebSocket already connected on page visible');
          // Send a ping to verify connection is still alive
          try {
            presenceSocket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            lastMessageTime = Date.now();
          } catch (e) {
            console.error('Error sending ping on visibility change:', e.message);
            // If sending fails, reconnect
            cleanupExistingConnection();
            connectPresenceWebSocket(userId);
          }
        }
      } else {
        console.log('Page hidden, WebSocket will reconnect when visible');
      }
    };

    // Remove any existing visibility handler before adding a new one
    document.removeEventListener('visibilitychange', visibilityHandler);
    document.addEventListener('visibilitychange', visibilityHandler);

    // Handle page unload to close connection cleanly
    const beforeUnloadHandler = function() {
      if (presenceSocket && presenceSocket.readyState === WebSocket.OPEN) {
        try {
          // Send a specific logout message 
          presenceSocket.send(JSON.stringify({ 
            type: 'logout', 
            userId: userId,
            timestamp: Date.now()
          }));

          // Close socket when user leaves page
          presenceSocket.close(1000, 'Page unloaded');

          // Clear all intervals
          cleanupIntervals();
        } catch (e) {
          console.error('Error during WebSocket cleanup:', e.message);
        }
      }
    };

    // Remove existing handler before adding a new one
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    window.addEventListener('beforeunload', beforeUnloadHandler);
  }


 // Save minimal user session data - only what's needed to keep user logged in
  function saveUserSession(user) {
    if (user) {
      // Save only essential authentication data
      const minimalUserData = {
        id: user.id,
        email: user.email,
        token: user.token
        // Don't store name or avatar in localStorage to ensure fresh data on login
      };
      localStorage.setItem('accessoireUser', JSON.stringify(minimalUserData));
      console.log('Saved minimal user session for:', minimalUserData.email);
    }
  }


   // Load user session from localStorage
  function loadUserSession() {
    const savedUser = localStorage.getItem('accessoireUser');
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        // Always force a fresh data load from server when restoring session
        userData._requiresRefresh = true;
        userData._forceUpdate = true; // Add flag to force fresh profile data
        return userData;
      } catch (e) {
        console.error('Failed to parse saved user session:', e);
        localStorage.removeItem('accessoireUser');
        return null;
      }
    }
    return null;
  }

  window.loadUserSession = loadUserSession;
  window.getCurrentUser = function() {
    return currentUser;
  };

  // Function to use fallback user data when database retrieval fails
  function useFallbackUserData() {
    console.log("Using fallback user data due to error");
    const fallbackData = {
      id: 0,
      email: currentUser?.email || "",
      name: currentUser?.name || "User",
      avatar: currentUser?.avatar || "",
      coins: 0,
      referralCode: generateReferralCode(),
      processing_active: 0,
      processing_duration: 0,
      processing_remaining: 0,
      last_payout: Date.now(),
      language: "en"
    };
    
    // Update current user with fallback data
    currentUser = {...currentUser, ...fallbackData};
    updateUserInfo(currentUser);
    updateUserCoins(0);
    updateReferralCode(fallbackData.referralCode);
    
    return fallbackData;
  }

  // Load user data from database, ensuring we always get fresh data
  async function loadUserData(email) {
    console.log('Loading user data for:', email);

    // Clean up any secondary storage that might exist
    localStorage.removeItem('accessoireUserData');
    
    // Apply saved language immediately on page load
    const savedLanguage = localStorage.getItem('preferredLanguage') || 'en';
    translator.setLanguage(savedLanguage);
    if (languageSelect) {
      languageSelect.value = savedLanguage;
    }
    if (profileLanguageSelect) {
      profileLanguageSelect.value = savedLanguage;
    }

    // Mark UI as loading if needed
    const profileAvatar = document.getElementById('profile-avatar');
    const mobileAvatar = document.getElementById('mobile-user-avatar');

    // First quickly show any minimal data we have to avoid blank UI
    if (currentUser) {
      // Set minimal data to avoid blank fields while loading
      updateUserInfo(currentUser);
    }

   

    // Always load fresh data from the server
    try {
      // Check if user exists in database and get their data
      const userData = await checkIfUserExists(email);

      if (userData) {
        console.log('Fresh server data received');
        // Update UI with fresh user data
        updateUserCoins(userData.coins || 0);
        updateReferralCode(userData.referralCode);

        // Set current user data directly from server
        currentUser = {...currentUser, ...userData};

        // Explicitly update UI with the fresh data immediately
        updateUserInfo(currentUser);

        // Save only minimal authentication data
        saveUserSession(currentUser);

        // Load processing stats from fresh user data
        if (window.loadProcessingStatsFromUser) {
          window.loadProcessingStatsFromUser(userData);
        }

        //
        if (userData.id) {
          console.log('Checking processing status after loading fresh user data');
          checkProcessingStatus().then(() => {
            
            updateDashboardProcessingTimer(currentUser.processing_remaining_seconds || 0);
          }).catch(err => {
            console.error('Error checking processing status after user data load:', err);
          });
          
          loadUserReferrals(userData.id);
        }

        // We've got fresh data, so return early
        return;
      }
    } catch (error) {
      console.log('Error fetching data from server:', error);
      // Try one more time after a short delay
      setTimeout(async () => {
        try {
          const retryData = await checkIfUserExists(email);
          if (retryData) {
            console.log('Retry successful, updating with fresh data');
            currentUser = {...currentUser, ...retryData};
            updateUserInfo(currentUser);
            updateUserCoins(retryData.coins || 0);
            updateReferralCode(retryData.referralCode);

            if (retryData.id) {
              loadUserReferrals(retryData.id);
            }
          }
        } catch (retryError) {
          console.error('Retry also failed:', retryError);
        }
      }, 1000);
    }

    // Fallback approach - check if user exists in database
    checkIfUserExists(email).then(async (existingUser) => {
      if (existingUser) {
        console.log('User found in database, loading data');
        // Update UI with user data
        updateUserCoins(existingUser.coins || 0);
        updateReferralCode(existingUser.referralCode);

        // Merge with current user data
        const updatedUser = {...currentUser, ...existingUser};
        currentUser = updatedUser;

        // Update UI explicitly again
        updateUserInfo(updatedUser);

        // Save minimal authentication data
        saveUserSession(updatedUser);

        // Load referrals
        if (existingUser.id) {
          loadUserReferrals(existingUser.id);
        }
      } else {
        // User not found in DB, create new user with current data
        console.log('No user found in database, creating new user');
        
        // Generate a new referral code for new user
        const newReferralCode = generateReferralCode();
        
        // Extract referral code from input field before creating user
        const referralInput = document.getElementById('referral-code');
        const currentReferralCode = referralInput ? referralInput.value.trim() : '';
        
        // ✅ FIX: Wait for user creation to complete before continuing
        try {
          const result = await createUser({
            email: currentUser.email,
            name: currentUser.name,
            avatar: currentUser.avatar
          }, newReferralCode, currentReferralCode);
          
          if (result && result.user) {
            console.log('✅ New user created with ID:', result.user.id);
            // Update currentUser with the new ID
            currentUser = {...currentUser, ...result.user, id: result.user.id};
            saveUserSession(currentUser);
          }
        } catch (createError) {
          console.error('Error creating new user:', createError);
        }
      }
    }).catch(error => {
      console.error('Error loading user data:', error);
      
      // Use current user data or fallback
      if (currentUser && currentUser.email === email) {
        console.log('Database error, using current user data');
        // Generate fallback data for current user
        currentUser.coins = 0;
        currentUser.referralCode = generateReferralCode();
        updateUserInfo(currentUser);
        updateUserCoins(0);
        updateReferralCode(currentUser.referralCode);
      } else {
        console.log('Using fallback user data');
        useFallbackUserData();
      }
    });
  }

  // Update UI with user information, ensuring we display the most recent data
  function updateUserInfo(user) {
    console.log('Updating user interface with current data:', user.email);

    // Update profile page elements
    const profileName = document.getElementById('profile-name');
    const profileEmail = document.getElementById('profile-email');
    const profileAvatar = document.getElementById('profile-avatar');
    const profileNameInput = document.getElementById('profile-name-input');

    // Update all UI elements with current user data
    if (profileName) profileName.textContent = user.name || 'User';
    if (profileEmail) profileEmail.textContent = user.email || '';
    // Default avatar SVG
    const defaultAvatarSvg = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2M2YzZjNiIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMTIiIHI9IjciIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMTAgMzBjMC01IDQtOCAxMC04czEwIDMgMTAgOHYxYzAgMS0xIDItMiAyaC0xNmMtMSAwLTIgLTEtMi0ydi0xeiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==';

    if (profileAvatar) {
      // Add cache-busting parameter for images to prevent browser caching the old image
      const avatarUrl = user.avatar || defaultAvatarSvg;
      const cacheBuster = `?t=${Date.now()}`;

      // Only add cache buster for URLs that aren't data URLs
      if (avatarUrl.startsWith('data:')) {
        profileAvatar.src = avatarUrl;
      } else {
        profileAvatar.src = avatarUrl + cacheBuster;
      }
    }
    if (profileNameInput) profileNameInput.value = user.name || 'User';

    // Also update user avatar on mobile header if it exists
    const mobileAvatar = document.getElementById('mobile-user-avatar');
    if (mobileAvatar) {
      const avatarUrl = user.avatar || defaultAvatarSvg;
      const cacheBuster = `?t=${Date.now()}`;

      // Only add cache buster for URLs that aren't data URLs
      if (avatarUrl.startsWith('data:')) {
        mobileAvatar.src = avatarUrl;
      } else {
        mobileAvatar.src = avatarUrl + cacheBuster;
      }
    }

    // Also update dashboard avatar and name to match profile
    const dashboardAvatar = document.getElementById('dashboard-profile-avatar');
    const dashboardUserName = document.getElementById('dashboard-user-name');
    
    if (dashboardAvatar) {
      const avatarUrl = user.avatar || defaultAvatarSvg;
      const cacheBuster = `?t=${Date.now()}`;

      // Only add cache buster for URLs that aren't data URLs
      if (avatarUrl.startsWith('data:')) {
        dashboardAvatar.src = avatarUrl;
      } else {
        dashboardAvatar.src = avatarUrl + cacheBuster;
      }
    }
    
    if (dashboardUserName && user.name) {
      dashboardUserName.textContent = user.name;
    }

    // For restored sessions, ALWAYS force an immediate DB refresh to get latest picture and name
    if ((user._forceUpdate || user._requiresRefresh) && user.email) {
      console.log('Forcing refresh of user data from server');
      checkIfUserExists(user.email).then(userData => {
        if (userData) {
          // Update the UI with latest server data
          if (profileName) profileName.textContent = userData.name || 'User';
          if (profileAvatar) {
            const avatarUrl = userData.avatar || defaultAvatarSvg;
            const cacheBuster = `?t=${Date.now()}`;

            if (avatarUrl.startsWith('data:')) {
              profileAvatar.src = avatarUrl;
            } else {
              profileAvatar.src = avatarUrl + cacheBuster;
            }
          }
          if (profileNameInput) profileNameInput.value = userData.name || 'User';
          if (mobileAvatar) {
            const avatarUrl = userData.avatar || defaultAvatarSvg;
            const cacheBuster = `?t=${Date.now()}`;

            if (avatarUrl.startsWith('data:')) {
              mobileAvatar.src = avatarUrl;
            } else {
              mobileAvatar.src = avatarUrl + cacheBuster;
            }
          }

          // Also update dashboard avatar and name
          const dashboardAvatar = document.getElementById('dashboard-profile-avatar');
          const dashboardUserName = document.getElementById('dashboard-user-name');
          
          if (dashboardAvatar) {
            const avatarUrl = userData.avatar || defaultAvatarSvg;
            const cacheBuster = `?t=${Date.now()}`;

            if (avatarUrl.startsWith('data:')) {
              dashboardAvatar.src = avatarUrl;
            } else {
              dashboardAvatar.src = avatarUrl + cacheBuster;
            }
          }
          
          if (dashboardUserName && userData.name) {
            dashboardUserName.textContent = userData.name;
          }

          // Update current user data
          currentUser = {...currentUser, ...userData};
          delete currentUser._forceUpdate;
          delete currentUser._requiresRefresh;

          console.log('User data refreshed from server with latest values');
        }
      }).catch(error => {
        console.error('Error refreshing user data:', error);
      });
    }
  }



  // Function to save language preference
  function saveLanguagePreference(lang) {
    localStorage.setItem('preferredLanguage', lang);
    console.log('Language preference saved:', lang);
  }

  // Load Google OAuth configuration dynamically - Global function for all pages
  window.loadGoogleOAuthConfig = async function() {
    try {
      const response = await fetch('/api/oauth-config');
      const config = await response.json();
      if (config.success) {
        window.GOOGLE_CLIENT_ID = config.clientId;
        console.log('Google OAuth configuration loaded securely');
        return Promise.resolve();
      } else {
        console.error('Failed to load OAuth configuration:', config.error || 'Unknown error');
        return Promise.reject(new Error(config.error || 'Failed to load OAuth config'));
      }
    } catch (error) {
      console.error('Failed to load OAuth configuration from server:', error);
      // No fallback - force secure configuration loading
      return Promise.reject(error);
    }
  };



 



 window.onload = function () {
  // Load OAuth config first before initializing
  if (typeof loadGoogleOAuthConfig === 'function') {
    loadGoogleOAuthConfig().then(() => {
      if (window.GOOGLE_CLIENT_ID && typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.initialize({
          client_id: window.GOOGLE_CLIENT_ID,
          callback: handleGoogleSignIn, 
          auto_select: false,
          cancel_on_tap_outside: false
        });

        const googleBtn = document.getElementById('googleLoginBtn');
        if (googleBtn) {
          googleBtn.addEventListener('click', () => {
            google.accounts.id.prompt();
          });
        }
      } else {
        console.error('Google OAuth config not available');
      }
    }).catch(error => {
      console.error('Failed to load Google OAuth config:', error);
    });
  } else {
    console.error('loadGoogleOAuthConfig function not available');
  }
};

  
function initializeGoogleSignIn() {
  // Initialize only when Google library is loaded
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
    console.log('Google Identity Services not loaded yet');
    return;
  }

  try {
    if (!window.GOOGLE_CLIENT_ID) {
      console.error('Google Client ID not configured - OAuth not available');
      return;
    }
    
    google.accounts.id.initialize({
      client_id: window.GOOGLE_CLIENT_ID,
      callback: handleGoogleSignIn,
      auto_select: false,
      cancel_on_tap_outside: false
    });

    
    const myCustomButton = document.getElementById('googleLoginBtn');
    if (myCustomButton) {
      myCustomButton.addEventListener('click', () => {
        google.accounts.id.prompt();
      });
    }

  } catch (error) {
    console.error('Error initializing Google Sign-in:', error);
  }
}


  // Initialize when page loads
  document.addEventListener('DOMContentLoaded', initializeGoogleSignIn);
  window.addEventListener('load', initializeGoogleSignIn);

  // Navigation handling
  setupNavigation();

  // Setup page change detection for dashboard timer with enhanced initialization
  document.addEventListener('click', function(event) {
    const target = event.target.closest('[data-page]');
    if (target && target.getAttribute('data-page') === 'dashboard') {
      // User navigated to dashboard, ensure timer is running and visible
      console.log('User navigated to dashboard - forcing timer refresh');
      setTimeout(() => {
        if (currentUser && currentUser.id) {
          // Force refresh processing status from server
          initializeDashboardTimer();
          
          // Additional check after short delay
          setTimeout(() => {
            // Force update dashboard display
            updateDashboardProcessingTimer(currentUser.processing_remaining_seconds || 0);
          
            
            // If timer still not showing correctly, try one more time
            const dashboardTimer = document.getElementById('dashboard-activity-timer');
            if (dashboardTimer && dashboardTimer.style.display === 'none') {
              console.log('Dashboard timer hidden, forcing visibility');
              dashboardTimer.style.display = 'block';
              initializeDashboardTimer();
            }
          }, 500);
        }
      }, 100);
    }
  });

 

  // Handle Google Sign-in callback
  // ✅ تصدير الدالة على window ليتمكن index.html من استخدامها
  window.handleGoogleSignIn = function handleGoogleSignIn(response) {
    try {
      console.log('🔐 [DEBUG] handleGoogleSignIn called');
      console.log('🔐 [DEBUG] Response type:', typeof response);
      console.log('🔐 [DEBUG] Response:', JSON.stringify(response).substring(0, 200));
      
      // Decode the JWT token with proper UTF-8 support
      const credential = response.credential;
      const base64Url = credential.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      const payload = JSON.parse(jsonPayload);
      
      console.log('🔐 Decoded payload email:', payload.email);
      
      // Extract user information
      currentUser = {
        email: payload.email,
        name: payload.name,
        avatar: payload.picture,
        token: credential
      };

      console.log('Google Sign-in successful:', currentUser.email);

      // Check for referral code from input field
      const referralInput = document.getElementById('referral-code');
      const enteredReferralCode = referralInput ? referralInput.value.trim() : '';
      
      // Update global referralCode variable with the entered value
      referralCode = enteredReferralCode;
      
      console.log('Referral code extracted from input:', referralCode || 'none');

      // ⚡ OPTIMIZED: Show app interface IMMEDIATELY for existing users
      // First, check if we have cached session data for this user
      const cachedSession = localStorage.getItem('accessoireUser');
      let isExistingUser = false;
      let cachedUserData = null;
      if (cachedSession) {
        try {
          const parsed = JSON.parse(cachedSession);
          if (parsed && parsed.email === currentUser.email) {
            isExistingUser = true;
            cachedUserData = parsed;
          }
        } catch(e) {}
      }

      // If existing user (has cache), show app immediately
      if (isExistingUser) {
        console.log('⚡ Fast login: User has cached session, showing app immediately');
        // دمج البيانات المخزنة مع بيانات Google
        if (cachedUserData) {
          currentUser = {...currentUser, ...cachedUserData};
        }
        continueWithLogin(currentUser, referralCode);
        return;
      }

      // ⚡ للمستخدمين بدون كاش: إظهار مؤشر تحميل ثم التحقق
      console.log('No cache found, checking server for existing user...');
      
      // 🔄 إظهار مؤشر تحميل على زر Google
      const googleBtn = document.getElementById('googleLoginBtn');
      if (googleBtn) {
        googleBtn.disabled = true;
        googleBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التحقق...';
      }
      
      // استخدام Promise مع timeout (5 ثواني)
      const checkPromise = checkIfUserExists(currentUser.email);
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000));
      
      Promise.race([checkPromise, timeoutPromise]).then(result => {
        // إعادة زر Google لحالته الأصلية
        if (googleBtn) {
          googleBtn.disabled = false;
          googleBtn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google"> <span data-translate-key="Sign in with Google">Sign in with Google</span>';
        }
        
        if (result === 'timeout') {
          console.log('⚠️ User check timeout, showing privacy policy for safety');
          // عند timeout، نعرض شروط الخصوصية للأمان
          showPrivacyPolicyModal(currentUser, referralCode);
        } else if (!result) {
          // New user - show privacy policy
          showPrivacyPolicyModal(currentUser, referralCode);
        } else {
          // ✅ Existing user - merge data immediately before continuing
          console.log('⚡ User exists, merging data before login');
          currentUser = {...currentUser, ...result};
          continueWithLogin(currentUser, referralCode);
        }
      }).catch(error => {
        console.error('Error checking user exists:', error);
        // إعادة زر Google لحالته الأصلية
        if (googleBtn) {
          googleBtn.disabled = false;
          googleBtn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google"> <span data-translate-key="Sign in with Google">Sign in with Google</span>';
        }
        // عند الخطأ، نعرض شروط الخصوصية للأمان
        showPrivacyPolicyModal(currentUser, referralCode);
      });

    } catch (error) {
      console.error('Google Sign-in Error:', error);
      document.getElementById('login-error').textContent = 'Sign-in failed. Please try again.';
      document.getElementById('login-error').style.display = 'block';
    }
  }
  










  // Blockchain functionality

  // Generate a unique cryptographic wallet for the user
  function generateWallet(userId, email) {
    try {
      // Create a seed based on user ID and email
      const seed = `${userId}-${email}-${Date.now()}`;

      // Use SubtleCrypto for secure key generation if available
      if (window.crypto && window.crypto.subtle) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))
          .then(hashBuffer => {
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const privateKey = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            // Generate public address from private key
            return crypto.subtle.digest('SHA-256', new TextEncoder().encode(privateKey))
              .then(publicBuffer => {
                const publicArray = Array.from(new Uint8Array(publicBuffer));
                const publicAddress = '0x' + publicArray.slice(0, 20).map(b => 
                  b.toString(16).padStart(2, '0')).join('');

                return {
                  privateKey: privateKey,
                  publicAddress: publicAddress
                };
              });
          });
      } else {
        // Fallback for browsers without SubtleCrypto
        console.log("Using fallback wallet generation method");

        // Simple hash function for fallback
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
          const char = seed.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash;
        }

        // Create a deterministic but unique private key
        const privateKey = Math.abs(hash).toString(16).padStart(64, '0');

        // Create public address from private key
        let publicHash = 0;
        for (let i = 0; i < privateKey.length; i++) {
          const char = privateKey.charCodeAt(i);
          publicHash = ((publicHash << 5) - publicHash) + char;
          publicHash = publicHash & publicHash;
        }

        const publicAddress = '0x' + Math.abs(publicHash).toString(16).padStart(40, '0');

        return Promise.resolve({
          privateKey: privateKey,
          publicAddress: publicAddress
        });
      }
    } catch (error) {
      console.error("Error generating wallet:", error);
      // Even if there's an error, generate a deterministic wallet based on email
      const fallbackPrivateKey = Array.from(email).reduce((acc, char) => 
        acc + char.charCodeAt(0).toString(16), '').padEnd(64, '0');
      const fallbackAddress = '0x' + fallbackPrivateKey.substring(0, 40);

      return Promise.resolve({
        privateKey: fallbackPrivateKey,
        publicAddress: fallbackAddress
      });
    }
  }

  // Initialize the user's network wallet
  async function initializeUserWallet() {
    if (!currentUser || !currentUser.id) {
      console.log("Cannot initialize wallet: User not logged in");
      return;
    }

    // Check if user already has a wallet
    const walletAddress = document.getElementById('user-account-address');
    const walletBalance = document.getElementById('wallet-balance');

    // ⚡ INSTANT DISPLAY - عرض فوري بدون "Generating..."
    if (walletAddress && currentUser.wallet_address) {
      // عرض العنوان الموجود فوراً
      walletAddress.textContent = currentUser.wallet_address;
      console.log('✅ Wallet displayed instantly from currentUser:', currentUser.wallet_address);
    } else if (walletAddress) {
      // فقط إذا لم يكن موجود
      walletAddress.textContent = "Loading...";
    }

    // Always display the actual user coins from database in the wallet balance
    if (walletBalance && currentUser.coins !== undefined) {
      walletBalance.textContent = formatNumberSmart(parseFloat(currentUser.coins));
    }

    // 