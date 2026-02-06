
const fs = require('fs');
const path = require('path');

function restoreLatestBackup() {
  const backupDir = '/home/runner/workspace/LowCylindricalDataprocessing/RealisticHonorableDeskscan/backups';
  const dbPath = '/home/runner/workspace/LowCylindricalDataprocessing/RealisticHonorableDeskscan/accessoirecrypto.db';

  try {
    const backups = fs.readdirSync(backupDir)
      .filter(file => file.startsWith('backup-'))
      .sort()
      .reverse();

    if (backups.length === 0) {
      console.log('No backups found');
      return false;
    }

    const latestBackup = path.join(backupDir, backups[0]);
    fs.copyFileSync(latestBackup, dbPath);
    console.log(`Database restored from: ${latestBackup}`);
    return true;
  } catch (err) {
    console.error('Restore failed:', err);
    return false;
  }
}

module.exports = { restoreLatestBackup };
