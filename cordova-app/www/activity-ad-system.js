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
  const AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917'; // Google test rewarded ad

  let activityAd = null;
  let adReady = false;
  let activityAdShowing = false;
  let adClosedCallback = null;
  let admobAvailable = false;
  let initAttempts = 0;
  const MAX_INIT_ATTEMPTS = 5;

  console.log('🎬 Activity Ad System (AdMob) initializing...');
  console.log('🎬 Ad Unit ID:', AD_UNIT_ID);

  /**
   * Initialize AdMob and create first rewarded ad
   */
  async function initAdMob() {
    initAttempts++;
    console.log('🎬 initAdMob attempt #' + initAttempts);

    // Check if admob global is available (from admob-plus-cordova plugin)
    if (typeof admob === 'undefined') {
      console.warn('⚠️ AdMob SDK not available (admob is undefined)');
      console.warn('⚠️ This may mean the plugin is not installed or deviceready has not fired');
      if (initAttempts < MAX_INIT_ATTEMPTS) {
        console.log('🔄 Will retry in 5s...');
        setTimeout(initAdMob, 5000);
      }
      return;
    }

    try {
      console.log('🎬 admob object found:', typeof admob);
      console.log('🎬 admob.start:', typeof admob.start);
      console.log('🎬 admob.RewardedAd:', typeof admob.RewardedAd);

      // Start the AdMob SDK
      if (typeof admob.start === 'function') {
        console.log('🎬 Calling admob.start()...');
        await admob.start();
        console.log('✅ admob.start() completed');
      }

      admobAvailable = true;
      console.log('✅ AdMob SDK ready for Activity Ads');
      await createAndLoadAd();
    } catch (error) {
      console.error('❌ AdMob init error:', error);
      console.error('❌ Error details:', JSON.stringify(error));
      if (initAttempts < MAX_INIT_ATTEMPTS) {
        setTimeout(initAdMob, 10000);
      }
    }
  }

  /**
   * Create a new RewardedAd instance and load it
   */
  async function createAndLoadAd() {
    if (!admobAvailable) {
      console.warn('⚠️ createAndLoadAd: admob not available');
      return;
    }

    try {
      console.log('📺 Creating RewardedAd with unit:', AD_UNIT_ID);

      activityAd = new admob.RewardedAd({
        adUnitId: AD_UNIT_ID,
      });

      console.log('📺 RewardedAd instance created, id:', activityAd.id);

      // Ad loaded and ready to show
      activityAd.on('load', function(evt) {
        adReady = true;
        console.log('✅ Activity rewarded ad LOADED and ready');
      });

      // Ad failed to load
      activityAd.on('loadfail', function(evt) {
        adReady = false;
        console.warn('⚠️ Activity ad LOAD FAILED:', JSON.stringify(evt));
        setTimeout(createAndLoadAd, 30000);
      });

      // User earned reward (watched full ad)
      activityAd.on('reward', function(evt) {
        console.log('🎁 Activity ad reward earned');
      });

      // Ad dismissed (closed by user or after completion)
      activityAd.on('dismiss', function() {
        console.log('📱 Activity ad DISMISSED');
        activityAdShowing = false;
        adReady = false;

        // Call callback regardless - activity ad doesn't require completion
        if (adClosedCallback && typeof adClosedCallback === 'function') {
          console.log('📺 Executing callback after ad close');
          try {
            adClosedCallback();
          } catch (e) {
            console.error('❌ Callback error:', e);
          }
          adClosedCallback = null;
        }

        // Pre-load next ad
        setTimeout(createAndLoadAd, 2000);
      });

      // Ad shown
      activityAd.on('show', function() {
        console.log('📺 Activity ad NOW SHOWING on screen');
      });

      // Ad failed to show
      activityAd.on('showfail', function(evt) {
        console.error('❌ Activity ad SHOW FAILED:', JSON.stringify(evt));
        activityAdShowing = false;
        adReady = false;

        if (adClosedCallback && typeof adClosedCallback === 'function') {
          adClosedCallback();
          adClosedCallback = null;
        }

        setTimeout(createAndLoadAd, 5000);
      });

      // Load the ad
      console.log('📺 Calling activityAd.load()...');
      await activityAd.load();
      console.log('📺 activityAd.load() call completed (waiting for load event)');

    } catch (error) {
      console.error('❌ Error creating/loading activity ad:', error);
      console.error('❌ Error details:', JSON.stringify(error));
      adReady = false;
      setTimeout(createAndLoadAd, 30000);
    }
  }

  /**
   * Show activity ad before proceeding with action
   * @param {Function} callback - Called after ad is closed or if ad unavailable
   */
  window.showActivityAd = async function(callback) {
    console.log('📺 showActivityAd called, adReady:', adReady, 'admobAvailable:', admobAvailable, 'showing:', activityAdShowing);

    if (activityAdShowing) {
      console.log('⚠️ Activity Ad already showing');
      if (callback && typeof callback === 'function') {
        callback();
      }
      return false;
    }

    if (callback && typeof callback === 'function') {
      adClosedCallback = callback;
    }

    // If ad not ready, skip and proceed immediately
    if (!adReady || !activityAd) {
      console.warn('⚠️ Ad not ready - proceeding without ad');
      if (adClosedCallback) {
        adClosedCallback();
        adClosedCallback = null;
      }
      if (admobAvailable) createAndLoadAd();
      return true;
    }

    try {
      activityAdShowing = true;
      console.log('📺 Calling activityAd.show()...');
      await activityAd.show();
      console.log('📺 activityAd.show() call completed');
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
  document.addEventListener('deviceready', function() {
    console.log('🎬 deviceready fired - will init AdMob in 500ms');
    setTimeout(initAdMob, 500);
  }, false);

  // Fallback: retry if deviceready already fired or we're in a browser
  setTimeout(function() {
    if (!admobAvailable) {
      if (typeof admob !== 'undefined') {
        console.log('🎬 Fallback init: admob found after timeout');
        initAdMob();
      } else {
        console.log('ℹ️ Activity AdMob not available (admob object not found after 5s)');
      }
    }
  }, 5000);

  console.log('✅ Activity Ad System (AdMob) script loaded');
})();
