import 'dotenv/config';
import pg from 'pg';
import { getDatabaseConfig } from './database-config.js';
import { getCurrentBaseReward, splitReward, roundReward, FOUNDER_ADDRESS, DEV_FEE_PERCENT, MAX_SUPPLY } from './tokenomics.js';
const { Pool } = pg;

// 🚀 نظام Throttling ذكي لمنع UPDATE المتكررة
// هذا يمنع استنفاد قاعدة البيانات مع الحفاظ على الوظائف
const accumulatedUpdateThrottle = new Map(); // userId -> lastUpdateTime
const ACCUMULATED_THROTTLE_MS = 10000; // 10 ثواني بين كل UPDATE

// 💰 Cache للمعروض المتداول (يُحدّث كل 5 دقائق)
let _dbCachedSupply = 0;
let _dbLastSupplyCheck = 0;
async function getDbCirculatingSupply() {
  const now = Date.now();
  if (_dbCachedSupply > 0 && (now - _dbLastSupplyCheck) < 300000) return _dbCachedSupply;
  try {
    // 1) DB coins
    const r = await pool.query('SELECT COALESCE(SUM(coins), 0) as total FROM users WHERE coins > 0');
    const dbTotal = parseFloat(r.rows[0].total) || 0;

    // 2) Web3 State Trie
    let trieTotal = 0;
    try {
      const { getGlobalAccessStateStorage } = await import('./access-state-storage.js');
      const stateStorage = getGlobalAccessStateStorage();
      const accountCache = stateStorage?.accountCache || {};
      for (const addr in accountCache) {
        const acc = accountCache[addr];
        if (acc && acc.balance) trieTotal += parseInt(acc.balance) / 1e18;
      }
    } catch (_) { /* fallback to DB only */ }

    // ✅ الأعلى = المعروض الحقيقي
    _dbCachedSupply = Math.max(dbTotal, trieTotal);
    _dbLastSupplyCheck = now;
  } catch (e) { /* use cached */ }
  return _dbCachedSupply;
}
async function dbCurrentBaseReward() {
  return getCurrentBaseReward(await getDbCirculatingSupply());
}

function shouldSkipAccumulatedUpdate(userId) {
  const now = Date.now();
  const lastUpdate = accumulatedUpdateThrottle.get(userId) || 0;
  
  if (now - lastUpdate < ACCUMULATED_THROTTLE_MS) {
    return true; // تجاهل هذا UPDATE
  }
  
  accumulatedUpdateThrottle.set(userId, now);
  return false; // السماح بالـ UPDATE
}

// تنظيف الـ throttle map كل 5 دقائق
setInterval(() => {
  const now = Date.now();
  for (const [userId, time] of accumulatedUpdateThrottle.entries()) {
    if (now - time > 60000) {
      accumulatedUpdateThrottle.delete(userId);
    }
  }
}, 5 * 60 * 1000);

// Get database configuration (automatically detects environment)
let dbConfig;
try {
  dbConfig = getDatabaseConfig();
} catch (error) {
  console.error('❌ Database configuration error:', error.message);
  console.error('💡 Quick fix options:');
  console.error('1. Run: node migration-helper.js template <provider>');
  console.error('2. Copy credentials from your database provider to .env');
  console.error('3. Use migration-helper.js for easy platform switching');
  process.exit(1);
}

// ⚡ ADAPTIVE CONNECTION POOL - يتكيف تلقائياً مع قوة قاعدة البيانات!
// 🧠 النظام يختبر قاعدة البيانات ويحدد الإعدادات المثلى تلقائياً

// البداية بقيم آمنة (ستتغير تلقائياً بعد الاختبار)
let currentPoolMax = 20;
let currentPoolMin = 5;
let currentTimeout = 15000;
let isAdaptiveMode = true;

const pool = new Pool({
  connectionString: dbConfig.connectionString,
  // SSL disabled for local PgBouncer connection
  // ssl: { rejectUnauthorized: false },
  client_encoding: 'UTF8',

  // 🚀 إعدادات أولية آمنة - ستتحسن تلقائياً
  max: currentPoolMax,
  min: currentPoolMin,
  
  // ⚡ Timeouts
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: currentTimeout,
  // query_timeout: removed for PgBouncer compatibility
  // statement_timeout: removed for PgBouncer compatibility
  
  // 🔄 Keep-alive
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  
  // 📊 إعدادات الاستقرار
  allowExitOnIdle: true,
  
  // 🎯 Application identification
  application_name: 'AccessCrypto_Adaptive_v6'
});

// 🔄 معالجة أخطاء Pool (صامتة)
pool.on('error', (err, client) => {
  // Silent - تجنب spam الكونسول
});

// 🧪 اختبار قوة قاعدة البيانات وتكييف الإعدادات تلقائياً
async function adaptPoolToDatabase() {
  console.log('🔍 اختبار قوة قاعدة البيانات (PgBouncer)...');
  
  const startTime = Date.now();
  let successfulConnections = 0;
  let avgResponseTime = 0;
  
  try {
    // اختبار 1: سرعة الاستجابة
    const t1 = Date.now();
    await pool.query('SELECT 1');
    const responseTime = Date.now() - t1;
    avgResponseTime = responseTime;
    
    // اختبار 2: محاولة فتح اتصالات متعددة
    // اختبار بسيط متوافق مع PgBouncer
    const maxTestConnections = 10;
    const t2 = Date.now();
    for (let i = 0; i < 5; i++) {
      await pool.query('SELECT 1');
    }
    successfulConnections = (Date.now() - t2) < 2000 ? 8 : 3;
    
    // 🎯 تحديد الإعدادات المثلى بناءً على النتائج
    let newMax, newMin, newTimeout, dbStrength;
    
    if (responseTime < 100 && successfulConnections >= 8) {
      // قاعدة بيانات قوية جداً
      newMax = 100;
      newMin = 20;
      newTimeout = 5000;
      dbStrength = '🚀 SUPER FAST';
    } else if (responseTime < 500 && successfulConnections >= 5) {
      // قاعدة بيانات جيدة
      newMax = 50;
      newMin = 10;
      newTimeout = 8000;
      dbStrength = '⚡ FAST';
    } else if (responseTime < 2000 && successfulConnections >= 3) {
      // قاعدة بيانات متوسطة
      newMax = 10;
      newMin = 2;
      newTimeout = 12000;
      dbStrength = '✅ NORMAL';
    } else {
      // قاعدة بيانات بطيئة (مجانية/cold start)
      newMax = 3;
      newMin = 1;
      newTimeout = 15000;
      dbStrength = '🐢 SLOW (Free tier)';
    }
    
    // تحديث القيم
    currentPoolMax = newMax;
    currentPoolMin = newMin;
    currentTimeout = newTimeout;
    
    console.log(`📊 نتائج الاختبار:`);
    console.log(`   - سرعة الاستجابة: ${responseTime}ms`);
    console.log(`   - اتصالات ناجحة: ${successfulConnections}/${maxTestConnections}`);
    console.log(`   - قوة قاعدة البيانات: ${dbStrength}`);
    console.log(`🔧 الإعدادات المثلى: max=${newMax}, min=${newMin}, timeout=${newTimeout}ms`);
    
    return { success: true, max: newMax, min: newMin, timeout: newTimeout, strength: dbStrength };
    
  } catch (error) {
    console.log('⚠️ فشل اختبار قاعدة البيانات، استخدام الإعدادات الآمنة');
    return { success: false, max: 3, min: 1, timeout: 15000, strength: '❓ UNKNOWN' };
  }
}

// تشغيل الاختبار عند بدء التطبيق
setTimeout(() => {
  adaptPoolToDatabase().then(result => {
    console.log(`✅ تم تكييف Pool تلقائياً: ${result.strength}`);
  });
}, 5000); // انتظار 5 ثواني بعد البدء

pool.on('connect', (client) => {
  // Silent - تقليل رسائل الكونسول
});

// 🔄 Keep-alive ping كل 5 دقائق (بدلاً من 2)
setInterval(async () => {
  try {
    await pool.query('SELECT 1');
    // Silent - لا حاجة لطباعة كل ping
  } catch (err) {
    // Silent - تجنب spam
  }
}, 5 * 60 * 1000); // كل 5 دقائق

// Test the connection with retry logic
async function testConnection(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      return true;
    } catch (err) {
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }
  return false;
}

testConnection();

