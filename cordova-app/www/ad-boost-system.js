/**
 * Ad Boost System - Client Side
 * Uses window.showRewardedAd() from activity-ad-system.js
 * Does NOT load its own ads - prevents native plugin conflicts
 * SERVER-AUTHORITATIVE: Must complete full ad for boost
 */

(function() {
  'use strict';

  var currentUserId = null;

  console.log('[BOOST] Ad Boost System initializing...');

  /**
   * Show rewarded ad for boost - uses shared ad manager
   */
  function watchRewardedAd() {
    console.log('[BOOST] watchRewardedAd called');

    if (!window.showRewardedAd || !window.isRewardedAdReady || !window.isRewardedAdReady()) {
      showMessage('Ad system not ready. Please wait and try again.', 'warning');
      return;
    }

    closeAdBoostModal();

    // Use the shared ad manager from activity-ad-system.js
    // callback receives wasRewarded (true/false)
    window.showRewardedAd(function(wasRewarded) {
      console.log('[BOOST] Ad callback, rewarded=' + wasRewarded);

      if (wasRewarded) {
        console.log('[BOOST] Reward earned! Granting boost...');
        grantBoostReward();
      } else {
        showMessage('Watch the full ad to get the boost reward.', 'warning');
      }
    });
  }

  /**
   * Grant boost reward via server
   */
  function grantBoostReward() {

    var transactionId = 'ad_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    var _apiBase = (typeof window.getApiOrigin === 'function') ? window.getApiOrigin() : window.location.origin;
    var _sessionToken = (window.currentUser && (window.currentUser.sessionToken || window.currentUser.session_token)) || '';
    var _bearerToken = (window.currentUser && window.currentUser.token) || '';
    fetch(_apiBase + '/api/ad-boost/grant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + _bearerToken,
        'X-Session-Token': _sessionToken
      },
      body: JSON.stringify({
        userId: currentUserId,
        transactionId: transactionId,
        adCompleted: true,
        session_token: _sessionToken
      })
    })
    .then(function(response) {
      if (response.status === 429) {
        showMessage('Too many attempts. Please wait.', 'error');
        throw new Error('Rate limited');
      }
      return response.json();
    })
    .then(function(result) {
      if (result.success) {
        console.log('[BOOST] Server granted boost:', JSON.stringify(result));
        showMessage('Done! +1.2 MH/s boost active', 'success');

        if (window.localBoostData) {
          window.localBoostData.adBoostActive = true;
          window.localBoostData.multiplier += 0.12;
        }

        if (result.boostActive) {
          updateHashrateDisplay(1.2);
        }
      } else {
        console.error('[BOOST] Server rejected:', result.error);
        showMessage(result.error || 'Boost rejected', 'error');
      }
    })
    ['catch'](function(error) {
      console.error('[BOOST] Server error:', error);
      showMessage('Server connection failed. Try again.', 'error');
    });
  }

  /**
   * Show ad boost modal
   */
  function showAdBoostModal(userId) {
    currentUserId = userId;
    console.log('[BOOST] showAdBoostModal for user:', userId);

    var _apiBase = (typeof window.getApiOrigin === 'function') ? window.getApiOrigin() : window.location.origin;
    fetch(_apiBase + '/api/ad-boost/check?userId=' + userId)
    .then(function(response) { return response.json(); })
    .then(function(result) {
      console.log('[BOOST] Eligibility:', JSON.stringify(result));

      if (!result || !result.success) {
        showMessage('Failed to check eligibility', 'error');
        return;
      }

      var modal = document.getElementById('ad-boost-modal');
      if (!modal) {
        showMessage('Ad system not ready. Please refresh the page.', 'error');
        return;
      }

      modal.style.display = 'block';
      modal.style.visibility = 'visible';
      modal.style.opacity = '1';

      if (!result.eligible) {
        var watchButton = document.getElementById('watch-ad-button');
        if (watchButton) watchButton.style.display = 'none';

        if (result.reason === 'already_boosted_this_session') {
          showCooldownMessage(result.remainingSeconds || 0, result.reason);
        } else if (result.reason === 'not_mining') {
          showCooldownMessage(0, 'not_mining');
        } else if (result.reason === 'cooldown') {
          showCooldownMessage(result.remainingSeconds, 'cooldown');
        } else {
          showMessage(result.message || result.reason || 'Not eligible for ad boost', 'warning');
        }
      } else {
        var watchButton2 = document.getElementById('watch-ad-button');
        var cooldownDiv = document.getElementById('ad-cooldown-message');
        if (watchButton2) watchButton2.style.display = 'block';
        if (cooldownDiv) cooldownDiv.style.display = 'none';
        console.log('[BOOST] Modal ready - User can watch ad');
      }
    })
    ['catch'](function(error) {
      console.error('[BOOST] Error checking eligibility:', error);
      showMessage('Failed to check eligibility: ' + error.message, 'error');
    });
  }

  function closeAdBoostModal() {
    var modal = document.getElementById('ad-boost-modal');
    if (modal) modal.style.display = 'none';
  }

  window.closeAdBoostModalOnOutsideClick = function(event) {
    var modal = document.getElementById('ad-boost-modal');
    if (event.target === modal) closeAdBoostModal();
  };

  function showCooldownMessage(remainingSeconds, reason) {
    var cooldownDiv = document.getElementById('ad-cooldown-message');
    var messageContainer = document.getElementById('cooldown-message-container');
    var timeDisplay = document.getElementById('cooldown-time-display');

    if (cooldownDiv && messageContainer && timeDisplay) {
      var messageText = '';
      var timeText = '';
      var validSeconds = Math.max(0, Math.floor(remainingSeconds || 0));

      if (reason === 'already_boosted_this_session') {
        var hours1 = Math.floor(validSeconds / 3600);
        var minutes1 = Math.floor((validSeconds % 3600) / 60);
        messageText = (document.getElementById('ad-boost-cooldown-message') || {}).textContent || 'Ad boost active! Wait for session to end';
        timeText = validSeconds > 0 ? hours1.toString().padStart(2, '0') + 'h ' + minutes1.toString().padStart(2, '0') + 'm' : '00h 00m';
      } else if (reason === 'not_mining') {
        messageText = (document.getElementById('ad-boost-start-mining') || {}).textContent || 'Start activity first to watch an ad';
        timeText = '';
      } else if (reason === 'boost_pending') {
        messageText = 'Ad boost granted! Start mining to activate it.';
        timeText = '';
      } else {
        var hours2 = Math.floor(validSeconds / 3600);
        var minutes2 = Math.floor((validSeconds % 3600) / 60);
        messageText = (document.getElementById('ad-boost-wait-message') || {}).textContent || 'Wait to watch another ad';
        timeText = hours2.toString().padStart(2, '0') + 'h ' + minutes2.toString().padStart(2, '0') + 'm';
      }

      messageContainer.textContent = messageText;
      timeDisplay.textContent = timeText;
      timeDisplay.style.display = timeText ? 'block' : 'none';
      cooldownDiv.style.display = 'block';

      var watchBtn = document.getElementById('watch-ad-button');
      if (watchBtn) watchBtn.style.display = 'none';
    }
  }

  function updateHashrateDisplay(boostValue) {
    var hashrateValue = document.getElementById('dashboard-hashrate-value');
    if (hashrateValue) {
      var adBoostIncluded = hashrateValue.getAttribute('data-ad-boost-active') === 'true';
      if (!adBoostIncluded) {
        var currentValue = parseFloat(hashrateValue.textContent) || 10.0;
        var newValue = currentValue + boostValue;
        hashrateValue.textContent = newValue.toFixed(1);
        hashrateValue.setAttribute('data-ad-boost-active', 'true');
        hashrateValue.setAttribute('data-ad-boost-value', boostValue);
      }
    }

    var activityHashrateValue = document.getElementById('hashrate-value');
    var activityHashrateDisplay = document.getElementById('hashrate-display');
    if (activityHashrateValue && activityHashrateDisplay) {
      var adBoostIncluded2 = activityHashrateValue.getAttribute('data-ad-boost-active') === 'true';
      if (!adBoostIncluded2) {
        var currentActivityValue = parseFloat(activityHashrateValue.textContent) || 10.0;
        var newActivityValue = currentActivityValue + boostValue;
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
    var hashrateValue = document.getElementById('dashboard-hashrate-value');
    if (hashrateValue && hashrateValue.getAttribute('data-ad-boost-active') === 'true') {
      var adBoostValue = parseFloat(hashrateValue.getAttribute('data-ad-boost-value')) || 1.2;
      var currentValue = parseFloat(hashrateValue.textContent) || 10.0;
      var baseValue = currentValue - adBoostValue;
      hashrateValue.textContent = baseValue.toFixed(1);
      hashrateValue.removeAttribute('data-ad-boost-active');
      hashrateValue.removeAttribute('data-ad-boost-value');
      hashrateValue.style.color = '';
    }

    var activityHashrateValue = document.getElementById('hashrate-value');
    if (activityHashrateValue && activityHashrateValue.getAttribute('data-ad-boost-active') === 'true') {
      var adBoostValue2 = parseFloat(activityHashrateValue.getAttribute('data-ad-boost-value')) || 1.2;
      var currentValue2 = parseFloat(activityHashrateValue.textContent) || 10.0;
      var baseValue2 = currentValue2 - adBoostValue2;
      activityHashrateValue.textContent = baseValue2.toFixed(1);
      activityHashrateValue.removeAttribute('data-ad-boost-active');
      activityHashrateValue.removeAttribute('data-ad-boost-value');
      activityHashrateValue.style.color = '';
    }
  }

  function showMessage(message, type) {
    type = type || 'info';
    console.log('[BOOST][' + type.toUpperCase() + '] ' + message);
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
    }
  }

  function initializeAdBoostUI() {
    var hashrateDisplay = document.getElementById('dashboard-hashrate-display');
    if (hashrateDisplay) {
      hashrateDisplay.style.cursor = 'pointer';
      hashrateDisplay.title = 'Click to boost your XP/s with an ad!';

      var newHashrateDisplay = hashrateDisplay.cloneNode(true);
      hashrateDisplay.parentNode.replaceChild(newHashrateDisplay, hashrateDisplay);

      newHashrateDisplay.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        var userId = null;
        if (window.currentUser && window.currentUser.id) {
          userId = window.currentUser.id;
        } else {
          try {
            var savedUser = localStorage.getItem('accessoireUser');
            if (savedUser) userId = JSON.parse(savedUser).id;
          } catch (err) {}
        }

        if (userId) {
          showAdBoostModal(userId);
        } else {
          showMessage('Please log in to use ad boost', 'warning');
        }
      });

      newHashrateDisplay.classList.add('ad-boost-enabled');
    }

    var watchButton = document.getElementById('watch-ad-button');
    if (watchButton) {
      watchButton.onclick = function() {
        console.log('[BOOST] Watch Ad button clicked!');
        watchRewardedAd();
      };
    }

    var closeButton = document.getElementById('close-ad-modal-button');
    if (closeButton) {
      closeButton.addEventListener('click', closeAdBoostModal);
    }

    checkBoostStatus();
  }

  function checkBoostStatus() {
    var userId = window.currentUser && window.currentUser.id;

    var _apiBase = (typeof window.getApiOrigin === 'function') ? window.getApiOrigin() : window.location.origin;
    fetch(_apiBase + '/api/ad-boost/status?userId=' + userId)
    .then(function(response) { return response.json(); })
    .then(function(result) {
      if (result.success && result.exists && result.boostActive) {
        console.log('[BOOST] Ad boost is currently active');
      }
    })
    ['catch'](function(error) {
      console.error('[BOOST] Error checking boost status:', error);
    });
  }

  function verifyModalExists() {
    var modal = document.getElementById('ad-boost-modal');
    if (!modal) {
      console.error('[BOOST] ad-boost-modal not found in DOM!');
      return false;
    }
    console.log('[BOOST] ad-boost-modal verified');
    return true;
  }

  function checkAdBoostOnLoad() {
    if (!window.currentUser || !window.currentUser.id) return;

    var _apiBase = (typeof window.getApiOrigin === 'function') ? window.getApiOrigin() : window.location.origin;
    fetch(_apiBase + '/api/ad-boost/status?userId=' + window.currentUser.id)
    .then(function(response) { return response.json(); })
    .then(function(data) {
      if (data.success && data.boostActive) {
        updateHashrateDisplay(1.2);
      } else {
        resetHashrateDisplay();
      }
    })
    ['catch'](function(error) {
      console.error('[BOOST] Error checking ad boost status:', error);
    });
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
    var userId = null;
    if (window.currentUser && window.currentUser.id) {
      userId = window.currentUser.id;
    } else {
      try {
        var savedUser = localStorage.getItem('accessoireUser');
        if (savedUser) userId = JSON.parse(savedUser).id;
      } catch (err) {}
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

  console.log('[BOOST] Ad Boost System loaded (uses shared ad manager)');

})();
