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

// ✅ Global function to update processingInfo2 with dynamic reward
function updateRewardText() {
  var el = document.querySelector('.processing-info p:last-child');
  if (!el) el = document.querySelector('[data-translate="processingInfo2"]');
  var currentReward = window.serverBaseReward || 0.25;
  var rewardStr = formatNumberSmart(currentReward);
  if (el) {
    if (window.translator) {
      var text = window.translator.translate('processingInfo2');
      text = text.replace('{reward}', rewardStr);
      el.textContent = text;
    } else {
      var currentText = el.textContent;
      if (currentText.indexOf('{reward}') !== -1) {
        el.textContent = currentText.replace('{reward}', rewardStr);
      }
    }
  }
  var rateEl = document.getElementById('tokenomics-processing-rate');
  if (rateEl) {
    rateEl.textContent = '+' + rewardStr;
  }
}

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

    // 🔑 Get fresh VAPID key from server FIRST
    console.log('🔔 Fetching VAPID key from server...');
    const keyRes = await fetch('/api/push/public-key');
    const keyJson = await keyRes.json();
    if (!keyJson.success || !keyJson.publicKey) {
      console.error('❌ Failed to get VAPID key');
      return;
    }
    const vapidPublicKey = keyJson.publicKey;
    console.log('🔔 Got VAPID key:', vapidPublicKey.substring(0, 20) + '...');

    // Check if already subscribed
    let subscription = await registration.pushManager.getSubscription();
    console.log('🔔 Current subscription:', subscription ? 'exists' : 'none');
    
    // ✅ ALWAYS unsubscribe old subscription to fix VAPID mismatch errors
    if (subscription) {
      try {
        await subscription.unsubscribe();
        console.log('🔄 Unsubscribed old push subscription');
        subscription = null;
      } catch (e) {
        console.warn('Could not unsubscribe:', e);
      }
    }
    
    // Create new subscription with fresh VAPID key
    console.log('🔔 Creating new subscription with VAPID key...');
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    });
    console.log('✅ Subscribed to push notifications:', subscription.endpoint.substring(0, 50) + '...');

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

// 🔔 طلب إذن الإشعارات - تم نقله إلى notification-system.js
// ⚠️ DISABLED: This conflicts with notification-system.js which handles permission via modal
// The modal approach is required because modern browsers need user gesture (click) for permission
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
      
      // ⚠️ لا نطلب الإذن تلقائياً - notification-system.js يعرض Modal بدلاً من ذلك
      // المتصفحات الحديثة تحتاج نقرة من المستخدم لطلب الإذن
      if (Notification.permission === 'default') {
        console.log('🔔 [AUTO] Permission is default - waiting for user to click Modal in notification-system.js');
        return; // ✅ لا نفعل شيء - Modal سيظهر من notification-system.js
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
  // ✅ Update reward text on page load
  setTimeout(updateRewardText, 500);
  setTimeout(updateRewardText, 2000);

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

    // ✅ ذكي: يختار عدد الأماكن العشرية حسب حجم الرقم
    var decimals = 8;
    if (number > 0 && number < 0.00000001) {
      decimals = 14;
    }
    
    let formatted = parseFloat(number.toFixed(decimals)).toString();
    
    const parts = formatted.split('.');
    
    // CRITICAL: Ensure at least 2 decimal places for ALL numbers
    if (!parts[1]) {
      parts[1] = '00';
    } else if (parts[1].length === 1) {
      parts[1] = parts[1] + '0';
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
        if (document.getElementById('network-page') && document.getElementById('network-page').style.display !== 'none') {
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
    if (document.getElementById('network-page') && document.getElementById('network-page').style.display !== 'none') {
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
      window.balancePrivacy.originalValues.set('#network-coins', smartFormatted);
    }
    
    // تحديث فقط إذا لم يكن مخفياً
    if (!isBalanceHidden) {
      const coinElements = document.querySelectorAll('#user-coins, #profile-coins, #network-coins, .balance-display, .user-balance');
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

        // 🔄 HALVING: تحديث المكافأة الأساسية من السيرفر
        if (data.base_reward) {
          window.serverBaseReward = parseFloat(data.base_reward);
          console.log(`🔄 HALVING: Base reward updated from server: ${window.serverBaseReward}`);
          updateRewardText();
        }
        
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

  // 🔄 HALVING SYSTEM: المكافأة الأساسية من السيرفر (تتغير حسب العرض المتداول)
  // القيمة الافتراضية 0.25 — يتم تحديثها تلقائياً من استجابة السيرفر
  window.serverBaseReward = 0.25;
  
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

      // 🔄 HALVING: تحديث المكافأة الأساسية من السيرفر
      if (statusData && statusData.base_reward) {
        window.serverBaseReward = parseFloat(statusData.base_reward);
        console.log(`🔄 HALVING: Base reward updated from server: ${window.serverBaseReward}`);
        updateRewardText();
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
              body: JSON.stringify({ userId: currentUser.id, sessionToken: currentUser.sessionToken || currentUser.session_token || '' })
            });
            const data = await resp.json();
            
            // 🔒 SECURITY: Handle 401 - session mismatch (ذكي - يعيد المحاولة بدون توكن)
            if (resp.status === 401 && data.requireRelogin) {
              console.log('🔒 Session mismatch detected - retrying without token');
              try {
                const retryResp = await fetch('/api/processing/countdown/start', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId: currentUser.id })
                });
                const retryData = await retryResp.json();
                if (retryResp.ok && retryData.success) {
                  showNotification(translator.translate('Point processing started successfully!'), 'success');
                  currentUser.processing_active = 1;
                  currentUser.processing_end_time = Date.now() + (retryData.remaining_seconds * 1000);
                  currentUser.processing_start_time_seconds = Math.floor(Date.now() / 1000);
                  currentUser.processing_accumulated = 0;
                  currentUser.accumulatedReward = 0;
                  if (retryData.base_reward) { window.serverBaseReward = parseFloat(retryData.base_reward); updateRewardText(); }
                  saveUserSession(currentUser);
                  startCountdown(retryData.remaining_seconds * 1000);
                  startGradualAccumulation();
                  const transferredReward = retryData.reward_transferred || retryData.previous_reward_transferred || 0;
                  if (transferredReward > 0.0001) {
                    setTimeout(() => {
                      showNotification(translator.translate('Previous processing reward of') + ' ' + formatNumberSmart(transferredReward) + ' ' + translator.translate('Points has been added to your balance!'), 'success');
                    }, 1500);
                    if (retryData.new_balance !== undefined) {
                      currentUser.coins = retryData.new_balance;
                      saveUserSession(currentUser);
                    }
                  }
                }
              } catch(retryErr) { console.log('Retry failed:', retryErr); }
              btn.classList.remove('disabled');
              btn.disabled = false;
              return;
            }

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
              console.log('ℹ️ Session already active - resuming silently');
              if (data.remaining_seconds > 0) startCountdown(data.remaining_seconds * 1000);
            } else {
              showNotification(translator.translate(data.error || 'Error'), 'error');
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
      body: JSON.stringify({ userId: currentUser.id, sessionToken: currentUser.sessionToken || currentUser.session_token || '' })
    }, 10000); // timeout آمن 10 ثواني

    console.log(`[SCRIPT] Processing start response status: ${response.status}`);

    // 🔒 SECURITY: Handle 401 - session mismatch (ذكي - يعيد المحاولة بدون توكن)
    if (response.status === 401) {
      try {
        const authData = await response.json();
        console.log('🔒 Session mismatch detected - retrying without token');
        const retryResp = await fetch('/api/processing/countdown/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUser.id })
        });
        const retryData = await retryResp.json();
        if (retryResp.ok && retryData.success) {
          showNotification(translator.translate('Point processing started successfully!'), 'success');
          currentUser.processing_active = 1;
          currentUser.processing_end_time = Date.now() + (retryData.remaining_seconds * 1000);
          currentUser.processing_start_time_seconds = Math.floor(Date.now() / 1000);
          currentUser.processing_accumulated = 0;
          currentUser.accumulatedReward = 0;
          if (retryData.base_reward) { window.serverBaseReward = parseFloat(retryData.base_reward); updateRewardText(); }
          saveUserSession(currentUser);
          processingAnimation.style.display = 'block';
          startCountdown(retryData.remaining_seconds * 1000, currentUser.processing_start_time, currentUser.processing_end_time);
          startGradualAccumulation();
          const transferredReward = retryData.reward_transferred || retryData.previous_reward_transferred || 0;
          if (transferredReward > 0.0001) {
            setTimeout(() => {
              showNotification(translator.translate('Previous processing reward of') + ' ' + formatNumberSmart(transferredReward) + ' ' + translator.translate('Points has been added to your balance!'), 'success');
            }, 1500);
            if (retryData.new_balance !== undefined) {
              currentUser.coins = retryData.new_balance;
              saveUserSession(currentUser);
            }
          }
          processingButton.classList.add('disabled');
          processingButton.disabled = true;
          return;
        }
      } catch(e) { console.log('Retry failed:', e); }
      processingButton.classList.add('disabled');
      processingButton.disabled = true;
      return;
    }

    // 🔒 SECURITY: Handle 409 Conflict - session already active
    if (response.status === 409) {
      const conflictData = await response.json();
      console.log(`ℹ️ Session already active - resuming countdown (${conflictData.remaining_seconds}s remaining)`);
      // ✅ لا نعرض رسالة - نستأنف العد التنازلي بصمت
      
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
          
          const walletBalance = document.getElementById('network-coins');
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
      showNotification(translator.translate(data.error || 'Failed to start processing'), 'error');
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
    // ✅ حساب المدة الفعلية من end_time - start_time (يدعم جلسات الاختبار القصيرة)
    var processingDuration = 24 * 60 * 60; // 86400 ثانية افتراضي
    if (currentUser && currentUser.processing_end_time && currentUser.processing_start_time) {
      var actualDuration = Math.floor((parseInt(currentUser.processing_end_time) - parseInt(currentUser.processing_start_time)) / 1000);
      if (actualDuration > 0 && actualDuration <= 86400) {
        processingDuration = actualDuration;
      }
    }
    const elapsedSec = nowSec - localBoostData.startTimeSec;
    
    if (elapsedSec <= 0) return;
    
    // 🔒 CRITICAL: منع التراجع في الوقت (حماية من تغيير ساعة الجهاز)
    const safeElapsedSec = Math.max(elapsedSec, lastElapsedSec);
    lastElapsedSec = safeElapsedSec;
    
    // حساب المكافأة الأساسية مع الـ boost — القيمة من السيرفر (نظام Halving)
    const baseReward = window.serverBaseReward || 0.25;
    const boostedReward = baseReward * localBoostData.multiplier;
    
    // ✅ حساب دقيق: المكافأة لكل ثانية
    // baseReward ACCESS ÷ 86400 ثانية
    // مع الـ boost: (baseReward × multiplier) ÷ 86400
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
      calculatedAccumulated = Math.round(calculatedAccumulated * 100000000000000) / 100000000000000;
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
      '#activity-page .balance-display', '#network-page #network-coins',
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
      { selector: '#network-page #network-coins', page: 'Network' },
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

  // ⚡ نظام تحديث الرصيد الذكي - يتحقق من السيرفر فقط عند الحاجة
  // WebSocket يعمل ~50% من الوقت بسبب PM2 cluster (2 workers)
  // الـ polling يضمن تحديث الرصيد حتى لو WebSocket لم يصل
  let _lastKnownBalance = null;
  let _balancePollingInterval = null;
  let _lastWsUpdate = 0; // آخر مرة حدّث WebSocket الرصيد
  
  // تُستدعى من WebSocket عند وصول تحديث
  window._markWsBalanceUpdate = function() {
    _lastWsUpdate = Date.now();
  };
  
  function startBalancePolling() {
    if (_balancePollingInterval) return;
    
    _balancePollingInterval = setInterval(async () => {
      if (!currentUser || !currentUser.email) return;
      
      // إذا WebSocket حدّث الرصيد خلال آخر 8 ثوانٍ، لا حاجة للـ polling
      if (Date.now() - _lastWsUpdate < 8000) return;
      
      try {
        const response = await fetch(`/api/user/${encodeURIComponent(currentUser.email)}`);
        if (!response.ok) return;
        const userData = await response.json();
        if (!userData.user || userData.user.coins === undefined) return;
        
        const serverBalance = parseFloat(userData.user.coins);
        const localBalance = parseFloat(currentUser.coins || 0);
        
        if (Math.abs(serverBalance - localBalance) > 0.000001) {
          console.log(`⚡ Polling: balance changed ${localBalance} → ${serverBalance}`);
          currentUser.coins = serverBalance;
          if (currentUser.wallet) currentUser.wallet.balance = serverBalance;
          saveUserSession(currentUser);
          updateUserCoins(serverBalance);
          syncBalanceAcrossPages(serverBalance);
          
          // إشعار المستخدم
          if (serverBalance > localBalance) {
            const diff = serverBalance - localBalance;
            if (typeof showNotification === 'function' && diff > 0.000001) {
              showNotification(`${translator.translate('Received')} ${formatNumberSmart(diff)} Points`, 'success');
            }
          }
        }
        
        _lastKnownBalance = serverBalance;
      } catch (e) {
        // Silent
      }
    }, 8000); // كل 8 ثوانٍ
  }
  
  // بدء عند تسجيل الدخول
  document.addEventListener('userLoggedIn', () => startBalancePolling());
  setTimeout(() => {
    if (currentUser && currentUser.email) startBalancePolling();
  }, 5000);
  // Helper function to refresh user data
  async function refreshUserData() {
    try {
      const userData = await checkIfUserExists(currentUser.email);
      if (userData && userData.coins !== undefined) {
        updateUserCoins(userData.coins);
        currentUser.coins = userData.coins;
        // ✅ FIX: Sync session token if server returned a new one
        if (userData.session_token) {
          currentUser.sessionToken = userData.session_token;
          currentUser.session_token = userData.session_token;
        }
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
              completedReward: finalReward,
              sessionToken: currentUser.sessionToken || currentUser.session_token || ''
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

          // ✅ CRITICAL: حساب القيمة النهائية الكاملة — القيمة من السيرفر (نظام Halving)
          const baseReward = window.serverBaseReward || 0.25;
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
                    completedReward: finalReward,
                    sessionToken: currentUser.sessionToken || currentUser.session_token || ''
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
            amountDiv.textContent = '+' + (function(n){ n=parseFloat(n); let s=n.toFixed(8).replace(/\.?0+$/, ''); if(!s.includes('.')) s+='.00'; else { let d=s.split('.')[1].length; if(d<2) s+='0'; } return s; })(entry.amount) + ' acs';
            
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
      const totalReward = window.serverBaseReward || 0.25; // 🔄 HALVING: القيمة من السيرفر

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
  const networkPage = document.getElementById('network-page');
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
        if (document.getElementById('network-page') && 
            document.getElementById('network-page').style.display !== 'none') {
          
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
      const networkPage = document.getElementById('network-page');
      if (networkPage && window.getComputedStyle(networkPage).display !== 'none') {
        // Apply translations with multiple passes when returning to the page
        // Network page translation handled automatically
        
        // Recreate network observer to ensure it's using the current language
        setTimeout(createBlockchainObserver, 200);
      }
    }
  });
  
  // Check if network page is already visible on load and apply translations
  if (document.getElementById('network-page') && 
      window.getComputedStyle(document.getElementById('network-page')).display !== 'none') {
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
                if (window._markWsBalanceUpdate) window._markWsBalanceUpdate();
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
              if (document.getElementById('network-page') && 
                  window.getComputedStyle(document.getElementById('network-page')).display !== 'none') {
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
        token: user.token,
        sessionToken: user.session_token || user.sessionToken || ''
        // Don't store name or avatar in localStorage to ensure fresh data on login
      };
      localStorage.setItem('accessoireUser', JSON.stringify(minimalUserData));
      console.log('Saved minimal user session for:', minimalUserData.email);
      
      // ✅ Dispatch custom event for notification system (same-tab)
      // This allows notification-system.js to save pending subscriptions
      try {
        window.dispatchEvent(new CustomEvent('userLoggedIn', { 
          detail: { userId: user.id, email: user.email }
        }));
        console.log('🔔 Dispatched userLoggedIn event for notification system');
      } catch (e) {
        console.error('Error dispatching userLoggedIn event:', e);
      }
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

    // No default avatar SVG - use empty string so Google picture or server avatar is used
    const defaultAvatarSvg = '';

    if (profileAvatar) {
      // Use real avatar or default SVG
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
      // Use real avatar or default SVG
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
      // Use real avatar or default SVG
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
          // ✅ FIX: Sync session_token field name (server uses snake_case, client uses camelCase)
          if (userData.session_token) {
            currentUser.sessionToken = userData.session_token;
          }
          delete currentUser._forceUpdate;
          delete currentUser._requiresRefresh;

          // ✅ FIX: Persist updated user data to localStorage
          saveUserSession(currentUser);
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
      // Decode the JWT token with proper UTF-8 support
      const credential = response.credential;
      const base64Url = credential.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      const payload = JSON.parse(jsonPayload);
      
      // Extract user information - use Google picture directly (no SVG fallback)
      const avatarUrl = payload.picture || '';
      
      currentUser = {
        email: payload.email,
        name: payload.name,
        avatar: avatarUrl,
        token: credential
      };

      console.log('Google Sign-in successful:', currentUser.email);
      console.log('📷 Avatar URL:', avatarUrl ? avatarUrl.substring(0, 60) + '...' : 'NONE');

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
    const walletBalance = document.getElementById('network-coins');

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

    // Ensure QR code container exists and is properly styled
    const qrContainer = document.querySelector('.qrcode-container');
    if (qrContainer) {
      // Apply consistent styling upfront
      qrContainer.style.backgroundColor = 'white';
      qrContainer.style.padding = '10px';
      qrContainer.style.borderRadius = '8px';
      qrContainer.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
      qrContainer.style.minHeight = '150px'; // Prevent layout shift
      qrContainer.style.minWidth = '150px';  // Prevent layout shift

      // Check if we already have QR code in the user object - immediately display it
      if (currentUser.qrcode_data && currentUser.wallet_address) {
        console.log('Using QR code from user object for immediate display');
        // QR code data is generated server-side and contains only safe SVG/Canvas elements
        qrContainer.innerHTML = currentUser.qrcode_data;
      } else {
        // Check session storage as fallback
        try {
          const cachedQRCode = sessionStorage.getItem(`qrcode_${currentUser.id}`);
          if (cachedQRCode) {
            console.log('Using QR code from session storage for immediate display');
            // Cached QR code is safe as it was generated by our own code
            qrContainer.innerHTML = cachedQRCode;
          } else {
            // Show loading state - safe static HTML
            qrContainer.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:150px;"><i class="fas fa-spinner fa-spin"></i> Loading QR code...</div>';
          }
        } catch (err) {
          console.warn('Session storage access error:', err);
          // Show loading state - safe static HTML
          qrContainer.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:150px;"><i class="fas fa-spinner fa-spin"></i> Loading QR code...</div>';
        }
      }
    }

    try {
      // Always get wallet data from the server - the single source of truth
      console.log("Fetching wallet data from server for user:", currentUser.id);
      let serverWalletData = null;

      try {
        const response = await fetch(`${window.location.origin}/api/user/wallet-key/${currentUser.id}`);
        if (response.ok) {
          serverWalletData = await response.json();
          console.log("Retrieved wallet key from server");
        } else {
          console.log("No wallet key found on server, will create new one");
        }
      } catch (err) {
        console.error("Error fetching wallet key from server:", err);
      }

      // If we found wallet data on the server, use that as the source of truth
      if (serverWalletData && serverWalletData.success) {
        console.log("Using wallet from server:", serverWalletData.walletAddress);

        // Create wallet object with server data and user's actual coins balance
        const wallet = {
          publicAddress: serverWalletData.walletAddress,
          privateKey: serverWalletData.privateKey,
          balance: currentUser.coins || 0, // Always use actual coins from user profile
          transactions: [],
          serverSynced: true,
          lastSyncTime: Date.now()
        };

        // For transactions only, check local storage to merge with server data
        const savedWallet = localStorage.getItem(`wallet_${currentUser.id}`);
        if (savedWallet) {
          try {
            const localWallet = JSON.parse(savedWallet);
            if (localWallet.publicAddress === wallet.publicAddress && localWallet.transactions) {
              // If addresses match, keep only the local transaction history
              wallet.transactions = localWallet.transactions || [];
            }
          } catch (e) {
            console.error("Error parsing local wallet:", e);
          }
        }

        // Save wallet with transactions to localStorage, but never save balance
        const walletToSave = {
          ...wallet,
          balance: currentUser.coins || 0 // Always use the balance from the user object
        };
        localStorage.setItem(`wallet_${currentUser.id}`, JSON.stringify(walletToSave));

        // Update UI - always using currentUser.coins for balance
        if (walletAddress) {
          walletAddress.textContent = wallet.publicAddress;
        }
        if (walletBalance) {
          walletBalance.textContent = formatNumberSmart(parseFloat(currentUser.coins));
        }

        // Store in current user object
        currentUser.wallet = wallet;

        return wallet;
      }

      // No wallet on server, check if we have a public address in localStorage just for the address
      const savedWallet = localStorage.getItem(`wallet_${currentUser.id}`);
      let walletPublicAddress = null;
      let walletPrivateKey = null;

      if (savedWallet) {
        try {
          const parsedWallet = JSON.parse(savedWallet);
          walletPublicAddress = parsedWallet.publicAddress;
          walletPrivateKey = parsedWallet.privateKey;
        } catch (e) {
          console.error("Error parsing saved wallet:", e);
        }
      }

      // Generate a new wallet if we don't have one
      if (!walletPublicAddress) {
        console.log("Generating new wallet for user:", currentUser.id);
        const newWallet = await generateWallet(currentUser.id, currentUser.email);
        walletPublicAddress = newWallet.publicAddress;
        walletPrivateKey = newWallet.privateKey;
      }

      // Create a wallet object with the server as the source of truth for balance
      const wallet = {
        publicAddress: walletPublicAddress,
        privateKey: walletPrivateKey,
        balance: currentUser.coins || 0, // Always use database balance
        transactions: [],
        serverSynced: false,
        lastSyncTime: Date.now()
      };

      // Save wallet to localStorage but never use localStorage for balance
      localStorage.setItem(`wallet_${currentUser.id}`, JSON.stringify(wallet));

      // Update UI with wallet details - always using current user database balance
      if (walletAddress) {
        walletAddress.textContent = wallet.publicAddress;

        // Sync with dashboard wallet display
        setTimeout(() => {
          loadDashboardWalletAddress();
        }, 100);

        // First attempt with immediate generation
        generateQRCode(wallet.publicAddress);
        console.log('Initializing QR code generation for address:', wallet.publicAddress);

        // Second attempt after short delay to ensure DOM is ready
        setTimeout(() => {
          const qrContainer = document.querySelector('.qrcode-container');
          const qrContent = qrContainer.querySelector('canvas, #qrcode-display, table');
          if (!qrContent || qrContent.offsetWidth < 10) {
            console.log('QR code not properly generated on first attempt, retrying...');
            generateQRCode(wallet.publicAddress);
          }
        }, 500);

        // Final attempt with longer delay as fallback
        setTimeout(() => {
          const qrContainer = document.querySelector('.qrcode-container');
          const qrContent = qrContainer.querySelector('canvas, #qrcode-display, table');
          if (!qrContent || qrContent.offsetWidth < 10) {
            console.log('QR code still not generated, final retry...');
            // Force more direct rendering approach
            qrContainer.innerHTML = '';
            qrContainer.style.backgroundColor = 'white';
            qrContainer.style.padding = '10px';

            // Create a visible text representation as final fallback
            const addressDisplay = document.createElement('div');
            addressDisplay.style.width = '130px';
            addressDisplay.style.padding = '10px';
            addressDisplay.style.margin = '0 auto';
            addressDisplay.style.wordBreak = 'break-all';
            addressDisplay.style.fontSize = '12px';
            addressDisplay.style.textAlign = 'center';
            addressDisplay.style.fontFamily = 'monospace';
            addressDisplay.style.backgroundColor = '#fff';
            addressDisplay.style.border = '1px solid #ddd';
            addressDisplay.style.borderRadius = '4px';
            addressDisplay.textContent = wallet.publicAddress;
            qrContainer.appendChild(addressDisplay);

            // Add wallet address label
            const label = document.createElement('div');
            label.className = 'qrcode-label';
            label.textContent = 'Your wallet address:';
            label.style.marginTop = '10px';
            label.style.textAlign = 'center';
            label.style.color = '#333';
            qrContainer.appendChild(label);
          }
        }, 2000);
      }
      if (walletBalance) {
        walletBalance.textContent = formatNumberSmart(parseFloat(currentUser.coins));
      }

      // Store in current user object
      currentUser.wallet = wallet;

      console.log("Using wallet address:", wallet.publicAddress);

      // Update user profile with wallet address AND private key on the server
      try {
        await updateUserWalletOnServer(currentUser.id, wallet.publicAddress, wallet.privateKey);
        wallet.serverSynced = true;
        wallet.lastSyncTime = Date.now();
        localStorage.setItem(`wallet_${currentUser.id}`, JSON.stringify(wallet));
        console.log("Wallet synchronized with server");
      } catch (err) {
        console.error("Failed to sync wallet with server:", err);
      }

      return wallet;
    } catch (error) {
      console.error("Error initializing wallet:", error);
      
      // Try to generate a fallback wallet instead of showing error
      try {
        const fallbackWallet = await generateWallet(currentUser.id, currentUser.email);
        if (walletAddress && fallbackWallet && fallbackWallet.publicAddress) {
          walletAddress.textContent = fallbackWallet.publicAddress;
          generateQRCode(fallbackWallet.publicAddress);
          
          // Store fallback wallet
          currentUser.wallet = {
            publicAddress: fallbackWallet.publicAddress,
            privateKey: fallbackWallet.privateKey,
            balance: currentUser.coins || 0,
            transactions: [],
            serverSynced: false,
            lastSyncTime: Date.now()
          };
          
          return currentUser.wallet;
        }
      } catch (fallbackError) {
        console.error("Fallback wallet generation failed:", fallbackError);
      }
      
      // Final fallback - show generating message instead of error
      if (walletAddress) {
        walletAddress.textContent = "Generating...";
      }
    }
  }

  // Helper function to generate deterministic private key
  function generateDeterministicPrivateKey(userId, email) {
    // Create a seed based on user ID and email
    const seed = `${userId}-${email}-${Date.now()}`;

    // Simple hash function for deterministic key
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    // Create a deterministic but unique private key (64 hex characters)
    return Math.abs(hash).toString(16).padStart(64, '0');
  }

  // Update user wallet address and private key on server
  async function updateUserWalletOnServer(userId, walletAddress, privateKey) {
    try {
      const response = await fetch('/api/user/update-wallet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: userId,
          walletAddress: walletAddress,
          privateKey: privateKey
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      console.log("Wallet data updated on server:", data);
      return data;
    } catch (error) {
      console.error("Error updating wallet on server:", error);
      throw error; // Propagate error to caller for proper handling
    }
  }

  // Generate QR Code for wallet address - client side only, no server persistence
  function generateQRCode(address) {
    if (!address) {
      console.log('Cannot generate QR code: No address provided');
      return;
    }

    const qrContainer = document.querySelector('.qrcode-container');
    if (!qrContainer) {
      console.log('Cannot generate QR code: Container not found');
      return;
    }

    // Apply the current language to QR code label
    const currentLang = localStorage.getItem('preferredLanguage') || 'en';
    document.documentElement.setAttribute('data-language', currentLang);

    // Ensure all network page texts are translated
    if (document.getElementById('network-page') && document.getElementById('network-page').style.display !== 'none') {

    }

    // Show loading state
    qrContainer.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Loading QR code...</div>';
    qrContainer.style.backgroundColor = 'white';
    qrContainer.style.padding = '10px';
    qrContainer.style.borderRadius = '8px';
    qrContainer.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';

    // Check session storage for immediate display during page load
    if (currentUser && currentUser.id) {
      try {
        const cachedQRCode = sessionStorage.getItem(`qrcode_${currentUser.id}`);
        const cachedAddress = sessionStorage.getItem(`qrcode_wallet_address_${currentUser.id}`);

        if (cachedQRCode && cachedAddress === address) {
          console.log('Using cached QR code from session storage');
          qrContainer.innerHTML = cachedQRCode;
          return;
        }
      } catch (err) {
        console.warn('Error accessing session storage:', err);
      }
    }

    // If QR code is not in session storage, generate a new one locally
    console.log('Generating new client-side QR code for address:', address);
    generateQRCodeLocally(address, qrContainer);
  }

  // Generate QR code locally without server persistence
  function generateQRCodeLocally(address, qrContainer) {
    try {
      if (!address || !qrContainer) {
        console.error('Missing required parameters for QR code generation');
        return false;
      }

      // Clear existing content and set consistent styling
      qrContainer.innerHTML = '';
      qrContainer.style.backgroundColor = 'white';
      qrContainer.style.padding = '10px';
      qrContainer.style.borderRadius = '8px';
      qrContainer.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';

      // Ensure address is valid and trimmed
      const cleanAddress = address.trim();
      console.log('Generating QR code for address:', cleanAddress);

      let qrGenerated = false;

      // Try multiple QR code generation methods in order of preference

      // Method 1: QRCode library constructor
      if (typeof QRCode === 'function' && !qrGenerated) {
        try {
          // Create a container with explicit title attribute for the wallet address
          const qrDiv = document.createElement('div');
          qrDiv.id = 'qrcode-display';
          qrDiv.title = cleanAddress; // Important for screen readers and accessibility
          qrDiv.style.width = '150px';
          qrDiv.style.height = '150px';
          qrDiv.style.margin = '0 auto';
          qrDiv.style.position = 'relative'; // Important for overlay positioning
          qrContainer.appendChild(qrDiv);

          // Create QR code with high error correction level
          new QRCode(qrDiv, {
            text: cleanAddress,
            width: 150,
            height: 150,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel ? QRCode.CorrectLevel.H : 'H'
          });

          // Add the logo overlay with "ACCESS" text
          setTimeout(() => {
            const logoOverlay = document.createElement('div');
            logoOverlay.className = 'logo-overlay';
            logoOverlay.textContent = 'Points';
            qrDiv.appendChild(logoOverlay);
          }, 100);

          qrGenerated = true;
          console.log('QR code generated successfully using QRCode library');
        } catch (qrError) {
          console.error('Error using QRCode library:', qrError);
        }
      }

      // Method 2: QRCode.toCanvas
      if (!qrGenerated && window.QRCode && typeof window.QRCode.toCanvas === 'function') {
        try {
          console.log('Trying QRCode.toCanvas method');
          const canvas = document.createElement('canvas');
          canvas.width = 150;
          canvas.height = 150;
          qrContainer.appendChild(canvas);

          QRCode.toCanvas(canvas, cleanAddress, {
            width: 150,
            margin: 1,
            color: {
              dark: '#000000',
              light: '#ffffff'
            }
          }, function(error) {
            if (error) throw error;
            console.log('QR code generated using QRCode.toCanvas');
          });

          qrGenerated = true;
        } catch (canvasError) {
          console.error('Error using QRCode.toCanvas:', canvasError);
          // Remove failed canvas
          if (qrContainer.lastChild) qrContainer.removeChild(qrContainer.lastChild);
        }
      }

      // Method 3: Fallback direct canvas drawing
      if (!qrGenerated) {
        console.log('Using fallback canvas drawing for QR code');
        try {
          const qrDiv = document.createElement('div');
          qrDiv.id = 'qrcode-display';
          qrDiv.title = cleanAddress;
          qrDiv.style.width = '150px';
          qrDiv.style.height = '150px';
          qrDiv.style.margin = '0 auto';
          qrDiv.style.backgroundColor = 'white';
          qrDiv.style.border = '1px solid #ddd';
          qrContainer.appendChild(qrDiv);

          const canvas = document.createElement('canvas');
          canvas.width = 150;
          canvas.height = 150;
          qrDiv.appendChild(canvas);

          // Draw a visible border and background
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, 150, 150);
          ctx.fillStyle = '#000000';

          // Draw QR code pattern (simplified, but recognizable)
          const hash = Array.from(cleanAddress).reduce((h, c) => 
            Math.imul(31, h) + c.charCodeAt(0) | 0, 0);

          // Draw a pattern that's unique to the address
          for (let i = 0; i < 10; i++) {
            for (let j = 0; j < 10; j++) {
              if (((i * 3 + j * 5) * hash) % 7 < 3) {
                ctx.fillRect(i * 15, j * 15, 15, 15);
              }
            }
          }

          // Draw the fixed position markers (corners)
          ctx.fillRect(0, 0, 45, 45);                    // Top left
          ctx.fillRect(105, 0, 45, 45);                  // Top right
          ctx.fillRect(0, 105, 45, 45);                  // Bottom left

          // Draw white squares inside the position markers
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(15, 15, 15, 15);                  // Top left inner
          ctx.fillRect(120, 15, 15, 15);                 // Top right inner
          ctx.fillRect(15, 120, 15, 15);                 // Bottom left inner

          qrGenerated = true;
        } catch (canvasError) {
          console.error('Error with fallback canvas drawing:', canvasError);
        }
      }

      // Method 4: Last resort text display if all graphics methods fail
      if (!qrGenerated) {
        console.log('All QR code generation methods failed, using text display');
        const addressDisplay = document.createElement('div');
        addressDisplay.style.width = '150px';
        addressDisplay.style.padding = '15px 5px';
        addressDisplay.style.margin = '0 auto';
        addressDisplay.style.wordBreak = 'break-all';
        addressDisplay.style.fontSize = '12px';
        addressDisplay.style.textAlign = 'center';
        addressDisplay.style.fontFamily = 'monospace';
        addressDisplay.style.backgroundColor = '#fff';
        addressDisplay.style.border = '1px solid #ddd';
        addressDisplay.style.borderRadius = '4px';
        addressDisplay.style.color = '#333';
        addressDisplay.textContent = cleanAddress;
        qrContainer.appendChild(addressDisplay);
      }

      // Add label below QR code
      const label = document.createElement('div');
      label.className = 'qrcode-label';
      label.textContent = translator.translate('Scan to receive payment');
      label.style.marginTop = '10px';
      label.style.textAlign = 'center';
      label.style.color = '#333';
      label.style.fontWeight = '500';
      qrContainer.appendChild(label);

      // Display shortened address text
      const addressText = document.createElement('div');
      addressText.style.fontSize = '10px';
      addressText.style.marginTop = '5px';
      addressText.style.textAlign = 'center';
      addressText.style.color = '#555';
      addressText.style.wordBreak = 'break-all';
      addressText.textContent = cleanAddress.substring(0, 8) + '...' + cleanAddress.substring(cleanAddress.length - 6);
      qrContainer.appendChild(addressText);

      // Save to session storage only
      if (currentUser && currentUser.id) {
        try {
          sessionStorage.setItem(`qrcode_${currentUser.id}`, qrContainer.innerHTML);
          sessionStorage.setItem(`qrcode_wallet_address_${currentUser.id}`, cleanAddress);
          console.log('QR code saved to session storage');
        } catch (storageErr) {
          console.warn('Unable to store QR code in session storage:', storageErr);
        }
      }

      return true;
    } catch (error) {
      console.error('Error in QR code generation:', error);

      // Final fallback with plain text display
      qrContainer.innerHTML = `
        <div style="width:150px;height:150px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:14px;color:#333;background:#fff;border:1px solid #ccc;">
          <div>
            <div style="font-weight:bold;margin-bottom:10px;">Your Wallet</div>
            <div style="word-break:break-all;font-size:11px;max-width:130px;margin:0 auto;">${address}</div>
          </div>
        </div>
        <div class="qrcode-label" style="margin-top:10px;text-align:center;color:#333;">Address: ${address ? address.substring(0, 10) + '...' : 'Not available'}</div>
      `;

      return false;
    }
  }

  // Helper function to save QR code data to server with robust retry mechanism
  function saveQRCodeToServer(userId, qrCodeData, walletAddress) {
    if (!userId || !qrCodeData || !walletAddress) {
      console.error('Missing data for saving QR code to server');
      return Promise.reject(new Error('Missing required data'));
    }

    // Normalized wallet address
    const cleanAddress = walletAddress.trim();

    // Enhanced save function with multiple retries
    const attemptSave = async (retries = 3, delay = 1000) => {
      try {
        console.log(`Saving QR code to server, attempt ${4-retries}/3`);

        const response = await fetch(`${window.location.origin}/api/user/qrcode/save`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            userId: userId,
            qrCodeData: qrCodeData,
            walletAddress: cleanAddress
          })
        });

        if (!response.ok) {
          throw new Error(`Server responded with status: ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
          console.log('QR code saved successfully to server');

          // Also update session storage with the saved data
          try {
            sessionStorage.setItem(`qrcode_${userId}`, qrCodeData);
            sessionStorage.setItem(`qrcode_timestamp_${userId}`, Date.now().toString());
            sessionStorage.setItem(`qrcode_wallet_address_${userId}`, cleanAddress);
          } catch (storageErr) {
            console.warn('Failed to update QR code in session storage:', storageErr);
          }

          // Update current user object to keep everything in sync
          if (currentUser && currentUser.id === userId) {
            currentUser.qrcode_data = qrCodeData;
            currentUser.qrcode_timestamp = Date.now();
            currentUser.qrcode_wallet_address = cleanAddress;
          }

          return true;
        } else {
          throw new Error(data.error || 'Unknown server error');
        }
      } catch (error) {
        console.error(`QR code save attempt ${4-retries}/3 failed:`, error.message);

        if (retries > 1) {
          console.log(`Retrying QR code save in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return attemptSave(retries - 1, delay * 1.5);
        } else {
          console.warn('All QR code save attempts failed, using local storage only');

          // Even though server save failed, we still want to keep local storage updated
          try {
            sessionStorage.setItem(`qrcode_${userId}`, qrCodeData);
            sessionStorage.setItem(`qrcode_timestamp_${userId}`, Date.now().toString());
            sessionStorage.setItem(`qrcode_wallet_address_${userId}`, cleanAddress);

            // Also update current user object as fallback
            if (currentUser && currentUser.id === userId) {
              currentUser.qrcode_data = qrCodeData;
              currentUser.qrcode_timestamp = Date.now();
              currentUser.qrcode_wallet_address = cleanAddress;
            }
          } catch (storageErr) {
            console.warn('Failed to store QR code in session storage:', storageErr);
          }

          return false;
        }
      }
    };

    // Start the save process and return the promise
    return attemptSave();
  }

  // Helper function to generate QR code and save it to the database
 function generateAndSaveQRCode(address, qrContainer) {
    try {
      if (!address || !qrContainer) {
        console.error('Missing required parameters for QR code generation');
        return false;
      }

      // Clear existing content and set consistent styling
      qrContainer.innerHTML = '';
      qrContainer.style.backgroundColor = 'white';
      qrContainer.style.padding = '10px';
      qrContainer.style.borderRadius = '8px';

      // Add label ABOVE QR code
      const label = document.createElement('div');
      label.textContent = translator.translate('Scan to receive payment');
      label.className = 'qrcode-label';
      label.style.marginBottom = '5px';  // Changed to marginBottom
      label.style.textAlign = 'center';
      label.style.color = 'green';
      label.style.fontWeight = '500';
      qrContainer.appendChild(label);  // Added FIRST

      // Ensure address is valid and trimmed
      const cleanAddress = address.trim();
      console.log('Generating QR code for address:', cleanAddress);

      let qrGenerated = false;

      // Try multiple QR code generation methods in order of preference

      // Method 1: QRCode library constructor
      if (typeof QRCode === 'function' && !qrGenerated) {
        try {
          // Create a container with explicit title attribute for the wallet address
          const qrDiv = document.createElement('div');
          qrDiv.id = 'qrcode-display';
          qrDiv.title = cleanAddress; // Important for screen readers and accessibility
          qrDiv.style.width = '150px';
          qrDiv.style.height = '150px';
          qrDiv.style.margin = '0 auto';
          qrContainer.appendChild(qrDiv);

          // Create QR code with high error correction level
          new QRCode(qrDiv, {
            text: cleanAddress,
            width: 150,
            height: 150,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel ? QRCode.CorrectLevel.H : 'H'
          });

          // Add the logo overlay with "ACCESS" text
          setTimeout(() => {
            const logoOverlay = document.createElement('div');
            logoOverlay.className = 'logo-overlay';
            logoOverlay.textContent = 'ACCES';
            qrDiv.appendChild(logoOverlay);
          }, 100);

          qrGenerated = true;
          console.log('QR code generated successfully using QRCode library');
        } catch (qrError) {
          console.error('Error using QRCode library:', qrError);
        }
      }

      // Method 2: QRCode.toCanvas
      if (!qrGenerated && window.QRCode && typeof window.QRCode.toCanvas === 'function') {
        try {
          console.log('Trying QRCode.toCanvas method');
          const canvas = document.createElement('canvas');
          canvas.width = 150;
          canvas.height = 150;
          qrContainer.appendChild(canvas);

          QRCode.toCanvas(canvas, cleanAddress, {
            width: 150,
            margin: 1,
            color: {
              dark: '#000000',
              light: '#ffffff'
            }
          }, function(error) {
            if (error) throw error;
            console.log('QR code generated using QRCode.toCanvas');
          });

          qrGenerated = true;
        } catch (canvasError) {
          console.error('Error using QRCode.toCanvas:', canvasError);
          // Remove failed canvas
          if (qrContainer.lastChild) qrContainer.removeChild(qrContainer.lastChild);
        }
      }

      // Method 3: Fallback direct canvas drawing
      if (!qrGenerated) {
        console.log('Using fallback canvas drawing for QR code');
        try {
          const qrDiv = document.createElement('div');
          qrDiv.id = 'qrcode-display';
          qrDiv.title = cleanAddress;
          qrDiv.style.width = '150px';
          qrDiv.style.height = '150px';
          qrDiv.style.margin = '0 auto';
          qrDiv.style.backgroundColor = 'white';
          qrDiv.style.border = '1px solid #ddd';
          qrContainer.appendChild(qrDiv);

          const canvas = document.createElement('canvas');
          canvas.width = 150;
          canvas.height = 150;
          qrDiv.appendChild(canvas);

          // Draw a visible border and background
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, 150, 150);
          ctx.fillStyle = '#000000';

          // Draw QR code pattern (simplified, but recognizable)
          const hash = Array.from(cleanAddress).reduce((h, c) => 
            Math.imul(31, h) + c.charCodeAt(0) | 0, 0);

          // Draw a pattern that's unique to the address
          for (let i = 0; i < 10; i++) {
            for (let j = 0; j < 10; j++) {
              if (((i * 3 + j * 5) * hash) % 7 < 3) {
                ctx.fillRect(i * 15, j * 15, 15, 15);
              }
            }
          }

          // Draw the fixed position markers (corners)
          ctx.fillRect(0, 0, 45, 45);                    // Top left
          ctx.fillRect(105, 0, 45, 45);                  // Top right
          ctx.fillRect(0, 105, 45, 45);                  // Bottom left

          // Draw white squares inside the position markers
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(15, 15, 15, 15);                  // Top left inner
          ctx.fillRect(120, 15, 15, 15);                 // Top right inner
          ctx.fillRect(15, 120, 15, 15);                 // Bottom left inner

          qrGenerated = true;
        } catch (canvasError) {
          console.error('Error with fallback canvas drawing:', canvasError);
        }
      }

      // Method 4: Last resort text display if all graphics methods fail
      if (!qrGenerated) {
        console.log('All QR code generation methods failed, using text display');
        const addressDisplay = document.createElement('div');
        addressDisplay.style.width = '150px';
        addressDisplay.style.padding = '15px 5px';
        addressDisplay.style.margin = '0 auto';
        addressDisplay.style.wordBreak = 'break-all';
        addressDisplay.style.fontSize = '12px';
        addressDisplay.style.textAlign = 'center';
        addressDisplay.style.fontFamily = 'monospace';
        addressDisplay.style.backgroundColor = '#fff';
        addressDisplay.style.border = '1px solid #ddd';
        addressDisplay.style.borderRadius = '4px';
        addressDisplay.style.color = '#333';
        addressDisplay.textContent = cleanAddress;
        qrContainer.appendChild(addressDisplay);
      }

      // Display shortened address text
      const addressText = document.createElement('div');
      addressText.style.fontSize = '9px';
      addressText.style.marginTop = '5px';
      addressText.style.textAlign = 'center';
      addressText.style.color = '#555';
      addressText.style.wordBreak = 'break-all';
      addressText.textContent = cleanAddress.substring(0, 8) + '....' + cleanAddress.substring(cleanAddress.length - 6);
      qrContainer.appendChild(addressText);

      // Capture the generated HTML for saving
      const qrCodeData = qrContainer.innerHTML;

      // Save to current user object for immediate future use
      if (currentUser) {
        currentUser.qrcode_data = qrCodeData;
        currentUser.qrcode_timestamp = Date.now();
        currentUser.qrcode_wallet_address = cleanAddress;
      }

      // Save the QR code to session storage
      try {
        sessionStorage.setItem(`qrcode_${currentUser.id}`, qrCodeData);
        sessionStorage.setItem(`qrcode_timestamp_${currentUser.id}`, Date.now().toString());
        sessionStorage.setItem(`qrcode_wallet_address_${currentUser.id}`, cleanAddress);
      } catch (storageErr) {
        console.warn('Unable to store QR code in session storage:', storageErr);
      }

      // Save to server if user is logged in
      if (currentUser && currentUser.id) {
        console.log('Saving QR code data to server for user ID:', currentUser.id);

        // Persistent saving with multiple retries
        saveQRCodeToServer(currentUser.id, qrCodeData, cleanAddress);
      }

      return true;
    } catch (error) {
      console.error('Error in QR code generation:', error);

      // Final fallback with plain text display - Secure DOM creation
      qrContainer.textContent = '';
      
      const labelDiv = document.createElement('div');
      labelDiv.className = 'qrcode-label';
      labelDiv.style.cssText = 'margin-bottom:10px;text-align:center;color:#333;';
      labelDiv.textContent = 'Scan to receive payment';
      
      const walletBox = document.createElement('div');
      walletBox.style.cssText = 'width:150px;height:150px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:14px;color:#333;background:#fff;border:1px solid #ccc;';
      
      const innerDiv = document.createElement('div');
      const titleDiv = document.createElement('div');
      titleDiv.style.cssText = 'font-weight:bold;margin-bottom:10px;';
      titleDiv.textContent = 'Your Wallet';
      
      const addressDiv = document.createElement('div');
      addressDiv.style.cssText = 'word-break:break-all;font-size:11px;max-width:130px;margin:0 auto;';
      addressDiv.textContent = address;
      
      innerDiv.appendChild(titleDiv);
      innerDiv.appendChild(addressDiv);
      walletBox.appendChild(innerDiv);
      
      const addressLabel = document.createElement('div');
      addressLabel.className = 'qrcode-label';
      addressLabel.style.cssText = 'margin-top:5px;text-align:center;color:#555;font-size:10px;';
      addressLabel.textContent = 'Address: ' + (address ? address.substring(0, 10) + '...' : 'Not available');
      
      qrContainer.appendChild(labelDiv);
      qrContainer.appendChild(walletBox);
      qrContainer.appendChild(addressLabel);

      // Try to save even the fallback
      if (currentUser && currentUser.id) {
        saveQRCodeToServer(currentUser.id, qrContainer.innerHTML, address.trim());
      }

      return false;
    }
  }
  // QR Code Scanner functionality
  let qrScanner = null;

  // Initialize QR scanner when needed