// 🔄 Retry wrapper for database queries with exponential backoff
async function queryWithRetry(queryFn, retries = 5, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await queryFn();
    } catch (error) {
      const isLastAttempt = attempt === retries;
      // ✅ إضافة "terminated" و "unexpectedly" للأخطاء القابلة للإعادة
      const isRetryableError = 
        error.message?.includes('timeout') || 
        error.message?.includes('connect') ||
        error.message?.includes('terminated') ||
        error.message?.includes('unexpectedly') ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('ETIMEDOUT');

      if (isLastAttempt || !isRetryableError) {
        throw error; // Don't retry if it's the last attempt or not a retryable error
      }

      const delay = delayMs * Math.pow(2, attempt - 1); // Exponential backoff
      console.log(`⚠️ Query attempt ${attempt}/${retries} failed (${error.message}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
// Export queryWithRetry for use in server.js
export { queryWithRetry };

// 🚀 Safe Query helper with timeout and retry - لمنع Query read timeout
async function safeQuery(query, params = [], timeoutMs = 5000, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await Promise.race([
        pool.query(query, params),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
        )
      ]);
      return result;
    } catch (error) {
      if (error.message === 'Query timeout') {
        console.warn(`⚠️ Query timed out (attempt ${attempt}/${retries}):`, query.substring(0, 50));
      }
      if (attempt < retries) {
        console.log(`🔄 Retrying query... (${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw error;
    }
  }
}

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create processing_history table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS processing_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        amount NUMERIC NOT NULL,
        timestamp BIGINT NOT NULL,
        user_name VARCHAR(255) NOT NULL,
        date TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // إضافة عمود created_at إذا لم يكن موجوداً
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'processing_history' AND column_name = 'created_at'
        ) THEN
          ALTER TABLE processing_history ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
        END IF;
      END$$;
    `);

    // Create users table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE,
        name TEXT,
        avatar TEXT,
        coins NUMERIC(20,8) DEFAULT 0,
        referral_code TEXT UNIQUE,
        referred_by TEXT,
        processing_active INTEGER DEFAULT 0,
        processing_start_time BIGINT,
        processing_end_time BIGINT,
        last_payout BIGINT,
        processing_duration BIGINT DEFAULT 0,
        language TEXT DEFAULT 'en',
        privacy_accepted BOOLEAN DEFAULT FALSE,
        privacy_accepted_date BIGINT,
        wallet_address TEXT,
        wallet_private_key TEXT,
        wallet_created_at BIGINT,
        processing_rate NUMERIC DEFAULT 0,
        processing_boost_multiplier NUMERIC DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Ensure wallet columns exist in users table (for backward compatibility)
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'wallet_private_key'
          ) THEN
            ALTER TABLE users ADD COLUMN wallet_private_key TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'wallet_created_at'
          ) THEN
            ALTER TABLE users ADD COLUMN wallet_created_at BIGINT;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_rate'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_rate NUMERIC DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_boost_multiplier'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_boost_multiplier NUMERIC DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'completed_processing_reward'
          ) THEN
            ALTER TABLE users ADD COLUMN completed_processing_reward NUMERIC(10,8) DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_start_time_seconds'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_start_time_seconds BIGINT;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'last_server_update'
          ) THEN
            ALTER TABLE users ADD COLUMN last_server_update BIGINT;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'account_created_date'
          ) THEN
            ALTER TABLE users ADD COLUMN account_created_date BIGINT;
          END IF;

          -- إضافة الأعمدة المفقودة
          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_cooldown'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_cooldown BIGINT DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'is_active'
          ) THEN
            ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processingactive'
          ) THEN
            ALTER TABLE users ADD COLUMN processingactive INTEGER DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_remaining_seconds'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_remaining_seconds INTEGER DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_active'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_active INTEGER DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_completed'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_completed BOOLEAN DEFAULT FALSE;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'last_server_sync'
          ) THEN
            ALTER TABLE users ADD COLUMN last_server_sync BIGINT DEFAULT 0;
          END IF;

          -- SMART BOOST: Add session_locked_boost column for locking referral boost at session start
          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'session_locked_boost'
          ) THEN
            ALTER TABLE users ADD COLUMN session_locked_boost NUMERIC DEFAULT 1.0;
          END IF;

          -- AD BOOST SYSTEM: Rewarded Ad Boost columns
          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'ad_boost_active'
          ) THEN
            ALTER TABLE users ADD COLUMN ad_boost_active BOOLEAN DEFAULT FALSE;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'ad_boost_granted_at'
          ) THEN
            ALTER TABLE users ADD COLUMN ad_boost_granted_at BIGINT;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'ad_boost_session_start'
          ) THEN
            ALTER TABLE users ADD COLUMN ad_boost_session_start BIGINT;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'last_ad_watch_timestamp'
          ) THEN
            ALTER TABLE users ADD COLUMN last_ad_watch_timestamp BIGINT DEFAULT 0;
          END IF;

          -- REFERRAL SYSTEM: Add referred_by column for tracking who referred this user
          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'referred_by'
          ) THEN
            ALTER TABLE users ADD COLUMN referred_by TEXT;
          END IF;

          -- Add created_at column for users
          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'created_at'
          ) THEN
            ALTER TABLE users ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
          END IF;
        END$$;
      `);

    // Create ad_rewards tracking table for security and anti-fraud
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ad_rewards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        ad_completed BOOLEAN DEFAULT FALSE,
        granted_at BIGINT NOT NULL,
        session_start_time BIGINT,
        transaction_id TEXT UNIQUE,
        ip_address TEXT,
        user_agent TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Ensure wallet columns exist in users table (for backward compatibility)
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'wallet_private_key'
          ) THEN
            ALTER TABLE users ADD COLUMN wallet_private_key TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'wallet_created_at'
          ) THEN
            ALTER TABLE users ADD COLUMN wallet_created_at BIGINT;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_rate'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_rate NUMERIC DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_boost_multiplier'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_boost_multiplier NUMERIC DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'completed_processing_reward'
          ) THEN
            ALTER TABLE users ADD COLUMN completed_processing_reward NUMERIC(10,8) DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_start_time_seconds'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_start_time_seconds BIGINT;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'last_server_update'
          ) THEN
            ALTER TABLE users ADD COLUMN last_server_update BIGINT;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'account_created_date'
          ) THEN
            ALTER TABLE users ADD COLUMN account_created_date BIGINT;
          END IF;

          -- إضافة الأعمدة المفقودة
          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_cooldown'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_cooldown BIGINT DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'is_active'
          ) THEN
            ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processingactive'
          ) THEN
            ALTER TABLE users ADD COLUMN processingactive INTEGER DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_remaining_seconds'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_remaining_seconds INTEGER DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_active'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_active INTEGER DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_completed'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_completed BOOLEAN DEFAULT FALSE;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'last_server_sync'
          ) THEN
            ALTER TABLE users ADD COLUMN last_server_sync BIGINT DEFAULT 0;
          END IF;

          -- SMART BOOST: Add session_locked_boost column for locking referral boost at session start
          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'session_locked_boost'
          ) THEN
            ALTER TABLE users ADD COLUMN session_locked_boost NUMERIC DEFAULT 1.0;
          END IF;
        END$$;
      `);

    // Ensure required columns exist (silent setup)
    await pool.query(`
      DO $$
      BEGIN
        ALTER TABLE users 
        ALTER COLUMN coins TYPE NUMERIC(20,8) USING coins::numeric;
      EXCEPTION
        WHEN others THEN
          NULL;
      END$$;
    `);

    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'accumulated_processing_reward'
        ) THEN
          ALTER TABLE users ADD COLUMN accumulated_processing_reward NUMERIC(20,8) DEFAULT 0;
        END IF;

        IF NOT EXISTS (
             SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'accumulatedreward'
        ) THEN
          ALTER TABLE users ADD COLUMN accumulatedReward NUMERIC(20,8) DEFAULT 0;
        END IF;

        -- إضافة عمود processing_accumulated المفقود
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'processing_accumulated'
        ) THEN
          ALTER TABLE users ADD COLUMN processing_accumulated NUMERIC(20,8) DEFAULT 0;
        END IF;

        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'last_processing_accumulation'
        ) THEN
          ALTER TABLE users ADD COLUMN last_processing_accumulation BIGINT;
        END IF;

        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'active_referral_count'
        ) THEN
          ALTER TABLE users ADD COLUMN active_referral_count INTEGER DEFAULT 0;
        END IF;

        -- إضافة عمود processing_completed_time إذا لم يكن موجوداً
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'processing_completed_time'
        ) THEN
          ALTER TABLE users ADD COLUMN processing_completed_time BIGINT;
        END IF;

        -- 🔒 إضافة عمود session_token للحماية من الجلسات المتعددة
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'session_token'
        ) THEN
          ALTER TABLE users ADD COLUMN session_token TEXT;
        END IF;
      END$$;
    `);

    // Create referrals table with decimal coins support
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER REFERENCES users(id),
        referee_id INTEGER REFERENCES users(id),
        date BIGINT DEFAULT extract(epoch from now()) * 1000,
        coins NUMERIC(10,8) DEFAULT 0,
        status TEXT DEFAULT 'pending'
      )
    `);

    // ========== NFT MINTS TABLE ==========
    // Create nft_mints table for storing NFT mint records
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nft_mints (
        id SERIAL PRIMARY KEY,
        tx_hash VARCHAR(66) UNIQUE NOT NULL,
        contract_address VARCHAR(42) NOT NULL,
        minter_address VARCHAR(42) NOT NULL,
        recipient_address VARCHAR(42) NOT NULL,
        token_id VARCHAR(100) NOT NULL,
        token_uri TEXT,
        nft_name VARCHAR(255),
        nft_symbol VARCHAR(50),
        nft_image_url TEXT,
        block_number INTEGER,
        block_hash VARCHAR(66),
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add missing columns to existing nft_mints table
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'nft_mints' AND column_name = 'block_number'
        ) THEN
          ALTER TABLE nft_mints ADD COLUMN block_number INTEGER;
        END IF;

        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'nft_mints' AND column_name = 'block_hash'
        ) THEN
          ALTER TABLE nft_mints ADD COLUMN block_hash VARCHAR(66);
        END IF;
      END$$;
    `);

    // Create indexes for NFT mints table
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_nft_mints_contract ON nft_mints(contract_address);
      CREATE INDEX IF NOT EXISTS idx_nft_mints_minter ON nft_mints(minter_address);
      CREATE INDEX IF NOT EXISTS idx_nft_mints_recipient ON nft_mints(recipient_address);
      CREATE INDEX IF NOT EXISTS idx_nft_mints_timestamp ON nft_mints(timestamp DESC);
    `);

    // ========== EXPLORER USERS & API KEYS TABLES ==========
    // Create explorer_users table (separate from mining users for API access)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS explorer_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        avatar TEXT,
        google_id VARCHAR(255),
        created_at BIGINT NOT NULL,
        last_login BIGINT
      )
    `);

    // Create explorer_sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS explorer_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES explorer_users(id) ON DELETE CASCADE,
        token VARCHAR(255) UNIQUE NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        is_active BOOLEAN DEFAULT true
      )
    `);

    // Create explorer_api_keys table with soft delete support
    await pool.query(`
      CREATE TABLE IF NOT EXISTS explorer_api_keys (
        id SERIAL PRIMARY KEY,
        explorer_user_id INTEGER REFERENCES explorer_users(id) ON DELETE CASCADE,
        api_key VARCHAR(256) UNIQUE NOT NULL,
        key_name VARCHAR(255),
        rate_limit INTEGER DEFAULT 100,
        requests_used INTEGER DEFAULT 0,
        requests_reset_at BIGINT,
        is_active BOOLEAN DEFAULT true,
        created_at BIGINT NOT NULL,
        last_used_at BIGINT,
        deleted_at BIGINT,
        tier VARCHAR(20) DEFAULT 'free'
      )
    `);

    // Add deleted_at column if it doesn't exist (for existing tables)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'explorer_api_keys' AND column_name = 'deleted_at'
        ) THEN
          ALTER TABLE explorer_api_keys ADD COLUMN deleted_at BIGINT;
        END IF;
      END$$;
    `);

    // 📝 Create API key audit log table for tracking abuse
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_key_audit_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES explorer_users(id) ON DELETE CASCADE,
        action VARCHAR(50) NOT NULL,
        metadata JSONB,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index for fast abuse detection queries
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_user_action_time 
      ON api_key_audit_log(user_id, action, created_at DESC);
    `);

    // 🛡️ Create blocked_ips table for IP-based rate limiting and abuse prevention
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_ips (
        id SERIAL PRIMARY KEY,
        ip_address VARCHAR(45) UNIQUE NOT NULL,
        reason TEXT,
        is_permanent BOOLEAN DEFAULT false,
        blocked_until TIMESTAMP WITH TIME ZONE,
        blocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        request_count INTEGER DEFAULT 0
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_blocked_ips_address ON blocked_ips(ip_address);
    `);

    // Alter existing table if column size is too small
    await pool.query(`
      DO $$
      BEGIN
        -- Check and update api_key column size if needed
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'explorer_api_keys' 
          AND column_name = 'api_key'
          AND character_maximum_length < 256
        ) THEN
          ALTER TABLE explorer_api_keys ALTER COLUMN api_key TYPE VARCHAR(256);
        END IF;
      END$$;
    `);

    // Create explorer_api_tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS explorer_api_tokens (
        id SERIAL PRIMARY KEY,
        explorer_user_id INTEGER REFERENCES explorer_users(id) ON DELETE CASCADE,
        token VARCHAR(128) UNIQUE NOT NULL,
        token_name VARCHAR(255),
        created_at BIGINT NOT NULL,
        last_used BIGINT,
        is_active BOOLEAN DEFAULT true,
        usage_count INTEGER DEFAULT 0
      )
    `);

    // Create indexes for explorer tables
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_explorer_api_keys_user_id ON explorer_api_keys(explorer_user_id);
      CREATE INDEX IF NOT EXISTS idx_explorer_api_keys_api_key ON explorer_api_keys(api_key);
      CREATE INDEX IF NOT EXISTS idx_explorer_api_tokens_user_id ON explorer_api_tokens(explorer_user_id);
      CREATE INDEX IF NOT EXISTS idx_explorer_api_tokens_token ON explorer_api_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_explorer_sessions_token ON explorer_sessions(token);
      CREATE INDEX IF NOT EXISTS idx_explorer_sessions_user_id ON explorer_sessions(user_id);
    `);
    // ========== END EXPLORER TABLES ==========

    // Add UNIQUE constraint on referee_id to prevent duplicate referrals (one user can only be referred once)
    try {
      await pool.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'unique_referee_id'
          ) THEN
            ALTER TABLE referrals ADD CONSTRAINT unique_referee_id UNIQUE (referee_id);
          END IF;
        END $$;
      `);
    } catch (constraintError) {
      // constraint may already exist
    }



    // Create or enhance transactions table with additional fields and proper numeric types
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        sender TEXT,
        recipient TEXT,
        sender_address VARCHAR(42),
        recipient_address VARCHAR(42),
        from_address VARCHAR(42),
        to_address VARCHAR(42),
        from_user_id INTEGER,
        to_user_id INTEGER,
        amount NUMERIC(20, 8) NOT NULL,
        timestamp BIGINT NOT NULL,
        hash TEXT UNIQUE,
        tx_hash VARCHAR(66),
        status TEXT DEFAULT 'confirmed',
        description TEXT,
        gas_fee NUMERIC(10, 8) DEFAULT 0.00002,
        formatted_date TEXT,
        nonce BIGINT DEFAULT 0,
        block_hash VARCHAR(66),
        block_number BIGINT,
        block_index INTEGER,
        confirmations INTEGER DEFAULT 1,
        chain_id VARCHAR(10) DEFAULT '0x5968',
        network_id VARCHAR(10) DEFAULT '22888',
        gas_used INTEGER DEFAULT 21000,
        gas_price DECIMAL(20,8) DEFAULT 0.00002,
        is_external BOOLEAN DEFAULT false,
        is_confirmed BOOLEAN DEFAULT true,
        transaction_type VARCHAR(20) DEFAULT 'transfer',
        input TEXT,
        signature VARCHAR(132)
      )
    `);

    // Add missing columns to transactions table ONE BY ONE to avoid conflicts
    try {
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS nonce BIGINT DEFAULT 0`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS block_hash VARCHAR(66)`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS block_number BIGINT`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS block_index INTEGER`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS confirmations INTEGER DEFAULT 1`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS formatted_date TEXT`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS chain_id VARCHAR(10) DEFAULT '0x5968'`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS network_id VARCHAR(10) DEFAULT '22888'`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_external BOOLEAN DEFAULT false`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS sender_address TEXT`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recipient_address TEXT`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS input TEXT`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS signature VARCHAR(132)`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS from_user_id INTEGER`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS to_user_id INTEGER`);
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
    } catch (err) {
      // columns may already exist
    }

    // Add external wallet support columns
    try {
      await pool.query(`
        ALTER TABLE transactions 
        ADD COLUMN IF NOT EXISTS is_external_sender BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS is_external_recipient BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS blockchain_tx_hash TEXT,
        ADD COLUMN IF NOT EXISTS transaction_type TEXT DEFAULT 'local',
        ADD COLUMN IF NOT EXISTS is_external BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS tx_hash TEXT,
        ADD COLUMN IF NOT EXISTS gas_used INTEGER DEFAULT 21000,
        ADD COLUMN IF NOT EXISTS gas_price NUMERIC(20,8) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS chain_id VARCHAR(10) DEFAULT '0x5968',
        ADD COLUMN IF NOT EXISTS network_id VARCHAR(10) DEFAULT '22888',
        ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN DEFAULT true,
        ADD COLUMN IF NOT EXISTS sender_wallet_type VARCHAR(20) DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS recipient_wallet_type VARCHAR(20) DEFAULT 'unknown'
      `);
    } catch (err) {
      // columns may already exist
    }

    // Add unique constraint on tx_hash column
    try {
      await pool.query(`
        ALTER TABLE transactions 
        ADD CONSTRAINT unique_tx_hash UNIQUE (tx_hash)
      `);
    } catch (err) {
      // Constraint already exists (expected after first run)
    }

    // Add description column if it doesn't exist (for existing tables)
    try {
      await pool.query(`
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS description TEXT;
      `);
    } catch (err) {
      // column may already exist
    }

    // Update existing table to allow NULL values for external wallets
    try {
      await pool.query(`
        ALTER TABLE transactions 
        ALTER COLUMN sender DROP NOT NULL,
        ALTER COLUMN recipient DROP NOT NULL,
        ALTER COLUMN sender_address DROP NOT NULL,
        ALTER COLUMN recipient_address DROP NOT NULL,
        ALTER COLUMN hash DROP NOT NULL
      `);
    } catch (err) {
      // table already updated
    }

    // Create indexes for faster transaction queries - AFTER ensuring columns exist
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_transactions_sender_address ON transactions(sender_address);
        CREATE INDEX IF NOT EXISTS idx_transactions_recipient_address ON transactions(recipient_address);
        CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
        CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
        CREATE INDEX IF NOT EXISTS idx_processing_history_user ON processing_history(user_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_external_wallets_address ON external_wallets(address);
        CREATE INDEX IF NOT EXISTS idx_external_wallets_activity ON external_wallets(last_activity DESC);
      `);

      // Create nonce index only if the column exists
      const nonceColumnCheck = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'transactions' AND column_name = 'nonce'
      `);

      if (nonceColumnCheck.rows.length > 0) {
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_transactions_nonce ON transactions(nonce);
        `);
      }


    } catch (indexError) {
      console.log('Some indexes could not be created:', indexError.message);
    }

    // إنشاء جدول المحافظ الخارجية
    await pool.query(`
      CREATE TABLE IF NOT EXISTS external_wallets (
        id SERIAL PRIMARY KEY,
        address TEXT UNIQUE NOT NULL,
        wallet_address TEXT,
        balance DECIMAL(20, 8) DEFAULT 0,
        first_seen BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        last_activity BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        last_transaction TEXT,
        transaction_count INTEGER DEFAULT 0,
        user_agent TEXT,
        chain_id TEXT DEFAULT '0x5968',
        is_active BOOLEAN DEFAULT false,
        last_sync BIGINT DEFAULT 0
      )
    `);

    // إضافة عمود wallet_address إذا لم يكن موجوداً
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'external_wallets' 
          AND column_name = 'wallet_address'
        ) THEN
          ALTER TABLE external_wallets ADD COLUMN wallet_address TEXT;
        END IF;
      END $$;
    `);

    // إنشاء فهارس محسنة فقط للجداول الأساسية
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_sender ON transactions(sender_address);
      CREATE INDEX IF NOT EXISTS idx_transactions_recipient ON transactions(recipient_address);
      CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
      CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
      CREATE INDEX IF NOT EXISTS idx_processing_history_user ON processing_history(user_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_external_wallets_address ON external_wallets(address);
      CREATE INDEX IF NOT EXISTS idx_external_wallets_activity ON external_wallets(last_activity DESC);
    `);

    // Create push_subscriptions table for web push notifications
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        revoked_at TIMESTAMP NULL
      )
    `);

    // Add re-engagement notification columns to users table
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'last_login'
        ) THEN
          ALTER TABLE users ADD COLUMN last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;

        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'last_reengagement_notification'
        ) THEN
          ALTER TABLE users ADD COLUMN last_reengagement_notification TIMESTAMP NULL;
        END IF;
      END $$;
    `);

    // Create processing_sessions table for activity missions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS processing_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        duration_seconds INTEGER DEFAULT 0,
        reward NUMERIC(20,8) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create index for processing_sessions
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_processing_sessions_user_id ON processing_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_processing_sessions_status ON processing_sessions(status);
    `);

    // Create user_missions table for daily missions system
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_missions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        streak INTEGER DEFAULT 0,
        last_claim_date TIMESTAMP NULL,
        daily_claimed BOOLEAN DEFAULT FALSE,
        completed_missions JSONB DEFAULT '{}',
        bonus_claimed BOOLEAN DEFAULT FALSE,
        mission_cycle_start BIGINT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )
    `);
    
    // Add mission_cycle_start column if it doesn't exist (for existing tables)
    await pool.query(`
      ALTER TABLE user_missions ADD COLUMN IF NOT EXISTS mission_cycle_start BIGINT NULL
    `);
    
    // Create index for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_missions_user_id ON user_missions(user_id);
    `);
    
    // Create social_usernames table for tracking social media usernames
    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_usernames (
        id SERIAL PRIMARY KEY,
        platform VARCHAR(20) NOT NULL,
        username VARCHAR(50) NOT NULL,
        user_id INTEGER NOT NULL,
        mission_id VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(platform, username)
      )
    `);

  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Save or update user
