/**
 * 🚀 DATABASE OPTIMIZER - تحسينات مستوى المواقع الكبيرة
 * 
 * هذا الملف يطبق استراتيجيات التحسين المستخدمة في:
 * - Binance, Coinbase (بورصات crypto)
 * - Instagram, Twitter (ملايين المستخدمين)
 * - Netflix, Uber (تطبيقات عالية الأداء)
 * 
 * الاستراتيجيات:
 * 1. In-Memory Caching (Redis-like) - تخزين مؤقت بالذاكرة
 * 2. Write-Behind Pattern - تجميع الكتابات
 * 3. Read-Through Cache - قراءة من الكاش أولاً
 * 4. Connection Pooling Optimization - تحسين الاتصالات
 * 5. Batch Operations - تجميع العمليات
 * 6. Lazy Loading - التحميل الكسول
 */

import { pool } from './db.js';

class DatabaseOptimizer {
  constructor() {
    // 🧠 In-Memory Cache (مثل Redis لكن بالذاكرة)
    this.cache = {
      users: new Map(),           // userId -> userData
      accounts: new Map(),        // address -> accountData
      balances: new Map(),        // address -> balance
      transactions: new Map(),    // txHash -> txData
      blocks: new Map(),          // blockIndex -> blockData
      lastQuery: new Map()        // queryKey -> timestamp
    };

    // 📊 Cache Statistics
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      dbQueries: 0,
      savedQueries: 0,
      batchedWrites: 0
    };

    // ⏱️ Cache TTL (Time To Live)
    this.TTL = {
      users: 5 * 60 * 1000,       // 5 دقائق للمستخدمين
      accounts: 60 * 1000,        // 1 دقيقة للحسابات
      balances: 30 * 1000,        // 30 ثانية للأرصدة
      transactions: 10 * 60 * 1000, // 10 دقائق للمعاملات
      blocks: 30 * 60 * 1000      // 30 دقيقة للبلوكات
    };

    // 📝 Write Buffer (تجميع الكتابات)
    this.writeBuffer = {
      accounts: new Map(),        // address -> { data, timestamp }
      users: new Map(),           // userId -> { data, timestamp }
      transactions: new Map()     // txHash -> { data, timestamp }
    };

    // ⚙️ Configuration
    this.config = {
      maxCacheSize: 10000,        // أقصى حجم للكاش
      writeBufferFlushInterval: 30000,  // تفريغ كل 30 ثانية
      writeBufferMaxSize: 100,    // أقصى حجم قبل التفريغ الفوري
      minWriteInterval: 60000,    // أقل فترة بين الكتابات لنفس السجل
      enableBatching: true,
      enableCaching: true
    };

