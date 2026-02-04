
    // POST /api/fcm/send - Send FCM notification (for testing)
    if (pathname === '/api/fcm/send' && req.method === 'POST') {
      try {
        const { userId, title, body } = await parseRequestBody(req);
        
        if (!userId || !title || !body) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'userId, title, and body required' }));
          return;
        }

        const result = await fcmService.sendFCMNotification(userId, title, body);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      } catch (error) {
        console.error('Error sending FCM:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
    }

