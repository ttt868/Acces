/**
 * Cordova App Initialization
 * This file handles the transition from web to mobile app
 */

// API Base URL - استخدام IP مباشرة لأن الدومين لا يعمل
window.API_BASE_URL = 'http://89.167.14.197:3000';

// WebSocket URL
window.WS_BASE_URL = 'ws://89.167.14.197:3000';

// Flag to indicate we're in Cordova app
window.IS_CORDOVA_APP = true;

// ✅ CRITICAL: Native HTTP fetch using cordova-plugin-advanced-http
// This bypasses all CORS and mixed content issues!
window.nativeHttpRequest = function(url, method, data) {
    return new Promise((resolve, reject) => {
        // Wait for cordova.plugins.http to be available
        if (typeof cordova !== 'undefined' && cordova.plugin && cordova.plugin.http) {
            const http = cordova.plugin.http;
            
            // Set data serializer
            http.setDataSerializer('json');
            
            const options = {
                method: method || 'get',
                data: data || {},
                headers: { 'Content-Type': 'application/json' }
            };
            
            console.log('📡 [NATIVE HTTP]', method, url);
            
            http.sendRequest(url, options, 
                function(response) {
                    console.log('📡 [NATIVE HTTP] Success:', response.status);
                    try {
                        const jsonData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                        resolve({
                            ok: response.status >= 200 && response.status < 300,
                            status: response.status,
                            json: () => Promise.resolve(jsonData),
                            text: () => Promise.resolve(typeof response.data === 'string' ? response.data : JSON.stringify(response.data))
                        });
                    } catch(e) {
                        resolve({
                            ok: response.status >= 200 && response.status < 300,
                            status: response.status,
                            json: () => Promise.reject(e),
                            text: () => Promise.resolve(response.data)
                        });
                    }
                },
                function(error) {
                    console.error('📡 [NATIVE HTTP] Error:', error);
                    reject(new Error(error.error || 'Network error'));
                }
            );
        } else {
            // Fallback to regular fetch if plugin not available
            console.log('📡 [FALLBACK FETCH]', method, url);
            const fetchOptions = {
                method: method || 'GET',
                headers: { 'Content-Type': 'application/json' }
            };
            if (data && method !== 'GET') {
                fetchOptions.body = JSON.stringify(data);
            }
            fetch(url, fetchOptions).then(resolve).catch(reject);
        }
    });
};

// 🔧 Override window.location.origin for Cordova
// Many scripts use window.location.origin which is 'file://' in Cordova
// We need to override it to use our API_BASE_URL
Object.defineProperty(window, 'CORDOVA_ORIGIN', {
    get: function() { return window.API_BASE_URL; }
});

// ✅ CRITICAL: Global helper function to get correct API origin
// This MUST be used instead of window.location.origin for API calls
window.getApiOrigin = function() {
    const origin = window.location.origin;
    if (origin === 'null' || origin === 'file://' || !origin || !origin.startsWith('http')) {
        return window.API_BASE_URL;
    }
    return origin;
};
console.log('📡 getApiOrigin() =', window.getApiOrigin());

// ✅ إنشاء location proxy لجعل origin يرجع API_BASE_URL
(function() {
    const originalOrigin = window.location.origin;
    
    // If we're in Cordova (file://), create a location wrapper
    if (originalOrigin === 'file://' || originalOrigin === 'null' || !originalOrigin.startsWith('http')) {
        console.log('📱 Cordova detected: Setting up origin override from', originalOrigin, 'to', window.API_BASE_URL);
        
        // Create a wrapper object that intercepts .origin
        window.getOrigin = function() {
            return window.API_BASE_URL;
        };
        
        // ✅ Override String.prototype.replace to handle URL patterns
        const originalStringReplace = String.prototype.replace;
        String.prototype.replace = function(searchValue, replaceValue) {
            let result = originalStringReplace.call(this, searchValue, replaceValue);
            // Fix file:// URLs that sneak through
            if (typeof result === 'string' && result.includes('file://') && (result.includes('/api') || result.includes('/rpc'))) {
                if (result.includes('/api')) {
                    result = window.API_BASE_URL + result.substring(result.indexOf('/api'));
                } else if (result.includes('/rpc')) {
                    result = window.API_BASE_URL + result.substring(result.indexOf('/rpc'));
                }
            }
            return result;
        };
    }
})();

