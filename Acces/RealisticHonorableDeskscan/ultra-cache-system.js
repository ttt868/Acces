// =============================================
// ⚡ ACCESS Network - Ultra Cache System
// Redis مشترك بين كل الـ PM2 Cluster Instances
// مع Map() كـ fallback في حالة تعطل Redis
// =============================================

import Redis from "ioredis";

class UltraCacheSystem {
  constructor() {
    this.prefix = "ucache:";
    this.defaultTTL = 60; // ثانية
    this.connected = false;
    this.fallbackCache = new Map(); // fallback لو Redis تعطل
    this.stats = { hits: 0, misses: 0, total: 0 };

    // اتصال Redis مع إعادة محاولة تلقائية
    this.redis = new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD || "AccessRedis2026Secure",
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 3000),
      lazyConnect: true,
      enableReadyCheck: true,
    });

    this.redis.on("connect", () => {
      this.connected = true;
    });

    this.redis.on("error", () => {
      this.connected = false;
    });

    this.redis.on("close", () => {
      this.connected = false;
    });

    this.connect();

    // تنظيف fallback كل 5 دقائق
    setInterval(() => this._cleanupFallback(), 300000);
  }

  async connect() {
    try {
      await this.redis.connect();
    } catch (e) {
      console.warn("⚠️ UltraCache: Redis unavailable, using fallback Map");
      this.connected = false;
    }
  }

  // ========== User Cache ==========
  async getUser(email) {
    this.stats.total++;
    try {
      if (this.connected) {
        const data = await this.redis.get(`${this.prefix}user:${email}`);
        if (data) {
          this.stats.hits++;
          return JSON.parse(data);
        }
      } else {
        const cached = this.fallbackCache.get(`user:${email}`);
        if (cached && Date.now() - cached.ts < this.defaultTTL * 1000) {
          this.stats.hits++;
          return cached.data;
        }
      }
    } catch (e) {}
    this.stats.misses++;
    return null;
  }

  setUser(email, userData) {
    try {
      if (this.connected) {
        this.redis.setex(
          `${this.prefix}user:${email}`,
          this.defaultTTL,
          JSON.stringify(userData)
        );
      } else {
        this.fallbackCache.set(`user:${email}`, {
          data: userData,
          ts: Date.now(),
        });
      }
    } catch (e) {}
  }

  async deleteUser(email) {
    try {
      if (this.connected) {
        await this.redis.del(`${this.prefix}user:${email}`);
        await this.redis.del(`${this.prefix}user:${email.toLowerCase()}`);
      }
      this.fallbackCache.delete(`user:${email}`);
      this.fallbackCache.delete(`user:${email.toLowerCase()}`);
    } catch (e) {}
  }

  // ========== Balance Cache ==========
  async getBalance(address) {
    this.stats.total++;
    try {
      if (this.connected) {
        const data = await this.redis.get(`${this.prefix}bal:${address}`);
        if (data) {
          this.stats.hits++;
          return parseFloat(data);
        }
      } else {
        const cached = this.fallbackCache.get(`bal:${address}`);
        if (cached && Date.now() - cached.ts < this.defaultTTL * 1000) {
          this.stats.hits++;
          return cached.balance;
        }
      }
    } catch (e) {}
    this.stats.misses++;
    return null;
  }

  setBalance(address, balance) {
    try {
      if (this.connected) {
        this.redis.setex(
          `${this.prefix}bal:${address}`,
          this.defaultTTL,
          balance.toString()
        );
      } else {
        this.fallbackCache.set(`bal:${address}`, {
          balance,
          ts: Date.now(),
        });
      }
    } catch (e) {}
  }

  // ========== Transaction Cache ==========
  async getTransaction(hash) {
    this.stats.total++;
    try {
      if (this.connected) {
        const data = await this.redis.get(`${this.prefix}tx:${hash}`);
        if (data) {
          this.stats.hits++;
          return JSON.parse(data);
        }
      }
    } catch (e) {}
    this.stats.misses++;
    return null;
  }

  setTransaction(hash, txData) {
    try {
      if (this.connected) {
        this.redis.setex(
          `${this.prefix}tx:${hash}`,
          this.defaultTTL,
          JSON.stringify(txData)
        );
      }
    } catch (e) {}
  }


  // ========== Generic Cache (API Middleware) ==========
  async get(key) {
    this.stats.total++;
    try {
      if (this.connected) {
        const data = await this.redis.get(this.prefix + key);
        if (data) {
          this.stats.hits++;
          return data;
        }
      } else {
        const cached = this.fallbackCache.get(key);
        if (cached && Date.now() - cached.ts < (cached.ttl || this.defaultTTL) * 1000) {
          this.stats.hits++;
          return cached.data;
        }
      }
    } catch (e) {}
    this.stats.misses++;
    return null;
  }

  async set(key, value, ttl) {
    const seconds = ttl || this.defaultTTL;
    try {
      if (this.connected) {
        await this.redis.setex(this.prefix + key, seconds, value);
      } else {
        this.fallbackCache.set(key, { data: value, ts: Date.now(), ttl: seconds });
      }
    } catch (e) {}
  }

  async delete(key) {
    try {
      if (this.connected) {
        await this.redis.del(this.prefix + key);
      }
      this.fallbackCache.delete(key);
    } catch (e) {}
  }

  // ========== Stats ==========
  async getStats() {
    const hitRate =
      this.stats.total > 0
        ? ((this.stats.hits / this.stats.total) * 100).toFixed(2) + "%"
        : "0%";

    let totalKeys = 0;
    try {
      if (this.connected) {
        // Use SCAN instead of KEYS for production safety
        let cursor = "0";
        do {
          const [nextCursor, keys] = await this.redis.scan(
            cursor,
            "MATCH",
            `${this.prefix}*`,
            "COUNT",
            100
          );
          totalKeys += keys.length;
          cursor = nextCursor;
        } while (cursor !== "0");
      } else {
        totalKeys = this.fallbackCache.size;
      }
    } catch (e) {}

    return {
      hitRate,
      totalSize: totalKeys,
      connected: this.connected,
      engine: this.connected ? "Redis (shared)" : "Map (fallback)",
      hits: this.stats.hits,
      misses: this.stats.misses,
      total: this.stats.total,
      instance: process.env.NODE_APP_INSTANCE || "0",
    };
  }

  async clearAll() {
    try {
      if (this.connected) {
        let cursor = "0";
        do {
          const [nextCursor, keys] = await this.redis.scan(
            cursor,
            "MATCH",
            `${this.prefix}*`,
            "COUNT",
            100
          );
          if (keys.length > 0) {
            await this.redis.del(...keys);
          }
          cursor = nextCursor;
        } while (cursor !== "0");
      }
      this.fallbackCache.clear();
      this.stats = { hits: 0, misses: 0, total: 0 };
    } catch (e) {}
  }

  // تنظيف Fallback Map من العناصر المنتهية
  _cleanupFallback() {
    const now = Date.now();
    const maxAge = this.defaultTTL * 1000;
    for (const [key, value] of this.fallbackCache.entries()) {
      if (now - value.ts > maxAge) {
        this.fallbackCache.delete(key);
      }
    }
  }
}

// Singleton مشترك
const ultraCache = new UltraCacheSystem();
export default ultraCache;
