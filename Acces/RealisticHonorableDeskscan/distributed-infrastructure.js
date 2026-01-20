// =============================================
// 🏗️ ACCESS Network - Distributed Infrastructure
// بنية تحتية موزعة بدون خدمات خارجية
// =============================================

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import cluster from 'cluster';
import os from 'os';

// =============================================
// 1️⃣ نظام Redis-Like محلي (In-Memory + Persistence)
// =============================================

class LocalRedis extends EventEmitter {
  constructor(options = {}) {
    super();
    this.data = new Map();
    this.expires = new Map();
    this.subscribers = new Map();
    this.persistPath = options.persistPath || './access-network-data/redis-data.json';
    this.persistInterval = options.persistInterval || 30000; // 30 ثانية
    this.maxMemory = options.maxMemory || 500 * 1024 * 1024; // 500MB
    
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };
    
    this.initialize();
  }
  
  async initialize() {
    // تحميل البيانات المحفوظة
    await this.loadFromDisk();
    
    // حفظ دوري
    setInterval(() => this.saveToDisk(), this.persistInterval);
    
    // تنظيف المنتهي صلاحيته - كل 60 ثانية (بدلاً من 10)
    // 📉 تخفيض 6x = توفير 83% CPU
    setInterval(() => this.cleanupExpired(), 60000);
    
    // مراقبة الذاكرة
    setInterval(() => this.checkMemory(), 60000);
  }
  
  // SET with optional expiry
  set(key, value, expiryMs = null) {
    this.data.set(key, {
      value: JSON.stringify(value),
      createdAt: Date.now()
    });
    
    if (expiryMs) {
      this.expires.set(key, Date.now() + expiryMs);
    }
    
    this.stats.sets++;
    this.emit('set', key, value);
    return true;
  }
  
  // GET
  get(key) {
    // تحقق من الصلاحية
    if (this.expires.has(key) && Date.now() > this.expires.get(key)) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }
    
    const entry = this.data.get(key);
    if (entry) {
      this.stats.hits++;
      return JSON.parse(entry.value);
    }
    
    this.stats.misses++;
    return null;
  }
  
  // DELETE
  delete(key) {
    this.data.delete(key);
    this.expires.delete(key);
    this.stats.deletes++;
    this.emit('delete', key);
    return true;
  }
  
  // EXISTS
  exists(key) {
    if (this.expires.has(key) && Date.now() > this.expires.get(key)) {
      this.delete(key);
      return false;
    }
    return this.data.has(key);
  }
  
  // INCR
  incr(key) {
    const value = this.get(key) || 0;
    const newValue = parseInt(value) + 1;
    this.set(key, newValue);
    return newValue;
  }
  
  // DECR
  decr(key) {
    const value = this.get(key) || 0;
    const newValue = parseInt(value) - 1;
    this.set(key, newValue);
    return newValue;
  }
  
  // EXPIRE
  expire(key, seconds) {
    if (this.data.has(key)) {
      this.expires.set(key, Date.now() + (seconds * 1000));
      return true;
    }
    return false;
  }
  
  // TTL
  ttl(key) {
    if (!this.expires.has(key)) return -1;
    const remaining = this.expires.get(key) - Date.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : -2;
  }
  
  // KEYS (pattern matching)
  keys(pattern = '*') {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return Array.from(this.data.keys()).filter(key => regex.test(key));
  }
  
  // HSET (Hash)
  hset(key, field, value) {
    const hash = this.get(key) || {};
    hash[field] = value;
    this.set(key, hash);
    return true;
  }
  
  // HGET
  hget(key, field) {
    const hash = this.get(key);
    return hash ? hash[field] : null;
  }
  
  // HGETALL
  hgetall(key) {
    return this.get(key) || {};
  }
  
  // LPUSH (List)
  lpush(key, ...values) {
    const list = this.get(key) || [];
    list.unshift(...values);
    this.set(key, list);
    return list.length;
  }
  
  // RPUSH
  rpush(key, ...values) {
    const list = this.get(key) || [];
    list.push(...values);
    this.set(key, list);
    return list.length;
  }
  
  // LPOP
  lpop(key) {
    const list = this.get(key) || [];
    const value = list.shift();
    this.set(key, list);
    return value;
  }
  
  // RPOP
  rpop(key) {
    const list = this.get(key) || [];
    const value = list.pop();
    this.set(key, list);
    return value;
  }
  
  // LRANGE
  lrange(key, start, stop) {
    const list = this.get(key) || [];
    return list.slice(start, stop === -1 ? undefined : stop + 1);
  }
  
  // LLEN
  llen(key) {
    const list = this.get(key) || [];
    return list.length;
  }
  
  // SADD (Set)
  sadd(key, ...members) {
    const set = new Set(this.get(key) || []);
    members.forEach(m => set.add(m));
    this.set(key, Array.from(set));
    return members.length;
  }
  
  // SMEMBERS
  smembers(key) {
    return this.get(key) || [];
  }
  
  // SISMEMBER
  sismember(key, member) {
    const set = this.get(key) || [];
    return set.includes(member);
  }
  
  // PUBLISH/SUBSCRIBE
  subscribe(channel, callback) {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    this.subscribers.get(channel).add(callback);
    return true;
  }
  
  unsubscribe(channel, callback) {
    if (this.subscribers.has(channel)) {
      this.subscribers.get(channel).delete(callback);
    }
    return true;
  }
  
  publish(channel, message) {
    if (this.subscribers.has(channel)) {
      this.subscribers.get(channel).forEach(callback => {
        try {
          callback(message);
        } catch (e) {
          console.error('Publish error:', e.message);
        }
      });
    }
    this.emit('message', channel, message);
    return this.subscribers.get(channel)?.size || 0;
  }
  
  // تنظيف المنتهي صلاحيته
  cleanupExpired() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, expiry] of this.expires.entries()) {
      if (now > expiry) {
        this.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      // cleaned silently
    }
  }
  
  // مراقبة الذاكرة
  checkMemory() {
    const usage = process.memoryUsage();
    if (usage.heapUsed > this.maxMemory) {
      console.warn('⚠️ Redis memory limit approaching, evicting old keys');
      this.evictOldest(Math.floor(this.data.size * 0.2)); // حذف 20%
    }
  }
  
  // حذف الأقدم
  evictOldest(count) {
    const entries = Array.from(this.data.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .slice(0, count);
    
    entries.forEach(([key]) => this.delete(key));
    // evicted silently
  }
  
  // حفظ على القرص
  async saveToDisk() {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const data = {
        data: Object.fromEntries(this.data),
        expires: Object.fromEntries(this.expires),
        savedAt: Date.now()
      };
      
      fs.writeFileSync(this.persistPath, JSON.stringify(data));
    } catch (e) {
      console.error('Redis persist error:', e.message);
    }
  }
  
  // تحميل من القرص
  async loadFromDisk() {
    try {
      if (fs.existsSync(this.persistPath)) {
        const raw = fs.readFileSync(this.persistPath, 'utf8');
        const data = JSON.parse(raw);
        
        this.data = new Map(Object.entries(data.data || {}));
        this.expires = new Map(Object.entries(data.expires || {}).map(([k, v]) => [k, Number(v)]));
        
        // تنظيف المنتهي
        this.cleanupExpired();
      }
    } catch (e) {
      console.error('Redis load error:', e.message);
    }
  }
  
  // إحصائيات
  getStats() {
    return {
      ...this.stats,
      keys: this.data.size,
      expiringKeys: this.expires.size,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
      memoryUsage: process.memoryUsage().heapUsed
    };
  }
  
  // FLUSH
  flushall() {
    this.data.clear();
    this.expires.clear();
    return true;
  }
}

