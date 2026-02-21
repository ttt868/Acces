#!/usr/bin/env node

/**
 * After Prepare Hook: Create ic_launcher_round.xml for adaptive icons
 * 
 * Cordova generates ic_launcher.xml but not ic_launcher_round.xml.
 * Android's roundIcon attribute needs ic_launcher_round.xml.
 * This hook copies ic_launcher.xml to ic_launcher_round.xml in all v26 mipmap folders.
 * It also creates the v26 directories if they don't exist (Cordova bug workaround).
 */

const fs = require('fs');
const path = require('path');

module.exports = function (context) {
    const platformRoot = path.join(context.opts.projectRoot, 'platforms', 'android');
    const resDir = path.join(platformRoot, 'app', 'src', 'main', 'res');

    if (!fs.existsSync(resDir)) {
        console.log('Android platform not found, skipping adaptive icon round hook');
        return;
    }

    const densities = ['ldpi', 'mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

    densities.forEach(density => {
        const v26Dir = path.join(resDir, `mipmap-${density}-v26`);
        const launcherXml = path.join(v26Dir, 'ic_launcher.xml');
        const roundXml = path.join(v26Dir, 'ic_launcher_round.xml');

        // Create v26 directory if it doesn't exist (Cordova doesn't always create it)
        if (!fs.existsSync(v26Dir)) {
            fs.mkdirSync(v26Dir, { recursive: true });
            console.log(`Created directory: mipmap-${density}-v26`);
        }

        // Copy ic_launcher.xml to ic_launcher_round.xml
        if (fs.existsSync(launcherXml)) {
            fs.copyFileSync(launcherXml, roundXml);
            console.log(`Created ic_launcher_round.xml for ${density}`);
        }
    });

    console.log('Adaptive icon round XML hook completed');
};