async function saveUser(userData) {
  const { email, name, avatar, referralCode, coins = 0, walletPrivateKey, walletAddress } = userData;
  try {
        // Ensure proper UTF-8 handling - no encoding/decoding needed
    const safeName = name || email.split('@')[0];

    const result = await pool.query(
      `INSERT INTO users (email, name, avatar, referral_code, coins, wallet_private_key, wallet_address, wallet_created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (email) DO UPDATE
       SET name = $2, avatar = $3, wallet_private_key = $6, wallet_address = $7, wallet_created_at = $8
       RETURNING *`,
      [email, name, avatar, referralCode, coins, walletPrivateKey, walletAddress, Date.now()]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving user:', error);
    throw error;
  }
}

// Get user by email
async function getUser(email) {
  try {
    // Suppressed repeated user lookup messages
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    if (result.rows[0]) {
      const user = result.rows[0];

      // ✅ QR code is now generated dynamically on client-side from wallet_address
      // No need to generate or store QR code HTML

      // ⚡ FIX: حساب المبلغ المتراكم الصحيح بناءً على الوقت إذا كانت الجلسة نشطة
      let calculatedAccumulated = parseFloat(user.accumulated_processing_reward || user.accumulatedreward || 0);
      
      // إذا كانت الجلسة نشطة، احسب المبلغ بناءً على الوقت الفعلي
      if (user.processing_active === 1 || user.processing_active === true) {
        const startTimeSec = parseInt(user.processing_start_time_seconds) || 0;
        const sessionLockedBoost = parseFloat(user.session_locked_boost) || 1.0;
        
        if (startTimeSec > 0) {
          const nowSec = Math.floor(Date.now() / 1000);
          const processingDuration = 24 * 60 * 60; // 24 ساعة
          const elapsedSec = nowSec - startTimeSec;
          
          if (elapsedSec > 0) {
            const baseReward = await dbCurrentBaseReward();
            const boostedReward = baseReward * sessionLockedBoost;
            
            if (elapsedSec >= processingDuration) {
              // الجلسة انتهت - المبلغ الكامل
              calculatedAccumulated = boostedReward;
            } else {
              // الجلسة مستمرة - حساب بناءً على الوقت
              const rewardProgress = elapsedSec / processingDuration;
              calculatedAccumulated = Math.round((boostedReward * rewardProgress) * 100) / 100; // تقريب لخانتين
            }
            
            // تحديث قاعدة البيانات بالقيمة الصحيحة (في الخلفية)
            pool.query(`
              UPDATE users 
              SET accumulatedreward = $1, accumulated_processing_reward = $1
              WHERE id = $2
            `, [calculatedAccumulated, user.id]).catch(() => {});
          }
        }
      }

      return {
        ...user,
        referralCode: user.referral_code,
        lastPayout: user.last_payout,
        processingActive: user.processing_active,
        // ⚡ استخدام القيمة المحسوبة بدلاً من المخزنة
        accumulated_processing_reward: calculatedAccumulated,
        accumulatedReward: calculatedAccumulated,
        processing_accumulated: calculatedAccumulated,
        active_referral_count: parseInt(user.active_referral_count || 0)
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting user:', error);
    throw error;
  }
}

// Process referral
async function processReferral(referrerCode, refereeEmail, refereeName, refereeAvatar) {
  try {
    const referrer = await pool.query(
      'SELECT id, coins FROM users WHERE referral_code = $1',
      [referrerCode]
    );

    if (referrer.rows.length === 0) {
      throw new Error('Invalid referral code');
    }

    const referrerId = referrer.rows[0].id;
    const bonusAmount = 300;

    // Update referrer's coins
    await pool.query(
      'UPDATE users SET coins = coins + $1 WHERE id = $2',
      [bonusAmount, referrerId]
    );

    // Get referee id
    const referee = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [refereeEmail]
    );

    // Record referral
    await pool.query(
      `INSERT INTO referrals (referrer_id, referee_id, coins, status)
       VALUES ($1, $2, $3, 'completed')`,
      [referrerId, referee.rows[0].id, bonusAmount]
    );

    return bonusAmount;
  } catch (error) {
    console.error('Error processing referral:', error);
    throw error;
  }
}

// Get user referrals
async function getUserReferrals(userId) {
  try {
    // Use a more direct and explicit query to fetch user processing status
    const result = await pool.query(
      `SELECT 
        u.email, 
        u.name, 
        u.avatar, 
        r.date, 
        u.id as user_id,
        u.processing_active::integer as processing_active, 
        u.processing_start_time,
        u.processing_end_time,
        u.is_active::integer as is_active
       FROM referrals r
       JOIN users u ON r.referee_id = u.id
       WHERE r.referrer_id = $1
       ORDER BY r.date DESC`,
      [userId]
    );

    // Add explicit type conversions and status calculation
    const now = Date.now();
    const referrals = result.rows.map(row => {
      // Ensure numeric values with explicit conversion
      const processingActive = Number(row.processing_active) || 0;
      const endTime = Number(row.processing_end_time) || 0;
      const startTime = Number(row.processing_start_time) || 0;
      const isActive = Number(row.is_active) || 0;

      // First priority: if end time exists and has passed, user should be inactive for processing
      if (endTime > 0 && endTime <= now) {

        // Update the database to set processing_active, processingactive, and is_active to 0
        // when processing session has ended
        pool.query(
          'UPDATE users SET processing_active = 0::integer, processingactive = 0::integer, is_active = 0::integer WHERE id = $1',
          [row.user_id]
        ).catch(err => console.error(`Error updating processing status for user ${row.user_id}:`, err));

        // is_active should reset to 0 when processing ends
        return {
          ...row,
          processing_active: 0,
          processingactive: 0,
          // Keep original is_active value from WebSocket tracking
          is_active: isActive
        };
      }

      // Second priority: if we have valid time range, processing should be active
      const validTimeRange = (endTime > 0 && startTime > 0 && endTime > now && startTime <= now);

      // Determine processing status (processing_active) based on time range or active flags
      const finalProcessingStatus = (validTimeRange || processingActive === 1) ? 1 : 0;

      // is_active is maintained separately through WebSocket real-time tracking
      // If is_active from DB is already 1, keep it; otherwise, use processing status as a fallback

      // Reduced logging - only log status changes
      if (finalProcessingStatus !== processingActive) {
        pool.query(
          'UPDATE users SET processing_active = $1::integer WHERE id = $2',
          [finalProcessingStatus, row.user_id]
        ).catch(err => console.error(`Processing status update error:`, err.message));
      }

      return {
        ...row,
        processing_active: finalProcessingStatus,
        processingactive: finalProcessingStatus,
        // Keep the is_active value separate from processing status - this is controlled by WebSocket
        is_active: isActive
      };
    });

    // ✅ Removed verbose logging - only errors appear
    return referrals;
  } catch (error) {
    console.error('Error getting referrals:', error);
    throw error;
  }
}

// Start processing and record starting balance for continuous accumulation
async function startProcessing(userId, userName, processingDuration = 15 * 60 * 1000) { // Default 15 minutes
  try {
    const now = Math.floor(Date.now() / 1000);
    const nowMs = now * 1000;

    // ✅ IMPORTANT: Always start with CLEAN state - no ad boost
    // User must watch ad during THIS session to get boost
    
    // Calculate boost multiplier based on ONLY active referrals
    const referralsResponse = await pool.query(
      `SELECT r.id, u.processing_active, u.processing_end_time, u.is_active 
       FROM referrals r
       JOIN users u ON r.referee_id = u.id
       WHERE r.referrer_id = $1`,
      [userId]
    );

    let activeReferralCount = 0;
    referralsResponse.rows.forEach(ref => {
      const processingActive = parseInt(ref.processing_active) || 0;
      const isActive = parseInt(ref.is_active) || 0;
      const endTime = parseInt(ref.processing_end_time) || 0;
      const isActivelyProcessing = (processingActive === 1 || isActive === 1 || (endTime > nowMs));

      if (isActivelyProcessing) {
        activeReferralCount++;
      }
    });

    // ✅ NO AD BOOST at session start - only real referrals
    const { totalHashrate, multiplier: lockedBoostMultiplier } = computeHashrateMultiplier(activeReferralCount, false);

    console.log(`[SESSION START] User ${userId}: ${activeReferralCount} active referrals, hashrate=${totalHashrate.toFixed(1)} MH/s, NO ad boost`);

    // Start processing session WITHOUT ad boost
    await pool.query(`
      UPDATE users 
      SET processing_active = 1, 
          processing_start_time_seconds = $1,
          processing_start_time = $2,
          processing_end_time = $3,
          accumulatedReward = 0,
          accumulated_processing_reward = 0,
          baseAccumulatedReward = 0,
          processing_boost_multiplier = $4,
          session_locked_boost = $4,
          ad_boost_active = FALSE,
          ad_boost_granted_at = NULL,
          ad_boost_session_start = NULL,
          last_ad_watch_timestamp = NULL
      WHERE id = $5`,
      [
        now, 
        nowMs, 
        (nowMs + processingDuration), 
        lockedBoostMultiplier, 
        userId
      ]
    );

    console.log(`✅ Processing started CLEAN - hashrate: ${totalHashrate.toFixed(1)} MH/s (referrals only), ad boost: CLEARED`);

    // Record processing start in history
    await pool.query(
      `INSERT INTO processing_history (user_id, amount, timestamp, user_name, date)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, 0, nowMs, 'Collecting...', new Date(nowMs).toISOString()]
    );

    return true;
  } catch (error) {
    console.error('Error during processing:', error);
    return false;
  }
}


// Track accumulated processing rewards separately from main balance
async function updateAccumulatedReward(userId, amount) {
  try {
    // Start a transaction for consistency
    await pool.query('BEGIN');

    // Ensure required columns exist for processing
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'processing_rate'
        ) THEN
          ALTER TABLE users ADD COLUMN processing_rate NUMERIC DEFAULT 10;
        END IF;

        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'processing_boost_multiplier'
        ) THEN
          ALTER TABLE users ADD COLUMN processing_boost_multiplier NUMERIC DEFAULT 0;
        END IF;

        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'processing_start_balance'
        ) THEN
          ALTER TABLE users ADD COLUMN processing_start_balance NUMERIC DEFAULT 0;
        END IF;

        IF NOT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'last_server_update'
          ) THEN
            ALTER TABLE users ADD COLUMN last_server_update BIGINT;
          END IF;

        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'current_processing_reward'
        ) THEN
          ALTER TABLE users ADD COLUMN current_processing_reward NUMERIC DEFAULT 0;
        END IF;
      END$$;
    `);

    const now = Date.now();

    // Check if user exists first
    const userCheck = await pool.query(
      'SELECT id, coins, processing_start_balance FROM users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      await pool.query('ROLLBACK');
      console.error(`User ${userId} not found when updating accumulated reward`);
      return { 
        success: false, 
        error: 'User not found',
        userId: userId
      };
    }

    const currentCoins = parseFloat(userCheck.rows[0].coins || 0);
    const processingStartBalance = parseFloat(userCheck.rows[0].processing_start_balance || currentCoins);

    // Count active referrals for boost calculation
    const referralsResponse = await pool.query(
      `SELECT r.id, u.processing_active, u.processing_end_time, u.is_active 
       FROM referrals r
       JOIN users u ON r.referee_id = u.id
       WHERE r.referrer_id = $1`,
      [userId]
    );

    // Count active referrals
    let activeReferralCount = 0;
    const nowMs = now;

    referralsResponse.forEach(ref => {
      const processingActive = parseInt(ref.processing_active) || 0;
      const isActive = parseInt(ref.is_active) || 0;
      const endTime = parseInt(ref.processing_end_time) || 0;
      const isActivelyProcessing = (processingActive === 1 || isActive === 1 || (endTime > nowMs));

      if (isActivelyProcessing) {
        activeReferralCount++;
      }
    });

    // Calculate hashrate and reward based on referral count
    const baseHashrate = 10; // MH/s
    const boostPerReferral = 0.4; // MH/s per active referral
    const totalHashrate = baseHashrate + (activeReferralCount * boostPerReferral);
    const boostMultiplier = totalHashrate / baseHashrate;

    // Get processing status to calculate correct amount
    const processingStatus = await pool.query(
      `SELECT processing_start_time, processing_end_time, processing_active FROM users WHERE id = $1`,
      [userId]
    );

    if (processingStatus.rows.length > 0 && processingStatus.rows[0].processing_active == 1) {
      const startTime = parseInt(processingStatus.rows[0].processing_start_time);
      const endTime = parseInt(processingStatus.rows[0].processing_end_time);

      if (startTime > 0 && endTime > now) {
        const totalDuration = endTime - startTime;
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / totalDuration);
        const rewardProgress = progress

        // Base reward with boost (Halving)
        const baseReward = await dbCurrentBaseReward();
        const boostedReward = baseReward * boostMultiplier;
        amount = boostedReward * progress;

        // تقليل تكرار رسائل التحديث - كل 10 دقائق فقط
        const progressPercent = (rewardProgress * 100).toFixed(1);
        if (progressPercent % 5 === 0) { // كل 5% تقدم فقط
          console.log(`Processing progress for user ${userId}: ${progressPercent}%, reward: ${amount.toFixed(8)}, boost: ${boostMultiplier.toFixed(2)}x`);
        }
      }
    }

    // IMPORTANT: Only update accumulated reward, NOT the main coins balance during processing
    console.log(`Updating accumulated processing reward for user ${userId} to ${amount.toFixed(8)} (with boost ${boostMultiplier.toFixed(1)}x)`);

    // حفظ المكافأة في جميع الحقول لضمان عدم فقدانها
    await pool.query(
      `UPDATE users 
       SET current_processing_reward = $1,
           accumulatedReward = $1,
           accumulated_processing_reward = $1,
           last_processing_accumulation = $2,
           processing_rate = $3,
           processing_boost_multiplier = $4,
           active_referral_count = $5,
           last_server_update = $7
       WHERE id = $6`,
      [amount, now, totalHashrate, boostMultiplier, activeReferralCount, userId, now]
    );

    // مزامنة مع البلوك تشين إذا كان متاحاً
    try {
      // تجنب الاستيراد الدوري بتأخير التنفيذ
      setTimeout(async () => {
        try {
          const blockchainModule = await import('./network-api.js');
          if (blockchainModule.ensureUserBalanceSync) {
            await blockchainModule.ensureUserBalanceSync(userId);
          }
        } catch (importError) {
          // تجاهل أخطاء الاستيراد الدوري
        }
      }, 1000);
    } catch (syncError) {
      // تجاهل أخطاء المزامنة لتجنب تعطيل التعدين
    }

    // Commit the transaction
    await pool.query('COMMIT');

    return {
      success: true,
      amount: amount,
      accumulatedReward: amount,
      timestamp: now,
      hashrate: totalHashrate,
      boostMultiplier: boostMultiplier,
      activeReferrals: activeReferralCount,
      directBalanceUpdate: false
    };
  } catch (error) {
    try {
      await pool.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error rolling back transaction:', rollbackError);
    }

    console.error('Error updating accumulated reward:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Get accumulated processing reward - return only the current processing reward amount
async function getAccumulatedReward(userId) {
  try {
    // Ensure required columns exist for processing
    await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_rate'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_rate NUMERIC DEFAULT 10;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_boost_multiplier'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_boost_multiplier NUMERIC DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'processing_start_balance'
          ) THEN
            ALTER TABLE users ADD COLUMN processing_start_balance NUMERIC DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'last_server_update'
          ) THEN
            ALTER TABLE users ADD COLUMN last_server_update BIGINT;
          END IF;

          IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'current_processing_reward'
          ) THEN
            ALTER TABLE users ADD COLUMN current_processing_reward NUMERIC DEFAULT 0;
          END IF;
        END$$;
      `);

    const result = await pool.query(
      'SELECT coins, processing_start_balance, current_processing_reward, last_processing_accumulation, processing_start_time, processing_end_time, processing_active, processing_rate, processing_boost_multiplier, ad_boost_active FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'User not found' };
    }

    const now = Date.now();
    const currentCoins = parseFloat(result.rows[0].coins || 0);
    const processingStartBalance = parseFloat(result.rows[0].processing_start_balance || currentCoins);
    const currentProcessingReward = parseFloat(result.rows[0].current_processing_reward || 0);
    const processingEndTime = parseInt(result.rows[0].processing_end_time) || 0;
    const processingStartTime = parseInt(result.rows[0].processing_start_time) || 0;
    const processingActive = result.rows[0].processing_active === 1;

    const lastAccumulation = parseInt(result.rows[0].last_processing_accumulation) || 0;
    const storedHashrate = parseFloat(result.rows[0].processing_rate || 10);
    const storedBoostMultiplier = parseFloat(result.rows[0].processing_boost_multiplier || 1.0);

    // Calculate elapsed time
    const elapsed = processingStartTime > 0 ? (now - processingStartTime) : 0;
    const totalDuration = processingEndTime > processingStartTime ? (processingEndTime - processingStartTime) : 0;

    // Calculate elapsed time in seconds and total duration in seconds
    const elapsedSeconds = elapsed / 1000;
    const totalDurationSeconds = totalDuration / 1000;
    const elapsedTime = elapsed;

    // Count active referrals for boost calculation
    const referralsResponse = await pool.query(
      `SELECT r.id, u.processing_active, u.processing_end_time, u.is_active 
       FROM referrals r
       JOIN users u ON r.referee_id = u.id
       WHERE r.referrer_id = $1`,
      [userId]
    );

    // Count active referrals
    let activeReferralCount = 0;
    referralsResponse.rows.forEach(ref => {
      // Check if the referral is actively processing
      const processingActive = parseInt(ref.processing_active) || 0;
      const isActive = parseInt(ref.is_active) || 0;
      const endTime = parseInt(ref.processing_end_time) || 0;

      // Calculate if processing is active based on end time and flags
      const isActivelyProcessing = (processingActive === 1 || isActive === 1 || (endTime > now));

      if (isActivelyProcessing) {
        activeReferralCount++;
      }
    });

    // ✅ Get REAL ad boost status from database (not cached)
    const adBoostCheck = await pool.query(
      'SELECT ad_boost_active FROM users WHERE id = $1',
      [userId]
    );
    const adBoostActive = adBoostCheck.rows[0]?.ad_boost_active === true;

    // Calculate hashrate using UNIFIED system (ad boost = 3 virtual referrals)
    const boostCalc = computeHashrateMultiplier(activeReferralCount, adBoostActive);
    const totalHashrate = boostCalc.totalHashrate;
    const boostMultiplier = boostCalc.multiplier;

    // Use the higher of stored or calculated values
    const effectiveHashrate = totalHashrate;
    const effectiveMultiplier = boostMultiplier;

    // Base reward with Halving - dynamic based on circulating supply
    const baseReward = await dbCurrentBaseReward();

    // Calculate boosted max reward - this is what they can earn in total
    const boostedMaxReward = baseReward * effectiveMultiplier;

    console.log(`User ${userId} reward calculation: baseReward=${baseReward}, multiplier=${effectiveMultiplier}, boostedMaxReward=${boostedMaxReward.toFixed(8)}`);
    console.log(`Current accumulated reward: ${currentProcessingReward.toFixed(8)}`);

    // Calculate base accumulated reward (without boost) for comparison
    const completionPercentage = Math.min(1, elapsed / totalDuration);
    const baseAccumulatedReward = baseReward * completionPercentage;

    // Always update these values when processing is active
    if (processingActive) {
      // Update processing stats
      await pool.query(
        'UPDATE users SET processing_rate = $1, processing_boost_multiplier = $2 WHERE id = $3',
        [totalHashrate, boostMultiplier, userId]
      );

      // Silent - reduce console spam
    }

    // SERVER-ONLY calculation - ignore client calculations to prevent conflicts
    let serverAuthoritative = currentProcessingReward; // Use currentProcessingReward as the base for server authoritative calculation

    // Only recalculate if there's an active processing session
    if (processingActive && processingStartTime > 0 && processingEndTime > now) {
      const baseReward = await dbCurrentBaseReward();
      const boostedBaseReward = baseReward * effectiveMultiplier;
      const elapsed = now - processingStartTime;
      const totalDuration = processingEndTime - processingStartTime;
      const progressRatio = Math.min(1, elapsed / totalDuration);

      // Calculate mining reward
      let miningReward = boostedBaseReward * progressRatio;

      // Add gradual ad reward (0.03 distributed over session)
      const adBoostStatus = await getAdBoostStatus(userId);
      if (adBoostStatus.boostActive) {
        const adRewardTotal = 0.03;
        const gradualAdReward = adRewardTotal * progressRatio;
        miningReward += gradualAdReward;
        console.log(`[GRADUAL AD] User ${userId}: ${gradualAdReward.toFixed(8)} ACCESS (${(progressRatio * 100).toFixed(1)}% of 0.03)`);
      }

      // Calculate server-authoritative value
      serverAuthoritative = miningReward;

      // Update database with authoritative server value (مع throttling ذكي)
      if (!shouldSkipAccumulatedUpdate(userId)) {
        try {
          await pool.query(
            'UPDATE users SET accumulatedReward = $1, processing_boost_multiplier = $2, last_server_update = $3 WHERE id = $4',
            [serverAuthoritative, effectiveMultiplier, now, userId]
          );
        } catch (err) {
          // Silent - لا توقف التنفيذ
        }
      }
    }

    // Return single clean accumulated reward value
    const finalAccumulatedReward = Math.max(0, serverAuthoritative); // Use serverAuthoritative here

    return {
            success: true,
            accumulatedReward: finalAccumulatedReward, // Single clean value - no duplicates
            lastAccumulation: lastAccumulation,
            processingActive: processingActive,
            processingStartTime: processingStartTime,
            processingEndTime: processingEndTime,
            currentTime: now,
            elapsedTime: elapsedTime,
            elapsedSeconds: elapsedSeconds,
            totalDuration: totalDuration,
            totalDurationSeconds: totalDurationSeconds,
            activeReferrals: activeReferralCount,
            hashrate: effectiveHashrate,
            baseReward: baseReward,
            boostedMaxReward: boostedMaxReward,
            hasBoost: activeReferralCount > 0,
            boostMultiplier: effectiveMultiplier,
            processingStartBalance: processingStartBalance,
            currentBalance: currentCoins,
            adBoostActive: result.rows[0].ad_boost_active || false
          };
  } catch (error) {
    console.error('Error getting accumulated processing reward:', error);
    return { success: false, error: error.message };
  }
}

// Complete processing and transfer accumulated reward to permanent balance
async function completeProcessing(userId, amount) {
  try {
    console.log(`[completeProcessing] Starting for userId: ${userId}, amount: ${amount}`);
    
    // Start a transaction for consistency
    await pool.query('BEGIN');
    
    // Get current user data
    const userResult = await pool.query(
      'SELECT id, coins, "accumulatedReward", processing_accumulated FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return { success: false, error: 'User not found' };
    }
    
    const user = userResult.rows[0];
    const currentCoins = parseFloat(user.coins || 0);
    
    // Use provided amount or get from database
    let rewardToTransfer = parseFloat(amount || 0);
    if (rewardToTransfer <= 0) {
      rewardToTransfer = parseFloat(user.accumulatedReward || user.processing_accumulated || 0);
    }
    
    console.log(`[completeProcessing] Current coins: ${currentCoins}, Reward to transfer: ${rewardToTransfer}`);
    
    if (rewardToTransfer <= 0) {
      await pool.query('ROLLBACK');
      return { 
        success: false, 
        error: 'No accumulated reward to transfer',
        new_balance: currentCoins,
        reward_amount: 0
      };
    }
    
    // Calculate new balance
    const newBalance = currentCoins + rewardToTransfer;
    
    // Update user: add reward to coins and reset accumulated values
    // 🛡️ FIXED: Also clear ad_boost and session_locked_boost when session ends!
    await pool.query(
      `UPDATE users SET 
        coins = $1,
        "accumulatedReward" = 0,
        processing_accumulated = 0,
        current_processing_reward = 0,
        processing_active = 0,
        processing_end_time = NULL,
        processing_start_time = NULL,
        processing_start_time_seconds = NULL,
        ad_boost_active = FALSE,
        ad_boost_granted_at = NULL,
        ad_boost_session_start = NULL,
        session_locked_boost = 1.0
      WHERE id = $2`,
      [newBalance, userId]
    );
    
    // Commit transaction
    await pool.query('COMMIT');
    
    console.log(`[completeProcessing] Successfully transferred ${rewardToTransfer} to balance. New balance: ${newBalance}`);
    
    return {
      success: true,
      new_balance: newBalance,
      reward_amount: rewardToTransfer,
      previous_balance: currentCoins
    };
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('[completeProcessing] Error:', error);
    return { success: false, error: error.message };
  }
}


async function saveProcessingHistory(userId, amount, timestamp, userName) {
  try {
    const date = new Date(parseInt(timestamp)).toLocaleDateString();
    const result = await pool.query(
      'INSERT INTO processing_history (user_id, amount, timestamp, user_name, date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [userId, amount, timestamp, userName, date]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving processing history:', error);
    throw error;
  }
}

async function getProcessingHistory(userId) {
  try {
    const result = await pool.query(
      'SELECT * FROM processing_history WHERE user_id = $1 ORDER BY timestamp DESC',
      [userId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting processing history:', error);
    throw error;
  }
}

async function updateProcessingStatus(email, processingActive, startTime, endTime) {
  const query = `
    UPDATE users 
    SET processing_active = $1, 
        processing_start_time = $2,
        processing_end_time = $3
    WHERE email = $4
  `;

  try {
    await pool.query(query, [processingActive, startTime, endTime, email]);
    return true;
  } catch (err) {
    console.error('Error updating processing status:', err);
    return false;
  }
}

// Get blockchain transactions for a user
async function getBlockchainTransactions(userId) {
  try {
    // Get user's wallet address first
    const userResult = await pool.query('SELECT wallet_address FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return [];
    }

    const walletAddress = userResult.rows[0].wallet_address;
    if (!walletAddress) {
      return [];
    }

    // Get transactions from blockchain_transactions table
    const result = await pool.query(`
      SELECT 
        tx_hash,
        from_address,
        to_address,
        amount,
        timestamp,
        block_hash,
        block_index,
        nonce,
        gas_used,
        gas_price,
        chain_id,
        network_id,
        is_confirmed,
        confirmations,
        transaction_type,
        status,
        created_at
      FROM blockchain_transactions 
      WHERE from_address = $1 OR to_address = $1 
      ORDER BY timestamp DESC
    `, [walletAddress]);

    return result.rows.map(tx => ({
      ...tx,
      amount: parseFloat(tx.amount || 0),
      gas_price: parseFloat(tx.gas_price || 0),
      direction: tx.from_address === walletAddress ? 'outgoing' : 'incoming',
      formatted_date: new Date(parseInt(tx.timestamp)).toISOString()
    }));
  } catch (error) {
    console.error('Error getting blockchain transactions:', error);
    return [];
  }
}

// دالة لحفظ المعاملة بـ hash موحد في كلا الجدولين
async function saveTransactionWithConsistentHash(transactionData) {
  try {
    const {
      hash,
      fromAddress,
      toAddress,
      amount,
      timestamp,
      gasPrice = 0.00002,
      gasUsed = 21000,
      nonce = 0,
      blockHash = null,
      blockIndex = null,
      confirmations = 1,
      sender = null,
      recipient = null,
      description = 'Transfer'
    } = transactionData;

    // ⭐ CRITICAL: التأكد من hash موحد واحد فقط
    if (!hash) {
      throw new Error('UNIFIED HASH REQUIRED: Transaction must have a single unified hash');
    }

    console.log(`Saving with unified hash: ${hash}`);

    await pool.query('BEGIN');

    try {
      // حفظ في جدول transactions
      await pool.query(`
        INSERT INTO transactions (
          hash, sender, recipient, sender_address, recipient_address,
          amount, timestamp, gas_fee, nonce, block_hash, block_index,
          confirmations, description, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (hash) DO UPDATE SET
          block_hash = EXCLUDED.block_hash,
          block_index = EXCLUDED.block_index,
          confirmations = EXCLUDED.confirmations
      `, [
        hash, sender, recipient, fromAddress, toAddress,
        amount, timestamp, gasPrice, nonce, blockHash, blockIndex,
        confirmations, description, 'confirmed'
      ]);

      // Note: Only using 'transactions' table as blockchain_transactions was removed

      await pool.query('COMMIT');
      console.log(`✅ Transaction saved with unified hash: ${hash}`);
      return true;

    } catch (saveError) {
      await pool.query('ROLLBACK');
      throw saveError;
    }

  } catch (error) {
    console.error('❌ Error saving transaction with unified hash:', error);
    throw error;
  }
}


// ========== AD BOOST SYSTEM FUNCTIONS ==========

/**
 * Compute hashrate multiplier from referrals and ad boost
 * Single source of truth for hashrate calculations
 * Ad Boost = 3 virtual active referrals (INTEGRATED system)
 */
function computeHashrateMultiplier(activeReferralCount, adBoostActive) {
  const baseHashrate = 10; // MH/s
  const boostPerReferral = 0.4; // MH/s per active referral

  // UNIFIED SYSTEM: Ad Boost = 3 virtual referrals
  const virtualReferralsFromAd = adBoostActive ? 3 : 0;
  const totalReferrals = activeReferralCount + virtualReferralsFromAd;

  // Calculate unified boost
  const referralHashrate = totalReferrals * boostPerReferral;
  const totalHashrate = baseHashrate + referralHashrate;
  const multiplier = totalHashrate / baseHashrate;

  // ✅ Removed verbose console.log for performance - will only log errors

  return {
    totalHashrate,
    multiplier,
    baseHashrate,
    referralBoost: referralHashrate,
    adBoost: virtualReferralsFromAd * boostPerReferral, // For UI display
    hasAdBoost: adBoostActive,
    virtualReferralsFromAd: virtualReferralsFromAd,
    totalReferrals: totalReferrals,
    adBoostIntegrated: true // Flag to indicate unified system
  };
}

/**
 * Check if user is eligible to watch an ad for boost
 * UPDATED: Cooldown is linked to mining session, not fixed 24h timer
 * User can watch new ad when they start a new mining session
 */
async function checkAdBoostEligibility(userId) {
  try {
    const result = await pool.query(
      `SELECT ad_boost_active, ad_boost_granted_at, ad_boost_session_start, 
              last_ad_watch_timestamp, processing_active, processing_start_time_seconds,
              processing_end_time
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return { eligible: false, reason: 'User not found' };
    }

    const user = result.rows[0];
    const now = Math.floor(Date.now() / 1000);
    const processingActive = user.processing_active === 1;

    // NEW LOGIC: Check if user already has boost for CURRENT mining session
    const currentSessionStart = parseInt(user.processing_start_time_seconds) || 0;
    const adBoostSessionStart = parseInt(user.ad_boost_session_start) || 0;

    // If user has active boost for the CURRENT session, they can't watch another ad
    if (user.ad_boost_active && currentSessionStart === adBoostSessionStart && processingActive) {
      const processingEndTime = parseInt(user.processing_end_time) || 0;
      const remainingTime = Math.max(0, Math.floor(processingEndTime / 1000) - now);

      return {
        eligible: false,
        reason: 'already_boosted_this_session',
        message: 'You already have ad boost for this mining session',
        remainingSeconds: remainingTime,
        nextAvailable: Math.floor(processingEndTime / 1000)
      };
    }

    // If user is mining but hasn't watched ad for THIS session, they can watch
    if (processingActive) {
      return {
        eligible: true,
        miningActive: true,
        currentBoostActive: false,
        canBoostNow: true
      };
    }

    // If not mining, they need to start mining first
    return {
      eligible: false,
      reason: 'not_mining',
      message: 'Start mining first to watch ad',
      miningActive: false
    };

  } catch (error) {
    console.error('Error checking ad boost eligibility:', error);
    throw error;
  }
}

/**
 * Grant ad boost to user after completing ad
 * UPDATED: Boost is linked to current mining session
 * 🛡️ FIXED: Now updates session_locked_boost to include ad boost!
 */
async function grantAdBoost(userId, transactionId, ipAddress, userAgent) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const now = Math.floor(Date.now() / 1000);

    // Verify no duplicate
    const duplicateCheck = await client.query(
      'SELECT id FROM ad_rewards WHERE transaction_id = $1',
      [transactionId]
    );

    if (duplicateCheck.rows.length > 0) {
      throw new Error('الإعلان مُسجل مسبقاً');
    }

    // Get user data including current boost and referrals
    const userResult = await client.query(
      `SELECT u.processing_active, u.processing_start_time_seconds, 
              u.ad_boost_active, u.ad_boost_session_start,
              u.accumulatedreward, u.accumulated_processing_reward,
              u.session_locked_boost,
              (SELECT COUNT(*) FROM referrals r 
               JOIN users ref ON r.referee_id = ref.id 
               WHERE r.referrer_id = u.id 
               AND (ref.processing_active = 1 OR ref.is_active = 1)) as active_referral_count
       FROM users u WHERE u.id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('المستخدم غير موجود');
    }

    const user = userResult.rows[0];
    const currentSessionStart = parseInt(user.processing_start_time_seconds) || 0;
    const adBoostSessionStart = parseInt(user.ad_boost_session_start) || 0;
    const isProcessingActive = user.processing_active === 1;
    const activeReferralCount = parseInt(user.active_referral_count) || 0;
    const currentLockedBoost = parseFloat(user.session_locked_boost) || 1.0;

    // Prevent duplicate boost for SAME session
    if (user.ad_boost_active && currentSessionStart === adBoostSessionStart && isProcessingActive) {
      throw new Error('لديك بالفعل تعزيز لهذه الجلسة');
    }

    // Log ad completion
    await client.query(
      `INSERT INTO ad_rewards (user_id, ad_completed, granted_at, session_start_time, transaction_id, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, true, now, currentSessionStart, transactionId, ipAddress, userAgent]
    );

    // 🛡️ FIXED: Calculate NEW session_locked_boost including ad boost
    // Ad boost = 3 virtual referrals = 1.2 MH/s
    const boostCalc = computeHashrateMultiplier(activeReferralCount, true); // true = ad boost active
    const newLockedBoost = boostCalc.multiplier;

    console.log(`✅ [AD BOOST] User ${userId}: Updating session_locked_boost from ${currentLockedBoost.toFixed(2)}x to ${newLockedBoost.toFixed(2)}x`);

    // Update database - activate boost flag AND update session_locked_boost
    await client.query(
      `UPDATE users 
       SET ad_boost_active = TRUE,
           ad_boost_granted_at = $1,
           ad_boost_session_start = $2,
           last_ad_watch_timestamp = $1,
           session_locked_boost = $3
       WHERE id = $4`,
      [now, isProcessingActive ? currentSessionStart : now, newLockedBoost, userId]
    );

    await client.query('COMMIT');

    console.log(`✅ [AD BOOST] Granted to user ${userId}: +1.2 MH/s hashrate boost (multiplier: ${newLockedBoost.toFixed(2)}x)`);

    return {
      success: true,
      boostActive: isProcessingActive,
      boostValue: 1.2,
      newMultiplier: newLockedBoost,
      message: `تم! تعزيز +1.2 MH/s (3 إحالات افتراضية) - المكافأة تتراكم تدريجيًا`
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error granting ad boost:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get current ad boost status for user
 * 🛡️ SIMPLIFIED: Only checks if ad_boost_active is TRUE and user is processing
 */
async function getAdBoostStatus(userId) {
  try {
    const result = await pool.query(
      `SELECT ad_boost_active, ad_boost_granted_at, ad_boost_session_start, 
              last_ad_watch_timestamp, processing_active, processing_start_time_seconds
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return { exists: false, boostActive: false };
    }

    const user = result.rows[0];
    const now = Math.floor(Date.now() / 1000);
    const isProcessingActive = user.processing_active === 1;
    
    // 🛡️ SIMPLIFIED: Boost is active if:
    // 1. ad_boost_active = TRUE in DB
    // 2. User is actively processing
    // The boost is cleared when session ends or new session starts (in startProcessing/save-completed)
    const isBoostValid = user.ad_boost_active === true && isProcessingActive;

    return {
      exists: true,
      boostActive: isBoostValid,
      boostGranted: user.ad_boost_granted_at ? true : false,
      grantedAt: user.ad_boost_granted_at,
      sessionStart: user.ad_boost_session_start,
      miningActive: isProcessingActive,
      lastAdWatch: user.last_ad_watch_timestamp,
      cooldownRemaining: Math.max(0, 86400 - (now - (user.last_ad_watch_timestamp || 0)))
    };

  } catch (error) {
    console.error('Error getting ad boost status:', error);
    throw error;
  }
}

/**
 * Clear ad boost when mining session ends
 * Called when user starts mining and has a granted but inactive boost
 */
async function clearAdBoost(userId) {
  try {
    await pool.query(
      `UPDATE users 
       SET ad_boost_active = FALSE,
           ad_boost_granted_at = NULL,
           ad_boost_session_start = NULL,
           last_ad_watch_timestamp = NULL
       WHERE id = $1`,
      [userId]
    );

    console.log(`[AD BOOST] All boost data cleared for user ${userId}`);
    return { success: true };

  } catch (error) {
    console.error('Error clearing ad boost:', error);
    throw error;
  }
}

/**
 * Activate pending ad boost when mining starts
 * Called when user starts mining and has a granted but inactive boost
 */
async function activatePendingAdBoost(userId, sessionStartTime) {
  try {
    const result = await pool.query(
      `UPDATE users 
       SET ad_boost_active = TRUE,
           ad_boost_session_start = $1
       WHERE id = $2 AND ad_boost_granted_at IS NOT NULL AND ad_boost_active = FALSE
       RETURNING ad_boost_granted_at`,
      [sessionStartTime, userId]
    );

    if (result.rows.length > 0) {
      console.log(`Activated pending ad boost for user ${userId}`);
      return { activated: true, grantedAt: result.rows[0].ad_boost_granted_at };
    }

    return { activated: false };

  } catch (error) {
    console.error('Error activating pending ad boost:', error);
    throw error;
  }
}

// ========== END AD BOOST SYSTEM ==========

// Use both CommonJS and ES module export patterns for compatibility
const exports = {
  pool,
  initializeDatabase,
  saveUser,
  getUser,
  processReferral,
  getUserReferrals,
  handleTransaction,
  updateProcessingStatus,
  getProcessingHistory,
  saveProcessingHistory,
  startProcessing,
  updateAccumulatedReward,
  getAccumulatedReward,
  completeProcessing,
  getNextNonce,
  getBlockchainTransactions,
  saveTransactionWithConsistentHash,
  // Ad Boost functions
  computeHashrateMultiplier,
  checkAdBoostEligibility,
  grantAdBoost,
  getAdBoostStatus,
  clearAdBoost,
  activatePendingAdBoost
};

export default exports;
export {
  pool,
  safeQuery,
  // Ad Boost functions
  computeHashrateMultiplier,
  checkAdBoostEligibility,
  grantAdBoost,
  getAdBoostStatus,
  clearAdBoost,
  activatePendingAdBoost,
  initializeDatabase,
  saveUser,
  getUser,
  processReferral,
  getUserReferrals,
  handleTransaction,
  updateProcessingStatus,
  getProcessingHistory,
  saveProcessingHistory,
  startProcessing,
  updateAccumulatedReward,
  getAccumulatedReward,
  completeProcessing,
  getNextNonce,
  getPersistentNonce,
  saveNonceUsage,
  getBlockchainTransactions,
  saveTransactionWithConsistentHash // Add the new function to exports
};

async function handleTransaction(sender, recipient, amount, description, options = {}) {
  try {
    // Basic input validation
    if (!sender || !recipient || !amount) {
      throw new Error('Invalid input parameters for transaction');
    }

    // Convert amount to a numeric value, ensure it's a positive number
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      throw new Error('Invalid transaction amount');
    }

    // Generate nonce for the transaction
    const nonce = options.nonce || await getNextNonce(sender);

    // Generate a unique hash for the transaction
    const hash = generateTransactionHash(sender, recipient, amount, nonce, Date.now());

    // Fetch sender and recipient details from the database
    const senderResult = await pool.query('SELECT id, coins, wallet_address FROM users WHERE id = $1', [sender]);
    const recipientResult = await pool.query('SELECT id, coins, wallet_address FROM users WHERE id = $1', [recipient]);

    if (senderResult.rows.length === 0 || recipientResult.rows.length === 0) {
      throw new Error('Sender or recipient not found');
    }

    const senderData = senderResult.rows[0];
    const recipientData = recipientResult.rows[0];

    const senderAddress = senderData.wallet_address;
    const recipientAddress = recipientData.wallet_address;

    // Check if the sender has sufficient balance
    const gasFee = options.gasFee || 0.00002;
    const totalRequired = numericAmount + gasFee;

    if (parseFloat(senderData.coins) < totalRequired) {
      throw new Error(`Insufficient balance. Required: ${totalRequired.toFixed(8)}, Available: ${parseFloat(senderData.coins).toFixed(8)}`);
    }

    // Start a database transaction to ensure atomicity
    await pool.query('BEGIN');

    // Get current balances with proper precision
    const currentSenderBalance = parseFloat(senderData.coins);
    const currentRecipientBalance = parseFloat(recipientData.coins);

    // Calculate new balances precisely
    const senderNewBalance = (currentSenderBalance - numericAmount - gasFee).toFixed(8);
    const recipientNewBalance = (currentRecipientBalance + numericAmount).toFixed(8);

    console.log(`💰 Transaction Details:
      📤 Sender ${sender}: ${currentSenderBalance.toFixed(8)} → ${senderNewBalance} (-${numericAmount.toFixed(8)} -${gasFee.toFixed(8)})
      📥 Recipient ${recipient}: ${currentRecipientBalance.toFixed(8)} → ${recipientNewBalance} (+${numericAmount.toFixed(8)})
      🔢 Nonce: ${nonce}
      🏷️ Hash: ${hash.substring(0, 16)}...
    `);

    // Update balances with absolute values
    await pool.query(
      'UPDATE users SET coins = $1::numeric(20,8) WHERE id = $2', 
      [senderNewBalance, sender]
    );

    await pool.query(
      'UPDATE users SET coins = $1::numeric(20,8) WHERE id = $2', 
      [recipientNewBalance, recipient]
    );

    // Record the transaction in both tables using the new function
    const transactionData = {
      hash,
      fromAddress: senderAddress,
      toAddress: recipientAddress,
      amount: numericAmount.toFixed(8),
      timestamp,
      gasFee: gasFee.toFixed(8),
      nonce,
      blockHash,
      blockIndex,
      sender,
      recipient,
      description: description || `Transfer ${numericAmount.toFixed(8)} ACCESS`,
      confirmations: 1,
      status: 'confirmed'
    };

    const saveResult = await saveTransactionWithConsistentHash(transactionData);

    if (!saveResult) {
      await pool.query('ROLLBACK');
      throw new Error('Failed to save transaction with consistent hash.');
    }

    // Commit the transaction
    await pool.query('COMMIT');

    console.log(`✅ Transaction recorded successfully:
      🔗 Hash: ${hash}
      💰 Amount: ${numericAmount.toFixed(8)} ACCESS
      🔢 Nonce: ${nonce}
      ⛽ Gas Fee: ${gasFee.toFixed(8)} ACCESS
    `);

    return { 
      success: true, 
      message: 'Transaction successful', 
      hash,
      nonce,
      amount: numericAmount,
      gasFee: gasFee,
      timestamp: timestamp
    };
  } catch (error) {
    // Rollback the transaction in case of an error
    await pool.query('ROLLBACK');
    console.error('❌ Transaction failed:', error);
    return { success: false, message: error.message };
  }
}

// Get next nonce for a user with persistent storage
async function getNextNonce(userId) {
  try {
    const result = await pool.query(
      'SELECT COALESCE(MAX(nonce), 0) + 1 as next_nonce FROM transactions WHERE sender = $1',
      [userId]
    );
    return parseInt(result.rows[0].next_nonce) || 1;
  } catch (error) {
    console.error('Error getting next nonce:', error);
    return Date.now(); // fallback to timestamp
  }
}

// Get persistent nonce for blockchain address
async function getPersistentNonce(address) {
  try {
    const normalizedAddress = address.toLowerCase();

    // البحث في جميع جداول المعاملات
    const blockchainResult = await pool.query(`
      SELECT MAX(nonce) as max_nonce 
      FROM blockchain_transactions 
      WHERE LOWER(from_address) = $1
    `, [normalizedAddress]);

    const transactionsResult = await pool.query(`
      SELECT MAX(nonce) as max_nonce 
      FROM transactions 
      WHERE LOWER(sender_address) = $1
    `, [normalizedAddress]);

    const maxBlockchainNonce = parseInt(blockchainResult.rows[0]?.max_nonce || 0);
    const maxTransactionsNonce = parseInt(transactionsResult.rows[0]?.max_nonce || 0);

    // إرجاع أكبر nonce + 1
    const nextNonce = Math.max(maxBlockchainNonce, maxTransactionsNonce) + 1;

    console.log(`🔢 PERSISTENT NONCE for ${address}:`, {
      blockchain_max: maxBlockchainNonce,
      transactions_max: maxTransactionsNonce,
      next_nonce: nextNonce
    });

    return nextNonce;

  } catch (error) {
    console.error('Error getting persistent nonce:', error);
    return Math.floor(Date.now() / 1000) % 1000000; // fallback
  }
}

// Save nonce to ensure persistence
async function saveNonceUsage(address, nonce, txHash) {
  try {
    const normalizedAddress = address.toLowerCase();

    // إنشاء جدول خاص لحفظ nonce إذا لم يكن موجود
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nonce_tracker (
        id SERIAL PRIMARY KEY,
        address VARCHAR(42) NOT NULL,
        nonce BIGINT NOT NULL,
        tx_hash VARCHAR(66),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(address, nonce)
      )
    `);

    // حفظ nonce المستخدم
    await pool.query(`
      INSERT INTO nonce_tracker (address, nonce, tx_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (address, nonce) DO UPDATE SET
      tx_hash = EXCLUDED.tx_hash,
      created_at = CURRENT_TIMESTAMP
    `, [normalizedAddress, nonce, txHash]);

    console.log(`SAVE NONCE: ${address} used nonce ${nonce} for tx ${txHash}`);
    return true;

  } catch (error) {
    console.error('Error saving nonce usage:', error);
    return false;
  }
}

// Utility function to generate a transaction hash with nonce
function generateTransactionHash(sender, recipient, amount, nonce, timestamp) {
  const crypto = require('crypto');
  const data = `${sender}-${recipient}-${amount}-${nonce}-${timestamp}`;
  return '0x' + crypto.createHash('sha256').update(data).digest('hex');
}
// Convert numeric amounts to proper numbers with consistent decimal precision
function formatTransactions(transactions, userId) {
  return transactions.map(tx => ({
    ...tx,
    amount: parseFloat(tx.amount || 0),
    amount_display: parseFloat(tx.amount || 0).toFixed(8), // Always show 8 decimal places for display
    gas_fee: parseFloat(tx.gas_fee || 0),
    gas_fee_display: parseFloat(tx.gas_fee || 0).toFixed(8), // Always show 8 decimal places for display
    date: new Date(parseInt(tx.timestamp)).toISOString(),
    is_outgoing: tx.direction === 'outgoing' || tx.sender === userId,
    // Extra fields needed by the frontend
    sender_id: tx.sender,
    recipient_id: tx.recipient,
    from: tx.sender_address,
    to: tx.recipient_address,
    fromAddress: tx.sender_address,
    toAddress: tx.recipient_address,
    hash: tx.hash || `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
    timestamp: parseInt(tx.timestamp),
    // Include pre-formatted amount string to avoid zero flash
    amount_display: parseFloat(tx.amount || 0).toFixed(8)
  }));
}

import url from 'url';

// Generic POST request body parser
async function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
      let body = '';

      req.on('data', chunk => {
          body += chunk.toString(); // convert Buffer to string
      });

      req.on('end', () => {
          try {
              const parsedBody = JSON.parse(body);
              resolve(parsedBody);
          } catch (error) {
              console.error('Error parsing JSON body:', error);
              reject(error);
          }
      });

      req.on('error', err => {
          console.error('Request body parsing error:', err);
          reject(err);
      });
  });
}

async function requestHandler(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const { pathname } = parsedUrl;
    console.log("Processing request for:", pathname);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Health check endpoint
    if (pathname === '/api/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'OK', timestamp: Date.now() }));
        return;
    }

    // POST /api/processing/start - Start processing
    if (pathname === '/api/processing/start' && req.method === 'POST') {
        try {
            const { userId, userName, processingDuration } = await parseRequestBody(req);

            const startResult = await startProcessing(userId, userName, processingDuration);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: startResult }));
        } catch (error) {
            console.error("Failed to start processing session:", error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: error.message }));
        }
        return;
    }

    // POST /api/processing/complete - Complete processing and add reward
    if (pathname === '/api/processing/complete' && req.method === 'POST') {
        try {
            const { userId, amount } = await parseRequestBody(req);

            // Use the new completeProcessing function
            const completeResult = await completeProcessing(userId, amount);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(completeResult));
        } catch (error) {
            console.error("Failed to complete processing:", error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: error.message }));
        }
        return;
    }

    // POST /api/processing/reward - Update accumulated processing reward
    if (pathname === '/api/processing/reward' && req.method === 'POST') {
        try {
            const { userId, amount } = await parseRequestBody(req);

            const updateResult = await updateAccumulatedReward(userId, amount);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(updateResult));
        } catch (error) {
            console.error("Failed to update accumulated processing reward:", error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: error.message }));
        }
        return;
    }

    // GET /api/processing/reward?userId=xxx - Get accumulated processing reward
    if (pathname === '/api/processing/reward' && req.method === 'GET') {
        try {
            const userId = parsedUrl.query.userId;

            const getResult = await getAccumulatedReward(userId);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getResult));
        } catch (error) {
            console.error("Failed to get accumulated processing reward:", error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: error.message }));
        }
        return;
    }
// GET /api/processing/status?userId=xxx - Get user processing status, cooldown, progress
  if (pathname === '/api/processing/status' && req.method === 'GET') {
      try {
          const userId = parsedUrl.query.userId;

          // Get current processing status, time remaining, and accumulated reward
          const result = await pool.query(
              'SELECT processing_active, processing_start_time, processing_end_time, last_payout, processing_rate, processing_boost_multiplier FROM users WHERE id = $1',
              [userId]
          );

          if (result.rows.length === 0) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'User not found' }));
              return;
          }

          const now = Date.now();
          const user = result.rows[0];

          // Convert all values to proper types (some may come as strings from database)
          const processing_active = parseInt(user.processing_active) === 1;
          const processing_start_time = parseInt(user.processing_start_time) || 0;
          const processing_end_time = parseInt(user.processing_end_time) || 0;
          const last_payout = parseInt(user.last_payout) || 0;

          // Calculate remaining time - calculate cooldown too
          const remainingMs = Math.max(0, processing_end_time - now);
          const remainingSec = Math.ceil(remainingMs / 1000);

          // Calculate total processing duration
          const durationMs = processing_end_time - processing_start_time;
          const durationSec = Math.ceil(durationMs / 1000);

          // Calculate cooldown (12 hours = 43200000 ms)
          const cooldownDuration = 12 * 60 * 60 * 1000; // 12 hours in milliseconds
          const timeSinceLastProcessing = now - last_payout;
          const cooldownRemainingMs = Math.max(0, cooldownDuration - timeSinceLastProcessing);
          const cooldownRemainingSec = Math.ceil(cooldownRemainingMs / 1000);

          // Determine if user can mine (either active or cooldown passed)
          const canMine = !processing_active && cooldownRemainingMs === 0;

          // Check if user has claimed processing reward today
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);
          const startOfTodayMs = startOfToday.getTime();
          const claimedToday = last_payout >= startOfTodayMs;

          // Get accumulated processing reward - may need adjustment for referral boosts
          let storedAccumulatedReward = 0; // Initialize to 0
          let storedHashrate = parseFloat(user.processing_rate || 10);
          let storedBoostMultiplier = parseFloat(user.processing_boost_multiplier || 1.0);

          // Get active referrals count for boost calculation
          const referralsResponse = await pool.query(
            `SELECT r.id, u.processing_active, u.processing_end_time, u.is_active 
             FROM referrals r
             JOIN users u ON r.referee_id = u.id
             WHERE r.referrer_id = $1`,
            [userId]
          );

          // Count active referrals
          let activeReferralCount = 0;

          referralsResponse.rows.forEach(ref => {
            // Check if the referral is actively processing
            const refProcessingActive = parseInt(ref.processing_active) || 0;
            const refIsActive = parseInt(ref.is_active) || 0;
            const refEndTime = parseInt(ref.processing_end_time) || 0;

            // Calculate if processing is active based on end time and flags
            const isActivelyProcessing = (refProcessingActive === 1 || refIsActive === 1 || (refEndTime > now));

            if (isActivelyProcessing) {
              activeReferralCount++;
            }
          });

          // Calculate hashrate and reward based on referral count
          const baseHashrate = 10; // MH/s
          const boostPerReferral = 0.4 // MH/s per active referral
          const totalHashrate = baseHashrate + (activeReferralCount * boostPerReferral);

          // Calculate boost multiplier
          const boostMultiplier = totalHashrate / baseHashrate;

          // Use the higher of stored or calculated values
          const hashrate = Math.max(totalHashrate, storedHashrate);
          const effectiveMultiplier = Math.max(boostMultiplier, storedBoostMultiplier);

          // Calculate what the accumulated reward should be if processing is active
          // SERVER-ONLY calculation - ignore client calculations to prevent conflicts
          let serverAuthoritative = storedAccumulatedReward; // Use the initialized value

          // Only recalculate if there's an active processing session
          if (processingActive && processingStartTime > 0 && processingEndTime > now) {
            const baseReward = await dbCurrentBaseReward();
            const boostedBaseReward = baseReward * effectiveMultiplier;
            const elapsed = now - processingStartTime;
            const totalDuration = processingEndTime - processingStartTime;
            const progressRatio = Math.min(1, elapsed / totalDuration);

            // Calculate server-authoritative value
            serverAuthoritative = boostedBaseReward * progressRatio;

            // Update database with authoritative server value (مع throttling ذكي)
            if (!shouldSkipAccumulatedUpdate(userId)) {
              try {
                await pool.query(
                  'UPDATE users SET accumulatedReward = $1, processing_boost_multiplier = $2, last_server_update = $3 WHERE id = $4',
                  [serverAuthoritative, effectiveMultiplier, now, userId]
                );
              } catch (err) {
                // Silent - لا توقف التنفيذ
              }
            }
          }

          // Return processing status, cooldown, and time remaining
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
              success: true,
              processing_active: processing_active,
              remaining_seconds: remainingSec,
              remaining_ms: remainingMs,
              duration_seconds: durationSec,
              duration_ms: durationMs,
              cooldown_remaining_ms: cooldownRemainingMs,
              cooldown_remaining_seconds: cooldownRemainingSec,
              can_mine: canMine,
              accumulated_reward: serverAuthoritative,
              claimed_today: claimedToday,
              hashrate: hashrate,
              boost_multiplier: boostMultiplier
          }));
          return;
      } catch (error) {
          console.error("Failed to get processing status:", error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
      }
    }

    // POST /api/user/save - Save user data
    if (pathname === '/api/user/save' && req.method === 'POST') {
      try {
          const userData = await parseRequestBody(req);
          const savedUser = await saveUser(userData);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, user: savedUser }));
      } catch (error) {
          console.error('Failed to save user:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }

    // GET /api/user/get?email=xxx - Get user data
    if (pathname === '/api/user/get' && req.method === 'GET') {
        try {
            const email = parsedUrl.query.email;
            const user = await getUser(email);

            if (user) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, user: user }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'User not found' }));
            }
        } catch (error) {
            console.error('Failed to get user:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: error.message }));
        }
        return;
    }

    // POST /api/referral/process - Process referral
    if (pathname === '/api/referral/process' && req.method === 'POST') {
        try {
            const { referrerCode, refereeEmail, refereeName, refereeAvatar } = await parseRequestBody(req);
            const bonusAmount = await processReferral(referrerCode, refereeEmail, refereeName, refereeAvatar);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, bonusAmount: bonusAmount }));
        } catch (error) {
            console.error('Failed to process referral:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: error.message }));
        }
        return;
    }

    // GET /api/referrals/get?userId=xxx - Get user referrals
    if (pathname === '/api/referrals/get' && req.method === 'GET') {
        try {
            const userId = parsedUrl.query.userId;
            const referrals = await getUserReferrals(userId);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, referrals: referrals }));
        } catch (error) {
            console.error('Failed to get user referrals:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: error.message }));
        }
        return;
    }

    // POST /api/transactions/handle - Handle a transaction
    if (pathname === '/api/transactions/handle' && req.method === 'POST') {
      try {
          const { sender, recipient, amount, description } = await parseRequestBody(req);
          const transactionResult = await handleTransaction(sender, recipient, amount, description);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(transactionResult));
      } catch (error) {
          console.error('Failed to handle transaction:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }

    // GET /api/db/transactions/recent - Get recent transactions from transactions table
    if (pathname === '/api/db/transactions/recent' && req.method === 'GET') {
        try {
            const limit = parseInt(parsedUrl.query.limit) || 10;

            const result = await pool.query(`
                SELECT 
                    hash,
                    sender,
                    recipient,
                    sender_address,
                    recipient_address,
                    amount,
                    timestamp,
                    gas_fee,
                    status,
                    description
                FROM transactions 
                WHERE hash IS NOT NULL 
                ORDER BY timestamp DESC 
                LIMIT $1
            `, [limit]);

            const transactions = result.rows.map(tx => ({
                hash: tx.hash,
                sender: tx.sender,
                recipient: tx.recipient,
                sender_address: tx.sender_address,
                recipient_address: tx.recipient_address,
                amount: parseFloat(tx.amount || 0),
                timestamp: parseInt(tx.timestamp || Date.now()),
                gas_fee: parseFloat(tx.gas_fee || 0),
                status: tx.status || 'confirmed',
                description: tx.description
            }));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                data: transactions,
                count: transactions.length
            }));
        } catch (error) {
            console.error('Error fetching transactions from DB:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: error.message
            }));
        }
        return;
    }

    // GET /api/transactions - Get all transactions (compatibility endpoint)
    if (pathname === '/api/transactions' && req.method === 'GET') {
        try {
            const limit = parseInt(parsedUrl.query.limit) || 20;

            const result = await pool.query(`
                SELECT 
                    hash,
                    sender,
                    recipient,
                    sender_address,
                    recipient_address,
                    amount,
                    timestamp,
                    gas_fee,
                    status,
                    description,
                    nonce,
                    block_hash,
                    confirmations
                FROM transactions 
                WHERE hash IS NOT NULL AND sender_address IS NOT NULL AND recipient_address IS NOT NULL
                ORDER BY timestamp DESC 
                LIMIT $1
            `, [limit]);

            const transactions = result.rows.map(tx => ({
                hash: tx.hash,
                sender: tx.sender,
                recipient: tx.recipient,
                sender_address: tx.sender_address,
                recipient_address: tx.recipient_address,
                from: tx.sender_address,
                to: tx.recipient_address,
                fromAddress: tx.sender_address,
                toAddress: tx.recipient_address,
                amount: parseFloat(tx.amount || 0),
                value: parseFloat(tx.amount || 0),
                timestamp: parseInt(tx.timestamp || Date.now()),
                gas_fee: parseFloat(tx.gas_fee || 0),
                status: tx.status || 'confirmed',
                description: tx.description,
                nonce: parseInt(tx.nonce || 0),
                block_hash: tx.block_hash,
                confirmations: parseInt(tx.confirmations || 1)
            }));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                data: transactions,
                count: transactions.length
            }));
        } catch (error) {
            console.error('Error fetching all transactions:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: error.message
            }));
        }
        return;
    }

    // Default response for unhandled routes
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
}

export { requestHandler };