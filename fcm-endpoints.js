
    // ========== FCM (Firebase Cloud Messaging) ENDPOINTS for Cordova App ==========
    
    // POST /api/fcm/register - Register FCM token for push notifications
    if (pathname === '/api/fcm/register' && req.method === 'POST') {
      try {
        const { userId, token, platform } = await parseRequestBody(req);
        
        if (!userId || !token) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'userId and token required' }));
          return;
        }

        // Save or update FCM token
        await pool.query(`
          INSERT INTO fcm_tokens (user_id, token, platform, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (token) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            platform = EXCLUDED.platform,
            updated_at = NOW()
        `, [userId, token, platform || 'android']);

        console.log(`📱 FCM token registered for user ${userId}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'FCM token registered' }));
        return;
      } catch (error) {
        console.error('Error registering FCM token:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

    // DELETE /api/fcm/unregister - Remove FCM token
    if (pathname === '/api/fcm/unregister' && req.method === 'DELETE') {
      try {
        const { token } = await parseRequestBody(req);
        
        if (!token) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'token required' }));
          return;
        }

        await pool.query('DELETE FROM fcm_tokens WHERE token = $1', [token]);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'FCM token removed' }));
        return;
      } catch (error) {
        console.error('Error removing FCM token:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

