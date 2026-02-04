/**
 * Cordova App Initialization - FINAL CLEAN VERSION
 * This file MUST be loaded before script.js
 */

// ✅ API Configuration
window.API_BASE_URL = 'https://accesschain.org';
window.WS_BASE_URL = 'wss://accesschain.org';
window.IS_CORDOVA_APP = true;

// Google Sign-In
window.GOOGLE_CLIENT_ID_WEB = '586936149662-ja0tlfjfinl2sl17j9ntp3m1avnf3dhn.apps.googleusercontent.com';

console.log('📱 Cordova Init - API:', window.API_BASE_URL);

// ✅ CRITICAL: Helper to get correct API origin
window.getApiOrigin = function() {
    return window.API_BASE_URL;
};

// ✅ CRITICAL: Override fetch IMMEDIATELY
(function() {
    const originalFetch = window.fetch;
    
    window.fetch = function(url, options) {
        let finalUrl = url;
        
        if (typeof url === 'string') {
            // Case 1: Relative API path
            if (url.startsWith('/api') || url.startsWith('/rpc')) {
                finalUrl = window.API_BASE_URL + url;
            }
            // Case 2: file:// URL with API path
            else if (url.includes('file://') && (url.includes('/api') || url.includes('/rpc'))) {
                const idx = url.includes('/api') ? url.indexOf('/api') : url.indexOf('/rpc');
                finalUrl = window.API_BASE_URL + url.substring(idx);
            }
            // Case 3: null origin
            else if (url.startsWith('null/api') || url.startsWith('null/rpc')) {
                finalUrl = window.API_BASE_URL + url.substring(4);
            }
            // Case 4: https://localhost with API (Cordova WebView)
            else if (url.includes('localhost') && (url.includes('/api') || url.includes('/rpc'))) {
                const idx = url.includes('/api') ? url.indexOf('/api') : url.indexOf('/rpc');
                finalUrl = window.API_BASE_URL + url.substring(idx);
            }
            
            // Log API calls
            if (finalUrl !== url && (finalUrl.includes('/api') || finalUrl.includes('/rpc'))) {
                console.log('📡 [FETCH]', url, '→', finalUrl);
            }
        }
        
        return originalFetch.call(this, finalUrl, options);
    };
    
    console.log('✅ Fetch override installed');
})();

// ✅ Override XMLHttpRequest
(function() {
    const originalOpen = XMLHttpRequest.prototype.open;
    
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
        let finalUrl = url;
        
        if (typeof url === 'string') {
            if (url.startsWith('/api') || url.startsWith('/rpc')) {
                finalUrl = window.API_BASE_URL + url;
            }
            else if (url.includes('file://') && (url.includes('/api') || url.includes('/rpc'))) {
                const idx = url.includes('/api') ? url.indexOf('/api') : url.indexOf('/rpc');
                finalUrl = window.API_BASE_URL + url.substring(idx);
            }
            else if (url.includes('localhost') && (url.includes('/api') || url.includes('/rpc'))) {
                const idx = url.includes('/api') ? url.indexOf('/api') : url.indexOf('/rpc');
                finalUrl = window.API_BASE_URL + url.substring(idx);
            }
        }
        
        return originalOpen.call(this, method, finalUrl, async, user, password);
    };
    
    console.log('✅ XHR override installed');
})();

// ✅ Override WebSocket
const OriginalWebSocket = window.WebSocket;
window.WebSocket = function(url, protocols) {
    let finalUrl = url;
    if (url.startsWith('/')) {
        finalUrl = window.WS_BASE_URL + url;
    } else if (url.includes('localhost')) {
        finalUrl = url.replace(/wss?:\/\/localhost(:\d+)?/, window.WS_BASE_URL);
    }
    console.log('📡 [WS]', url, '→', finalUrl);
    return new OriginalWebSocket(finalUrl, protocols);
};
window.WebSocket.prototype = OriginalWebSocket.prototype;

