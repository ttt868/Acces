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
            // Case 4: app://localhost or http://localhost with API (Cordova iOS/Android WebView)
            else if ((url.includes('localhost') || url.includes('app://')) && (url.includes('/api') || url.includes('/rpc'))) {
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
            else if ((url.includes('localhost') || url.includes('app://')) && (url.includes('/api') || url.includes('/rpc'))) {
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
    
    // ✅ Override navigator.clipboard to use Cordova plugin
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.clipboard) {
        console.log('📋 Overriding navigator.clipboard with Cordova plugin');
        
        // Store original clipboard
        const originalClipboard = navigator.clipboard;
        
        // Create new clipboard object with Cordova support
        const cordovaClipboard = {
            writeText: function(text) {
                return new Promise((resolve, reject) => {
                    cordova.plugins.clipboard.copy(
                        text,
                        () => {
                            console.log('✅ Clipboard write success (Cordova)');
                            resolve();
                        },
                        (err) => {
                            console.error('❌ Clipboard write error (Cordova):', err);
                            // Fallback to original
                            if (originalClipboard && originalClipboard.writeText) {
                                originalClipboard.writeText(text).then(resolve).catch(reject);
                            } else {
                                reject(err);
                            }
                        }
                    );
                });
            },
            readText: function() {
                return new Promise((resolve, reject) => {
                    cordova.plugins.clipboard.paste(
                        (text) => {
                            console.log('✅ Clipboard read success (Cordova)');
                            resolve(text || '');
                        },
                        (err) => {
                            console.error('❌ Clipboard read error (Cordova):', err);
                            // Fallback to original
                            if (originalClipboard && originalClipboard.readText) {
                                originalClipboard.readText().then(resolve).catch(reject);
                            } else {
                                resolve('');
                            }
                        }
                    );
                });
            }
        };
        
        // Replace navigator.clipboard
        try {
            Object.defineProperty(navigator, 'clipboard', {
                value: cordovaClipboard,
                writable: true,
                configurable: true
            });
            console.log('✅ navigator.clipboard overridden successfully');
        } catch (e) {
            console.warn('⚠️ Could not override navigator.clipboard:', e);
            // Fallback: just set helper functions
            window.nativeClipboard = cordovaClipboard;
        }
    }
    
    // StatusBar + NavigationBar: dynamic colors based on theme
    if (window.StatusBar) {
        window.updateSystemBarsColor = function() {
            var isDark = document.body.classList.contains('dark-theme');
            var isLogin = document.getElementById('login-container') && 
                          document.getElementById('login-container').style.display !== 'none' &&
                          !document.documentElement.classList.contains('user-logged-in');
            var isPinScreen = document.getElementById('pin-lock-screen') &&
                              (document.getElementById('pin-lock-screen').style.display === 'flex' ||
                               document.documentElement.classList.contains('pin-required'));
            
            if (isPinScreen) {
                // PIN screen: dark blue gradient top color
                StatusBar.backgroundColorByHexString('#0f0f1e');
                StatusBar.styleLightContent();
                if (window.NavigationBar) {
                    NavigationBar.backgroundColorByHexString('#0d0d2b', false);
                }
            } else if (isLogin) {
                // Login screen: gradient top color
                StatusBar.backgroundColorByHexString('#2980b9');
                StatusBar.styleLightContent();
                if (window.NavigationBar) {
                    NavigationBar.backgroundColorByHexString('#9b59b6', false);
                }
            } else if (isDark) {
                // Dark mode: light black top, page background bottom
                StatusBar.backgroundColorByHexString('#1a1a1a');
                StatusBar.styleLightContent();
                if (window.NavigationBar) {
                    NavigationBar.backgroundColorByHexString('#252525', false);
                }
            } else {
                // Light mode: page background color (both bars, dark icons)
                StatusBar.backgroundColorByHexString('#f7fafc');
                StatusBar.styleDefault();
                if (window.NavigationBar) {
                    NavigationBar.backgroundColorByHexString('#f7fafc', true);
                }
            }
        };
        // Apply initial colors
        window.updateSystemBarsColor();
    }
    
    // ✅ Setup Native Local Notifications
    setupNativeNotifications();
    
    // ✅ Request notification permission on Android 13+
    requestNotificationPermission();
    
    // Setup Google Sign-In
    setupGoogleSignIn();
    
    // Request notification permission (web API) - skip in Cordova, we use native
    // if ('Notification' in window && Notification.permission === 'default') {
    //     Notification.requestPermission().then(permission => {
    //         console.log('📱 Notification permission:', permission);
    //     });
    // }
}, false);

