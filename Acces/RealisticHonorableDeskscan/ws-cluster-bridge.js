/**
 * ws-cluster-bridge.js
 * Redis Pub/Sub bridge for PM2 cluster WebSocket communication
 * 
 * Problem: PM2 cluster mode runs multiple workers, each with its own wss.clients.
 * When Worker A processes a transaction, it can only send WebSocket messages to clients
 * connected to Worker A. If the recipient is on Worker B, they never get the message.
 * 
 * Solution: Redis Pub/Sub acts as a message bus between all workers.
 * When any worker needs to send a WebSocket message, it publishes to Redis.
 * All workers subscribe and forward messages to their local matching clients.
 * 
 * Flow: Worker A → Redis Publish → All Workers Subscribe → Each checks local clients → Deliver
 */

import Redis from 'ioredis';
import cluster from 'cluster';

const CHANNEL_USER = 'ws:user';           // Targeted user messages
const CHANNEL_BROADCAST = 'ws:broadcast'; // Broadcast to all connected clients

let publisher = null;
let subscriber = null;
let localWss = null;
let localActiveUsers = null;
const workerId = cluster.worker ? cluster.worker.id : 0;

/**
 * Initialize Redis Pub/Sub bridge
 * Must be called after wss is created and activeUsers map is available
 */
function init(wss, activeUsers, redisConfig = {}) {
  localWss = wss;
  localActiveUsers = activeUsers;

  const redisOptions = {
    host: redisConfig.host || '127.0.0.1',
    port: redisConfig.port || 6379,
    password: redisConfig.password || undefined,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy(times) {
      if (times > 20) {
        console.error(`[WS-Bridge] Worker ${workerId}: Redis retry limit reached`);
        return null; // Stop retrying
      }
      return Math.min(times * 200, 5000);
    },
    reconnectOnError(err) {
      const targetErrors = ['READONLY', 'ECONNRESET', 'EPIPE'];
      return targetErrors.some(e => err.message.includes(e));
    }
  };

  // Publisher - for sending messages to Redis
  publisher = new Redis(redisOptions);
  publisher.on('error', (err) => {
    console.error(`[WS-Bridge] Worker ${workerId}: Publisher error:`, err.message);
  });
  publisher.on('ready', () => {
    console.log(`[WS-Bridge] Worker ${workerId}: Publisher connected to Redis`);
  });

  // Subscriber - separate connection (Redis requires separate connections for pub/sub)
  subscriber = new Redis(redisOptions);
  subscriber.on('error', (err) => {
    console.error(`[WS-Bridge] Worker ${workerId}: Subscriber error:`, err.message);
  });
  subscriber.on('ready', () => {
    console.log(`[WS-Bridge] Worker ${workerId}: Subscriber connected to Redis`);
  });

  // Subscribe to channels
  subscriber.subscribe(CHANNEL_USER, CHANNEL_BROADCAST, (err) => {
    if (err) {
      console.error(`[WS-Bridge] Worker ${workerId}: Subscribe error:`, err.message);
    } else {
      console.log(`[WS-Bridge] Worker ${workerId}: Subscribed to channels [${CHANNEL_USER}, ${CHANNEL_BROADCAST}]`);
    }
  });

  // Handle incoming messages from other workers
  subscriber.on('message', (channel, rawMessage) => {
    try {
      const data = JSON.parse(rawMessage);

      // Skip messages from this same worker (already delivered locally)
      if (data._workerId === workerId) return;

      if (channel === CHANNEL_USER) {
        deliverToUser(data.userId, data.notifications);
      } else if (channel === CHANNEL_BROADCAST) {
        deliverToAll(data.notifications, data.targetWallet);
      }
    } catch (err) {
      console.error(`[WS-Bridge] Worker ${workerId}: Message parse error:`, err.message);
    }
  });

  console.log(`[WS-Bridge] Worker ${workerId}: Redis Pub/Sub bridge initialized`);
}

/**
 * Deliver notifications to a specific user on THIS worker only
 * Called both directly (for local delivery) and from Redis subscriber (for cross-worker)
 */