// ✅ Device Ready
document.addEventListener('deviceready', function() {
    console.log('📱 Cordova is ready!');
    
    // StatusBar
    if (window.StatusBar) {
        StatusBar.backgroundColorByHexString('#1a1a2e');
        StatusBar.styleLightContent();
    }
    
    // Setup Google Sign-In
    setupGoogleSignIn();
    
    // Request notification permission (web API)
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            console.log('📱 Notification permission:', permission);
        });
    }
}, false);

// ✅ QR Code Scanner Function (using BarcodeScanner plugin)
window.scanQRCode = function() {
    return new Promise((resolve, reject) => {
        if (window.cordova && window.cordova.plugins && window.cordova.plugins.barcodeScanner) {
            cordova.plugins.barcodeScanner.scan(
                function(result) {
                    if (result.cancelled) {
                        reject('Scan cancelled');
                    } else {
                        console.log('✅ QR Scanned:', result.text);
                        resolve(result.text);
                    }
                },
                function(error) {
                    console.error('❌ QR Scan error:', error);
                    reject(error);
                },
                {
                    preferFrontCamera: false,
                    showFlipCameraButton: true,
                    showTorchButton: true,
                    torchOn: false,
                    saveHistory: false,
                    prompt: "Scan QR Code",
                    resultDisplayDuration: 0,
                    formats: "QR_CODE",
                    orientation: "portrait",
                    disableAnimations: true,
                    disableSuccessBeep: false
                }
            );
        } else {
            // Fallback: prompt user to enter manually
            const address = prompt('QR Scanner not available. Enter wallet address:');
            if (address) {
                resolve(address);
            } else {
                reject('No address entered');
            }
        }
    });
};

// ✅ Paste from Clipboard helper
window.pasteFromClipboard = async function() {
    try {
        if (navigator.clipboard && navigator.clipboard.readText) {
            return await navigator.clipboard.readText();
        } else if (window.cordova && window.cordova.plugins && window.cordova.plugins.clipboard) {
            return new Promise((resolve, reject) => {
                cordova.plugins.clipboard.paste(resolve, reject);
            });
        }
        return '';
    } catch (e) {
        console.error('❌ Clipboard read error:', e);
        return '';
    }
};

