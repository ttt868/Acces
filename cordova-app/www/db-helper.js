
// This helper file acts as a bridge between CommonJS and ESM modules
// It provides CommonJS-compatible exports while importing from ESM modules

// Use dynamic import() with proper error handling
async function getDatabaseModule() {
  try {
    return await import('./db.js');
  } catch (err) {
    console.error('Error importing database module:', err);
    throw err;
  }
}

// Individual function exports with better error handling
async function getPool() {
  const db = await getDatabaseModule();
  return db.pool;
}

async function initializeDatabase() {
  const db = await getDatabaseModule();
  return db.initializeDatabase();
}

async function saveUser(userData) {
  const db = await getDatabaseModule();
  return db.saveUser(userData);
}

async function getUser(email) {
  const db = await getDatabaseModule();
  return db.getUser(email);
}

async function getUserReferrals(userId) {
  const db = await getDatabaseModule();
  return db.getUserReferrals(userId);
}

async function processReferral(referrerCode, refereeEmail, refereeName, refereeAvatar) {
  const db = await getDatabaseModule();
  return db.processReferral(referrerCode, refereeEmail, refereeName, refereeAvatar);
}

async function updateProcessingStatus(email, processingActive, startTime, endTime) {
  const db = await getDatabaseModule();
  return db.updateProcessingStatus(email, processingActive, startTime, endTime);
}

async function getProcessingHistory(userId) {
  const db = await getDatabaseModule();
  return db.getProcessingHistory(userId);
}

async function updateAccumulatedReward(userId, amount) {
  const db = await getDatabaseModule();
  return db.updateAccumulatedReward(userId, amount);
}

async function getAccumulatedReward(userId) {
  const db = await getDatabaseModule();
  return db.getAccumulatedReward(userId);
}

async function completeProcessing(userId, amount) {
  const db = await getDatabaseModule();
  return db.completeProcessing(userId, amount);
}

// CommonJS exports
module.exports = {
  getPool,
  initializeDatabase,
  saveUser,
  getUser,
  getUserReferrals,
  processReferral,
  updateProcessingStatus,
  getProcessingHistory,
  updateAccumulatedReward,
  getAccumulatedReward,
  completeProcessing
};
