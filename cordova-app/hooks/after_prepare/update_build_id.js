#!/usr/bin/env node

// Hook: after_prepare — auto-updates BUILD_ID in pin-lock-system.js
// Runs AFTER prepare copies www/ to platforms/, so we patch both source + platform copies
// Generates a unique ID from timestamp so biometric bypass detection works per-build

var fs = require('fs');
var path = require('path');
var glob = require('glob');

var PATTERN = /var BUILD_ID = '[^']*';/;

function patchFile(filePath, buildId) {
  if (!fs.existsSync(filePath)) return false;
  var content = fs.readFileSync(filePath, 'utf8');
  if (!PATTERN.test(content)) return false;
  var updated = content.replace(PATTERN, "var BUILD_ID = '" + buildId + "';");
  if (updated !== content) {
    fs.writeFileSync(filePath, updated, 'utf8');
    return true;
  }
  return false;
}

module.exports = function(context) {
  var now = new Date();
  var buildId = 'b' + now.getFullYear()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + '_' + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0')
    + String(now.getSeconds()).padStart(2, '0');

  var root = context.opts.projectRoot;
  var patched = 0;

  // 1. Patch source www/
  var srcFile = path.join(root, 'www', 'pin-lock-system.js');
  if (patchFile(srcFile, buildId)) {
    console.log('[BUILD_ID] Patched www/pin-lock-system.js → ' + buildId);
    patched++;
  }

  // 2. Patch all platform copies (android, ios, etc.)
  var platformDirs = [];
  try {
    platformDirs = fs.readdirSync(path.join(root, 'platforms'));
  } catch(e) {}

  platformDirs.forEach(function(platform) {
    // Android: platforms/android/app/src/main/assets/www/
    // iOS: platforms/ios/www/
    var candidates = [
      path.join(root, 'platforms', platform, 'app', 'src', 'main', 'assets', 'www', 'pin-lock-system.js'),
      path.join(root, 'platforms', platform, 'www', 'pin-lock-system.js')
    ];
    candidates.forEach(function(f) {
      if (patchFile(f, buildId)) {
        console.log('[BUILD_ID] Patched ' + path.relative(root, f) + ' → ' + buildId);
        patched++;
      }
    });
  });

  if (patched === 0) {
    console.log('[BUILD_ID] No files found to patch');
  }
};
