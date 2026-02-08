/**
 * Ad Boost System - Client Side (cordova-plugin-ads)
 * Handles rewarded ad display and boost activation
 * SERVER-AUTHORITATIVE: Must complete full ad for boost
 * 
 * Plugin: cordova-plugin-ads (cozycodegh) - survives background/resume
 * Test Ad Unit: ca-app-pub-3940256099942544/5224354917
 * Production:   ca-app-pub-3543981710825954/4821776631
 */

(function() {
  'use strict';

  // ===== CONFIGURATION =====
  const AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

  let boostAdReady = false;
  let boostAdLoading = false;
  let currentUserId = null;
  let adMobAvailable = false;
  let boostInitAttempts = 0;
  let boostLoadFailCount = 0;
  const MAX_BOOST_INIT_ATTEMPTS = 10;

  console.log('🚀 Ad Boost System (cordova-plugin-ads) initializing...');

  /**
   * Load boost rewarded ad using cordova-plugin-ads
   * adMob.rewarded(id) → promise resolves when ad is loaded
   */
  async function initializeRewardedAd() {
    boostInitAttempts++;
    console.log('🚀 initializeRewardedAd attempt #' + boostInitAttempts);

    if (typeof adMob === 'undefined') {
      console.warn('⚠️ adMob not available yet');
      if (boostInitAttempts < MAX_BOOST_INIT_ATTEMPTS) {
        setTimeout(initializeRewardedAd, 3000);
      }
      return;
    }

    if (boostAdLoading || boostAdReady) {
      console.log('ℹ️ Boost ad already loading or ready');
      return;
    }
    boostAdLoading = true;

    try {
      adMobAvailable = true;
      console.log('🔄 Loading boost rewarded ad...');
      
      await adMob.rewarded(AD_UNIT_ID);
      
      boostAdReady = true;
      boostAdLoading = false;
      boostLoadFailCount = 0;
      console.log('✅ Boost rewarded ad LOADED and ready');

    } catch (error) {
      console.warn('⚠️ Boost ad load failed:', error);
      boostAdReady = false;
      boostAdLoading = false;
      boostLoadFailCount++;
      var delay = Math.min(5000 * boostLoadFailCount, 20000);
      if (boostInitAttempts < MAX_BOOST_INIT_ATTEMPTS) {
        setTimeout(initializeRewardedAd, delay);
      }
    }
  }

  // Initialize on deviceready
  document.addEventListener('deviceready', function() {
    console.log('🚀 deviceready - will init Boost ad in 800ms');
    setTimeout(initializeRewardedAd, 800);
  }, false);

  // Fallback
  setTimeout(function() {
    if (!adMobAvailable && typeof adMob !== 'undefined') {
      initializeRewardedAd();
    }
  }, 5000);

  /**
   * Show rewarded ad for boost
   * adMob.showRewarded() → returns {rewarded: bool, amount: N, type: "..."}
   */
  async function watchRewardedAd() {
    console.log('📺 watchRewardedAd called, ready:', boostAdReady);

    if (!boostAdReady || !adMobAvailable) {
      showMessage('Ad is loading... Please wait a moment and try again.', 'warning');
      if (adMobAvailable && !boostAdLoading) {
        initializeRewardedAd();
      }
      return;
    }

    try {
      closeAdBoostModal();
      boostAdReady = false;
      console.log('📺 Showing boost rewarded ad...');
      
      // showRewarded() blocks until ad is dismissed, returns reward info
      var reward = await adMob.showRewarded();
      
      console.log('📺 Boost ad dismissed, reward:', JSON.stringify(reward));
      
      if (reward && reward.rewarded) {
        // ✅ Ad completed - grant reward SERVER-SIDE
        console.log('🎁 Boost REWARD GRANTED!');
        await grantBoostReward();
      } else {
        // Ad closed before completion
        console.warn('⚠️ Ad closed before completion - NO reward');
        showMessage('الإعلان لم يكتمل. شاهد الإعلان كاملاً للحصول على المكافأة.', 'warning');
      }

      // Reload for next use
      setTimeout(initializeRewardedAd, 500);

    } catch (error) {
      console.error('❌ Boost ad show error:', error);
      showMessage('Failed to show ad. Please try again.', 'error');
      boostAdReady = false;
      setTimeout(initializeRewardedAd, 3000);
    }
  }

  /**
   * Grant boost reward via server
   */
  async function grantBoostReward() {
    if (!currentUserId) return;

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
        showMessage('✅ تم! تعزيز +1.2 MH/s نشط - المكافأة تتراكم تدريجيًا خلال التعدين', 'success');

        // Update localBoostData
        if (window.localBoostData) {
          window.localBoostData.adBoostActive = true;
          window.localBoostData.multiplier += 0.12;
        }

        if (result.boostActive) {
          updateHashrateDisplay(1.2);
        }
      } else {
        console.error('❌ Server rejected:', result.error);
        showMessage('❌ ' + result.error, 'error');
      }

    } catch (error) {
      console.error('❌ Server error:', error);
      showMessage('فشل الاتصال بالسيرفر. حاول مرة أخرى.', 'error');
    }
  }

  /**
   * Show ad boost modal
   */
  async function showAdBoostModal(userId) {
    currentUserId = userId;
    console.log('showAdBoostModal called for user:', userId);

    try {
      const response = await fetch('/api/ad-boost/check?userId=' + userId);
      const result = await response.json();
      console.log('Eligibility check result:', result);

      if (!result.success) {
        showMessage(translator.translate('Failed to check eligibility'), 'error');
        return;
      }

      const modal = document.getElementById('ad-boost-modal');
      if (!modal) {
        showMessage(translator.translate('Ad system not ready. Please refresh the page.'), 'error');
        return;
      }

      modal.style.display = 'block';
      modal.style.visibility = 'visible';
      modal.style.opacity = '1';

      if (!result.eligible) {
        const watchButton = document.getElementById('watch-ad-button');
        if (watchButton) watchButton.style.display = 'none';

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
        const watchButton = document.getElementById('watch-ad-button');
        const cooldownDiv = document.getElementById('ad-cooldown-message');
        if (watchButton) watchButton.style.display = 'block';
        if (cooldownDiv) cooldownDiv.style.display = 'none';
        console.log('✅ Modal ready - User can watch ad');
      }

    } catch (error) {
      console.error('Error checking eligibility:', error);
      showMessage(translator.translate('Failed to check eligibility') + ': ' + error.message, 'error');
    }
  }

  function closeAdBoostModal() {
    const modal = document.getElementById('ad-boost-modal');
    if (modal) modal.style.display = 'none';
  }

  window.closeAdBoostModalOnOutsideClick = function(event) {
    const modal = document.getElementById('ad-boost-modal');
    if (event.target === modal) closeAdBoostModal();
  };

  function showCooldownMessage(remainingSeconds, reason) {
    const cooldownDiv = document.getElementById('ad-cooldown-message');
    const messageContainer = document.getElementById('cooldown-message-container');
    const timeDisplay = document.getElementById('cooldown-time-display');

    if (cooldownDiv && messageContainer && timeDisplay) {
      let messageText = '';
      let timeText = '';
      const validSeconds = Math.max(0, Math.floor(remainingSeconds || 0));

      if (reason === 'already_boosted_this_session') {
        const hours = Math.floor(validSeconds / 3600);
        const minutes = Math.floor((validSeconds % 3600) / 60);
        messageText = document.getElementById('ad-boost-cooldown-message')?.textContent || 'Ad boost active! Wait for session to end';
        timeText = validSeconds > 0 ? hours.toString().padStart(2, '0') + 'h ' + minutes.toString().padStart(2, '0') + 'm' : '00h 00m';
      } else if (reason === 'not_mining') {
        messageText = document.getElementById('ad-boost-start-mining')?.textContent || 'Start activity first to watch an ad';
        timeText = '';
      } else if (reason === 'boost_pending') {
        messageText = 'Ad boost granted! Start mining to activate it.';
        timeText = '';
      } else {
        const hours = Math.floor(validSeconds / 3600);
        const minutes = Math.floor((validSeconds % 3600) / 60);
        messageText = document.getElementById('ad-boost-wait-message')?.textContent || 'Wait to watch another ad';
        timeText = hours.toString().padStart(2, '0') + 'h ' + minutes.toString().padStart(2, '0') + 'm';
      }

      messageContainer.textContent = messageText;
      timeDisplay.textContent = timeText;
      timeDisplay.style.display = timeText ? 'block' : 'none';
      cooldownDiv.style.display = 'block';

      const watchButton = document.getElementById('watch-ad-button');
      if (watchButton) watchButton.style.display = 'none';
    }
  }

  function updateHashrateDisplay(boostValue) {
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
      }
    }

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
        activityHashrateDisplay.style.display = 'flex';
        activityHashrateDisplay.style.visibility = 'visible';
        activityHashrateDisplay.style.opacity = '1';
      }
    }
  }

  function resetHashrateDisplay() {
    const hashrateValue = document.getElementById('dashboard-hashrate-value');
    if (hashrateValue && hashrateValue.getAttribute('data-ad-boost-active') === 'true') {
      const adBoostValue = parseFloat(hashrateValue.getAttribute('data-ad-boost-value')) || 1.2;
      const currentValue = parseFloat(hashrateValue.textContent) || 10.0;
      const baseValue = currentValue - adBoostValue;
      hashrateValue.textContent = baseValue.toFixed(1);
      hashrateValue.removeAttribute('data-ad-boost-active');
      hashrateValue.removeAttribute('data-ad-boost-value');
      hashrateValue.style.color = '';
    }

    const activityHashrateValue = document.getElementById('hashrate-value');
    if (activityHashrateValue && activityHashrateValue.getAttribute('data-ad-boost-active') === 'true') {
      const adBoostValue = parseFloat(activityHashrateValue.getAttribute('data-ad-boost-value')) || 1.2;
      const currentValue = parseFloat(activityHashrateValue.textContent) || 10.0;
      const baseValue = currentValue - adBoostValue;
      activityHashrateValue.textContent = baseValue.toFixed(1);
      activityHashrateValue.removeAttribute('data-ad-boost-active');
      activityHashrateValue.removeAttribute('data-ad-boost-value');
      activityHashrateValue.style.color = '';
    }
  }

  function showMessage(message, type) {
    type = type || 'info';
    console.log('[' + type.toUpperCase() + '] ' + message);
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
    }
  }

  function initializeAdBoostUI() {
    const hashrateDisplay = document.getElementById('dashboard-hashrate-display');
    if (hashrateDisplay) {
      hashrateDisplay.style.cursor = 'pointer';
      hashrateDisplay.title = 'Click to boost your XP/s with an ad!';

      const newHashrateDisplay = hashrateDisplay.cloneNode(true);
      hashrateDisplay.parentNode.replaceChild(newHashrateDisplay, hashrateDisplay);

      newHashrateDisplay.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        let userId = null;
        if (window.currentUser && window.currentUser.id) {
          userId = window.currentUser.id;
        }
        if (!userId) {
          try {
            const savedUser = localStorage.getItem('accessoireUser');
            if (savedUser) userId = JSON.parse(savedUser).id;
          } catch (e) {}
        }

        if (userId) {
          showAdBoostModal(userId);
        } else {
          showMessage('Please log in to use ad boost', 'warning');
        }
      });

      newHashrateDisplay.classList.add('ad-boost-enabled');
    }

    const watchButton = document.getElementById('watch-ad-button');
    if (watchButton) {
      watchButton.onclick = function() {
        console.log('👆 Watch Ad button clicked!');
        watchRewardedAd();
      };
    }

    const closeButton = document.getElementById('close-ad-modal-button');
    if (closeButton) {
      closeButton.addEventListener('click', closeAdBoostModal);
    }

    checkBoostStatus();
  }

  async function checkBoostStatus() {
    const userId = window.currentUser?.id;
    if (!userId) return;
    try {
      const response = await fetch('/api/ad-boost/status?userId=' + userId);
      const result = await response.json();
      if (result.success && result.exists && result.boostActive) {
        console.log('✅ Ad boost is currently active');
      }
    } catch (error) {
      console.error('Error checking boost status:', error);
    }
  }

  function verifyModalExists() {
    const modal = document.getElementById('ad-boost-modal');
    if (!modal) {
      console.error('❌ ad-boost-modal not found in DOM!');
      return false;
    }
    console.log('✅ ad-boost-modal verified');
    return true;
  }

  async function checkAdBoostOnLoad() {
    if (!window.currentUser || !window.currentUser.id) return;
    try {
      const response = await fetch('/api/ad-boost/status?userId=' + window.currentUser.id);
      const data = await response.json();
      if (data.success && data.boostActive) {
        updateHashrateDisplay(1.2);
      } else {
        resetHashrateDisplay();
      }
    } catch (error) {
      console.error('Error checking ad boost status:', error);
    }
  }

  window.addEventListener('load', function() {
    setTimeout(checkAdBoostOnLoad, 1000);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() {
        verifyModalExists();
        initializeAdBoostUI();
      }, 500);
    });
  } else {
    setTimeout(function() {
      verifyModalExists();
      initializeAdBoostUI();
    }, 500);
  }

  window.showActivityBoost = function() {
    let userId = null;
    if (window.currentUser && window.currentUser.id) {
      userId = window.currentUser.id;
    } else {
      try {
        const savedUser = localStorage.getItem('accessoireUser');
        if (savedUser) userId = JSON.parse(savedUser).id;
      } catch (e) {}
    }
    if (userId) {
      showAdBoostModal(userId);
    } else {
      showMessage('Please log in to use ad boost', 'warning');
    }
  };

  window.AdBoostSystem = {
    showModal: showAdBoostModal,
    closeModal: closeAdBoostModal,
    checkStatus: checkBoostStatus,
    verify: verifyModalExists,
    showFromActivity: window.showActivityBoost,
    resetDisplay: resetHashrateDisplay
  };

  console.log('✅ Ad Boost System (cordova-plugin-ads) loaded');

})();