// Google Sign-In Configuration
// Android Client ID (with SHA-1 registered) - for native sign-in
window.GOOGLE_CLIENT_ID_ANDROID = '586936149662-lq3riap3r9m7ic4cfv02ohsvo9p6a5ua.apps.googleusercontent.com';
// Web Client ID - required by cordova-plugin-googleplus
window.GOOGLE_CLIENT_ID_WEB = '586936149662-ja0tlfjfinl2sl17j9ntp3m1avnf3dhn.apps.googleusercontent.com';

// ✅ CRITICAL: Override fetch and XHR IMMEDIATELY (before script.js loads)
// This must run before any API calls are made
(function immediateOverrides() {
    console.log('📡 Setting up fetch/XHR overrides IMMEDIATELY');
    console.log('📡 API_BASE_URL =', window.API_BASE_URL);
    console.log('📡 window.location.origin =', window.location.origin);
    
    // Override fetch
    const originalFetch = window.fetch;
    window.fetch = function(url, options) {
        const originalUrl = url;
        
        if (typeof url === 'string') {
            // Log ALL API/RPC requests for debugging
            if (url.includes('/api') || url.includes('/rpc')) {
                console.log('📡 [FETCH DEBUG] Original URL:', url);
            }
            
            // If URL starts with /api or /rpc, prepend base URL
            if (url.startsWith('/api') || url.startsWith('/rpc')) {
                url = window.API_BASE_URL + url;
                console.log('📡 [FETCH] Case 1: Relative path → ', url);
            }
            // If URL contains file:// (Cordova), replace with API URL
            else if (url.startsWith('file://') && (url.includes('/api') || url.includes('/rpc'))) {
                const apiIndex = url.includes('/api') ? url.indexOf('/api') : url.indexOf('/rpc');
                url = window.API_BASE_URL + url.substring(apiIndex);
                console.log('📡 [FETCH] Case 2: file:// → ', url);
            }
            // Handle 'null/api' - when window.location.origin is 'null'
            else if (url.startsWith('null/api') || url.startsWith('null/rpc')) {
                url = window.API_BASE_URL + url.substring(4);
                console.log('📡 [FETCH] Case 3: null origin → ', url);
            }
            // Handle any URL that should go to API but has wrong origin
            else if (url.includes('/api/') && !url.startsWith('http')) {
                const apiIndex = url.indexOf('/api');
                url = window.API_BASE_URL + url.substring(apiIndex);
                console.log('📡 [FETCH] Case 4: Contains /api/ → ', url);
            }
            else if (url.includes('/rpc') && !url.startsWith('http')) {
                const rpcIndex = url.indexOf('/rpc');
                url = window.API_BASE_URL + url.substring(rpcIndex);
                console.log('📡 [FETCH] Case 5: Contains /rpc → ', url);
            }
            
            // Final log showing transformation
            if (originalUrl !== url) {
                console.log('📡 [FETCH] TRANSFORMED:', originalUrl, '→', url);
            }
        }
        
        // Log the final request
        console.log('📡 [FETCH] FINAL URL:', url);
        
        // ✅ Use Native HTTP for API calls in Cordova (bypasses CORS/mixed content)
        if (window.IS_CORDOVA_APP && (url.includes('/api') || url.includes('/rpc'))) {
            const method = (options && options.method) || 'GET';
            let data = null;
            if (options && options.body) {
                try {
                    data = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
                } catch(e) {
                    data = options.body;
                }
            }
            
            // Try native HTTP first, fallback to regular fetch
            return window.nativeHttpRequest(url, method, data)
                .catch(nativeErr => {
                    console.warn('📡 [NATIVE HTTP] Failed, trying regular fetch:', nativeErr.message);
                    return originalFetch.call(this, url, options);
                });
        }
        
        return originalFetch.call(this, url, options)
            .then(response => {
                // Log response status for API calls
                if (url.includes('/api') || url.includes('/rpc')) {
                    console.log('📡 [FETCH] Response status:', response.status, 'for', url);
                }
                return response;
            })
            .catch(error => {
                console.error('📡 [FETCH] ERROR:', error.message, 'for', url);
                throw error;
            });
    };
    
    // Override XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
        if (typeof url === 'string') {
            // If URL starts with /api or /rpc, prepend base URL
            if (url.startsWith('/api') || url.startsWith('/rpc')) {
                url = window.API_BASE_URL + url;
            }
            // Handle file:// URLs
            else if (url.startsWith('file://') && (url.includes('/api') || url.includes('/rpc'))) {
                const apiIndex = url.includes('/api') ? url.indexOf('/api') : url.indexOf('/rpc');
                url = window.API_BASE_URL + url.substring(apiIndex);
            }
            // Handle null origin
            else if (url.startsWith('null/api') || url.startsWith('null/rpc')) {
                url = window.API_BASE_URL + url.substring(4);
            }
            // Handle any URL that should go to API but has wrong origin
            else if (url.includes('/api/') && !url.startsWith('http')) {
                url = window.API_BASE_URL + url.substring(url.indexOf('/api'));
            }
            else if (url.includes('/rpc') && !url.startsWith('http')) {
                url = window.API_BASE_URL + url.substring(url.indexOf('/rpc'));
            }
        }
        
        return originalOpen.call(this, method, url, async, user, password);
    };
    
    console.log('✅ Fetch/XHR overrides ready!');
})();

