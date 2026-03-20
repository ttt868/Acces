// Daily Missions System
// Real verification system - no cheating allowed
// Using unique ms- prefix for all IDs

(function() {
  'use strict';

  // ✅ دالة showNotification محلية - متاحة عالمياً
  // إذا لم تكن موجودة في window، ننشئها
  if (!window.showNotification) {
    window.showNotification = function(message, type = 'info') {
      if (!document.body) return;
      
      const notification = document.createElement('div');
      notification.className = `notification ${type}`;
      notification.innerHTML = `
        <div class="notification-content">
          <i class="fas ${type === 'success' ? 'fa-check' : type === 'error' ? 'fa-exclamation-circle' : type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle'}"></i>
          <p>${message}</p>
          <span class="close-btn"><i class="fas fa-times"></i></span>
        </div>
      `;
      document.body.appendChild(notification);
      
      setTimeout(() => notification.classList.add('show'), 100);
      
      notification.querySelector('.close-btn').addEventListener('click', () => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
      });
      
      setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
      }, 5000);
    };
  }

  // Helper function to update balance instantly in UI
  function msUpdateBalanceInstantly(reward) {
    if (window.currentUser) {
      const currentBalance = parseFloat(window.currentUser.coins || 0);
      const newBalance = currentBalance + reward;
      window.currentUser.coins = newBalance;
      
      // Update all balance display elements - show full precision (4-6 decimals)
      // Round to 6 decimal places to avoid floating point errors
      const preciseBalance = Math.round(newBalance * 1000000) / 1000000;
      // Format: show at least 2 decimals, but up to 6 if needed
      let formatted;
      if (preciseBalance === Math.floor(preciseBalance)) {
        formatted = preciseBalance.toFixed(2); // whole number: show .00
      } else if (Math.round(preciseBalance * 100) === preciseBalance * 100) {
        formatted = preciseBalance.toFixed(2); // 2 decimals exact
      } else if (Math.round(preciseBalance * 1000) === preciseBalance * 1000) {
        formatted = preciseBalance.toFixed(3); // 3 decimals
      } else if (Math.round(preciseBalance * 10000) === preciseBalance * 10000) {
        formatted = preciseBalance.toFixed(4); // 4 decimals
      } else {
        formatted = preciseBalance.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.00'); // up to 6, trim zeros
      }
      
      // التحقق من حالة إخفاء الرصيد
      const isBalanceHidden = localStorage.getItem('balanceHidden') === 'true';
      if (!isBalanceHidden) {
        const coinElements = document.querySelectorAll('#user-coins, #profile-coins, .wallet-balance, .balance-display, .user-balance');
        coinElements.forEach(el => {
          if (el) el.textContent = formatted;
        });
      }
      
      // Save session
      if (window.saveUserSession) {
        window.saveUserSession(window.currentUser);
      }
      
      console.log('[Missions] Balance updated instantly:', currentBalance, '+', reward, '=', newBalance, 'formatted:', formatted);
    }
  }

  // Mission configuration
  const MISSIONS_CONFIG = {
    follow_twitter: {
      id: 'follow_twitter',
      reward: 0.02,
      url: 'https://x.com/Access_Chain',
      type: 'social',
      verifyDelay: 10000 // 10 seconds - faster verification
    },
    join_telegram: {
      id: 'join_telegram', 
      reward: 0.02,
      url: 'https://t.me/accesschain',
      type: 'social',
      verifyDelay: 10000 // 10 seconds - faster verification
    },
    complete_activity: {
      id: 'complete_activity',
      reward: 0.02,
      type: 'activity'
    },
    send_transaction: {
      id: 'send_transaction',
      reward: 0.02,
      type: 'activity'
    },
    invite_friend: {
      id: 'invite_friend',
      reward: 0.02,
      type: 'activity'
    },
    view_profile: {
      id: 'view_profile',
      reward: 0.01,
      type: 'visit'
    },
    view_network: {
      id: 'view_network',
      reward: 0.01,
      type: 'visit'
    }
  };

  // Daily rewards by streak day
  const STREAK_REWARDS = {
    1: 0.01,
    2: 0.02,
    3: 0.03,
    4: 0.04,
    5: 0.05,
    6: 0.06,
    7: 0.15
  };

  const BONUS_REWARD = 0.05;
  const TOTAL_MISSIONS = 7;

  // State
  let missionsState = {
    streak: 0,
    lastClaimDate: null,
    dailyClaimed: false,
    completedMissions: {},
    bonusClaimed: false,
    socialVerification: {},
    // Personal cycle info from server
    cycleActive: false,
    cycleRemainingMs: 0,
    cycleStart: null,
    serverTime: null
  };

  // Initialize missions system
  window.initMissionsSystem = async function() {
    console.log('[Missions] Initializing missions system...');
    await loadMissionsState();
    console.log('[Missions] State loaded, updating UI...');
    updateMissionsUI();
    startResetCountdown();
    
    // NOTE: Daily reset is handled by the SERVER in /api/missions/status
    // DO NOT call checkDailyReset() here - it would overwrite server data!
    console.log('[Missions] Initialization complete');
  };

  // Load missions state from server
  async function loadMissionsState() {
    try {
      const user = window.currentUser || currentUser;
      if (!user || !user.token) {
        console.log('[Missions] No user or token, skipping load');
        return;
      }
      const token = user.token;

      console.log('[Missions] Loading state from server...');
      const apiBase = (typeof window.getApiOrigin === 'function') ? window.getApiOrigin() : window.location.origin;
      const response = await fetch(apiBase + '/api/missions/status', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[Missions] Server response:', data);
        console.log('[Missions] Server streak value:', data.streak);
        missionsState = {
          streak: data.streak || 0,
          lastClaimDate: data.lastClaimDate,
          dailyClaimed: data.dailyClaimed || false,
          completedMissions: data.completedMissions || {},
          bonusClaimed: data.bonusClaimed || false,
          socialVerification: data.socialVerification || {},
          // Personal cycle info from server (cannot be tampered)
          cycleActive: data.cycleActive || false,
          cycleRemainingMs: data.cycleRemainingMs || 0,
          cycleStart: data.cycleStart || null,
          serverTime: data.serverTime || Date.now()
        };
        console.log('[Missions] missionsState.streak after load:', missionsState.streak);
        console.log('[Missions] State loaded with personal cycle:', missionsState.cycleActive, 'remaining:', missionsState.cycleRemainingMs);
      } else {
        console.error('[Missions] Failed to load state:', response.status);
      }
    } catch (error) {
      console.error('Error loading missions:', error);
    }
  }

  // Save missions state to server
  async function saveMissionsState() {
    try {
      const user = window.currentUser || currentUser;
      if (!user || !user.token) return;
      const token = user.token;

      const apiBase = (typeof window.getApiOrigin === 'function') ? window.getApiOrigin() : window.location.origin;
      await fetch(apiBase + '/api/missions/update', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(missionsState)
      });
    } catch (error) {
      console.error('Error saving missions:', error);
    }
  }

  // Check and reset daily missions
  // NOTE: This function is DISABLED - daily reset is handled by SERVER in /api/missions/status
  // Keeping the function for reference but it should NOT be called
  function checkDailyReset() {
    // DISABLED: Server handles daily reset to prevent data corruption
    // The server already resets daily missions when /api/missions/status is called
    // and it properly preserves permanent missions (follow_twitter, join_telegram)
    console.log('[Missions] checkDailyReset is disabled - server handles this');
    return;
  }

  // Update all UI elements
  function updateMissionsUI() {
    updateStreakBadge();
    updateStreakDays();
    updateDailyClaimButton();
    updateMissionItems();
    updateBonusProgress();
    updateResetCountdown();
  }

  // Update streak badge
  function updateStreakBadge() {
    const streakCount = document.getElementById('ms-streak-count');
    if (streakCount) {
      streakCount.textContent = missionsState.streak;
    }
  }

  // Update streak day circles
  function updateStreakDays() {
    const streakDays = document.querySelectorAll('.ms-streak-day');
    const streak = missionsState.streak || 0;
    
    console.log('[Missions] updateStreakDays - streak:', streak, 'dailyClaimed:', missionsState.dailyClaimed);
    
    streakDays.forEach((day, index) => {
      const dayNum = index + 1;
      day.classList.remove('completed', 'current');
      
      // ✅ كل الأيام المكتملة تُعلَّم بالأخضر
      if (dayNum <= streak) {
        day.classList.add('completed');
        console.log('[Missions] Day', dayNum, 'marked as COMPLETED');
      } 
      // ✅ اليوم التالي نابض فقط إذا لم يتم claim اليوم (متاح للمطالبة)
      else if (dayNum === streak + 1 && !missionsState.dailyClaimed) {
        day.classList.add('current');
        console.log('[Missions] Day', dayNum, 'marked as CURRENT');
      }
    });
  }

  // Update daily claim button
  function updateDailyClaimButton() {
    const btn = document.getElementById('ms-claim-daily-btn');
    if (!btn) return;

    const iconEl = btn.querySelector('i');

    if (missionsState.dailyClaimed) {
      // لا نعطل الزر - نتركه قابل للنقر لإظهار رسالة "تم الاستلام"
      btn.classList.add('claimed');
      if (iconEl) {
        iconEl.className = 'fas fa-check';
      }
    } else {
      btn.classList.remove('claimed');
      if (iconEl) {
        iconEl.className = 'fas fa-hand-pointer';
      }
    }
  }

  // Helper function to check if a mission is completed
  function isMissionCompleted(missionId) {
    const mission = missionsState.completedMissions[missionId];
    if (!mission) return false;
    // Support both old format (boolean) and new format (object with completed property)
    return mission === true || (typeof mission === 'object' && mission.completed);
  }

  // Update mission items
  function updateMissionItems() {
    console.log('[Missions] Updating mission items, state:', missionsState.completedMissions);
    Object.keys(MISSIONS_CONFIG).forEach(missionId => {
      const elementId = `ms-${missionId.replace(/_/g, '-')}`;
      const missionEl = document.getElementById(elementId);
      if (!missionEl) {
        console.log('[Missions] Element not found:', elementId);
        return;
      }

      const btn = missionEl.querySelector('.ms-btn');
      const isCompleted = isMissionCompleted(missionId);
      console.log('[Missions]', missionId, 'isCompleted:', isCompleted);

      if (isCompleted) {
        missionEl.classList.add('completed');
        if (btn) {
          btn.classList.add('completed');
          btn.disabled = true;
        }
      } else {
        missionEl.classList.remove('completed');
        if (btn) {
          btn.classList.remove('completed');
          btn.disabled = false;
        }
      }
    });
  }

  // Update bonus progress
  function updateBonusProgress() {
    const completedCount = Object.keys(missionsState.completedMissions).filter(
      k => isMissionCompleted(k)
    ).length;
    
    // Add daily claim to count if claimed
    const totalCompleted = completedCount + (missionsState.dailyClaimed ? 1 : 0);
    
    const progressEl = document.getElementById('ms-bonus-progress');
    const completedEl = document.getElementById('ms-completed-tasks');
    const totalEl = document.getElementById('ms-total-tasks');
    const bonusBtn = document.getElementById('ms-claim-bonus-btn');

    if (progressEl) {
      const percent = (totalCompleted / (TOTAL_MISSIONS + 1)) * 100;
      progressEl.style.width = `${percent}%`;
    }

    if (completedEl) {
      completedEl.textContent = totalCompleted;
    }

    if (totalEl) {
      totalEl.textContent = TOTAL_MISSIONS + 1;
    }

    if (bonusBtn) {
      if (missionsState.bonusClaimed) {
        bonusBtn.disabled = true;
        bonusBtn.classList.add('claimed');
        const bonusClaimedText = window.translator.translate('Bonus Claimed');
        bonusBtn.innerHTML = `<i class="fas fa-check"></i> <span data-translate="Bonus Claimed">${bonusClaimedText}</span>`;
      } else if (totalCompleted >= TOTAL_MISSIONS + 1) {
        bonusBtn.disabled = false;
        bonusBtn.classList.remove('claimed');
      } else {
        bonusBtn.disabled = true;
        bonusBtn.classList.remove('claimed');
      }
    }
  }

  // Claim daily reward
  window.msClaimDaily = async function() {
    if (missionsState.dailyClaimed) {
      window.showNotification(window.translator.translate('Already claimed today'), 'info');
      return;
    }

    try {
      const user = window.currentUser || currentUser;
      if (!user || !user.token) {
        window.showNotification(window.translator.translate('Please login first'), 'error');
        return;
      }
      const token = user.token;

      const apiBase = (typeof window.getApiOrigin === 'function') ? window.getApiOrigin() : window.location.origin;
      const response = await fetch(apiBase + '/api/missions/claim-daily', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Session-Token': user.sessionToken || user.session_token || ''
        }
      });

      const data = await response.json();

      if (response.ok) {
        missionsState.streak = data.streak;
        missionsState.dailyClaimed = true;
        missionsState.lastClaimDate = new Date().toISOString();
        
        updateMissionsUI();
        window.showNotification(`+${data.reward} ${window.translator.translate('points_earned')}`, 'success');
        
        // تحديث الرصيد فوراً
        msUpdateBalanceInstantly(data.reward);
      } else {
        // ترجمة رسالة الخطأ من السيرفر
        const errorMsg = data.error ? window.translator.translate(data.error) : window.translator.translate('Failed to claim reward');
        window.showNotification(errorMsg, 'error');
      }
    } catch (error) {
      console.error('Error claiming daily:', error);
      window.showNotification(window.translator.translate('Network error'), 'error');
    }
  };

  // Start social mission
  window.msStartMission = function(missionId) {
    const config = MISSIONS_CONFIG[missionId];
    if (!config) return;

    if (missionsState.completedMissions[missionId]) {
      window.showNotification(window.translator.translate('Already completed!'), 'info');
      return;
    }

    // Show verification modal
    showVerificationModal(missionId, config);
  };

  // Show verification modal for social tasks (using separate modals from index.html)
  function showVerificationModal(missionId, config) {
    const isTwitter = missionId === 'follow_twitter';
    const modalId = isTwitter ? 'ms-modal-twitter' : 'ms-modal-telegram';
    const modal = document.getElementById(modalId);
    if (!modal) {
      console.error('Modal not found:', modalId);
      return;
    }
    
    // Get elements based on platform
    const prefix = isTwitter ? 'ms-twitter' : 'ms-telegram';
    const usernameInput = document.getElementById(`${prefix}-username`);
    const verifyBtn = document.getElementById(`${prefix}-verify-btn`);
    const timerEl = document.getElementById(`${prefix}-timer`);
    const openBtn = document.getElementById(`${prefix}-open-btn`);
    const countdownEl = document.getElementById(`${prefix}-countdown`);
    
    // Reset state
    if (usernameInput) usernameInput.value = '';
    if (verifyBtn) verifyBtn.disabled = true;
    if (timerEl) timerEl.style.display = 'none';
    if (countdownEl) countdownEl.textContent = '7';
    
    // Set onclick handlers
    if (openBtn) {
      openBtn.onclick = () => {
        window.open(config.url, '_blank');
        
        // Store start time immediately when user opens the link
        missionsState.socialVerification[missionId] = {
          startTime: Date.now(),
          opened: true,
          platform: isTwitter ? 'twitter' : 'telegram'
        };
        
        // Start countdown - 7 seconds
        if (timerEl) timerEl.style.display = 'block';
        
        let countdown = 7;
        const interval = setInterval(() => {
          countdown--;
          if (countdownEl) countdownEl.textContent = countdown;
          
          if (countdown <= 0) {
            clearInterval(interval);
            if (timerEl) timerEl.style.display = 'none';
            if (verifyBtn) verifyBtn.disabled = false;
            
            
          }
        }, 1000);
      };
    }
    
    if (verifyBtn) {
      verifyBtn.onclick = () => msVerifyMission(missionId);
    }
    
    // Show modal
    modal.style.display = 'flex';
    modal.onclick = (e) => { if (e.target === modal) msCloseModal(); };
  }

  // Close verification modal
  window.msCloseModal = function() {
    const twitterModal = document.getElementById('ms-modal-twitter');
    const telegramModal = document.getElementById('ms-modal-telegram');
    if (twitterModal) twitterModal.style.display = 'none';
    if (telegramModal) telegramModal.style.display = 'none';
    
    // Reset attempt counters when modal closes
    missionsState.verificationAttempts = {};
  };

  // Verify social mission - Simple: just check username not used by others
  window.msVerifyMission = async function(missionId) {
    const verification = missionsState.socialVerification[missionId];
    
    if (!verification || !verification.opened) {
      window.showNotification(window.translator.translate('please_complete_task_first'), 'error');
      return;
    }

    // Prevent double-click
    if (verification.isVerifying) {
      return;
    }

    // Get username from correct input based on platform
    const prefix = verification.platform === 'twitter' ? 'ms-twitter' : 'ms-telegram';
    const usernameInput = document.getElementById(`${prefix}-username`);
    const verifyBtn = document.getElementById(`${prefix}-verify-btn`);
    const username = usernameInput ? usernameInput.value.trim() : '';
    
    // Require username
    if (!username) {
      window.showNotification(window.translator.translate('please_enter_username'), 'error');
      if (usernameInput) {
        usernameInput.style.borderColor = 'red';
        usernameInput.focus();
      }
      return;
    }
    
    // Validate username format (@username)
    if (!username.startsWith('@') || username.length < 3) {
      window.showNotification(window.translator.translate('Username must start with @'), 'error');
      if (usernameInput) {
        usernameInput.style.borderColor = 'red';
        usernameInput.focus();
      }
      return;
    }

    // Only allow valid username characters
    const usernameWithoutAt = username.substring(1).toLowerCase();
    if (!/^[a-z0-9_]{2,30}$/.test(usernameWithoutAt)) {
      window.showNotification(window.translator.translate('invalid_username_format'), 'error');
      if (usernameInput) {
        usernameInput.style.borderColor = 'red';
        usernameInput.focus();
      }
      return;
    }

    try {
      const user = window.currentUser || currentUser;
      if (!user || !user.token) return;
      const token = user.token;

      // Mark as verifying to prevent spam clicks
      verification.isVerifying = true;
      if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying...';
      }

      const apiBase = (typeof window.getApiOrigin === 'function') ? window.getApiOrigin() : window.location.origin;
      const response = await fetch(apiBase + '/api/missions/verify-social', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Session-Token': user.sessionToken || user.session_token || ''
        },
        body: JSON.stringify({
          missionId: missionId,
          verificationTime: Date.now() - verification.startTime,
          socialUsername: username
        })
      });

      const data = await response.json();

      if (response.ok) {
        // SUCCESS! Mission completed forever
        missionsState.completedMissions[missionId] = true;
        msCloseModal();
        updateMissionsUI();
        window.showNotification(`+${MISSIONS_CONFIG[missionId].reward} ${window.translator.translate('points_earned')}`, 'success');
        
        // Add animation
        const missionEl = document.getElementById(`ms-${missionId.replace(/_/g, '-')}`);
        if (missionEl) {
          missionEl.classList.add('just-completed');
          setTimeout(() => missionEl.classList.remove('just-completed'), 500);
        }

        // تحديث الرصيد فوراً
        msUpdateBalanceInstantly(MISSIONS_CONFIG[missionId].reward);
      } else {
        // FAILED - show error
        if (data.code === 'USERNAME_ALREADY_USED') {
          window.showNotification(window.translator.translate('This username has already been used by another account!'), 'error');
        } else {
          const errorMsg = data.error ? window.translator.translate(data.error) : window.translator.translate('Verification failed');
          window.showNotification(errorMsg, 'error');
        }
      }
    } catch (error) {
      console.error('Error verifying mission:', error);
      window.showNotification(window.translator.translate('Network error'), 'error');
    } finally {
      // Reset verifying state
      verification.isVerifying = false;
      if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify';
      }
    }
  };

  // Check activity-based mission
  window.msCheckMission = async function(missionId) {
    console.log('[Missions] Checking mission:', missionId);
    
    if (missionsState.completedMissions[missionId]) {
      window.showNotification(window.translator.translate('Already completed!'), 'info');
      return;
    }

    try {
      const user = window.currentUser || currentUser;
      if (!user || !user.token) {
        window.showNotification(window.translator.translate('Please login first'), 'error');
        return;
      }
      const token = user.token;

      const apiBase = (typeof window.getApiOrigin === 'function') ? window.getApiOrigin() : window.location.origin;
      const response = await fetch(apiBase + '/api/missions/check', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Session-Token': user.sessionToken || user.session_token || ''
        },
        body: JSON.stringify({ missionId })
      });

      const data = await response.json();
      console.log('[Missions] Server response:', data);

      if (response.ok && data.completed) {
        missionsState.completedMissions[missionId] = true;
        updateMissionsUI();
        window.showNotification(`+${MISSIONS_CONFIG[missionId].reward} ${window.translator.translate('points_earned')}`, 'success');
        
        const missionEl = document.getElementById(`ms-${missionId.replace(/_/g, '-')}`);
        if (missionEl) {
          missionEl.classList.add('just-completed');
          setTimeout(() => missionEl.classList.remove('just-completed'), 500);
        }

        // تحديث الرصيد فوراً
        const reward = MISSIONS_CONFIG[missionId]?.reward || data.reward || 0.02;
        msUpdateBalanceInstantly(reward);
      } else {
        // Show translated hint message as bubble above mission
        const missionEl = document.getElementById(`ms-${missionId.replace(/_/g, '-')}`);
        const messageKey = data.messageKey || 'mission_hint_default';
        const translatedMsg = window.translator.translate(messageKey);
        console.log('[Missions] Showing hint:', translatedMsg, 'Element:', missionEl);
        
        if (missionEl) {
          // Remove old hint if exists
          const oldHint = missionEl.querySelector('.ms-mission-hint');
          if (oldHint) oldHint.remove();
          
          // Create new hint bubble
          const hintEl = document.createElement('div');
          hintEl.className = 'ms-mission-hint ms-hint-show';
          hintEl.textContent = translatedMsg;
          missionEl.appendChild(hintEl);
          
          // Remove after 3 seconds
          setTimeout(() => {
            hintEl.classList.remove('ms-hint-show');
            setTimeout(() => hintEl.remove(), 300);
          }, 3000);
        } else {
          // Fallback to toast
          window.showNotification(translatedMsg, 'info');
        }
      }
    } catch (error) {
      console.error('Error checking mission:', error);
      window.showNotification(window.translator.translate('Network error'), 'error');
    }
  };

  // Complete visit mission
  window.msVisitPage = async function(missionId, page) {
    if (missionsState.completedMissions[missionId]) {
      // Just navigate
      if (page === 'profile') {
        window.showPage('profile');
      } else if (page === 'network') {
        window.showPage('network');
      }
      return;
    }

    try {
      const user = window.currentUser || currentUser;
      if (!user || !user.token) {
        window.showNotification(window.translator.translate('Please login first'), 'error');
        return;
      }
      const token = user.token;

      // Navigate first
      if (page === 'profile') {
        window.showPage('profile');
      } else if (page === 'network') {
        window.showPage('network');
      }

      // Then complete the mission
      const apiBase = (typeof window.getApiOrigin === 'function') ? window.getApiOrigin() : window.location.origin;
      const response = await fetch(apiBase + '/api/missions/complete-visit', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Session-Token': user.sessionToken || user.session_token || ''
        },
        body: JSON.stringify({ missionId, page })
      });

      const data = await response.json();

      if (response.ok) {
        // تحقق إذا كانت المهمة مكتملة بالفعل
        if (data.alreadyCompleted) {
          missionsState.completedMissions[missionId] = true;
          updateMissionsUI();
          return;
        }
        
        missionsState.completedMissions[missionId] = true;
        setTimeout(() => {
          updateMissionsUI();
          window.showNotification(`+${MISSIONS_CONFIG[missionId].reward} ${window.translator.translate('points_earned')}`, 'success');
        }, 500);

        // تحديث الرصيد فوراً
        msUpdateBalanceInstantly(MISSIONS_CONFIG[missionId].reward);
      }
    } catch (error) {
      console.error('Error completing visit:', error);
    }
  };

  // Claim bonus
  window.msClaimBonus = async function() {
    if (missionsState.bonusClaimed) return;

    const completedCount = Object.keys(missionsState.completedMissions).filter(
      k => missionsState.completedMissions[k]
    ).length;
    const totalCompleted = completedCount + (missionsState.dailyClaimed ? 1 : 0);

    if (totalCompleted < TOTAL_MISSIONS + 1) {
      window.showNotification(window.translator.translate('Complete all tasks first!'), 'error');
      return;
    }

    try {
      const user = window.currentUser || currentUser;
      if (!user || !user.token) return;
      const token = user.token;

      const apiBase = (typeof window.getApiOrigin === 'function') ? window.getApiOrigin() : window.location.origin;
      const response = await fetch(apiBase + '/api/missions/claim-bonus', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Session-Token': user.sessionToken || user.session_token || ''
        }
      });

      const data = await response.json();

      if (response.ok) {
        missionsState.bonusClaimed = true;
        updateMissionsUI();
        window.showNotification(`+${BONUS_REWARD} ${window.translator.translate('bonus_points_earned')}`, 'success');

        // تحديث الرصيد فوراً
        msUpdateBalanceInstantly(BONUS_REWARD);
      } else {
        // ترجمة رسالة الخطأ من السيرفر
        const errorMsg = data.error ? window.translator.translate(data.error) : window.translator.translate('Failed to claim bonus');
        window.showNotification(errorMsg, 'error');
      }
    } catch (error) {
      console.error('Error claiming bonus:', error);
      window.showNotification(window.translator.translate('Network error'), 'error');
    }
  };

  // SERVER-CONTROLLED countdown - cannot be tampered by client
  let countdownInitialPerf = null;      // performance.now() when countdown started
  let countdownTargetMs = null;         // Milliseconds until reset (FROM SERVER)
  let countdownInterval = null;         // Interval reference

  // Start reset countdown - uses SERVER time, not client time
  function startResetCountdown() {
    // Clear any existing interval
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    
    // Use cycle info from server (loaded in loadMissionsState)
    if (missionsState.cycleActive && missionsState.cycleRemainingMs > 0) {
      // User has active cycle - use server-provided remaining time
      countdownInitialPerf = performance.now();
      countdownTargetMs = missionsState.cycleRemainingMs;
      console.log('[Missions] Personal cycle active - remaining:', Math.floor(countdownTargetMs / 1000), 'seconds');
    } else {
      // No active cycle - show "Complete a task to start"
      const countdownEl = document.getElementById('ms-reset-countdown');
      if (countdownEl) {
        countdownEl.textContent = '--:--:--';
      }
      console.log('[Missions] No active cycle - waiting for first task');
      return;
    }
    
    updateResetCountdown();
    countdownInterval = setInterval(updateResetCountdown, 1000);
  }

  // Update reset countdown - PROTECTED from device clock tampering
  function updateResetCountdown() {
    const countdownEl = document.getElementById('ms-reset-countdown');
    if (!countdownEl) return;

    // No active cycle
    if (!countdownTargetMs || countdownTargetMs <= 0) {
      countdownEl.textContent = '--:--:--';
      return;
    }

    // Use performance.now() to measure REAL elapsed time (unaffected by clock changes)
    const elapsedMs = performance.now() - countdownInitialPerf;
    const remainingMs = countdownTargetMs - elapsedMs;
    
    // If countdown finished, reload from server
    if (remainingMs <= 0) {
      countdownEl.textContent = '00:00:00';
      
      // Stop interval
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      
      // Reload missions state from server after reset
      console.log('[Missions] Cycle completed - reloading from server');
      loadMissionsState().then(() => {
        updateMissionsUI();
        startResetCountdown(); // Restart with new server data
      });
      return;
    }

    const hours = Math.floor(remainingMs / (1000 * 60 * 60));
    const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000);

    countdownEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  // Uses global window.showNotification from script.js - no local definition needed

})();
