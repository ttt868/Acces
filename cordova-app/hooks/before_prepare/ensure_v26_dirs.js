#!/usr/bin/env node

/**
 * Before Prepare Hook: Ensure mipmap v26 directories exist
 * 
 * Cordova Android has a bug where it tries to write ic_launcher.xml
 * to mipmap-*-v26 directories without creating them first.
 * This hook ensures they exist before prepare runs.
 */

const fs = require('fs');
const path = require('path');

module.exports = function (context) {
    const platformRoot = path.join(context.opts.projectRoot, 'platforms', 'android');
    const resDir = path.join(platformRoot, 'app', 'src', 'main', 'res');

    if (!fs.existsSync(resDir)) {
        return;
    }

    const densities = ['ldpi', 'mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

    densities.forEach(density => {
        const v26Dir = path.join(resDir, `mipmap-${density}-v26`);
        if (!fs.existsSync(v26Dir)) {
            fs.mkdirSync(v26Dir, { recursive: true });
            console.log(`Pre-created directory: mipmap-${density}-v26`);
        }
    });
};