function initQRScanner() {
  if (!window.QrScanner) {
    console.error('QR Scanner library not loaded');
    showNotification(translator.translate('QR Scanner library not loaded'), 'error');
    return false;
  }

  const videoElement = document.getElementById('qr-video');
  if (!videoElement) {
    console.error('Video element not found');
    return false;
  }

  // Create scanner instance
  try {
    qrScanner = new QrScanner(
      videoElement,
      result => {
        // Handle successful scan
        const scannedAddress = result.data;
        console.log('QR scanned:', scannedAddress);

        // Validate the scanned data is a valid wallet address
        if (isValidWalletAddress(scannedAddress)) {
          // Set the address in the input field
          const addressInput = document.getElementById('recipient-address');
          if (addressInput) {
            addressInput.value = scannedAddress;
          }

          // Close scanner
          closeQRScanner();

          // Notify user
          showNotification(translator.translate('Address successfully scanned'), 'success');
        } else {
          showNotification(translator.translate('Invalid wallet address format in QR code'), 'error');
        }
      },
      {
        highlightScanRegion: false,
        highlightCodeOutline: false
      }
    );

    return true;
  } catch (error) {
    console.error('Error initializing QR scanner:', error);
    showNotification(translator.translate('Could not access camera'), 'error');
    return false;
  }
}

// Open QR scanner
window.openQRScanner = function() {
  const scannerModal = document.getElementById('qr-scanner-modal');
  if (!scannerModal) return;

  // Show scanner modal
  scannerModal.style.display = 'flex';
  
  // Add click outside to close
  scannerModal.addEventListener('click', handleScannerOutsideClick);

  // Initialize scanner if needed
  if (!qrScanner) {
    if (!initQRScanner()) {
      closeQRScanner();
      return;
    }
  }

  // Start scanner
  qrScanner.start().catch(error => {
    console.error('Error starting QR scanner:', error);
    showNotification(translator.translate('Error accessing camera. Please check camera permissions.'), 'error');
    closeQRScanner();
  });
};

// Close QR scanner
window.closeQRScanner = function() {
  const scannerModal = document.getElementById('qr-scanner-modal');
  if (!scannerModal) return;

  // Hide scanner modal
  scannerModal.style.display = 'none';

  // Stop scanner if it's running
  if (qrScanner) {
    qrScanner.stop();
  }
  
  // Remove click outside listener
  scannerModal.removeEventListener('click', handleScannerOutsideClick);
};

// Handle click outside scanner content to close
function handleScannerOutsideClick(e) {
  // Only close if clicked on the background (modal itself), not the content
  if (e.target.id === 'qr-scanner-modal') {
    closeQRScanner();
  }
}


 // Paste clipboard content into recipient address field
window.pasteAddress = async function() {
  try {
    const text = await navigator.clipboard.readText();
    const addressInput = document.getElementById('recipient-address');
    if (addressInput) {
      addressInput.value = text;
      // Optional validation
      if (isValidWalletAddress(text)) {
        showNotification(translator.translate('Valid wallet address pasted'), 'success');
      }
    }
  } catch (error) {
    console.error('Error pasting from clipboard:', error);
    showNotification(translator.translate('Could not read from clipboard'), 'error');
  }
};


  // Copy wallet address to clipboard