// ✅ App Lifecycle - Native app behavior
// 1. Back button = navigate back if on sub-page, close app if on main page
// 2. Background > 5min = kill app (next open = fresh start with native splash)
//    No reload, no white flash, no web nonsense
(function() {
    // ── BACK BUTTON: Smart navigation ──
    document.addEventListener('backbutton', function(e) {
        e.preventDefault();
        
        // If we're on a sub-page (whitepaper.html, about.html, etc.) — go back to main app
        var currentPath = window.location.pathname || '';
        var isMainPage = currentPath.endsWith('index.html') || currentPath.endsWith('/') || currentPath === '';
        
        if (!isMainPage) {
            // On access-explorer.html (first explorer page) — go back to main app
            if (currentPath.endsWith('access-explorer.html')) {
                window.location.href = 'index.html';
            } else {
                // On other sub-pages — go back page by page through history
                window.history.back();
            }
            return;
        }
        
        // On main page (SPA) — check which internal page is visible
        var dashboardPage = document.getElementById('dashboard-page');
        var isDashboardVisible = dashboardPage && dashboardPage.style.display !== 'none';
        
        console.log('[BackButton] isDashboardVisible:', isDashboardVisible, 'display:', dashboardPage ? dashboardPage.style.display : 'N/A');
        
        if (!isDashboardVisible) {
            // Close more menu if open
            var moreMenu = document.getElementById('more-menu');
            if (moreMenu) moreMenu.style.display = 'none';
            
            // Navigate to dashboard — showPage handles nav active state
            if (typeof window.showPage === 'function') {
                window.showPage('dashboard');
                console.log('[BackButton] showPage(dashboard) called');
                
                // Verify active states after showPage
                var items = document.querySelectorAll('.mobile-nav-item');
                items.forEach(function(el) {
                    console.log('[BackButton] nav:', el.getAttribute('data-page'), 'active:', el.classList.contains('active'));
                });
            }
            
            return;
        }
        
        // On dashboard — exit app
        if (navigator.app && navigator.app.exitApp) {
            navigator.app.exitApp();
        }
    }, false);

    // ── BACKGROUND: Kill app after 5 minutes ──
    var _killTimer = null;
    var KILL_AFTER = 300000; // 5 minutes

    document.addEventListener('pause', function() {
        _killTimer = setTimeout(function() {
            // Kill the process while in background
            // Next time user taps icon = completely fresh start
            if (navigator.app && navigator.app.exitApp) {
                navigator.app.exitApp();
            }
        }, KILL_AFTER);
    }, false);

    document.addEventListener('resume', function() {
        // Came back before 5min - cancel kill, resume normally
        if (_killTimer) {
            clearTimeout(_killTimer);
            _killTimer = null;
        }
    }, false);
})();