/**
 * Wait for Cordova to be ready
 */
document.addEventListener('deviceready', onDeviceReady, false);

function onDeviceReady() {
    console.log('📱 Cordova is ready!');
    
    // Configure StatusBar
    if (window.StatusBar) {
        StatusBar.backgroundColorByHexString('#1a1a2e');
        StatusBar.styleLightContent();
    }
    
    // Note: fetch/XHR overrides are done IMMEDIATELY at top of file
    // No need to call them again here
    
    // Setup Google Sign-In
    setupGoogleSignIn();
    
    // Check network status
    checkNetworkStatus();
}

/**
 * Setup Google Sign-In using cordova-plugin-googleplus
 */
function setupGoogleSignIn() {
    // Override the web Google Sign-In with native
    window.nativeGoogleSignIn = function() {
        return new Promise((resolve, reject) => {
            if (!window.plugins || !window.plugins.googleplus) {
                console.error('Google Plus plugin not available');
                reject('PLUGIN_NOT_AVAILABLE');
                return;
            }
            
            console.log('📱 Calling googleplus.login with webClientId:', window.GOOGLE_CLIENT_ID_WEB);
            
            window.plugins.googleplus.login(
                {
                    'scopes': 'profile email',
                    'webClientId': window.GOOGLE_CLIENT_ID_WEB,
                    'offline': false
                },
                function(userData) {
                    console.log('✅ Google Sign-In RAW response:', JSON.stringify(userData));
                    resolve({
                        id: userData.userId,
                        email: userData.email,
                        name: userData.displayName,
                        imageUrl: userData.imageUrl,
                        idToken: userData.idToken,
                        accessToken: userData.accessToken
                    });
                },
                function(error) {
                    console.error('❌ Google Sign-In FAILED with error:', error);
                    console.error('❌ Error type:', typeof error);
                    console.error('❌ Error stringified:', JSON.stringify(error));
                    // Pass the raw error for better debugging
                    reject(error);
                }
            );
        });
    };
    
    // Logout function - uses both logout AND disconnect to ensure account picker shows
    window.nativeGoogleSignOut = function() {
        return new Promise((resolve, reject) => {
            if (!window.plugins || !window.plugins.googleplus) {
                resolve();
                return;
            }
            
            // First disconnect to revoke access (this ensures account picker shows next time)
            window.plugins.googleplus.disconnect(
                function() {
                    console.log('✅ Google Disconnect successful');
                    // Then logout for good measure
                    window.plugins.googleplus.logout(
                        function() {
                            console.log('✅ Google Sign-Out successful');
                            resolve();
                        },
                        function(error) {
                            console.warn('⚠️ Google logout after disconnect failed:', error);
                            resolve(); // Still resolve as disconnect worked
                        }
                    );
                },
                function(error) {
                    console.error('❌ Google Disconnect failed:', error);
                    // Try just logout as fallback
                    window.plugins.googleplus.logout(
                        function() {
                            console.log('✅ Google Sign-Out successful (fallback)');
                            resolve();
                        },
                        function(error2) {
                            console.error('❌ Google Sign-Out also failed:', error2);
                            reject(error2);
                        }
                    );
                }
            );
        });
    };
}

/**
 * Check network status
 */