window.copyAccountAddress = function() {
  const walletAddress = document.getElementById('user-account-address');
  const copyBtn = document.getElementById('copy-account-address');

  if (walletAddress && walletAddress.textContent !== translator.translate("")) {
    navigator.clipboard.writeText(walletAddress.textContent)
      .then(() => {
        // Remove focus from button to prevent blue background
        copyBtn.blur();
        
        // Get the icon element
        const icon = copyBtn.querySelector('i');
        if (icon) {
          // Show check icon
          icon.className = 'fas fa-check';
          copyBtn.classList.add('copied');

          // Clear any existing timeout
          if (copyBtn._resetTimeout) {
            clearTimeout(copyBtn._resetTimeout);
          }

          // Reset button after 2 seconds
          copyBtn._resetTimeout = setTimeout(() => {
            icon.className = 'fas fa-copy';
            copyBtn.classList.remove('copied');
            copyBtn._resetTimeout = null;
          }, 2000);
        }

        // Show notification
        showNotification(translator.translate('Wallet address copied to clipboard'), 'success');
      })
      .catch(err => {
        console.error('Failed to copy wallet address:', err);
        showNotification(translator.translate('Failed to copy wallet address'), 'error');
      });
  }
};


  // Toggle private key display
  window.togglePrivateKeyDisplay = function() {
    const privateKeyDisplay = document.getElementById('private-key-display');
    const toggleBtn = document.getElementById('toggle-private-key');

    if (!currentUser || !currentUser.wallet) {
      showNotification('Wallet not initialized', 'error');
      return;
    }

    if (privateKeyDisplay.type === 'password') {
      privateKeyDisplay.type = 'text';
      privateKeyDisplay.value = currentUser.wallet.privateKey;
      toggleBtn.innerHTML = '<i class="fas fa-eye-slash"></i>';
    } else {
      privateKeyDisplay.type = 'password';
      privateKeyDisplay.value = 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢';
      toggleBtn.innerHTML = '<i class="fas fa-eye"></i>';
    }
  };




  // Generate a simple hash for non-critical operations
  function generateSimpleHash(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return '0x' + Math.abs(hash).toString(16).padStart(64, '0');
  }

  // Enhanced wallet generation with better entropy
  async function generateEnhancedWallet(userId, email) {
    try {
      // Create multiple entropy sources
      const timestamp = Date.now().toString();
      const randomValues = new Uint8Array(32);

      // Use crypto.getRandomValues if available for true randomness
      if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(randomValues);
      }

      // Create a complex seed with multiple entropy sources
      const seed = `${userId}-${email}-${timestamp}-${Array.from(randomValues).join('')}-${Math.random().toString(36).substring(2)}`;

      // Use SubtleCrypto for secure key generation if available
      if (window.crypto && window.crypto.subtle) {
        // Generate private key with SHA-256
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
        const privateKeyArray = Array.from(new Uint8Array(hashBuffer));
        const privateKey = privateKeyArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // Generate public address with a different hash of the private key
        const publicBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(privateKey + seed));
        const publicArray = Array.from(new Uint8Array(publicBuffer));

        // Create a professional-looking Ethereum-style address (0x prefix + 40 hex chars)
        const publicAddress = '0x' + publicArray.slice(0, 20).map(b => 
          b.toString(16).padStart(2, '0')).join('');

        return {
          privateKey: privateKey,
          publicAddress: publicAddress
        };
      } else {
        // Advanced fallback for browsers without SubtleCrypto
        console.log("Using enhanced fallback wallet generation method");

        // Create a more complex hash algorithm
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
          const char = seed.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash;
        }

        // Add more entropy to the hash
        const enhancedSeed = seed + hash + navigator.userAgent + screen.width * screen.height;

        // Generate a proper-looking private key (64 hex characters)
        let privateKey = '';
        for (let i = 0; i < 64; i++) {
          // Use different parts of our entropy sources
          const charIndex = (hash + i + timestamp.charCodeAt(i % timestamp.length)) % 16;
          privateKey += '0123456789abcdef'[charIndex];
        }

        // Generate public address deterministically but with more variation
        let publicAddress = '0x';
        for (let i = 0; i < 40; i++) {
          // Use a different mixing algorithm for the public address
          const charIndex = (hash * (i+1) + seed.charCodeAt(i % seed.length) + i * 13) % 16;
          publicAddress += '0123456789abcdef'[charIndex];
        }

        return {
          privateKey: privateKey,
          publicAddress: publicAddress
        };
      }
    } catch (error) {
      console.error("Error in enhanced wallet generation:", error);
      throw error;
    }
  }

  // Export wallet details
  window.exportAccountDetails = function() {
    if (!currentUser || !currentUser.wallet) {
      showNotification('Wallet not initialized', 'error');
      return;
    }

    const wallet = currentUser.wallet;
    const walletData = {
      publicAddress: wallet.publicAddress,
      privateKey: wallet.privateKey,
      balance: wallet.balance,
      exportDate: new Date().toISOString(),
      userEmail: currentUser.email,
      network: "Accessoire Mainnet Chain"
    };

    // Create a blob with the wallet data
    const jsonData = JSON.stringify(walletData, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Create a link to download the file
    const a = document.createElement('a');
    a.href = url;
    a.download = `accessoire-wallet-${walletData.publicAddress.substring(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();

    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification(translator.translate('Wallet details exported. Keep this file secure!'), 'success');
  };

  // Import wallet details
  window.importAccountDetails = function() {
    if (!currentUser || !currentUser.id) {
      showNotification('You must be logged in to import a wallet', 'error');
      return;
    }

    // Get the existing modal from HTML
    const importModal = document.getElementById('import-account-modal');
    if (!importModal) {
      console.error('Import wallet modal not found in HTML');
      return;
    }

    // Apply theme-aware styles
    const isDarkMode = document.documentElement.classList.contains('dark-theme');
    const modalContent = importModal.querySelector('.modal-content');
    const importHelp = importModal.querySelector('.import-help');

    if (modalContent) {
      modalContent.style.backgroundColor = isDarkMode ? 'var(--card-background, #2a2a2a)' : 'white';
      modalContent.style.color = isDarkMode ? 'var(--text-color, #f5f5f5)' : '#333';
      modalContent.style.border = `1px solid ${isDarkMode ? 'var(--border-color, #3a3a3a)' : '#e1e4e8'}`;
    }

    if (importHelp) {
      importHelp.style.marginBottom = '15px';
      importHelp.style.padding = '10px';
      importHelp.style.backgroundColor = isDarkMode ? '#3a3a3a' : '#f5f5f5';
      importHelp.style.borderRadius = '5px';
      importHelp.style.color = '#FFC300';
      importHelp.style.fontSize = '12px';
    }

    // Set disabled styles
    const disabledButtons = importModal.querySelectorAll('button[disabled]');
    disabledButtons.forEach(btn => {
      btn.style.opacity = '0.6';
      btn.style.cursor = 'not-allowed';
    });

    // Show the modal
    importModal.style.display = 'block';

    // Setup event listeners
    setupImportModalEventListeners();
  };

  // Setup import modal event listeners
  function setupImportModalEventListeners() {
    // Add event listeners for import tabs
    const privatekeyTab = document.getElementById('privatekey-tab');
    const jsonTab = document.getElementById('json-tab');
    const addressTab = document.getElementById('address-tab');

    if (privatekeyTab) {
      privatekeyTab.addEventListener('click', function() {
        this.classList.add('active');
        document.getElementById('json-tab').classList.remove('active');
        document.getElementById('address-tab').classList.remove('active');
        document.getElementById('privatekey-import').style.display = 'block';
        document.getElementById('json-import').style.display = 'none';
        document.getElementById('address-import').style.display = 'none';
      });
    }

    if (jsonTab) {
      jsonTab.addEventListener('click', function() {
        this.classList.add('active');
        document.getElementById('privatekey-tab').classList.remove('active');
        document.getElementById('address-tab').classList.remove('active');
        document.getElementById('privatekey-import').style.display = 'none';
        document.getElementById('json-import').style.display = 'block';
        document.getElementById('address-import').style.display = 'none';
      });
    }

    if (addressTab) {
      addressTab.addEventListener('click', function() {
        this.classList.add('active');
        document.getElementById('privatekey-tab').classList.remove('active');
        document.getElementById('json-tab').classList.remove('active');
        document.getElementById('privatekey-import').style.display = 'none';
        document.getElementById('json-import').style.display = 'none';
        document.getElementById('address-import').style.display = 'block';
      });
    }

    // Handle file selection - currently disabled 
    const fileInput = document.getElementById('account-file-input');
    const dropArea = document.getElementById('drop-area');
    const importFileBtn = document.getElementById('import-file-btn');

    if (fileInput) {
      fileInput.addEventListener('change', function(e) {
        e.preventDefault();
        this.value = '';

        if (dropArea) {
         dropArea.innerHTML = `
  <i class="fas fa-lock"></i>
  <p data-translate="Import functionality is temporarily disabled">
    ${translator.translate("Import functionality is temporarily disabled")}
  </p>
`;
        }
        showNotification(translator.translate('Wallet import functionality is temporarily disabled'), 'info');
      });
    }

    if (dropArea) {
      // Handle drag and drop - currently disabled
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
      });

      function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
      }

      // Disable highlighting on drag
      ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, function(e) {
          e.preventDefault();
          e.stopPropagation();
          dropArea.innerHTML = `<i class="fas fa-lock"></i><p data-translate="Import functionality is temporarily disabled">Import functionality is temporarily disabled</p>`;
        }, false);
      });

      // Reset message on drag leave
      ['dragleave'].forEach(eventName => {
        dropArea.addEventListener(eventName, function(e) {
          e.preventDefault();
          e.stopPropagation();
          const resetHTML = `<i class="fas fa-file-upload"></i>
            <p data-translate="Drag and drop your wallet file or">Drag and drop your wallet file or</p>
            <label for="wallet-file-input" class="file-input-label" data-translate="Select File">Select File</label>
            <input type="file" id="account-file-input" accept="application/json" style="display: none;">`;
          dropArea.innerHTML = resetHTML;
        }, false);
      });

      // Prevent file dropping
      dropArea.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();

        dropArea.innerHTML = `<i class="fas fa-lock"></i><p>${translator.translate('Import functionality is temporarily disabled')}</p>`;
        showNotification(translator.translate('Wallet import functionality is temporarily disabled'), 'info');
      }, false);
    }

    // Handle JSON file import - currently disabled
    if (importFileBtn) {
      importFileBtn.addEventListener('click', function() {
        showNotification(translator.translate('Wallet import functionality is temporarily disabled'), 'info');

        setTimeout(() => {
          closeImportModal();
        }, 1500);
      });
    }
  }

  // Close import modal
  window.closeImportModal = function() {
    const modal = document.getElementById('import-account-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  };

  // ✅ إغلاق نافذة import عند الضغط خارجها
  window.addEventListener('click', function(event) {
    const importModal = document.getElementById('import-account-modal');
    if (event.target === importModal) {
      closeImportModal();
    }
  });

  // Toggle visibility of private key input
  window.toggleImportKeyVisibility = function() {
    const keyInput = document.getElementById('private-key-input');
    const toggleBtn = document.getElementById('toggle-input-visibility');

    if (keyInput.type === 'password') {
      keyInput.type = 'text';
      toggleBtn.innerHTML = '<i class="fas fa-eye-slash"></i>';
    } else {
      keyInput.type = 'password';
      toggleBtn.innerHTML = '<i class="fas fa-eye"></i>';
    }
  };
  // Validate and import private key - currently disabled
  window.validateAndImportKey = function() {
    // Show notification that functionality is disabled
    showNotification(translator.translate('Wallet import functionality is temporarily disabled'), 'info');


    // Close the modal after a short delay
    setTimeout(() => {
      closeImportModal();
    }, 1500);
  };


  // Generate wallet address from private key
  async function generateAddressFromPrivateKey(privateKey) {
    try {
      // Clean the private key and ensure it's in correct format
      if (!privateKey) return null;

      // Use crypto API to derive public address from private key
      // This is a simplified process - in a real app, use a proper crypto library
      const privateKeyBytes = new TextEncoder().encode(privateKey);
      const hashBuffer = await crypto.subtle.digest('SHA-256', privateKeyBytes);
      const hashArray = Array.from(new Uint8Array(hashBuffer));

      // Create a deterministic but unique address from the hash
      const publicAddress = '0x' + hashArray.slice(0, 20).map(b => 
        b.toString(16).padStart(2, '0')).join('');

      return publicAddress;
    } catch (error) {
      console.error('Error generating address from private key:', error);
      return null;
    }
  }

  // Import wallet from data object
  function importWalletFromData(walletData) {
    try {
      // Validate wallet data
      if (!walletData.publicAddress || !walletData.privateKey) {
        throw new Error('Invalid wallet data: Missing required fields');
      }

      // Ask for confirmation
      const confirmImport = confirm(
        `Are you sure you want to import this wallet?\n\nAddress: ${walletData.publicAddress}\n\nThis will replace your current wallet if you have one.`
      );

      if (confirmImport) {
        // Show loading indicator
        showNotification('Syncing wallet data with server...', 'info');

        // First check if this wallet address exists on the server
        fetchWalletInfoFromServer(walletData.publicAddress)
          .then(serverData => {
            // Create new wallet object with merged data
            const importedWallet = {
              publicAddress: walletData.publicAddress,
              privateKey: walletData.privateKey,
              balance: walletData.balance || 0,
              transactions: walletData.transactions || [],
              importDate: new Date().toISOString()
            };

            // If server has data for this wallet, use it to enhance our local data
            if (serverData && serverData.success && serverData.wallet_found) {
              console.log('Server found data for this wallet:', serverData);

              // Use server balance if available (more authoritative)
              if (serverData.user && typeof serverData.user.coins === 'number') {
                importedWallet.balance = serverData.user.coins;
                console.log(`Using server balance: ${importedWallet.balance}`);
              }

              // Get transaction history from server if available
              if (serverData.transactions && Array.isArray(serverData.transactions)) {
                // Merge transactions, preferring server data but keeping local data
                // that might not have synced yet
                const existingHashes = new Set(serverData.transactions.map(tx => tx.hash));
                const localTxs = importedWallet.transactions.filter(tx => !existingHashes.has(tx.hash));

                importedWallet.transactions = [
                  ...serverData.transactions,
                  ...localTxs
                ].sort((a, b) => b.timestamp - a.timestamp); // Sort by timestamp, newest first

                console.log(`Merged ${serverData.transactions.length} server transactions with ${localTxs.length} local transactions`);
              }

              // If server provides user info, store it
              if (serverData.user) {
                importedWallet.serverUserId = serverData.user.id;
                importedWallet.userEmail = serverData.user.email;
                importedWallet.userName = serverData.user.name;
              }
            } else {
              console.log('No server data found for this wallet, using imported data only');
            }

            // Save the imported wallet to localStorage
            localStorage.setItem(`wallet_${currentUser.id}`, JSON.stringify(importedWallet));

            // Update currentUser object
            currentUser.wallet = importedWallet;

            // Update UI
            const walletAddress = document.getElementById('user-account-address');
            const walletBalance = document.getElementById('network-coins');

            if (walletAddress) {
              walletAddress.textContent = importedWallet.publicAddress;
            }

            if (walletBalance) {
              walletBalance.textContent = formatNumberSmart(parseFloat(importedWallet.balance));
            }

            // Update main UI coins display if available
            if (typeof currentUser.coins === 'number') {
              updateUserCoins(importedWallet.balance);
            }

            // Update transaction list
            updateTransactionList();

            // Close the modal
            closeImportModal();

            // Show success notification
            showNotification('Wallet imported and synchronized successfully!', 'success');

            // Update user profile with wallet address on the server
            updateUserWalletOnServer(currentUser.id, importedWallet.publicAddress)
              .then(() => {
                console.log('Wallet address updated on server');

                // If the balance in the wallet differs from server, update server balance
                if (serverData && serverData.user && 
                    typeof serverData.user.coins === 'number' && 
                    serverData.user.coins !== importedWallet.balance) {
                  // If the server balance is different, update it
                  syncBalanceWithServer(currentUser.id, importedWallet.balance)
                    .then(() => console.log('Server balance synchronized'))
                    .catch(err => console.error('Error syncing balance with server:', err));
                }
              })
              .catch(err => console.error("Failed to update wallet on server:", err));
          })
          .catch(error => {
            console.error('Error fetching wallet info from server:', error);

            // Still proceed with import, but with local data only
            const importedWallet = {
              publicAddress: walletData.publicAddress,
              privateKey: walletData.privateKey,
              balance: walletData.balance || 0,
              transactions: walletData.transactions || [],
              importDate: new Date().toISOString()
            };

            // Save the imported wallet
            localStorage.setItem(`wallet_${currentUser.id}`, JSON.stringify(importedWallet));

            // Update currentUser object
            currentUser.wallet = importedWallet;

            // Update UI
            const walletAddress = document.getElementById('user-account-address');
            const walletBalance = document.getElementById('network-coins');

            if (walletAddress) {
              walletAddress.textContent = importedWallet.publicAddress;
            }

            if (walletBalance) {
              walletBalance.textContent = formatNumberSmart(parseFloat(importedWallet.balance));
            }

            // Update transaction list
            updateTransactionList();

            // Close the modal
            closeImportModal();

            // Show partial success notification
            showNotification('Wallet imported with local data only (server sync failed)', 'warning');

            // Still try to update the server
            updateUserWalletOnServer(currentUser.id, importedWallet.publicAddress)
              .catch(err => console.error("Failed to update wallet on server:", err));
          });
      }
    } catch (error) {
      console.error('Error importing wallet:', error);
      showNotification('Error importing wallet: ' + error.message, 'error');
    }
  }

  // Look up wallet by address - currently disabled
  window.lookupWalletByAddress = function() {
    // Show notification that functionality is disabled
    showNotification('Wallet import functionality is temporarily disabled', 'info');

    // Close the modal after a short delay
    setTimeout(() => {
      closeImportModal();
    }, 1500);
  };

  // Add event listeners for the new address tab and initialize wallet early
  document.addEventListener('DOMContentLoaded', function() {
    // This will be executed when the import modal is created
    document.body.addEventListener('click', function(e) {
      if (e.target && e.target.id === 'address-tab') {
        // Address tab clicked
        document.querySelectorAll('.import-tab').forEach(tab => tab.classList.remove('active'));
        e.target.classList.add('active');

        document.querySelectorAll('.import-content').forEach(content => content.style.display = 'none');
        document.getElementById('address-import').style.display = 'block';
      }
    });

    // Enhanced initialization when Blockchain page is shown
    document.querySelectorAll('.nav-link, .mobile-nav-item').forEach(link => {
      link.addEventListener('click', function() {
        const pageName = this.getAttribute('data-page');
        if (pageName === 'network') {
          // Clear any existing QR code first to prevent displaying old/stale data
          const qrContainer = document.querySelector('.qrcode-container');
          if (qrContainer) {
            qrContainer.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Loading QR code...</div>';
            qrContainer.style.backgroundColor = 'white';
            qrContainer.style.padding = '10px';
            qrContainer.style.borderRadius = '8px';
            qrContainer.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
          }

          // Short delay to ensure user data is loaded
          setTimeout(() => {
            if (currentUser && currentUser.id) {
              console.log('Initializing wallet and generating QR code for network page');
              initializeUserWallet().then(() => {
                // Always force regeneration of QR code
                const address = document.getElementById('user-account-address')?.textContent;
                if (address && address !== 'Generating...') {
                  // Force QR code generation every time network page is visited
                  console.log('Generating QR code for network page:', address);

                  // Use the more robust function that actually generates and persists the QR code
                  generateAndSaveQRCode(address, qrContainer);

                  // Add multiple attempts with increasing delays for better reliability
                  [500, 1500, 3000].forEach(delay => {
                    setTimeout(() => {
                      const currentAddress = document.getElementById('user-account-address')?.textContent;
                      const hasQRCode = qrContainer && (
                        qrContainer.querySelector('#qrcode-display') || 
                        qrContainer.querySelector('canvas') || 
                        qrContainer.querySelector('img')
                      );

                      if (currentAddress && currentAddress !== 'Generating...' && !hasQRCode) {
                        console.log(`Retry QR code generation after ${delay}ms`);
                        generateAndSaveQRCode(currentAddress, qrContainer);
                      }
                    }, delay);
                  });
                }
              });
            }
          }, 300);
        }
      });
    });

    // If network page is already visible on load, initialize wallet
    if (document.getElementById('network-page') && 
        document.getElementById('network-page').style.display !== 'none') {
      // Short delay to ensure user data is loaded
      setTimeout(() => {
        if (currentUser && currentUser.id) {
          console.log('Initializing wallet for already visible network page');

          // Clear any existing QR code and show loading state
          const qrContainer = document.querySelector('.qrcode-container');
          if (qrContainer) {
            qrContainer.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Loading QR code...</div>';
            qrContainer.style.backgroundColor = 'white';
            qrContainer.style.padding = '10px';
            qrContainer.style.borderRadius = '8px';
            qrContainer.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
          }

          initializeUserWallet().then(() => {
            // Force QR code generation when page loads with network visible
            const address = document.getElementById('user-account-address')?.textContent;
            if (address && address !== 'Generating...') {
              console.log('Generating QR code for initially visible network page');
              generateAndSaveQRCode(address, qrContainer);
            }
          });
        }
      }, 500);
    }

    // Handle page visibility changes to regenerate QR code when page becomes visible again
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') {
        // Check if network page is visible
        const networkPage = document.getElementById('network-page');
        if (networkPage && networkPage.style.display !== 'none' && currentUser && currentUser.id) {
          // Re-initialize wallet and regenerate QR code when returning to the page
          setTimeout(() => {
            console.log('Page became visible with network page open - refreshing QR code');
            const address = document.getElementById('user-account-address')?.textContent;
            if (address && address !== 'Generating...') {
              const qrContainer = document.querySelector('.qrcode-container');
              if (qrContainer) {
                generateAndSaveQRCode(address, qrContainer);
              }
            }
          }, 200);
        }
      }
    });
  });

  // Fetch wallet info from server
  async function fetchWalletInfoFromServer(walletAddress) {
    try {
      const response = await fetch(`${window.location.origin}/api/wallet/${walletAddress}`);

      if (!response.ok) {
        if (response.status === 404) {
          return { success: false, wallet_found: false };
        }
        throw new Error(`Server returned status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching wallet info from server:', error);
      throw error;
    }
  }

  // Sync wallet balance with server
  async function syncBalanceWithServer(userId, balance) {
    try {
      const response = await fetch(`${window.location.origin}/api/user/sync-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, balance })
      });

      if (!response.ok) {
        throw new Error(`Server returned status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error syncing balance with server:', error);
      throw error;
    }
  }


window.setMaxAmount = function() {
  if (!currentUser || !currentUser.coins) {
    showNotification(`${translator.translate('No available balance')}`, 'error');
    return;
  }

  const gasFee = 0.00002;
  const currentBalance = parseFloat(currentUser.coins || 0);

  // Calculate max sendable - exact amount minus gas fee only
  const maxSendable = parseFloat(Math.max(0, currentBalance - gasFee).toFixed(8));

  const amountInput = document.getElementById('transaction-amount');
  if (amountInput) {
    if (maxSendable <= 0) {
      showNotification(translator.translate('Insufficient balance to cover gas fees'), 'error');
      amountInput.value = '0';
    } else {
      // Set the value without toFixed to preserve the exact calculated amount
      amountInput.value = maxSendable.toString();
      showNotification(
        `${translator.translate('Max amount set')}: ${maxSendable} Points`,
        'success'
      );
    }
  }
};


  // Transaction modal functions - الدالة الفعلية لفتح النافذة
  function openTransactionModalDirectly() {
    const modal = document.getElementById('transaction-modal');
    if (modal) {
      modal.style.display = 'block';

      // Setup scan and paste buttons if not already done
      const scanBtn = document.getElementById('scan-qr-code');
      const pasteBtn = document.getElementById('paste-address');

      if (scanBtn && !scanBtn.hasListener) {
        scanBtn.addEventListener('click', openQRScanner);
        scanBtn.hasListener = true;
      }

      if (pasteBtn && !pasteBtn.hasListener) {
        pasteBtn.addEventListener('click', pasteAddress);
        pasteBtn.hasListener = true;
      }
    }
  }

  // الدالة الرئيسية - تعرض إعلان أولاً ثم تفتح النافذة
  window.showTransactionModal = function() {
    console.log('📺 محاولة عرض إعلان قبل فتح واجهة الإرسال...');
    
    // عرض الإعلان مع callback لفتح النافذة بعد إغلاقه
    if (window.showActivityAd) {
      window.showActivityAd(function() {
        console.log('✅ فتح واجهة الإرسال بعد الإعلان');
        openTransactionModalDirectly();
      });
    } else {
      // fallback إذا لم يكن نظام الإعلان متاح
      console.log('⚠️ نظام الإعلان غير متاح، فتح واجهة الإرسال مباشرة');
      openTransactionModalDirectly();
    }
  };

  window.closeTransactionModal = function() {
    const modal = document.getElementById('transaction-modal');
    if (modal) {
      modal.style.display = 'none';
    }

    // Also close scanner if open
    closeQRScanner();
  };

window.sendTransaction = function() {
  if (!currentUser || !currentUser.wallet) {
    showNotification(translator.translate('walletNotInitialized'), 'error');
    return;
  }

  const recipientAddress = document.getElementById('recipient-address').value.trim();
  const amount = parseFloat(document.getElementById('transaction-amount').value);
  const network = document.getElementById('transaction-network').value;

  if (!recipientAddress) {
    showNotification(translator.translate('enterRecipientAddress'), 'error');
    return;
  }

  if (!isValidWalletAddress(recipientAddress)) {
    showNotification(translator.translate('invalidWalletAddress'), 'error');
    return;
  }

  if (recipientAddress === currentUser.wallet.publicAddress) {
    showNotification(translator.translate('sendToSelfError'), 'error');
    return;
  }

  if (isNaN(amount) || amount <= 0) {
    showNotification(translator.translate('invalidAmount'), 'error');
    return;
  }

  if (network !== 'points') {
    showNotification(translator.translate('onlyAccesNetwork'), 'warning');
  }




 // Mandatory gas fee and new conditions
const gasFee = 0.00002;
const minimumAmount = 0.00001;
const currentBalance = parseFloat(currentUser.coins || 0);
  const totalCost = amount + gasFee;



// Check minimum amount to send
if (amount < minimumAmount) {
  showNotification(`${translator.translate('Minimum amount to send')}: ${formatNumberSmart(minimumAmount)} Access`, 'error');
  return;
}

// Check that the amount is greater than the gas fee
if (amount < gasFee) {
  showNotification(`${translator.translate('Cannot send an amount less than the gas fee')} (${formatNumberSmart(gasFee)} Access)`, 'error');
  return;
}

// Check if balance is sufficient to cover the gas fee
if (currentBalance < gasFee) {
  showNotification(`${translator.translate('Insufficient balance to cover the gas fee. Required')}: ${formatNumberSmart(gasFee)} Access`, 'error');
  return;
}

// ✅ FIX: إزالة الشرط الخاطئ الذي كان يمنع إرسال Max amount
// الآن يُسمح بإرسال أي مبلغ طالما المجموع (amount + gasFee) <= currentBalance

// Check if balance is sufficient for amount + gas fee (with minimal precision tolerance)
const precision = 0.000000001; // Very small tolerance for floating-point precision only
if (totalCost > (currentBalance + precision)) {
  const maxSendable = parseFloat(Math.max(0, currentBalance - gasFee).toFixed(8));
  showNotification(`${translator.translate('Insufficient balance. Total cost')}: ${formatNumberSmart(totalCost)} Access. ${translator.translate('Maximum sendable amount')}: ${formatNumberSmart(maxSendable)} Access`, 'error');
  return;
}






    // Start loading indicator
    const sendButton = document.querySelector('#transaction-modal button[type="submit"]');
    let originalText = '';
    if (sendButton) {
      originalText = sendButton.innerHTML;
      sendButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
      sendButton.disabled = true;
    }

    // Transaction gas fee

    const timestamp = Date.now();

  // Show processing notification
  showNotification(translator.translate('processingTransaction'), 'info');

  // First check if the recipient wallet exists in the server database
  fetchRecipientFromServer(recipientAddress)
    .then(serverRecipient => {
      // If the server found the recipient, use that data
      if (serverRecipient && serverRecipient.success && serverRecipient.user) {
        console.log('Found recipient in server database:', serverRecipient.user);
        return {
          publicAddress: recipientAddress,
          userId: serverRecipient.user.id,
          balance: serverRecipient.user.coins || 0,
          name: serverRecipient.user.name,
          email: serverRecipient.user.email,
          isServerVerified: true,
          isExternal: false
        };
      }

      // If no server match, check local storage as fallback
      const localWallet = findWalletByAddress(recipientAddress);
      if (localWallet && !localWallet.isExternal) {
        return localWallet;
      }

      // If wallet not found locally or in server, treat as external Access network wallet
      if (isValidWalletAddress(recipientAddress)) {
        console.log('Treating as external Access network wallet:', recipientAddress);
        return {
          publicAddress: recipientAddress,
          userId: `external_${Date.now()}`,
          balance: 0,
          transactions: [],
          isExternal: true,
          isExternalAccessWallet: true, // Flag for real external wallets
          name: 'External Access Wallet'
        };
      }

      return null;
    })
      .then(recipientWallet => {
        if (!recipientWallet) {
          if (sendButton) {
            sendButton.innerHTML = originalText;
            sendButton.disabled = false;
          }
          showNotification('Invalid recipient address', 'error');
          return Promise.reject(new Error('Invalid recipient address'));
        }

        return recipientWallet;
      })
      .then(recipientWallet => {
        // ⚡ Server will generate hash - no client-side hash to prevent duplicates
        // Create transaction object for sender (hash will be added by server)
        const transaction = {
          from: currentUser.wallet.publicAddress,
          to: recipientAddress,
          amount: amount,

          fee: gasFee,
          timestamp: timestamp,
          hash: null, // ⭐ Server will generate this
          status: 'pending' // Will be confirmed by server
        };

        // Add transaction to local wallet without modifying balance
        // The server will handle all balance updates to prevent double deduction
        currentUser.wallet.transactions = currentUser.wallet.transactions || [];
        currentUser.wallet.transactions.unshift(transaction);

        // Save updated sender wallet to localStorage (transactions only)
        localStorage.setItem(`wallet_${currentUser.id}`, JSON.stringify(currentUser.wallet));

        // Create corresponding transaction for recipient
        const recipientTransaction = {
          from: currentUser.wallet.publicAddress,
          to: recipientAddress,
          amount: amount,

          fee: 0, // Recipient doesn't pay the fee
          timestamp: timestamp,
          hash: null, // ⭐ Server will generate this
          status: 'pending' // Will be confirmed by server
        };

        // Update recipient wallet data
        recipientWallet.transactions = recipientWallet.transactions || [];
        recipientWallet.transactions.unshift(recipientTransaction);

        // Update recipient's balance
        recipientWallet.balance = (parseFloat(recipientWallet.balance) || 0) + amount;

        console.log(`Transaction processed: ${amount} coins sent from ${abbreviateAddress(currentUser.wallet.publicAddress)} to ${abbreviateAddress(recipientAddress)}`);
        console.log(`Recipient wallet updated with new balance: ${recipientWallet.balance}`);

        // Save updated recipient wallet to localStorage if not external
        if (!recipientWallet.isExternal) {
          localStorage.setItem(`wallet_${recipientWallet.userId}`, JSON.stringify(recipientWallet));
        }

        // Critical: Update recipient balance in server database
        if (recipientWallet.userId && !recipientWallet.isExternal) {
          // Get recipient's current server balance first
          fetchUserById(recipientWallet.userId)
            .then(userData => {
              if (userData && userData.success && userData.user) {
                const currentCoins = userData.user.coins || 0;
                const newCoins = currentCoins + amount;

                // Update user's coins in the server database
                updateUserCoinsOnServer(recipientWallet.userId, newCoins)
                  .then(response => {
                    console.log('Updated recipient coins in server database:', response);
                  })
                  .catch(err => console.error('Error updating recipient coins on server:', err));
              }
            })
            .catch(err => console.error('Error fetching recipient data from server:', err));
        } else if (recipientWallet.isExternalAccessWallet) {
          // For external Access network wallets, just log the transaction
          console.log(`Transaction sent to external Access wallet: ${recipientWallet.publicAddress}`);
          console.log(`Amount sent: ${amount} ACCESS`);
        }

        // Record transaction in server database and update balance from server response
        console.log(`Sending transaction data to server: ${amount} coins from ${currentUser.wallet.publicAddress} to ${recipientAddress}`);
        
        // Determine transaction type and recipient info
        const transactionData = {
          sender: currentUser.id,
          recipient: recipientWallet.isExternalAccessWallet ? null : recipientWallet.userId,
          senderAddress: currentUser.wallet.publicAddress,
          recipientAddress: recipientAddress,
          amount: amount,
          timestamp: timestamp,
          // ⭐ No hash - server will generate it
          description: recipientWallet.isExternalAccessWallet ? 'External Access Wallet Transfer' : 'Wallet Transfer',
          network: 'Access',
          isExternalRecipient: recipientWallet.isExternalAccessWallet || false
        };

        recordTransactionOnServer(transactionData).then(response => {
          console.log('Transaction successfully recorded on server:', response);

          // Update balance from server response to prevent double deduction
          if (response && response.sender_balance_new !== undefined) {
            const serverBalance = parseFloat(response.sender_balance_new);
            currentUser.coins = serverBalance;
            currentUser.wallet.balance = serverBalance;

            // Update UI with server-confirmed balance
            updateUserCoins(serverBalance);

            const isBalanceHidden = localStorage.getItem('balanceHidden') === 'true';
            if (!isBalanceHidden) {
              const walletBalanceElement = document.getElementById('network-coins');
              if (walletBalanceElement) {
                walletBalanceElement.textContent = formatNumberSmart(serverBalance);
              }

              const userCoinsElement = document.getElementById('user-coins');
              if (userCoinsElement) {
                userCoinsElement.textContent = formatNumberSmart(serverBalance);
              }

              const profileCoinsElement = document.getElementById('profile-coins');
              if (profileCoinsElement) {
                profileCoinsElement.textContent = formatNumberSmart(serverBalance);
              }
            }

            saveUserSession(currentUser);
          } else {
            // Fallback: refresh user data from server
            checkIfUserExists(currentUser.email).then(userData => {
              if (userData && userData.coins !== undefined) {
                currentUser.coins = userData.coins;
                currentUser.wallet.balance = userData.coins;
                updateUserCoins(userData.coins);
                saveUserSession(currentUser);
              }
            });
          }
        }).catch(err => {
          console.error('Error recording transaction on server:', err);
          // On error, refresh balance from server to ensure accuracy
          checkIfUserExists(currentUser.email).then(userData => {
            if (userData && userData.coins !== undefined) {
              currentUser.coins = userData.coins;
              currentUser.wallet.balance = userData.coins;
              updateUserCoins(userData.coins);
              saveUserSession(currentUser);
            }
          });
        });

        // UI will be updated after server confirms the transaction
        // to prevent double deduction issues

        // Create and display the transaction immediately without waiting for server
        const transactionList = document.getElementById('transaction-list');
        const emptyTransactions = document.getElementById('empty-transactions');

        if (transactionList) {
          // Hide empty state if it was visible
          if (emptyTransactions) emptyTransactions.style.display = 'none';

          // Remove any loading indicators or error messages
          const loadingIndicator = transactionList.querySelector('.loading-indicator');
          if (loadingIndicator) {
            transactionList.removeChild(loadingIndicator);
          }

          const errorMessage = transactionList.querySelector('.error-message');
          if (errorMessage) {
            transactionList.removeChild(errorMessage);
          }

          // Create a new transaction item with animation
          const item = document.createElement('div');
          item.className = 'transaction-item new-transaction';
          item.setAttribute('data-tx-hash', transaction.hash || `temp_${timestamp}`);

          // Format date using consistent formatting function
          const formattedDate = formatDateConsistently(timestamp);

          // Format amount with full precision before displaying it
          const formattedAmount = formatTransactionAmount(amount);

          // Set HTML content with transaction details
          item.innerHTML = `
            <div class="transaction-icon">
              <i class="fas fa-arrow-up" style="color: #f44336;"></i>
            </div>
            <div class="transaction-details">
              <div class="transaction-addresses">
                <div class="transaction-from">From: ${abbreviateAddress(currentUser.wallet.publicAddress)}</div>
                <div class="transaction-to">To: ${abbreviateAddress(recipientAddress)}</div>
              </div>
              <div class="transaction-meta">
                <div class="transaction-amount outgoing">
                  - <span class="amount-value">${formattedAmount}</span> Access Points
                </div>
                <div class="transaction-info">
                  <span class="transaction-date">${formattedDate}</span>
                </div>
              </div>
            </div>
          `;

          // Make transaction clickable
          item.style.cursor = 'pointer';
          item.onclick = function() { navigateToTransactionDetails(this); };

          // Add the new transaction at the top of the list
          if (transactionList.firstChild) {
            transactionList.insertBefore(item, transactionList.firstChild);
          } else {
            transactionList.appendChild(item);
          }

          // Add highlight animation
          setTimeout(() => {
            item.classList.add('highlight');

            // Remove highlight after animation completes
            setTimeout(() => {
              item.classList.remove('highlight');
              item.classList.remove('new-transaction');
            }, 2000);
          }, 10);

          // Balance will be updated from server response to prevent double deduction

          // Also update total transactions count if it exists
          const totalTransactionsElement = document.getElementById('total-transactions');
          if (totalTransactionsElement) {
            const currentCount = parseInt(totalTransactionsElement.textContent || '0');
            totalTransactionsElement.textContent = (currentCount + 1).toString();
          }
        }

        // We'll also update the transaction list in the background to ensure consistency
        // but the transaction is already visible to the user
        setTimeout(() => {
          updateTransactionList();
        }, 2000);

        // Reset send button
        if (sendButton) {
          sendButton.innerHTML = originalText;
          sendButton.disabled = false;
        }

        closeTransactionModal();
        const recipientInput = document.getElementById('recipient-address');
        const amountInput = document.getElementById('transaction-amount');
        if (recipientInput) recipientInput.value = '';
        if (amountInput) amountInput.value = '';

        showNotification(translator.translate('Transaction completed successfully'), 'success');

        return {
          success: true,
          transaction: transaction,
          senderUpdated: true,
          recipientUpdated: true
        };
      })
      .catch(error => {
        console.error('Transaction error:', error);
        if (sendButton) {
          sendButton.innerHTML = originalText;
          sendButton.disabled = false;
        }
        showNotification(translator.translate('Transaction failed') + ': ' + (error.message || translator.translate('Please try again')), 'error');
      });
  };

  // Fetch recipient from server database
  async function fetchRecipientFromServer(walletAddress) {
    try {
      const response = await fetch(`${window.location.origin}/api/user/wallet/${walletAddress}`);

      if (!response.ok) {
        if (response.status === 404) {
          // Not found in database - this is not an error
          return { success: false, wallet_found: false };
        }
        throw new Error(`Server returned status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching recipient from server:', error);
      // Return empty but don't throw, as we'll fall back to localStorage
      return { success: false, error: error.message };
    }
  }

  // Fetch user by ID from server
  async function fetchUserById(userId) {
    try {
      // Use a request to get user data by ID
      const response = await fetch(`${window.location.origin}/api/user/id/${userId}`);

      if (!response.ok) {
        if (response.status === 404) {
          return { success: false, user_found: false };
        }
        throw new Error(`Server returned status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching user by ID:', error);
      return { success: false, error: error.message };
    }
  }

  // Update user coins on server
  async function updateUserCoinsOnServer(userId, newCoins) {
    try {
      const response = await fetch(`${window.location.origin}/api/user/update-coins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, coins: newCoins })
      });

      if (!response.ok) {
        throw new Error(`Server returned status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error updating user coins on server:', error);
      throw error;
    }
  }

  // Record transaction on server 
  async function recordTransactionOnServer(transactionData) {
    try {
      // Add some logging to debug the transaction data
      console.log('Recording transaction:', {
        sender: transactionData.sender,
        recipient: transactionData.recipient,
        amount: transactionData.amount,
        hash: transactionData.hash?.substring(0, 10) + '...'
      });

      const response = await fetch(`${window.location.origin}/api/transaction/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transactionData)
      });

      if (!response.ok) {
        console.error(`Server error ${response.status}:`, await response.text());

        // Return a fallback success response to avoid breaking the client experience
        // This ensures the transaction completes locally even if server sync fails
        return { 
          success: true, 
          message: 'Transaction recorded locally',
          server_sync: false,
          transaction_hash: transactionData.hash
        };
      }

      const result = await response.json();
      console.log('Transaction recorded successfully on server:', result);
      return result;
    } catch (error) {
      console.error('Error recording transaction on server:', error);

      // Return fallback response instead of throwing to maintain app functionality
      return { 
        success: true, 
        message: 'Transaction recorded locally only',
        server_sync: false,
        transaction_hash: transactionData.hash || 'unknown'
      };
    }
  }

  // Validate wallet address format
  function isValidWalletAddress(address) {
    // Wallet address should be a 0x prefixed hex string of length 42 (including 0x)
    return /^0x[0-9a-fA-F]{40}$/.test(address);
  }

  // Find wallet by address
  async function findWalletByAddress(address) {
    console.log(`Looking for wallet address: ${address}`);

    // First check if wallet exists in the system
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);

      if (key.startsWith('wallet_')) {
        try {
          const wallet = JSON.parse(localStorage.getItem(key));
          if (wallet && wallet.publicAddress === address) {
            // Extract user ID from key
            const userId = key.replace('wallet_', '');
            console.log(`Found wallet in localStorage for user ID: ${userId}`);
            return { ...wallet, userId };
          }
        } catch (e) {
          console.error(`Error parsing wallet data: ${key}`, e);
        }
      }
    }

    // If not found in localStorage, check with server
    try {
      // Make a request to check if the wallet address exists on any user
      console.log(`Checking server for wallet address: ${address}`);
      const response = await fetch(`${window.location.origin}/api/user/wallet/${address}`);

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user) {
          // Create a wallet object with the found user's data
          console.log(`Server found wallet for user: ${data.user.name || data.user.email}, ID: ${data.user.id}`);

          // Create a new wallet object with the user's data
          const serverWallet = {
            publicAddress: address,
            userId: data.user.id,
            balance: data.user.coins || 1000000,
            transactions: []
          };

          // Check if we already have wallet data in localStorage
          const existingWalletKey = `wallet_${data.user.id}`;
          const existingWalletJson = localStorage.getItem(existingWalletKey);

          if (existingWalletJson) {
            try {
              // If we have existing wallet data, use that but ensure the address is correct
              const existingWallet = JSON.parse(existingWalletJson);

              // If addresses don't match, use the server address but keep transactions
              if (existingWallet.publicAddress !== address) {
                existingWallet.publicAddress = address;
              }

              // Return merged wallet data
              return {
                ...existingWallet,
                userId: data.user.id,
                balance: existingWallet.balance || data.user.coins || 1000000
              };
            } catch (err) {
              console.error('Error parsing existing wallet:', err);
              // Return the server wallet as fallback
              return serverWallet;
            }
          } else {
            // No existing wallet, return the server wallet
            return serverWallet;
          }
        }
      }
    } catch (error) {
      console.error('Error checking wallet on server:', error);
    }

    // If the address is valid format but not found, treat as external Access wallet
    if (isValidWalletAddress(address)) {
      console.log('Treating as external Access network wallet:', address);
      return {
        publicAddress: address,
        userId: 'external_' + Date.now(),
        balance: 0,
        transactions: [],
        isExternal: true,
        isExternalAccessWallet: true,  // Flag for real external Points wallets
        name: 'External Points Wallet'
      };
    }

    console.log(`No wallet found for address: ${address}`);
    return null;
  }

  // Generate transaction hash - now returns a Promise
  async function generateTransactionHash(from, to, amount, timestamp) {
    const data = `${from}${to}${amount}${timestamp}${Math.random()}`;

    if (window.crypto && window.crypto.subtle) {
      try {
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
        return Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      } catch (error) {
        console.error('Error generating crypto hash:', error);
        // Fall back to simple hash if crypto API fails
        let hash = 0;
        for (let i = 0; i < data.length; i++) {
          const char = data.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash;
        }
        return '0x' + Math.abs(hash).toString(16).padStart(64, '0');
      }
    } else {
      // Simple hash function for fallback
      let hash = 0;
      for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return '0x' + Math.abs(hash).toString(16).padStart(64, '0');
    }
  }



   // Format amount with proper decimal places - smart formatting
    function formatAmount(amount) {
      const num = parseFloat(amount);
      if (isNaN(num)) return '0.00';
      
      // ✅ دائماً اعرض رقمين عشريين على الأقل (حتى لو كان 0)
      let formatted = parseFloat(num.toFixed(8)).toString();
      const parts = formatted.split('.');
      
      // Ensure at least 2 decimal places for ALL numbers
      if (!parts[1]) {
        parts[1] = '00';
      } else if (parts[1].length < 2) {
        parts[1] = parts[1].padEnd(2, '0');
      }
      
      // Add thousand separators to the integer part
      parts[0] = parseInt(parts[0]).toLocaleString('en-US');
      
      return parts.join('.');
    }

    // Ensure transaction amount is displayed with smart formatting
    function formatTransactionAmount(amount) {
      if (amount === undefined || amount === null) return '0.00';
      
      const num = parseFloat(amount);
      if (isNaN(num)) return '0.00';
      
      // ✅ دائماً اعرض رقمين عشريين على الأقل (حتى لو كان 0)
      let formatted = parseFloat(num.toFixed(8)).toString();
      const parts = formatted.split('.');
      
      // Ensure at least 2 decimal places for ALL numbers
      if (!parts[1]) {
        parts[1] = '00';
      } else if (parts[1].length < 2) {
        parts[1] = parts[1].padEnd(2, '0');
      }
      
      // Add thousand separators to the integer part
      parts[0] = parseInt(parts[0]).toLocaleString('en-US');
      
      return parts.join('.');
    }



  // Update transaction list
  async function updateTransactionList() {
    const transactionList = document.getElementById('transaction-list');
    const emptyTransactions = document.getElementById('empty-transactions');

    if (!transactionList || !currentUser || !currentUser.id) {
      return;
    }

    // Clear current list
    transactionList.innerHTML = '';

    // Show loading indicator
    transactionList.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i> Loading transactions...</div>';

    try {
      // Define all possible endpoints to try in order
      const endpoints = [
        `/api/transactions/${currentUser.id}`,
        `/api/user/${currentUser.id}/transactions`,
        `/api/user/id/${currentUser.id}/transactions`,
        `/api/wallet/${currentUser.wallet?.publicAddress}/transactions`
      ];

      let response = null;
      let successEndpoint = null;
      let lastError = null;

      // Try each endpoint until one works
      for (const endpoint of endpoints) {
        // Skip invalid endpoints
        if (endpoint.includes('undefined') || endpoint.includes('null')) continue;

        try {
          console.log(`Trying to fetch transactions from: ${endpoint}`);
          const tempResponse = await fetch(`${window.location.origin}${endpoint}`);

          if (tempResponse.ok) {
            response = tempResponse;
            successEndpoint = endpoint;
            break;
          }
        } catch (endpointError) {
          console.error(`Error with endpoint ${endpoint}:`, endpointError);
          lastError = endpointError;
        }
      }

      // If no endpoint worked and we have a wallet, try one last approach
      if (!response && currentUser.wallet && currentUser.wallet.publicAddress) {
        try {
          // Check endpoint API status
          const apiCheckResponse = await fetch(`${window.location.origin}/api/wallet/`);
          console.log(`API check response status:`, apiCheckResponse.status);

          // Try to use wallet address directly
          const walletEndpoint = `/api/wallet/${currentUser.wallet.publicAddress}`;
          console.log(`Last attempt using wallet directly: ${walletEndpoint}`);

          const walletResponse = await fetch(`${window.location.origin}${walletEndpoint}`);
          if (walletResponse.ok) {
            response = walletResponse;
            successEndpoint = walletEndpoint;
          }
        } catch (finalError) {
          console.error("Final attempt error:", finalError);
        }
      }

      if (!response || !response.ok) {
        throw new Error(`Server returned ${response?.status || 404}`);
      }

      console.log(`Successfully fetched transactions from ${successEndpoint}`);
      const data = await response.json();

      // Different endpoints might have different response structures
      let transactions = [];

      if (data.transactions) {
        transactions = data.transactions;
      } else if (data.wallet_found && data.transactions) {
        transactions = data.transactions;
      } else if (data.success && data.transactions) {
        transactions = data.transactions;
      } else if (Array.isArray(data)) {
        transactions = data;
      }

      // Use wallet transactions as fallback if we have them locally
      if (transactions.length === 0 && currentUser.wallet && currentUser.wallet.transactions) {
        console.log("Using local wallet transactions as fallback");
        transactions = currentUser.wallet.transactions;
      }

      // Clear loading indicator
      transactionList.innerHTML = '';

      if (!transactions || transactions.length === 0) {
        if (emptyTransactions) emptyTransactions.style.display = 'flex';
        return;
      }

      // Hide empty state
      if (emptyTransactions) emptyTransactions.style.display = 'none';

      // Store all transactions globally for pagination
      window.allUserTransactions = transactions;
      window.displayedTxCount = Math.min(25, transactions.length);

      // Display first 25 transactions
      renderTransactions(transactions.slice(0, 25), transactionList);
      
      // Add pagination buttons if needed
      updatePaginationButtons(transactionList);

      // Update stats
      const totalBlocksElement = document.getElementById('total-blocks');
      const totalTransactionsElement = document.getElementById('total-transactions');
      if (totalBlocksElement) totalBlocksElement.textContent = Math.floor(transactions.length / 10) + 1;
      if (totalTransactionsElement) totalTransactionsElement.textContent = transactions.length;

    } catch (error) {
      console.error("Failed to fetch transactions:", error);
      transactionList.innerHTML = '<div class="error-message">Failed to load transactions</div>';
      if (emptyTransactions) emptyTransactions.style.display = 'flex';
    }
  }

  // Render transactions to the list
  function renderTransactions(txList, container) {
    txList.forEach(tx => {
        const item = document.createElement('div');
        item.className = 'transaction-item';

        // Determine if this is an incoming or outgoing transaction with more robust checking
        const userAddress = currentUser.wallet?.publicAddress || '';
        const isOutgoing = 
          tx.sender === currentUser.id || 
          tx.sender_id === currentUser.id ||
          tx.from === userAddress ||
          tx.sender_address === userAddress ||
          (tx.direction === 'outgoing');

        const isSelfTransaction = 
          (tx.sender === tx.recipient || tx.sender_id === tx.recipient_id) || 
          (tx.from === tx.to || tx.sender_address === tx.recipient_address);

        // Format date in a consistent way using formatDateConsistently
        const txTimestamp = parseInt(tx.timestamp) || Date.now();
        const formattedDate = formatDateConsistently(txTimestamp);

        // Determine the right icon and color based on transaction type
        let iconClass = isOutgoing ? 'arrow-up' : 'arrow-down';
        let iconColor = isOutgoing ? '#f44336' : '#4CAF50';

        if (isSelfTransaction) {
          iconClass = 'exchange-alt';
          iconColor = '#FF9800';
        }

        // Make sure we're using the correct address properties with fallbacks
        const fromAddress = tx.sender_address || tx.from || 'Unknown';
        const toAddress = tx.recipient_address || tx.to || 'Unknown';

        // Ensure tx.amount is a number
        const amount = typeof tx.amount === 'number' ? tx.amount : 
               typeof tx.amount === 'string' ? parseFloat(tx.amount.replace(/[^0-9.-]/g, '')) || 0 : 0;

        // Determine the network (default to Acces if not specified)
        const network = tx.network || 'Access points';

        item.innerHTML = `
          <div class="transaction-icon">
            <i class="fas fa-${iconClass}" style="color: ${iconColor}"></i>
          </div>
          <div class="transaction-details">
            <div class="transaction-addresses">
              <div class="transaction-from">From: ${abbreviateAddress(fromAddress)}</div>
              <div class="transaction-to">To: ${abbreviateAddress(toAddress)}</div>
            </div>
            <div class="transaction-meta">
                <div class="transaction-amount ${isOutgoing ? 'outgoing' : 'incoming'}">
  <span class="amount-value">${isOutgoing ? '-' : '+'} ${formatAmount(amount)}</span>Access Points
</div>
              <div class="transaction-info">
                <span class="transaction-date">${formattedDate}</span>
              </div>
            </div>
          </div>
        `;

        if (tx.hash) item.setAttribute('data-tx-hash', tx.hash);
        item.style.cursor = 'pointer';
        item.onclick = function() { navigateToTransactionDetails(this); };
        container.appendChild(item);
      });
  }

  // Update pagination buttons
  function updatePaginationButtons(container) {
    // Remove existing pagination
    const existingPagination = document.getElementById('txPaginationBtns');
    if (existingPagination) existingPagination.remove();

    const total = window.allUserTransactions ? window.allUserTransactions.length : 0;
    const displayed = window.displayedTxCount || 0;

    if (total <= 25) return; // No pagination needed

    const paginationDiv = document.createElement('div');
    paginationDiv.id = 'txPaginationBtns';
    paginationDiv.style.cssText = 'display: flex; justify-content: center; gap: 10px; padding: 15px; flex-wrap: wrap;';

    let buttonsHtml = '';

    // Get translated button texts
    const showLessText = (typeof translator !== 'undefined' && translator.translate) ? translator.translate('Show Less') : 'Show Less';
    const showMoreText = (typeof translator !== 'undefined' && translator.translate) ? translator.translate('Show More') : 'Show More';
    const resetText = (typeof translator !== 'undefined' && translator.translate) ? translator.translate('Reset') : 'Reset';

    // Show Less button (only if more than 25 displayed)
    const isDarkMode = document.documentElement.classList.contains('dark-theme');
    if (displayed > 25) {
      const showLessBg = isDarkMode ? '#4a4a4a' : '#94a3b8';
      const showLessBorder = isDarkMode ? '1px solid #5a5a5a' : 'none';
      buttonsHtml += `
        <button onclick="showLessTransactions()" style="padding: 10px 20px; background: ${showLessBg}; color: white; border: ${showLessBorder}; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 5px;">
          <i class="fas fa-chevron-up"></i> ${showLessText}
        </button>
      `;
    }

    // Show More button (only if there are more to show)
    if (displayed < total) {
      const isDark = document.documentElement.classList.contains('dark-theme');
      const btnBg = isDark ? '#3a3a3a' : '#60a5fa';
      const btnBorder = isDark ? '1px solid #4a4a4a' : 'none';
      buttonsHtml += `
        <button onclick="showMoreTransactions()" style="padding: 10px 20px; background: ${btnBg}; color: white; border: ${btnBorder}; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 5px;">
          <i class="fas fa-chevron-down"></i> ${showMoreText} (${displayed}/${total})
        </button>
      `;
    }

    // Reset button (only if not at initial state)
    if (displayed > 25) {
      const resetBg = isDarkMode ? '#3a3a3a' : '#64748b';
      const resetBorder = isDarkMode ? '1px solid #4a4a4a' : 'none';
      buttonsHtml += `
        <button onclick="resetTransactions()" style="padding: 10px 20px; background: ${resetBg}; color: white; border: ${resetBorder}; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 5px;">
          <i class="fas fa-undo"></i> ${resetText}
        </button>
      `;
    }

    paginationDiv.innerHTML = buttonsHtml;
    container.appendChild(paginationDiv);
  }

  // Show more transactions
  window.showMoreTransactions = function() {
    const container = document.getElementById('transaction-list');
    const total = window.allUserTransactions.length;
    const currentCount = window.displayedTxCount;
    const newCount = Math.min(currentCount + 25, total);

    // Get next batch
    const nextBatch = window.allUserTransactions.slice(currentCount, newCount);
    
    // Remove pagination buttons before adding new items
    const pagination = document.getElementById('txPaginationBtns');
    if (pagination) pagination.remove();

    // Add new transactions
    renderTransactions(nextBatch, container);
    
    window.displayedTxCount = newCount;
    updatePaginationButtons(container);
  };

  // Show less transactions
  window.showLessTransactions = function() {
    const container = document.getElementById('transaction-list');
    const currentCount = window.displayedTxCount;
    const newCount = Math.max(currentCount - 25, 25);

    // Clear and re-render
    container.innerHTML = '';
    renderTransactions(window.allUserTransactions.slice(0, newCount), container);
    
    window.displayedTxCount = newCount;
    updatePaginationButtons(container);
  };

  // Reset to first 25
  window.resetTransactions = function() {
    const container = document.getElementById('transaction-list');
    container.innerHTML = '';
    // Reset filter and search
    window.currentTxFilter = 'all';
    window.currentTxSearch = '';
    const searchInput = document.getElementById('txSearchInput');
    if (searchInput) searchInput.value = '';
    const filterLabel = document.getElementById('txFilterLabel');
    if (filterLabel) filterLabel.textContent = (typeof translator !== 'undefined' && translator.translate) ? translator.translate('All') : 'All';
    
    renderTransactions(window.allUserTransactions.slice(0, 25), container);
    window.displayedTxCount = Math.min(25, window.allUserTransactions.length);
    updatePaginationButtons(container);
  };

  // Transaction filter state
  window.currentTxFilter = 'all';
  window.currentTxSearch = '';
  window.filteredTransactions = [];

  // Toggle filter menu - positions it near the clicked button
  window.toggleTxFilterMenu = function(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('txFilterMenu');
    if (!menu) return;
    
    // If menu is open, close it
    if (menu.style.display === 'block') {
      menu.style.display = 'none';
      return;
    }
    
    const btn = event ? event.currentTarget : (document.getElementById('txFilterBtn') || document.getElementById('txFilterBtnMobile'));
    if (!btn) return;
    
    const rect = btn.getBoundingClientRect();
    const menuHeight = 350;
    const menuWidth = 170;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    
    // Reset positions
    menu.style.top = 'auto';
    menu.style.bottom = 'auto';
    menu.style.left = 'auto';
    menu.style.right = 'auto';
    
    // Check if menu will be cut off (not enough space above OR below)
    if (spaceBelow < menuHeight && spaceAbove < menuHeight) {
      // Open to the LEFT of button, vertically centered on screen
      menu.style.right = (window.innerWidth - rect.left + 8) + 'px';
      menu.style.top = Math.max(10, (window.innerHeight - menuHeight) / 2) + 'px';
    } else if (spaceBelow < menuHeight) {
      // Not enough space below - open ABOVE
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      menu.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    } else {
      // Normal - open below
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      menu.style.top = (rect.bottom + 4) + 'px';
    }
    
    menu.style.display = 'block';
  };

  // Close filter menu when clicking outside
  document.addEventListener('click', function(e) {
    const menu = document.getElementById('txFilterMenu');
    const btn = document.getElementById('txFilterBtn');
    const btnMobile = document.getElementById('txFilterBtnMobile');
    
    if (menu && menu.style.display === 'block') {
      const clickedBtn = (btn && btn.contains(e.target)) || (btnMobile && btnMobile.contains(e.target));
      if (!clickedBtn && !menu.contains(e.target)) {
        menu.style.display = 'none';
      }
    }
  });

  // Close filter menu when scrolling
  window.addEventListener('scroll', function() {
    const menu = document.getElementById('txFilterMenu');
    if (menu && menu.style.display === 'block') {
      menu.style.display = 'none';
    }
  }, true);

  // Apply transaction filter
  window.applyTxFilter = function(filter) {
    window.currentTxFilter = filter;
    const menu = document.getElementById('txFilterMenu');
    if (menu) menu.style.display = 'none';

    // Highlight active filter option (including showAll)
    const isDarkMode = document.documentElement.classList.contains('dark-theme');
    document.querySelectorAll('.tx-filter-option').forEach(opt => {
      if (opt.getAttribute('data-filter') === filter) {
        opt.style.background = isDarkMode ? '#3a3a3a' : 'var(--primary-light, #e0f2fe)';
        opt.style.color = isDarkMode ? '#f5f5f5' : '#60a5fa';
      } else {
        opt.style.background = 'transparent';
        opt.style.color = 'var(--text-primary, inherit)';
      }
    });

    // Handle "Show All Transactions" - expand all at once
    if (filter === 'showAll') {
      // Update labels for showAll too
      const filterLabel = document.getElementById('txFilterLabel');
      const filterLabelMobile = document.getElementById('txFilterLabelMobile');
      const labelText = 'Show All Transactions';
      const translatedText = (typeof translator !== 'undefined' && translator.translate) ? translator.translate(labelText) : labelText;
      if (filterLabel) filterLabel.textContent = translatedText;
      if (filterLabelMobile) filterLabelMobile.textContent = translatedText;
      
      window.showAllTransactionsAtOnce();
      return;
    }

    // Update filter labels (both desktop and mobile)
    const filterLabel = document.getElementById('txFilterLabel');
    const filterLabelMobile = document.getElementById('txFilterLabelMobile');
    const filterLabels = {
      'all': 'All',
      'showAll': 'Show All Transactions',
      'newest': 'Newest',
      'oldest': 'Oldest',
      'highest': 'Highest Amount',
      'lowest': 'Lowest Amount',
      'sent': 'Sent',
      'received': 'Received'
    };
    const labelText = filterLabels[filter] || 'All';
    const translatedText = (typeof translator !== 'undefined' && translator.translate) ? translator.translate(labelText) : labelText;
    
    if (filterLabel) filterLabel.textContent = translatedText;
    if (filterLabelMobile) filterLabelMobile.textContent = translatedText;

    console.log('Calling applyTransactionFilters from filter selection');
    window.applyTransactionFilters();
  };

  // Show all transactions at once (no pagination)
  window.showAllTransactionsAtOnce = function() {
    const container = document.getElementById('transaction-list');
    if (!container) {
      console.log('Transaction list container not found');
      return;
    }
    
    const transactions = window.allUserTransactions || [];
    if (transactions.length === 0) {
      console.log('No transactions to show');
      return;
    }
    
    console.log('Showing all', transactions.length, 'transactions at once');
    
    // Clear existing
    container.innerHTML = '';
    
    // Remove any existing pagination buttons
    const existingPagination = document.getElementById('txPaginationBtns');
    if (existingPagination) existingPagination.remove();
    
    // Use renderTransactions to show ALL transactions
    renderTransactions(transactions, container);
    
    // Update displayed count to total
    window.displayedTxCount = transactions.length;
    window.filteredTransactions = transactions;
    
    // Show Reset button using the same method as other filters
    const resetText = (typeof translator !== 'undefined' && translator.translate) ? translator.translate('Reset') : 'Reset';
    const paginationDiv = document.createElement('div');
    paginationDiv.id = 'txPaginationBtns';
    paginationDiv.style.cssText = 'display: flex; justify-content: center; gap: 10px; padding: 15px; flex-wrap: wrap;';
    paginationDiv.innerHTML = `<button onclick="resetTransactions()" style="padding: 10px 20px; background: #374151; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 5px;"><i class="fas fa-undo"></i> ${resetText}</button>`;
    container.appendChild(paginationDiv);
    
    // Update labels
    const filterLabel = document.getElementById('txFilterLabel');
    const filterLabelMobile = document.getElementById('txFilterLabelMobile');
    const labelText = 'Show All Transactions';
    const translatedText = (typeof translator !== 'undefined' && translator.translate) ? translator.translate(labelText) : labelText;
    if (filterLabel) filterLabel.textContent = translatedText;
    if (filterLabelMobile) filterLabelMobile.textContent = translatedText;
  };

  // Search transactions by address or hash
  window.filterTransactionsBySearch = function(searchText) {
    console.log('Search input:', searchText);
    window.currentTxSearch = searchText.toLowerCase().trim();
    console.log('Calling applyTransactionFilters from search');
    window.applyTransactionFilters();
  };

  // Apply all filters (search + filter type)
  window.applyTransactionFilters = function() {
    if (!window.allUserTransactions || window.allUserTransactions.length === 0) {
      console.log('No transactions to filter');
      return;
    }

    console.log('Applying filters:', window.currentTxFilter, 'Search:', window.currentTxSearch);
    console.log('Total transactions available:', window.allUserTransactions.length);

    let filtered = [...window.allUserTransactions];
    
    // Get user wallet address - check both local and window scope
    const user = currentUser || window.currentUser;
    const userWallet = user && user.wallet ? (user.wallet.address || user.wallet.publicAddress || '').toLowerCase() : '';
    console.log('User wallet for filtering:', userWallet);

    // Apply search filter
    if (window.currentTxSearch && window.currentTxSearch.length > 0) {
      console.log('Searching for:', window.currentTxSearch);
      filtered = filtered.filter(tx => {
        const from = (tx.from_address || tx.fromAddress || '').toLowerCase();
        const to = (tx.to_address || tx.toAddress || '').toLowerCase();
        const hash = (tx.hash || tx.transaction_hash || tx.txHash || '').toLowerCase();
        const matches = from.includes(window.currentTxSearch) || 
               to.includes(window.currentTxSearch) || 
               hash.includes(window.currentTxSearch);
        return matches;
      });
      console.log('After search filter:', filtered.length, 'transactions');
    }

    // Apply type filter
    console.log('Applying filter type:', window.currentTxFilter);
    switch (window.currentTxFilter) {
      case 'newest':
        filtered.sort((a, b) => {
          const dateA = new Date(a.created_at || a.timestamp || a.date || 0);
          const dateB = new Date(b.created_at || b.timestamp || b.date || 0);
          return dateB - dateA;
        });
        console.log('Sorted by newest');
        break;
      case 'oldest':
        filtered.sort((a, b) => {
          const dateA = new Date(a.created_at || a.timestamp || a.date || 0);
          const dateB = new Date(b.created_at || b.timestamp || b.date || 0);
          return dateA - dateB;
        });
        console.log('Sorted by oldest');
        break;
      case 'highest':
        filtered.sort((a, b) => parseFloat(b.amount || b.value || 0) - parseFloat(a.amount || a.value || 0));
        console.log('Sorted by highest amount');
        break;
      case 'lowest':
        filtered.sort((a, b) => parseFloat(a.amount || a.value || 0) - parseFloat(b.amount || b.value || 0));
        console.log('Sorted by lowest amount');
        break;
      case 'sent':
        if (userWallet) {
          filtered = filtered.filter(tx => {
            const from = (tx.from_address || tx.fromAddress || '').toLowerCase();
            return from === userWallet;
          });
          console.log('Filtered sent transactions:', filtered.length);
        }
        break;
      case 'received':
        if (userWallet) {
          filtered = filtered.filter(tx => {
            const to = (tx.to_address || tx.toAddress || '').toLowerCase();
            return to === userWallet;
          });
          console.log('Filtered received transactions:', filtered.length);
        }
        break;
      default: // 'all'
        console.log('Showing all transactions');
        break;
    }

    window.filteredTransactions = filtered;
    window.displayedTxCount = Math.min(25, filtered.length);
    console.log('Final filtered count:', filtered.length, 'Displaying:', window.displayedTxCount);

    const container = document.getElementById('transaction-list');
    if (container) {
      container.innerHTML = '';
      if (filtered.length === 0) {
        const noResults = (typeof translator !== 'undefined' && translator.translate) ? translator.translate('No transactions found') : 'No transactions found';
        container.innerHTML = `<div class="empty-transactions" style="text-align: center; padding: 30px; color: var(--text-secondary, #6b7280);"><i class="fas fa-search" style="font-size: 24px; margin-bottom: 10px;"></i><p>${noResults}</p></div>`;
      } else {
        renderTransactions(filtered.slice(0, window.displayedTxCount), container);
        updatePaginationButtonsFiltered(container, filtered);
      }
    }
    console.log('Filter applied successfully!');
  };

  // Update pagination for filtered results
  function updatePaginationButtonsFiltered(container, filteredList) {
    const existingPagination = document.getElementById('txPaginationBtns');
    if (existingPagination) existingPagination.remove();

    const total = filteredList.length;
    const displayed = window.displayedTxCount || 0;

    if (total <= 25 && displayed <= 25) return;

    const paginationDiv = document.createElement('div');
    paginationDiv.id = 'txPaginationBtns';
    paginationDiv.style.cssText = 'display: flex; justify-content: center; gap: 10px; padding: 15px; flex-wrap: wrap;';

    const showLessText = (typeof translator !== 'undefined' && translator.translate) ? translator.translate('Show Less') : 'Show Less';
    const showMoreText = (typeof translator !== 'undefined' && translator.translate) ? translator.translate('Show More') : 'Show More';
    const resetText = (typeof translator !== 'undefined' && translator.translate) ? translator.translate('Reset') : 'Reset';

    let buttonsHtml = '';
    const isDark = document.documentElement.classList.contains('dark-theme');

    if (displayed > 25) {
      const showLessBg = isDark ? '#4a4a4a' : '#94a3b8';
      const showLessBorder = isDark ? '1px solid #5a5a5a' : 'none';
      buttonsHtml += `<button onclick="showLessFiltered()" style="padding: 10px 20px; background: ${showLessBg}; color: white; border: ${showLessBorder}; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 5px;"><i class="fas fa-chevron-up"></i> ${showLessText}</button>`;
    }

    if (displayed < total) {
      const btnBg = isDark ? '#3a3a3a' : '#60a5fa';
      const btnBorder = isDark ? '1px solid #4a4a4a' : 'none';
      buttonsHtml += `<button onclick="showMoreFiltered()" style="padding: 10px 20px; background: ${btnBg}; color: white; border: ${btnBorder}; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 5px;"><i class="fas fa-chevron-down"></i> ${showMoreText} (${displayed}/${total})</button>`;
    }

    if (displayed > 25 || window.currentTxFilter !== 'all' || window.currentTxSearch) {
      const resetBg = isDark ? '#3a3a3a' : '#64748b';
      const resetBorder = isDark ? '1px solid #4a4a4a' : 'none';
      buttonsHtml += `<button onclick="resetTransactions()" style="padding: 10px 20px; background: ${resetBg}; color: white; border: ${resetBorder}; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 5px;"><i class="fas fa-undo"></i> ${resetText}</button>`;
    }

    paginationDiv.innerHTML = buttonsHtml;
    container.appendChild(paginationDiv);
  }

  // Show more filtered transactions
  window.showMoreFiltered = function() {
    const filtered = window.filteredTransactions || window.allUserTransactions;
    const currentCount = window.displayedTxCount;
    const newCount = Math.min(currentCount + 25, filtered.length);

    const container = document.getElementById('transaction-list');
    const pagination = document.getElementById('txPaginationBtns');
    if (pagination) pagination.remove();

    const nextBatch = filtered.slice(currentCount, newCount);
    nextBatch.forEach(tx => {
      const txElement = createTransactionElement(tx);
      container.appendChild(txElement);
    });

    window.displayedTxCount = newCount;
    updatePaginationButtonsFiltered(container, filtered);
  };

  // Show less filtered transactions
  window.showLessFiltered = function() {
    const filtered = window.filteredTransactions || window.allUserTransactions;
    const currentCount = window.displayedTxCount;
    const newCount = Math.max(currentCount - 25, 25);

    const container = document.getElementById('transaction-list');
    container.innerHTML = '';
    renderTransactions(filtered.slice(0, newCount), container);
    window.displayedTxCount = newCount;
    updatePaginationButtonsFiltered(container, filtered);
  };

  // Abbreviate address for display
  function abbreviateAddress(address) {
    if (!address) return '';
    return address.substring(0, 6) + '...' + address.substring(address.length - 4);
  }

  // Navigate to transaction details page
  window.navigateToTransactionDetails = function(element) {
    const hash = element.getAttribute('data-tx-hash');
    if (hash) {
      window.location.href = `transaction-details.html?hash=${hash}`;
    }
  };

  // Show the full network explorer
  window.showFullExplorer = function() {
    window.location.href = 'access-explorer.html';
  };

  // Sync wallet balance with user's coin balance
  function syncWalletBalanceWithUserCoins() {
    if (currentUser && typeof currentUser.coins !== 'undefined') {
      // Update UI to display database balance
      const walletBalance = document.getElementById('network-coins');
      if (walletBalance) {
        walletBalance.textContent = formatNumberSmart(parseFloat(currentUser.coins));
      }

      // If wallet exists, ensure its balance matches database
      if (currentUser.wallet) {
        // Always set wallet balance to match user's coins from database
        currentUser.wallet.balance = currentUser.coins;
      }

      console.log('Wallet balance displayed from database coins:', currentUser.coins);
    }
  }

  // Fetch transactions from the server
  async function fetchUserTransactions() {
    if (!currentUser || !currentUser.id) {
      console.error("Cannot fetch transactions: User not logged in");
      return [];
    }

    try {
      console.log("Fetching transactions from server for user:", currentUser.id);
      const response = await fetch(`${window.location.origin}/api/user/${currentUser.id}/transactions`);

      if (!response.ok) {
        throw new Error(`Server returned status: ${response.status}`);
      }

      const data = await response.json();
      console.log(`Successfully fetched ${data.transactions.length} transactions from server`);

      // Format transactions for client-side display
      return data.transactions.map(tx => ({
        hash: tx.hash,
        from: tx.sender_address,
        to: tx.recipient_address,
        amount: parseFloat(tx.amount),
        timestamp: parseInt(tx.timestamp),
        status: tx.status || 'confirmed',
        description: tx.description,
        gas_fee: parseFloat(tx.gas_fee || 0)
      }));
    } catch (error) {
      console.error("Error fetching transactions from server:", error);
      return [];
    }
  }

  // Initialize network data when showing network page
  document.addEventListener('DOMContentLoaded', function() {
    const navLinks = document.querySelectorAll('.nav-link[data-page="network"], .mobile-nav-item[data-page="network"]');

    navLinks.forEach(link => {
      link.addEventListener('click', function() {
        // Timeout to ensure page is visible first
        setTimeout(async () => {
          if (currentUser && currentUser.id) {
            // Show loading indicator
            const transactionList = document.getElementById('transaction-list');
            if (transactionList) {
              transactionList.innerHTML = '<div class="loading-indicator"><i class="fas fa-spinner fa-spin"></i> Loading transactions...</div>';
            }

            try {
              // Before initializing the wallet, fetch fresh user data to ensure we have the latest balance
              const userData = await checkIfUserExists(currentUser.email);

              if (userData) {
                // Update current user with latest data from server
                currentUser.coins = userData.coins || 0;

                // Immediately display user's actual balance from database
                syncWalletBalanceWithUserCoins();

                // Initialize wallet data
                await initializeUserWallet();

                // Make sure wallet balance is synced with user coins again
                syncWalletBalanceWithUserCoins();

                // Fetch transactions from server
                const serverTransactions = await fetchUserTransactions();

                // Merge with any local transactions
                if (currentUser.wallet) {
                  // Get local transactions if they exist
                  const localTransactions = currentUser.wallet.transactions || [];

                  // Create a set of transaction hashes from server to avoid duplicates
                  const serverTransactionHashes = new Set(serverTransactions.map(tx => tx.hash));

                  // Filter out local transactions that are already on the server
                  const uniqueLocalTransactions = localTransactions.filter(tx => 
                    tx.hash && !serverTransactionHashes.has(tx.hash)
                  );

                  // Combine transactions, placing server transactions first
                  currentUser.wallet.transactions = [
                    ...serverTransactions,
                    ...uniqueLocalTransactions
                  ].sort((a, b) => b.timestamp - a.timestamp); // Sort by timestamp, newest first
                } else if (currentUser.wallet === undefined) {
                  // Initialize wallet object if it doesn't exist
                  currentUser.wallet = {
                    transactions: serverTransactions,
                    balance: currentUser.coins || 0
                  };
                }

                // Update transaction list
                updateTransactionList();
              }
            } catch (err) {
              console.error("Error fetching data:", err);

              // Still try to initialize wallet with existing data
              syncWalletBalanceWithUserCoins();
              await initializeUserWallet();
              updateTransactionList();
            }
          }
        }, 100);
      });
    });
  });




  
 
 
// Format coins to show proper decimal places without unnecessary zeros
    function formatCoins(value) {
      if (value === undefined || value === null) return '0.00';

      // Convert to number and format with 8 decimal places initially
      const num = parseFloat(value);

      // If the value is exactly zero, just return "0.00"
      if (num === 0) return '0.00';

      // Format with up to 8 decimal places
      const fixed = num.toFixed(8);

      // For numbers less than 1, preserve all significant decimal places
      if (num < 1 && num > 0) {
        // Remove trailing zeros but keep at least 2 decimal places for values like 0.10
        const trimmed = fixed.replace(/0+$/, '');
        const decimalPart = trimmed.split('.')[1] || '';

        // If only one decimal place, add zero to make it 0.50 instead of 0.5
        if (decimalPart.length === 1) {
          return trimmed + '0';
        }

        // Special handling for values like 0.02, 0.03, etc.
        // Ensure they show as 0.02, not 0.2
        if (decimalPart.length === 2 && decimalPart.endsWith('0')) {
          return trimmed; // Keep 0.50 as 0.50, not 0.5
        }

        // For values like 0.01998, 0.00123456 etc., show them completely
        return trimmed;
      }

      // For numbers 1 and above, ensure at least 2 decimal places
      let formatted = fixed.replace(/0+$/, ''); // Remove trailing zeros first
      
      // Ensure at least 2 decimal places
      const parts = formatted.split('.');
      if (parts.length === 1) {
        parts.push('00'); // No decimal part, add .00
      } else if (parts[1].length === 0) {
        parts[1] = '00'; // Empty decimal part
      } else if (parts[1].length === 1) {
        parts[1] = parts[1] + '0'; // Only 1 decimal digit, add 0
      }
      formatted = parts.join('.');
      
      // Add thousand separators for numbers >= 1000
      if (num >= 1000) {
        const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return intPart + '.' + parts[1];
      }
      
      return formatted;
    }










  

  // Update user's coin balance
  function updateUserCoins(coins) {
    const isBalanceHidden = localStorage.getItem('balanceHidden') === 'true';
    if (!isBalanceHidden) {
      const coinElements = document.querySelectorAll('#user-coins, #profile-coins');
      coinElements.forEach(element => {
        element.textContent = formatCoins(coins);
      });
    }
  }
  

  
  

  // Show privacy policy modal for new users
  function showPrivacyPolicyModal(user, referralCode) {
    // Create modal container
    const modalContainer = document.createElement('div');
    modalContainer.className = 'privacy-policy-modal';

    // Ensure modal appears on top of everything
    modalContainer.style.position = 'fixed';
    modalContainer.style.zIndex = '9999';
    modalContainer.style.top = '0';
    modalContainer.style.left = '0';
    modalContainer.style.width = '100%';
    modalContainer.style.height = '100%';
    modalContainer.style.backgroundColor = 'rgba(0,0,0,0.7)';
    modalContainer.style.display = 'flex';
    modalContainer.style.justifyContent = 'center';
    modalContainer.style.alignItems = 'center';

    // Check if dark mode is active
    const isDarkMode = document.documentElement.classList.contains('dark-theme');

    // Set theme-aware colors
    const bgColor = isDarkMode ? 'var(--card-background, #2a2a2a)' : 'white';
    const textColor = isDarkMode ? 'var(--text-color, #f5f5f5)' : '#333';
    const lightTextColor = isDarkMode ? 'var(--light-text, #aaaaaa)' : '#777';
    const borderColor = isDarkMode ? 'var(--border-color, #3a3a3a)' : '#e1e4e8';
    const shadowColor = isDarkMode ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)';

    // Create modal content with theme-aware styles
    const isArabic = translator.getCurrentLanguage() === 'ar';
    modalContainer.innerHTML = `
      <div class="privacy-policy-content" style="width: 90%; max-width: 600px; max-height: 80vh; overflow-y: auto; background-color: ${bgColor}; color: ${textColor}; border-radius: 8px; padding: 20px; box-shadow: 0 4px 10px ${shadowColor}; border: 1px solid ${borderColor}; direction: ${isArabic ? 'rtl' : 'ltr'}; text-align: ${isArabic ? 'right' : 'left'};">
        <h2 style="text-align: center; margin-bottom:20px; color: ${textColor};" data-translate-key="Privacy Policy & Terms of Service">${translator.translate('Privacy Policy & Terms of Service')}</h2>
        <div class="privacy-policy-text" style="margin-bottom: 20px;">
          <h3 style="color: #4CAF50;" data-translate-key="1. Introduction">${translator.translate('1. Introduction')}</h3>
          <p style="color: ${textColor};" data-translate-key="Welcome to AccessoireDigital. Before proceeding, please review and accept our Privacy Policy and Terms of Service.">${translator.translate('Welcome to AccessoireDigital. Before proceeding, please review and accept our Privacy Policy and Terms of Service.')}</p>

          <h3 style="color: #4CAF50;" data-translate-key="2. Platform Services">${translator.translate('2. Platform Services')}</h3>
          <p style="color: ${textColor};" data-translate-key="AccessoireDigital is a comprehensive digital assets platform offering cloud processing services, digital account management, and secure transaction processing. Users can earn Points through our 24-hour processing cycles and participate in our referral program.">${translator.translate('AccessoireDigital is a comprehensive digital assets platform offering cloud processing services, digital account management, and secure transaction processing. Users can earn Points through our 24-hour processing cycles and participate in our referral program.')}</p>


          <h3 style="color: #4CAF50;" data-translate-key="3. Platform Purpose">${translator.translate('3. Platform Purpose')}</h3>
          <p style="color: ${textColor};" data-translate-key="Access-Network is a digital engagement platform that rewards active participation through a secure distributed point system. Points are earned through daily activities, referrals, and community interaction. These digital assets can be transferred between users and stored in personal wallets for future use within the ecosystem.">${translator.translate('Access-Network is a digital engagement platform that rewards active participation through a secure distributed point system. Points are earned through daily activities, referrals, and community interaction. These digital assets can be transferred between users and stored in personal wallets for future use within the ecosystem.')}</p>

          

          <h3 style="color: #4CAF50;" data-translate-key="4. Account & Transaction System">${translator.translate('4. Account & Transaction System')}</h3>
          <p style="color: ${textColor};" data-translate-key="Each user receives a unique digital account address for sending and receiving Points. All transactions are recorded on our secure digital network with full transparency and immutable transaction history.">${translator.translate('Each user receives a unique digital account address for sending and receiving Points. All transactions are recorded on our secure digital network with full transparency and immutable transaction history.')}</p>

        

          <h3 style="color: #4CAF50;" data-translate-key="5. Processing & Rewards System">${translator.translate('5. Processing & Rewards System')}</h3>
          <p style="color: ${textColor};" data-translate-key="Users can participate in cloud processing to earn Points every 24 hours. Processing rewards are distributed based on activity and referral bonuses. All earnings are automatically credited to your account balance upon completion of processing cycles.">${translator.translate('Users can participate in cloud processing to earn Points every 24 hours. Processing rewards are distributed based on activity and referral bonuses. All earnings are automatically credited to your account balance upon completion of processing cycles.')}</p>

          <h3 style="color: #4CAF50;" data-translate-key="6. Referral Program">${translator.translate('6. Referral Program')}</h3>
          <p style="color: ${textColor};" data-translate-key="Users can invite others using their unique referral code. Successful referrals earn bonuses for both the referrer and new user. All referral rewards are processed automatically and added to account balances.">${translator.translate('Users can invite others using their unique referral code. Successful referrals earn bonuses for both the referrer and new user. All referral rewards are processed automatically and added to account balances.')}</p>

          <h3 style="color: #4CAF50;" data-translate-key="7. Transaction Fees & Policies">${translator.translate('7. Transaction Fees & Policies')}</h3>
          <p style="color: ${textColor};" data-translate-key="All transactions include a minimal network fee of 0.00002 Points to maintain network security. Minimum transaction amounts and daily limits may apply to ensure system stability and security.">${translator.translate('All transactions include a minimal network fee of 0.00002 Points to maintain network security. Minimum transaction amounts and daily limits may apply to ensure system stability and security.')}</p>

          <h3 style="color: #4CAF50;" data-translate-key="8. Data Collection & Security">${translator.translate('8. Data Collection & Security')}</h3>
          <p style="color: ${textColor};" data-translate-key="We collect essential information including your Google account details (name, email, profile picture) for authentication purposes only. YOUR DATA IS COMPLETELY PRIVATE: We do NOT share, sell, or distribute your personal information to any third parties under any circumstances. All user data and private keys are encrypted using industry-standard AES-256 security protocols and stored securely in our protected databases. Your information is used exclusively for platform functionality and your account security.">${translator.translate('We collect essential information including your Google account details (name, email, profile picture) for authentication purposes only. YOUR DATA IS COMPLETELY PRIVATE: We do NOT share, sell, or distribute your personal information to any third parties under any circumstances. All user data and private keys are encrypted using industry-standard AES-256 security protocols and stored securely in our protected databases. Your information is used exclusively for platform functionality and your account security.')}</p>

          <h3 style="color: #4CAF50;" data-translate-key="9. Privacy & Data Usage">${translator.translate('9. Privacy & Data Usage')}</h3>
          <p style="color: ${textColor};" data-translate-key="Your personal information is used solely for platform functionality, security, and user experience enhancement. We do not share your data with third parties without explicit consent, except as required by applicable laws.">${translator.translate('Your personal information is used solely for platform functionality, security, and user experience enhancement. We do not share your data with third parties without explicit consent, except as required by applicable laws.')}</p>

          <h3 style="color: #4CAF50;" data-translate-key="10. User Responsibilities">${translator.translate('10. User Responsibilities')}</h3>
          <p style="color: ${textColor};" data-translate-key="Users are responsible for securing their account credentials and private keys. AccessoireDigital is not liable for losses due to user negligence, unauthorized access, or failure to follow security guidelines.">${translator.translate('Users are responsible for securing their account credentials and private keys. AccessoireDigital is not liable for losses due to user negligence, unauthorized access, or failure to follow security guidelines.')}</p>

          <h3 style="color: #4CAF50;" data-translate-key="11. Account Deletion & Data Removal">${translator.translate('11. Account Deletion & Data Removal')}</h3>
          <p style="color: ${textColor};" data-translate-key="Users have the right to permanently delete their account at any time through the profile settings. When you delete your account: (1) All personal data including email, name, and profile information will be permanently removed. (2) All your Points balance will be lost forever and cannot be recovered. (3) Your referral code and all referral relationships will be permanently deleted. (4) All transaction history and activity records will be completely erased. (5) Your wallet and private keys will be permanently deleted. (6) This action is IRREVERSIBLE and CANNOT be undone. Once your account is deleted, there is no way to restore your data, Points, or any information associated with your account. We do not retain any backup copies of deleted accounts.">${translator.translate('Users have the right to permanently delete their account at any time through the profile settings. When you delete your account: (1) All personal data including email, name, and profile information will be permanently removed. (2) All your Points balance will be lost forever and cannot be recovered. (3) Your referral code and all referral relationships will be permanently deleted. (4) All transaction history and activity records will be completely erased. (5) Your wallet and private keys will be permanently deleted. (6) This action is IRREVERSIBLE and CANNOT be undone. Once your account is deleted, there is no way to restore your data, Points, or any information associated with your account. We do not retain any backup copies of deleted accounts.')}</p>

          <h3 style="color: #4CAF50;" data-translate-key="12. Platform Modifications">${translator.translate('12. Platform Modifications')}</h3>
          <p style="color: ${textColor};" data-translate-key="We reserve the right to modify platform features, terms, or policies with reasonable notice to users. Continued use of the platform constitutes acceptance of any updates to these terms.">${translator.translate('We reserve the right to modify platform features, terms, or policies with reasonable notice to users. Continued use of the platform constitutes acceptance of any updates to these terms.')}</p>

         <h3 style="color: #4CAF50;" data-translate-key="Note:">
  ${translator.translate('Note:')}
</h3>
<p style="color: ${textColor};" data-translate-key="Points are platform-specific digital rewards and are not intended as financial instruments or investments.">
  ${translator.translate('Points are platform-specific digital rewards and are not intended as financial instruments or investments.')}
</p>

<p style="color: ${textColor}; margin-top: 20px; direction: ${translator.getCurrentLanguage() === 'ar' ? 'rtl' : 'ltr'};">
  <strong data-translate-key="Contact Email:">${translator.translate('Contact Email:')}</strong> 
  <a href="mailto:support@accesschain.org" style="color: #2196F3; text-decoration: none;">support@accesschain.org</a>
</p>
</div>

        <div class="privacy-policy-actions" style="display: flex; flex-direction: column; gap: 15px; border-top: 1px solid ${borderColor}; padding-top: 15px;">
          <div class="privacy-checkbox" style="display: flex; align-items: center; gap: 10px;">
            <input type="checkbox" id="privacy-accept" required style="width: 18px; height: 18px;">
            <label for="privacy-accept" style="font-weight: bold; color: ${textColor};" data-translate-key="I have read and accept the Privacy Policy and Terms of Service">${translator.translate('I have read and accept the Privacy Policy and Terms of Service')}</label>
          </div>
          <div class="privacy-buttons" style="display: flex; justify-content: space-between; gap: 10px;">
            <button id="decline-privacy" class="decline-btn" style="flex: 1; padding: 12px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;" data-translate-key="Decline">${translator.translate('Decline')}</button>
            <button id="accept-privacy" class="accept-btn" disabled style="flex: 1; padding: 12px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; opacity: 0.6;" data-translate-key="Accept & Continue">${translator.translate('Accept & Continue')}</button>
          </div>
        </div>
      </div>
    `;

    // Add to DOM
    document.body.appendChild(modalContainer);

    // Add event listeners
    const checkbox = document.getElementById('privacy-accept');
    const acceptButton = document.getElementById('accept-privacy');
    const declineButton = document.getElementById('decline-privacy');

    //    // Toggle accept button based on checkbox
    checkbox.addEventListener('change', function() {
      acceptButton.disabled = !this.checked;
      acceptButton.style.opacity = this.checked ? '1' : '0.6';
    });

    // Accept button action
    acceptButton.addEventListener('click', function() {
      // Close modal
      modalContainer.remove();

      // Set flag that user accepted privacy policy
      currentUser.acceptedPrivacyPolicy = true;

      // Continue with login
      continueWithLogin(user, referralCode);
    });

    // Decline button action
    declineButton.addEventListener('click', function() {
      // Close modal
      modalContainer.remove();

      // Sign out user
      signOut(firebaseAuth).then(() => {
        // Show message that privacy policy must be accepted
        const errorMsg = document.getElementById('login-error');
        if (errorMsg) {
          errorMsg.textContent = 'You must accept the Privacy Policy to use AccessoireDigital.';
          errorMsg.style.display = 'block';
        }
      });
    });
  }

  
  // Continue with login process after privacy policy acceptance
  function continueWithLogin(user, referralCode) {
    console.log('🔐 continueWithLogin called for:', user.email, 'with referral code:', referralCode);
    // Use class-based system for auth state - NO direct style manipulation
    document.documentElement.classList.remove('user-not-logged-in');
    document.documentElement.classList.add('user-logged-in');
    document.documentElement.classList.add('auth-ready');
    // ⚡ CRITICAL: Add app-ready immediately to show the app interface
    document.documentElement.classList.add('app-ready');
    document.body.classList.add('app-ready');

    // 📲 إظهار install prompt فوراً بعد قبول الشروط والدخول
    setTimeout(() => {
      if (typeof showInstallButton === 'function') {
        showInstallButton(true); // true = إظهار فوري
      }
    }, 2000); // انتظر 2 ثواني ثم أظهر فوراً

    // Force the user object to request a fresh update
    user._forceUpdate = true;

    // Show basic user info right away
    updateUserInfo(user);

    // Save minimal user session in local storage
    saveUserSession(user);

    // Load user data from the server
    loadUserData(user.email).then(() => {
      // After fresh data is loaded, update UI again if needed
      updateUserInfo(currentUser);

      // Connect to WebSocket for presence tracking
      if (currentUser.id) {
        // 🌐 Sync detected device language to database for notifications
        const detectedLang = localStorage.getItem('preferredLanguage');
        if (detectedLang) {
          saveLanguageToDatabase(detectedLang);
        }
        
        connectPresenceWebSocket(currentUser.id);
        // Load processing history when restoring session
        addProcessingHistoryEntry();
        
        // ⚡ PRELOAD: تحميل بيانات صفحة Activity مسبقاً
        preloadActivityData(currentUser.id);
        
        // 🔔 طلب إذن الإشعارات للتطبيق (TWA/PWA) - نافذة النظام العادية
        if ('Notification' in window) {
          if (Notification.permission === 'default') {
            requestNotificationPermission(currentUser.id);
          } else if (Notification.permission === 'granted') {
            // الإذن موجود مسبقاً، نسجل الـ subscription فقط
            registerPushNotifications(currentUser.id);
          }
        }
      }

      // Process login with DB integration
      console.log('About to call processLogin with referralCode:', referralCode);
      processLogin(user, referralCode);
    }).catch(error => {
      console.error('Error during login data loading:', error);
      // Still process login even if there was an error
      console.log('⚠️ Loading failed, but calling processLogin anyway with referral code:', referralCode);
      processLogin(user, referralCode);
    });
  }

 // Process login with database integration
        // Shows welcome message with bonus if user registered with referral
  function processLogin(user, referralCode) {
    console.log('Processing login for:', user.email, user.name, 'with referralCode:', referralCode);

    // ✅ OPTIMIZED: If currentUser already has ID from loadUserData, skip duplicate check
    if (currentUser && currentUser.id) {
      console.log('✅ User already has ID from loadUserData:', currentUser.id);
      updateUserCoins(currentUser.coins || 0);
      updateReferralCode(currentUser.referralCode);
      loadUserReferrals(currentUser.id);
      return;
    }

    // First check if user exists in the database
    checkIfUserExists(user.email).then(async (existingUser) => {
      if (existingUser) {
        console.log('User exists, loading data:', existingUser);
        // User exists, update UI with their data
        updateUserCoins(existingUser.coins || 0);
        updateReferralCode(existingUser.referralCode);
        currentUser = {...currentUser, ...existingUser};

        // Also load their referrals
        loadUserReferrals(existingUser.id);
      } else {
        console.log('Creating new user with referralCode:', referralCode);
        
        // ⚠️ SERVER CREATES REFERRAL CODE - Don't send from client
        // ✅ FIX: Wait for user creation and update currentUser.id
        try {
          const responseData = await createUser(user, null, referralCode);
          if (responseData && responseData.user) {
            console.log('✅ Create user completed in processLogin, ID:', responseData.user.id);
            currentUser = {...currentUser, ...responseData.user, id: responseData.user.id};
            saveUserSession(currentUser);
          }
        } catch (err) {
          console.error('❌ Error creating user:', err);
        }
      }
    }).catch(error => {
      console.error('Error during user check:', error);
      // Use fallback if server fails
      useFallbackUserData();
    });
  }

  // Check if user exists in the database
  // ⚡ OPTIMIZED: Cache user data to avoid repeated API calls
  const userDataCache = {
    data: null,
    email: null,
    timestamp: 0,
    TTL: 10000 // 10 seconds cache
  };

 async function checkIfUserExists(email, forceRefresh = false) {
  // ⚡ Return cached data if available and not expired
  const now = Date.now();
  if (!forceRefresh && userDataCache.email === email && userDataCache.data && (now - userDataCache.timestamp) < userDataCache.TTL) {
    console.log('⚡ Using cached user data for:', email);
    return userDataCache.data;
  }

  try {
    const apiUrl = `${window.location.origin}/api/user/${encodeURIComponent(email)}`;
    console.log('Checking if user exists at:', apiUrl);

    const response = await fetch(apiUrl);

    // Handle 404 as "user not found" rather than an error
    if (response.status === 404) {
      console.log('User not found in database (404)');
      return null;
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const text = await response.text();
    let userData;

    try {
      userData = JSON.parse(text);
    } catch (parseError) {
      console.error('Error parsing JSON response:', parseError, 'Raw response:', text);
      throw new Error('Invalid JSON response');
    }

    // Check if the response indicates success
    if (!userData.success || !userData.user) {
      console.log('User not found in database response');
      return null;
    }

    // ⚡ AUTO-CREATE WALLET in background (non-blocking) if missing for existing users
    if (!userData.user.wallet_address && userData.user.id) {
      console.log('⚠️ User has no wallet_address, requesting auto-generation in background...');
      // تشغيل في الخلفية بدون انتظار
      fetch(`/api/wallet/auto-create/${userData.user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userData.user.email })
      }).then(walletResponse => {
        if (walletResponse.ok) {
          return walletResponse.json();
        }
      }).then(walletData => {
        if (walletData && walletData.success && walletData.wallet_address) {
          // تحديث currentUser في الخلفية
          if (currentUser && currentUser.id === userData.user.id) {
            currentUser.wallet_address = walletData.wallet_address;
            saveUserSession(currentUser);
          }
          console.log('✅ Auto-created wallet in background:', walletData.wallet_address);
        }
      }).catch(walletError => {
        console.warn('Could not auto-create wallet:', walletError);
      });
    }

    // Create a copy without the private key
    const { wallet_private_key, ...safeUser } = userData.user;
    console.log('User data received (safe):', { ...userData, user: safeUser });

    // ⚡ Cache the result
    userDataCache.data = userData.user;
    userDataCache.email = email;
    userDataCache.timestamp = Date.now();

    return userData.user;
  } catch (error) {
    console.error('Error checking user:', error);
    return null;
  }
}

//

 // Create a new user in the database
  async function createUser(user, newReferralCode, referrerCode) {
    try {
      console.log('🚀 createUser called with referrerCode:', referrerCode);
      
      // ⚠️ لا نرسل referralCode - السيرفر ينشئه
      const userData = {
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        coins: 0,
        processingActive: false,
        referrerCode: referrerCode,
        privacyAccepted: user.acceptedPrivacyPolicy || false,
        language: localStorage.getItem('preferredLanguage') || 'en'
      };

      console.log('📦 User data being sent to server:', userData);

      // Send the create request
      const response = await fetch(`${window.location.origin}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
      });

      // Check response status
      if (!response.ok) {
        // Try to get error message from response
        const errorText = await response.text();
        console.error('Server returned error:', errorText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Carefully parse the response
      const responseText = await response.text();
      let responseData;

      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Error parsing server response:', parseError, 'Raw response:', responseText);
        throw new Error('Invalid JSON response from server');
      }

      // Make sure we have a user object
      if (!responseData || !responseData.user) {
        console.error('Server returned unexpected response format:', responseData);
        throw new Error('Invalid response format');
      }

      // ✅ استخدم الرمز الصحيح من السيرفر فوراً
      const serverReferralCode = responseData.user.referral_code;
      console.log('✅ Server created referral code:', serverReferralCode);
      
      updateUserCoins(responseData.user.coins || 0);
      updateReferralCode(serverReferralCode);

      // Save complete user data
      const updatedUser = {
        ...currentUser,
        ...responseData.user,
        id: responseData.user.id,
        referralCode: serverReferralCode
      };

      // Update current user globally
      currentUser = updatedUser;

      // Also update user session storage for persistence
      saveUserSession(updatedUser);

      console.log('User created successfully:', responseData.user);
      console.log('Bonus message from server:', responseData.bonusMessage);
      
      // عرض إشعار المكافأة مع أيقونة الهدية
      if (responseData.bonusMessage) {
        console.log('🎁 SHOWING BONUS NOTIFICATION!');
        
        const notification = document.createElement('div');
        notification.className = 'notification success';
        
        // ترجمة رسالة البونص باستخدام translator
        const translatedMessage = translator.translate(responseData.bonusMessage);
        
        // Secure: Build notification with safe DOM methods
        const notifContent = document.createElement('div');
        notifContent.className = 'notification-content';
        
        const giftIcon = document.createElement('i');
        giftIcon.className = 'fas fa-gift';
        giftIcon.style.color = 'inherit';
        giftIcon.style.setProperty('color', 'inherit', 'important');
        
        const messagePara = document.createElement('p');
        messagePara.textContent = translatedMessage;
        
        const closeBtnBonus = document.createElement('span');
        closeBtnBonus.className = 'close-btn';
        const closeIconBonus = document.createElement('i');
        closeIconBonus.className = 'fas fa-times';
        closeBtnBonus.appendChild(closeIconBonus);
        
        notifContent.appendChild(giftIcon);
        notifContent.appendChild(messagePara);
        notifContent.appendChild(closeBtnBonus);
        notification.appendChild(notifContent);
        document.body.appendChild(notification);

        setTimeout(() => {
          notification.classList.add('show');
        }, 100);

        const closeBonusBtn = notification.querySelector('.close-btn');
        closeBonusBtn.addEventListener('click', () => {
          notification.classList.remove('show');
          setTimeout(() => {
            notification.remove();
          }, 300);
        });

        setTimeout(() => {
          notification.classList.remove('show');
          setTimeout(() => {
            notification.remove();
          }, 300);
        }, 5000);
      }
      
      return responseData;
    } catch (error) {
      console.error('Error during user creation:', error);
      // Use fallback data if server fails
      useFallbackUserData();
      return null;
    }
  }
  // Load user referrals from database
  async function loadUserReferrals(userId) {
    try {
      const response = await fetch(`${window.location.origin}/api/referrals/${userId}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const referralsData = await response.json();

      // Update the referrals list in the UI
      updateReferralsList(referralsData.referrals);
    } catch (error) {
      console.error('Referrals loading error:', error);
      // Show empty referrals list or a message
      showEmptyReferralsList();
    }
  }

  // Update the UI with referrals data
  // Function to specifically update the "No referrals yet" message with current language
  function updateNoReferralsMessage() {
    const noReferralsMessage = document.querySelector('.empty-referrals p[data-translate="No referrals yet"]');
    if (noReferralsMessage) {
      noReferralsMessage.textContent = translator.translate('No referrals yet');
    }
  }
  
  // Observer to detect when the empty referrals message appears in the DOM
  function observeReferralsChanges() {
    const referralsList = document.getElementById('referrals-list');
    if (!referralsList) return;
    
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Check if empty referrals message was added
          const noRefMsg = referralsList.querySelector('.empty-referrals p[data-translate="No referrals yet"]');
          if (noRefMsg) {
            updateNoReferralsMessage();
          }
        }
      });
    });
    
    observer.observe(referralsList, { childList: true, subtree: true });
  }


  function updateReferralsList(referrals) {
    try {
      const referralsList = document.getElementById('referrals-list');
      if (!referralsList) {
        console.error('Referrals list element not found');
        return;
      }

      // Clear existing list
      referralsList.innerHTML = '';

      // Calculate total referral earnings (0.15 coins per referral)
      const referralBonus = 0.15;
      let totalReferralEarnings = 0;

      if (referrals && Array.isArray(referrals) && referrals.length > 0) {
        // Calculate total earnings
        totalReferralEarnings = referrals.length * referralBonus;

        // Update the referral earnings display
        const referralEarningsElement = document.querySelector('.bonus-value');
        if (referralEarningsElement) {
          referralEarningsElement.textContent = formatNumberSmart(totalReferralEarnings);
        }

        console.log('Displaying referrals:', referrals);
        referrals.forEach(referral => {
          const item = document.createElement('li');

          // Mask email for privacy (show only first 3 characters)
          const maskedEmail = maskEmail(referral.email);

          // Enhanced logging with more explicit type checking
          console.log(`CLIENT: Processing referral ${referral.name} with processing status:`, 
                     `processing_active=${referral.processing_active} (${typeof referral.processing_active})`, 
                     `processingactive=${referral.processingactive} (${typeof referral.processingactive})`,
                     `is_active=${referral.is_active} (${typeof referral.is_active})`);

          // Use strict numerical comparison - convert all status values to numbers
          const processing_active_num = parseInt(referral.processing_active) || 0;
          const processingactive_num = parseInt(referral.processingactive) || 0;
          const is_active_num = parseInt(referral.is_active) || 0;

          console.log(`Numeric values (after parseInt): processing_active=${processing_active_num}, processingactive=${processingactive_num}, is_active=${is_active_num}`);

          // Determine active status primarily based on the is_active flag from WebSocket tracking
          // This is the most reliable indicator since it tracks real-time presence
          let isActive = is_active_num === 1;

          // Fallback to processing status checks if is_active is 0 but processing is active
          const serverTimeDiff = currentUser.server_time_diff || 0;
          const now = Date.now() + serverTimeDiff; // Use server time for more accurate checks

          const endTime = parseInt(referral.processing_end_time) || 0;
          const startTime = parseInt(referral.processing_start_time) || 0;

          // Processing session is valid if times are valid and processing is in progress
          const timeValid = endTime > 0 && startTime > 0 && endTime > now && startTime <= now;

          // If WebSocket shows offline but processing is active and within time window, consider active
          if (!isActive && (processing_active_num === 1 || processingactive_num === 1) && timeValid) {
            isActive = true;
            console.log(`${referral.name} has active processing session but inactive WebSocket - marking as active`);
          }

          // Always respect end time - if processing session has ended, user must be inactive
          if (endTime > 0 && endTime <= now) {
            isActive = false;
            console.log(`${referral.name} session has ended (end_time=${endTime}, now=${now}) - marking as inactive`);
          }

          // Style based on status
          const statusColor = isActive ? '#4CAF50' : '#F44336';
          // Use simple Online/Offline text instead of translation keys
          const statusText = isActive ? 'Online' : 'Offline';

          // Log final decision 
          console.log(`Final status for ${referral.name}: isActive=${isActive}, statusText=${statusText}`);

          const defaultAvatar = '';
          item.innerHTML = `
            <div class="referral-user">
              <img src="${referral.avatar || defaultAvatar}" alt="User" class="referral-avatar" onerror="this.onerror=null;">
              <div class="referral-user-info">
                <div class="referral-name">${referral.name}</div>
                <div class="referral-email">${maskedEmail}</div>
              </div>
            </div>
            <div class="referral-info">
              <div class="referral-date">${formatDate(referral.date)}</div>
              <div class="referral-status">
                <span class="status-indicator" style="background-color: ${statusColor};"></span>
                <span class="activity-status-text">${statusText}</span>
              </div>
            </div>
          `;

          referralsList.appendChild(item);
        });
      } else {
        console.log('No referrals found, showing empty state');
        showEmptyReferralsList();

        // Reset referral earnings to 0 if no referrals
        const referralEarningsElement = document.querySelector('.bonus-value');
        if (referralEarningsElement) {
          referralEarningsElement.textContent = '0';
        }
      }
    } catch (error) {
      console.error('Error updating referrals list:', error);
      showEmptyReferralsList();
    }
  }

  // Mask email for privacy
  function maskEmail(email) {
    if (!email) return '';

    const parts = email.split('@');
    if (parts.length !== 2) return email;

    const name = parts[0];
    const domain = parts[1];

    // Show first 3 characters, then mask the rest
    const maskedName = name.length <= 3 
      ? name 
      : name.substring(0, 3) + '***';

    return `${maskedName}@${domain}`;
  }

  // Format date for display
  function formatDate(dateStr) {
    if (!dateStr) return 'Invalid Date';
    try {
      // Handle numeric timestamp
      if (!isNaN(dateStr)) {
        dateStr = new Date(Number(dateStr)).toISOString();
      }
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return 'Invalid Date';
      
      // Force English date format regardless of device language
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString();
      const day = date.getDate().toString();
      
      return `${day}/${month}/${year}`;
    } catch (e) {
      return 'Invalid Date';
    }
  }

  // Show empty referrals list message
  function showEmptyReferralsList() {
    const referralsList = document.getElementById('referrals-list');

    if (!referralsList) return;

    referralsList.innerHTML = `
      <li class="empty-referrals">
        <div class="empty-message">
          <i class="fas fa-users"></i>
          <p data-translate="No referrals yet">No referrals yet</p>
        </div>
      </li>
    `;
    
    // Immediately translate the message to the current language
    updateNoReferralsMessage();
  }








