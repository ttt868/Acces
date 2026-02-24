#!/usr/bin/env node

/**
 * After Prepare Hook: Patch FCM Plugin for Transaction Logo
 * 
 * Copies our modified FirebaseMessagingPluginService.java
 * which adds setLargeIcon (small logo on left) for transaction notifications.
 * 
 * The original plugin doesn't support showing a custom logo image
 * in Android notifications. This patch adds:
 * - loadLogoBitmap(): Downloads logo from accesschain.org
 * - showAlertWithLogo(): Creates notification with setLargeIcon
 * - Handles data-only FCM messages for transaction_received type
 */

const fs = require('fs');
const path = require('path');

module.exports = function (context) {
    const patchFile = path.join(
        context.opts.projectRoot,
        'hooks', 'patches', 'FirebaseMessagingPluginService.java'
    );

    const destFile = path.join(
        context.opts.projectRoot,
        'platforms', 'android', 'app', 'src', 'main', 'java',
        'by', 'chemerisuk', 'cordova', 'firebase',
        'FirebaseMessagingPluginService.java'
    );

    if (!fs.existsSync(patchFile)) {
        console.log('FCM Logo Patch: patch file not found, skipping');
        return;
    }

    if (!fs.existsSync(path.dirname(destFile))) {
        console.log('FCM Logo Patch: destination directory not found, skipping');
        return;
    }

    fs.copyFileSync(patchFile, destFile);
    console.log('FCM Logo Patch: applied FirebaseMessagingPluginService.java with transaction logo support');
};