// =============================================
// 2️⃣ نظام Message Queue محلي
// =============================================

class LocalMessageQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.queues = new Map();
    this.workers = new Map();
    this.persistPath = options.persistPath || './access-network-data/queue-data.json';
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 5000;
    
    this.stats = {
      processed: 0,
      failed: 0,
      pending: 0
    };
    
    this.initialize();
  }
  
  async initialize() {
    await this.loadFromDisk();
    setInterval(() => this.saveToDisk(), 30000);
  }
  
  // إنشاء طابور
  createQueue(name, options = {}) {
    if (!this.queues.has(name)) {
      this.queues.set(name, {
        name,
        jobs: [],
        processing: [],
        failed: [],
        options: {
          concurrency: options.concurrency || 5,
          timeout: options.timeout || 30000
        }
      });
    }
    return this.queues.get(name);
  }
  
  // إضافة مهمة
  async add(queueName, data, options = {}) {
    const queue = this.createQueue(queueName);
    
    const job = {
      id: crypto.randomUUID(),
      data,
      attempts: 0,
      maxAttempts: options.maxAttempts || this.maxRetries,
      delay: options.delay || 0,
      priority: options.priority || 0,
      createdAt: Date.now(),
      scheduledAt: Date.now() + (options.delay || 0),
      status: 'pending'
    };
    
    queue.jobs.push(job);
    queue.jobs.sort((a, b) => b.priority - a.priority || a.scheduledAt - b.scheduledAt);
    
    this.stats.pending++;
    this.emit('job:added', queueName, job);
    
    // معالجة فورية إذا كان هناك workers
    this.processQueue(queueName);
    
    return job;
  }
  
  // تسجيل worker
  process(queueName, concurrency, handler) {
    if (typeof concurrency === 'function') {
      handler = concurrency;
      concurrency = 1;
    }
    
    this.createQueue(queueName, { concurrency });
    
    if (!this.workers.has(queueName)) {
      this.workers.set(queueName, []);
    }
    
    this.workers.get(queueName).push(handler);
    
    // بدء المعالجة
    this.processQueue(queueName);
    
    return this;
  }
  
  // معالجة الطابور
  async processQueue(queueName) {
    const queue = this.queues.get(queueName);
    const workers = this.workers.get(queueName);
    
    if (!queue || !workers || workers.length === 0) return;
    
    const now = Date.now();
    const availableSlots = queue.options.concurrency - queue.processing.length;
    
    if (availableSlots <= 0) return;
    
    // الحصول على المهام الجاهزة
    const readyJobs = queue.jobs
      .filter(j => j.scheduledAt <= now && j.status === 'pending')
      .slice(0, availableSlots);
    
    for (const job of readyJobs) {
      job.status = 'processing';
      job.startedAt = now;
      queue.processing.push(job);
      queue.jobs = queue.jobs.filter(j => j.id !== job.id);
      
      // معالجة المهمة
      this.executeJob(queueName, job, workers[0]);
    }
  }
  
  // تنفيذ المهمة
  async executeJob(queueName, job, handler) {
    const queue = this.queues.get(queueName);
    
    try {
      job.attempts++;
      
      // timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Job timeout')), queue.options.timeout);
      });
      
      const result = await Promise.race([
        handler(job),
        timeoutPromise
      ]);
      
      // نجاح
      job.status = 'completed';
      job.result = result;
      job.completedAt = Date.now();
      
      queue.processing = queue.processing.filter(j => j.id !== job.id);
      this.stats.processed++;
      this.stats.pending--;
      
      this.emit('job:completed', queueName, job);
      
    } catch (error) {
      job.lastError = error.message;
      
      if (job.attempts < job.maxAttempts) {
        // إعادة المحاولة
        job.status = 'pending';
        job.scheduledAt = Date.now() + (this.retryDelay * job.attempts);
        queue.processing = queue.processing.filter(j => j.id !== job.id);
        queue.jobs.push(job);
        
        this.emit('job:retry', queueName, job);
        
        setTimeout(() => this.processQueue(queueName), this.retryDelay);
      } else {
        // فشل نهائي
        job.status = 'failed';
        job.failedAt = Date.now();
        queue.processing = queue.processing.filter(j => j.id !== job.id);
        queue.failed.push(job);
        
        this.stats.failed++;
        this.stats.pending--;
        
        this.emit('job:failed', queueName, job);
      }
    }
    
    // معالجة المزيد
    setImmediate(() => this.processQueue(queueName));
  }
  
  // إحصائيات الطابور
  getQueueStats(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) return null;
    
    return {
      pending: queue.jobs.length,
      processing: queue.processing.length,
      failed: queue.failed.length,
      total: queue.jobs.length + queue.processing.length + queue.failed.length
    };
  }
  
  // حفظ
  async saveToDisk() {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const data = {};
      for (const [name, queue] of this.queues) {
        data[name] = {
          jobs: queue.jobs,
          failed: queue.failed.slice(-100) // آخر 100 فشل فقط
        };
      }
      
      fs.writeFileSync(this.persistPath, JSON.stringify(data));
    } catch (e) {
      console.error('Queue persist error:', e.message);
    }
  }
  
  // تحميل
  async loadFromDisk() {
    try {
      if (fs.existsSync(this.persistPath)) {
        const raw = fs.readFileSync(this.persistPath, 'utf8');
        const data = JSON.parse(raw);
        
        for (const [name, queueData] of Object.entries(data)) {
          const queue = this.createQueue(name);
          queue.jobs = queueData.jobs || [];
          queue.failed = queueData.failed || [];
          this.stats.pending += queue.jobs.length;
        }
      }
    } catch (e) {
      console.error('Queue load error:', e.message);
    }
  }
}

