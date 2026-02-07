/**
 * Activity Ad System - AdMob Rewarded Ads (Cordova)
 * Shows a rewarded ad when user starts activity or sends points
 * User can close the ad anytime - action proceeds on close
 * 
 * Test Ad Unit: ca-app-pub-3940256099942544/5224354917
 * Production:   ca-app-pub-3543981710825954/4821776631
 */

(function() {
  'use strict';

  // ===== CONFIGURATION =====
  const AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

  let activityAd = null;
  let adReady = false;
  let activityAdShowing = false;
  let adClosedCallback = null;
  let admobAvailable = false;
  let initAttempts = 0;
  const MAX_INIT_ATTEMPTS = 5;

  // ===== VISUAL DEBUG PANEL =====
  function updateAdStatus(msg, color) {
    color = color || '#888';
    console.log('[AdStatus] ' + msg);
    var el = document.getElementById('ad-debug-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ad-debug-status';
      el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;padding:6px 10px;font-size:11px;font-family:monospace;color:#fff;text-align:center;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.style.background = color;
    el.textContent = '📺 ' + msg;
  }

  updateAdStatus('Ad system loading...', '#555');

  // ===== INITIALIZE =====
  async function initAdMob() {
    initAttempts++;
    updateAdStatus('Init attempt #' + initAttempts + '...', '#666');

    if (typeof admob === 'undefined') {
      updateAdStatus('ERROR: admob object not found! Plugin not loaded.', '#c00');
      if (initAttempts < MAX_INIT_ATTEMPTS) {
        setTimeout(initAdMob, 5000);
      }
      return;
    }

    try {
      updateAdStatus('admob found! Calling admob.start()...', '#996600');

      if (typeof admob.start === 'function') {
        await admob.start();
        updateAdStatus('admob.start() OK! Creating ad...', '#996600');
      }

      admobAvailable = true;
      await createAndLoadAd();
    } catch (error) {
      updateAdStatus('ERROR in start: ' + (error.message || error), '#c00');
      if (initAttempts < MAX_INIT_ATTEMPTS) {
        setTimeout(initAdMob, 10000);
      }
    }
  }

  // ===== CREATE AND LOAD AD =====
  async function createAndLoadAd() {
    if (!admobAvailable) return;

    try {
      updateAdStatus('Creating RewardedAd...', '#996600');

      activityAd = new admob.RewardedAd({
        adUnitId: AD_UNIT_ID,
      });

      activityAd.on('load', function() {
        adReady = true;
        updateAdStatus('Ad LOADED - Ready to show!', '#080');
      });

      activityAd.on('loadfail', function(evt) {
        adReady = false;
        var errMsg = '';
        try { errMsg = JSON.stringify(evt); } catch(e) { errMsg = String(evt); }
        updateAdStatus('Ad LOAD FAILED: ' + errMsg, '#c00');
        setTimeout(createAndLoadAd, 30000);
      });

      activityAd.on('reward', function() {
        updateAdStatus('Reward earned!', '#080');
      });

      activityAd.on('dismiss', function() {
        activityAdShowing = false;
        adReady = false;
        updateAdStatus('Ad dismissed. Reloading...', '#996600');

        if (adClosedCallback && typeof adClosedCallback === 'function') {
          try { adClosedCallback(); } catch(e) {}
          adClosedCallback = null;
        }
        setTimeout(createAndLoadAd, 2000);
      });

      activityAd.on('show', function() {
        updateAdStatus('Ad SHOWING on screen!', '#080');
      });

      activityAd.on('showfail', function(evt) {
        activityAdShowing = false;
        adReady = false;
        var errMsg = '';
        try { errMsg = JSON.stringify(evt); } catch(e) { errMsg = String(evt); }
        updateAdStatus('Ad SHOW FAILED: ' + errMsg, '#c00');

        if (adClosedCallback && typeof adClosedCallback === 'function') {
          adClosedCallback();
          adClosedCallback = null;
        }
        setTimeout(createAndLoadAd, 5000);
      });

      updateAdStatus('Loading ad from Google...', '#996600');
      await activityAd.load();
      updateAdStatus('load() called - waiting for response...', '#996600');

    } catch (error) {
      updateAdStatus('ERROR creating ad: ' + (error.message || error), '#c00');
      adReady = false;
      setTimeout(createAndLoadAd, 30000);
    }
  }

  // ===== SHOW AD =====
  window.showActivityAd = async function(callback) {
    if (activityAdShowing) {
      if (callback) callback();
      return false;
    }

    if (callback) adClosedCallback = callback;

    if (!adReady || !activityAd) {
      updateAdStatus('Ad not ready - skipping', '#c80');
      if (adClosedCallback) {
        adClosedCallback();
        adClosedCallback = null;
      }
      if (admobAvailable) createAndLoadAd();
      return true;
    }

    try {
      activityAdShowing = true;
      updateAdStatus('Showing ad...', '#996600');
      await activityAd.show();
    } catch (error) {
      updateAdStatus('Show error: ' + (error.message || error), '#c00');
      activityAdShowing = false;
      adReady = false;
      if (adClosedCallback) {
        adClosedCallback();
        adClosedCallback = null;
      }
      createAndLoadAd();
    }
    return true;
  };

  window.canShowActivityAd = function() {
    return !activityAdShowing && adReady;
  };

  window.showSendAd = function(callback) {
    return window.showActivityAd(callback);
  };

  window.canShowSendAd = function() {
    return window.canShowActivityAd();
  };

  // Initialize on Cordova deviceready
  document.addEventListener('deviceready', function() {
    updateAdStatus('deviceready! Starting AdMob in 1s...', '#996600');
    setTimeout(initAdMob, 1000);
  }, false);

  // Fallback if deviceready already fired
  setTimeout(function() {
    if (!admobAvailable) {
      if (typeof admob !== 'undefined') {
        updateAdStatus('Fallback init (admob found)', '#996600');
        initAdMob();
      } else {
        updateAdStatus('admob not available after 8s', '#c00');
      }
    }
  }, 8000);

})();
