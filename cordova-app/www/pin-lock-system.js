// ========== PIN LOCK SYSTEM ==========
// Professional app lock with 6-digit PIN and biometric support
// Similar to Trust Wallet / Binance style

(function() {
  'use strict';

  // ===== STATE =====
  let pinInput = '';
  let setupPin = '';
  let setupStep = 'new'; // 'new' | 'confirm' | 'current' | 'change-new' | 'change-confirm' | 'disable'
  let pinEnabled = false;
  let biometricEnabled = false;
  let biometricAvailable = false;
  let isLocked = false;
  let pinSetupCallback = null;

  // ===== API HELPERS =====
  function getApiBase() {
    return (typeof window.getApiOrigin === 'function') ? window.getApiOrigin() : 'https://accesschain.org';
  }

  function getUserId() {
    const user = window.currentUser;
    return user ? user.id : null;
  }

  // ===== PIN STATUS =====
  async function loadPinStatus() {
    try {
      const userId = getUserId();
      if (!userId) return;

      // Check biometric availability early (before lock screen might show)
      await checkBiometricAvailabilityAsync();

      const response = await fetch(getApiBase() + '/api/pin/status/' + userId);

      if (response.ok) {
        const data = await response.json();
        pinEnabled = data.pinEnabled;
        biometricEnabled = data.biometricEnabled;
        updateSettingsUI();

        // If PIN is enabled and app just opened, show lock screen
        if (pinEnabled && !isLocked && !window._pinUnlocked) {
          showLockScreen();
        }
      }
    } catch (error) {
      console.error('[PIN] Error loading status:', error);
    }
  }

  // Pre-check biometric availability (returns promise)
  function checkBiometricAvailabilityAsync() {
    return new Promise((resolve) => {
      if (window.Fingerprint) {
        window.Fingerprint.isAvailable(
          function(result) {
            biometricAvailable = true;
            resolve(true);
          },
          function(error) {
            biometricAvailable = false;
            resolve(false);
          }
        );
      } else {
        biometricAvailable = false;
        resolve(false);
      }
    });
  }

  // ===== SETTINGS UI =====
  function updateSettingsUI() {
    const pinToggle = document.getElementById('pin-toggle');
    const biometricItem = document.getElementById('biometric-setting-item');
    const biometricToggle = document.getElementById('biometric-toggle');
    const biometricDesc = document.getElementById('biometric-description');

    if (pinToggle) {
      pinToggle.checked = pinEnabled;
    }

    // Show biometric setting when PIN is enabled
    if (biometricItem) {
      biometricItem.style.display = pinEnabled ? 'flex' : 'none';
    }

    if (biometricToggle) {
      biometricToggle.checked = biometricEnabled;
    }

    // Check biometric availability
    checkBiometricAvailability();
  }

  // ===== BIOMETRIC CHECK =====
  function checkBiometricAvailability() {
    const biometricItem = document.getElementById('biometric-setting-item');
    const biometricToggle = document.getElementById('biometric-toggle');
    const biometricDesc = document.getElementById('biometric-description');
    const t = (key) => window.translator ? window.translator.translate(key) : key;

    // Cordova fingerprint plugin check
    if (window.Fingerprint) {
      window.Fingerprint.isAvailable(
        function(result) {
          biometricAvailable = true;
          if (biometricItem && pinEnabled) {
            biometricItem.style.display = 'flex';
          }
          if (biometricToggle) {
            biometricToggle.disabled = false;
          }
          if (biometricDesc) {
            biometricDesc.textContent = t('Use fingerprint to unlock');
          }
          // Show biometric button on lock screen
          const bioBtn = document.getElementById('pin-biometric-btn');
          if (bioBtn && biometricEnabled) {
            bioBtn.style.visibility = 'visible';
          }
        },
        function(error) {
          biometricAvailable = false;
          if (biometricItem && pinEnabled) {
            biometricItem.style.display = 'flex';
            biometricItem.style.opacity = '0.5';
          }
          if (biometricToggle) {
            biometricToggle.disabled = true;
            biometricToggle.checked = false;
          }
          if (biometricDesc) {
            biometricDesc.textContent = t('Biometric not available on this device');
          }
        }
      );
    } else {
      // Web browser - no fingerprint plugin
      biometricAvailable = false;
      if (biometricItem && pinEnabled) {
        biometricItem.style.display = 'flex';
        biometricItem.style.opacity = '0.5';
      }
      if (biometricToggle) {
        biometricToggle.disabled = true;
        biometricToggle.checked = false;
      }
      if (biometricDesc) {
        biometricDesc.textContent = t('Available on mobile app only');
      }
    }
  }

  // ===== PIN TOGGLE HANDLER =====
  window.handlePinToggle = function(checked) {
    if (checked) {
      // Enable PIN - show setup modal
      showSetupModal('new');
    } else {
      // Disable PIN - ask for current PIN first
      showSetupModal('disable');
    }
  };

  // ===== BIOMETRIC TOGGLE =====
  window.handleBiometricToggle = async function(checked) {
    if (!pinEnabled) return;

    if (checked && !biometricAvailable) {
      if (window.showNotification) {
        window.showNotification(
          window.translator ? window.translator.translate('Biometric not available on this device') : 'Biometric not available on this device',
          'error'
        );
      }
      const bioToggle = document.getElementById('biometric-toggle');
      if (bioToggle) bioToggle.checked = false;
      return;
    }

    try {
      const userId = getUserId();
      if (!userId) return;

      const response = await fetch(getApiBase() + '/api/pin/biometric', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId, enabled: checked })
      });

      if (response.ok) {
        biometricEnabled = checked;
        if (window.showNotification) {
          const msg = checked
            ? (window.translator ? window.translator.translate('Biometric unlock enabled') : 'Biometric unlock enabled')
            : (window.translator ? window.translator.translate('Biometric unlock disabled') : 'Biometric unlock disabled');
          window.showNotification(msg, 'success');
        }
      }
    } catch (error) {
      console.error('[PIN] Error toggling biometric:', error);
    }
  };

  // ===== CHANGE PIN =====
  // Removed - user can disable and re-enable to set new PIN

  // ===== SETUP MODAL =====
  function showSetupModal(step) {
    setupStep = step;
    // Only clear setupPin when starting fresh (not when transitioning to confirm)
    if (step === 'new' || step === 'disable') {
      setupPin = '';
    }
    pinInput = '';
    clearSetupDots();
    hideSetupError();

    const modal = document.getElementById('pin-setup-modal');
    const title = document.getElementById('pin-modal-title');
    const subtitle = document.getElementById('pin-modal-subtitle');

    if (!modal) return;

    const t = (key) => window.translator ? window.translator.translate(key) : key;

    switch (step) {
      case 'new':
        title.textContent = t('Set PIN');
        title.setAttribute('data-translate', 'Set PIN');
        subtitle.textContent = t('Enter a 6-digit PIN');
        subtitle.setAttribute('data-translate', 'Enter a 6-digit PIN');
        break;
      case 'confirm':
        title.textContent = t('Confirm PIN');
        title.setAttribute('data-translate', 'Confirm PIN');
        subtitle.textContent = t('Re-enter your PIN to confirm');
        subtitle.setAttribute('data-translate', 'Re-enter your PIN to confirm');
        break;
      case 'disable':
        title.textContent = t('Disable PIN');
        title.setAttribute('data-translate', 'Disable PIN');
        subtitle.textContent = t('Enter your current PIN to disable');
        subtitle.setAttribute('data-translate', 'Enter your current PIN to disable');
        break;
    }

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);

    // Show biometric button only in disable mode when biometric is enabled
    const setupBioBtn = document.getElementById('pin-setup-biometric-btn');
    if (setupBioBtn) {
      if (step === 'disable' && biometricEnabled && biometricAvailable) {
        setupBioBtn.style.visibility = 'visible';
        // Auto-trigger biometric after a short delay
        setTimeout(() => {
          if (setupStep === 'disable') triggerSetupBiometricAuth();
        }, 400);
      } else {
        setupBioBtn.style.visibility = 'hidden';
      }
    }
  }

  window.closePinModal = function() {
    const modal = document.getElementById('pin-setup-modal');
    if (modal) {
      modal.classList.remove('active');
      setTimeout(() => {
        modal.style.display = 'none';
      }, 300);
    }
    // Reset toggle if user cancelled setup
    if (setupStep === 'new' || setupStep === 'confirm') {
      const pinToggle = document.getElementById('pin-toggle');
      if (pinToggle && !pinEnabled) {
        pinToggle.checked = false;
      }
    }
    if (setupStep === 'disable') {
      const pinToggle = document.getElementById('pin-toggle');
      if (pinToggle && pinEnabled) {
        pinToggle.checked = true;
      }
    }
    setupStep = 'new';
    setupPin = '';
    pinInput = '';
  };

  // ===== SETUP KEYPAD =====
  window.pinSetupKeyPress = function(digit) {
    if (pinInput.length >= 6) return;
    pinInput += digit;
    updateSetupDots(pinInput.length);
    hideSetupError();

    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(30);

    if (pinInput.length === 6) {
      setTimeout(() => handleSetupComplete(), 200);
    }
  };

  window.pinSetupKeyDelete = function() {
    if (pinInput.length > 0) {
      pinInput = pinInput.slice(0, -1);
      updateSetupDots(pinInput.length);
    }
  };

  function updateSetupDots(count) {
    const dots = document.querySelectorAll('#pin-setup-dots .pin-dot');
    dots.forEach((dot, i) => {
      if (i < count) {
        dot.classList.add('filled');
      } else {
        dot.classList.remove('filled');
      }
    });
  }

  function clearSetupDots() {
    const dots = document.querySelectorAll('#pin-setup-dots .pin-dot');
    dots.forEach(d => d.classList.remove('filled'));
  }

  function showSetupError(msg) {
    const el = document.getElementById('pin-setup-error');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
    // Shake animation
    const dotsContainer = document.getElementById('pin-setup-dots');
    if (dotsContainer) {
      dotsContainer.classList.add('shake');
      setTimeout(() => dotsContainer.classList.remove('shake'), 500);
    }
  }

  function hideSetupError() {
    const el = document.getElementById('pin-setup-error');
    if (el) el.style.display = 'none';
  }

  // ===== HANDLE SETUP STEPS =====
  async function handleSetupComplete() {
    const t = (key) => window.translator ? window.translator.translate(key) : key;

    switch (setupStep) {
      case 'new':
        // Save first PIN entry, ask for confirmation
        setupPin = pinInput;
        pinInput = '';
        clearSetupDots();
        showSetupModal('confirm');
        break;

      case 'confirm':
        // Check if confirmation matches
        if (pinInput !== setupPin) {
          showSetupError(t('PINs do not match'));
          pinInput = '';
          clearSetupDots();
          return;
        }
        // Send to server
        await setupNewPin(setupPin);
        break;

      case 'disable':
        await disablePinOnServer(pinInput);
        break;
    }
  }

  // ===== SERVER OPERATIONS =====
  async function setupNewPin(pin) {
    const t = (key) => window.translator ? window.translator.translate(key) : key;
    try {
      const userId = getUserId();
      const response = await fetch(getApiBase() + '/api/pin/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId, pin })
      });

      const data = await response.json();
      if (data.success) {
        pinEnabled = true;
        window.closePinModal();
        updateSettingsUI();
        if (window.showNotification) {
          window.showNotification(t('PIN enabled successfully'), 'success');
        }
      } else {
        showSetupError(data.error || t('Failed to set PIN'));
        pinInput = '';
        clearSetupDots();
      }
    } catch (error) {
      console.error('[PIN] Error setting up PIN:', error);
      showSetupError(t('Network error'));
      pinInput = '';
      clearSetupDots();
    }
  }

  async function verifyPinOnServer(pin) {
    try {
      const userId = getUserId();
      const response = await fetch(getApiBase() + '/api/pin/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId, pin })
      });

      const data = await response.json();
      return data.verified === true;
    } catch (error) {
      console.error('[PIN] Error verifying PIN:', error);
      return false;
    }
  }

  async function disablePinOnServer(pin) {
    const t = (key) => window.translator ? window.translator.translate(key) : key;
    try {
      const userId = getUserId();
      const response = await fetch(getApiBase() + '/api/pin/disable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId, pin })
      });

      const data = await response.json();
      if (data.success) {
        pinEnabled = false;
        biometricEnabled = false;
        window.closePinModal();
        updateSettingsUI();
        if (window.showNotification) {
          window.showNotification(t('PIN disabled'), 'success');
        }
      } else {
        showSetupError(data.error || t('Incorrect PIN'));
        pinInput = '';
        clearSetupDots();
      }
    } catch (error) {
      console.error('[PIN] Error disabling PIN:', error);
      showSetupError(t('Network error'));
      pinInput = '';
      clearSetupDots();
    }
  }

  // ===== LOCK SCREEN =====
  let _unlockCooldown = false;

  function showLockScreen() {
    // Prevent showing lock screen if already locked or in cooldown after unlock
    if (isLocked || _unlockCooldown) return;
    
    isLocked = true;
    pinInput = '';
    const lockScreen = document.getElementById('pin-lock-screen');
    if (!lockScreen) return;

    clearLockDots();
    hideLockError();

    // SECURITY: Show lock screen INSTANTLY - no fade-in delay
    lockScreen.style.display = 'flex';
    lockScreen.style.opacity = '1';
    lockScreen.classList.add('active');
    
    // SECURITY: Hide app content behind lock screen
    const appContainer = document.getElementById('app-container');
    if (appContainer) appContainer.style.visibility = 'hidden';

    // Show biometric button if enabled
    const bioBtn = document.getElementById('pin-biometric-btn');
    if (bioBtn) {
      bioBtn.style.visibility = (biometricEnabled && biometricAvailable) ? 'visible' : 'hidden';
    }

    // Auto-trigger biometric immediately if enabled (once only)
    if (biometricEnabled && biometricAvailable && window.Fingerprint) {
      setTimeout(() => {
        if (isLocked) triggerBiometricAuth();
      }, 400);
    }
  }

  function hideLockScreen() {
    if (!isLocked) return;
    isLocked = false;
    window._pinUnlocked = true;
    window._biometricInProgress = false;
    
    // Cooldown: prevent re-locking for 2 seconds after unlock
    _unlockCooldown = true;
    setTimeout(() => { _unlockCooldown = false; }, 2000);
    
    // SECURITY: Restore app content visibility BEFORE hiding lock screen
    const appContainer = document.getElementById('app-container');
    if (appContainer) appContainer.style.visibility = '';
    
    const lockScreen = document.getElementById('pin-lock-screen');
    if (lockScreen) {
      // Smooth fade out
      lockScreen.style.transition = 'opacity 0.25s ease-out';
      lockScreen.style.opacity = '0';
      setTimeout(() => {
        lockScreen.classList.remove('active');
        lockScreen.style.display = 'none';
        lockScreen.style.opacity = '';
        lockScreen.style.transition = '';
      }, 250);
    }
  }

  // ===== LOCK KEYPAD =====
  window.pinKeyPress = function(digit) {
    if (pinInput.length >= 6) return;
    pinInput += digit;
    updateLockDots(pinInput.length);
    hideLockError();

    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(30);

    if (pinInput.length === 6) {
      setTimeout(() => verifyLockPin(), 200);
    }
  };

  window.pinKeyDelete = function() {
    if (pinInput.length > 0) {
      pinInput = pinInput.slice(0, -1);
      updateLockDots(pinInput.length);
    }
  };

  function updateLockDots(count) {
    const dots = document.querySelectorAll('#pin-dots .pin-dot');
    dots.forEach((dot, i) => {
      if (i < count) {
        dot.classList.add('filled');
      } else {
        dot.classList.remove('filled');
      }
    });
  }

  function clearLockDots() {
    const dots = document.querySelectorAll('#pin-dots .pin-dot');
    dots.forEach(d => d.classList.remove('filled'));
  }

  function showLockError() {
    const el = document.getElementById('pin-error-msg');
    if (el) el.style.display = 'block';

    // Shake animation
    const dotsContainer = document.getElementById('pin-dots');
    if (dotsContainer) {
      dotsContainer.classList.add('shake');
      setTimeout(() => dotsContainer.classList.remove('shake'), 500);
    }

    // Haptic
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  }

  function hideLockError() {
    const el = document.getElementById('pin-error-msg');
    if (el) el.style.display = 'none';
  }

  async function verifyLockPin() {
    const verified = await verifyPinOnServer(pinInput);
    if (verified) {
      hideLockScreen();
    } else {
      showLockError();
      pinInput = '';
      clearLockDots();
    }
  }

  // ===== BIOMETRIC AUTH =====
  function triggerBiometricAuth() {
    if (!window.Fingerprint || !biometricAvailable || !biometricEnabled) return;
    // Prevent multiple popups
    if (window._biometricInProgress) return;
    window._biometricInProgress = true;

    const t = (key) => window.translator ? window.translator.translate(key) : key;

    window.Fingerprint.show(
      {
        title: t('Unlock Access Network'),
        disableBackup: true
      },
      function() {
        // Success - animate dots filling up then unlock
        window._biometricInProgress = false;
        animateDotsAndUnlock();
      },
      function(error) {
        // Failed or cancelled - just reset flag, user can use PIN or tap bio button
        window._biometricInProgress = false;
        console.log('[PIN] Biometric cancelled/failed:', error);
      }
    );
  }

  // Animate dots filling one by one like typing PIN, then unlock
  function animateDotsAndUnlock() {
    const dots = document.querySelectorAll('#pin-dots .pin-dot');
    if (!dots.length) {
      hideLockScreen();
      return;
    }
    
    let i = 0;
    const fillInterval = setInterval(() => {
      if (i < dots.length) {
        dots[i].classList.add('filled');
        if (navigator.vibrate) navigator.vibrate(15);
        i++;
      } else {
        clearInterval(fillInterval);
        // Brief pause after all dots filled, then unlock
        setTimeout(() => {
          hideLockScreen();
        }, 200);
      }
    }, 80);
  }

  // Expose for button tap (manual trigger)
  window.pinBiometricAuth = function() {
    triggerBiometricAuth();
  };

  // ===== BIOMETRIC AUTH FOR DISABLE PIN =====
  function triggerSetupBiometricAuth() {
    if (!window.Fingerprint || !biometricAvailable || !biometricEnabled) return;
    if (window._biometricInProgress) return;
    window._biometricInProgress = true;

    const t = (key) => window.translator ? window.translator.translate(key) : key;

    window.Fingerprint.show(
      {
        title: t('Disable PIN'),
        disableBackup: true
      },
      function() {
        // Success - animate dots then disable PIN
        window._biometricInProgress = false;
        animateSetupDotsAndDisable();
      },
      function(error) {
        window._biometricInProgress = false;
        console.log('[PIN] Biometric for disable cancelled/failed:', error);
      }
    );
  }

  // Animate setup modal dots filling, then disable PIN via biometric endpoint
  function animateSetupDotsAndDisable() {
    const dots = document.querySelectorAll('#pin-setup-dots .pin-dot');
    if (!dots.length) {
      disablePinViaBiometric();
      return;
    }

    let i = 0;
    const fillInterval = setInterval(() => {
      if (i < dots.length) {
        dots[i].classList.add('filled');
        if (navigator.vibrate) navigator.vibrate(15);
        i++;
      } else {
        clearInterval(fillInterval);
        setTimeout(() => {
          disablePinViaBiometric();
        }, 200);
      }
    }, 80);
  }

  async function disablePinViaBiometric() {
    const t = (key) => window.translator ? window.translator.translate(key) : key;
    try {
      const userId = getUserId();
      if (!userId) return;

      const response = await fetch(getApiBase() + '/api/pin/disable-biometric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });

      const data = await response.json();
      if (data.success) {
        pinEnabled = false;
        biometricEnabled = false;
        window.closePinModal();
        updateSettingsUI();
        if (window.showNotification) {
          window.showNotification(t('PIN disabled'), 'success');
        }
      } else {
        showSetupError(data.error || t('Failed to disable PIN'));
        pinInput = '';
        clearSetupDots();
      }
    } catch (error) {
      console.error('[PIN] Error disabling via biometric:', error);
      showSetupError(t('Network error'));
      pinInput = '';
      clearSetupDots();
    }
  }

  // Expose for button tap
  window.pinSetupBiometricAuth = function() {
    triggerSetupBiometricAuth();
  };

  // ===== APP LIFECYCLE =====
  // Track when app goes to background
  var _pausedAt = 0;
  var PIN_BACKGROUND_THRESHOLD = 5000; // Only show PIN if app was in background > 5 seconds

  document.addEventListener('pause', function() {
    _pausedAt = Date.now();
    console.log('[PIN] App paused at', _pausedAt);
  }, false);

  // Show lock screen when app resumes from background
  function onAppResume() {
    var backgroundDuration = Date.now() - _pausedAt;
    console.log('[PIN] App resumed, background duration:', backgroundDuration, 'ms');

    // Only skip PIN for very short pauses (camera, share dialog, ads)
    if (backgroundDuration < PIN_BACKGROUND_THRESHOLD) {
      console.log('[PIN] Short pause (' + backgroundDuration + 'ms < ' + PIN_BACKGROUND_THRESHOLD + 'ms), skipping PIN');
      return;
    }
    
    if (pinEnabled && window._pinUnlocked) {
      window._pinUnlocked = false;
      // SECURITY: Hide app content INSTANTLY before showing lock
      const appContainer = document.getElementById('app-container');
      if (appContainer) appContainer.style.visibility = 'hidden';
      showLockScreen();
    }
  }

  // ===== INITIALIZATION =====
  function initPinSystem() {
    console.log('[PIN] Initializing PIN lock system...');

    // Listen for app resume (Cordova)
    document.addEventListener('resume', onAppResume, false);

    // Load PIN status after user is logged in
    // We use an interval to wait for currentUser to be available
    let checkCount = 0;
    const checkInterval = setInterval(() => {
      checkCount++;
      if (window.currentUser && window.currentUser.id) {
        clearInterval(checkInterval);
        loadPinStatus();
      }
      if (checkCount > 60) { // Give up after 30 seconds
        clearInterval(checkInterval);
      }
    }, 500);
  }

  // Expose loadPinStatus for when user logs in
  window.loadPinStatus = loadPinStatus;
  window.isPinLocked = function() { return isLocked; };

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPinSystem);
  } else {
    initPinSystem();
  }

})();