// =============================================
// 3️⃣ نظام Session Store موزع
// =============================================

class DistributedSessionStore {
  constructor(redis, options = {}) {
    this.redis = redis;
    this.prefix = options.prefix || 'sess:';
    this.ttl = options.ttl || 86400000; // 24 ساعة
  }
  
  async get(sessionId) {
    return this.redis.get(this.prefix + sessionId);
  }
  
  async set(sessionId, data, ttl = this.ttl) {
    return this.redis.set(this.prefix + sessionId, data, ttl);
  }
  
  async destroy(sessionId) {
    return this.redis.delete(this.prefix + sessionId);
  }
  
  async touch(sessionId, ttl = this.ttl) {
    return this.redis.expire(this.prefix + sessionId, ttl / 1000);
  }
  
  async all() {
    const keys = this.redis.keys(this.prefix + '*');
    const sessions = {};
    for (const key of keys) {
      sessions[key.replace(this.prefix, '')] = this.redis.get(key);
    }
    return sessions;
  }
  
  async length() {
    return this.redis.keys(this.prefix + '*').length;
  }
  
  async clear() {
    const keys = this.redis.keys(this.prefix + '*');
    keys.forEach(key => this.redis.delete(key));
    return true;
  }
}

// =============================================
// 4️⃣ نظام Rate Limiter موزع
// =============================================