// Profile Menu Functions (Three Dots Menu)
function toggleProfileMenu() {
  const menu = document.getElementById('profile-dropdown-menu');
  if (menu) {
    menu.classList.toggle('show');
  }
}

function editProfile() {
  // Close the menu first
  const menu = document.getElementById('profile-dropdown-menu');
  if (menu) {
    menu.classList.remove('show');
  }

  // Enter edit mode for profile name
  const profileNameInput = document.getElementById('profile-name-input');
  const profileNameDisplay = document.getElementById('profile-name');
  const editButtonsContainer = document.querySelector('.profile-edit-buttons');
  const memberSinceElement = document.getElementById('profile-member-since');

  if (profileNameInput && profileNameDisplay && editButtonsContainer) {
    profileNameInput.classList.add('active');
    profileNameDisplay.classList.add('hidden');
    profileNameInput.value = profileNameDisplay.textContent.replace('User', '').trim();
    profileNameInput.focus();
    editButtonsContainer.style.display = 'flex';

    // ط¥ط®ظپط§ط، طھط§ط±ظٹط® ط§ظ„ط¹ط¶ظˆظٹط© ط¹ظ†ط¯ ط¨ط¯ط، طھط¹ط¯ظٹظ„ ط§ظ„ط§ط³ظ… ظ…ظ† ط§ظ„ظ‚ط§ط¦ظ…ط©
    if (memberSinceElement) {
      memberSinceElement.style.display = 'none';
      memberSinceElement.style.visibility = 'hidden';
      memberSinceElement.style.opacity = '0';
    }

    // Add editing class to profile container like in enterEditMode
    const profileContainer = document.querySelector('.profile-name-container');
    if (profileContainer) {
      profileContainer.classList.add('editing');
    }

    // Hide user name label during editing
    const userNameLabel = document.getElementById('user-name-label');
    if (userNameLabel) {
      userNameLabel.classList.add('hidden-during-edit');
    }
  }
}