// ✅ Google Sign-In Setup
function setupGoogleSignIn() {
    window.signInWithGoogle = async function() {
        console.log('📱 Native Google Sign-In');
        
        if (!window.plugins || !window.plugins.googleplus) {
            console.error('❌ Google Plus plugin not available');
            alert('Google Sign-In not available');
            return;
        }
        
        // Loading indicator
        const loading = document.createElement('div');
        loading.id = 'google-signin-loading';
        loading.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:99999;';
        loading.innerHTML = '<div style="color:#fff;text-align:center;"><div style="margin-bottom:20px;font-size:18px;">Signing in...</div><div style="width:40px;height:40px;border:3px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;margin:auto;"></div></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
        document.body.appendChild(loading);
        
        window.plugins.googleplus.login(
            {
                scopes: 'profile email https://www.googleapis.com/auth/userinfo.profile',
                webClientId: window.GOOGLE_CLIENT_ID_WEB,
                offline: true
            },
            function(userData) {
                console.log('✅ Google Sign-In success:', userData.email);
                console.log('📷 Full userData object:', JSON.stringify(userData, null, 2));
                document.getElementById('google-signin-loading')?.remove();
                
                // Clear old cache
                localStorage.removeItem('accessoireUser');
                localStorage.removeItem('accessoireUserData');
                
                // ✅ FINAL: Always use SVG in Cordova - Google pictures don't work
                const DEFAULT_AVATAR = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2M2YzZjNiIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMTIiIHI9IjciIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMTAgMzBjMC01IDQtOCAxMC04czEwIDMgMTAgOHYxYzAgMS0xIDItMiAyaC0xNmMtMSAwLTIgLTEtMi0ydi0xeiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==';
                
                // Create fake JWT for handleGoogleSignIn
                const payload = {
                    email: userData.email,
                    name: userData.displayName,
                    picture: DEFAULT_AVATAR,
                    sub: userData.userId
                };
                
                // UTF-8 safe base64 encoding
                const b64 = str => {
                    try {
                        return btoa(unescape(encodeURIComponent(str)))
                            .replace(/\+/g, '-')
                            .replace(/\//g, '_')
                            .replace(/=+$/, '');
                    } catch (e) {
                        return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                    }
                };
                const header = b64(JSON.stringify({alg: 'none', typ: 'JWT'}));
                const body = b64(JSON.stringify(payload));
                const fakeCredential = header + '.' + body + '.fake';
                
                if (typeof window.handleGoogleSignIn === 'function') {
                    window.handleGoogleSignIn({ credential: fakeCredential, select_by: 'cordova' });
                } else {
                    alert('Login error. Please try again.');
                }
            },
            function(error) {
                console.error('❌ Google Sign-In error:', error);
                document.getElementById('google-signin-loading')?.remove();
                
                let msg = 'Sign-in failed. ';
                const errStr = String(error);
                if (errStr.includes('12501') || errStr.includes('CANCELLED')) {
                    msg = 'Sign-in cancelled.';
                } else if (errStr.includes('10')) {
                    msg = 'Configuration error (Error 10). Check SHA-1 fingerprint.';
                } else {
                    msg += errStr;
                }
                alert(msg);
            }
        );
    };
    
    window.triggerGoogleSignIn = window.signInWithGoogle;
    console.log('✅ Google Sign-In ready');
}

// ✅ Google Sign-Out
window.nativeGoogleSignOut = function() {
    return new Promise(resolve => {
        if (window.plugins?.googleplus) {
            window.plugins.googleplus.disconnect(() => resolve(), () => resolve());
        } else {
            resolve();
        }
    });
};

// ✅ Deep Links Handler - لمعالجة روابط الدعوة
document.addEventListener('deviceready', function() {
    console.log('📱 Setting up Deep Link handlers...');
    
    // Method 1: IonicDeeplink (if available)
    if (window.IonicDeeplink) {
        console.log('📱 IonicDeeplink available');
        window.IonicDeeplink.route({
            '/': { target: 'index', parent: 'index' }
        }, function(match) {
            console.log('🔗 Deep link matched:', match);
            handleDeepLinkInvite(match.$link);
        }, function(nomatch) {
            console.log('🔗 Deep link no match, checking URL:', nomatch);
            if (nomatch.$link && nomatch.$link.url) {
                handleDeepLinkInvite(nomatch.$link);
            }
        });
    }
    
    // Method 2: Universal Links (cordova-plugin-deeplinks)
    if (window.universalLinks) {
        console.log('📱 universalLinks available');
        window.universalLinks.subscribe('deepLinkHandler', function(eventData) {
            console.log('🔗 Universal link received:', eventData);
            handleDeepLinkInvite(eventData);
        });
    }
    
    // Method 3: Check for intent data on app start
    if (window.plugins && window.plugins.intentShim) {
        window.plugins.intentShim.getIntent(function(intent) {
            if (intent && intent.data) {
                console.log('🔗 Intent data found:', intent.data);
                handleDeepLinkInvite({ url: intent.data });
            }
        }, function(error) {
            console.log('No intent data:', error);
        });
    }
    
    // Method 4: Check window.handleOpenURL (Cordova custom scheme)
    window.handleOpenURL = function(url) {
        console.log('🔗 handleOpenURL called:', url);
        handleDeepLinkInvite({ url: url });
    };
    
    // Method 5: Check if app was opened with URL
    if (window.launchURL) {
        console.log('🔗 Launch URL found:', window.launchURL);
        handleDeepLinkInvite({ url: window.launchURL });
    }
    
}, false);

// Function to handle invite code from deep link
function handleDeepLinkInvite(linkData) {
    try {
        let inviteCode = null;
        let url = linkData.url || linkData;
        
        console.log('🔗 Processing deep link:', url);
        
        // Extract invite code from URL
        if (typeof url === 'string') {
            // Handle both https:// and accessnetwork:// schemes
            try {
                const urlObj = new URL(url);
                inviteCode = urlObj.searchParams.get('invite');
            } catch (e) {
                // Try parsing as query string
                const queryMatch = url.match(/[?&]invite=([^&]+)/);
                if (queryMatch) {
                    inviteCode = queryMatch[1];
                }
            }
        } else if (linkData.queryString) {
            const params = new URLSearchParams(linkData.queryString);
            inviteCode = params.get('invite');
        }
        
        if (inviteCode) {
            console.log('🎉 Invite code found from deep link:', inviteCode);
            
            // Check if user is already logged in
            const savedUserStr = localStorage.getItem('accessoireUser');
            if (savedUserStr) {
                try {
                    const savedUser = JSON.parse(savedUserStr);
                    if (savedUser && savedUser.email) {
                        console.log('User already logged in - ignoring invite code');
                        return;
                    }
                } catch (e) {}
            }
            
            // Save invite code - same as web version
            localStorage.setItem('pendingReferralCode', inviteCode);
            sessionStorage.setItem('currentInviteCode', inviteCode);
            
            // Backup with timestamp
            const inviteBackup = {
                code: inviteCode,
                timestamp: Date.now(),
                source: 'deep_link_cordova',
                userLoggedIn: false
            };
            localStorage.setItem('inviteCodeBackup', JSON.stringify(inviteBackup));
            
            // Try to fill referral input if exists
            fillReferralInput(inviteCode);
            
            // Also try after a delay (in case the page is still loading)
            setTimeout(() => fillReferralInput(inviteCode), 500);
            setTimeout(() => fillReferralInput(inviteCode), 1500);
            setTimeout(() => fillReferralInput(inviteCode), 3000);
            
            // Show notification
            if (typeof showNotification === 'function') {
                showNotification('Referral code applied: ' + inviteCode, 'success');
            }
            
            console.log('✅ Invite code saved successfully');
        }
    } catch (error) {
        console.error('Error processing deep link:', error);
    }
}

// Helper function to fill referral input
function fillReferralInput(inviteCode) {
    const referralInput = document.querySelector('#referral-code');
    if (referralInput && !referralInput.value) {
        console.log('📝 Filling referral input with:', inviteCode);
        referralInput.value = inviteCode;
        
        // Trigger events
        referralInput.dispatchEvent(new Event('input', { bubbles: true }));
        referralInput.dispatchEvent(new Event('change', { bubbles: true }));
        referralInput.dispatchEvent(new Event('keyup', { bubbles: true }));
        
        // Mark as filled
        referralInput.setAttribute('data-user-filled', 'true');
        referralInput.setAttribute('data-invite-source', 'deep_link_cordova');
        
        // Visual feedback
        referralInput.style.borderColor = '#10B981';
        referralInput.style.backgroundColor = '#ECFDF5';
        setTimeout(() => {
            referralInput.style.borderColor = '';
            referralInput.style.backgroundColor = '';
        }, 3000);
    }
}

// Also check for invite code in localStorage on app start (recovered from previous session)
document.addEventListener('deviceready', function() {
    setTimeout(function() {
        // Check if user is already logged in
        const savedUserStr = localStorage.getItem('accessoireUser');
        if (savedUserStr) {
            try {
                const savedUser = JSON.parse(savedUserStr);
                if (savedUser && savedUser.email) {
                    console.log('User logged in - clearing stored invite codes');
                    localStorage.removeItem('pendingReferralCode');
                    sessionStorage.removeItem('currentInviteCode');
                    localStorage.removeItem('inviteCodeBackup');
                    return;
                }
            } catch (e) {}
        }
        
        const savedInviteCode = localStorage.getItem('pendingReferralCode') || 
                               sessionStorage.getItem('currentInviteCode');
        
        if (savedInviteCode) {
            console.log('📦 Found saved invite code:', savedInviteCode);
            fillReferralInput(savedInviteCode);
        } else {
            // Try to recover from backup
            const backupData = localStorage.getItem('inviteCodeBackup');
            if (backupData) {
                try {
                    const backup = JSON.parse(backupData);
                    const isRecent = (Date.now() - backup.timestamp) < 300000; // 5 minutes
                    if (isRecent && backup.code && !backup.userLoggedIn) {
                        console.log('📦 Recovered invite code from backup:', backup.code);
                        fillReferralInput(backup.code);
                    }
                } catch (e) {}
            }
        }
    }, 1500);
}, false);

console.log('📱 Cordova Init complete');
// Build trigger: Tue Feb  3 14:52:12 UTC 2026