class DistributedRateLimiter {
  constructor(redis, options = {}) {
    this.redis = redis;
    this.prefix = options.prefix || 'rl:';
    this.windowMs = options.windowMs || 60000; // 1 دقيقة
    this.maxRequests = options.maxRequests || 100;
  }
  
  async isAllowed(identifier) {
    const key = this.prefix + identifier;
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // الحصول على الطلبات في النافذة الحالية
    const requests = this.redis.get(key) || [];
    
    // تنظيف الطلبات القديمة
    const validRequests = requests.filter(ts => ts > windowStart);
    
    if (validRequests.length >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: Math.min(...validRequests) + this.windowMs
      };
    }
    
    // إضافة الطلب الجديد
    validRequests.push(now);
    this.redis.set(key, validRequests, this.windowMs);
    
    return {
      allowed: true,
      remaining: this.maxRequests - validRequests.length,
      resetAt: now + this.windowMs
    };
  }
  
  async reset(identifier) {
    return this.redis.delete(this.prefix + identifier);
  }
  
  async getStatus(identifier) {
    const key = this.prefix + identifier;
    const requests = this.redis.get(key) || [];
    const windowStart = Date.now() - this.windowMs;
    const validRequests = requests.filter(ts => ts > windowStart);
    
    return {
      used: validRequests.length,
      remaining: Math.max(0, this.maxRequests - validRequests.length),
      limit: this.maxRequests
    };
  }
}

// =============================================
// 5️⃣ نظام Cache متقدم مع LRU
// =============================================

class AdvancedCache {
  constructor(redis, options = {}) {
    this.redis = redis;
    this.prefix = options.prefix || 'cache:';
    this.defaultTTL = options.defaultTTL || 300000; // 5 دقائق
    this.maxSize = options.maxSize || 10000;
    this.accessOrder = [];
  }
  
  async get(key, fetchFn = null) {
    const fullKey = this.prefix + key;
    let value = this.redis.get(fullKey);
    
    if (value !== null) {
      // تحديث ترتيب الوصول (LRU)
      this.updateAccessOrder(fullKey);
      return value;
    }
    
    // إذا لم يوجد وهناك دالة جلب
    if (fetchFn) {
      value = await fetchFn();
      await this.set(key, value);
      return value;
    }
    
    return null;
  }
  
