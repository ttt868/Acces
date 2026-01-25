/**
 * Activity Ad System - نظام إعلانات موحد
 * يستخدم لـ Start Activity و Send Points
 */

(function() {
  'use strict';

  window.googletag = window.googletag || { cmd: [] };

  let activityRewardedSlot = null;
  let activityAdShowing = false;
  let adClosedCallback = null;
  
  let activityAdUnitId = '/22639388115/rewarded_web_example';
  
  fetch('/api/ad-config')
    .then(res => res.json())
    .then(data => {
      if (data.success && data.adUnitId) {
        activityAdUnitId = data.adUnitId;
        console.log('✅ Activity Ad: تم تحميل معرف الإعلان');
      }
    })
    .catch(() => {
      console.log('⚠️ Activity Ad: استخدام القيمة الافتراضية');
    });

  function initializeActivityAd() {
    googletag.cmd.push(() => {
      if (activityRewardedSlot) {
        return;
      }
      
      activityRewardedSlot = googletag.defineOutOfPageSlot(
        activityAdUnitId,
        googletag.enums.OutOfPageFormat.REWARDED
      );

      if (activityRewardedSlot) {
        activityRewardedSlot.addService(googletag.pubads());

        googletag.pubads().addEventListener('rewardedSlotReady', (event) => {
          if (event.slot === activityRewardedSlot) {
            console.log('✅ Activity Ad جاهز');
            window.activityAdEvent = event;
          }
        });

        googletag.pubads().addEventListener('rewardedSlotClosed', (event) => {
          if (event.slot === activityRewardedSlot) {
            console.log('✅ Activity Ad تم إغلاقه');
            activityAdShowing = false;
            
            if (adClosedCallback && typeof adClosedCallback === 'function') {
              console.log('📺 تنفيذ callback بعد إغلاق الإعلان');
              adClosedCallback();
              adClosedCallback = null;
            }
            
            googletag.destroySlots([activityRewardedSlot]);
            activityRewardedSlot = null;
            window.activityAdEvent = null;
            
            // ⚡ إعادة تهيئة فورية للإعلان التالي
            initializeActivityAd();
          }
        });

        googletag.pubads().addEventListener('slotRenderEnded', (event) => {
          if (event.slot === activityRewardedSlot && event.isEmpty) {
            console.warn('⚠️ Activity Ad: لا يوجد إعلان متاح');
            activityAdShowing = false;
            
            if (adClosedCallback && typeof adClosedCallback === 'function') {
              console.log('📺 لا يوجد إعلان - تنفيذ callback مباشرة');
              adClosedCallback();
              adClosedCallback = null;
            }
          }
        });

        googletag.enableServices();
        googletag.display(activityRewardedSlot);
      }
    });
  }

  initializeActivityAd();

  window.showActivityAd = function(callback) {
    if (activityAdShowing) {
      console.log('Activity Ad معروض بالفعل');
      return false;
    }

    if (callback && typeof callback === 'function') {
      adClosedCallback = callback;
    }

    console.log('📺 عرض Activity Ad...');
    
    if (window.activityAdEvent) {
      window.activityAdEvent.makeRewardedVisible();
      activityAdShowing = true;
      console.log('✅ Activity Ad تم عرضه');
      return true;
    } else {
      console.warn('⚠️ Activity Ad غير جاهز بعد - جاري الانتظار...');
      // ✅ انتظار الإعلان لمدة 3 ثواني
      let waitAttempts = 0;
      const maxAttempts = 30; // 30 × 100ms = 3 ثواني
      
      const waitForAd = setInterval(() => {
        waitAttempts++;
        console.log(`📺 انتظار الإعلان... محاولة ${waitAttempts}/${maxAttempts}`);
        
        if (window.activityAdEvent) {
          clearInterval(waitForAd);
          window.activityAdEvent.makeRewardedVisible();
          activityAdShowing = true;
          console.log('✅ Activity Ad تم عرضه بعد الانتظار');
        } else if (waitAttempts >= maxAttempts) {
          clearInterval(waitForAd);
          console.warn('⚠️ الإعلان لم يتحمل - تنفيذ callback');
          if (adClosedCallback) {
            adClosedCallback();
            adClosedCallback = null;
          }
        }
      }, 100);
      
      return true; // نعتبره ناجح لأننا ننتظر
    }
  };

  window.canShowActivityAd = function() {
    return !activityAdShowing && window.activityAdEvent;
  };

  window.showSendAd = function(callback) {
    return window.showActivityAd(callback);
  };

  window.canShowSendAd = function() {
    return window.canShowActivityAd();
  };

})();
