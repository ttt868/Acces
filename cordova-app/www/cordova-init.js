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
window.GOOGLE_CLIENT_ID_WEB = '489122702138-p1l61s1rlq4ghmeb0dkml4f2hkv7jt54.apps.googleusercontent.com';

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

console.log('📱 Cordova Init loaded - API:', window.API_BASE_URL);
