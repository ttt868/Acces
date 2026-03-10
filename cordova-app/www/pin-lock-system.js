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
  let _pinFrozen = false; // true = PIN visible but non-functional (no internet)

  // ===== API HELPERS =====
  function getApiBase() {
    return (typeof window.getApiOrigin === 'function') ? window.getApiOrigin() : 'https://accesschain.org';
  }

  function getUserId() {
    const user = window.currentUser;
    if (user && user.id) return user.id;
    // Fallback: accessoireUser in localStorage
    try {
      var saved = localStorage.getItem('accessoireUser');
      if (saved) { var u = JSON.parse(saved); if (u && u.id) return u.id; }
    } catch(e) {}
    // Last fallback: userId saved in _pin_active
    try {
      var pa = localStorage.getItem('_pin_active');
      if (pa) { var d = JSON.parse(pa); if (d && d.u) return d.u; }
    } catch(e) {}
    return null;
  }

  // ===== LOCAL PIN CACHE (per-user) =====
  // Store PIN state locally so it works immediately + offline
  // Key format: pin_state_{userId} to not mix between users
  function getLocalPinKey() {
    var userId = getUserId();
    return userId ? 'pin_state_' + userId : null;
  }

  // Check PIN state from cache WITHOUT needing currentUser
  // Used by offline detector on cold start when currentUser isn't loaded yet
  function isPinEnabledFromCache() {
    try {
      // _pin_active is the ONLY gate — cleared on logout
      var pa = localStorage.getItem('_pin_active');
      if (!pa) return false;
      return true;
    } catch(e) {}
    return false;
  }

  function saveLocalPinState() {
    var key = getLocalPinKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({
        pinEnabled: pinEnabled,
        biometricEnabled: biometricEnabled,
        ts: Date.now()
      }));
      // Rich flag — saves userId + biometric so PIN works even if accessoireUser is lost
      if (pinEnabled) {
        var uid = getUserId();
        localStorage.setItem('_pin_active', JSON.stringify({u: uid, b: biometricEnabled}));
      } else {
        localStorage.removeItem('_pin_active');
      }
    } catch(e) {}
  }

  function loadLocalPinState() {
    // Gate: no _pin_active = no PIN (user logged out)
    var pa = localStorage.getItem('_pin_active');
    if (!pa) return false;

    // Try standard path: pin_state_{userId}
    var key = getLocalPinKey();
    if (!key) {
      try {
        var saved = localStorage.getItem('accessoireUser');
        if (saved) {
          var user = JSON.parse(saved);
          if (user && user.id) key = 'pin_state_' + user.id;
        }
      } catch(e) {}
    }
    // Fallback: get userId from _pin_active itself
    if (!key) {
      try {
        var pad = JSON.parse(pa);
        if (pad && pad.u) key = 'pin_state_' + pad.u;
      } catch(e) {}
    }
    if (key) {
      try {
        var data = JSON.parse(localStorage.getItem(key));
        if (data && typeof data.pinEnabled === 'boolean') {
          pinEnabled = data.pinEnabled;
          biometricEnabled = data.biometricEnabled || false;
          return true;
        }
      } catch(e) {}
    }
    // pin_state not found but _pin_active exists — use its data
    try {
      var pad2 = JSON.parse(pa);
      pinEnabled = true;
      biometricEnabled = !!(pad2 && pad2.b);
      return true;
    } catch(e) {
      // Old format '1' — PIN enabled, no biometric info
      pinEnabled = true;
      biometricEnabled = false;
      return true;
    }
  }

  // ===== PIN STATUS =====
  async function loadPinStatus() {
    try {
      const userId = getUserId();
      if (!userId) return;

      // Check biometric availability early
      await checkBiometricAvailabilityAsync();

      // Load local cache FIRST (instant, works offline)
      var hadLocal = loadLocalPinState();
      if (hadLocal) {
        updateSettingsUI();
        if (pinEnabled && !isLocked && !window._pinUnlocked) {
          showLockScreen();
          // Auto-trigger biometric on fresh login
          if (biometricEnabled && biometricAvailable && !window._biometricInProgress) {
            setTimeout(function() {
              if (isLocked) triggerBiometricAuth();
            }, 400);
          }
        }
      }

      // Then sync from server (update cache)
      const response = await fetch(getApiBase() + '/api/pin/status/' + userId);

      if (response.ok) {
        const data = await response.json();
        pinEnabled = data.pinEnabled;
        biometricEnabled = data.biometricEnabled;
        saveLocalPinState(); // cache for next time
        updateSettingsUI();

        // Show lock screen if PIN enabled and not already locked
        if (pinEnabled && !isLocked && !window._pinUnlocked) {
          showLockScreen();
          // Auto-trigger biometric on fresh login (server confirmed)
          if (biometricEnabled && biometricAvailable && !window._biometricInProgress) {
            setTimeout(function() {
              if (isLocked) triggerBiometricAuth();
            }, 400);
          }
        }
      }
    } catch (error) {
      console.error('[PIN] Error loading status:', error);
      // Offline: local cache already applied above
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
        body: JSON.stringify({ userId, enabled: checked, session_token: (window.currentUser || {}).sessionToken || (window.currentUser || {}).session_token || '' })
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

    // Show biometric button in disable mode if biometric is enabled
    const setupBioBtn = document.getElementById('pin-setup-biometric-btn');
    if (setupBioBtn) {
      if (step === 'disable' && biometricEnabled && biometricAvailable && window.Fingerprint) {
        setupBioBtn.style.visibility = 'visible';
      } else {
        setupBioBtn.style.visibility = 'hidden';
      }
    }

    modal.style.display = 'flex';
    setTimeout(() => {
      modal.classList.add('active');
      // Auto-trigger biometric when disabling PIN
      if (step === 'disable' && biometricEnabled && biometricAvailable && window.Fingerprint) {
        setTimeout(() => window.pinSetupBiometricAuth(), 300);
      }
    }, 10);
  }

  // Biometric auth for setup/disable modal
  window.pinSetupBiometricAuth = function() {
    if (setupStep !== 'disable' || !window.Fingerprint || !biometricAvailable || !biometricEnabled) return;
    if (window._setupBiometricInProgress) return;
    window._setupBiometricInProgress = true;

    const t = (key) => window.translator ? window.translator.translate(key) : key;

    window.Fingerprint.show(
      {
        title: t('Disable PIN'),
        disableBackup: true
      },
      async function() {
        window._setupBiometricInProgress = false;
        // Biometric success - animate dots then disable PIN
        const dots = document.querySelectorAll('#pin-setup-dots .pin-dot');
        let i = 0;
        const fillInterval = setInterval(async () => {
          if (i < dots.length) {
            dots[i].classList.add('filled');
            if (navigator.vibrate) navigator.vibrate(15);
            i++;
          } else {
            clearInterval(fillInterval);
            // Disable PIN via biometric (send to dedicated biometric endpoint)
            try {
              const userId = getUserId();
              const response = await fetch(getApiBase() + '/api/pin/disable-biometric', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, session_token: (window.currentUser || {}).sessionToken || (window.currentUser || {}).session_token || '' })
              });
              const data = await response.json();
              if (data.success) {
                pinEnabled = false;
                biometricEnabled = false;
                saveLocalPinState();
                window.closePinModal();
                updateSettingsUI();
                if (window.showNotification) {
                  window.showNotification(t('PIN disabled'), 'success');
                }
              } else {
                showSetupError(t(data.error || 'Failed to disable PIN'));
                clearSetupDots();
              }
            } catch (error) {
              console.error('[PIN] Error disabling PIN via biometric:', error);
              showSetupError(t('Network error'));
              clearSetupDots();
            }
          }
        }, 80);
      },
      function(error) {
        window._setupBiometricInProgress = false;
        console.log('[PIN] Setup biometric cancelled/failed:', error);
      }
    );
  };

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
      const user = window.currentUser || {};
      const session_token = user.sessionToken || user.session_token || '';
      const response = await fetch(getApiBase() + '/api/pin/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId, pin, session_token })
      });

      const data = await response.json();
      if (data.success) {
        pinEnabled = true;
        saveLocalPinState();
        window.closePinModal();
        updateSettingsUI();
        if (window.showNotification) {
          window.showNotification(t('PIN enabled successfully'), 'success');
        }
      } else if (data.alreadySet) {
        // PIN already set from another device — sync local state
        pinEnabled = true;
        saveLocalPinState();
        updateSettingsUI();
        showSetupError(t('PIN already set from another device'));
        pinInput = '';
        clearSetupDots();
      } else {
        showSetupError(t(data.error || 'Failed to set PIN'));
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

      if (response.status === 429) {
        const t = (key) => window.translator ? window.translator.translate(key) : key;
        showSetupError(t('Too many attempts. Please wait.'));
        return false;
      }

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
        saveLocalPinState();
        window.closePinModal();
        updateSettingsUI();
        if (window.showNotification) {
          window.showNotification(t('PIN disabled'), 'success');
        }
      } else {
        showSetupError(t(data.error || 'Incorrect PIN'));
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

    // If offline page exists, PIN takes priority — remove offline page and freeze
    var offlinePage = document.getElementById('connection-offline-page');
    if (offlinePage) {
      offlinePage.remove();
      if (window.offlineDetector && typeof window.offlineDetector._unlockBackground === 'function') {
        window.offlineDetector._unlockBackground();
      }
      if (!navigator.onLine) {
        _pinFrozen = true;
      }
    } else if (!navigator.onLine) {
      // No offline page but still offline — freeze PIN
      _pinFrozen = true;
    }
    
    isLocked = true;
    pinInput = '';
    const lockScreen = document.getElementById('pin-lock-screen');
    if (!lockScreen) return;

    clearLockDots();
    hideLockError();

    lockScreen.style.display = 'flex';
    // If already visible from CSS pin-required, skip opacity flash
    var alreadyVisible = document.documentElement.classList.contains('pin-required');
    if (!alreadyVisible && !_instantShow) {
      lockScreen.style.opacity = '0';
    }
    _instantShow = false; // reset flag
    requestAnimationFrame(() => {
      lockScreen.classList.add('active');
      lockScreen.style.opacity = '1';
    });

    // Show frozen indicator if offline
    if (_pinFrozen) _showFrozenIndicator();
    else _hideFrozenIndicator();

    // Show biometric button if enabled
    // On cold start, biometricAvailable may still be false (async check pending)
    // Show button based on biometricEnabled setting — it will be hidden later if truly unavailable
    const bioBtn = document.getElementById('pin-biometric-btn');
    if (bioBtn) {
      bioBtn.style.visibility = biometricEnabled ? 'visible' : 'hidden';
    }

  }

  function hideLockScreen() {
    if (!isLocked) return;
    isLocked = false;
    window._pinUnlocked = true;
    window._pinRequiredOnStart = false; // PIN unlocked — offline detector can work normally
    window._biometricInProgress = false;
    // Remove CSS-level PIN guard
    document.documentElement.classList.remove('pin-required');
    
    // Cooldown: prevent re-locking for 2 seconds after unlock
    _unlockCooldown = true;
    setTimeout(() => { _unlockCooldown = false; }, 2000);

    // Start loading data BEFORE hiding PIN screen
    // So data starts arriving while PIN is still visible
    _loadDataAfterUnlock();

    const lockScreen = document.getElementById('pin-lock-screen');
    if (lockScreen) {
      // Keep PIN visible briefly while data loads in background
      // Then smooth fade out after a short delay
      setTimeout(() => {
        lockScreen.style.transition = 'opacity 0.35s ease-out';
        lockScreen.style.opacity = '0';
        setTimeout(() => {
          lockScreen.classList.remove('active');
          lockScreen.style.display = 'none';
          lockScreen.style.opacity = '';
          lockScreen.style.transition = '';

          // Show any notifications that were queued during lock screen
          if (typeof window._flushNotificationQueue === 'function') {
            window._flushNotificationQueue();
          }
        }, 350);
      }, 400); // 400ms head-start for data to begin loading
    }
  }

  function _loadDataAfterUnlock() {
    try {
      // Restore currentUser from session if not loaded yet (cold start)
      if (!window.currentUser || !window.currentUser.email) {
        try {
          var saved = localStorage.getItem('accessoireUser');
          if (saved) {
            var userData = JSON.parse(saved);
            if (userData && userData.email) {
              window.currentUser = userData;
              console.log('[PIN] Restored currentUser from session cache');
            }
          }
        } catch(e) {}
      }
      if (window.currentUser && window.currentUser.email) {
        if (typeof window.loadUserData === 'function') {
          console.log('[PIN] Loading user data after unlock for:', window.currentUser.email);
          window.loadUserData(window.currentUser.email);
        } else {
          console.warn('[PIN] loadUserData not available — reloading page');
          window.location.reload();
        }
      } else {
        console.warn('[PIN] No currentUser found — reloading page');
        window.location.reload();
      }
    } catch (e) {
      console.warn('[PIN] Post-unlock data load error:', e);
      window.location.reload();
    }
  }

  // ===== LOCK KEYPAD =====
  window.pinKeyPress = function(digit) {
    if (_pinFrozen) return; // No input when frozen (offline)
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
    if (_pinFrozen) return; // No input when frozen (offline)
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
    if (_pinFrozen) return; // No biometric when frozen (offline)
    if (!window.Fingerprint || !biometricAvailable || !biometricEnabled) return;
    // Prevent multiple popups
    if (window._biometricInProgress) return;
    window._biometricInProgress = true;

    // Safety timeout: if plugin never calls back, reset flag after 30s
    var _bioSafetyTimer = setTimeout(function() {
      console.warn('[PIN] Biometric safety timeout — resetting flag');
      window._biometricInProgress = false;
    }, 30000);

    const t = (key) => window.translator ? window.translator.translate(key) : key;

    window.Fingerprint.show(
      {
        title: t('Unlock Access Network'),
        disableBackup: true
      },
      function() {
        // Success - animate dots filling up then unlock
        clearTimeout(_bioSafetyTimer);
        window._biometricInProgress = false;
        animateDotsAndUnlock();
      },
      function(error) {
        // Failed or cancelled - just reset flag, user can use PIN or tap bio button
        clearTimeout(_bioSafetyTimer);
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
    if (_pinFrozen) return;
    // Force reset biometric flag on manual button press — user explicitly wants biometric
    window._biometricInProgress = false;
    
    // On cold start, biometricAvailable may still be false (async check pending)
    // If user pressed the button, check availability first then trigger
    if (!biometricAvailable && window.Fingerprint) {
      checkBiometricAvailabilityAsync().then(function(available) {
        if (available) {
          window._biometricInProgress = false;
          triggerBiometricAuth();
        }
      });
    } else {
      triggerBiometricAuth();
    }
  };

  // Expose pinSetupBiometricAuth if not already defined (fallback)
  if (!window.pinSetupBiometricAuth) {
    window.pinSetupBiometricAuth = function() {};
  }

  // ===== APP LIFECYCLE =====
  // Track when app goes to background
  var _pausedAt = 0;
  var _instantShow = false;
  var PIN_BACKGROUND_THRESHOLD = 30000; // Show PIN if app was in background > 30 seconds

  document.addEventListener('pause', function() {
    _pausedAt = Date.now();
  }, false);

  // Show lock screen when app resumes from background
  function onAppResume() {
    var backgroundDuration = Date.now() - _pausedAt;

    // Short pauses = camera, gallery, share dialog, modals, ads, etc.
    if (backgroundDuration < PIN_BACKGROUND_THRESHOLD) {
      return;
    }
    
    if (pinEnabled && window._pinUnlocked) {
      window._pinUnlocked = false;
      _instantShow = true; // no fade-in on resume
      showLockScreen();
      // Auto-trigger biometric INSTANTLY on resume (no splash delay needed)
      if (biometricEnabled) {
        setTimeout(function() {
          if (!isLocked || _pinFrozen) return;
          checkBiometricAvailabilityAsync().then(function(available) {
            if (available && isLocked && !_pinFrozen) {
              window._biometricInProgress = false;
              triggerBiometricAuth();
            }
          });
        }, 100);
      }
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
  // Expose PIN lock state for other systems
  window.isPinEnabled = function() { return pinEnabled; };
  window._pinLockVisible = function() { return isLocked; };
  window.isPinEnabledFromCache = isPinEnabledFromCache;

  // Show/hide "waiting for connection" indicator on PIN screen
  function _showFrozenIndicator() {
    var existing = document.getElementById('pin-frozen-indicator');
    if (existing) { existing.style.display = 'flex'; return; }
    var lockScreen = document.getElementById('pin-lock-screen');
    if (!lockScreen) return;
    var ind = document.createElement('div');
    ind.id = 'pin-frozen-indicator';
    ind.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;position:absolute;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:50px;padding:8px 20px;z-index:10;white-space:nowrap;';
    // Direct lookup: window.translator may not exist yet on cold start
    // (Translator class is in script.js which loads later)
    var t = 'Waiting for connection...';
    try {
      if (window.translator && typeof window.translator.translate === 'function') {
        t = window.translator.translate('Waiting for connection...');
      } else if (window.translations) {
        var lang = window.__preloadedLang || localStorage.getItem('preferredLanguage') || 'en';
        var tr = window.translations[lang];
        if (tr && tr['Waiting for connection...']) t = tr['Waiting for connection...'];
      }
    } catch(e) {}
    ind.innerHTML = '<span style="width:8px;height:8px;background:#ef4444;border-radius:50%;animation:offDotBlink 1.4s ease-in-out infinite"></span><span style="font-size:0.82rem;font-weight:600;color:#ef4444">' + t + '</span>';
    lockScreen.appendChild(ind);
  }
  function _hideFrozenIndicator() {
    var ind = document.getElementById('pin-frozen-indicator');
    if (ind) ind.style.display = 'none';
  }

  // Freeze/unfreeze PIN (used by offline detector)
  window.freezePin = function() {
    _pinFrozen = true;
    _showFrozenIndicator();
    console.log('[PIN] Frozen — waiting for internet');
  };
  window.unfreezePin = function() {
    if (!_pinFrozen) return;
    _pinFrozen = false;
    _hideFrozenIndicator();
    console.log('[PIN] Unfrozen — internet available');

    // CRITICAL: Reset biometric flag — may be stuck from a previous failed attempt
    window._biometricInProgress = false;

    var bioBtn = document.getElementById('pin-biometric-btn');

    // Re-check biometric availability (plugin may not have been ready on cold start)
    // Then auto-trigger biometric prompt AFTER a delay (let system stabilize)
    if (isLocked && biometricEnabled) {
      checkBiometricAvailabilityAsync().then(function(available) {
        if (bioBtn) {
          bioBtn.style.visibility = (biometricEnabled && biometricAvailable) ? 'visible' : 'hidden';
        }
        if (available && isLocked && !_pinFrozen) {
          // Delay biometric trigger — give system time to fully stabilize after reconnect
          setTimeout(function() {
            if (isLocked && !_pinFrozen) {
              window._biometricInProgress = false;
              triggerBiometricAuth();
            }
          }, 1200);
        }
      });
    } else if (bioBtn) {
      bioBtn.style.visibility = 'hidden';
    }
  };

  // Show frozen PIN directly from cache (for cold start without internet)
  // Works even when currentUser isn't loaded yet
  window.showFrozenPinFromCache = function() {
    if (isLocked) return; // Already showing
    // Load PIN state from cache (with fallback to accessoireUser)
    var hadLocal = loadLocalPinState();
    if (hadLocal && pinEnabled) {
      // Don't wait for biometric check — show PIN immediately, check biometric later
      _pinFrozen = true;
      showLockScreen();
      // Check biometric in background for when PIN unfreezes
      checkBiometricAvailabilityAsync();
    }
  };

  // Wait for splash screen to go away, then trigger biometric
  // deviceready = Cordova is ready = splash screen hides after this
  // Then 1.5s delay so user sees PIN screen clearly before biometric popup
  function _waitForDeviceReadyThenBiometric() {
    function _triggerAfterDelay() {
      setTimeout(function() {
        if (!isLocked || _pinFrozen || !navigator.onLine) return;
        checkBiometricAvailabilityAsync().then(function(available) {
          if (available && isLocked && !_pinFrozen) {
            window._biometricInProgress = false;
            triggerBiometricAuth();
          }
        });
      }, 1500);
    }
    // If deviceready already fired, just delay
    if (window._cordovaReady) {
      _triggerAfterDelay();
    } else {
      document.addEventListener('deviceready', function() {
        window._cordovaReady = true;
        _triggerAfterDelay();
      }, false);
      // Fallback in case deviceready never fires (browser testing)
      setTimeout(function() {
        if (!window._cordovaReady) _triggerAfterDelay();
      }, 5000);
    }
  }

  // ===== IMMEDIATE COLD START CHECK =====
  // This runs SYNCHRONOUSLY when the script loads
  // Shows PIN lock screen IMMEDIATELY from localStorage cache
  // BEFORE script.js can show the dashboard — prevents PIN bypass
  (function _immediateColdStartCheck() {
    if (window._pinUnlocked) return; // Already unlocked

    // Gate: _pin_active must be set — cleared on logout, so no PIN on login screen
    var pinActiveRaw = localStorage.getItem('_pin_active');
    if (!pinActiveRaw) return;

    // Parse _pin_active for saved userId and biometric state
    var pinActiveData = null;
    try { pinActiveData = JSON.parse(pinActiveRaw); } catch(e) {}

    // Check PIN from localStorage directly
    try {
      var data = null;

      // Method 1: standard path via accessoireUser
      var saved = localStorage.getItem('accessoireUser');
      if (saved) {
        var user = JSON.parse(saved);
        if (user && user.id) {
          var raw = localStorage.getItem('pin_state_' + user.id);
          if (raw) data = JSON.parse(raw);
        }
      }

      // Method 2: use userId from _pin_active
      if (!data && pinActiveData && pinActiveData.u) {
        var raw2 = localStorage.getItem('pin_state_' + pinActiveData.u);
        if (raw2) data = JSON.parse(raw2);
      }

      // Method 3: _pin_active exists but no pin_state found — use _pin_active data
      if (!data) {
        data = {
          pinEnabled: true,
          biometricEnabled: !!(pinActiveData && pinActiveData.b)
        };
      }

      if (!data || !data.pinEnabled) return;
      
      // PIN is enabled → show lock screen IMMEDIATELY
      console.log('[PIN] Cold start + PIN enabled — showing lock screen immediately');
      pinEnabled = true;
      biometricEnabled = data.biometricEnabled || false;
      // Ensure _pin_active is up-to-date with rich data
      try {
        var uid = getUserId();
        localStorage.setItem('_pin_active', JSON.stringify({u: uid, b: biometricEnabled}));
      } catch(e3) {}
      // Global flag: tells OfflineDetector to NEVER show offline page
      // PIN lock screen takes priority on cold start
      window._pinRequiredOnStart = true;
      
      // If offline, freeze the PIN
      if (!navigator.onLine) {
        _pinFrozen = true;
      }
      
      // We need DOM ready for PIN screen element
      var lockEl = document.getElementById('pin-lock-screen');
      if (lockEl) {
        showLockScreen();
        // Check biometric in background — on cold start biometricAvailable is still false
        // so showLockScreen's auto-trigger won't fire. We handle it here instead.
        // Check biometric in background for button visibility
        checkBiometricAvailabilityAsync().then(function(available) {
          var bioBtn = document.getElementById('pin-biometric-btn');
          if (bioBtn) {
            bioBtn.style.visibility = (biometricEnabled && biometricAvailable) ? 'visible' : 'hidden';
          }
        });
        // Auto-trigger biometric ONLY after splash screen is gone + PIN visible
        // deviceready = Cordova ready = splash screen about to hide
        // Then wait 1.5s so user clearly sees PIN screen first
        _waitForDeviceReadyThenBiometric();
      } else {
        // DOM not ready yet — wait for it
        document.addEventListener('DOMContentLoaded', function() {
          if (!isLocked && !window._pinUnlocked) {
            showLockScreen();
            checkBiometricAvailabilityAsync().then(function(available) {
              var bioBtn = document.getElementById('pin-biometric-btn');
              if (bioBtn) {
                bioBtn.style.visibility = (biometricEnabled && biometricAvailable) ? 'visible' : 'hidden';
              }
            });
            _waitForDeviceReadyThenBiometric();
          }
        });
      }
    } catch(e) { console.warn('[PIN] Cold start check error:', e); }
  })();

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPinSystem);
  } else {
    initPinSystem();
  }

})();
