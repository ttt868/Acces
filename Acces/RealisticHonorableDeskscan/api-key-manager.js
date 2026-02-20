import { pool } from './db.js';
import crypto from 'crypto';

// 🔐 API Key Management with Rate Limiting & IP Blocking
// نظام إدارة مفاتيح API مع حد للطلبات وحظر IP

// ⚠️ IMPORTANT: Rate limits are ONLY for external developers using API keys
// المستكشف نفسه (access-explorer.html) غير خاضع لهذه القيود
// هذه القيود فقط لحماية الموارد من المطورين الخارجيين

// 💰 FUTURE PAYMENT SYSTEM:
// - free tier: محدود جداً - للحماية من الكارهين
// - paid tiers: سيتم فتحها حسب الدفع في المستقبل
// - premium: للشركات والمطورين الكبار
// 
// TODO للمستقبل: إضافة نظام الدفع واشتراكات شهرية
// TODO للمستقبل: إضافة لوحة تحكم للترقية للباقات المدفوعة

const RATE_LIMITS = {
  free: 50,       // 50 requests/hour - حد منخفض جداً لحماية الموارد
  basic: 500,     // 500 requests/hour - باقة مدفوعة مستقبلية
  standard: 2000, // 2000 requests/hour - باقة قياسية مدفوعة
  premium: 10000, // 10000 requests/hour - باقة متميزة للشركات
  unlimited: -1   // غير محدود - للمستكشف نفسه فقط
};

const IP_BLOCK_THRESHOLDS = {
  soft: 300,    // 300 requests in 5 minutes = temporary block (1 hour) - حماية أقوى
  hard: 600     // 600 requests in 5 minutes = permanent block - حماية من الهجمات
};

// Rate limiting tracking
const rateLimitCache = new Map();
const ipRequestCounts = new Map();

/**
 * Generate a secure API key
 */
export function generateApiKey() {
  // Generate 64 bytes = 128 hex characters + "ak_" prefix (3 chars) = 131 total chars
  // Database column is VARCHAR(256) so it fits perfectly
  return `ak_${crypto.randomBytes(64).toString('hex')}`;
}

/**
 * Create API key for user with rate limiting protection
 * @param {number} explorerUserId - User ID from explorer_users table
 * @param {string} keyName - Name/description of the API key
 * @param {number} rateLimit - Requests per hour (default: 50 for free tier)
 * @param {string} tier - Tier type: 'free', 'basic', 'standard', 'premium' (default: 'free')
 */
