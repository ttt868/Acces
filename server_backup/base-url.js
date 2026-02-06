/**
 * Base URL Configuration for Cordova & Web
 * This file detects if running in Cordova and sets the correct base URL
 */

(function() {
    'use strict';
    
    // Detect if running in Cordova
    const isCordova = typeof cordova !== 'undefined' || 
                      typeof window.cordova !== 'undefined' ||
                      document.URL.indexOf('http://localhost') === 0 ||
                      document.URL.indexOf('file://') === 0 ||
                      window.location.protocol === 'file:';
    
    // Set the base URL based on environment
    if (isCordova) {
        // Cordova app - use production URL
        window.BASE_URL = 'https://accesschain.org';
        window.API_BASE_URL = 'https://accesschain.org';
        console.log('🔌 Cordova detected - Using production URL:', window.BASE_URL);
    } else {
        // Web browser - use current origin (dynamic)
        window.BASE_URL = window.location.origin;
        window.API_BASE_URL = window.location.origin;
        console.log('🌐 Web browser detected - Using origin:', window.BASE_URL);
    }
    
    // ✅ Define getApiOrigin function - used by script.js
    window.getApiOrigin = function() {
        return window.API_BASE_URL;
    };
    
    // Helper function to get full URL
    window.getFullUrl = function(path) {
        if (path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }
        return window.BASE_URL + (path.startsWith('/') ? path : '/' + path);
    };
    
    // Helper for API calls
    window.getApiUrl = function(endpoint) {
        return window.API_BASE_URL + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
    };
    
    // Export for module systems
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { BASE_URL: window.BASE_URL, API_BASE_URL: window.API_BASE_URL };
    }
})();
