
// نظام تخزين دائم للمحافظ الخارجية باستخدام Replit Object Storage
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

class PersistentExternalWalletStorage {
  constructor() {
    this.bucketName = 'external-wallets-persistent';
    this.initializeObjectStorage();
  }

  // تهيئة Object Storage الدائم
  async initializeObjectStorage() {
    try {
      // استخدام bucket افتراضي للمحافظ الخارجية
      const bucketName = process.env.REPLIT_DB_URL ? 'external-wallets-persistent' : 'default-wallets-bucket';
      
      // استخدام Replit Object Storage للتخزين الدائم
      const { Client } = await import('@replit/object-storage');
      this.storage = new Client(bucketName);
      
      // اختبار الاتصال أولاً
      await this.storage.list({ limit: 1 });
      
      // إنشاء هيكل التخزين الدائم
      await this.ensureStorageStructure();
      
      console.log('🗄️ Persistent External Wallet Storage initialized with Object Storage');
      this.isFallback = false;
    } catch (error) {
      console.warn('⚠️ External storage fallback mode:', error.message);
      // Fallback إلى نظام ملفات محلي مؤقت
      this.initializeFallbackStorage();
    }
  }

  // إنشاء هيكل التخزين الدائم
  async ensureStorageStructure() {
    try {
      // إنشاء ملف الفهرس الرئيسي إذا لم يكن موجوداً
      const indexExists = await this.objectExists('index.json');
      if (!indexExists) {
        const initialIndex = {
          wallets: {},
          transactions: {},
          lastUpdate: Date.now(),
          version: '2.0',
          storageType: 'persistent_object_storage'
        };
        await this.storage.uploadFromText('index.json', JSON.stringify(initialIndex, null, 2));
        console.log('📋 Created persistent index file');
      }

      // إنشاء مجلد المحافظ في Object Storage
      const walletsIndexExists = await this.objectExists('wallets/index.json');
      if (!walletsIndexExists) {
        await this.storage.uploadFromText('wallets/index.json', JSON.stringify({
          count: 0,
          lastUpdate: Date.now()
        }));
      }

      // إنشاء مجلد المعاملات في Object Storage
      const txIndexExists = await this.objectExists('transactions/index.json');
      if (!txIndexExists) {
        await this.storage.uploadFromText('transactions/index.json', JSON.stringify({
          count: 0,
          lastUpdate: Date.now()
        }));
      }

      console.log('🏗️ Persistent storage structure ensured');
    } catch (error) {
      console.error('❌ Error ensuring storage structure:', error);
    }
  }