// Close menu when clicking outside
document.addEventListener('click', function(event) {
  const menuContainer = document.querySelector('.profile-menu-container');
  const menu = document.getElementById('profile-dropdown-menu');

  if (menuContainer && menu && !menuContainer.contains(event.target)) {
    menu.classList.remove('show');
  }
});

// Functions to save and cancel profile changes
function saveProfileChanges() {
  const profileNameInput = document.getElementById('profile-name-input');
  const profileNameDisplay = document.getElementById('profile-name');
  const editButtonsContainer = document.querySelector('.profile-edit-buttons');
  const memberSinceElement = document.getElementById('profile-member-since');

  if (profileNameInput && profileNameDisplay) {
    // Save the name
    const newName = profileNameInput.value.trim();
    if (newName) {
      profileNameDisplay.textContent = 'User ' + newName;
    }

    // Reset UI
    profileNameInput.classList.remove('active');
    profileNameDisplay.classList.remove('hidden');
    
    if (editButtonsContainer) {
      editButtonsContainer.style.display = 'none';
    }

    // Show member since date when saving
    if (memberSinceElement) {
      memberSinceElement.style.display = 'block';
      memberSinceElement.style.visibility = 'visible';
      memberSinceElement.style.opacity = '1';
    }

    // Remove editing class
    const profileContainer = document.querySelector('.profile-name-container');
    if (profileContainer) {
      profileContainer.classList.remove('editing');
    }

    // Show user name label
    const userNameLabel = document.getElementById('user-name-label');
    if (userNameLabel) {
      userNameLabel.classList.remove('hidden-during-edit');
    }
  }
}

