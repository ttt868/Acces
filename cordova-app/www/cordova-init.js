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
    
    // Setup Google Sign-In
    setupGoogleSignIn();
    
    // Setup Clipboard
    setupClipboard();
    
    // Setup Local Notifications
    setupNotifications();
    
    // Request Camera Permission for QR Scanner
    requestCameraPermission();
    
}, false);

// ✅ Request Camera Permission
function requestCameraPermission() {
    if (window.QRScanner) {
        QRScanner.prepare(function(err, status) {
            if (err) {
                console.log('⚠️ Camera permission error:', err);
            } else if (status.authorized) {
                console.log('✅ Camera permission granted');
            } else if (status.denied) {
                console.log('❌ Camera permission denied');
            } else {
                console.log('📷 Camera permission requested');
            }
            // Hide scanner after permission check
            if (window.QRScanner) QRScanner.destroy();
        });
    }
}

// ✅ Setup Clipboard
function setupClipboard() {
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.clipboard) {
        console.log('✅ Clipboard plugin ready');
        
        // Override navigator.clipboard for compatibility
        window.pasteFromClipboard = function() {
            return new Promise((resolve, reject) => {
                cordova.plugins.clipboard.paste(
                    function(text) {
                        console.log('📋 Pasted from clipboard');
                        resolve(text);
                    },
                    function(err) {
                        console.error('❌ Clipboard paste error:', err);
                        reject(err);
                    }
                );
            });
        };
        
        window.copyToClipboard = function(text) {
            return new Promise((resolve, reject) => {
                cordova.plugins.clipboard.copy(
                    text,
                    function() {
                        console.log('✅ Copied to clipboard');
                        resolve();
                    },
                    function(err) {
                        console.error('❌ Clipboard copy error:', err);
                        reject(err);
                    }
                );
            });
        };
    }
}

// ✅ Setup Local Notifications
function setupNotifications() {
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.notification && window.cordova.plugins.notification.local) {
        const notification = window.cordova.plugins.notification.local;
        
        // Request permission
        notification.hasPermission(function(granted) {
            if (!granted) {
                notification.requestPermission(function(granted) {
                    console.log(granted ? '✅ Notification permission granted' : '❌ Notification permission denied');
                });
            } else {
                console.log('✅ Notification permission already granted');
            }
        });
        
        // Helper function to show notification
        window.showLocalNotification = function(title, message, id) {
            notification.schedule({
                id: id || Date.now(),
                title: title,
                text: message,
                foreground: true,
                smallIcon: 'res://ic_notification',
                icon: 'res://icon'
            });
        };
        
        console.log('✅ Local notifications ready');
    }
}

// ✅ QR Code Scanner Function (using QRScanner plugin)
window.scanQRCode = function() {
    return new Promise((resolve, reject) => {
        if (window.QRScanner) {
            // Use QRScanner plugin
            QRScanner.prepare(function(err, status) {
                if (err) {
                    console.error('❌ QR Scanner prepare error:', err);
                    // Fallback to prompt
                    const address = prompt('Camera not available. Enter address manually:');
                    if (address) resolve(address);
                    else reject('Cancelled');
                    return;
                }
                
                if (status.authorized) {
                    // Show scanner UI
                    document.body.style.backgroundColor = 'transparent';
                    document.getElementById('main-content')?.classList.add('qr-scanning');
                    
                    QRScanner.show(function() {
                        console.log('📷 QR Scanner shown');
                    });
                    
                    // Add close button
                    const closeBtn = document.createElement('button');
                    closeBtn.id = 'qr-close-btn';
                    closeBtn.innerHTML = '✕ Close';
                    closeBtn.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;background:#ff4444;color:#fff;border:none;padding:15px 25px;border-radius:10px;font-size:16px;';
                    closeBtn.onclick = function() {
                        QRScanner.hide();
                        QRScanner.destroy();
                        closeBtn.remove();
                        document.body.style.backgroundColor = '';
                        document.getElementById('main-content')?.classList.remove('qr-scanning');
                        reject('Cancelled');
                    };
                    document.body.appendChild(closeBtn);
                    
                    QRScanner.scan(function(err, text) {
                        closeBtn.remove();
                        document.body.style.backgroundColor = '';
                        document.getElementById('main-content')?.classList.remove('qr-scanning');
                        
                        QRScanner.hide();
                        QRScanner.destroy();
                        
                        if (err) {
                            console.error('❌ QR Scan error:', err);
                            reject(err);
                        } else {
                            console.log('✅ QR Scanned:', text);
                            resolve(text);
                        }
                    });
                } else if (status.denied) {
                    // Permission denied - show settings
                    QRScanner.openSettings();
                    reject('Camera permission denied');
                } else {
                    reject('Camera not authorized');
                }
            });
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

// ✅ Cancel QR Scan
window.cancelQRScan = function() {
    if (window.QRScanner) {
        QRScanner.hide();
        QRScanner.destroy();
        document.body.style.backgroundColor = '';
        document.getElementById('main-content')?.classList.remove('qr-scanning');
        document.getElementById('qr-close-btn')?.remove();
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
                offline: false,
                prompt: 'select_account'
            },
            function(userData) {
                console.log('✅ Google Sign-In success:', userData.email);
                console.log('📷 User image URL:', userData.imageUrl);
                document.getElementById('google-signin-loading')?.remove();
                
                // Clear old cache
                localStorage.removeItem('accessoireUser');
                localStorage.removeItem('accessoireUserData');
                
                // ✅ Get profile picture with fallback
                let profilePicture = userData.imageUrl || userData.image?.url || '';
                // Make sure we get high quality image
                if (profilePicture && profilePicture.includes('googleusercontent.com')) {
                    profilePicture = profilePicture.replace(/=s\d+-c/, '=s200-c');
                }
                // Default avatar - SAME as server.js
                const DEFAULT_AVATAR = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2M2YzZjNiIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMTIiIHI9IjciIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMTAgMzBjMC01IDQtOCAxMC04czEwIDMgMTAgOHYxYzAgMS0xIDItMiAyaC0xNmMtMSAwLTIgLTEtMi0ydi0xeiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==';
                
                if (!profilePicture) {
                    profilePicture = DEFAULT_AVATAR;
                    console.log('📷 Using default avatar');
                }
                
                // Create fake JWT for handleGoogleSignIn
                const payload = {
                    email: userData.email,
                    name: userData.displayName,
                    picture: profilePicture,
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

// ✅ Google Sign-Out - MUST disconnect to show account picker next time
window.nativeGoogleSignOut = function() {
    return new Promise(resolve => {
        if (window.plugins?.googleplus) {
            // Use disconnect() to fully sign out and force account picker on next login
            window.plugins.googleplus.disconnect(
                function() {
                    console.log('✅ Google disconnect success - will show account picker next time');
                    // Also try logout for extra safety
                    window.plugins.googleplus.logout(
                        function() {
                            console.log('✅ Google logout success');
                            resolve();
                        },
                        function() {
                            resolve();
                        }
                    );
                },
                function() {
                    // Try logout as fallback
                    window.plugins.googleplus.logout(() => resolve(), () => resolve());
                }
            );
        } else {
            resolve();
        }
    });
};

console.log('📱 Cordova Init complete');