function checkNetworkStatus() {
    if (navigator.connection) {
        const networkState = navigator.connection.type;
        const states = {
            [Connection.UNKNOWN]: 'Unknown',
            [Connection.ETHERNET]: 'Ethernet',
            [Connection.WIFI]: 'WiFi',
            [Connection.CELL_2G]: '2G',
            [Connection.CELL_3G]: '3G',
            [Connection.CELL_4G]: '4G',
            [Connection.CELL]: 'Cellular',
            [Connection.NONE]: 'No network'
        };
        
        console.log('📶 Network:', states[networkState]);
        
        if (networkState === Connection.NONE) {
            // Show offline message
            showOfflineMessage();
        }
    }
    
    // Listen for network changes
    document.addEventListener('offline', showOfflineMessage, false);
    document.addEventListener('online', hideOfflineMessage, false);
}

function showOfflineMessage() {
    console.warn('📵 Device is offline');
    // You can show a UI message here
}

function hideOfflineMessage() {
    console.log('📶 Device is back online');
    // Hide the offline message
}

/**
 * Override WebSocket to use full URL
 */
const OriginalWebSocket = window.WebSocket;
window.WebSocket = function(url, protocols) {
    if (url.startsWith('/')) {
        url = window.WS_BASE_URL + url;
    }
    return new OriginalWebSocket(url, protocols);
};
window.WebSocket.prototype = OriginalWebSocket.prototype;

/**
 * Override signInWithGoogle for Cordova
 * This replaces the web-based Google Sign-In with native
 * BUT uses the same flow as web (calls handleGoogleSignIn from script.js)
 */
