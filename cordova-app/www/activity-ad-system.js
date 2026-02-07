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
  // Change to production ID when AdMob account is approved
  const AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

  let activityAd = null;
  let adReady = false;
  let activityAdShowing = false;
  let adClosedCallback = null;
  let admobAvailable = false;
  let initAttempts = 0;
  const MAX_INIT_ATTEMPTS = 5;

  async function initAdMob() {
    initAttempts++;
    if (typeof admob === 'undefined') {
      if (initAttempts < MAX_INIT_ATTEMPTS) {
        setTimeout(initAdMob, 5000);
      }
      return;
    }

    try {
      if (typeof admob.start === 'function') {
        await admob.start();
      }
      admobAvailable = true;
      console.log('✅ AdMob SDK ready');
      await createAndLoadAd();
    } catch (error) {
      console.error('❌ AdMob init error:', error);
      if (initAttempts < MAX_INIT_ATTEMPTS) {
        setTimeout(initAdMob, 10000);
      }
    }
  }

  async function createAndLoadAd() {
    if (!admobAvailable) return;

    try {
      activityAd = new admob.RewardedAd({
        adUnitId: AD_UNIT_ID,
      });

      activityAd.on('load', function() {
        adReady = true;
        console.log('✅ Activity ad loaded');
      });

      activityAd.on('loadfail', function(evt) {
        adReady = false;
        console.warn('⚠️ Activity ad load failed');
        setTimeout(createAndLoadAd, 30000);
      });

      activityAd.on('reward', function() {
        console.log('🎁 Activity ad reward earned');
      });

      activityAd.on('dismiss', function() {
        activityAdShowing = false;
        adReady = false;

        if (adClosedCallback && typeof adClosedCallback === 'function') {
          try { adClosedCallback(); } catch(e) {}
          adClosedCallback = null;
        }
        setTimeout(createAndLoadAd, 2000);
      });

      activityAd.on('show', function() {
        console.log('📺 Activity ad showing');
      });

      activityAd.on('showfail', function(evt) {
        activityAdShowing = false;
        adReady = false;
        if (adClosedCallback && typeof adClosedCallback === 'function') {
          adClosedCallback();
          adClosedCallback = null;
        }
        setTimeout(createAndLoadAd, 5000);
      });

      await activityAd.load();

    } catch (error) {
      console.error('❌ Activity ad error:', error);
      adReady = false;
      setTimeout(createAndLoadAd, 30000);
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
      if (admobAvailable) createAndLoadAd();
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
    setTimeout(initAdMob, 1000);
  }, false);

  setTimeout(function() {
    if (!admobAvailable && typeof admob !== 'undefined') {
      initAdMob();
    }
  }, 8000);

})();
