/**
 * Cordova App Initialization - FINAL CLEAN VERSION
 * This file MUST be loaded before script.js
 */

// ✅ API Configuration
window.API_BASE_URL = 'http://89.167.14.197:3000';
window.WS_BASE_URL = 'ws://89.167.14.197:3000';
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
    
    // Request all permissions
    requestAllPermissions();
    
    // Setup Google Sign-In
    setupGoogleSignIn();
}, false);

// ✅ Request All Permissions
function requestAllPermissions() {
    console.log('📱 Requesting permissions...');
    
    // 1. Notification Permission
    requestNotificationPermission();
    
    // 2. Camera Permission (for QR Scanner)
    requestCameraPermission();
    
    // 3. Clipboard Permission
    setupClipboardAccess();
}

// ✅ Notification Permission
function requestNotificationPermission() {
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.notification) {
        cordova.plugins.notification.local.hasPermission(function(granted) {
            if (!granted) {
                cordova.plugins.notification.local.requestPermission(function(granted) {
                    console.log(granted ? '✅ Notification permission granted' : '❌ Notification permission denied');
                });
            } else {
                console.log('✅ Notification permission already granted');
            }
        });
    } else if ('Notification' in window) {
        // Web fallback
        if (Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
                console.log('📱 Notification permission:', permission);
            });
        }
    }
}

// ✅ Camera Permission (for QR Code Scanner)
function requestCameraPermission() {
    if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
        const permissions = cordova.plugins.permissions;
        permissions.checkPermission(permissions.CAMERA, function(status) {
            if (!status.hasPermission) {
                permissions.requestPermission(permissions.CAMERA, function(status) {
                    console.log(status.hasPermission ? '✅ Camera permission granted' : '❌ Camera permission denied');
                }, function() {
                    console.error('❌ Camera permission request failed');
                });
            } else {
                console.log('✅ Camera permission already granted');
            }
        }, null);
    }
}

// ✅ Clipboard Access
function setupClipboardAccess() {
    // Override navigator.clipboard for Cordova
    if (window.cordova && !navigator.clipboard) {
        navigator.clipboard = {
            readText: function() {
                return new Promise((resolve, reject) => {
                    if (window.cordova.plugins && window.cordova.plugins.clipboard) {
                        cordova.plugins.clipboard.paste(
                            text => resolve(text),
                            err => reject(err)
                        );
                    } else {
                        reject('Clipboard plugin not available');
                    }
                });
            },
            writeText: function(text) {
                return new Promise((resolve, reject) => {
                    if (window.cordova.plugins && window.cordova.plugins.clipboard) {
                        cordova.plugins.clipboard.copy(
                            text,
                            () => resolve(),
                            err => reject(err)
                        );
                    } else {
                        reject('Clipboard plugin not available');
                    }
                });
            }
        };
        console.log('✅ Clipboard polyfill installed');
    }
}

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
                scopes: 'profile email',
                webClientId: window.GOOGLE_CLIENT_ID_WEB,
                offline: false
            },
            function(userData) {
                console.log('✅ Google Sign-In success:', userData.email);
                document.getElementById('google-signin-loading')?.remove();
                
                // Clear old cache
                localStorage.removeItem('accessoireUser');
                localStorage.removeItem('accessoireUserData');
                
                // Create fake JWT for handleGoogleSignIn
                const payload = {
                    email: userData.email,
                    name: userData.displayName,
                    picture: userData.imageUrl,
                    sub: userData.userId
                };
                
                const b64 = str => btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                const header = b64(JSON.stringify({alg: 'none', typ: 'JWT'}));
                const body = b64(JSON.stringify(payload));
                const fakeCredential = header + '.' + body + '.fake';
                
                // Call handleGoogleSignIn from script.js
                if (typeof window.handleGoogleSignIn === 'function') {
                    window.handleGoogleSignIn({ credential: fakeCredential, select_by: 'cordova' });
                } else {
                    console.error('❌ handleGoogleSignIn not found');
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

console.log('📱 Cordova Init complete');
