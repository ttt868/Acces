/**
 * Firebase Cloud Messaging (FCM) Service
 * For sending push notifications to Cordova app
 */

import admin from 'firebase-admin';
import { pool } from './db.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin
let fcmInitialized = false;

try {
  const serviceAccountPath = join(__dirname, 'firebase-service-account.json');
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
  
  fcmInitialized = true;
  console.log('✅ Firebase Admin SDK initialized');
} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin:', error.message);
}

/**
 * Send FCM notification to a specific user
 */
export async function sendFCMNotification(userId, title, body, data = {}) {
  if (!fcmInitialized) {
    console.error('FCM not initialized');
    return { success: false, error: 'FCM not initialized' };
  }

  try {
    // Get user's FCM tokens
    const result = await pool.query(
      'SELECT token FROM fcm_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'No FCM token found for user' };
    }

    const tokens = result.rows.map(row => row.token);
    
    // Send to all user's devices
    const message = {
      notification: {
        title: title,
        body: body
      },
      data: {
        ...data,
        click_action: 'OPEN_APP',
        userId: String(userId)
      },
      android: {
        priority: 'high',
        notification: {
          icon: 'ic_notification',
          color: '#6c5ce7',
          sound: 'default',
          channelId: 'access_notifications',
          imageUrl: 'https://accesschain.org/access-logo-1ipfs.png'
        }
      },
      tokens: tokens
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    
    console.log(`📱 FCM sent to user ${userId}: ${response.successCount} success, ${response.failureCount} failed`);

    // Remove invalid tokens
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(tokens[idx]);
        }
      });
      
      if (failedTokens.length > 0) {
        await pool.query(
          'DELETE FROM fcm_tokens WHERE token = ANY($1)',
          [failedTokens]
        );
        console.log(`🗑️ Removed ${failedTokens.length} invalid FCM tokens`);
      }
    }

    return { 
      success: true, 
      successCount: response.successCount,
      failureCount: response.failureCount 
    };
  } catch (error) {
    console.error('FCM send error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send FCM notification to multiple users
 */
export async function sendFCMToUsers(userIds, title, body, data = {}) {
  const results = await Promise.all(
    userIds.map(userId => sendFCMNotification(userId, title, body, data))
  );
  
  return {
    total: userIds.length,
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length
  };
}

/**
 * Send FCM to all registered users
 */
export async function sendFCMToAll(title, body, data = {}) {
  if (!fcmInitialized) {
    return { success: false, error: 'FCM not initialized' };
  }

  try {
    const result = await pool.query('SELECT DISTINCT token FROM fcm_tokens');
    
    if (result.rows.length === 0) {
      return { success: false, error: 'No FCM tokens registered' };
    }

    const tokens = result.rows.map(row => row.token);
    
    // FCM allows max 500 tokens per request
    const chunks = [];
    for (let i = 0; i < tokens.length; i += 500) {
      chunks.push(tokens.slice(i, i + 500));
    }

    let totalSuccess = 0;
    let totalFailed = 0;

    for (const chunk of chunks) {
      const message = {
        notification: { title, body },
        data: { ...data, click_action: 'OPEN_APP' },
        android: {
          priority: 'high',
          notification: {
            icon: 'ic_notification',
            color: '#6c5ce7',
            sound: 'default',
            imageUrl: 'https://accesschain.org/access-logo-1ipfs.png'
          }
        },
        tokens: chunk
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      totalSuccess += response.successCount;
      totalFailed += response.failureCount;
    }

    console.log(`📱 FCM broadcast: ${totalSuccess} success, ${totalFailed} failed`);
    
    return { success: true, successCount: totalSuccess, failureCount: totalFailed };
  } catch (error) {
    console.error('FCM broadcast error:', error);
    return { success: false, error: error.message };
  }
}

export default {
  sendFCMNotification,
  sendFCMToUsers,
  sendFCMToAll,
  isInitialized: () => fcmInitialized
};
