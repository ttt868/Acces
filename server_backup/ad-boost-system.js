/**
 * Ad Boost System - Client Side
 * Handles rewarded ad display and boost activation
 */

(function() {
  'use strict';

  // Google Publisher Tag setup
  window.googletag = window.googletag || { cmd: [] };

  let rewardedSlot = null;
  let rewardGranted = false;
  let currentUserId = null;

  /**
   * Initialize rewarded ad slot
   * Can be called multiple times to reinitialize after ad is closed
   */
  function initializeRewardedAd() {
    console.log('🔄 Initializing rewarded ad slot...');

    googletag.cmd.push(() => {
      // Get ad unit ID from environment (will be set via server)
      const adUnitId = window.REWARDED_AD_UNIT_ID || '/22639388115/rewarded_web_example';

      // Clear existing slot if any
      if (rewardedSlot) {
        googletag.destroySlots([rewardedSlot]);
        rewardedSlot = null;
      }

      rewardedSlot = googletag.defineOutOfPageSlot(
        adUnitId,
        googletag.enums.OutOfPageFormat.REWARDED
      );

      if (rewardedSlot) {
        rewardedSlot.addService(googletag.pubads());

        // Ad is ready to be shown
        googletag.pubads().addEventListener('rewardedSlotReady', (event) => {
          console.log('✅ Rewarded ad is ready');

          // Show the ad when user clicks "Watch Ad" button
          const watchButton = document.getElementById('watch-ad-button');
          if (watchButton) {
            watchButton.onclick = () => {
              event.makeRewardedVisible();
              closeAdBoostModal();
              console.log('📺 Showing rewarded ad');
            };
          }
        });

        // Ad video has finished playing
        googletag.pubads().addEventListener('rewardedSlotVideoCompleted', (event) => {
          console.log('✅ Ad video completed');
        });

        // Ad was closed (with or without reward)
        googletag.pubads().addEventListener('rewardedSlotClosed', handleAdClosed);

        // Reward was granted (ad watched fully)
        googletag.pubads().addEventListener('rewardedSlotGranted', (event) => {
          rewardGranted = true;
          console.log('🎁 Reward granted! Payload:', event.payload);
        });

        // No ad available
        googletag.pubads().addEventListener('slotRenderEnded', (event) => {
          if (event.slot === rewardedSlot && event.isEmpty) {
            console.warn('⚠️ No ad returned for rewarded ad slot');
            showMessage('No ad available right now. Please try again later.', 'warning');
          }
        });

        googletag.enableServices();
        googletag.display(rewardedSlot);

        console.log('✅ Rewarded ad slot initialized successfully');
      } else {
        console.error('❌ Rewarded ads are not supported on this page');
      }
    });
  }

  // Initialize on page load
  initializeRewardedAd();

  /**
   * Handle ad closed event
   * SERVER-AUTHORITATIVE: Only grant if ad completed fully
   */
  async function handleAdClosed() {
    console.log('📺 Ad closed. Reward granted:', rewardGranted);

    // STRICT: If ad not completed, allow retry
    if (!rewardGranted) {
      console.warn('⚠️ Ad was closed before completion - NO reward granted');
      showMessage('الإعلان لم يكتمل. شاهد الإعلان كاملاً للحصول على المكافأة.', 'warning');
      
      // Cleanup and allow retry
      if (rewardedSlot) {
        googletag.destroySlots([rewardedSlot]);
        rewardedSlot = null;
      }
      
      setTimeout(() => {
        initializeRewardedAd();
      }, 500);
      
      return; // EXIT - no reward
    }

    // ✅ Ad completed - grant reward SERVER-SIDE ONLY
    if (currentUserId) {
      try {
        const transactionId = `ad_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const response = await fetch('/api/ad-boost/grant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            transactionId: transactionId,
            adCompleted: true
          })
        });

        const result = await response.json();

        if (result.success) {
          console.log('✅ Server granted boost:', result);

          // Show success message - gradual accumulation like referrals
          showMessage(`✅ تم! تعزيز +1.2 MH/s نشط - المكافأة تتراكم تدريجيًا خلال التعدين`, 'success');

          // 🚀 تحديث الـ localBoostData فوراً لمنع الـ overwrite
          if (window.localBoostData) {
            window.localBoostData.adBoostActive = true;
            window.localBoostData.multiplier += 0.12; // +12% boost
            console.log('✅ localBoostData updated immediately - multiplier:', window.localBoostData.multiplier);
          }

          // Update hashrate display
          if (result.boostActive) {
            updateHashrateDisplay(1.2);
          }

          // No instant balance refresh needed - reward accumulates gradually

          rewardGranted = false;
          
        } else {
          console.error('❌ Server rejected:', result.error);
          showMessage(`❌ ${result.error}`, 'error');
        }

      } catch (error) {
        console.error('❌ Error:', error);
        showMessage('فشل الاتصال بالسيرفر. حاول مرة أخرى.', 'error');
      }
    }

    // Cleanup
    if (rewardedSlot) {
      googletag.destroySlots([rewardedSlot]);
      rewardedSlot = null;
    }

    setTimeout(() => {
      initializeRewardedAd();
    }, 500);
  }

  /**
   * Show ad boost modal when user clicks on XP/s
   */
  async function showAdBoostModal(userId) {
    currentUserId = userId;

    console.log('showAdBoostModal called for user:', userId);

    try {
      // Check eligibility مع تحديث فوري
      console.log('Checking eligibility at: /api/ad-boost/check?userId=' + userId);
      const response = await fetch(`/api/ad-boost/check?userId=${userId}`);
      const result = await response.json();

      console.log('Eligibility check result:', result);

      if (!result.success) {
        console.error('Eligibility check failed:', result);
        showMessage(translator.translate('Failed to check eligibility'), 'error');
        return;
      }

      // Show modal فوراً
      const modal = document.getElementById('ad-boost-modal');
      if (!modal) {
        console.error('❌ ad-boost-modal element not found in DOM!');
        showMessage(translator.translate('Ad system not ready. Please refresh the page.'), 'error');
        return;
      }

      modal.style.display = 'block';
      modal.style.visibility = 'visible';
      modal.style.opacity = '1';

      if (!result.eligible) {
        console.log('User not eligible:', result.reason);

        // إخفاء زر المشاهدة
        const watchButton = document.getElementById('watch-ad-button');
        if (watchButton) {
          watchButton.style.display = 'none';
        }

        // عرض رسالة الانتظار مع الوقت الصحيح
        if (result.reason === 'already_boosted_this_session') {
          showCooldownMessage(result.remainingSeconds || 0, result.reason);
        } else if (result.reason === 'not_mining') {
          showCooldownMessage(0, 'not_mining');
        } else if (result.reason === 'cooldown') {
          showCooldownMessage(result.remainingSeconds, 'cooldown');
        } else {
          showMessage(translator.translate(result.message || result.reason || 'Not eligible for ad boost'), 'warning');
        }
      } else {
        // المستخدم مؤهل - إظهار زر المشاهدة
        const watchButton = document.getElementById('watch-ad-button');
        const cooldownDiv = document.getElementById('ad-cooldown-message');

        if (watchButton) {
          watchButton.style.display = 'block';
        }
        if (cooldownDiv) {
          cooldownDiv.style.display = 'none';
        }

        console.log('✅ Modal ready - User can watch ad');
      }

    } catch (error) {
      console.error('Error checking ad boost eligibility:', error);
      showMessage(translator.translate('Failed to check eligibility') + ': ' + error.message, 'error');
    }
  }

  /**
   * Close ad boost modal
   */
  function closeAdBoostModal() {
    const modal = document.getElementById('ad-boost-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  /**
   * Close ad boost modal when clicking outside of it
   */
  window.closeAdBoostModalOnOutsideClick = function(event) {
    const modal = document.getElementById('ad-boost-modal');
    if (event.target === modal) {
      closeAdBoostModal();
    }
  }

  /**
   * Show cooldown/restriction message
   */
  function showCooldownMessage(remainingSeconds, reason) {
    const modal = document.getElementById('ad-boost-modal');
    const cooldownDiv = document.getElementById('ad-cooldown-message');
    const messageContainer = document.getElementById('cooldown-message-container');
    const timeDisplay = document.getElementById('cooldown-time-display');

    if (modal && cooldownDiv && messageContainer && timeDisplay) {
      let messageText = '';
      let timeText = '';

      // التأكد من أن remainingSeconds رقم صحيح
      const validSeconds = Math.max(0, Math.floor(remainingSeconds || 0));

      if (reason === 'already_boosted_this_session') {
        // الجلسة نشطة والتعزيز مفعل - عرض الوقت المتبقي للجلسة
        const hours = Math.floor(validSeconds / 3600);
        const minutes = Math.floor((validSeconds % 3600) / 60);

        messageText = document.getElementById('ad-boost-cooldown-message')?.textContent || 'Ad boost active! Wait for session to end';

        // عرض الوقت فقط إذا كان هناك وقت متبقي
        if (validSeconds > 0) {
          timeText = `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m`;
        } else {
          timeText = '00h 00m';
        }
      } else if (reason === 'not_mining') {
        // الجلسة غير نشطة - يجب بدء التعدين أولاً
        messageText = document.getElementById('ad-boost-start-mining')?.textContent || 'Start activity first to watch an ad';
        timeText = ''; // لا نعرض وقت عندما لا يكون هناك جلسة
      } else if (reason === 'boost_pending') {
        messageText = 'Ad boost granted! Start mining to activate it.';
        timeText = '';
      } else {
        const hours = Math.floor(validSeconds / 3600);
        const minutes = Math.floor((validSeconds % 3600) / 60);

        messageText = document.getElementById('ad-boost-wait-message')?.textContent || 'Wait to watch another ad';
        timeText = `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m`;
      }

      messageContainer.textContent = messageText;
      timeDisplay.textContent = timeText;
      timeDisplay.style.display = timeText ? 'block' : 'none';
      cooldownDiv.style.display = 'block';

      // Hide "Watch Ad" button
      const watchButton = document.getElementById('watch-ad-button');
      if (watchButton) {
        watchButton.style.display = 'none';
      }

      console.log(`Cooldown message: ${messageText} - Time: ${timeText} (${validSeconds}s)`);
    }
  }

  /**
   * Update hashrate display with boost
   * SERVER-SIDE STATE ONLY - No localStorage persistence
   */
  function updateHashrateDisplay(boostValue) {
    // NO localStorage - rely on server state only
    
    // Update Dashboard hashrate
    const hashrateValue = document.getElementById('dashboard-hashrate-value');
    if (hashrateValue) {
      const adBoostIncluded = hashrateValue.getAttribute('data-ad-boost-active') === 'true';

      if (!adBoostIncluded) {
        const baseHashrate = 10.0;
        const currentValue = parseFloat(hashrateValue.textContent) || baseHashrate;
        const newValue = currentValue + boostValue;

        hashrateValue.textContent = newValue.toFixed(1);
        hashrateValue.setAttribute('data-ad-boost-active', 'true');
        hashrateValue.setAttribute('data-ad-boost-value', boostValue);
        hashrateValue.style.color = '#4ade80';

        console.log(`✅ Dashboard Ad Boost applied: ${currentValue.toFixed(1)} → ${newValue.toFixed(1)} MH/s`);
      }
    }

    // Update Activity page hashrate
    const activityHashrateValue = document.getElementById('hashrate-value');
    const activityHashrateDisplay = document.getElementById('hashrate-display');
    if (activityHashrateValue && activityHashrateDisplay) {
      const adBoostIncluded = activityHashrateValue.getAttribute('data-ad-boost-active') === 'true';

      if (!adBoostIncluded) {
        const baseHashrate = 10.0;
        const currentActivityValue = parseFloat(activityHashrateValue.textContent) || baseHashrate;
        const newActivityValue = currentActivityValue + boostValue;

        activityHashrateValue.textContent = newActivityValue.toFixed(1);
        activityHashrateValue.setAttribute('data-ad-boost-active', 'true');
        activityHashrateValue.setAttribute('data-ad-boost-value', boostValue);
        // ✅ لا نغير اللون في Activity page

        activityHashrateDisplay.style.display = 'flex';
        activityHashrateDisplay.style.visibility = 'visible';
        activityHashrateDisplay.style.opacity = '1';

        console.log(`✅ Activity Ad Boost applied: ${currentActivityValue.toFixed(1)} → ${newActivityValue.toFixed(1)} MH/s`);
      }
    }
  }

  /**
   * Reset hashrate display to base value (without ad boost)
   * Server-side triggered reset
   */
  function resetHashrateDisplay() {
    console.log('🔄 Resetting hashrate display - server-side state');

    // Reset Dashboard hashrate to base value
    const hashrateValue = document.getElementById('dashboard-hashrate-value');
    if (hashrateValue && hashrateValue.getAttribute('data-ad-boost-active') === 'true') {
      const adBoostValue = parseFloat(hashrateValue.getAttribute('data-ad-boost-value')) || 1.2;
      const currentValue = parseFloat(hashrateValue.textContent) || 10.0;
      const baseValue = currentValue - adBoostValue;

      hashrateValue.textContent = baseValue.toFixed(1);
      hashrateValue.removeAttribute('data-ad-boost-active');
      hashrateValue.removeAttribute('data-ad-boost-value');
      hashrateValue.style.color = '';

      console.log(`✅ Dashboard hashrate reset: ${currentValue.toFixed(1)} → ${baseValue.toFixed(1)} MH/s`);
    }

    // Reset Activity page hashrate
    const activityHashrateValue = document.getElementById('hashrate-value');
    if (activityHashrateValue && activityHashrateValue.getAttribute('data-ad-boost-active') === 'true') {
      const adBoostValue = parseFloat(activityHashrateValue.getAttribute('data-ad-boost-value')) || 1.2;
      const currentValue = parseFloat(activityHashrateValue.textContent) || 10.0;
      const baseValue = currentValue - adBoostValue;

      activityHashrateValue.textContent = baseValue.toFixed(1);
      activityHashrateValue.removeAttribute('data-ad-boost-active');
      activityHashrateValue.removeAttribute('data-ad-boost-value');
      activityHashrateValue.style.color = '';

      console.log(`✅ Activity hashrate reset: ${currentValue.toFixed(1)} → ${baseValue.toFixed(1)} MH/s`);
    }

    console.log('✅ Hashrate display reset complete');
  }

  /**
   * Show message to user
   */
  function showMessage(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);

    // You can integrate with existing toast/notification system here
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
    }
  }

  /**
   * Make XP/s clickable on dashboard
   */
  function initializeAdBoostUI() {
    const hashrateDisplay = document.getElementById('dashboard-hashrate-display');

    if (hashrateDisplay) {
      // Make it clickable
      hashrateDisplay.style.cursor = 'pointer';
      hashrateDisplay.title = 'Click to boost your XP/s with an ad!';

      // Remove any existing listeners
      const newHashrateDisplay = hashrateDisplay.cloneNode(true);
      hashrateDisplay.parentNode.replaceChild(newHashrateDisplay, hashrateDisplay);

      newHashrateDisplay.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        console.log('XP/s clicked - checking user...');

        // Try multiple ways to get user ID
        let userId = null;

        // Method 1: window.currentUser
        if (window.currentUser && window.currentUser.id) {
          userId = window.currentUser.id;
          console.log('Found user from window.currentUser:', userId);
        }

        // Method 2: localStorage
        if (!userId) {
          try {
            const savedUser = localStorage.getItem('accessoireUser');
            if (savedUser) {
              const userData = JSON.parse(savedUser);
              userId = userData.id;
              console.log('Found user from localStorage:', userId);
            }
          } catch (e) {
            console.warn('Could not parse localStorage user data');
          }
        }

        if (userId) {
          console.log('Showing ad boost modal for user:', userId);
          showAdBoostModal(userId);
        } else {
          console.error('No user logged in');
          showMessage('Please log in to use ad boost', 'warning');
        }
      });

      // Add visual indicator
      newHashrateDisplay.classList.add('ad-boost-enabled');

      console.log('✅ Ad boost UI initialized on dashboard-hashrate-display');
    } else {
      console.warn('⚠️ dashboard-hashrate-display not found');
    }

    // Close modal button
    const closeButton = document.getElementById('close-ad-modal-button');
    if (closeButton) {
      closeButton.addEventListener('click', closeAdBoostModal);
    }

    // Check boost status on page load
    checkBoostStatus();
  }

  /**
   * Check current boost status
   */
  async function checkBoostStatus() {
    const userId = window.currentUser?.id;
    if (!userId) return;

    try {
      const response = await fetch(`/api/ad-boost/status?userId=${userId}`);
      const result = await response.json();

      if (result.success && result.exists) {
        if (result.boostActive) {
          console.log('✅ Ad boost is currently active');
          // Visual indicator could be added here
        } else if (result.boostGranted) {
          console.log('⏳ Ad boost granted but not active yet (start mining to activate)');
        }
      }
    } catch (error) {
      console.error('Error checking boost status:', error);
    }
  }

  // Verify modal exists in DOM
  function verifyModalExists() {
    const modal = document.getElementById('ad-boost-modal');
    if (!modal) {
      console.error('❌ CRITICAL: ad-boost-modal not found in index.html!');
      console.log('Please ensure the modal HTML is present in index.html');
      return false;
    }
    console.log('✅ ad-boost-modal verified in DOM');
    return true;
  }

  /**
   * Check server state for ad boost on page load
   * NO localStorage - pure server-side state
   */
  async function checkAdBoostOnLoad() {
    if (!window.currentUser || !window.currentUser.id) return;

    try {
      const response = await fetch(`/api/ad-boost/status?userId=${window.currentUser.id}`);
      const data = await response.json();

      if (data.success && data.boostActive) {
        console.log('✅ Server confirms ad boost is active');
        updateHashrateDisplay(1.2);
      } else {
        console.log('⭕ Server confirms no active ad boost');
        resetHashrateDisplay();
      }
    } catch (error) {
      console.error('Error checking ad boost status:', error);
    }
  }

  // Check server state on page load
  window.addEventListener('load', () => {
    setTimeout(checkAdBoostOnLoad, 1000);
  });

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        verifyModalExists();
        initializeAdBoostUI();
      }, 500);
    });
  } else {
    setTimeout(() => {
      verifyModalExists();
      initializeAdBoostUI();
    }, 500);
  }

  // دالة عرض نافذة التعزيز من صفحة Activity
  window.showActivityBoost = function() {
    console.log('Activity Boost button clicked');

    // الحصول على معرف المستخدم
    let userId = null;

    if (window.currentUser && window.currentUser.id) {
      userId = window.currentUser.id;
    } else {
      try {
        const savedUser = localStorage.getItem('accessoireUser');
        if (savedUser) {
          const userData = JSON.parse(savedUser);
          userId = userData.id;
        }
      } catch (e) {
        console.warn('Could not parse localStorage user data');
      }
    }

    if (userId) {
      console.log('Opening ad boost modal from Activity page for user:', userId);
      showAdBoostModal(userId);
    } else {
      console.error('No user logged in');
      showMessage('Please log in to use ad boost', 'warning');
    }
  };

  // Export functions for use elsewhere
  window.AdBoostSystem = {
    showModal: showAdBoostModal,
    closeModal: closeAdBoostModal,
    checkStatus: checkBoostStatus,
    verify: verifyModalExists,
    showFromActivity: window.showActivityBoost,
    resetDisplay: resetHashrateDisplay  // NEW: Reset hashrate without losing balance
  };

  console.log('✅ Ad Boost System loaded');

})();