// Test Re-engagement Notification Script
const webpush = require('web-push');
const { pool } = require('./db.js');

webpush.setVapidDetails(
  'mailto:support@accessnetwork.app',
  'BMH7kVxrEyHH3pasoWM4fy5K8HVGhM-2kz1b6f5AZKsXYIWHJPd6RCXAdCjwGP4bRcB_pIm0JIq_Hq3LPnKP4aw',
  'N05G3FEzYL8I0xwSCvmgOYlzKcMKqK2r7HmfvS8DFg0'
);

async function sendTestReEngagement(email) {
  try {
    console.log('🔍 Looking for user:', email);
    
    const userResult = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ User not found:', email);
      await pool.end();
      return;
    }
    
    const userId = userResult.rows[0].id;
    console.log('✅ User ID:', userId);
    
    const subsResult = await pool.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    );
    
    console.log('📱 Subscriptions found:', subsResult.rows.length);
    
    if (subsResult.rows.length === 0) {
      console.log('❌ No push subscriptions for this user');
      await pool.end();
      return;
    }
    
    const payload = JSON.stringify({
      type: 're-engagement',
      tag: 'test-reengagement-' + Date.now(),
      daysInactive: 3,
      timestamp: Date.now()
    });
    
    console.log('📤 Sending notification...');
    
    for (const sub of subsResult.rows) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }, payload);
        console.log('✅ SUCCESS: Re-engagement notification sent!');
      } catch (err) {
        console.log('❌ FAILED:', err.message, '| Status:', err.statusCode);
        if (err.statusCode === 410 || err.statusCode === 404) {
          console.log('   Subscription expired - should be deleted');
        }
      }
    }
    
    await pool.end();
    console.log('✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run with email from command line or default
const email = process.argv[2] || 'acseoire@gmail.com';
sendTestReEngagement(email);