  // التحقق من وجود object في التخزين
  async objectExists(key) {
    try {
      await this.storage.downloadFromText(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  // تسجيل محفظة خارجية في التخزين الدائم
  async registerExternalWallet(walletAddress, metadata = {}) {
    try {
      const walletId = this.generateWalletId(walletAddress);
      const walletKey = `wallets/${walletId}.json`;
      
      const walletData = {
        address: walletAddress.toLowerCase(),
        walletId: walletId,
        registeredAt: Date.now(),
        lastActivity: Date.now(),
        transactionCount: 0,
        balance: 0,
        metadata: metadata,
        transactions: [],
        isPersistent: true,
        storageType: 'object_storage'
      };

      // حفظ في Object Storage الدائم
      await this.storage.uploadFromText(walletKey, JSON.stringify(walletData, null, 2));

      // تحديث الفهرس الدائم
      await this.updatePersistentIndex('wallets', walletAddress.toLowerCase(), {
        walletId: walletId,
        file: `${walletId}.json`,
        registeredAt: Date.now(),
        persistent: true
      });

      console.log(`🆕 External wallet registered in PERSISTENT storage: ${walletAddress}`);
      return walletId;
    } catch (error) {
      console.error('❌ Error registering external wallet in persistent storage:', error);
      return null;
    }
  }

  // حفظ معاملة في التخزين الدائم
  async storeExternalTransaction(transactionData) {
    try {
      const { 
        hash, 
        fromAddress, 
        toAddress, 
        amount, 
        timestamp, 
        gasFee,
        status = 'confirmed'
      } = transactionData;

      const txId = hash || this.generateTransactionId(fromAddress, toAddress, amount, timestamp);
      const txKey = `transactions/${txId}.json`;

      const txData = {
        hash: txId,
        fromAddress: fromAddress?.toLowerCase(),
        toAddress: toAddress?.toLowerCase(),
        amount: parseFloat(amount),
        gasFee: parseFloat(gasFee || 0.00002),
        timestamp: timestamp,
        status: status,
        storedAt: Date.now(),
        type: 'external_transfer',
        network: 'access',
        chainId: '0x5968',
        isPersistent: true,
        storageType: 'object_storage'
      };

      // حفظ في Object Storage الدائم
      await this.storage.uploadFromText(txKey, JSON.stringify(txData, null, 2));

      // تحديث نشاط المحافظ المتأثرة
      if (toAddress) {
        await this.updateWalletActivityPersistent(toAddress, txId, amount, 'received');
      }
      if (fromAddress) {
        await this.updateWalletActivityPersistent(fromAddress, txId, -amount, 'sent');
      }

      // تحديث الفهرس الدائم
      await this.updatePersistentIndex('transactions', txId, {
        file: `${txId}.json`,
        fromAddress: fromAddress?.toLowerCase(),
        toAddress: toAddress?.toLowerCase(),
        amount: amount,
        timestamp: timestamp,
        persistent: true
      });

      console.log(`💾 External transaction stored in PERSISTENT storage: ${txId} (${amount} ACCESS)`);
      return txId;
    } catch (error) {
      console.error('❌ Error storing external transaction in persistent storage:', error);
      return null;
    }
  }

  // تحديث نشاط المحفظة في التخزين الدائم
  async updateWalletActivityPersistent(walletAddress, txId, amountChange, type) {
    try {
      const walletId = this.generateWalletId(walletAddress);
      const walletKey = `wallets/${walletId}.json`;

      let walletData;
      
      // محاولة قراءة بيانات المحفظة الموجودة
      try {
        const existingData = await this.storage.downloadFromText(walletKey);
        walletData = JSON.parse(existingData);
      } catch (error) {
        // إنشاء محفظة جديدة إذا لم تكن موجودة
        await this.registerExternalWallet(walletAddress);
        const newData = await this.storage.downloadFromText(walletKey);
        walletData = JSON.parse(newData);
      }

      // تحديث البيانات
      walletData.lastActivity = Date.now();
      walletData.transactionCount += 1;
      walletData.balance = Math.max(0, (walletData.balance || 0) + amountChange);
      
      // إضافة المعاملة لسجل المحفظة
      walletData.transactions.push({
        txId: txId,
        type: type,
        amount: Math.abs(amountChange),
        timestamp: Date.now(),
        persistent: true
      });

      // الاحتفاظ بآخر 100 معاملة فقط
      if (walletData.transactions.length > 100) {
        walletData.transactions = walletData.transactions.slice(-100);
      }

      // حفظ التحديثات في Object Storage الدائم
      await this.storage.uploadFromText(walletKey, JSON.stringify(walletData, null, 2));

      console.log(`📈 Wallet activity updated in PERSISTENT storage: ${walletAddress} (${type}: ${Math.abs(amountChange)} ACCESS)`);
    } catch (error) {
      console.error('❌ Error updating wallet activity in persistent storage:', error);
    }
  }

  // الحصول على معاملات المحفظة من التخزين الدائم
  async getWalletTransactions(walletAddress, limit = 50) {
    try {
      const walletId = this.generateWalletId(walletAddress);
      const walletKey = `wallets/${walletId}.json`;

      const walletDataText = await this.storage.downloadFromText(walletKey);
      const walletData = JSON.parse(walletDataText);
      const transactions = [];

      // جلب تفاصيل المعاملات من Object Storage
      for (const tx of walletData.transactions.slice(-limit)) {
        try {
          const txKey = `transactions/${tx.txId}.json`;
          const txDataText = await this.storage.downloadFromText(txKey);
          const txData = JSON.parse(txDataText);
          transactions.push(txData);
        } catch (txError) {
          console.warn(`Transaction ${tx.txId} not found in persistent storage`);
        }
      }

      return transactions.reverse(); // أحدث معاملة أولاً
    } catch (error) {
      console.error('❌ Error getting wallet transactions from persistent storage:', error);
      return [];
    }
  }

  // الحصول على رصيد المحفظة من التخزين الدائم
  async getWalletBalance(walletAddress) {
    try {
      const walletId = this.generateWalletId(walletAddress);
      const walletKey = `wallets/${walletId}.json`;

      const walletDataText = await this.storage.downloadFromText(walletKey);
      const walletData = JSON.parse(walletDataText);
      return walletData.balance || 0;
    } catch (error) {
      console.error('❌ Error getting wallet balance from persistent storage:', error);
      return 0;
    }
  }

  // تحديث الفهرس الدائم
  async updatePersistentIndex(section, key, data) {
    try {
      let index;
      try {
        const indexText = await this.storage.downloadFromText('index.json');
        index = JSON.parse(indexText);
      } catch (error) {
        // إنشاء فهرس جديد إذا لم يكن موجوداً
        index = {
          wallets: {},
          transactions: {},
          lastUpdate: Date.now(),
          version: '2.0',
          storageType: 'persistent_object_storage'
        };
      }
      
      if (!index[section]) {
        index[section] = {};
      }
      
      index[section][key] = data;
      index.lastUpdate = Date.now();
      
      // حفظ في Object Storage الدائم
      await this.storage.uploadFromText('index.json', JSON.stringify(index, null, 2));
      
      console.log(`📋 Persistent index updated: ${section}/${key}`);
    } catch (error) {
      console.error('❌ Error updating persistent index:', error);
    }
  }

  // نسخ احتياطي دوري للبيانات الحرجة
  async createPersistentBackup() {
    try {
      const backupKey = `backups/backup_${Date.now()}.json`;
      
      // جمع جميع البيانات المهمة
      const indexText = await this.storage.downloadFromText('index.json');
      const indexData = JSON.parse(indexText);
      
      const backup = {
        index: indexData,
        createdAt: Date.now(),
        version: '2.0',
        backupType: 'persistent_external_wallets',
        totalWallets: Object.keys(indexData.wallets || {}).length,
        totalTransactions: Object.keys(indexData.transactions || {}).length
      };
      
      // حفظ النسخة الاحتياطية في Object Storage
      await this.storage.uploadFromText(backupKey, JSON.stringify(backup, null, 2));
      
      console.log(`💾 Persistent backup created: ${backupKey}`);
      return backupKey;
    } catch (error) {
      console.error('❌ Error creating persistent backup:', error);
      return null;
    }
  }

  // تنظيف النسخ الاحتياطية القديمة
  async cleanupOldPersistentBackups(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 أيام
    try {
      // في Object Storage الحقيقي، سنحتاج لتتبع النسخ الاحتياطية في الفهرس
      const indexText = await this.storage.downloadFromText('index.json');
      const index = JSON.parse(indexText);
      
      if (!index.backups) {
        index.backups = {};
      }
      
      const now = Date.now();
      let cleanedCount = 0;
      
      // تنظيف النسخ القديمة
      for (const [backupKey, backupInfo] of Object.entries(index.backups)) {
        if (now - backupInfo.createdAt > maxAge) {
          try {
            // حذف النسخة الاحتياطية القديمة
            await this.storage.delete(backupKey);
            delete index.backups[backupKey];
            cleanedCount++;
          } catch (deleteError) {
            console.warn(`Could not delete old backup ${backupKey}:`, deleteError.message);
          }
        }
      }
      
      // تحديث الفهرس
      await this.storage.uploadFromText('index.json', JSON.stringify(index, null, 2));
      
      console.log(`🧹 Cleaned ${cleanedCount} old persistent backups`);
      return cleanedCount;
    } catch (error) {
      console.error('❌ Error cleaning up old persistent backups:', error);
      return 0;
    }
  }

  // استرداد البيانات من نسخة احتياطية
  async restoreFromPersistentBackup(backupKey) {
    try {
      const backupText = await this.storage.downloadFromText(backupKey);
      const backup = JSON.parse(backupText);
      
      // استرداد الفهرس
      await this.storage.uploadFromText('index.json', JSON.stringify(backup.index, null, 2));
      
      console.log(`🔄 Restored data from persistent backup: ${backupKey}`);
      return true;
    } catch (error) {
      console.error('❌ Error restoring from persistent backup:', error);
      return false;
    }
  }

  // نظام مزامنة البيانات مع قاعدة البيانات
  async syncWithDatabase(pool) {
    try {
      console.log('🔄 Syncing external wallet data with database...');
      
      // جلب جميع المحافظ الخارجية من قاعدة البيانات
      const dbWallets = await pool.query(
        'SELECT address, balance, last_activity, transaction_count FROM external_wallets'
      );
      
      let syncedCount = 0;
      
      for (const wallet of dbWallets.rows) {
        try {
          const walletId = this.generateWalletId(wallet.address);
          const walletKey = `wallets/${walletId}.json`;
          
          // التحقق من وجود المحفظة في Object Storage
          let walletData;
          try {
            const existingText = await this.storage.downloadFromText(walletKey);
            walletData = JSON.parse(existingText);
          } catch (error) {
            // إنشاء سجل جديد في Object Storage
            walletData = {
              address: wallet.address.toLowerCase(),
              walletId: walletId,
              registeredAt: Date.now(),
              lastActivity: wallet.last_activity,
              transactionCount: wallet.transaction_count || 0,
              balance: parseFloat(wallet.balance || 0),
              metadata: { syncedFromDB: true },
              transactions: [],
              isPersistent: true,
              storageType: 'object_storage'
            };
          }
          
          // تحديث البيانات من قاعدة البيانات
          walletData.balance = parseFloat(wallet.balance || 0);
          walletData.lastActivity = wallet.last_activity;
          walletData.transactionCount = wallet.transaction_count || 0;
          walletData.lastSync = Date.now();
          
          // حفظ في Object Storage
          await this.storage.uploadFromText(walletKey, JSON.stringify(walletData, null, 2));
          syncedCount++;
          
        } catch (walletError) {
          console.error(`Error syncing wallet ${wallet.address}:`, walletError);
        }
      }
      
      console.log(`✅ Synced ${syncedCount} external wallets to persistent storage`);
      return syncedCount;
    } catch (error) {
      console.error('❌ Error syncing with database:', error);
      return 0;
    }
  }

  // إحصائيات التخزين الدائم
  async getPersistentStorageStats() {
    try {
      const indexText = await this.storage.downloadFromText('index.json');
      const index = JSON.parse(indexText);
      
      const walletCount = Object.keys(index.wallets || {}).length;
      const transactionCount = Object.keys(index.transactions || {}).length;

      return {
        walletsStored: walletCount,
        transactionsStored: transactionCount,
        lastUpdate: index.lastUpdate,
        storageType: 'persistent_object_storage',
        isPersistent: true,
        survives_redeployment: true,
        survives_restart: true
      };
    } catch (error) {
      console.error('❌ Error getting persistent storage stats:', error);
      return null;
    }
  }

  // نظام فحص صحة البيانات
  async validatePersistentData() {
    try {
      const indexText = await this.storage.downloadFromText('index.json');
      const index = JSON.parse(indexText);
      
      let validWallets = 0;
      let validTransactions = 0;
      let corruptedFiles = [];
      
      // فحص محافظ
      for (const [address, walletInfo] of Object.entries(index.wallets || {})) {
        try {
          const walletKey = `wallets/${walletInfo.file}`;
          const walletText = await this.storage.downloadFromText(walletKey);
          const walletData = JSON.parse(walletText);
          
          if (walletData.address && walletData.walletId) {
            validWallets++;
          } else {
            corruptedFiles.push(walletKey);
          }
        } catch (error) {
          corruptedFiles.push(`wallets/${walletInfo.file}`);
        }
      }
      
      // فحص معاملات
      for (const [txId, txInfo] of Object.entries(index.transactions || {})) {
        try {
          const txKey = `transactions/${txInfo.file}`;
          const txText = await this.storage.downloadFromText(txKey);
          const txData = JSON.parse(txText);
          
          if (txData.hash && txData.amount !== undefined) {
            validTransactions++;
          } else {
            corruptedFiles.push(txKey);
          }
        } catch (error) {
          corruptedFiles.push(`transactions/${txInfo.file}`);
        }
      }
      
      const result = {
        valid: corruptedFiles.length === 0,
        validWallets: validWallets,
        validTransactions: validTransactions,
        corruptedFiles: corruptedFiles,
        totalFiles: validWallets + validTransactions,
        healthScore: ((validWallets + validTransactions) / 
                     (validWallets + validTransactions + corruptedFiles.length)) * 100
      };
      
      console.log(`🔍 Persistent data validation:`, result);
      return result;
    } catch (error) {
      console.error('❌ Error validating persistent data:', error);
      return { valid: false, error: error.message };
    }
  }

  // نظام استرداد تلقائي للبيانات التالفة
  async repairCorruptedData() {
    try {
      const validation = await this.validatePersistentData();
      
      if (!validation.valid && validation.corruptedFiles.length > 0) {
        console.log(`🔧 Repairing ${validation.corruptedFiles.length} corrupted files...`);
        
        let repairedCount = 0;
        for (const corruptedFile of validation.corruptedFiles) {
          try {
            // محاولة حذف الملف التالف
            await this.storage.delete(corruptedFile);
            repairedCount++;
          } catch (deleteError) {
            console.warn(`Could not delete corrupted file ${corruptedFile}`);
          }
        }
        
        // إعادة بناء الفهرس بدون الملفات التالفة
        await this.rebuildPersistentIndex();
        
        console.log(`🔧 Repaired ${repairedCount} corrupted files in persistent storage`);
        return repairedCount;
      }
      
      return 0;
    } catch (error) {
      console.error('❌ Error repairing corrupted data:', error);
      return 0;
    }
  }

  // إعادة بناء الفهرس الدائم
  async rebuildPersistentIndex() {
    try {
      const newIndex = {
        wallets: {},
        transactions: {},
        lastUpdate: Date.now(),
        version: '2.0',
        storageType: 'persistent_object_storage',
        rebuilt: true,
        rebuildTimestamp: Date.now()
      };
      
      await this.storage.uploadFromText('index.json', JSON.stringify(newIndex, null, 2));
      console.log('🔧 Persistent index rebuilt successfully');
    } catch (error) {
      console.error('❌ Error rebuilding persistent index:', error);
    }
  }

  // نظام fallback للملفات المحلية في حالة فشل Object Storage
  initializeFallbackStorage() {
    this.storageDir = './external-wallet-storage-fallback';
    this.transactionsDir = path.join(this.storageDir, 'transactions');
    this.walletsDir = path.join(this.storageDir, 'wallets');
    this.indexFile = path.join(this.storageDir, 'index.json');
    this.isFallback = true;
    
    // إنشاء المجلدات المؤقتة
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    if (!fs.existsSync(this.transactionsDir)) {
      fs.mkdirSync(this.transactionsDir, { recursive: true });
    }
    if (!fs.existsSync(this.walletsDir)) {
      fs.mkdirSync(this.walletsDir, { recursive: true });
    }

    console.log('⚠️ Using fallback file storage - data will NOT persist across deployments');
  }

  // وظائف مساعدة
  generateWalletId(walletAddress) {
    return crypto.createHash('sha256').update(walletAddress.toLowerCase()).digest('hex').substring(0, 16);
  }

  generateTransactionId(from, to, amount, timestamp) {
    const data = `${from}-${to}-${amount}-${timestamp}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // فحص حالة التخزين
  getStorageHealth() {
    return {
      storageType: this.isFallback ? 'fallback_temporary' : 'persistent_object_storage',
      isPersistent: !this.isFallback,
      survives_redeployment: !this.isFallback,
      survives_restart: !this.isFallback,
      recommended: !this.isFallback,
      warning: this.isFallback ? 'Using temporary storage - data will be lost on redeploy' : null
    };
  }
}

export default PersistentExternalWalletStorage;