export async function createApiKey(explorerUserId, keyName = 'API Key', rateLimit = 50, tier = 'free') {
  try {
    // 🛡️ PROTECTION: Rate limit API key creation (max 5 per 24 hours)
    const recentCreations = await pool.query(
      `SELECT COUNT(*) as count 
       FROM api_key_audit_log 
       WHERE user_id = $1 
       AND action = 'create' 
       AND created_at > NOW() - INTERVAL '24 hours'`,
      [explorerUserId]
    );

    const creationCount = parseInt(recentCreations.rows[0]?.count || 0);
    
    if (creationCount >= 5) {
      console.warn(`⚠️ ABUSE DETECTED: User ${explorerUserId} exceeded creation limit`);
      return {
        success: false,
        error: 'Too many API key creations. Please wait 24 hours.',
        errorCode: 'CREATION_RATE_LIMIT',
        retryAfter: '24 hours'
      };
    }

    // 🔒 SECURITY CHECK: Limit to ONE ACTIVE API key per user to prevent abuse
    const existingKeys = await pool.query(
      `SELECT COUNT(*) as count 
       FROM explorer_api_keys 
       WHERE explorer_user_id = $1 AND is_active = true`,
      [explorerUserId]
    );

    const keyCount = parseInt(existingKeys.rows[0].count);
    if (keyCount >= 1) {
      console.log(`⚠️ User ${explorerUserId} already has an active API key`);
      return {
        success: false,
        error: 'You can only have one active API key. Please delete your existing key first.',
        errorCode: 'MAX_KEYS_REACHED'
      };
    }

    const apiKey = generateApiKey();
    const now = Date.now();
    
    // 🔒 SECURITY: Free tier is LIMITED to prevent resource abuse
    if (tier === 'free') {
      rateLimit = RATE_LIMITS.free; // Force free tier limit
    }

    // First check if the table exists and has the correct structure
    const tableCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'explorer_api_keys' 
      AND column_name = 'explorer_user_id'
    `);

    if (tableCheck.rows.length === 0) {
      // Column doesn't exist, create it
      await pool.query(`
        ALTER TABLE explorer_api_keys 
        ADD COLUMN IF NOT EXISTS explorer_user_id INTEGER REFERENCES explorer_users(id) ON DELETE CASCADE
      `);
      console.log('✅ Added explorer_user_id column to explorer_api_keys table');
    }

    const result = await pool.query(
      `INSERT INTO explorer_api_keys 
       (explorer_user_id, api_key, key_name, rate_limit, tier, requests_used, requests_reset_at, is_active, created_at) 
       VALUES ($1, $2, $3, $4, $5, 0, $6, true, $7) 
       RETURNING *`,
      [explorerUserId, apiKey, keyName, rateLimit, tier, now + 3600000, now]
    );

    // 📝 Audit log entry
    await logApiKeyAction(explorerUserId, 'create', {
      key_id: result.rows[0].id,
      key_name: keyName,
      tier: tier
    });

    console.log(`✅ API Key created for explorer user ${explorerUserId}: ${keyName}`);
    return {
      success: true,
      apiKey: result.rows[0]
    };
  } catch (error) {
    console.error('❌ Error creating API key:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 📝 Log API key actions for audit trail and abuse detection
 */
async function logApiKeyAction(userId, action, metadata = {}) {
  try {
    await pool.query(
      `INSERT INTO api_key_audit_log (user_id, action, metadata, ip_address, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [userId, action, JSON.stringify(metadata), null]
    );
  } catch (error) {
    console.error('Error logging API key action:', error);
    // Don't fail the operation if logging fails
  }
}

/**
 * Get all API keys for user
 */
export async function getUserApiKeys(explorerUserId) {
  try {
    const result = await pool.query(
      `SELECT id, api_key, key_name, rate_limit, tier, requests_used, requests_reset_at, 
              is_active, created_at, last_used_at 
       FROM explorer_api_keys 
       WHERE explorer_user_id = $1 AND is_active = true 
       ORDER BY created_at DESC`,
      [explorerUserId]
    );

    return {
      success: true,
      apiKeys: result.rows
    };
  } catch (error) {
    console.error('Error fetching API keys:', error);
    return {
      success: false,
      error: error.message,
      apiKeys: []
    };
  }
}

/**
 * Delete (deactivate) API key with rate limiting and audit logging
 * Uses SOFT DELETE - keys are never permanently removed from database
 */
