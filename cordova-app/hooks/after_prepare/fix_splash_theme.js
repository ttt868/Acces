#!/usr/bin/env node

/**
 * After Prepare Hook: Fix splash screen theme
 * 
 * Removes IconBackground from splash theme so the icon
 * appears without a circle/frame around it.
 */

const fs = require('fs');
const path = require('path');

module.exports = function (context) {
    const themesFile = path.join(
        context.opts.projectRoot,
        'platforms', 'android', 'app', 'src', 'main', 'res', 'values', 'themes.xml'
    );

    if (!fs.existsSync(themesFile)) return;

    let content = fs.readFileSync(themesFile, 'utf8');
    if (content.includes('Theme.SplashScreen.IconBackground')) {
        content = content.replace('Theme.SplashScreen.IconBackground', 'Theme.SplashScreen');
        fs.writeFileSync(themesFile, content, 'utf8');
        console.log('Splash screen: removed IconBackground (no circle around icon)');
    }
};
