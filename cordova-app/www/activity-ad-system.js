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

  const AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

  let activityAd = null;
  let adReady = false;
  let adLoading = false;      // prevents double load requests
  let activityAdShowing = false;
  let adClosedCallback = null;
  let admobAvailable = false;
  let initAttempts = 0;
  let loadFailCount = 0;
  const MAX_INIT_ATTEMPTS = 10;

  async function initAdMob() {
    initAttempts++;
    if (typeof admob === 'undefined') {
      if (initAttempts < MAX_INIT_ATTEMPTS) {
        setTimeout(initAdMob, 3000);
      }
      return;
    }

    try {
      if (typeof admob.start === 'function') {
        await admob.start();
      }
      admobAvailable = true;
      console.log('✅ AdMob SDK ready');
      createAndLoadAd();
    } catch (error) {
      console.error('❌ AdMob init error:', error);
      if (initAttempts < MAX_INIT_ATTEMPTS) {
        setTimeout(initAdMob, 5000);
      }
    }
  }

  async function createAndLoadAd() {
    if (!admobAvailable || adLoading || adReady) return;
    adLoading = true;

    try {
      activityAd = new admob.RewardedAd({ adUnitId: AD_UNIT_ID });

      activityAd.on('load', function() {
        adReady = true;
        adLoading = false;
        loadFailCount = 0;
        console.log('✅ Activity ad loaded');
      });

      activityAd.on('loadfail', function(evt) {
        adReady = false;
        adLoading = false;
        loadFailCount++;
        console.warn('⚠️ Activity ad load failed, attempt #' + loadFailCount);
        // Faster retry: 5s, 10s, 15s, max 20s
        var delay = Math.min(5000 * loadFailCount, 20000);
        setTimeout(createAndLoadAd, delay);
      });

      activityAd.on('reward', function() {
        console.log('🎁 Activity ad reward earned');
      });

      activityAd.on('dismiss', function() {
        activityAdShowing = false;
        adReady = false;
        adLoading = false;

        if (adClosedCallback && typeof adClosedCallback === 'function') {
          try { adClosedCallback(); } catch(e) {}
          adClosedCallback = null;
        }
        // Pre-load next ad quickly
        setTimeout(createAndLoadAd, 1000);
      });

      activityAd.on('show', function() {
        console.log('📺 Activity ad showing');
      });

      activityAd.on('showfail', function(evt) {
        activityAdShowing = false;
        adReady = false;
        adLoading = false;
        if (adClosedCallback && typeof adClosedCallback === 'function') {
          adClosedCallback();
          adClosedCallback = null;
        }
        setTimeout(createAndLoadAd, 3000);
      });

      await activityAd.load();

    } catch (error) {
      console.error('❌ Activity ad error:', error);
      adReady = false;
      adLoading = false;
      loadFailCount++;
      var delay = Math.min(5000 * loadFailCount, 20000);
      setTimeout(createAndLoadAd, delay);
    }
  }

  window.showActivityAd = async function(callback) {
    if (activityAdShowing) {
      if (callback) callback();
      return false;
    }

    if (callback) adClosedCallback = callback;

    if (!adReady || !activityAd) {
      if (adClosedCallback) {
        adClosedCallback();
        adClosedCallback = null;
      }
      if (admobAvailable && !adLoading) createAndLoadAd();
      return true;
    }

    try {
      activityAdShowing = true;
      await activityAd.show();
    } catch (error) {
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

  document.addEventListener('deviceready', function() {
    setTimeout(initAdMob, 800);
  }, false);

  setTimeout(function() {
    if (!admobAvailable && typeof admob !== 'undefined') {
      initAdMob();
    }
  }, 6000);

})();
