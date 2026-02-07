/**
 * Activity Ad System - AdMob Rewarded Ads
 * Shows a rewarded ad when user starts activity or sends points
 * User can close the ad anytime - action proceeds on close
 * 
 * Test Ad Unit: ca-app-pub-3940256099942544/5224354917
 * Production:   ca-app-pub-3543981710825954/4821776631
 */

(function() {
  'use strict';

  // ===== CONFIGURATION =====
  // Google test rewarded ad unit (change to production when ready)
  const AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

  let activityAd = null;
  let adReady = false;
  let activityAdShowing = false;
  let adClosedCallback = null;
  let admobInitialized = false;

  console.log('🎬 Activity Ad System (AdMob) initializing...');

  /**
   * Initialize AdMob and create first rewarded ad
   */
  async function initAdMob() {
    if (typeof admob === 'undefined') {
      console.warn('⚠️ AdMob SDK not available');
      return;
    }

    try {
      if (typeof admob.start === 'function') {
        await admob.start();
      }
      admobInitialized = true;
      console.log('✅ AdMob SDK ready for Activity Ads');
      await createAndLoadAd();
    } catch (error) {
      console.error('❌ AdMob init error:', error);
    }
  }

  /**
   * Create a new RewardedAd instance and load it
   */
  async function createAndLoadAd() {
    if (!admobInitialized) return;

    try {
      activityAd = new admob.RewardedAd({
        adUnitId: AD_UNIT_ID,
      });

      // Ad loaded and ready to show
      activityAd.on('load', () => {
        adReady = true;
        console.log('✅ Activity rewarded ad loaded');
      });

      // Ad failed to load
      activityAd.on('loadfail', (evt) => {
        adReady = false;
        console.warn('⚠️ Activity ad load failed:', evt);
        setTimeout(createAndLoadAd, 30000);
      });

      // User earned reward (watched full ad)
      activityAd.on('reward', (evt) => {
        console.log('🎁 Activity ad reward earned:', evt);
      });

      // Ad dismissed (closed by user or after completion)
      activityAd.on('dismiss', () => {
        console.log('📱 Activity ad dismissed');
        activityAdShowing = false;
        adReady = false;

        // Call callback regardless - activity ad doesn't require completion
        if (adClosedCallback && typeof adClosedCallback === 'function') {
          console.log('📺 Executing callback after ad close');
          adClosedCallback();
          adClosedCallback = null;
        }

        // Pre-load next ad
        setTimeout(createAndLoadAd, 1000);
      });

      // Ad failed to show
      activityAd.on('showfail', (evt) => {
        console.error('❌ Activity ad show failed:', evt);
        activityAdShowing = false;
        adReady = false;

        if (adClosedCallback && typeof adClosedCallback === 'function') {
          adClosedCallback();
          adClosedCallback = null;
        }

        setTimeout(createAndLoadAd, 5000);
      });

      // Load the ad
      await activityAd.load();
      console.log('📺 Activity ad loading...');

    } catch (error) {
      console.error('❌ Error creating activity ad:', error);
      adReady = false;
      setTimeout(createAndLoadAd, 30000);
    }
  }

  /**
   * Show activity ad before proceeding with action
   * @param {Function} callback - Called after ad is closed or if ad unavailable
   */
  window.showActivityAd = async function(callback) {
    if (activityAdShowing) {
      console.log('Activity Ad already showing');
      if (callback && typeof callback === 'function') {
        callback();
      }
      return false;
    }

    if (callback && typeof callback === 'function') {
      adClosedCallback = callback;
    }

    console.log('📺 showActivityAd, adReady:', adReady);

    // If ad not ready, skip and proceed
    if (!adReady || !activityAd) {
      console.warn('⚠️ Ad not ready - proceeding without ad');
      if (adClosedCallback) {
        adClosedCallback();
        adClosedCallback = null;
      }
      if (admobInitialized) createAndLoadAd();
      return true;
    }

    try {
      activityAdShowing = true;
      await activityAd.show();
      console.log('✅ Activity Ad shown');
    } catch (error) {
      console.error('❌ Error showing activity ad:', error);
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
  document.addEventListener('deviceready', () => {
    setTimeout(initAdMob, 500);
  }, false);

  // Fallback for browser testing (no Cordova)
  setTimeout(() => {
    if (!admobInitialized && typeof admob !== 'undefined') {
      initAdMob();
    } else if (!admobInitialized) {
      console.log('ℹ️ Activity AdMob not available (browser mode)');
    }
  }, 5000);

  console.log('✅ Activity Ad System (AdMob) loaded');
})();
