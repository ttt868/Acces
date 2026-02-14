/**
 * Activity Ad System - SINGLE rewarded ad manager for cordova-plugin-ads
 * This is the ONLY file that loads/shows rewarded ads.
 * ad-boost-system.js uses window.showRewardedAd() from here.
 *
 * Plugin: cordova-plugin-ads v2.0.5 (cozycodegh)
 * API: adMob.rewarded(id) -> load, adMob.showRewarded() -> show
 * 
 * Test Ad Unit: ca-app-pub-3940256099942544/5224354917
 * Production:   ca-app-pub-3543981710825954/4821776631
 */

(function() {
  'use strict';

  var AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

  var adReady = false;
  var adLoading = false;
  var adShowing = false;
  var adMobAvailable = false;
  var initAttempts = 0;
  var loadFailCount = 0;
  var MAX_INIT_ATTEMPTS = 15;

  // ========== CORE AD FUNCTIONS ==========

  /**
   * Load a rewarded ad. Only ONE can be loaded at a time.
   */
  function loadRewardedAd() {
    if (adLoading || adReady || adShowing) return;

    if (typeof adMob === 'undefined') {
      console.log('[AD] adMob not available yet');
      return;
    }

    adMobAvailable = true;
    adLoading = true;
    console.log('[AD] Loading rewarded ad...');

    adMob.rewarded(AD_UNIT_ID).then(function() {
      adReady = true;
      adLoading = false;
      loadFailCount = 0;
      console.log('[AD] Rewarded ad LOADED and ready');
    })['catch'](function(err) {
      console.warn('[AD] Load failed:', JSON.stringify(err));
      adReady = false;
      adLoading = false;
      loadFailCount++;
      var delay = Math.min(5000 * loadFailCount, 30000);
      setTimeout(loadRewardedAd, delay);
    });
  }

  /**
   * Initialize - poll for adMob availability then load first ad
   */
  function initAdMob() {
    initAttempts++;
    if (typeof adMob === 'undefined') {
      if (initAttempts < MAX_INIT_ATTEMPTS) {
        console.log('[AD] Waiting for adMob... attempt ' + initAttempts);
        setTimeout(initAdMob, 2000);
      } else {
        console.error('[AD] adMob never became available after ' + MAX_INIT_ATTEMPTS + ' attempts');
      }
      return;
    }
    adMobAvailable = true;
    console.log('[AD] cordova-plugin-ads available');
    loadRewardedAd();
  }

  // ========== PUBLIC API ==========

  /**
   * Show a rewarded ad. callback(wasRewarded) fires when ad is dismissed.
   * If ad not ready, callback fires immediately with false.
   * Returns true/false synchronously.
   */
  window.showRewardedAd = function(callback) {
    console.log('[AD] showRewardedAd called, ready=' + adReady + ', showing=' + adShowing);

    if (adShowing) {
      if (callback) callback(false);
      return false;
    }

    if (!adReady || !adMobAvailable) {
      console.log('[AD] Ad not ready, proceeding without ad');
      if (callback) callback(false);
      if (adMobAvailable && !adLoading) loadRewardedAd();
      return false;
    }

    adShowing = true;
    adReady = false;
    window._watchingAd = true;
    console.log('[AD] Showing rewarded ad...');

    adMob.showRewarded().then(function(reward) {
      adShowing = false;
      // Keep _watchingAd true for 5s so resume event doesn't trigger PIN
      window._adFinishedAt = Date.now();
      setTimeout(function() { window._watchingAd = false; }, 5000);
      var wasRewarded = !!(reward && reward.rewarded);
      console.log('[AD] Ad dismissed, rewarded=' + wasRewarded);
      if (callback) {
        try { callback(wasRewarded); } catch(e) { console.error('[AD] Callback error:', e); }
      }
      setTimeout(loadRewardedAd, 1000);
    })['catch'](function(err) {
      console.error('[AD] Show error:', JSON.stringify(err));
      adShowing = false;
      adReady = false;
      // Keep _watchingAd true for 5s so resume event doesn't trigger PIN
      window._adFinishedAt = Date.now();
      setTimeout(function() { window._watchingAd = false; }, 5000);
      if (callback) {
        try { callback(false); } catch(e) { console.error('[AD] Callback error:', e); }
      }
      setTimeout(loadRewardedAd, 3000);
    });

    return true;
  };

  /**
   * Legacy aliases used by script.js
   */
  window.showActivityAd = function(callback) {
    return window.showRewardedAd(function() {
      if (callback) callback();
    });
  };

  window.canShowActivityAd = function() {
    return !adShowing && adReady && adMobAvailable;
  };

  window.showSendAd = function(callback) {
    return window.showActivityAd(callback);
  };

  window.canShowSendAd = function() {
    return window.canShowActivityAd();
  };

  window.isRewardedAdReady = function() {
    return !adShowing && adReady && adMobAvailable;
  };

  window.reloadRewardedAd = function() {
    if (!adLoading && !adReady && !adShowing) {
      loadRewardedAd();
    }
  };

  // ========== LIFECYCLE - Background/Foreground tracking ==========
  var wentToBackgroundWhileAdShowing = false;

  document.addEventListener('pause', function() {
    if (adShowing) {
      wentToBackgroundWhileAdShowing = true;
      console.log('[AD] App went to background while ad is showing');
    }
  }, false);

  document.addEventListener('resume', function() {
    console.log('[AD] App resumed, adShowing=' + adShowing + ', wentToBg=' + wentToBackgroundWhileAdShowing);
    if (wentToBackgroundWhileAdShowing) {
      wentToBackgroundWhileAdShowing = false;
      // Native Java plugin handles deferred callback via onResume
      // If ad survived (AdActivity alive), it will continue playing
      // If not, deferred callback will resolve the JS promise
      console.log('[AD] Was showing ad before background - native plugin handles it');
    }
    // Ensure an ad is preloaded for next time
    if (!adReady && !adLoading && !adShowing) {
      setTimeout(loadRewardedAd, 2000);
    }
  }, false);

  // ========== INIT ==========
  document.addEventListener('deviceready', function() {
    console.log('[AD] deviceready - initializing in 500ms...');
    setTimeout(initAdMob, 500);
  }, false);

  setTimeout(function() {
    if (!adMobAvailable && typeof adMob !== 'undefined') {
      console.log('[AD] Fallback init');
      initAdMob();
    }
  }, 5000);

  console.log('[AD] activity-ad-system.js loaded (single ad manager, background-safe)');
})();
