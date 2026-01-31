// Test Push Notification Script
import webpush from 'web-push';
import { pool } from './db.js';

webpush.setVapidDetails(
  'mailto:admin@access-network.com',
  'BNj9ssedNiYUBqmqwJndFQHPZKBEWuFmtZYX9HBm0VdOgFWltE6jbgyIN1wfgSO-i_zoMq4Dmr7VBw3aQpx7cVI',
  'cld4QfvBnKEksVSTcwKjDGghxLif3_QYBogorlrVBjk'
);

async function sendTestNotification() {
  const r = await pool.query("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = '2' AND revoked_at IS NULL LIMIT 1");
  
  if (r.rows.length === 0) {
    console.log('❌ No subscription found');
    return;
  }
  
  const sub = { 
    endpoint: r.rows[0].endpoint, 
    keys: { p256dh: r.rows[0].p256dh, auth: r.rows[0].auth } 
  };
  
  console.log('📤 Sending to:', sub.endpoint.substring(0, 50) + '...');
  
  try {
    await webpush.sendNotification(sub, JSON.stringify({ 
      title: 'ACCESS Network 🔔', 
      body: 'Your session is ready! Tap to start.', 
      icon: '/access-logo-1ipfs.png' 
    }));
    console.log('✅ Notification sent successfully!');
  } catch (e) {
    console.log('❌ Error:', e.statusCode, e.message);
  }
  
  process.exit(0);
}

sendTestNotification();