export async function deleteApiKey(keyId, explorerUserId) {
  try {
    // 🛡️ PROTECTION: Check recent deletion activity (24-hour cooldown)
    const recentDeletions = await pool.query(
      `SELECT COUNT(*) as count 
       FROM api_key_audit_log 
       WHERE user_id = $1 
       AND action = 'delete' 
       AND created_at > NOW() - INTERVAL '24 hours'`,
      [explorerUserId]
    );

    const deletionCount = parseInt(recentDeletions.rows[0]?.count || 0);
    
    if (deletionCount >= 3) {
      console.warn(`⚠️ ABUSE DETECTED: User ${explorerUserId} exceeded deletion limit`);
      return {
        success: false,
        error: 'Too many deletions. Please wait 24 hours before deleting more keys.',
        errorCode: 'RATE_LIMIT_EXCEEDED',
        retryAfter: '24 hours'
      };
    }

    // Get key info before soft delete (for audit log)
    const keyInfo = await pool.query(
      'SELECT api_key, key_name, requests_used FROM explorer_api_keys WHERE id = $1 AND explorer_user_id = $2',
      [keyId, explorerUserId]
    );

    if (keyInfo.rows.length === 0) {
      return {
        success: false,
        error: 'API key not found or access denied'
      };
    }

    // ✅ SOFT DELETE: Mark as inactive instead of deleting
    await pool.query(
      `UPDATE explorer_api_keys 
       SET is_active = false, 
           deleted_at = $1 
       WHERE id = $2 AND explorer_user_id = $3`,
      [Date.now(), keyId, explorerUserId]
    );

    // 📝 Audit log entry
    await logApiKeyAction(explorerUserId, 'delete', {
      key_id: keyId,
      key_name: keyInfo.rows[0].key_name,
      requests_used: keyInfo.rows[0].requests_used
    });

    console.log(`🗑️ API Key ${keyId} soft-deleted for user ${explorerUserId} (preserved in database)`);
    return { success: true };
  } catch (error) {
    console.error('Error deleting API key:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Validate API key and check rate limits
 */
export async function validateApiKey(apiKey, ipAddress) {
  try {
    // Check if IP is blocked
    const ipBlocked = await isIpBlocked(ipAddress);
    if (ipBlocked.blocked) {
      return {
        valid: false,
        error: `IP blocked: ${ipBlocked.reason}`,
        blocked: true
      };
    }

    // Validate API key
    const result = await pool.query(
      `SELECT eak.*, eu.email 
       FROM explorer_api_keys eak
       JOIN explorer_users eu ON eu.id = eak.explorer_user_id
       WHERE eak.api_key = $1 AND eak.is_active = true`,
      [apiKey]
    );

    if (result.rows.length === 0) {
      await trackIpRequest(ipAddress, false);
      return {
        valid: false,
        error: 'Invalid API key'
      };
    }

    const keyData = result.rows[0];

    // Check rate limit (timestamps stored as bigint ms)
    const nowMs = Date.now();
    if (nowMs > keyData.requests_reset_at) {
      // Reset counter
      await pool.query(
        'UPDATE explorer_api_keys SET requests_used = 0, requests_reset_at = $1 WHERE id = $2',
        [nowMs + 3600000, keyData.id]
      );
      keyData.requests_used = 0;
    }

    if (keyData.requests_used >= keyData.rate_limit) {
      await trackIpRequest(ipAddress, false);
      return {
        valid: false,
        error: 'Rate limit exceeded',
        rateLimit: keyData.rate_limit,
        used: keyData.requests_used
      };
    }

    // Increment usage
    await pool.query(
      'UPDATE explorer_api_keys SET requests_used = requests_used + 1, last_used_at = $1 WHERE id = $2',
      [nowMs, keyData.id]
    );

    // Track IP request
    await trackIpRequest(ipAddress, true);

    return {
      valid: true,
      userId: keyData.explorer_user_id,
      email: keyData.email,
      rateLimit: keyData.rate_limit,
      used: keyData.requests_used + 1
    };
  } catch (error) {
    console.error('Error validating API key:', error);
    return {
      valid: false,
      error: 'Server error'
    };
  }
}

/**
 * Track IP requests and auto-block abusers
 */
async function trackIpRequest(ipAddress, success) {
  const now = Date.now();
  const fiveMinutesAgo = now - (5 * 60 * 1000);

  if (!ipRequestCounts.has(ipAddress)) {
    ipRequestCounts.set(ipAddress, []);
  }

  const requests = ipRequestCounts.get(ipAddress);
  
  // Clean old requests
  const recentRequests = requests.filter(time => time > fiveMinutesAgo);
  recentRequests.push(now);
  ipRequestCounts.set(ipAddress, recentRequests);

  const requestCount = recentRequests.length;

  // Check thresholds
  if (requestCount >= IP_BLOCK_THRESHOLDS.hard) {
    // Permanent block
    await blockIp(ipAddress, 'Excessive requests (permanent)', true);
    console.warn(`🚫 PERMANENT IP BLOCK: ${ipAddress} (${requestCount} requests in 5 minutes)`);
  } else if (requestCount >= IP_BLOCK_THRESHOLDS.soft) {
    // Temporary block (1 hour)
    const blockedUntil = new Date(Date.now() + 3600000);
    await blockIp(ipAddress, 'Excessive requests (temporary)', false, blockedUntil);
    console.warn(`⏰ TEMPORARY IP BLOCK: ${ipAddress} (${requestCount} requests in 5 minutes) until ${blockedUntil.toISOString()}`);
  }
}

/**
 * Block an IP address
 */
export async function blockIp(ipAddress, reason, isPermanent = false, blockedUntil = null) {
  try {
    await pool.query(
      `INSERT INTO blocked_ips (ip_address, reason, is_permanent, blocked_until, request_count)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ip_address) 
       DO UPDATE SET reason = $2, is_permanent = $3, blocked_until = $4, blocked_at = NOW()`,
      [ipAddress, reason, isPermanent, blockedUntil, ipRequestCounts.get(ipAddress)?.length || 0]
    );

    return { success: true };
  } catch (error) {
    console.error('Error blocking IP:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if IP is blocked
 */
export async function isIpBlocked(ipAddress) {
  try {
    const result = await pool.query(
      `SELECT * FROM blocked_ips 
       WHERE ip_address = $1 
       AND (is_permanent = true OR blocked_until > NOW())`,
      [ipAddress]
    );

    if (result.rows.length > 0) {
      const block = result.rows[0];
      return {
        blocked: true,
        reason: block.reason,
        isPermanent: block.is_permanent,
        blockedUntil: block.blocked_until
      };
    }

    return { blocked: false };
  } catch (error) {
    console.error('Error checking IP block:', error);
    return { blocked: false };
  }
}

/**
 * Unblock an IP address
 */
export async function unblockIp(ipAddress) {
  try {
    await pool.query('DELETE FROM blocked_ips WHERE ip_address = $1', [ipAddress]);
    ipRequestCounts.delete(ipAddress);
    console.log(`✅ IP unblocked: ${ipAddress}`);
    return { success: true };
  } catch (error) {
    console.error('Error unblocking IP:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all blocked IPs
 */
export async function getBlockedIps() {
  try {
    const result = await pool.query(
      `SELECT * FROM blocked_ips ORDER BY blocked_at DESC LIMIT 100`
    );

    return {
      success: true,
      blockedIps: result.rows
    };
  } catch (error) {
    console.error('Error fetching blocked IPs:', error);
    return {
      success: false,
      error: error.message,
      blockedIps: []
    };
  }
}

/**
 * API Key Middleware - validates all API requests
 */
export async function apiKeyMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!apiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: '0',
      message: 'API key required. Get your key at developer-api.html',
      result: null
    }));
    return false;
  }

  const validation = await validateApiKey(apiKey, ipAddress);

  if (!validation.valid) {
    const statusCode = validation.blocked ? 403 : 401;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: '0',
      message: validation.error,
      result: null
    }));
    return false;
  }

  // Add user info to request
  req.apiKeyUser = {
    userId: validation.userId,
    email: validation.email,
    rateLimit: validation.rateLimit,
    used: validation.used
  };

  return true;
}

// Cleanup old rate limit data every 10 minutes
setInterval(() => {
  const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
  
  for (const [ip, requests] of ipRequestCounts.entries()) {
    const recentRequests = requests.filter(time => time > tenMinutesAgo);
    if (recentRequests.length === 0) {
      ipRequestCounts.delete(ip);
    } else {
      ipRequestCounts.set(ip, recentRequests);
    }
  }
}, 10 * 60 * 1000);

export default {
  generateApiKey,
  createApiKey,
  getUserApiKeys,
  deleteApiKey,
  validateApiKey,
  blockIp,
  unblockIp,
  isIpBlocked,
  getBlockedIps,
  apiKeyMiddleware
};