// ✅ Native Notifications System for Cordova
function setupNativeNotifications() {
    // Check for local notification plugin
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.notification && window.cordova.plugins.notification.local) {
        const localNotification = window.cordova.plugins.notification.local;
        
        // Request permission
        localNotification.requestPermission(function(granted) {
            console.log('🔔 Native notification permission:', granted ? 'granted' : 'denied');
        });
        
        // ✅ Override web Notification API to use native notifications
        window.NativeNotification = window.Notification;
        
        window.Notification = function(title, options = {}) {
            console.log('📱 Native notification:', title, options);
            
            // Schedule native notification
            localNotification.schedule({
                id: Date.now(),
                title: title,
                text: options.body || '',
                icon: 'res://icon',
                smallIcon: 'res://ic_stat_notification',
                foreground: true,
                sound: true,
                vibrate: true,
                priority: 2,
                data: options.data || {}
            });
            
            // Return mock object for compatibility
            return {
                close: function() {},
                addEventListener: function() {},
                removeEventListener: function() {}
            };
        };
        
        // Keep static properties
        window.Notification.permission = 'granted';
        window.Notification.requestPermission = function(callback) {
            return new Promise(function(resolve) {
                localNotification.requestPermission(function(granted) {
                    const result = granted ? 'granted' : 'denied';
                    if (callback) callback(result);
                    resolve(result);
                });
            });
        };
        
        // Handle notification clicks
        localNotification.on('click', function(notification) {
            console.log('🔔 Notification clicked:', notification);
            // Open the app and navigate if needed
            if (notification.data && notification.data.url) {
                window.location.href = notification.data.url;
            }
        });
        
        console.log('✅ Native notifications setup complete (plugin mode)');
    } else {
        // No plugin - use in-app toast notifications
        console.log('📱 Using in-app toast notifications (no native plugin)');
        
        // Create toast notification function
        window.showToastNotification = function(title, body) {
            // Create toast element
            let toast = document.getElementById('cordova-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'cordova-toast';
                toast.style.cssText = `
                    position: fixed;
                    top: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 15px 25px;
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(102, 126, 234, 0.4);
                    z-index: 999999;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    max-width: 90%;
                    text-align: center;
                    transition: all 0.3s ease;
                    opacity: 0;
                    pointer-events: none;
                `;
                document.body.appendChild(toast);
            }
            
            toast.innerHTML = `
                <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${title}</div>
                <div style="font-size: 12px; opacity: 0.9;">${body}</div>
            `;
            
            // Show toast
            toast.style.opacity = '1';
            toast.style.pointerEvents = 'auto';
            
            // Auto hide after 5 seconds
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.pointerEvents = 'none';
            }, 5000);
        };
        
        // Mock Notification API
        window.NativeNotification = window.Notification;
        window.Notification = function(title, options = {}) {
            console.log('📱 Toast notification:', title, options);
            window.showToastNotification(title, options.body || '');
            return {
                close: function() {},
                addEventListener: function() {},
                removeEventListener: function() {}
            };
        };
        window.Notification.permission = 'granted';
        window.Notification.requestPermission = function(callback) {
            return Promise.resolve('granted').then(r => { if (callback) callback(r); return r; });
        };
    }
}

// ✅ Request notification permission on Android 13+ (API 33+)
function requestNotificationPermission() {
    console.log('📱 Requesting notification permission...');
    
    // Check if cordova.plugins.permissions is available
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.permissions) {
        const permissions = cordova.plugins.permissions;
        
        // POST_NOTIFICATIONS permission for Android 13+
        permissions.checkPermission(permissions.POST_NOTIFICATIONS, function(status) {
            if (!status.hasPermission) {
                console.log('🔔 Requesting POST_NOTIFICATIONS permission...');
                permissions.requestPermission(permissions.POST_NOTIFICATIONS, function(status) {
                    if (status.hasPermission) {
                        console.log('✅ Notification permission granted!');
                        window.notificationPermissionGranted = true;
                    } else {
                        console.log('❌ Notification permission denied');
                        window.notificationPermissionGranted = false;
                    }
                }, function(error) {
                    console.error('Error requesting permission:', error);
                });
            } else {
                console.log('✅ Notification permission already granted');
                window.notificationPermissionGranted = true;
            }
        }, function(error) {
            // Permission doesn't exist (Android < 13) - assume granted
            console.log('📱 POST_NOTIFICATIONS not required on this Android version');
            window.notificationPermissionGranted = true;
        });
    } else {
        // No permissions plugin - show toast asking user
        console.log('⚠️ Permissions plugin not available');
        // For Android < 13, notifications are enabled by default
        window.notificationPermissionGranted = true;
    }
}