  async set(key, value, ttl = this.defaultTTL) {
    const fullKey = this.prefix + key;
    
    // التأكد من عدم تجاوز الحد الأقصى
    if (this.accessOrder.length >= this.maxSize) {
      this.evictLRU();
    }
    
    this.redis.set(fullKey, value, ttl);
    this.updateAccessOrder(fullKey);
    return true;
  }
  
  async delete(key) {
    const fullKey = this.prefix + key;
    this.accessOrder = this.accessOrder.filter(k => k !== fullKey);
    return this.redis.delete(fullKey);
  }
  
  async invalidatePattern(pattern) {
    const keys = this.redis.keys(this.prefix + pattern);
    keys.forEach(key => {
      this.redis.delete(key);
      this.accessOrder = this.accessOrder.filter(k => k !== key);
    });
    return keys.length;
  }
  
  updateAccessOrder(key) {
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);
  }
  
  evictLRU() {
    const toEvict = this.accessOrder.slice(0, Math.floor(this.maxSize * 0.1));
    toEvict.forEach(key => {
      this.redis.delete(key);
    });
    this.accessOrder = this.accessOrder.slice(toEvict.length);
  }
  
  async mget(keys) {
    const result = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }
  
  async mset(entries, ttl = this.defaultTTL) {
    for (const [key, value] of Object.entries(entries)) {
      await this.set(key, value, ttl);
    }
    return true;
  }
}

// =============================================
// 6️⃣ نظام Pub/Sub للتزامن بين Workers
// =============================================

class LocalPubSub {
  constructor(redis) {
    this.redis = redis;
    this.channels = new Map();
  }
  
  subscribe(channel, handler) {
    this.redis.subscribe(channel, handler);
    return () => this.unsubscribe(channel, handler);
  }
  
  unsubscribe(channel, handler) {
    this.redis.unsubscribe(channel, handler);
  }
  
  publish(channel, message) {
    return this.redis.publish(channel, message);
  }
  
  // Broadcast to all channels matching pattern
  psubscribe(pattern, handler) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    this.redis.on('message', (channel, message) => {
      if (regex.test(channel)) {
        handler(channel, message);
      }
    });
  }
}

// =============================================
// 7️⃣ نظام Worker Pool للمعالجة المتوازية
// =============================================

class WorkerPool {
  constructor(options = {}) {
    this.size = options.size || os.cpus().length;
    this.workers = [];
    this.taskQueue = [];
    this.activeWorkers = 0;
  }
  
  async execute(task) {
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ task, resolve, reject });
      this.processNext();
    });
  }
  
  async processNext() {
    if (this.activeWorkers >= this.size || this.taskQueue.length === 0) {
      return;
    }
    
    const { task, resolve, reject } = this.taskQueue.shift();
    this.activeWorkers++;
    
    try {
      const result = await task();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.activeWorkers--;
      setImmediate(() => this.processNext());
    }
  }
  
  async executeAll(tasks) {
    return Promise.all(tasks.map(task => this.execute(task)));
  }
  
  async executeBatch(tasks, batchSize = this.size) {
    const results = [];
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      const batchResults = await this.executeAll(batch);
      results.push(...batchResults);
    }
    return results;
  }
}

// =============================================
// 8️⃣ نظام Connection Pool للقاعدة
// =============================================

class ConnectionPoolManager {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.maxConnections = options.maxConnections || 50;
    this.minConnections = options.minConnections || 5;
    this.acquireTimeout = options.acquireTimeout || 10000;
    this.idleTimeout = options.idleTimeout || 30000;
    
    this.stats = {
      acquired: 0,
      released: 0,
      waiting: 0,
      errors: 0
    };
    
    this.waitingQueue = [];
  }
  
  async query(sql, params = []) {
    const startTime = Date.now();
    
    try {
      this.stats.acquired++;
      const result = await this.pool.query(sql, params);
      this.stats.released++;
      
      return result;
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }
  
  async transaction(callback) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  getStats() {
    return {
      ...this.stats,
      poolSize: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount
    };
  }
}

// =============================================
// 9️⃣ المنسق الرئيسي للبنية التحتية
// =============================================

