import { pool } from './db.js';

class UltraFastCache {
  constructor() {
    this.l1Cache = new Map();
    this.l2Cache = new Map(); 
    this.l3Cache = new Map();
    
    this.l1MaxSize = 10000;
    this.l2MaxSize = 100000; 
    this.l3MaxSize = 1000000;
    
    this.l1TTL = 5000;
    this.l2TTL = 30000;
    this.l3TTL = 300000;
    
    this.stats = {
      l1Hits: 0,
      l2Hits: 0,
      l3Hits: 0,
      dbHits: 0,
      misses: 0,
      writes: 0
    };
    
    this.startCleanup();
    this.startDbSync();
  }

  async getBalance(address) {
    const normalizedAddress = address.toLowerCase();
    const now = Date.now();
    
    if (this.l1Cache.has(normalizedAddress)) {
      const entry = this.l1Cache.get(normalizedAddress);
      if (now - entry.timestamp < this.l1TTL) {
        this.stats.l1Hits++;
        return entry.balance;
      }
    }
    
    if (this.l2Cache.has(normalizedAddress)) {
      const entry = this.l2Cache.get(normalizedAddress);
      if (now - entry.timestamp < this.l2TTL) {
        this.stats.l2Hits++;
        this.promoteToL1(normalizedAddress, entry.balance);
        return entry.balance;
      }
    }
    
    if (this.l3Cache.has(normalizedAddress)) {
      const entry = this.l3Cache.get(normalizedAddress);
      if (now - entry.timestamp < this.l3TTL) {
        this.stats.l3Hits++;
        this.promoteToL2(normalizedAddress, entry.balance);
        return entry.balance;
      }
    }
    
    this.stats.dbHits++;
    const balance = await this.loadFromDatabase(normalizedAddress);
    this.setBalance(normalizedAddress, balance, 'L3');
    return balance;
  }

  async loadFromDatabase(address) {
    try {
      let result = await pool.query(
        'SELECT balance FROM balance_cache WHERE address = $1',
        [address]
      );
      
      if (result.rows.length > 0) {
        return parseFloat(result.rows[0].balance) || 0;
      }
      
      result = await pool.query(
        'SELECT coins FROM users WHERE LOWER(wallet_address) = $1',
        [address]
      );
      
      if (result.rows.length > 0) {
        const balance = parseFloat(result.rows[0].coins) || 0;
        await this.saveToBalanceCache(address, balance);
        return balance;
      }
      
      result = await pool.query(
        'SELECT balance FROM external_wallets WHERE LOWER(address) = $1',
        [address]
      );
      
      if (result.rows.length > 0) {
        const balance = parseFloat(result.rows[0].balance) || 0;
        await this.saveToBalanceCache(address, balance);
        return balance;
      }
      
      return 0;
      
    } catch (error) {
      console.error('خطأ في تحميل الرصيد من قاعدة البيانات:', error);
      return 0;
    }
  }

  async saveToBalanceCache(address, balance) {
    try {
      await pool.query(`
        INSERT INTO balance_cache (address, balance, last_updated, block_number, cache_level)
        VALUES ($1, $2, $3, $4, 1)
        ON CONFLICT (address) DO UPDATE SET
          balance = EXCLUDED.balance,
          last_updated = EXCLUDED.last_updated,
          cache_level = EXCLUDED.cache_level
      `, [address, balance, Date.now(), 0]);
    } catch (error) {
      console.error('خطأ في حفظ cache في قاعدة البيانات:', error);
    }
  }

