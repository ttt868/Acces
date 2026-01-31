/**
 * Cordova App Initialization
 * This file handles the transition from web to mobile app
 */

// API Base URL - السيرفر الحقيقي
window.API_BASE_URL = 'https://access-network.io';
// Fallback to IP if domain not working
window.API_BASE_URL_FALLBACK = 'http://89.167.14.197:3000';

// WebSocket URL
window.WS_BASE_URL = 'wss://access-network.io';
window.WS_BASE_URL_FALLBACK = 'ws://89.167.14.197:3000';

// Flag to indicate we're in Cordova app
window.IS_CORDOVA_APP = true;

// Google Sign-In Configuration for Android
window.GOOGLE_CLIENT_ID_ANDROID = '586936149662-lq3riap3r9m7ic4cfv02ohsvo9p6a5ua.apps.googleusercontent.com';
// Use Android Client ID for webClientId in native plugin
window.GOOGLE_CLIENT_ID_WEB = '586936149662-lq3riap3r9m7ic4cfv02ohsvo9p6a5ua.apps.googleusercontent.com';

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
    
    // Override fetch to use full API URL
    overrideFetch();
    
    // Override XMLHttpRequest
    overrideXHR();
    
    // Setup Google Sign-In
    setupGoogleSignIn();
    
    // Check network status
    checkNetworkStatus();
}

/**
 * Override fetch to add base URL
 */
function overrideFetch() {
    const originalFetch = window.fetch;
    
    window.fetch = function(url, options) {
        // If URL starts with /api, prepend base URL
        if (typeof url === 'string' && url.startsWith('/api')) {
            url = window.API_BASE_URL + url;
        } else if (typeof url === 'string' && url.startsWith('/rpc')) {
            url = window.API_BASE_URL + url;
        }
        
        return originalFetch.call(this, url, options);
    };
}

/**
 * Override XMLHttpRequest to add base URL
 */
function overrideXHR() {
    const originalOpen = XMLHttpRequest.prototype.open;
    
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
        // If URL starts with /api, prepend base URL
        if (typeof url === 'string' && url.startsWith('/api')) {
            url = window.API_BASE_URL + url;
        } else if (typeof url === 'string' && url.startsWith('/rpc')) {
            url = window.API_BASE_URL + url;
        }
        
        return originalOpen.call(this, method, url, async, user, password);
    };
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
                reject(new Error('Google Plus plugin not available'));
                return;
            }
            
            window.plugins.googleplus.login(
                {
                    'scopes': 'profile email',
                    'webClientId': window.GOOGLE_CLIENT_ID_WEB,
                    'offline': false
                },
                function(userData) {
                    console.log('✅ Google Sign-In successful:', userData.displayName);
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
                    console.error('❌ Google Sign-In failed:', error);
                    reject(error);
                }
            );
        });
    };
    
    // Logout function
    window.nativeGoogleSignOut = function() {
        return new Promise((resolve, reject) => {
            if (!window.plugins || !window.plugins.googleplus) {
                resolve();
                return;
            }
            
            window.plugins.googleplus.logout(
                function() {
                    console.log('✅ Google Sign-Out successful');
                    resolve();
                },
                function(error) {
                    console.error('❌ Google Sign-Out failed:', error);
                    reject(error);
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
                
                // Call the existing handleGoogleSignIn from script.js
                // This uses the same flow as web!
                if (typeof window.handleGoogleSignIn === 'function') {
                    console.log('✅ handleGoogleSignIn found, calling it...');
                    window.handleGoogleSignIn(fakeResponse);
                } else {
                    console.warn('⚠️ handleGoogleSignIn not found, using direct approach...');
                    
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
                
                // More detailed error messages
                let errorMsg = 'Sign-in failed. ';
                if (typeof error === 'string') {
                    if (error.includes('SIGN_IN_CANCELLED') || error.includes('12501')) {
                        errorMsg = 'Sign-in was cancelled.';
                    } else if (error.includes('NETWORK') || error.includes('7')) {
                        errorMsg = 'Network error. Please check your connection.';
                    } else if (error.includes('INVALID_ACCOUNT') || error.includes('5')) {
                        errorMsg = 'Invalid account. Please try another.';
                    } else if (error.includes('DEVELOPER_ERROR') || error.includes('10')) {
                        errorMsg = 'Configuration error. Please contact support.';
                        console.error('⚠️ DEVELOPER_ERROR: Check SHA-1 fingerprint and Client ID configuration');
                    } else {
                        errorMsg += error;
                    }
                } else if (error && error.message) {
                    errorMsg += error.message;
                } else {
                    errorMsg += 'Please try again.';
                }
                
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