class DistributedInfrastructure {
  constructor() {
    this.redis = null;
    this.queue = null;
    this.sessionStore = null;
    this.rateLimiter = null;
    this.cache = null;
    this.pubsub = null;
    this.workerPool = null;
    this.initialized = false;
  }
  
  async initialize(options = {}) {
    
    // 1. Redis-like store
    this.redis = new LocalRedis({
      persistPath: options.redisPath || './access-network-data/redis-data.json',
      maxMemory: options.maxMemory || 500 * 1024 * 1024
    });
    
    // 2. Message Queue
    this.queue = new LocalMessageQueue({
      persistPath: options.queuePath || './access-network-data/queue-data.json'
    });
    
    // 3. Session Store
    this.sessionStore = new DistributedSessionStore(this.redis, {
      ttl: options.sessionTTL || 86400000
    });
    
    // 4. Rate Limiter
    this.rateLimiter = new DistributedRateLimiter(this.redis, {
      windowMs: options.rateLimitWindow || 60000,
      maxRequests: options.rateLimitMax || 100
    });
    
    // 5. Advanced Cache
    this.cache = new AdvancedCache(this.redis, {
      defaultTTL: options.cacheTTL || 300000,
      maxSize: options.cacheMaxSize || 10000
    });
    
    // 6. Pub/Sub
    this.pubsub = new LocalPubSub(this.redis);
    
    // 7. Worker Pool
    this.workerPool = new WorkerPool({
      size: options.workerPoolSize || os.cpus().length
    });
    
    this.initialized = true;
    return this;
  }
  
  // Middleware للـ Express
  rateLimitMiddleware(options = {}) {
    const limiter = new DistributedRateLimiter(this.redis, options);
    
    return async (req, res, next) => {
      const identifier = req.ip || req.connection.remoteAddress;
      const result = await limiter.isAllowed(identifier);
      
      res.setHeader('X-RateLimit-Limit', limiter.maxRequests);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', result.resetAt);
      
      if (!result.allowed) {
        return res.status(429).json({
          error: 'Too Many Requests',
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000)
        });
      }
      
      next();
    };
  }
  
  // Session middleware
  sessionMiddleware(options = {}) {
    return async (req, res, next) => {
      const sessionId = req.cookies?.sessionId || req.headers['x-session-id'];
      
      if (sessionId) {
        req.session = await this.sessionStore.get(sessionId);
      }
      
      if (!req.session) {
        req.session = {};
        req.sessionId = crypto.randomUUID();
      } else {
        req.sessionId = sessionId;
      }
      
      // حفظ الجلسة عند الانتهاء
      res.on('finish', async () => {
        if (req.session && Object.keys(req.session).length > 0) {
          await this.sessionStore.set(req.sessionId, req.session);
        }
      });
      
      next();
    };
  }
  
  // Cache middleware
  cacheMiddleware(options = {}) {
    const ttl = options.ttl || 60000;
    const keyFn = options.keyFn || (req => `route:${req.method}:${req.originalUrl}`);
    
    return async (req, res, next) => {
      if (req.method !== 'GET') {
        return next();
      }
      
      const key = keyFn(req);
      const cached = await this.cache.get(key);
      
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }
      
      const originalJson = res.json.bind(res);
      res.json = async (data) => {
        await this.cache.set(key, data, ttl);
        res.setHeader('X-Cache', 'MISS');
        return originalJson(data);
      };
      
      next();
    };
  }
  
  // إحصائيات شاملة
  getStats() {
    return {
      redis: this.redis.getStats(),
      queue: {
        transactions: this.queue.getQueueStats('transactions'),
        blocks: this.queue.getQueueStats('blocks')
      },
      sessions: {
        count: this.sessionStore.length()
      },
      workerPool: {
        size: this.workerPool.size,
        active: this.workerPool.activeWorkers,
        queued: this.workerPool.taskQueue.length
      }
    };
  }
}

// =============================================
// تصدير
// =============================================

const infrastructure = new DistributedInfrastructure();

export {
  LocalRedis,
  LocalMessageQueue,
  DistributedSessionStore,
  DistributedRateLimiter,
  AdvancedCache,
  LocalPubSub,
  WorkerPool,
  ConnectionPoolManager,
  DistributedInfrastructure,
  infrastructure
};

export default infrastructure;
