#!/usr/bin/env node

// Hook: before_build — auto-updates BUILD_ID in pin-lock-system.js
// Generates a unique ID from timestamp so biometric bypass detection works per-build

var fs = require('fs');
var path = require('path');

module.exports = function(context) {
  var pinFile = path.join(context.opts.projectRoot, 'www', 'pin-lock-system.js');

  if (!fs.existsSync(pinFile)) {
    console.log('[BUILD_ID] pin-lock-system.js not found, skipping');
    return;
  }

  var now = new Date();
  var buildId = 'v' + now.getFullYear()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + '-' + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0')
    + String(now.getSeconds()).padStart(2, '0');

  var content = fs.readFileSync(pinFile, 'utf8');
  var updated = content.replace(
    /var BUILD_ID = '[^']*';/,
    "var BUILD_ID = '" + buildId + "';"
  );

  if (updated !== content) {
    fs.writeFileSync(pinFile, updated, 'utf8');
    console.log('[BUILD_ID] Updated to: ' + buildId);
  } else {
    console.log('[BUILD_ID] Pattern not found — no change');
  }
};