// ✅ Global function to show native notification (can be called from anywhere)
window.showNativeNotification = function(title, body, data = {}) {
    // Show in-app toast with logo image (like web notifications)
    var toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:20px;left:10px;right:10px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:15px 20px;border-radius:12px;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.3);animation:nativeNotifSlide 0.3s ease;display:flex;align-items:center;gap:12px;';
    toast.innerHTML = '<img src="https://accesschain.org/access-logo-1ipfs.png" style="width:44px;height:44px;border-radius:50%;flex-shrink:0;border:2px solid rgba(255,255,255,0.3);" onerror="this.style.display=\'none\'">' +
      '<div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:15px;margin-bottom:4px;">' + title + '</div>' +
      '<div style="font-size:13px;opacity:0.9;white-space:pre-line;">' + body + '</div></div>';
    
    // Add animation
    if (!document.getElementById('native-notif-style')) {
        var style = document.createElement('style');
        style.id = 'native-notif-style';
        style.textContent = '@keyframes nativeNotifSlide { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }';
        document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    // Auto dismiss after 5 seconds
    setTimeout(function() {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s';
        setTimeout(function() { toast.remove(); }, 500);
    }, 5000);
    
    console.log('✅ Native notification shown with logo:', title);
    return true;
};

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
        // Try Cordova plugin first (more reliable in native app)
        if (window.cordova && window.cordova.plugins && window.cordova.plugins.clipboard) {
            return new Promise((resolve, reject) => {
                cordova.plugins.clipboard.paste(
                    (text) => resolve(text || ''),
                    (err) => {
                        console.error('❌ Cordova clipboard paste error:', err);
                        resolve('');
                    }
                );
            });
        }
        // Fallback to web API
        if (navigator.clipboard && navigator.clipboard.readText) {
            return await navigator.clipboard.readText();
        }
        return '';
    } catch (e) {
        console.error('❌ Clipboard read error:', e);
        return '';
    }
};

// ✅ Copy to Clipboard helper (Native Cordova)
window.copyToClipboard = async function(text) {
    try {
        // Try Cordova plugin first (more reliable in native app)
        if (window.cordova && window.cordova.plugins && window.cordova.plugins.clipboard) {
            return new Promise((resolve, reject) => {
                cordova.plugins.clipboard.copy(
                    text,
                    () => {
                        console.log('✅ Copied to clipboard (Cordova)');
                        resolve(true);
                    },
                    (err) => {
                        console.error('❌ Cordova clipboard copy error:', err);
                        reject(err);
                    }
                );
            });
        }
        // Fallback to web API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            console.log('✅ Copied to clipboard (Web API)');
            return true;
        }
        // Last resort fallback
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        console.log('✅ Copied to clipboard (execCommand)');
        return true;
    } catch (e) {
        console.error('❌ Clipboard write error:', e);
        return false;
    }
};