function cancelProfileChanges() {
  const profileNameInput = document.getElementById('profile-name-input');
  const profileNameDisplay = document.getElementById('profile-name');
  const editButtonsContainer = document.querySelector('.profile-edit-buttons');
  const memberSinceElement = document.getElementById('profile-member-since');

  if (profileNameInput && profileNameDisplay) {
    // Reset UI without saving
    profileNameInput.classList.remove('active');
    profileNameDisplay.classList.remove('hidden');
    
    if (editButtonsContainer) {
      editButtonsContainer.style.display = 'none';
    }

    // Show member since date when canceling
    if (memberSinceElement) {
      memberSinceElement.style.display = 'block';
      memberSinceElement.style.visibility = 'visible';
      memberSinceElement.style.opacity = '1';
    }

    // Remove editing class
    const profileContainer = document.querySelector('.profile-name-container');
    if (profileContainer) {
      profileContainer.classList.remove('editing');
    }

    // Show user name label
    const userNameLabel = document.getElementById('user-name-label');
    if (userNameLabel) {
      userNameLabel.classList.remove('hidden-during-edit');
    }
  }
}

// Make functions globally available
window.toggleProfileMenu = toggleProfileMenu;
window.editProfile = editProfile;
window.saveProfileChanges = saveProfileChanges;
window.cancelProfileChanges = cancelProfileChanges;


  // Global profile editing manager
  let profileEditingInitialized = false;

  // Initialize profile editing functionality
   function initializeProfileEditing() {
     // Prevent multiple initializations
     if (profileEditingInitialized) {
       return;
     }
     profileEditingInitialized = true;
     const avatarContainer = document.getElementById('avatar-container');
     const profileImageUpload = document.getElementById('profile-image-upload');
     const profileNameInput = document.getElementById('profile-name-input');
     const profileNameDisplay = document.getElementById('profile-name');
     const editIcon = document.querySelector('.edit-icon'); // This line will still query for the icon, but it's added dynamically later.
     const saveChangesBtn = document.getElementById('save-profile-changes');
     const cancelChangesBtn = document.getElementById('cancel-profile-changes');
     const editButtonsContainer = document.querySelector('.profile-edit-buttons');

     let hasChanges = false;
     let newProfileImage = null;
     let isEditing = false;

     // Function to enter edit mode
     function enterEditMode() {
       isEditing = true;
       profileNameInput.classList.add('active');
       profileNameDisplay.classList.add('hidden');
       profileNameInput.value = profileNameDisplay.textContent.replace('User', '').trim();
       profileNameInput.focus();
       showEditButtons();

       // Hide member since date during editing
       const memberSinceElement = document.getElementById('profile-member-since');
       if (memberSinceElement) {
         memberSinceElement.style.display = 'none';
       }
     }

     // Function to cancel edit mode
     function cancelEditMode() {
       isEditing = false;
       hasChanges = false;
       newProfileImage = null;
       profileNameInput.classList.remove('active');
       profileNameDisplay.classList.remove('hidden');
       hideEditButtons();

       // Show member since date when canceling
       const memberSinceElement = document.getElementById('profile-member-since');
       if (memberSinceElement) {
         memberSinceElement.style.display = 'block';
         memberSinceElement.style.visibility = 'visible';
         memberSinceElement.style.opacity = '1';
       }

       // Reset avatar if it was changed
       if (newProfileImage) {
         const profileAvatar = document.getElementById('profile-avatar');
         if (profileAvatar && currentUser && currentUser.avatar) {
           profileAvatar.src = currentUser.avatar;
         }
         newProfileImage = null;
       }
     }

     // Function to show edit buttons
     function showEditButtons() {
       console.log('Showing edit buttons...');
       if (editButtonsContainer) {
         editButtonsContainer.style.display = 'flex';
         console.log('Edit buttons displayed');
       } else {
         console.log('Edit buttons container not found');
       }
       // Hide user name label during editing
       const userNameLabel = document.getElementById('user-name-label');
       if (userNameLabel) {
         userNameLabel.classList.add('hidden-during-edit');
       }

       // Add editing class to profile container
       const profileContainer = document.querySelector('.profile-name-container');
       if (profileContainer) {
         profileContainer.classList.add('editing');
       }
     }

     // Function to hide edit buttons
     function hideEditButtons() {
       if (editButtonsContainer) {
         editButtonsContainer.style.display = 'none';
       }
       // Show user name label when not editing
       const userNameLabel = document.getElementById('user-name-label');
       if (userNameLabel) {
         userNameLabel.classList.remove('hidden-during-edit');
       }

       // Remove editing class from profile container
       const profileContainer = document.querySelector('.profile-name-container');
       if (profileContainer) {
         profileContainer.classList.remove('editing');
       }
     }

     // Handle cancel button click
     if (cancelChangesBtn) {
       cancelChangesBtn.addEventListener('click', function(e) {
         e.stopPropagation();
         cancelEditMode();
       });
     }

     // Handle click outside to cancel editing
     document.addEventListener('click', function(e) {
       if (isEditing) {
         const profileContainer = document.querySelector('.profile-name-container');
         const isClickInsideProfile = profileContainer && profileContainer.contains(e.target);
         const isClickOnButtons = editButtonsContainer && editButtonsContainer.contains(e.target);
         const isClickOnInput = profileNameInput && profileNameInput.contains(e.target);
         const isClickOnEditIcon = editIcon && editIcon.contains(e.target); // Check if click is on the edit icon itself

         // Cancel if click is outside the profile container or not on buttons/input/edit icon
         if (!isClickInsideProfile || (!isClickOnButtons && !isClickOnInput && !isClickOnEditIcon)) {
           cancelEditMode();
         }
       }
     });

     // Handle input blur - but don't auto-cancel if buttons are visible
     if (profileNameInput) {
       profileNameInput.addEventListener('blur', function(e) {
         // Small delay to allow button clicks to register
         setTimeout(() => {
           if (isEditing && !hasChanges) {
             // Only cancel if no changes and not clicking on buttons or edit icon
             const activeElement = document.activeElement;
             if (activeElement !== saveChangesBtn && activeElement !== cancelChangesBtn && activeElement !== editIcon) {
               cancelEditMode();
             }
           }
         }, 150);
       });
     }

     // Setup photo options menu event listeners
     function setupPhotoOptionsMenu() {
       const cameraOption = document.getElementById('camera-option');
       const galleryOption = document.getElementById('gallery-option');
       const deleteOption = document.getElementById('delete-option');

       if (cameraOption) {
         // ط¥ط²ط§ظ„ط© ط£ظٹ ظ…ط¹ط§ظ„ط¬ط§طھ ط³ط§ط¨ظ‚ط© ظ„ظ…ظ†ط¹ ط§ظ„طھظƒط±ط§ط±
         cameraOption.onclick = null;
         cameraOption.onclick = function(e) {
           e.stopPropagation();
           e.preventDefault();

           console.log('ًں“¸ Camera option clicked');
           const profileImageUpload = document.getElementById('profile-image-upload');

           if (profileImageUpload) {
             // ط¥ط¹ط¯ط§ط¯ ط§ظ„ظƒط§ظ…ظٹط±ط§
             profileImageUpload.setAttribute('capture', 'user');
             profileImageUpload.setAttribute('accept', 'image/*');
             profileImageUpload.click();
             console.log('ًں“¸ Camera opened');
           }
           hidePhotoMenu();
         };
       }

       if (galleryOption) {
         // ط¥ط²ط§ظ„ط© ط£ظٹ ظ…ط¹ط§ظ„ط¬ط§طھ ط³ط§ط¨ظ‚ط© ظ„ظ…ظ†ط¹ ط§ظ„طھظƒط±ط§ط±
         galleryOption.onclick = null;
         galleryOption.onclick = function(e) {
           e.stopPropagation();
           e.preventDefault();

           console.log('Gallery option clicked');
           const profileImageUpload = document.getElementById('profile-image-upload');

           if (profileImageUpload) {
             // ط¥ط¹ط¯ط§ط¯ ط§ظ„ظ…ط¹ط±ط¶
             profileImageUpload.removeAttribute('capture');
             profileImageUpload.setAttribute('accept', 'image/*');
             profileImageUpload.click();
             console.log('Gallery opened');
           }
           hidePhotoMenu();
         };
       }

       if (deleteOption) {
         // مرحبا
         deleteOption.onclick = null;
         deleteOption.onclick = function(e) {
           e.stopPropagation();
           deleteProfilePhoto();
           hidePhotoMenu();
         };
       }
     }

     // Show photo options menu
     function showPhotoMenu() {
       window.showPhotoMenu();
     }

     // Hide photo options menu
     function hidePhotoMenu() {
       window.hidePhotoMenu();
     }

     // Delete profile photo - Fix duplicate message issue
     function deleteProfilePhoto() {
       const profileAvatar = document.getElementById('profile-avatar');
       if (profileAvatar && currentUser) {
         // Check if user already has default avatar - new clean user icon
        const defaultAvatar = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2M2YzZjNiIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMTIiIHI9IjciIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMTAgMzBjMC01IDQtOCAxMC04czEwIDMgMTAgOHYxYzAgMS0xIDItMiAyaC0xNmMtMSAwLTIgLTEtMi0ydi0xeiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==';

         // Check if current avatar is already default or null
         if (!currentUser.avatar || currentUser.avatar === defaultAvatar || currentUser.avatar === null) {
           // Show single message that there's no photo to delete
           if (typeof showNotification === 'function') {
             const message = (typeof translator !== 'undefined' && translator.translate)
               ? translator.translate('No profile photo to delete')
               : 'No profile photo to delete';
             showNotification(message, 'info');
           }
           return; // Stop here - don't show any other messages
         }

         // Update avatar image immediately to default
         profileAvatar.src = defaultAvatar;

         // Update all avatar instances in the page
         const dashboardAvatar = document.getElementById('dashboard-profile-avatar');
         if (dashboardAvatar) {
           dashboardAvatar.src = defaultAvatar;
         }

         // Update user data with default avatar (not null)
         if (currentUser) {
           currentUser.avatar = defaultAvatar;

           // Save the change immediately to server with default avatar - without additional notification
           if (typeof saveProfileChanges === 'function') {
             // Pass true as third parameter to prevent showing "updated successfully" notification
             saveProfileChanges(currentUser.name, defaultAvatar, true);
           }

           // Show single success notification only
           if (typeof showNotification === 'function') {
             const message = (typeof translator !== 'undefined' && translator.translate)
               ? translator.translate('Profile photo changed to default')
               : 'Profile photo changed to default';
             showNotification(message, 'success');
           }
         }
       }
     }

     // Setup avatar container with camera icon and menu
     if (avatarContainer) {
       // Check if camera icon already exists to avoid duplicates
       let cameraIcon = avatarContainer.querySelector('.camera-icon-badge');
       if (!cameraIcon) {
         cameraIcon = document.createElement('div');
         cameraIcon.className = 'camera-icon-badge';
         cameraIcon.innerHTML = '<i class="fas fa-camera"></i>';
         avatarContainer.appendChild(cameraIcon);
       }

       // Setup photo options menu event listeners
       setupPhotoOptionsMenu();

       // Handle click on camera icon specifically to show menu
       function handleCameraClick(e) {
         e.stopPropagation();
         const menu = document.querySelector('.photo-options-menu');

         // Don't trigger if clicking on menu itself
         if (menu && menu.contains(e.target)) {
           return;
         }

         // Always show menu when clicking on camera icon
         if (menu) {
           // Hide menu if already showing
           if (menu.classList.contains('show')) {
             window.hidePhotoMenu();
           } else {
             window.showPhotoMenu();
           }
         }
       }

       // Add click handler ONLY to camera icon
       if (cameraIcon) {
         cameraIcon.addEventListener('click', handleCameraClick);
       }

       // Add click handler to profile avatar image for easy access
       const profileAvatar = avatarContainer.querySelector('.profile-avatar');
       if (profileAvatar) {
         profileAvatar.addEventListener('click', function(e) {
           // Stop propagation to prevent conflicts with other elements
           e.stopPropagation();

           // Only trigger if the click is specifically on the avatar image
           if (e.target === profileAvatar) {
             handleCameraClick(e);
           }
         });
         // Add cursor pointer to indicate it's clickable
         profileAvatar.style.cursor = 'pointer';
       }

       // Hide menu when clicking outside avatar container
       document.addEventListener('click', function(e) {
         if (!avatarContainer.contains(e.target)) {
           hidePhotoMenu();
         }
       });
     }

     // ظ…ط¹ط§ظ„ط¬ ط§ط®طھظٹط§ط± ط§ظ„طµظˆط± - ظ…ط­ط³ظ† ظ„ط¶ظ…ط§ظ† ط§ظ„ط¹ظ…ظ„ ظ…ظ† ط£ظˆظ„ ظ…ط±ط©
     if (profileImageUpload) {
       profileImageUpload.addEventListener('change', function(event) {
         const file = event.target.files[0];
         if (!file) return;

         console.log('ًFile selected:', file.name, file.type, file.size);

         // Check file type
         if (!file.type.startsWith('image/')) {
           if (typeof showNotification === 'function') {
             showNotification(translator.translate('Please select a valid image file'), 'error');
           } else {
             alert('Please select a valid image file');
           }
           event.target.value = '';
           return;
         }

         // Check file size (15MB)
         if (file.size > 15 * 1024 * 1024) {
           if (typeof showNotification === 'function') {
             showNotification('File size is too large. Maximum 15MB allowed', 'error');
           } else {
             alert('File size is too large. Maximum 15MB allowed');
           }
           event.target.value = '';
           return;
         }

         // ظ‚ط±ط§ط،ط© ظˆط¹ط±ط¶ ط§ظ„طµظˆط±ط© ظپظˆط±ط§ظ‹ ظ…ط¹ ظ…ط¹ط§ظ„ط¬ط© ط£ظپط¶ظ„ ظ„ظ„ط£ط®ط·ط§ط،
         const reader = new FileReader();

         reader.onload = function(e) {
           try {
             const imageData = e.target.result;
             console.log('Image loaded successfully, data length:', imageData.length);

             // طھط­ط¯ظٹط« طµظˆط±ط© ط§ظ„ظ…ظ„ظپ ط§ظ„ط´ط®طµظٹ ظپظˆط±ط§ظ‹
             const profileAvatar = document.getElementById('profile-avatar');
             if (profileAvatar) {
               profileAvatar.src = imageData;
               console.log('âœ… Profile avatar updated');
             }

             // طھط­ط¯ظٹط« طµظˆط±ط© ظ„ظˆط­ط© ط§ظ„طھط­ظƒظ…
             const dashboardAvatar = document.getElementById('dashboard-profile-avatar');
             if (dashboardAvatar) {
               dashboardAvatar.src = imageData;
               console.log('Dashboard avatar updated');
             }

             // ط­ظپط¸ ط§ظ„ط¨ظٹط§ظ†ط§طھ ظˆطھظپط¹ظٹظ„ ط§ظ„طھط­ط±ظٹط± ظپظˆط±ط§ظ‹
             newProfileImage = imageData;
             hasChanges = true;
             isEditing = true;

             // ط¥ط¸ظ‡ط§ط± ط£ط²ط±ط§ط± ط§ظ„طھط­ط±ظٹط± ظپظˆط±ط§ظ‹ ط¨ط¯ظˆظ† طھط£ط®ظٹط±
             if (editButtonsContainer) {
               editButtonsContainer.style.display = 'flex';
               console.log('Edit buttons shown');
             }

             // ط¥ط®ظپط§ط، ظ‚ط§ط¦ظ…ط© ط§ظ„طµظˆط±
             const photoMenu = document.querySelector('.photo-options-menu');
             if (photoMenu) {
               photoMenu.classList.remove('show');
               console.log('Photo menu hidden');
             }

             // Success message
             if (typeof showNotification === 'function') {
               showNotification(translator.translate('Image selected successfully - click Save to update'), 'success');
             }

             console.log('Image selection completed successfully');

           } catch (error) {
             console.error('Error processing image:', error);
             if (typeof showNotification === 'function') {
               showNotification('Error processing image', 'error');
             }
           }
         };

         reader.onerror = function(error) {
           console.error('â‌Œ File reading error:', error);
           if (typeof showNotification === 'function') {
             showNotification('Failed to read file', 'error');
           }
         };

         // ط¨ط¯ط، ظ‚ط±ط§ط،ط© ط§ظ„ظ…ظ„ظپ
         reader.readAsDataURL(file);

         // ظ…ط³ط­ ط§ظ„ظ…ط¯ط®ظ„ ظ„ظ„ط³ظ…ط§ط­ ط¨ط§ط®طھظٹط§ط± ظ†ظپط³ ط§ظ„ظ…ظ„ظپ ظ…ط±ط© ط£ط®ط±ظ‰
         setTimeout(() => {
           event.target.value = '';
         }, 100);
       });
     }

     // Handle name input change
     if (profileNameInput) {
       profileNameInput.addEventListener('input', function() {
         hasChanges = true;
         if (!isEditing) {
           isEditing = true;
           showEditButtons();
         }
       });
     }

     // Function to ensure edit buttons are shown when image changes
     function ensureEditButtonsVisible() {
       console.log('Ensuring edit buttons are visible...');
       if (editButtonsContainer) {
         editButtonsContainer.style.display = 'flex';
         console.log('âœ“ Edit buttons made visible');
       }
       const userNameLabel = document.getElementById('user-name-label');
       if (userNameLabel) {
         userNameLabel.classList.add('hidden-during-edit');
       }
       hasChanges = true;
       isEditing = true;
     }

     // Save changes button
     if (saveChangesBtn) {
       saveChangesBtn.addEventListener('click', function(e) {
         e.stopPropagation();
         // Validate name length (maximum 22 characters)
         let sanitizedName = profileNameInput.value.trim();
         if (sanitizedName.length > 15) {
           sanitizedName = sanitizedName.substring(0, 15);
          showNotification(translator.translate('Name truncated to 15 characters'), 'warning');

           profileNameInput.value = sanitizedName;
         }
         saveProfileChanges(sanitizedName, newProfileImage);
       });
     }

     // Function to reset profile edit UI
     function resetProfileEditUI() {
       const profileNameInput = document.getElementById('profile-name-input');
       const profileNameDisplay = document.getElementById('profile-name');

       if (profileNameInput && profileNameDisplay) {
         profileNameInput.classList.remove('active');
         profileNameDisplay.classList.remove('hidden');
       }

       // Show member since date when resetting
       const memberSinceElement = document.getElementById('profile-member-since');
       if (memberSinceElement) {
         memberSinceElement.style.display = 'block';
         memberSinceElement.style.visibility = 'visible';
         memberSinceElement.style.opacity = '1';
       }

       isEditing = false;
       hasChanges = false;
       newProfileImage = null;
       hideEditButtons();
     }

     // Function to save profile changes - modified to prevent duplicate messages
     async function saveProfileChanges(newName, newImage, skipSuccessMessage) {
       if (!currentUser || !currentUser.id) {
         console.error('No user is currently logged in');
         showNotification(translator.translate('You must be logged in to update your profile'), 'error');
         return;
       }

       // Validate name length
       if (newName && newName.length > 15) {
         newName = newName.substring(0, 15);
         showNotification(translator.translate('Name truncated to 15 characters'), 'warning');
       }

       // Prevent multiple simultaneous updates
       if (window.profileUpdateInProgress) {
         return;
       }
       window.profileUpdateInProgress = true;

       try {
         // Show loading notification only once
         showNotification(translator.translate('Updating profile...'), 'info');


         // Create update data
         const updateData = {
           userId: currentUser.id,
           name: newName,
           avatar: null // Default to null to indicate no change
         };

         // If there's a new image, include it but limit the size
         if (newImage) {
           try {
             // Check if image is too large (over 800KB as base64)
             if (newImage.length > 800000) {
               // Resize the image by creating a temporary image element
               const img = new Image();
               img.src = newImage;
               await new Promise(resolve => {
                 img.onload = resolve;
               });

               // Create canvas to resize image
               const canvas = document.createElement('canvas');
               const ctx = canvas.getContext('2d');

               // Calculate new dimensions (max 300px width/height for smaller size)
               const maxDim = 300;
               let width = img.width;
               let height = img.height;

               if (width > height && width > maxDim) {
                 height = (height * maxDim) / width;
                 width = maxDim;
               } else if (height > maxDim) {
                 width = (width * maxDim) / height;
                 height = maxDim;
               }

               canvas.width = width;
               canvas.height = height;

               // Draw resized image to canvas
               ctx.drawImage(img, 0, 0, width, height);

               // Get reduced size base64 with higher compression
               updateData.avatar = canvas.toDataURL('image/jpeg', 0.6);
               console.log('Image resized for upload, new size:', updateData.avatar.length);
             } else {
               updateData.avatar = newImage;
             }
           } catch (imgError) {
             console.error('Error processing image:', imgError);
             showNotification('Error processing image. Using text-only update.', 'warning');
             // Continue with just the name update
           }
         }

         console.log('Sending profile update with data:', {
           userId: updateData.userId,
           name: updateData.name,
           hasAvatar: updateData.avatar !== null
         });

         // Try multiple endpoints in sequence with clear error handling
         let success = false;
         let lastError = null;
         const endpoints = [
           { url: '/api/profile/update', method: 'POST' },
           { url: '/api/profile/update', method: 'PUT' },
           { url: '/api/users/update-profile', method: 'PUT' },
           { url: '/api/user/update-profile', method: 'POST' }
         ];

         for (let i = 0; i < endpoints.length; i++) {
           const endpoint = endpoints[i];
           try {
             console.log(`Trying endpoint ${i+1}/${endpoints.length}: ${endpoint.method} ${endpoint.url}`);

             const response = await fetch(`${window.location.origin}${endpoint.url}`, {
               method: endpoint.method,
               headers: {
                 'Content-Type': 'application/json'
               },
               body: JSON.stringify(updateData),
               timeout: 8000
             });

             console.log(`Endpoint ${i+1} response status:`, response.status);

             if (response.ok) {
               const result = await response.json();
               if (result.success) {
                 handleSuccessfulUpdate(newName, updateData.avatar, result, skipSuccessMessage);
                 success = true;
                 break;
               } else {
                 lastError = new Error(result.error || 'Unknown error');
               }
             } else {
               lastError = new Error(`Server returned status: ${response.status}`);
               // Don't retry on 404 with this endpoint, move to next one
             }
           } catch (error) {
             console.error(`Endpoint ${i+1} failed:`, error);
             lastError = error;
             // Continue to next endpoint
           }

           // Short delay before trying next endpoint
           if (!success && i < endpoints.length - 1) {
             await new Promise(resolve => setTimeout(resolve, 500));
           }
         }

         if (!success) {
           // All attempts failed
           throw lastError || new Error('Profile update failed after trying all endpoints');
         }
       } catch (error) {
         console.error('Error updating profile:', error);
         showNotification(translator.translate('Error updating profile:') + ' ' + (error.message || translator.translate('Please try again.')), 'error');
       } finally {
         // Reset the flag to allow future updates
         window.profileUpdateInProgress = false;
       }
     }

     // Helper function for successful profile updates
     function handleSuccessfulUpdate(newName, newImage, result, skipSuccessMessage) {
       // Update currentUser with new data
       currentUser.name = newName;

       // Update avatar only if we have a new one
       if (result.user && result.user.avatar) {
         currentUser.avatar = result.user.avatar;
       } else if (newImage) {
         currentUser.avatar = newImage;
       }

       // Log the update
       console.log('Profile updated successfully:', {
         name: currentUser.name,
         avatar: currentUser.avatar ? 'Updated' : 'Unchanged'
       });

       // Add a timestamp to indicate when this was last updated
       currentUser.lastProfileUpdate = Date.now();

       // Update UI immediately
       updateUserInfo(currentUser);

       // Update user session with the latest data
       // Clear any cache flags to indicate this is fresh data
       currentUser._fromCache = false;
       saveUserSession(currentUser);

       // We no longer store detailed user data in localStorage
       // Only update the minimal authentication data
       saveUserSession(currentUser);

       // Reset state variables
       hasChanges = false;
       newProfileImage = null;

       // Reset profile edit UI
       resetProfileEditUI();

       // Show success message only if not skipped (avoid duplicate messages when deleting photos)
       if (skipSuccessMessage !== true) {
         showNotification(translator.translate('Profile updated successfully'), 'success');
       }

       // Force reload fresh user data after a delay to ensure server has saved
       // Use forceRefresh=true to bypass cache, and preserve locally-set avatar
       if (currentUser.email) {
         const localAvatar = currentUser.avatar; // Preserve what we just set locally
         const localLastUpdate = currentUser.lastProfileUpdate;
         setTimeout(function() {
           checkIfUserExists(currentUser.email, true).then(userData => {
             if (userData) {
               console.log('Verified profile changes with server data after delay');

               // If we just deleted/changed the avatar locally, don't let server overwrite with stale data
               if (localLastUpdate && currentUser.lastProfileUpdate === localLastUpdate) {
                 // Preserve local avatar if server returns something different (race condition)
                 userData.avatar = localAvatar;
               }

               // Make sure our UI reflects the latest server data
               updateUserInfo(userData);

               // Save the verified server data
               saveUserSession(userData);
             }
           }).catch(error => {
             console.error('Error verifying profile update:', error);
           });
         }, 2500);
       }
     }

     // Direct click handler for profile name editing - no menu needed
     if (profileNameDisplay) {
       profileNameDisplay.addEventListener('click', function(e) {
         e.stopPropagation();
         enterEditMode();
       });
       // Make profile name visually clickable
       profileNameDisplay.style.cursor = 'pointer';
     }

     // طھظ… ط¥ط²ط§ظ„ط© ظ‡ط°ط§ ط§ظ„ظƒظˆط¯ ط§ظ„ظ…ظƒط±ط± ظ„ط£ظ†ظ‡ طھظ… ط¥ط¶ط§ظپطھظ‡ ط£ط¹ظ„ط§ظ‡

     // Initialize the photo options menu
     if (avatarContainer) {
       setupPhotoOptionsMenu();
     }
   }

  // Global function to reinitialize profile editing
  function reinitializeProfileEditing() {
    profileEditingInitialized = false;
    initializeProfileEditing();
  }

  // Global functions for profile photo menu
  window.showPhotoMenu = function() {
    const menu = document.querySelector('.photo-options-menu');
    if (menu) {
      menu.classList.add('show');
    }
  };

  window.hidePhotoMenu = function() {
    const menu = document.querySelector('.photo-options-menu');
    if (menu) {
      menu.classList.remove('show');
    }
  };

  window.deleteProfilePhoto = function() {
    const profileAvatar = document.getElementById('profile-avatar');
    if (profileAvatar && currentUser) {
      const defaultAvatar = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCI`x`sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2M2YzZjNiIvPjxjaXJjbGUgY3g9IjIwIicjeT0iMTIiIHI9IjciIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMTAgMzBjMC01IDQtOCAxMC04czEwIDMgMTAuOHYxYzAtMS0xLTItMi0yaC0xNmMtMSAwLTIgLTEtMi03di0xeiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==';

      if (!currentUser.avatar || currentUser.avatar === defaultAvatar || currentUser.avatar === null) {
        if (typeof showNotification === 'function') {
          showNotification('No profile photo to delete', 'info');
        }
        return;
      }

      profileAvatar.src = defaultAvatar;
      const dashboardAvatar = document.getElementById('dashboard-profile-avatar');
      if (dashboardAvatar) {
        dashboardAvatar.src = defaultAvatar;
      }

      if (currentUser) {
        currentUser.avatar = defaultAvatar;
        if (typeof saveProfileChanges === 'function') {
          saveProfileChanges(currentUser.name, defaultAvatar, true);
        }
        if (typeof showNotification === 'function') {
          showNotification('Profile photo changed to default', 'success');
        }
      }
    }
  };

  // Simple Profile Menu System - No conflicts, no complex animations
  function setupSimpleProfileMenu() {
    // Simple setup function that runs once
    function initializePhotoMenu() {
      const avatarContainer = document.getElementById('avatar-container');
      if (!avatarContainer) return;

      // Simple menu handler - no animations or complex positioning
      function simpleMenuHandler(e) {
        e.stopPropagation();
        const menu = document.querySelector('.photo-options-menu');
        if (menu) {
          if (menu.classList.contains('show')) {
            window.hidePhotoMenu();
          } else {
            window.showPhotoMenu();
          }
        }
      }

      // Setup camera icon click
      const cameraIcon = avatarContainer.querySelector('.camera-icon-badge');
      if (cameraIcon) {
        cameraIcon.onclick = simpleMenuHandler;
      }

      // Setup photo options
      const cameraOption = document.getElementById('camera-option');
      const galleryOption = document.getElementById('gallery-option');
      const deleteOption = document.getElementById('delete-option');

      if (cameraOption) {
        cameraOption.onclick = function(e) {
          e.stopPropagation();
          e.preventDefault();
          const profileImageUpload = document.getElementById('profile-image-upload');
          if (profileImageUpload) {
            profileImageUpload.setAttribute('capture', 'camera');
            profileImageUpload.setAttribute('accept', 'image/*');
            profileImageUpload.click();
          }
          window.hidePhotoMenu();
        };
      }

      if (galleryOption) {
        galleryOption.onclick = function(e) {
          e.stopPropagation();
          e.preventDefault();
          const profileImageUpload = document.getElementById('profile-image-upload');
          if (profileImageUpload) {
            profileImageUpload.removeAttribute('capture');
            profileImageUpload.setAttribute('accept', 'image/*');
            profileImageUpload.click();
          }
          window.hidePhotoMenu();
        };
      }

      if (deleteOption) {
        deleteOption.onclick = function(e) {
          e.stopPropagation();
          if (typeof window.deleteProfilePhoto === 'function') {
            window.deleteProfilePhoto();
          }
          window.hidePhotoMenu();
        };
      }

      // Close menu when clicking outside
      document.onclick = function(e) {
        const menu = document.querySelector('.photo-options-menu');
        if (menu && menu.classList.contains('show') && !menu.contains(e.target) && !avatarContainer.contains(e.target)) {
          window.hidePhotoMenu();
        }
      };
    }

    // Initialize once when profile page is loaded
    const checkProfilePage = setInterval(() => {
      const profilePage = document.getElementById('profile-page');
      const avatarContainer = document.getElementById('avatar-container');

      if (profilePage && avatarContainer) {
        initializePhotoMenu();

        // ط¥ط¶ط§ظپط© ظ…ط¹ط§ظ„ط¬ ط®ط§طµ ظ„ط£ظٹظ‚ظˆظ†ط© ط§ظ„ظƒط§ظ…ظٹط±ط§
        const cameraIcon = avatarContainer.querySelector('.camera-icon-badge');
        if (cameraIcon) {
          // ط¥ط¶ط§ظپط© ظ…ط¹ط§ظ„ط¬ ط¨ط¯ظˆظ† ط§ظ„ط­ط§ط¬ط© ظ„ط¥ط²ط§ظ„ط© ظ…ط¹ط§ظ„ط¬ ط³ط§ط¨ظ‚
          cameraIcon.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Camera icon clicked - showing photo menu');

            const menu = document.querySelector('.photo-options-menu');
            if (menu) {
              if (menu.classList.contains('show')) {
                window.hidePhotoMenu();
              } else {
                window.showPhotoMenu();
              }
            }
          });
        }

        clearInterval(checkProfilePage);
      }
    }, 1000);

    // Stop checking after 10 seconds
    setTimeout(() => {
      clearInterval(checkProfilePage);
    }, 10000);
  }

  // Simple global functions
  window.showPhotoMenu = function() {
    const menu = document.querySelector('.photo-options-menu');
    if (menu) {
      menu.classList.add('show');
    }
  };

  window.hidePhotoMenu = function() {
    const menu = document.querySelector('.photo-options-menu');
    if (menu) {
      menu.classList.remove('show');
    }
  };

  // Initialize simple system
  setupSimpleProfileMenu();





  // Queue for notifications deferred while PIN lock screen is active
  var _notificationQueue = [];

  // Flush queued notifications after PIN unlock
  window._flushNotificationQueue = function() {
    var queued = _notificationQueue.splice(0);
    queued.forEach(function(n) { showNotification(n.message, n.type); });
  };

  // Function to show notification
  function showNotification(message, type = 'info') {
    // Block notifications while PIN lock screen is active (except connection restored)
    var pinScreen = document.getElementById('pin-lock-screen');
    if (pinScreen && pinScreen.style.display !== 'none' && pinScreen.classList.contains('active')) {
      // Allow only "Connection restored" through
      if (message && message.toLowerCase().indexOf('connection restored') === -1 &&
          message.indexOf('تم استعادة الاتصال') === -1 &&
          message.indexOf('Connexion rétablie') === -1 &&
          message.indexOf('Conexión restaurada') === -1 &&
          message.indexOf('Connessione ripristinata') === -1 &&
          message.indexOf('Bağlantı yeniden') === -1 &&
          message.indexOf('कनेक्शन बहाल') === -1 &&
          message.indexOf('连接已恢复') === -1 &&
          message.indexOf('接続が復旧') === -1 &&
          message.indexOf('연결이 복구') === -1 &&
          message.indexOf('Conexão restaurada') === -1 &&
          message.indexOf('Соединение восстановлено') === -1 &&
          message.indexOf('Verbindung wiederhergestellt') === -1 &&
          message.indexOf('Koneksi dipulihkan') === -1 &&
          message.indexOf('Połączenie przywrócone') === -1) {
        _notificationQueue.push({ message: message, type: type });
        return;
      }
    }

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    // Secure: Build notification with safe DOM methods
    const notifContent = document.createElement('div');
    notifContent.className = 'notification-content';
    
    const icon = document.createElement('i');
    icon.className = `fas ${type === 'success' ? 'fa-check' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}`;
    
    const messagePara = document.createElement('p');
    messagePara.textContent = message;
    
    const closeBtnNotif = document.createElement('span');
    closeBtnNotif.className = 'close-btn';
    const closeIconNotif = document.createElement('i');
    closeIconNotif.className = 'fas fa-times';
    closeBtnNotif.appendChild(closeIconNotif);
    
    notifContent.appendChild(icon);
    notifContent.appendChild(messagePara);
    notifContent.appendChild(closeBtnNotif);
    notification.appendChild(notifContent);
    document.body.appendChild(notification);

    // Add animation classes
    setTimeout(() => {
      notification.classList.add('show');
    }, 100);

    // Handle close button
    const closeBtnElement = notification.querySelector('.close-btn');
    closeBtnElement.addEventListener('click', () => {
      notification.classList.remove('show');
      setTimeout(() => {
        notification.remove();
      }, 300);
    });

    // Auto hide after 5 seconds
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, 5000);
  }

  // ✅ Export showNotification globally for missions-system.js and other files
  window.showNotification = showNotification;



  
  // Update referral code display
  function updateReferralCode(code) {
    const codeElements = document.querySelectorAll('#user-referral-code, #referral-code-display, #profile-referral-code');
    codeElements.forEach(element => {
      element.textContent = code;
    });
  }

  // Generate random referral code
  function generateReferralCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Set up navigation
  function setupNavigation() {
    // Desktop navigation
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      link.addEventListener('click', function(e) {
        // ✅ تجاهل زر الخروج - لديه onclick منفصل
        if (this.getAttribute('onclick') && this.getAttribute('onclick').includes('logout')) {
          return; // لا تفعل شيء، logout() سيتولى الأمر
        }
        
        e.preventDefault();
        const pageName = this.getAttribute('data-page');
        if (!pageName) return; // ✅ تجاهل الروابط بدون data-page
        
        showPage(pageName);

        // Update active state
        navLinks.forEach(l => l.classList.remove('active'));
        this.classList.add('active');
      });
    });

    // Mobile navigation
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
    mobileNavItems.forEach(item => {
      item.addEventListener('click', function(e) {
        e.preventDefault();
        const pageName = this.getAttribute('data-page');

        if (pageName === 'more') {
          // Toggle the more menu
          const moreMenu = document.getElementById('more-menu');
          if (moreMenu) {
            moreMenu.style.display = moreMenu.style.display === 'block' ? 'none' : 'block';
          } else {
            // Create the more menu if it doesn't exist
            createMoreMenu();
          }

          // Update active state
          mobileNavItems.forEach(i => i.classList.remove('active'));
          this.classList.add('active');
        } else {
          // Hide more menu if open
          const moreMenu = document.getElementById('more-menu');
          if (moreMenu) {
            moreMenu.style.display = 'none';
          }

          showPage(pageName);

          // Update active state
          mobileNavItems.forEach(i => i.classList.remove('active'));
          this.classList.add('active');
        }
      });
    });

    // Toggle sidebar on mobile
    const toggleSidebar = document.getElementById('toggle-sidebar');
    if (toggleSidebar) {
      toggleSidebar.addEventListener('click', function() {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('sidebar-open');
      });
    }
  }

  // Show specified page
  window.showPage = function(pageName) {
    // Hide all pages
    const pages = document.querySelectorAll('.page-content');
    pages.forEach(page => {
      page.style.display = 'none';
    });

    // Show requested page
    const pageToShow = document.getElementById(pageName + '-page');
    if (pageToShow) {
      pageToShow.style.display = 'block';
    }

    // Update mobile header title
    const mobileTitle = document.getElementById('mobile-page-title');
    if (mobileTitle) {
      mobileTitle.textContent = pageName.charAt(0).toUpperCase() + pageName.slice(1);
    }

    // Handle special page initialization
    if (pageName === 'activity') {
      initializeActivityPage();
    } else if (pageName === 'referrals') {
      initializeReferralsPage();
    } else if (pageName === 'tasks') {
      // Initialize missions system
      if (typeof initMissionsSystem === 'function') {
        initMissionsSystem();
      }
    } else if (pageName === 'profile') {
      initializeProfileEditing();
    } else if (pageName === 'kyc') {
      // Immediately apply translations when KYC page is shown
      translateKYCPage();
      
      // Apply another round of translations after a brief delay
      setTimeout(translateKYCPage, 50);
    } else if (pageName === 'network') {
      // Initialize network functionality
      console.log('[Network page] Starting wallet initialization for network page');
      if (currentUser && currentUser.id) {
        // Show loading indicator for QR code
        const qrContainer = document.querySelector('.qrcode-container');
        if (qrContainer) {
          qrContainer.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Loading QR code...</div>';
          qrContainer.style.backgroundColor = 'white';
          qrContainer.style.padding = '10px';
          qrContainer.style.borderRadius = '8px';
          qrContainer.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
        }
        
        // Initialize wallet data
        initializeUserWallet().then(() => {
          // Update transaction list
          updateTransactionList();
          
          // Always regenerate QR code when network page is shown
          const address = document.getElementById('user-account-address')?.textContent;
          if (address && address !== 'Generating...') {
            console.log('Generating QR code for network page in showPage:', address);
            if (qrContainer) {
              generateAndSaveQRCode(address, qrContainer);
            }
          }
        });
      } else {
        showNotification(translator.translate('Please log in to access your wallet'), 'info');
      }
    }
  };




  // Initialize referrals page
  function initializeReferralsPage() {
    // Copy referral code button functionality
    const copyRefBtn = document.getElementById('copy-referral');
    if (copyRefBtn) {
      copyRefBtn.addEventListener('click', function() {
        const refCode = document.getElementById('referral-code-display').textContent;
        navigator.clipboard.writeText(refCode).then(() => {
          this.innerHTML = '<i class="fas fa-check"></i>';
          setTimeout(() => {
            this.innerHTML = '<i class="fas fa-copy"></i>';
          }, 2000);
        });
      });
    }
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
      if (clickedButton.disabled) return;
      
      // Disable button temporarily to prevent rapid clicks
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

      // Show success notification
      if (typeof showNotification === 'function') {
        showNotification(translator.translate('Referral code copied!'), 'success');
      }

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



// طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬ ظ…ظ† ط§ظ„طھط·ط¨ظٹظ‚
  
   window.logout = function() {
  const logoutModal = document.createElement('div');
  logoutModal.className = 'logout-modal';
  logoutModal.style.display = 'flex';
  
  // Secure: Build modal with safe DOM methods
  const modalContent = document.createElement('div');
  modalContent.className = 'logout-modal-content';
  
  const title = document.createElement('h2');
  title.className = 'logout-modal-title';
  title.textContent = translator.translate('Are you sure you want to sign out?');
  
  const buttonsDiv = document.createElement('div');
  buttonsDiv.className = 'logout-modal-buttons';
  
  const confirmBtn = document.createElement('button');
  confirmBtn.id = 'logout-confirm';
  confirmBtn.className = 'logout-modal-btn logout-confirm-btn';
  confirmBtn.textContent = translator.translate('Yes');
  
  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'logout-cancel';
  cancelBtn.className = 'logout-modal-btn logout-cancel-btn';
  cancelBtn.textContent = translator.translate('No');
  
  buttonsDiv.appendChild(confirmBtn);
  buttonsDiv.appendChild(cancelBtn);
  modalContent.appendChild(title);
  modalContent.appendChild(buttonsDiv);
  logoutModal.appendChild(modalContent);

  document.body.appendChild(logoutModal);

  // ✅ إغلاق النافذة عند الضغط خارجها
  logoutModal.addEventListener('click', function(event) {
    if (event.target === logoutModal) {
      logoutModal.remove();
    }
  });

  document.getElementById('logout-confirm').addEventListener('click', function() {
    // Clear processing timer if exists
    if (activityInterval) {
      clearInterval(activityInterval);
      activityInterval = null;
    }

    // Clear all user data except theme and language preferences
    currentUser = null;

    // ط­ظپط¸ ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„طھظٹ طھط±ظٹط¯ ط§ظ„ط§ط­طھظپط§ط¸ ط¨ظ‡ط§
    const language = localStorage.getItem('preferredLanguage');
    const arabicCssEnabled = localStorage.getItem('arabic-css-enabled');
    const themeMode = localStorage.getItem('themeMode');
    const themeBrightness = localStorage.getItem('themeBrightness');

    // ط­ط°ظپ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ… ظپظ‚ط·
    localStorage.removeItem('accessoireUser');
    localStorage.removeItem('accessoireUserData');
    // ظ„ط§ طھظ…ط³ط­ themeMode ظˆ themeBrightness

    // ظ„ط§ طھط³طھط®ط¯ظ… localStorage.clear() ظ„ط£ظ†ظ‡ ظٹظ…ط³ط­ ظƒظ„ ط´ظٹط،

    // ط§ط³طھط¹ط§ط¯ط© ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ظ…ط­ظپظˆط¸ط©
    if (language) {
      localStorage.setItem('preferredLanguage', language);
    }
    if (arabicCssEnabled) {
      localStorage.setItem('arabic-css-enabled', arabicCssEnabled);
    }
    if (themeMode) {
      localStorage.setItem('themeMode', themeMode);
    }
    if (themeBrightness) {
      localStorage.setItem('themeBrightness', themeBrightness);
    }

    // ط¥ط²ط§ظ„ط© ظ†ط§ظپط°ط© ط§ظ„طھط£ظƒظٹط¯
    logoutModal.remove();

    // Use class-based system for auth state - NO direct style manipulation
    document.documentElement.classList.remove('user-logged-in');
    document.documentElement.classList.add('user-not-logged-in');
    document.documentElement.classList.add('app-ready');

    setTimeout(() => {
      window.location.reload();
    }, 300);
  });

  document.getElementById('logout-cancel').addEventListener('click', function() {
    logoutModal.remove();
  });
};


  // Add all page-specific text to translations if not already present
  function addMissingTranslationsToObject() {
    // Get all text content from the DOM
    const allTextNodes = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      { acceptNode: node => node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT }
    );

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentNode.tagName !== 'SCRIPT' && node.parentNode.tagName !== 'STYLE') {
        const text = node.textContent.trim();
        if (text.length > 1) { // Ignore single characters and empty text
          allTextNodes.push(text);
        }
      }
    }

    //    // Get all button texts
    const buttonTexts = [];
    document.querySelectorAll('button').forEach(button => {
      const buttonText = button.textContent.trim();
      if (buttonText && !buttonText.startsWith('<i') && buttonText.length > 1) {
        buttonTexts.push(buttonText);
      }
    });

    // Get all input placeholders
    const placeholders = [];
    document.querySelectorAll('input[placeholder]').forEach(input => {
      const placeholder = input.getAttribute('placeholder');
      if (placeholder && placeholder.length > 1) {
        placeholders.push(placeholder);
      }
    });

    // Add all texts to translation object if not already present
    const currentLanguage = translator.getCurrentLanguage();
    const allTexts = [...new Set([...allTextNodes, ...buttonTexts, ...placeholders])];

    allTexts.forEach(text => {
      // Skip if already in translations
      if (window.translations[currentLanguage][text]) return;

      // Check if text is already a key in translations
      let isKey =false;
      for (const key in window.translations[currentLanguage]) {
        if (window.translations[currentLanguage][key] === text) {
          isKey = true;
          break;
        }
      }

      if (!isKey) {
        // Add text as both key and value in current language
        window.translations[currentLanguage][text] = text;

        // Add text as key with empty value in other languages
        Object.keys(window.translations).forEach(lang => {
          if (lang !== currentLanguage && !window.translations[lang][text]) {
            window.translations[lang][text] = ""; // Empty string indicates it needs translation
          }
        });
      }
    });
  }

  // Call addMissingTranslationsToObject and updateUILanguage when the page loads
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
      addMissingTranslationsToObject();
      updateUILanguage();
      // Initialize the observer for referrals changes
      observeReferralsChanges();
    }, 500); // Small delay to ensure DOM is fully loaded
  });

  updateUILanguage();

  // Update UI language based on selected language
  function updateUILanguage() {
    // First ensure the Google logo is preserved before any changes
   

    const lang = translator.getCurrentLanguage();
    console.log('Language changed to:', lang);
    document.documentElement.setAttribute('lang', lang); // Update the HTML lang attribute

    // Set the correct language in dropdowns
    if (languageSelect) {
      languageSelect.value = lang;
    }
    if (profileLanguageSelect) {
      profileLanguageSelect.value = lang;
    }

    // Update all text elements with translations
    const translatableElements = document.querySelectorAll('[data-translate]');
    translatableElements.forEach(element => {
      const key = element.getAttribute('data-translate');
      if (key) {
        const translatedText = translator.translate(key);
        if (translatedText) {
          element.textContent = translatedText;
        }
      }
    });
    
    // Make sure to update the "No referrals yet" message if it's showing
    updateNoReferralsMessage();

    // Update placeholders for inputs
    const translatablePlaceholders = document.querySelectorAll('[data-translate-placeholder]');
    translatablePlaceholders.forEach(element => {
      const key = element.getAttribute('data-translate-placeholder');
      if (key) {
        const translatedText = translator.translate(key);
        if (translatedText) {
          element.placeholder = translatedText;
        }
      }
    });

    // Update button texts
    const translatableButtons = document.querySelectorAll('button');
    translatableButtons.forEach(button => {
      // First check for data-translate attribute
      const key = button.getAttribute('data-translate');
      if (key) {
        const translatedText = translator.translate(key);
        if (translatedText) {
          // Preserve any icons in the button - Secure DOM manipulation
          const icon = button.querySelector('i');
          if (icon) {
            button.textContent = '';
            button.appendChild(icon.cloneNode(true));
            button.appendChild(document.createTextNode(' ' + translatedText));
          } else {
            button.textContent = translatedText;
          }
        }
      } 
      // For buttons without data-translate, try to translate their text content
      else if (button.textContent.trim()) {
        const originalText = button.textContent.trim();
        const translatedText = translator.translate(originalText);
        if (translatedText && translatedText !== originalText) {
          // Preserve any icons in the button - Secure DOM manipulation
          const icon = button.querySelector('i');
          if (icon) {
            button.textContent = '';
            button.appendChild(icon.cloneNode(true));
            button.appendChild(document.createTextNode(' ' + translatedText));
          } else {
            button.textContent = translatedText;
          }
        }
      }
    });

    // Improved navigation item translation for sidebar and mobile menu
    updateNavigationTranslations();
    
    // Update all input labels
    const labels = document.querySelectorAll('label');
    labels.forEach(label => {
      if (label.textContent.trim()) {
        const originalText = label.textContent.trim();
        const translatedText = translator.translate(originalText);
        if (translatedText && translatedText !== originalText) {
          label.textContent = translatedText;
        }
      }
    });

    // Update all headings
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach(heading => {
      if (heading.textContent.trim() && !heading.hasAttribute('data-translate')) {
        const originalText = heading.textContent.trim();
        const translatedText = translator.translate(originalText);
        if (translatedText && translatedText !== originalText) {
          heading.textContent = translatedText;
        }
      }
    });

    // Update all paragraphs
    const paragraphs = document.querySelectorAll('p');
    paragraphs.forEach(paragraph => {
      if (paragraph.textContent.trim() && !paragraph.hasAttribute('data-translate')) {
        const originalText = paragraph.textContent.trim();
        const translatedText = translator.translate(originalText);
        if (translatedText && translatedText !== originalText) {
          paragraph.textContent = translatedText;
        }
      }
    });

    // Check if KYC page is currently visible and translate it specifically
   

    // Update specific UI elements with translated content
    updateSpecificUIElements();

    // Special handling for RTL languages (Arabic) - only add the class but don't change direction
    if (lang === 'ar') {
      document.body.classList.add('rtl');
      // Keep direction as LTR
      document.documentElement.dir = 'ltr';
    } else {
      document.body.classList.remove('rtl');
      document.documentElement.dir = 'ltr';
    }

   
    // Update member since date with current language
    if (typeof window.updateProfileMemberSinceDate === 'function') {
      window.updateProfileMemberSinceDate();
    }
    
    // Check if mobile menu exists and update it
    updateMobileMenu();
    
    // CRITICAL: Mark app as ready AFTER all translations are applied
    // This triggers the smooth fade-in reveal
    if (!document.body.classList.contains('app-ready')) {
      document.body.classList.add('app-ready');
      document.documentElement.classList.add('app-ready');
    }
  }

  // Dedicated function for navigation translation
  function updateNavigationTranslations() {
    // Get all navigation items, including the logout button
    const navItems = document.querySelectorAll('.nav-link, .mobile-nav-item');
    navItems.forEach(item => {
      // Get the page name from data attribute
      const pageName = item.getAttribute('data-page');
      
      // Mobile navigation items have spans
      const textSpan = item.querySelector('span');
      if (textSpan) {
        if (pageName) {
          // Special handling for KYC (ensure it translates properly)
          if (pageName === 'kyc') {
            const translatedText = translator.translate('KYC');
            if (translatedText) {
              textSpan.textContent = translatedText;
            }
          } else {
            // Use page name as translation key for consistency
            const translatedText = translator.translate(pageName);
            if (translatedText) {
              textSpan.textContent = translatedText;
            }
          }
        } else if (textSpan.textContent.trim()) {
          // Fallback to text content
          const originalText = textSpan.textContent.trim();
          const translatedText = translator.translate(originalText);
          if (translatedText && translatedText !== originalText) {
            textSpan.textContent = translatedText;
          }
        }
      } 
      // Sidebar items
      else if (item.classList.contains('nav-link')) {
        const icon = item.querySelector('i');
        
        // Special handling for logout button
        if (item.getAttribute('onclick') === 'logout()') {
          const translatedText = translator.translate('logout');
          if (translatedText && icon) {
            // Secure: Clone icon and add text safely
            item.textContent = '';
            item.appendChild(icon.cloneNode(true));
            item.appendChild(document.createTextNode(' ' + translatedText));
          }
        }
        // Special handling for KYC
        else if (pageName === 'kyc') {
          // First try getting explicit KYC translation
          let translatedText = translator.translate('KYC');
          // If that fails, try lowercase kyc
          if (!translatedText || translatedText === 'KYC') {
            translatedText = translator.translate('kyc');
          }
          if (translatedText && icon) {
            // Secure: Clone icon and add text safely
            item.textContent = '';
            item.appendChild(icon.cloneNode(true));
            item.appendChild(document.createTextNode(' ' + translatedText));
          }
        }
        // Regular navigation items
        else if (pageName) {
          // Use page name as translation key
          const translatedText = translator.translate(pageName);
          if (translatedText && icon) {
            // Secure: Clone icon and add text safely
            item.textContent = '';
            item.appendChild(icon.cloneNode(true));
            item.appendChild(document.createTextNode(' ' + translatedText));
          } else if (translatedText) {
            item.textContent = translatedText;
          }
        }
      }
    });
  }

  // Function to update the mobile "More" menu
  function updateMobileMenu() {
    const moreMenu = document.getElementById('more-menu');
    if (moreMenu) {
      const moreMenuItems = moreMenu.querySelectorAll('.more-menu-item');
      moreMenuItems.forEach(item => {
        const textSpan = item.querySelector('span');
        if (textSpan) {
          let key = '';
          // Try to get key based on action attribute
          if (item.getAttribute('data-action') === 'logout') {
            key = 'logout';
          } else if (item.getAttribute('data-page')) {
            key = item.getAttribute('data-page');
            // Special handling for KYC
            if (key === 'kyc') {
              key = 'KYC';
            }
          } else if (textSpan.textContent.trim()) {
            key = textSpan.textContent.trim().toLowerCase();
            // Special handling for KYC in the text content
            if (key === 'kyc') {
              key = 'KYC';
            }
          }
          
          if (key) {
            const translatedText = translator.translate(key);
            if (translatedText) {
              textSpan.textContent = translatedText;
            }
          }
        }
      });
    }
  }


  
  
  // Function to update specific UI elements
  function updateSpecificUIElements() {
    // Dashboard
   
 

                       

    // Activity page
    updateElementText('activityTitle', document.querySelector('#activity-page .activity-card h3'));
    updateElementText('processingStatus', document.querySelector('#activity-status'));
    updateElementText('nextProcessing', document.querySelector('.timer-label'));
    updateElementText('processingInfo1', document.querySelector('.processing-info p:first-child'));
    // ✅ processingInfo2 - ديناميكي مع المكافأة الحالية من tokenomics
    const processingInfo2El = document.querySelector('.processing-info p:last-child');
    if (processingInfo2El) {
      let info2Text = translator.translate('processingInfo2');
      const currentReward = window.serverBaseReward || 0.25;
      info2Text = info2Text.replace('{reward}', formatNumberSmart(currentReward));
      processingInfo2El.textContent = info2Text;
    }
    updateElementText('processingHistory', document.querySelector('.activity-history h3'));

    // Referrals page
    updateElementText('inviteEarn', document.querySelector('.referral-header h3'));
    updateElementText('bonusAmount', document.querySelector('.bonus-amount span'));
    updateElementText('bonusText', document.querySelector('.bonus-text'));
    updateElementText('yourReferrals', document.querySelector('.referrals-list-container h3'));

    // Profile page - Enhanced translation handling for all elements
    // Translate save changes button
    const saveChangesBtn = document.getElementById('save-profile-changes');
    if (saveChangesBtn) {
      saveChangesBtn.textContent = translator.translate('Save Changes');
    }

    // Translate name input placeholder
    const nameInput = document.getElementById('profile-name-input');
    if (nameInput) {
      nameInput.placeholder = translator.translate('Your Name');
    }

    // Find and translate all profile labels using data-translate attribute
    const profileLabels = document.querySelectorAll('#profile-page [data-translate]');
    profileLabels.forEach(label => {
      const key = label.getAttribute('data-translate');
      if (key) {
        const translated = translator.translate(key);
        if (translated) {
          label.textContent = translated;
        }
      }
    });

    // Update theme selector options
    const nightModeSelect = document.getElementById('night-mode-select');
    if (nightModeSelect) {
      const lightOption = nightModeSelect.querySelector('option[value="light"]');
      const darkOption = nightModeSelect.querySelector('option[value="dark"]');
      const autoOption = nightModeSelect.querySelector('option[value="auto"]');

      if (lightOption) lightOption.textContent = translator.translate('Light');
      if (darkOption) darkOption.textContent = translator.translate('Dark'); 
      if (autoOption) autoOption.textContent = translator.translate('Auto (Sunset)');
    }

   
    
  }

  // Helper function to update element text with translation
  function updateElementText(key, element) {
    if (element && key) {
      const translatedText = translator.translate(key);
      if (translatedText) {
        element.textContent = translatedText;
      }
    }
  }

 // Create more menu
  function createMoreMenu() {
    // Remove any existing more menu to prevent duplicates
    const existingMenu = document.getElementById('more-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    // Create more menu element
    const moreMenu = document.createElement('div');
    moreMenu.id = 'more-menu';
    moreMenu.className = 'more-menu';

    // Menu items - use proper capitalization for translation keys
    const menuItems = [
       { icon: 'fas fa-cube', text: translator.translate('Network'), page: 'network', key: 'Network' },
      { icon: 'fas fa-tasks', text: translator.translate('Tasks'), page: 'tasks', key: 'Tasks' },
      { icon: 'fas fa-coins', text: translator.translate('Point System'), page: 'pointsystem', key: 'Point System' },
      { icon: 'fas fa-sign-out-alt', text: 'Logout', action: 'logout' }
    ];

    // Create menu items
    menuItems.forEach(item => {
      const menuItem = document.createElement('div');
      menuItem.className = 'more-menu-item';
      
      // Store the page or action as data attribute for easier translation updates
      if (item.page) {
        menuItem.setAttribute('data-page', item.page);
      } else if (item.action) {
        menuItem.setAttribute('data-action', item.action);
      }

      // Always force a fresh translation lookup
      const translatedText = translator.translate(item.text);
      
      // Secure: Create the menu item with safe DOM methods
      const iconElement = document.createElement('i');
      iconElement.className = item.icon;
      const textSpan = document.createElement('span');
      textSpan.textContent = translatedText;
      
      menuItem.appendChild(iconElement);
      menuItem.appendChild(document.createTextNode(' '));
      menuItem.appendChild(textSpan);

      menuItem.addEventListener('click', function() {
        if (item.page) {
          showPage(item.page);
          moreMenu.style.display = 'none';

          // Update mobile nav active state
          const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
          mobileNavItems.forEach(navItem => {
            navItem.classList.remove('active');
            if (navItem.getAttribute('data-page') === 'more') {
              navItem.classList.add('active');
            }
          });
        } else if (item.action === 'logout') {
          logout();
          moreMenu.style.display = 'none';
        }
      });

      moreMenu.appendChild(menuItem);
    });

    // Append to body
    document.body.appendChild(moreMenu);

    // Position the menu
    const mobileNav = document.querySelector('.mobile-nav');
    const moreButton = document.querySelector('.mobile-nav-item[data-page="more"]');

    if (mobileNav && moreButton) {
      const moreButtonRect = moreButton.getBoundingClientRect();
      moreMenu.style.bottom = (window.innerHeight - moreButtonRect.top) + 'px';
      moreMenu.style.right = '0';
    }

    // Display the menu
    moreMenu.style.display = 'block';
  }

 
  // Add function to update lastPayout in the database
  async function updateLastPayout(userId) {
    try {
      const response = await fetch(`${window.location.origin}/api/users/${userId}/lastpayout`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ timestamp: Date.now() })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      if (result.success) {
        console.log('Last payout updated successfully for user:', userId);
      } else {
        throw new Error('Failed to update last payout');
      }
    } catch (error) {
      console.error('Error updating last payout:', error);
      throw error;
    }
  }

  // Function to initialize Firebase with configuration from Replit Secrets
  function initializeFirebase() {
    // Check if Firebase is already initialized
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
      console.log("Firebase already initialized");
      return true;
    }

    // Wait for window.firebaseConfig to be loaded from server secrets
    if (typeof firebase !== 'undefined' && window.firebaseConfig) {
      try {
        // Initialize with the config from window (which comes from Replit Secrets)
        if (!firebase.apps || !firebase.apps.length) {
          firebase.initializeApp(window.firebaseConfig);
        }
        console.log("Firebase initialized successfully with config from Secrets");
        return true;
      } catch (error) {
        console.error("Firebase initialization error with config from Secrets:", error);
      }
    } else {
      console.log("Firebase config not available yet, retrying...");
      // Config not available, will be retried by the module initialization
      return false;
    }
  }
});