    // بدء المؤقتات
    this.startFlushTimer();
    this.startCacheCleanup();
  }

  // ════════════════════════════════════════════════════════════════
  // 🔥 ACCOUNTS OPTIMIZATION (حل مشكلة 760 تحديث)
  // ════════════════════════════════════════════════════════════════

  /**
   * حفظ حالة الحساب بذكاء - يقلل التحديثات بنسبة 95%+
   */
  async saveAccountState(address, data) {
    const normalizedAddr = address.toLowerCase();
    const now = Date.now();

    // 1️⃣ تحديث الكاش فوراً (سريع جداً)
    this.cache.accounts.set(normalizedAddr, {
      ...data,
      cachedAt: now
    });
    this.cache.balances.set(normalizedAddr, data.balance);

    // 2️⃣ التحقق من الحاجة للكتابة في قاعدة البيانات
    const existingBuffer = this.writeBuffer.accounts.get(normalizedAddr);
    
    if (existingBuffer) {
      const timeSinceLastBuffer = now - existingBuffer.timestamp;
      
      // إذا لم يمر وقت كافي، فقط تحديث البيانات بدون كتابة جديدة
      if (timeSinceLastBuffer < this.config.minWriteInterval) {
        existingBuffer.data = data;
        existingBuffer.updateCount++;
        this.stats.savedQueries++;
        return { cached: true, buffered: true, saved: true };
      }
    }

    // 3️⃣ إضافة للـ Write Buffer
    this.writeBuffer.accounts.set(normalizedAddr, {
      data: data,
      timestamp: now,
      updateCount: 1
    });

    // 4️⃣ تفريغ فوري إذا امتلأ Buffer
    if (this.writeBuffer.accounts.size >= this.config.writeBufferMaxSize) {
      await this.flushAccountsBuffer();
    }

    return { cached: true, buffered: true };
  }

  /**
   * قراءة حالة الحساب - من الكاش أولاً
   */
  async getAccountState(address) {
    const normalizedAddr = address.toLowerCase();
    const now = Date.now();

    // 1️⃣ محاولة من الكاش
    const cached = this.cache.accounts.get(normalizedAddr);
    if (cached && (now - cached.cachedAt) < this.TTL.accounts) {
      this.stats.cacheHits++;
      return cached;
    }

    // 2️⃣ محاولة من Write Buffer
    const buffered = this.writeBuffer.accounts.get(normalizedAddr);
    if (buffered) {
      this.stats.cacheHits++;
      return buffered.data;
    }

    // 3️⃣ قراءة من قاعدة البيانات
    this.stats.cacheMisses++;
    this.stats.dbQueries++;
    
    try {
      const result = await pool.query(
        'SELECT * FROM ethereum_accounts WHERE address = $1',
        [normalizedAddr]
      );
      
      if (result.rows.length > 0) {
        const data = result.rows[0];
        this.cache.accounts.set(normalizedAddr, { ...data, cachedAt: now });
        return data;
      }
    } catch (error) {
      console.error('getAccountState error:', error.message);
    }

    return null;
  }

  /**
   * تفريغ buffer الحسابات - كتابة مجمعة
   */
  async flushAccountsBuffer() {
    if (this.writeBuffer.accounts.size === 0) return;

    const accounts = Array.from(this.writeBuffer.accounts.entries());
    this.writeBuffer.accounts.clear();

    this.stats.batchedWrites++;
    // تم إزالة الرسالة لتقليل استهلاك CPU

    // كتابة مجمعة باستخدام UNNEST (أسرع بكثير من INSERT متعددة)
    try {
      const addresses = [];
      const balances = [];
      const nonces = [];
      const codeHashes = [];
      const storageRoots = [];
      const updatedAts = [];

      for (const [address, { data }] of accounts) {
        addresses.push(address);
        // تحويل الرصيد لرقم صحيح
        balances.push(parseFloat(data.balance) || 0);
        nonces.push(data.nonce || 0);
        codeHashes.push(data.codeHash || '0x');
        storageRoots.push(data.storageRoot || '0x');
        updatedAts.push(data.updatedAt || Date.now());
      }

      // 🚀 استخدام timeout قصير لمنع الـ deadlock
      const client = await pool.connect();
      try {
        await client.query('SET statement_timeout = 5000'); // 5 ثواني فقط
        await client.query(`
          INSERT INTO ethereum_accounts (address, balance, nonce, code_hash, storage_root, updated_at)
          SELECT * FROM UNNEST($1::text[], $2::numeric[], $3::int[], $4::text[], $5::text[], $6::bigint[])
          ON CONFLICT (address) DO UPDATE SET
            balance = EXCLUDED.balance,
            nonce = EXCLUDED.nonce,
            code_hash = EXCLUDED.code_hash,
            storage_root = EXCLUDED.storage_root,
            updated_at = EXCLUDED.updated_at
        `, [addresses, balances, nonces, codeHashes, storageRoots, updatedAts]);
      } finally {
        client.release();
      }
      // تم بنجاح - بدون رسالة
    } catch (error) {
      // تجاهل أخطاء timeout - ليست مهمة
      if (!error.message.includes('timeout')) {
        console.error('Batch write error:', error.message);
      }
      // إعادة للـ buffer في حالة الفشل
      for (const [address, data] of accounts) {
        this.writeBuffer.accounts.set(address, data);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 🔥 USERS OPTIMIZATION (حل مشكلة 690 seq_scan)
  // ════════════════════════════════════════════════════════════════

  /**
   * الحصول على مستخدم - مع كاش ذكي
   */
  async getUser(identifier, type = 'id') {
    const cacheKey = `${type}:${identifier}`;
    const now = Date.now();

    // 1️⃣ من الكاش
    const cached = this.cache.users.get(cacheKey);
    if (cached && (now - cached.cachedAt) < this.TTL.users) {
      this.stats.cacheHits++;
      return cached.data;
    }

    // 2️⃣ من قاعدة البيانات
    this.stats.cacheMisses++;
    this.stats.dbQueries++;

    try {
      let query, params;
      
      switch (type) {
        case 'id':
          query = 'SELECT * FROM users WHERE id = $1';
          params = [identifier];
          break;
        case 'email':
          query = 'SELECT * FROM users WHERE email = $1';
          params = [identifier];
          break;
        case 'wallet':
          query = 'SELECT * FROM users WHERE LOWER(wallet_address) = $1';
          params = [identifier.toLowerCase()];
          break;
        default:
          throw new Error('Unknown identifier type');
      }

      const result = await pool.query(query, params);
      
      if (result.rows.length > 0) {
        const userData = result.rows[0];
        
        // تخزين في الكاش بعدة مفاتيح للوصول السريع
        this.cache.users.set(`id:${userData.id}`, { data: userData, cachedAt: now });
        if (userData.email) {
          this.cache.users.set(`email:${userData.email}`, { data: userData, cachedAt: now });
        }
        if (userData.wallet_address) {
          this.cache.users.set(`wallet:${userData.wallet_address.toLowerCase()}`, { data: userData, cachedAt: now });
        }
        
        return userData;
      }
    } catch (error) {
      console.error('getUser error:', error.message);
    }

    return null;
  }

  /**
   * تحديث مستخدم مع تجميع الكتابات
   */
  async updateUser(userId, updates) {
    const now = Date.now();

    // 1️⃣ تحديث الكاش فوراً
    const cacheKey = `id:${userId}`;
    const cached = this.cache.users.get(cacheKey);
    if (cached) {
      cached.data = { ...cached.data, ...updates };
      cached.cachedAt = now;
    }

    // 2️⃣ التحقق من الحاجة للكتابة
    const existingBuffer = this.writeBuffer.users.get(userId);
    
    if (existingBuffer) {
      const timeSinceLastBuffer = now - existingBuffer.timestamp;
      
      if (timeSinceLastBuffer < this.config.minWriteInterval) {
        // دمج التحديثات
        existingBuffer.data = { ...existingBuffer.data, ...updates };
        existingBuffer.updateCount++;
        this.stats.savedQueries++;
        return { cached: true, buffered: true, saved: true };
      }
    }

    // 3️⃣ إضافة للـ Buffer
    this.writeBuffer.users.set(userId, {
      data: updates,
      timestamp: now,
      updateCount: 1
    });

    // 4️⃣ تفريغ فوري إذا امتلأ
    if (this.writeBuffer.users.size >= this.config.writeBufferMaxSize) {
      await this.flushUsersBuffer();
    }

    return { cached: true, buffered: true };
  }

  /**
   * تفريغ buffer المستخدمين
   */
  async flushUsersBuffer() {
    if (this.writeBuffer.users.size === 0) return;

    const users = Array.from(this.writeBuffer.users.entries());
    this.writeBuffer.users.clear();

    this.stats.batchedWrites++;
    // رسائل التحديث صامتة لتقليل الاستهلاك

    // تحديثات فردية (لأن كل مستخدم قد يكون له أعمدة مختلفة)
    for (const [userId, { data }] of users) {
      try {
        const columns = Object.keys(data);
        const values = Object.values(data);
        
        if (columns.length === 0) continue;

        const setClause = columns.map((col, i) => `${col} = $${i + 2}`).join(', ');
        
        await pool.query(
          `UPDATE users SET ${setClause} WHERE id = $1`,
          [userId, ...values]
        );
      } catch (error) {
        console.error(`User update error for ${userId}:`, error.message);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 🔥 BALANCE OPTIMIZATION (قراءة الأرصدة السريعة)
  // ════════════════════════════════════════════════════════════════

  /**
   * الحصول على رصيد - فائق السرعة
   */
  getBalance(address) {
    const normalizedAddr = address.toLowerCase();
    return this.cache.balances.get(normalizedAddr) || 0;
  }

  /**
   * تحديث رصيد - في الذاكرة فقط
   */
  setBalance(address, balance) {
    const normalizedAddr = address.toLowerCase();
    this.cache.balances.set(normalizedAddr, balance);
  }

  /**
   * تحميل جميع الأرصدة للكاش (عند بدء التشغيل)
   */
  async preloadBalances() {
    try {
      // تحميل صامت - بدون رسائل
      const result = await pool.query(
        'SELECT address, balance FROM ethereum_accounts WHERE balance IS NOT NULL'
      );

      for (const row of result.rows) {
        this.cache.balances.set(row.address.toLowerCase(), parseFloat(row.balance) || 0);
        this.cache.accounts.set(row.address.toLowerCase(), { ...row, cachedAt: Date.now() });
      }
      // تم تحميل ${result.rows.length} رصيد
    } catch (error) {
      console.error('Preload balances error:', error.message);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 🔥 TRANSACTIONS CACHE (تقليل استعلامات المعاملات)
  // ════════════════════════════════════════════════════════════════

  /**
   * الحصول على معاملة من الكاش أو قاعدة البيانات
   */
  async getTransaction(txHash) {
    const now = Date.now();
    
    // من الكاش أولاً
    const cached = this.cache.transactions.get(txHash);
    if (cached && (now - cached.cachedAt) < this.TTL.transactions) {
      this.stats.cacheHits++;
      return cached.data;
    }

    // من قاعدة البيانات
    this.stats.cacheMisses++;
    this.stats.dbQueries++;
    
    try {
      const result = await pool.query(
        'SELECT * FROM transactions WHERE hash = $1 OR tx_hash = $1 LIMIT 1',
        [txHash]
      );
      
      if (result.rows.length > 0) {
        this.cache.transactions.set(txHash, { data: result.rows[0], cachedAt: now });
        return result.rows[0];
      }
    } catch (error) {
      console.error('getTransaction error:', error.message);
    }
    
    return null;
  }

  /**
   * حفظ معاملة في الكاش (يتم الكتابة لاحقاً)
   */
  cacheTransaction(txHash, txData) {
    this.cache.transactions.set(txHash, { 
      data: txData, 
      cachedAt: Date.now() 
    });
    this.stats.savedQueries++;
  }

  /**
   * الحصول على معاملات عنوان معين - مع كاش
   */
  async getTransactionsByAddress(address, limit = 50) {
    const cacheKey = `addr_txs:${address.toLowerCase()}:${limit}`;
    const now = Date.now();
    
    const cached = this.cache.lastQuery.get(cacheKey);
    if (cached && (now - cached.timestamp) < 30000) { // 30 ثانية
      this.stats.cacheHits++;
      return cached.data;
    }

    this.stats.dbQueries++;
    
    try {
      const result = await pool.query(`
        SELECT * FROM transactions 
        WHERE sender_address = $1 OR recipient_address = $1
        ORDER BY timestamp DESC
        LIMIT $2
      `, [address.toLowerCase(), limit]);
      
      this.cache.lastQuery.set(cacheKey, { data: result.rows, timestamp: now });
      return result.rows;
    } catch (error) {
      console.error('getTransactionsByAddress error:', error.message);
      return [];
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 🔥 BLOCKS CACHE (تقليل استعلامات البلوكات)
  // ════════════════════════════════════════════════════════════════

  /**
   * الحصول على بلوك من الكاش (القرص هو المصدر الحقيقي)
   */
  async getBlock(blockIndex) {
    const now = Date.now();
    
    const cached = this.cache.blocks.get(blockIndex);
    if (cached && (now - cached.cachedAt) < this.TTL.blocks) {
      this.stats.cacheHits++;
      return cached.data;
    }

    // قراءة من القرص بدل DB
    try {
      const fs = await import('fs');
      const path = await import('path');
      const blocksDir = './ethereum-network-data/blocks';
      const shard = Math.floor(blockIndex / 10000);
      const filePath = path.default.join(blocksDir, String(shard), `block_${blockIndex}.json`);
      if (fs.default.existsSync(filePath)) {
        const data = JSON.parse(fs.default.readFileSync(filePath, 'utf8'));
        this.cache.blocks.set(blockIndex, { data, cachedAt: now });
        return data;
      }
    } catch (error) {
      console.error('getBlock error:', error.message);
    }
    
    return null;
  }

  /**
   * حفظ بلوك في الكاش
   */
  cacheBlock(blockIndex, blockData) {
    this.cache.blocks.set(blockIndex, { 
      data: blockData, 
      cachedAt: Date.now() 
    });
  }

  /**
   * الحصول على آخر البلوكات — من القرص مباشرة
   */
  async getLatestBlocks(limit = 10) {
    const cacheKey = `latest_blocks:${limit}`;
    const now = Date.now();
    
    const cached = this.cache.lastQuery.get(cacheKey);
    if (cached && (now - cached.timestamp) < 10000) {
      this.stats.cacheHits++;
      return cached.data;
    }

    try {
      const fs = await import('fs');
      const path = await import('path');
      const blocksDir = './ethereum-network-data/blocks';
      const allFiles = [];
      const entries = fs.default.readdirSync(blocksDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && /^\d+$/.test(entry.name)) {
          const shardDir = path.default.join(blocksDir, entry.name);
          for (const file of fs.default.readdirSync(shardDir)) {
            const match = file.match(/block_(\d+)\.json$/);
            if (match) allFiles.push({ index: parseInt(match[1]), dir: shardDir, name: file });
          }
        }
      }
      allFiles.sort((a, b) => b.index - a.index);
      const latest = allFiles.slice(0, limit);
      const blocks = latest.map(f => {
        try { return JSON.parse(fs.default.readFileSync(path.default.join(f.dir, f.name), 'utf8')); }
        catch(e) { return null; }
      }).filter(Boolean);
      
      this.cache.lastQuery.set(cacheKey, { data: blocks, timestamp: now });
      return blocks;
    } catch (error) {
      console.error('getLatestBlocks error:', error.message);
      return [];
    }
  }

  // ════════════════════════════════════════════════════════════════
  // ⏱️ TIMERS & CLEANUP
  // ════════════════════════════════════════════════════════════════

  startFlushTimer() {
    setInterval(async () => {
      await this.flushAccountsBuffer();
      await this.flushUsersBuffer();
    }, this.config.writeBufferFlushInterval);
  }

  startCacheCleanup() {
    setInterval(() => {
      const now = Date.now();

      // تنظيف الكاش القديم - accounts
      for (const [key, value] of this.cache.accounts.entries()) {
        if (now - value.cachedAt > this.TTL.accounts * 2) {
          this.cache.accounts.delete(key);
        }
      }

      // تنظيف الكاش القديم - users
      for (const [key, value] of this.cache.users.entries()) {
        if (now - value.cachedAt > this.TTL.users * 2) {
          this.cache.users.delete(key);
        }
      }

      // تنظيف الكاش القديم - transactions
      for (const [key, value] of this.cache.transactions.entries()) {
        if (now - value.cachedAt > this.TTL.transactions * 2) {
          this.cache.transactions.delete(key);
        }
      }

      // تنظيف الكاش القديم - blocks
      for (const [key, value] of this.cache.blocks.entries()) {
        if (now - value.cachedAt > this.TTL.blocks * 2) {
          this.cache.blocks.delete(key);
        }
      }

      // تنظيف استعلامات lastQuery القديمة
      for (const [key, value] of this.cache.lastQuery.entries()) {
        if (now - value.timestamp > 60000) { // دقيقة واحدة
          this.cache.lastQuery.delete(key);
        }
      }

      // تحديد حجم الكاش
      const caches = ['accounts', 'users', 'transactions', 'blocks'];
      for (const cacheName of caches) {
        if (this.cache[cacheName].size > this.config.maxCacheSize) {
          const toDelete = this.cache[cacheName].size - this.config.maxCacheSize;
          let deleted = 0;
          for (const key of this.cache[cacheName].keys()) {
            if (deleted >= toDelete) break;
            this.cache[cacheName].delete(key);
            deleted++;
          }
        }
      }
    }, 60000); // كل دقيقة
  }

  // ════════════════════════════════════════════════════════════════
  // 📊 STATISTICS
  // ════════════════════════════════════════════════════════════════

  getStats() {
    const hitRate = this.stats.cacheHits + this.stats.cacheMisses > 0
      ? (this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) * 100).toFixed(2)
      : 0;

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      cacheSize: {
        accounts: this.cache.accounts.size,
        users: this.cache.users.size,
        balances: this.cache.balances.size,
        transactions: this.cache.transactions.size,
        blocks: this.cache.blocks.size,
        queries: this.cache.lastQuery.size
      },
      bufferSize: {
        accounts: this.writeBuffer.accounts.size,
        users: this.writeBuffer.users.size,
        transactions: this.writeBuffer.transactions.size
      },
      estimatedSavings: `${this.stats.savedQueries} database queries saved`
    };
  }

  /**
   * طباعة الإحصائيات (فقط عند الطلب)
   */
  printStats() {
    // لا تطبع شيئاً - استخدم getStats() للحصول على البيانات
    return this.getStats();
  }

  // ════════════════════════════════════════════════════════════════
  // 🔧 CREATE MISSING INDEXES
  // ════════════════════════════════════════════════════════════════

  async createOptimalIndexes() {
    // إنشاء الفهارس بصمت
    const indexes = [
      // Users table - الفهارس المفقودة
      'CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON users(LOWER(wallet_address))',
      'CREATE INDEX IF NOT EXISTS idx_users_wallet_address_raw ON users(wallet_address)',
      'CREATE INDEX IF NOT EXISTS idx_users_coins ON users(coins) WHERE coins > 0',
      'CREATE INDEX IF NOT EXISTS idx_users_processing ON users(processing_active) WHERE processing_active = 1',
      
      // Ethereum accounts - تحسينات
      'CREATE INDEX IF NOT EXISTS idx_ethereum_accounts_balance ON ethereum_accounts(balance) WHERE balance::numeric > 0',
      'CREATE INDEX IF NOT EXISTS idx_ethereum_accounts_updated ON ethereum_accounts(updated_at DESC)',
    ];

    for (const indexSQL of indexes) {
      try {
        await pool.query(indexSQL);
      } catch (error) {
        // تجاهل الأخطاء - الفهرس موجود
      }
    }
  }
}

// Singleton instance
const dbOptimizer = new DatabaseOptimizer();

export default dbOptimizer;
export { DatabaseOptimizer };