function deliverToUser(userId, notifications) {
  if (!userId || !notifications || !notifications.length) return 0;

  const sentConnections = new Set();
  let deliveredCount = 0;

  // Method 1: Check wss.clients (WebSocket connections on this worker)
  if (localWss && localWss.clients) {
    for (const client of localWss.clients) {
      if (client.readyState === 1 && 
          client.userId && 
          client.userId.toString() === userId.toString()) {
        sentConnections.add(client);
        for (const notification of notifications) {
          try {
            client.send(JSON.stringify(notification));
          } catch (e) {
            // Connection error, skip
          }
        }
        deliveredCount++;
      }
    }
  }

  // Method 2: Check activeUsers map (presence connections on this worker)
  if (localActiveUsers && localActiveUsers.size > 0) {
    const session = localActiveUsers.get(userId) || localActiveUsers.get(String(userId));
    if (session && session.ws && session.ws.readyState === 1 && !sentConnections.has(session.ws)) {
      for (const notification of notifications) {
        try {
          session.ws.send(JSON.stringify(notification));
        } catch (e) {
          // Connection error, skip
        }
      }
      deliveredCount++;
    }
  }

  return deliveredCount;
}

/**
 * Deliver notifications to ALL connected clients on THIS worker only
 * Optionally filter by targetWallet for wallet-specific notifications
 */
function deliverToAll(notifications, targetWallet) {
  if (!notifications || !notifications.length) return;

  const sentConnections = new Set();

  if (localWss && localWss.clients) {
    for (const client of localWss.clients) {
      if (client.readyState === 1) {
        sentConnections.add(client);
        for (const notification of notifications) {
          try {
            client.send(JSON.stringify(notification));
          } catch (e) {
            // Connection error, skip
          }
        }
      }
    }
  }

  // Also deliver via activeUsers to catch any connections not in wss.clients
  if (localActiveUsers && localActiveUsers.size > 0) {
    for (const [userId, session] of localActiveUsers.entries()) {
      if (session && session.ws && session.ws.readyState === 1 && !sentConnections.has(session.ws)) {
        for (const notification of notifications) {
          try {
            session.ws.send(JSON.stringify(notification));
          } catch (e) {
            // Connection error, skip
          }
        }
      }
    }
  }
}

/**
 * Send notifications to a specific user across ALL PM2 workers
 * This is the main function to replace direct wss.clients iteration
 */
function sendToUser(userId, notifications) {
  if (!userId || !notifications || !notifications.length) return;

  // Step 1: Deliver locally first (instant, no Redis latency)
  deliverToUser(userId, notifications);

  // Step 2: Publish to Redis so other workers can deliver to their local clients
  if (publisher && publisher.status === 'ready') {
    publisher.publish(CHANNEL_USER, JSON.stringify({
      _workerId: workerId,
      userId: userId.toString(),
      notifications
    })).catch(err => {
      console.error(`[WS-Bridge] Worker ${workerId}: Publish user error:`, err.message);
    });
  }
}

/**
 * Broadcast notifications to ALL connected clients across ALL PM2 workers
 */
function sendToAll(notifications, targetWallet) {
  if (!notifications || !notifications.length) return;

  // Step 1: Deliver locally first
  deliverToAll(notifications, targetWallet);

  // Step 2: Publish to Redis so other workers can deliver
  if (publisher && publisher.status === 'ready') {
    publisher.publish(CHANNEL_BROADCAST, JSON.stringify({
      _workerId: workerId,
      notifications,
      targetWallet: targetWallet || null
    })).catch(err => {
      console.error(`[WS-Bridge] Worker ${workerId}: Publish broadcast error:`, err.message);
    });
  }
}

/**
 * Check if the bridge is operational
 */
function isReady() {
  return publisher && subscriber && 
         publisher.status === 'ready' && 
         subscriber.status === 'ready';
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  console.log(`[WS-Bridge] Worker ${workerId}: Shutting down...`);
  try {
    if (subscriber) {
      await subscriber.unsubscribe();
      subscriber.disconnect();
    }
    if (publisher) {
      publisher.disconnect();
    }
  } catch (e) {
    // Ignore shutdown errors
  }
}

/**
 * Get bridge status for health checks
 */
function getStatus() {
  return {
    workerId,
    publisherReady: publisher ? publisher.status === 'ready' : false,
    subscriberReady: subscriber ? subscriber.status === 'ready' : false,
    localClients: localWss ? localWss.clients.size : 0,
    activeUsers: localActiveUsers ? localActiveUsers.size : 0
  };
}

export default { init, sendToUser, sendToAll, isReady, shutdown, getStatus };
export { init, sendToUser, sendToAll, isReady, shutdown, getStatus };