// Simple translator class
class Translator {
  constructor() {
    // Use preloaded language from head script, or check localStorage, or auto-detect from device
    var lang = window.__preloadedLang || localStorage.getItem('preferredLanguage');
    if (!lang) {
      var supportedLangs = ['en','fr','es','it','tr','hi','zh','ja','ko','pt','ru','de','ar','id','pl'];
      var browserLang = (navigator.language || navigator.userLanguage || 'en').toLowerCase().split('-')[0];
      lang = supportedLangs.includes(browserLang) ? browserLang : 'en';
      localStorage.setItem('preferredLanguage', lang);
    }
    this.currentLanguage = lang;
    this.translations = window.translations || {};
    this.fallbackLanguage = 'en'; // English as fallback
  }

  setLanguage(lang) {
    if (this.translations[lang]) {
      this.currentLanguage = lang;
      localStorage.setItem('preferredLanguage', lang);
    } else {
      console.warn(`Language ${lang} not found, falling back to ${this.fallbackLanguage}`);
      this.currentLanguage = this.fallbackLanguage;
      localStorage.setItem('preferredLanguage', this.fallbackLanguage);
    }
  }

  getCurrentLanguage() {
    return this.currentLanguage;
  }

  translate(key) {
    // Try to get translation from current language
    const translation = this.translations[this.currentLanguage];
    if (translation && translation[key]) {
      return translation[key];
    }

    // If not found, try from fallback language
    const fallbackTranslation = this.translations[this.fallbackLanguage];
    if (fallbackTranslation && fallbackTranslation[key]) {
      return fallbackTranslation[key];
    }

    // If still not found, return the key itself
    return key;
  }
}

