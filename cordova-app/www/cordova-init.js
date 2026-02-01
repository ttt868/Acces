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

// ✅ Global error handler to prevent crashes
window.onerror = function(message, source, lineno, colno, error) {
    console.error('🚨 Global Error:', message, 'at', source, ':', lineno);
    // Don't let errors crash the app
    return true;
};

window.addEventListener('unhandledrejection', function(event) {
    console.error('🚨 Unhandled Promise Rejection:', event.reason);
    // Prevent default handling
    event.preventDefault();
});

// ✅ Device Ready
document.addEventListener('deviceready', function() {
    try {
        console.log('📱 Cordova is ready!');
        
        // StatusBar
        if (window.StatusBar) {
            try {
                StatusBar.backgroundColorByHexString('#1a1a2e');
                StatusBar.styleLightContent();
            } catch (e) {
                console.log('StatusBar error (non-fatal):', e);
            }
        }
        
        // Setup Google Sign-In
        setupGoogleSignIn();
        
        // Setup Clipboard
        setupClipboard();
        
        // Setup Local Notifications (safely - plugin may not exist)
        setupNotifications();
        
    } catch (error) {
        console.error('🚨 deviceready error:', error);
    }
}, false);

// ✅ Setup Clipboard with permission request
function setupClipboard() {
    console.log('📋 Setting up clipboard...');
    
    // ✅ IMPROVED: pasteFromClipboard with fallback
    window.pasteFromClipboard = function() {
        return new Promise((resolve, reject) => {
            // Try Cordova plugin first
            if (window.cordova && window.cordova.plugins && window.cordova.plugins.clipboard) {
                console.log('📋 Using Cordova clipboard plugin');
                cordova.plugins.clipboard.paste(
                    function(text) {
                        console.log('📋 Pasted from clipboard:', text ? text.substring(0, 20) + '...' : 'empty');
                        resolve(text || '');
                    },
                    function(err) {
                        console.error('❌ Cordova clipboard paste error:', err);
                        // Fallback to web API
                        tryWebClipboard(resolve, reject);
                    }
                );
            } else {
                // Try web clipboard API
                tryWebClipboard(resolve, reject);
            }
        });
    };
    
    // Web Clipboard API fallback
    function tryWebClipboard(resolve, reject) {
        if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText()
                .then(text => {
                    console.log('📋 Web clipboard read success');
                    resolve(text || '');
                })
                .catch(err => {
                    console.error('❌ Web clipboard error:', err);
                    // Last resort: prompt
                    const text = prompt('📋 Paste your address here:');
                    resolve(text || '');
                });
        } else {
            // Prompt as fallback
            const text = prompt('📋 Paste your address here:');
            resolve(text || '');
        }
    }
    
    // ✅ copyToClipboard with fallback
    window.copyToClipboard = function(text) {
        return new Promise((resolve, reject) => {
            if (window.cordova && window.cordova.plugins && window.cordova.plugins.clipboard) {
                cordova.plugins.clipboard.copy(
                    text,
                    function() {
                        console.log('✅ Copied to clipboard');
                        resolve();
                    },
                    function(err) {
                        console.error('❌ Clipboard copy error:', err);
                        // Try web fallback
                        if (navigator.clipboard) {
                            navigator.clipboard.writeText(text).then(resolve).catch(reject);
                        } else {
                            reject(err);
                        }
                    }
                );
            } else if (navigator.clipboard) {
                navigator.clipboard.writeText(text).then(resolve).catch(reject);
            } else {
                reject(new Error('Clipboard not available'));
            }
        });
    };
    
    console.log('✅ Clipboard functions ready');
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

