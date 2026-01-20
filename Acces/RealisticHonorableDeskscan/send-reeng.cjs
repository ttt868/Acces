require('dotenv').config();
const webpush = require('web-push');
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

(async () => {
  const email = process.argv[2] || 'acseoire@gmail.com';
  const days = parseInt(process.argv[3]) || 3;
  
  const u = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
  if (!u.rows[0]) { console.log('User not found'); process.exit(); }
  console.log('User ID:', u.rows[0].id);
  
  const s = await pool.query(
    'SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=$1 AND revoked_at IS NULL',
    [u.rows[0].id]
  );
  console.log('Subscriptions:', s.rows.length);
  
  for (const sub of s.rows) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ type: 're-engagement', daysInactive: days, tag: 'reeng-' + Date.now() })
      );
      console.log('SENT OK!');
    } catch (e) {
      console.log('ERROR:', e.statusCode || e.message);
    }
  }
  pool.end();
})();