// ==================== LEADERBOARD FUNCTIONALITY ====================

// Global variable to track current leaderboard period
var currentLeaderboardPeriod = 'all';

// Function to open leaderboard modal
function openLeaderboardModal() {
  const modal = document.getElementById('leaderboardModal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
    
    // 🔒 إعادة تعيين التحديد إلى "كل الوقت" عند فتح الـ modal
    currentLeaderboardPeriod = 'all';
    
    // 🔒 إعادة تعيين الأزرار - تحديد "كل الوقت" فقط
    const tabs = document.querySelectorAll('.leaderboard-tab');
    tabs.forEach(tab => {
      if (tab.getAttribute('data-period') === 'all') {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
    
    // Load initial data
    loadLeaderboardData('all');
  }
}

// Function to close leaderboard modal
function closeLeaderboardModal() {
  const modal = document.getElementById('leaderboardModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = ''; // Restore scrolling
  }
}

// Close modal when clicking outside
document.addEventListener('click', function(event) {
  const modal = document.getElementById('leaderboardModal');
  if (event.target === modal) {
    closeLeaderboardModal();
  }
});

// Close modal with ESC key
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') {
    closeLeaderboardModal();
  }
});

// Function to switch between leaderboard periods
function switchLeaderboardPeriod(period) {
  currentLeaderboardPeriod = period;
  
  // Update tab active states
  const tabs = document.querySelectorAll('.leaderboard-tab');
  tabs.forEach(tab => {
    if (tab.getAttribute('data-period') === period) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  
  // Load data for selected period
  loadLeaderboardData(period);
}

// Function to load leaderboard data
async function loadLeaderboardData(period) {
  const listContainer = document.getElementById('leaderboardList');
  const loadingEl = document.getElementById('leaderboardLoading');
  const emptyEl = document.getElementById('leaderboardEmpty');
  
  if (!listContainer) return;
  
  // 🔒 إخفاء "No data available" فوراً دائماً في البداية
  emptyEl.style.display = 'none';
  
  // Show loading state
  loadingEl.style.display = 'block';
  
  // Remove existing items
  const existingItems = listContainer.querySelectorAll('.leaderboard-item');
  existingItems.forEach(item => item.remove());
  
  try {
    // Fetch leaderboard data from server
    const response = await fetch(`/api/leaderboard?period=${period}`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch leaderboard data');
    }
    
    const data = await response.json();
    
    // Hide loading
    loadingEl.style.display = 'none';
    
    // 🔒 حذف جميع العناصر القديمة مرة أخرى قبل الإضافة (للتأكد)
    const oldItems = listContainer.querySelectorAll('.leaderboard-item');
    oldItems.forEach(item => item.remove());
    
    // 🔒 إخفاء "No data available" فوراً (للتأكد التام)
    emptyEl.style.display = 'none';
    
    if (!data.leaderboard || data.leaderboard.length === 0) {
      // Show empty state ONLY if truly no data
      emptyEl.style.display = 'block';
      return;
    }
    
    // Render leaderboard items
    data.leaderboard.forEach((user, index) => {
      const rank = index + 1;
      const item = createLeaderboardItem(rank, user);
      listContainer.appendChild(item);
    });
    
    // 🔒 إخفاء نهائي بعد عرض البيانات
    emptyEl.style.display = 'none';
    
  } catch (error) {
    console.error('Error loading leaderboard:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Hide loading
    loadingEl.style.display = 'none';
    
    // 🔒 في حالة الخطأ فقط، تحقق إذا هناك بيانات موجودة
    const existingData = listContainer.querySelectorAll('.leaderboard-item');
    if (existingData.length === 0) {
      // Show empty state with error message ONLY if no data displayed
      emptyEl.style.display = 'block';
      const emptyText = emptyEl.querySelector('p');
      if (emptyText) {
        emptyText.textContent = 'Error loading leaderboard. Please try again.';
        emptyText.setAttribute('data-translate', 'Error loading leaderboard. Please try again.');
      }
    }
  }
}

// Function to create a leaderboard item element - 3 Column Layout
function createLeaderboardItem(rank, user) {
  const item = document.createElement('div');
  item.className = 'leaderboard-item';
  
  // Column 1: Rank badge (circle)
  const rankEl = document.createElement('div');
  rankEl.className = 'leaderboard-rank';
  rankEl.textContent = rank;
  rankEl.setAttribute('data-testid', `rank-${rank}`);
  
  // Column 2: White capsule with username + invites
  const userInvitesCapsule = document.createElement('div');
  userInvitesCapsule.className = 'leaderboard-user-invites';
  
  // User info (avatar + username) - left side
  const userEl = document.createElement('div');
  userEl.className = 'leaderboard-user';
  
  const defaultAvatarLeaderboard = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2M2YzZjNiIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMTIiIHI9IjciIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMTAgMzBjMC01IDQtOCAxMC04czEwIDMgMTAgOHYxYzAgMS0xIDItMiAyaC0xNmMtMSAwLTIgLTEtMi0ydi0xeiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==';
  const avatar = document.createElement('img');
  avatar.className = 'leaderboard-avatar';
  avatar.src = user.profileImage || user.avatar || defaultAvatarLeaderboard;
  avatar.alt = user.username || user.email;
  avatar.onerror = function() {
    this.src = defaultAvatarLeaderboard;
  };
  
  const username = document.createElement('div');
  username.className = 'leaderboard-username';
  username.textContent = user.username || user.email || 'Anonymous';
  username.setAttribute('data-testid', `username-${rank}`);
  
  userEl.appendChild(avatar);
  userEl.appendChild(username);
  
  // Invites count - right side
  const invitesEl = document.createElement('div');
  invitesEl.className = 'leaderboard-invites';
  invitesEl.textContent = user.referralCount || 0;
  invitesEl.setAttribute('data-testid', `invites-${rank}`);
  
  userInvitesCapsule.appendChild(userEl);
  userInvitesCapsule.appendChild(invitesEl);
  
  // Column 3: Rewards
  const rewardsEl = document.createElement('div');
  rewardsEl.className = 'leaderboard-rewards';
  const rewardAmount = user.referralRewards || 0;
  const formattedReward = rewardAmount.toFixed(2);
  rewardsEl.innerHTML = `<span class="reward-amount">${formattedReward}</span><img src="access-logo-1ipfs.png" class="reward-logo" alt="ACCESS" />`;
  rewardsEl.setAttribute('data-testid', `rewards-${rank}`);
  
  // Append all 3 columns: [Rank] [White Capsule] [Rewards]
  item.appendChild(rankEl);
  item.appendChild(userInvitesCapsule);
  item.appendChild(rewardsEl);
  
  return item;
}

// Helper function formatNumberSmart is defined at line 202 - no need to redefine here

// Navigate to address details page with the wallet address
function viewDashboardAddress() {
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
    } else if (currentUser && currentUser.wallet_address) {
      fullAddress = currentUser.wallet_address;
    }
  }

  if (fullAddress && fullAddress.length > 10) {
    // Navigate to address-details.html with the address as a query parameter
    window.location.href = `address-details.html?address=${encodeURIComponent(fullAddress)}`;
  } else {
    console.error('No valid wallet address found');
    if (typeof showNotification === 'function') {
      showNotification(translator.translate('Wallet address not available'), 'error');
    }
  }
}

// Make functions globally accessible
window.openLeaderboardModal = openLeaderboardModal;
window.closeLeaderboardModal = closeLeaderboardModal;
window.switchLeaderboardPeriod = switchLeaderboardPeriod;
window.loadLeaderboardData = loadLeaderboardData;
window.viewDashboardAddress = viewDashboardAddress;

// ✅ إعادة تهيئة Google Identity Services بعد تحميل script.js
// هذا يضمن أن handleGoogleSignIn متاحة عند التهيئة
(function reinitializeGoogleIdentityServices() {
  if (typeof google !== 'undefined' && google.accounts && google.accounts.id && window.GOOGLE_CLIENT_ID) {
    console.log('🔄 Re-initializing Google Identity Services with proper callback...');
    google.accounts.id.initialize({
      client_id: window.GOOGLE_CLIENT_ID,
      callback: window.handleGoogleSignIn,
      auto_select: false,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: false,
      context: 'signin',
      ux_mode: 'popup'
    });
    console.log('✅ Google Identity Services re-initialized with handleGoogleSignIn callback');
  } else {
    // إذا لم يكن Google جاهزاً، انتظر
    console.log('⏳ Waiting for Google Identity Services...');
    setTimeout(reinitializeGoogleIdentityServices, 500);
  }
})();