// ✅ QR Code Scanner Function using html5-qrcode
window.scanQRCode = function() {
    return new Promise((resolve, reject) => {
        // Check if Html5Qrcode is available
        if (typeof Html5Qrcode === 'undefined') {
            console.error('❌ Html5Qrcode not loaded');
            const address = prompt('QR Scanner not available. Enter address manually:');
            if (address && address.trim()) {
                resolve(address.trim());
            } else {
                reject('No address entered');
            }
            return;
        }
        
        // Create scanner modal
        const modal = document.createElement('div');
        modal.id = 'qr-scanner-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.95);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';
        
        modal.innerHTML = `
            <div style="color:#fff;text-align:center;margin-bottom:20px;">
                <h2 style="margin:0 0 10px 0;">📷 Scan QR Code</h2>
                <p style="margin:0;opacity:0.7;">Point camera at QR code</p>
            </div>
            <div id="qr-reader" style="width:100%;max-width:400px;border-radius:15px;overflow:hidden;"></div>
            <button id="qr-cancel-btn" style="margin-top:20px;background:#ff4444;color:#fff;border:none;padding:15px 40px;border-radius:10px;font-size:16px;cursor:pointer;">
                ✕ Cancel
            </button>
            <div style="margin-top:15px;">
                <button id="qr-manual-btn" style="background:transparent;color:#fff;border:1px solid #fff;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;">
                    📝 Enter manually
                </button>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        let html5QrCode = null;
        
        const cleanup = () => {
            if (html5QrCode) {
                html5QrCode.stop().catch(err => console.log('Stop error:', err));
            }
            modal.remove();
        };
        
        // Cancel button
        document.getElementById('qr-cancel-btn').onclick = () => {
            cleanup();
            reject('Cancelled');
        };
        
        // Manual entry button
        document.getElementById('qr-manual-btn').onclick = () => {
            cleanup();
            const address = prompt('Enter wallet address:');
            if (address && address.trim()) {
                resolve(address.trim());
            } else {
                reject('No address entered');
            }
        };
        
        // Start scanner
        html5QrCode = new Html5Qrcode("qr-reader");
        
        html5QrCode.start(
            { facingMode: "environment" },
            {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1
            },
            (decodedText) => {
                console.log('✅ QR Scanned:', decodedText);
                cleanup();
                resolve(decodedText);
            },
            (errorMessage) => {
                // Ignore scanning errors (happens continuously while scanning)
            }
        ).catch(err => {
            console.error('❌ QR Scanner start error:', err);
            cleanup();
            // Fallback to manual entry
            const address = prompt('Camera not available. Enter address manually:');
            if (address && address.trim()) {
                resolve(address.trim());
            } else {
                reject('Camera error: ' + err);
            }
        });
    });
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
        
        // ✅ IMPORTANT: Disconnect first to ensure account picker shows
        try {
            await new Promise((resolve) => {
                window.plugins.googleplus.disconnect(() => resolve(), () => resolve());
            });
            console.log('✅ Disconnected previous session');
        } catch(e) {
            console.log('No previous session to disconnect');
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
                console.log('📷 Raw userData from Google:', JSON.stringify(userData));
                document.getElementById('google-signin-loading')?.remove();
                
                // Clear old cache
                localStorage.removeItem('accessoireUser');
                localStorage.removeItem('accessoireUserData');
                
                // ✅ FIXED: Get profile picture from multiple possible fields
                let profilePicture = '';
                
                // Try different possible field names
                if (userData.imageUrl && userData.imageUrl.length > 10) {
                    profilePicture = userData.imageUrl;
                } else if (userData.image && userData.image.url) {
                    profilePicture = userData.image.url;
                } else if (userData.photoUrl) {
                    profilePicture = userData.photoUrl;
                } else if (userData.picture) {
                    profilePicture = userData.picture;
                }
                
                console.log('📷 Extracted profile picture URL:', profilePicture);
                
                // Make sure we get high quality image
                if (profilePicture && profilePicture.includes('googleusercontent.com')) {
                    // Request larger size (200px)
                    profilePicture = profilePicture.replace(/=s\d+-c/, '=s200-c');
                    if (!profilePicture.includes('=s')) {
                        profilePicture += '=s200-c';
                    }
                }
                
                // Default avatar SVG - SAME as server.js
                const DEFAULT_AVATAR = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIyMCIgZmlsbD0iI2M2YzZjNiIvPjxjaXJjbGUgY3g9IjIwIiBjeT0iMTIiIHI9IjciIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMTAgMzBjMC01IDQtOCAxMC04czEwIDMgMTAgOHYxYzAgMS0xIDItMiAyaC0xNmMtMSAwLTIgLTEtMi0ydi0xeiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==';
                
                if (!profilePicture || profilePicture.length < 10) {
                    profilePicture = DEFAULT_AVATAR;
                    console.log('📷 No valid image URL, using default avatar');
                } else {
                    console.log('📷 Using Google profile picture:', profilePicture.substring(0, 50) + '...');
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
