
// نظام التخزين المتقدم للمعاملات الضخمة
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pool } from './db.js';

class EnterpriseBlockchainStorage {
  constructor(dataDir = './blockchain-data') {
    this.dataDir = dataDir;
    this.partitionSize = 10000; // 10k معاملة لكل ملف
    this.compressionEnabled = true;
    this.indexCache = new Map();
    this.maxMemoryBlocks = 100; // حد أقصى للكتل في الذاكرة
    
    this.initializeEnterpriseStorage();
  }

  // تهيئة نظام التخزين المتقدم
  async initializeEnterpriseStorage() {
    try {
      // إنشاء هيكل مجلدات متقدم
      const dirs = [
        path.join(this.dataDir, 'blocks'),
        path.join(this.dataDir, 'transactions'),
        path.join(this.dataDir, 'indexes'),
        path.join(this.dataDir, 'cache'),
        path.join(this.dataDir, 'archives')
      ];

      dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      });

      // إنشاء جداول قاعدة البيانات للفهرسة
      await this.createIndexTables();
      
      console.log('🏢 Enterprise storage system initialized');
    } catch (error) {
      console.error('❌ Error initializing enterprise storage:', error);
    }
  }

  // إنشاء جداول الفهرسة في قاعدة البيانات
  async createIndexTables() {
    try {
      // فهرس الكتل
      await pool.query(`
        CREATE TABLE IF NOT EXISTS block_index (
          block_number INTEGER PRIMARY KEY,
          block_hash VARCHAR(66) UNIQUE NOT NULL,
          file_path VARCHAR(255) NOT NULL,
          timestamp BIGINT NOT NULL,
          transaction_count INTEGER DEFAULT 0,
          file_size BIGINT DEFAULT 0,
          compressed BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // فهرس المعاملات
      await pool.query(`
        CREATE TABLE IF NOT EXISTS transaction_index (
          id SERIAL PRIMARY KEY,
          tx_hash VARCHAR(66) UNIQUE NOT NULL,
          block_number INTEGER,
          from_address VARCHAR(42),
          to_address VARCHAR(42),
          amount DECIMAL(20, 8),
          timestamp BIGINT NOT NULL,
          file_partition INTEGER,
          position_in_file INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // فهرس العناوين
      await pool.query(`
        CREATE TABLE IF NOT EXISTS address_index (
          address VARCHAR(42) PRIMARY KEY,
          first_seen BIGINT NOT NULL,
          last_activity BIGINT NOT NULL,
          transaction_count INTEGER DEFAULT 0,
          total_received DECIMAL(20, 8) DEFAULT 0,
          total_sent DECIMAL(20, 8) DEFAULT 0,
          current_balance DECIMAL(20, 8) DEFAULT 0
        )
      `);

      // إنشاء فهارس للبحث السريع
      await pool.query('CREATE INDEX IF NOT EXISTS idx_tx_from_address ON transaction_index(from_address)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_tx_to_address ON transaction_index(to_address)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_tx_timestamp ON transaction_index(timestamp)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_block_timestamp ON block_index(timestamp)');

      console.log('📊 Database indexes created for enterprise storage');
    } catch (error) {
      console.error('❌ Error creating index tables:', error);
    }
  }

  // حفظ كتلة مع التقسيم والضغط
  async saveBlockEnterprise(block) {
    try {
      const blockNumber = block.index;
      const blockDir = path.join(this.dataDir, 'blocks', Math.floor(blockNumber / 1000).toString());
      
      if (!fs.existsSync(blockDir)) {
        fs.mkdirSync(blockDir, { recursive: true });
      }

      const fileName = `block_${blockNumber}.json`;
      const filePath = path.join(blockDir, fileName);
      
      // ضغط البيانات إذا كانت كبيرة
      let blockData = JSON.stringify(block, null, 2);
      let compressed = false;
      
      if (blockData.length > 50000) { // أكبر من 50KB
        blockData = await this.compressData(blockData);
        compressed = true;
      }

      fs.writeFileSync(filePath, blockData);

      // تحديث فهرس قاعدة البيانات
      await pool.query(`
        INSERT INTO block_index (block_number, block_hash, file_path, timestamp, transaction_count, file_size, compressed)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (block_number) DO UPDATE SET
          block_hash = $2, file_path = $3, timestamp = $4, 
          transaction_count = $5, file_size = $6, compressed = $7
      `, [
        blockNumber, block.hash, filePath, block.timestamp,
        block.transactions.length, blockData.length, compressed
      ]);

      // فهرسة المعاملات
      await this.indexTransactions(block.transactions, blockNumber);

      console.log(`💾 Block ${blockNumber} saved with enterprise storage (compressed: ${compressed})`);
      return true;
    } catch (error) {
      console.error('❌ Error saving block:', error);
      return false;
    }
  }

  // فهرسة المعاملات
  async indexTransactions(transactions, blockNumber) {
    try {
      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];
        
        // إضافة المعاملة للفهرس
        await pool.query(`
          INSERT INTO transaction_index 
          (tx_hash, block_number, from_address, to_address, amount, timestamp, position_in_file)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (tx_hash) DO NOTHING
        `, [
          tx.txId || tx.hash, blockNumber, tx.fromAddress, tx.toAddress,
          tx.amount, tx.timestamp, i
        ]);

        // تحديث فهرس العناوين
        if (tx.fromAddress) {
          await this.updateAddressIndex(tx.fromAddress, tx.amount, 'sent', tx.timestamp);
        }
        if (tx.toAddress) {
          await this.updateAddressIndex(tx.toAddress, tx.amount, 'received', tx.timestamp);
        }
      }
    } catch (error) {
      console.error('❌ Error indexing transactions:', error);
    }
  }

  // تحديث فهرس العناوين
  async updateAddressIndex(address, amount, type, timestamp) {
    try {
      const existing = await pool.query('SELECT * FROM address_index WHERE address = $1', [address]);
      
      if (existing.rows.length === 0) {
        // عنوان جديد
        await pool.query(`
          INSERT INTO address_index (address, first_seen, last_activity, transaction_count, total_received, total_sent)
          VALUES ($1, $2, $2, 1, $3, $4)
        `, [
          address, timestamp,
          type === 'received' ? amount : 0,
          type === 'sent' ? amount : 0
        ]);
      } else {
        // تحديث عنوان موجود
        const updates = {
          last_activity: timestamp,
          transaction_count: 'transaction_count + 1',
          total_received: type === 'received' ? `total_received + ${amount}` : 'total_received',
          total_sent: type === 'sent' ? `total_sent + ${amount}` : 'total_sent'
        };

        await pool.query(`
          UPDATE address_index SET 
            last_activity = $1,
            transaction_count = transaction_count + 1,
            total_received = CASE WHEN $2 = 'received' THEN total_received + $3 ELSE total_received END,
            total_sent = CASE WHEN $2 = 'sent' THEN total_sent + $3 ELSE total_sent END
          WHERE address = $4
        `, [timestamp, type, amount, address]);
      }
    } catch (error) {
      console.error('❌ Error updating address index:', error);
    }
  }

  // البحث السريع في المعاملات
  async searchTransactions(criteria, limit = 100, offset = 0) {
    try {
      let query = 'SELECT * FROM transaction_index WHERE 1=1';
      const params = [];
      let paramCount = 0;

      if (criteria.address) {
        paramCount++;
        query += ` AND (from_address = $${paramCount} OR to_address = $${paramCount})`;
        params.push(criteria.address);
      }

      if (criteria.fromAddress) {
        paramCount++;
        query += ` AND from_address = $${paramCount}`;
        params.push(criteria.fromAddress);
      }

      if (criteria.toAddress) {
        paramCount++;
        query += ` AND to_address = $${paramCount}`;
        params.push(criteria.toAddress);
      }

      if (criteria.startTime) {
        paramCount++;
        query += ` AND timestamp >= $${paramCount}`;
        params.push(criteria.startTime);
      }

      if (criteria.endTime) {
        paramCount++;
        query += ` AND timestamp <= $${paramCount}`;
        params.push(criteria.endTime);
      }

      query += ` ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`;

      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('❌ Error searching transactions:', error);
      return [];
    }
  }

  // ضغط البيانات
  async compressData(data) {
    const zlib = await import('zlib');
    return new Promise((resolve, reject) => {
      zlib.gzip(data, (err, compressed) => {
        if (err) reject(err);
        else resolve(compressed);
      });
    });
  }

  // إلغاء ضغط البيانات
  async decompressData(compressedData) {
    const zlib = await import('zlib');
    return new Promise((resolve, reject) => {
      zlib.gunzip(compressedData, (err, decompressed) => {
        if (err) reject(err);
        else resolve(decompressed.toString());
      });
    });
  }

  // تحميل كتلة بالفهرسة
  async loadBlockEnterprise(blockNumber) {
    try {
      // البحث في الفهرس أولاً
      const indexResult = await pool.query(
        'SELECT * FROM block_index WHERE block_number = $1',
        [blockNumber]
      );

      if (indexResult.rows.length === 0) {
        console.log(`Block ${blockNumber} not found in index`);
        return null;
      }

      const blockInfo = indexResult.rows[0];
      let blockData = fs.readFileSync(blockInfo.file_path);

      // إلغاء الضغط إذا لزم الأمر
      if (blockInfo.compressed) {
        blockData = await this.decompressData(blockData);
      } else {
        blockData = blockData.toString();
      }

      return JSON.parse(blockData);
    } catch (error) {
      console.error(`❌ Error loading block ${blockNumber}:`, error);
      return null;
    }
  }

  // إحصائيات الأداء
  async getStorageStats() {
    try {
      const stats = {};

      // إحصائيات الكتل
      const blockStats = await pool.query(`
        SELECT 
          COUNT(*) as total_blocks,
          SUM(file_size) as total_size,
          AVG(transaction_count) as avg_transactions_per_block,
          SUM(transaction_count) as total_transactions
        FROM block_index
      `);

      stats.blocks = blockStats.rows[0];

      // إحصائيات العناوين
      const addressStats = await pool.query(`
        SELECT 
          COUNT(*) as total_addresses,
          SUM(transaction_count) as total_address_transactions
        FROM address_index
      `);

      stats.addresses = addressStats.rows[0];

      // استخدام القرص
      const diskUsage = this.calculateDiskUsage();
      stats.disk = diskUsage;

      return stats;
    } catch (error) {
      console.error('❌ Error getting storage stats:', error);
      return {};
    }
  }

  // حساب استخدام القرص
  calculateDiskUsage() {
    try {
      let totalSize = 0;
      const calculateDirSize = (dirPath) => {
        const files = fs.readdirSync(dirPath);
        files.forEach(file => {
          const filePath = path.join(dirPath, file);
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            calculateDirSize(filePath);
          } else {
            totalSize += stats.size;
          }
        });
      };

      calculateDirSize(this.dataDir);
      return {
        totalBytes: totalSize,
        totalMB: (totalSize / (1024 * 1024)).toFixed(2),
        totalGB: (totalSize / (1024 * 1024 * 1024)).toFixed(2)
      };
    } catch (error) {
      console.error('❌ Error calculating disk usage:', error);
      return { totalBytes: 0, totalMB: 0, totalGB: 0 };
    }
  }

  // أرشفة البيانات القديمة
  async archiveOldData(daysOld = 365) {
    try {
      const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
      
      const oldBlocks = await pool.query(
        'SELECT * FROM block_index WHERE timestamp < $1',
        [cutoffTime]
      );

      let archivedCount = 0;
      for (const block of oldBlocks.rows) {
        const archivePath = path.join(this.dataDir, 'archives', `archived_block_${block.block_number}.json.gz`);
        
        // نقل الملف للأرشيف مع الضغط
        const blockData = fs.readFileSync(block.file_path);
        const compressed = await this.compressData(blockData);
        fs.writeFileSync(archivePath, compressed);
        
        // حذف الملف الأصلي
        fs.unlinkSync(block.file_path);
        
        // تحديث الفهرس
        await pool.query(
          'UPDATE block_index SET file_path = $1, compressed = true WHERE block_number = $2',
          [archivePath, block.block_number]
        );
        
        archivedCount++;
      }

      console.log(`📦 Archived ${archivedCount} old blocks`);
      return archivedCount;
    } catch (error) {
      console.error('❌ Error archiving old data:', error);
      return 0;
    }
  }
}

export default EnterpriseBlockchainStorage;
