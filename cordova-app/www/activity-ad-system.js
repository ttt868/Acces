/**
 * Activity Ad System - cordova-plugin-ads (cozycodegh)
 * Shows a rewarded ad when user starts activity or sends points
 * User can close the ad anytime - action proceeds on close
 * 
 * Plugin: cordova-plugin-ads (survives app background/resume)
 * Test Ad Unit: ca-app-pub-3940256099942544/5224354917
 * Production:   ca-app-pub-3543981710825954/4821776631
 */

(function() {
  'use strict';

  const AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

  let adReady = false;
  let adLoading = false;
  let activityAdShowing = false;
  let adClosedCallback = null;
  let adMobAvailable = false;
  let initAttempts = 0;
  let loadFailCount = 0;
  const MAX_INIT_ATTEMPTS = 10;

  /**
   * Load a rewarded ad using cordova-plugin-ads API
   * adMob.rewarded(id) → promise resolves when ad is ready
   */
  async function loadRewardedAd() {
    if (adLoading || adReady) return;
    adLoading = true;

    try {
      if (typeof adMob === 'undefined') {
        adLoading = false;
        return;
      }
      adMobAvailable = true;

      console.log('🔄 Loading activity rewarded ad...');
      await adMob.rewarded(AD_UNIT_ID);
      
      adReady = true;
      adLoading = false;
      loadFailCount = 0;
      console.log('✅ Activity rewarded ad loaded and ready');

    } catch (error) {
      console.warn('⚠️ Activity ad load failed:', error);
      adReady = false;
      adLoading = false;
      loadFailCount++;
      var delay = Math.min(5000 * loadFailCount, 20000);
      setTimeout(loadRewardedAd, delay);
    }
  }

  /**
   * Initialize - wait for adMob object to be available
   */
  function initAdMob() {
    initAttempts++;
    if (typeof adMob === 'undefined') {
      if (initAttempts < MAX_INIT_ATTEMPTS) {
        setTimeout(initAdMob, 3000);
      }
      return;
    }
    adMobAvailable = true;
    console.log('✅ cordova-plugin-ads available for activity ads');
    loadRewardedAd();
  }

  /**
   * Show rewarded ad for activity/send action
   * adMob.showRewarded() → returns {rewarded: bool, amount: N, type: "..."}
   */
  window.showActivityAd = async function(callback) {
    if (activityAdShowing) {
      if (callback) callback();
      return false;
    }

    if (callback) adClosedCallback = callback;

    // If ad not ready, proceed with callback immediately
    if (!adReady || !adMobAvailable) {
      if (adClosedCallback) {
        adClosedCallback();
        adClosedCallback = null;
      }
      if (adMobAvailable && !adLoading) loadRewardedAd();
      return true;
    }

    try {
      activityAdShowing = true;
      adReady = false;
      console.log('📺 Showing activity rewarded ad...');
      
      // showRewarded returns reward info when ad is dismissed
      var reward = await adMob.showRewarded();
      
      activityAdShowing = false;
      console.log('📺 Activity ad closed, reward:', JSON.stringify(reward));

      if (reward && reward.rewarded) {
        console.log('🎁 Activity ad reward earned');
      }

      // Execute callback after ad is dismissed (whether rewarded or not)
      if (adClosedCallback && typeof adClosedCallback === 'function') {
        try { adClosedCallback(); } catch(e) { console.error('Callback error:', e); }
        adClosedCallback = null;
      }

      // Pre-load next ad
      setTimeout(loadRewardedAd, 1000);

    } catch (error) {
      console.error('❌ Activity ad show error:', error);
      activityAdShowing = false;
      adReady = false;

      if (adClosedCallback) {
        adClosedCallback();
        adClosedCallback = null;
      }
      setTimeout(loadRewardedAd, 3000);
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

  // Initialize on deviceready
  document.addEventListener('deviceready', function() {
    setTimeout(initAdMob, 800);
  }, false);

  // Fallback
  setTimeout(function() {
    if (!adMobAvailable && typeof adMob !== 'undefined') {
      initAdMob();
    }
  }, 6000);

})();
