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

  function getToken() {
    const user = window.currentUser;
    return user ? user.token : null;
  }

  // ===== PIN STATUS =====
  async function loadPinStatus() {
    try {
      const token = getToken();
      if (!token) return;

      const response = await fetch(getApiBase() + '/api/pin/status', {
        headers: { 'Authorization': 'Bearer ' + token }
      });

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

  // ===== SETTINGS UI =====
  function updateSettingsUI() {
    const pinToggle = document.getElementById('pin-toggle');
    const biometricItem = document.getElementById('biometric-setting-item');
    const biometricToggle = document.getElementById('biometric-toggle');
    const changePinItem = document.getElementById('change-pin-item');

    if (pinToggle) {
      pinToggle.checked = pinEnabled;
    }

    if (biometricItem) {
      biometricItem.style.display = pinEnabled ? 'flex' : 'none';
    }

    if (biometricToggle) {
      biometricToggle.checked = biometricEnabled;
    }

    if (changePinItem) {
      changePinItem.style.display = pinEnabled ? 'flex' : 'none';
    }

    // Check biometric availability
    checkBiometricAvailability();
  }

  // ===== BIOMETRIC CHECK =====
  function checkBiometricAvailability() {
    // Cordova fingerprint plugin check
    if (window.Fingerprint) {
      window.Fingerprint.isAvailable(
        function(result) {
          biometricAvailable = true;
          const biometricItem = document.getElementById('biometric-setting-item');
          if (biometricItem && pinEnabled) {
            biometricItem.style.display = 'flex';
          }
          // Show biometric button on lock screen
          const bioBtn = document.getElementById('pin-biometric-btn');
          if (bioBtn && biometricEnabled) {
            bioBtn.style.display = 'flex';
          }
        },
        function(error) {
          biometricAvailable = false;
          const biometricItem = document.getElementById('biometric-setting-item');
          if (biometricItem) biometricItem.style.display = 'none';
        }
      );
    } else {
      biometricAvailable = false;
      // Hide biometric option if not in Cordova or plugin not available
      const biometricItem = document.getElementById('biometric-setting-item');
      if (biometricItem) biometricItem.style.display = 'none';
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
      const token = getToken();
      if (!token) return;

      const response = await fetch(getApiBase() + '/api/pin/biometric', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: checked })
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
  window.showChangePinModal = function() {
    showSetupModal('current');
  };

  // ===== SETUP MODAL =====
  function showSetupModal(step) {
    setupStep = step;
    setupPin = '';
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
      case 'current':
        title.textContent = t('Current PIN');
        title.setAttribute('data-translate', 'Current PIN');
        subtitle.textContent = t('Enter your current PIN');
        subtitle.setAttribute('data-translate', 'Enter your current PIN');
        break;
      case 'change-new':
        title.textContent = t('New PIN');
        title.setAttribute('data-translate', 'New PIN');
        subtitle.textContent = t('Enter a new 6-digit PIN');
        subtitle.setAttribute('data-translate', 'Enter a new 6-digit PIN');
        break;
      case 'change-confirm':
        title.textContent = t('Confirm New PIN');
        title.setAttribute('data-translate', 'Confirm New PIN');
        subtitle.textContent = t('Re-enter your new PIN');
        subtitle.setAttribute('data-translate', 'Re-enter your new PIN');
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

      case 'current':
        // Verify current PIN then move to new PIN
        const verified = await verifyPinOnServer(pinInput);
        if (!verified) {
          showSetupError(t('Incorrect PIN'));
          pinInput = '';
          clearSetupDots();
          return;
        }
        pinInput = '';
        clearSetupDots();
        showSetupModal('change-new');
        break;

      case 'change-new':
        setupPin = pinInput;
        pinInput = '';
        clearSetupDots();
        showSetupModal('change-confirm');
        break;

      case 'change-confirm':
        if (pinInput !== setupPin) {
          showSetupError(t('PINs do not match'));
          pinInput = '';
          clearSetupDots();
          return;
        }
        await changePinOnServer(pinInput);
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
      const token = getToken();
      const response = await fetch(getApiBase() + '/api/pin/setup', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pin })
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
      const token = getToken();
      const response = await fetch(getApiBase() + '/api/pin/verify', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pin })
      });

      const data = await response.json();
      return data.verified === true;
    } catch (error) {
      console.error('[PIN] Error verifying PIN:', error);
      return false;
    }
  }

  async function changePinOnServer(newPin) {
    const t = (key) => window.translator ? window.translator.translate(key) : key;
    try {
      const token = getToken();
      // We already verified the current PIN in the 'current' step
      const response = await fetch(getApiBase() + '/api/pin/setup', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pin: newPin })
      });

      const data = await response.json();
      if (data.success) {
        window.closePinModal();
        if (window.showNotification) {
          window.showNotification(t('PIN changed successfully'), 'success');
        }
      } else {
        showSetupError(data.error || t('Failed to change PIN'));
        pinInput = '';
        clearSetupDots();
      }
    } catch (error) {
      console.error('[PIN] Error changing PIN:', error);
      showSetupError(t('Network error'));
      pinInput = '';
      clearSetupDots();
    }
  }

  async function disablePinOnServer(pin) {
    const t = (key) => window.translator ? window.translator.translate(key) : key;
    try {
      const token = getToken();
      const response = await fetch(getApiBase() + '/api/pin/disable', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pin })
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
  function showLockScreen() {
    isLocked = true;
    pinInput = '';
    const lockScreen = document.getElementById('pin-lock-screen');
    if (!lockScreen) return;

    clearLockDots();
    hideLockError();

    lockScreen.style.display = 'flex';
    setTimeout(() => lockScreen.classList.add('active'), 10);

    // Show biometric button if enabled
    const bioBtn = document.getElementById('pin-biometric-btn');
    if (bioBtn) {
      bioBtn.style.display = (biometricEnabled && biometricAvailable) ? 'flex' : 'none';
    }

    // Auto-trigger biometric if enabled
    if (biometricEnabled && biometricAvailable) {
      setTimeout(() => window.pinBiometricAuth(), 500);
    }
  }

  function hideLockScreen() {
    isLocked = false;
    window._pinUnlocked = true;
    const lockScreen = document.getElementById('pin-lock-screen');
    if (lockScreen) {
      lockScreen.classList.remove('active');
      setTimeout(() => {
        lockScreen.style.display = 'none';
      }, 300);
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
  window.pinBiometricAuth = function() {
    if (!window.Fingerprint || !biometricAvailable || !biometricEnabled) return;

    const t = (key) => window.translator ? window.translator.translate(key) : key;

    window.Fingerprint.show(
      {
        title: t('Unlock Access Network'),
        description: t('Use your fingerprint to unlock'),
        disableBackup: true
      },
      function() {
        // Success
        hideLockScreen();
      },
      function(error) {
        console.log('[PIN] Biometric failed:', error);
        // User can still use PIN
      }
    );
  };

  // ===== APP LIFECYCLE =====
  // Show lock screen when app resumes from background
  function onAppResume() {
    if (pinEnabled && window._pinUnlocked) {
      window._pinUnlocked = false;
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
      if (window.currentUser && window.currentUser.token) {
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