  setBalance(address, balance, level = 'L1') {
    const normalizedAddress = address.toLowerCase();
    const entry = { balance, timestamp: Date.now() };
    
    if (level === 'L1') {
      this.l1Cache.set(normalizedAddress, entry);
      if (this.l1Cache.size > this.l1MaxSize) {
        const firstKey = this.l1Cache.keys().next().value;
        const demotedEntry = this.l1Cache.get(firstKey);
        this.l1Cache.delete(firstKey);
        this.l2Cache.set(firstKey, demotedEntry);
      }
    } else if (level === 'L2') {
      this.l2Cache.set(normalizedAddress, entry);
      if (this.l2Cache.size > this.l2MaxSize) {
        const firstKey = this.l2Cache.keys().next().value;
        const demotedEntry = this.l2Cache.get(firstKey);
        this.l2Cache.delete(firstKey);
        this.l3Cache.set(firstKey, demotedEntry);
      }
    } else {
      this.l3Cache.set(normalizedAddress, entry);
      if (this.l3Cache.size > this.l3MaxSize) {
        const firstKey = this.l3Cache.keys().next().value;
        this.l3Cache.delete(firstKey);
      }
    }
    
    this.stats.writes++;
  }

  promoteToL1(address, balance) {
    this.l1Cache.set(address, { balance, timestamp: Date.now() });
    this.l2Cache.delete(address);
    this.l3Cache.delete(address);
  }

  promoteToL2(address, balance) {
    this.l2Cache.set(address, { balance, timestamp: Date.now() });
    this.l3Cache.delete(address);
  }

  invalidate(address) {
    const normalizedAddress = address.toLowerCase();
    this.l1Cache.delete(normalizedAddress);
    this.l2Cache.delete(normalizedAddress);
    this.l3Cache.delete(normalizedAddress);
  }

  startCleanup() {
    setInterval(() => {
      const now = Date.now();
      
      for (const [key, entry] of this.l1Cache.entries()) {
        if (now - entry.timestamp > this.l1TTL) {
          this.l1Cache.delete(key);
        }
      }
      
      for (const [key, entry] of this.l2Cache.entries()) {
        if (now - entry.timestamp > this.l2TTL) {
          this.l2Cache.delete(key);
        }
      }
      
      for (const [key, entry] of this.l3Cache.entries()) {
        if (now - entry.timestamp > this.l3TTL) {
          this.l3Cache.delete(key);
        }
      }
    }, 10000);
  }

  startDbSync() {
    setInterval(async () => {
      const entries = [];
      
      for (const [address, entry] of this.l1Cache.entries()) {
        entries.push({ address, balance: entry.balance, level: 1 });
      }
      
      if (entries.length > 0) {
        try {
          const values = entries.map((e, i) => 
            `($${i*4+1}, $${i*4+2}, $${i*4+3}, $${i*4+4})`
          ).join(',');
          
          const params = entries.flatMap(e => 
            [e.address, e.balance, Date.now(), e.level]
          );
          
          await pool.query(`
            INSERT INTO balance_cache (address, balance, last_updated, cache_level)
            VALUES ${values}
            ON CONFLICT (address) DO UPDATE SET
              balance = EXCLUDED.balance,
              last_updated = EXCLUDED.last_updated,
              cache_level = EXCLUDED.cache_level
          `, params);
        } catch (error) {
          console.error('خطأ في مزامنة cache مع قاعدة البيانات:', error);
        }
      }
    }, 60000);
  }

  getStats() {
    const totalRequests = this.stats.l1Hits + this.stats.l2Hits + 
                          this.stats.l3Hits + this.stats.dbHits + this.stats.misses;
    const hitRate = totalRequests > 0 ? 
      ((this.stats.l1Hits + this.stats.l2Hits + this.stats.l3Hits) / totalRequests * 100).toFixed(2) : 0;
    
    return {
      ...this.stats,
      totalRequests,
      hitRate: `${hitRate}%`,
      l1Size: this.l1Cache.size,
      l2Size: this.l2Cache.size,
      l3Size: this.l3Cache.size,
      totalCached: this.l1Cache.size + this.l2Cache.size + this.l3Cache.size
    };
  }
}

const ultraCache = new UltraFastCache();
export default ultraCache;
