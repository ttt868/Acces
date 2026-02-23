#!/usr/bin/env node

/**
 * After Prepare Hook: Fix splash screen theme
 * 
 * 1. Removes IconBackground so icon appears without circle/frame
 * 2. Adds dark mode splash (values-night + drawable-night)
 */

const fs = require('fs');
const path = require('path');

module.exports = function (context) {
    const resDir = path.join(
        context.opts.projectRoot,
        'platforms', 'android', 'app', 'src', 'main', 'res'
    );
    const themesFile = path.join(resDir, 'values', 'themes.xml');

    if (!fs.existsSync(themesFile)) return;

    // 1. Remove IconBackground from theme
    let content = fs.readFileSync(themesFile, 'utf8');
    if (content.includes('Theme.SplashScreen.IconBackground')) {
        content = content.replace('Theme.SplashScreen.IconBackground', 'Theme.SplashScreen');
        fs.writeFileSync(themesFile, content, 'utf8');
        console.log('Splash: removed IconBackground');
    }

    // 2. Create night theme (dark mode splash)
    const nightValuesDir = path.join(resDir, 'values-night');
    if (!fs.existsSync(nightValuesDir)) {
        fs.mkdirSync(nightValuesDir, { recursive: true });
    }

    // Dark background color
    const nightColors = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="cdv_splashscreen_background">#1a1a2e</color>
</resources>
`;
    fs.writeFileSync(path.join(nightValuesDir, 'colors.xml'), nightColors, 'utf8');

    // Night themes.xml (same as day but inherits night colors)
    const nightThemes = content; // same structure, picks up night colors automatically
    fs.writeFileSync(path.join(nightValuesDir, 'themes.xml'), nightThemes, 'utf8');

    // 3. Copy dark splash image
    const nightDrawableDir = path.join(resDir, 'drawable-night-nodpi');
    if (!fs.existsSync(nightDrawableDir)) {
        fs.mkdirSync(nightDrawableDir, { recursive: true });
    }

    const darkSplash = path.join(context.opts.projectRoot, 'www', 'splash-text-dark.png');
    if (fs.existsSync(darkSplash)) {
        fs.copyFileSync(darkSplash, path.join(nightDrawableDir, 'ic_cdv_splashscreen.png'));
        console.log('Splash: added dark mode (white text on dark background)');
    }
};