function overrideGoogleSignIn() {
    // Wait for DOM to be ready
    const checkAndOverride = function() {
        // Override the signInWithGoogle function
        window.signInWithGoogle = async function() {
            console.log('📱 Using Cordova Native Google Sign-In');
            
            try {
                // Check if plugin is available
                if (!window.plugins || !window.plugins.googleplus) {
                    console.error('❌ Google Plus plugin not available');
                    alert('Google Sign-In is not available. Please try again later.');
                    return;
                }
                
                // Show loading indicator
                const loadingDiv = document.createElement('div');
                loadingDiv.id = 'google-signin-loading';
                loadingDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:99999;';
                loadingDiv.innerHTML = '<div style="color:#fff;font-size:18px;text-align:center;"><div style="margin-bottom:20px;">Signing in...</div><div style="width:40px;height:40px;border:3px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto;"></div></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
                document.body.appendChild(loadingDiv);
                
                // Call native Google Sign-In
                const userData = await window.nativeGoogleSignIn();
                
                console.log('✅ Google Sign-In successful:', userData.name, userData.email);
                
                // Remove loading indicator
                const loading = document.getElementById('google-signin-loading');
                if (loading) loading.remove();
                
                // Create a fake credential response like Google Identity Services does
                // This way we can use the existing handleGoogleSignIn from script.js
                const fakePayload = {
                    email: userData.email,
                    name: userData.name,
                    picture: userData.imageUrl,
                    sub: userData.id  // Google user ID
                };
                
                // Create a fake JWT-like structure (base64url encoded - same as real JWT)
                // Note: btoa gives base64, we need to convert to base64url
                function base64urlEncode(str) {
                    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                }
                
                const header = base64urlEncode(JSON.stringify({alg: 'none', typ: 'JWT'}));
                const payload = base64urlEncode(JSON.stringify(fakePayload));
                const fakeCredential = header + '.' + payload + '.fake_signature';
                
                // Create response object like Google Identity Services
                const fakeResponse = {
                    credential: fakeCredential,
                    select_by: 'cordova_native'
                };
                
                console.log('📤 Calling handleGoogleSignIn with native data...');
                console.log('📋 Fake credential payload:', fakePayload);
                
                // 🔍 DEBUG: Show alert with user data
                alert('DEBUG: Google Sign-In OK!\nEmail: ' + userData.email + '\nName: ' + userData.name);
                
                // Call the existing handleGoogleSignIn from script.js
                // This uses the same flow as web!
                if (typeof window.handleGoogleSignIn === 'function') {
                    console.log('✅ handleGoogleSignIn found, calling it...');
                    
                    // 🔍 DEBUG: Test API call directly
                    console.log('🔍 DEBUG: Testing API call to:', window.API_BASE_URL + '/api/user/' + userData.email);
                    fetch(window.API_BASE_URL + '/api/user/' + encodeURIComponent(userData.email))
                        .then(r => r.json())
                        .then(data => {
                            console.log('🔍 DEBUG: API Response:', JSON.stringify(data));
                            alert('DEBUG: API Response\n' + JSON.stringify(data).substring(0, 200));
                        })
                        .catch(err => {
                            console.error('🔍 DEBUG: API Error:', err);
                            alert('DEBUG: API Error\n' + err.message);
                        });
                    
                    window.handleGoogleSignIn(fakeResponse);
                } else {
                    console.warn('⚠️ handleGoogleSignIn not found, using direct approach...');
                    alert('DEBUG: handleGoogleSignIn NOT FOUND!');
                    
                    // Direct approach: Set currentUser and call continueWithLogin
                    window.currentUser = {
                        email: userData.email,
                        name: userData.name,
                        avatar: userData.imageUrl,
                        token: fakeCredential
                    };
                    
                    // Save to localStorage first
                    localStorage.setItem('accessoireUser', JSON.stringify(window.currentUser));
                    
                    // Try to call continueWithLogin if available
                    if (typeof window.continueWithLogin === 'function') {
                        console.log('✅ Using continueWithLogin...');
                        window.continueWithLogin(window.currentUser, '');
                    } else if (typeof window.processLogin === 'function') {
                        console.log('✅ Using processLogin...');
                        window.processLogin(window.currentUser, '');
                    } else {
                        console.log('⚠️ No login function found, reloading...');
                        window.location.reload();
                    }
                }
                
            } catch (error) {
                console.error('❌ Google Sign-In error:', error);
                
                // Remove loading indicator
                const loading = document.getElementById('google-signin-loading');
                if (loading) loading.remove();
                
                // More detailed error messages based on Google Sign-In error codes
                let errorMsg = 'Sign-in failed. ';
                const errorStr = String(error);
                const errorNum = parseInt(errorStr.replace(/\D/g, '')) || 0;
                
                console.error('🔍 Error analysis - String:', errorStr, '- Parsed number:', errorNum);
                
                if (errorStr.includes('SIGN_IN_CANCELLED') || errorNum === 12501 || errorNum === 12) {
                    errorMsg = 'Sign-in was cancelled.';
                } else if (errorStr.includes('NETWORK') || errorNum === 7) {
                    errorMsg = 'Network error. Please check your connection.';
                } else if (errorStr.includes('INVALID_ACCOUNT') || errorNum === 5) {
                    errorMsg = 'Invalid account. Please try another.';
                } else if (errorStr.includes('DEVELOPER_ERROR') || errorNum === 10) {
                    errorMsg = 'Configuration error (Error 10). SHA-1 or Web Client ID mismatch.';
                    console.error('⚠️ Error 10: SHA-1 in Google Cloud Console does not match app signature');
                    console.error('📋 Web Client ID used:', window.GOOGLE_CLIENT_ID_WEB);
                } else if (errorNum === 20) {
                    // Error 20 = SIGN_IN_REQUIRED - usually means no account signed in on device
                    // OR missing Android Client ID configuration
                    errorMsg = 'Sign-in required (Error 20). Please check Google Cloud Console has Android Client with correct SHA-1.';
                    console.error('⚠️ Error 20: Android OAuth Client may be missing or misconfigured');
                    console.error('📋 Required: Create Android OAuth Client with:');
                    console.error('   Package name: io.accessnetwork.app');
                    console.error('   SHA-1: (from GitHub Actions build log)');
                    console.error('📋 Also check Web Client ID:', window.GOOGLE_CLIENT_ID_WEB);
                } else if (errorNum === 8) {
                    errorMsg = 'Internal error (Error 8). Please try again.';
                } else if (errorNum === 4) {
                    errorMsg = 'Sign in failed (Error 4). Please try again.';
                } else {
                    errorMsg += 'Error: ' + errorStr;
                }
                
                // Show detailed error for debugging
                console.error('🔴 Final error message:', errorMsg);
                alert(errorMsg);
            }
        };
        
        // Also override triggerGoogleSignIn if exists
        window.triggerGoogleSignIn = window.signInWithGoogle;
        
        console.log('✅ Google Sign-In overridden for Cordova');
    };
    
    // Run immediately and also after a delay to ensure it overrides
    checkAndOverride();
    setTimeout(checkAndOverride, 1000);
    setTimeout(checkAndOverride, 3000);
}

// Call override after device ready
document.addEventListener('deviceready', function() {
    setTimeout(overrideGoogleSignIn, 500);
}, false);

console.log('📱 Cordova Init loaded - API:', window.API_BASE_URL);