// ✅ Google Sign-In Setup
function setupGoogleSignIn() {
    window.signInWithGoogle = async function() {
        console.log('📱 Native Google Sign-In');
        
        if (!window.plugins || !window.plugins.googleplus) {
            console.error('❌ Google Plus plugin not available');
            const _msg = window.translator?.translate('Google Sign-In not available') || 'Google Sign-In not available';
            if (typeof showNotification === 'function') showNotification(_msg, 'error');
            else if (typeof window.showNotification === 'function') window.showNotification(_msg, 'error');
            return;
        }
        
        // Use logout (not disconnect) to clear cached account but preserve Google connection
        // disconnect() destroys the session completely and can cause profile picture loss
        try {
            await new Promise((resolve) => {
                window.plugins.googleplus.logout(() => {
                    console.log('✅ Logged out before login (allows account picker)');
                    resolve();
                }, () => resolve());
            });
        } catch(e) {}
        
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
                offline: true,
                prompt: 'select_account'
            },
            function(userData) {
                console.log('✅ Google Sign-In success:', userData.email);
                console.log('📷 Full userData object:', JSON.stringify(userData, null, 2));
                document.getElementById('google-signin-loading')?.remove();
                
                // Clear old cache
                localStorage.removeItem('accessoireUser');
                localStorage.removeItem('accessoireUserData');
                
                const DEFAULT_AVATAR = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2M2YzZjNiIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMTIiIHI9IjciIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMTAgMzBjMC01IDQtOCAxMC04czEwIDMgMTAgOHYxYzAgMS0xIDItMiAyaC0xNmMtMSAwLTIgLTEtMi0ydi0xeiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==';
                
                // ✅ Get Google profile picture URL (try all possible fields)
                let googlePicUrl = userData.imageUrl || userData.photoUrl || (userData.image && userData.image.url) || '';
                
                // Make it higher resolution (200px instead of 96px)
                if (googlePicUrl && googlePicUrl.includes('googleusercontent.com')) {
                    googlePicUrl = googlePicUrl.replace(/=s\d+-c/, '=s200-c');
                    if (!googlePicUrl.includes('=s200-c')) {
                        googlePicUrl += (googlePicUrl.includes('?') ? '&' : '?') + 'sz=200';
                    }
                }
                
                console.log('📷 Google picture URL:', googlePicUrl || 'NONE');
                
                // ✅ Function to complete login with a given picture
                function completeLogin(pictureData) {
                    const payload = {
                        email: userData.email,
                        name: userData.displayName,
                        picture: pictureData,
                        sub: userData.userId
                    };
                    
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
                        const _msg2 = window.translator?.translate('Login error. Please try again.') || 'Login error. Please try again.';
                        if (typeof window.showNotification === 'function') window.showNotification(_msg2, 'error');
                    }
                }
                
                // ✅ Download Google picture and convert to base64 for reliability in Cordova WebView
                if (googlePicUrl) {
                    console.log('📷 Downloading Google picture to base64...');
                    var xhr = new XMLHttpRequest();
                    xhr.open('GET', googlePicUrl, true);
                    xhr.responseType = 'blob';
                    xhr.timeout = 5000; // 5 second timeout
                    xhr.onload = function() {
                        if (xhr.status === 200 && xhr.response) {
                            var reader = new FileReader();
                            reader.onloadend = function() {
                                var base64data = reader.result;
                                console.log('📷 ✅ Google picture converted to base64, size:', base64data.length);
                                completeLogin(base64data);
                            };
                            reader.onerror = function() {
                                console.warn('📷 ⚠️ FileReader error, using Google URL instead');
                                completeLogin(googlePicUrl);
                            };
                            reader.readAsDataURL(xhr.response);
                        } else {
                            console.warn('📷 ⚠️ XHR status:', xhr.status, ', using Google URL instead');
                            completeLogin(googlePicUrl);
                        }
                    };
                    xhr.onerror = function() {
                        console.warn('📷 ⚠️ XHR error, using Google URL instead');
                        completeLogin(googlePicUrl);
                    };
                    xhr.ontimeout = function() {
                        console.warn('📷 ⚠️ XHR timeout, using Google URL instead');
                        completeLogin(googlePicUrl);
                    };
                    xhr.send();
                } else {
                    console.log('📷 No Google picture URL available, checking DB for existing avatar');
                    // Don't use default avatar - let server keep whatever avatar is already in DB
                    completeLogin('');
                }
            },
            function(error) {
                console.error('❌ Google Sign-In error:', error);
                document.getElementById('google-signin-loading')?.remove();
                
                let msg = 'Sign-in failed. ';
                const errStr = String(error);
                const _t = window.translator?.translate.bind(window.translator);
                if (errStr.includes('12501') || errStr.includes('CANCELLED')) {
                    msg = _t?.('Sign-in cancelled.') || 'Sign-in cancelled.';
                } else if (errStr.includes('10')) {
                    msg = _t?.('Configuration error (Error 10). Check SHA-1 fingerprint.') || 'Configuration error (Error 10). Check SHA-1 fingerprint.';
                } else {
                    msg = (_t?.('Sign-in failed.') || 'Sign-in failed.') + ' ' + errStr;
                }
                const notifType = errStr.includes('12501') || errStr.includes('CANCELLED') ? 'warning' : 'error';
                if (typeof window.showNotification === 'function') window.showNotification(msg, notifType);
            }
        );
    };
    
    // Only set triggerGoogleSignIn for index.html (mining page)
    // Explorer pages define their own independent triggerGoogleSignIn
    // that saves to explorerGoogleSession instead of accessoireUser
    const isIndexPage = window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/');
    if (isIndexPage) {
        window.triggerGoogleSignIn = window.signInWithGoogle;
        console.log('✅ Google Sign-In ready (mining mode)');
    } else {
        console.log('✅ Google Sign-In ready (explorer mode - using page-local auth)');
    }
}

// ✅ Google Sign-Out (logout only, NOT disconnect - preserves profile data)
window.nativeGoogleSignOut = function() {
    return new Promise(resolve => {
        if (window.plugins?.googleplus) {
            window.plugins.googleplus.logout(() => resolve(), () => resolve());
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
