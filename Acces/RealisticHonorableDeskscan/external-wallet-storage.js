
// نظام تخزين المحافظ الخارجية - External Wallet Storage System
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

class ExternalWalletStorageManager {
  constructor() {
    this.storageDir = './external-wallet-storage';
    this.transactionsDir = path.join(this.storageDir, 'transactions');
    this.walletsDir = path.join(this.storageDir, 'wallets');
    this.indexFile = path.join(this.storageDir, 'index.json');
    
    this.initializeStorage();
  }

  // تهيئة نظام التخزين
  initializeStorage() {
    try {
      // إنشاء المجلدات الأساسية
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
      if (!fs.existsSync(this.transactionsDir)) {
        fs.mkdirSync(this.transactionsDir, { recursive: true });
      }
      if (!fs.existsSync(this.walletsDir)) {
        fs.mkdirSync(this.walletsDir, { recursive: true });
      }

      // إنشاء ملف الفهرس إذا لم يكن موجوداً
      if (!fs.existsSync(this.indexFile)) {
        const initialIndex = {
          wallets: {},
          transactions: {},
          lastUpdate: Date.now(),
          version: '1.0'
        };
        fs.writeFileSync(this.indexFile, JSON.stringify(initialIndex, null, 2));
      }

      console.log('🗄️ External Wallet Storage initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing external wallet storage:', error);
    }
  }

  // تسجيل محفظة خارجية جديدة
  async registerExternalWallet(walletAddress, metadata = {}) {
    try {
      const walletId = this.generateWalletId(walletAddress);
      const walletFile = path.join(this.walletsDir, `${walletId}.json`);
      
      const walletData = {
        address: walletAddress.toLowerCase(),
        walletId: walletId,
        registeredAt: Date.now(),
        lastActivity: Date.now(),
        transactionCount: 0,
        balance: 0,
        metadata: metadata,
        transactions: []
      };

      // حفظ بيانات المحفظة
      fs.writeFileSync(walletFile, JSON.stringify(walletData, null, 2));

      // تحديث الفهرس
      await this.updateIndex('wallets', walletAddress.toLowerCase(), {
        walletId: walletId,
        file: `${walletId}.json`,
        registeredAt: Date.now()
      });

      console.log(`🆕 External wallet registered in storage: ${walletAddress}`);
      return walletId;
    } catch (error) {
      console.error('❌ Error registering external wallet:', error);
      return null;
    }
  }

  // حفظ معاملة للمحفظة الخارجية
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

      // إنشاء معرف فريد للمعاملة
      const txId = hash || this.generateTransactionId(fromAddress, toAddress, amount, timestamp);
      const txFile = path.join(this.transactionsDir, `${txId}.json`);

      const txData = {
        hash: txId,
        fromAddress: fromAddress?.toLowerCase(),
        toAddress: toAddress?.toLowerCase(),
        amount: parseFloat(amount),
        gasFee: parseFloat(gasFee || 0.000021),
        timestamp: timestamp,
        status: status,
        storedAt: Date.now(),
        type: 'external_transfer',
        network: 'access',
        chainId: '0x5968'
      };

      // حفظ المعاملة
      fs.writeFileSync(txFile, JSON.stringify(txData, null, 2));

      // تحديث سجلات المحافظ المتأثرة
      if (toAddress) {
        await this.updateWalletActivity(toAddress, txId, amount, 'received');
      }
      if (fromAddress) {
        await this.updateWalletActivity(fromAddress, txId, -amount, 'sent');
      }

      // تحديث الفهرس
      await this.updateIndex('transactions', txId, {
        file: `${txId}.json`,
        fromAddress: fromAddress?.toLowerCase(),
        toAddress: toAddress?.toLowerCase(),
        amount: amount,
        timestamp: timestamp
      });

      console.log(`💾 External transaction stored: ${txId} (${amount} ACCESS)`);
      return txId;
    } catch (error) {
      console.error('❌ Error storing external transaction:', error);
      return null;
    }
  }

  // تحديث نشاط المحفظة
  async updateWalletActivity(walletAddress, txId, amountChange, type) {
    try {
      const walletId = this.generateWalletId(walletAddress);
      const walletFile = path.join(this.walletsDir, `${walletId}.json`);

      if (!fs.existsSync(walletFile)) {
        // إنشاء محفظة جديدة إذا لم تكن موجودة
        await this.registerExternalWallet(walletAddress);
      }

      // قراءة بيانات المحفظة الحالية
      const walletData = JSON.parse(fs.readFileSync(walletFile, 'utf8'));

      // تحديث البيانات
      walletData.lastActivity = Date.now();
      walletData.transactionCount += 1;
      walletData.balance = Math.max(0, (walletData.balance || 0) + amountChange);
      
      // إضافة المعاملة لسجل المحفظة
      walletData.transactions.push({
        txId: txId,
        type: type,
        amount: Math.abs(amountChange),
        timestamp: Date.now()
      });

      // الاحتفاظ بآخر 100 معاملة فقط
      if (walletData.transactions.length > 100) {
        walletData.transactions = walletData.transactions.slice(-100);
      }

      // حفظ التحديثات
      fs.writeFileSync(walletFile, JSON.stringify(walletData, null, 2));

      console.log(`📈 Wallet activity updated: ${walletAddress} (${type}: ${Math.abs(amountChange)} ACCESS)`);
    } catch (error) {
      console.error('❌ Error updating wallet activity:', error);
    }
  }

  // الحصول على معاملات المحفظة الخارجية
  async getWalletTransactions(walletAddress, limit = 50) {
    try {
      const walletId = this.generateWalletId(walletAddress);
      const walletFile = path.join(this.walletsDir, `${walletId}.json`);

      if (!fs.existsSync(walletFile)) {
        return [];
      }

      const walletData = JSON.parse(fs.readFileSync(walletFile, 'utf8'));
      const transactions = [];

      // جلب تفاصيل المعاملات
      for (const tx of walletData.transactions.slice(-limit)) {
        const txFile = path.join(this.transactionsDir, `${tx.txId}.json`);
        if (fs.existsSync(txFile)) {
          const txData = JSON.parse(fs.readFileSync(txFile, 'utf8'));
          transactions.push(txData);
        }
      }

      return transactions.reverse(); // أحدث معاملة أولاً
    } catch (error) {
      console.error('❌ Error getting wallet transactions:', error);
      return [];
    }
  }

  // الحصول على رصيد المحفظة من التخزين
  async getWalletBalance(walletAddress) {
    try {
      const walletId = this.generateWalletId(walletAddress);
      const walletFile = path.join(this.walletsDir, `${walletId}.json`);

      if (!fs.existsSync(walletFile)) {
        return 0;
      }

      const walletData = JSON.parse(fs.readFileSync(walletFile, 'utf8'));
      return walletData.balance || 0;
    } catch (error) {
      console.error('❌ Error getting wallet balance:', error);
      return 0;
    }
  }

  // تحديث الفهرس الرئيسي
  async updateIndex(section, key, data) {
    try {
      const index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      
      if (!index[section]) {
        index[section] = {};
      }
      
      index[section][key] = data;
      index.lastUpdate = Date.now();
      
      fs.writeFileSync(this.indexFile, JSON.stringify(index, null, 2));
    } catch (error) {
      console.error('❌ Error updating index:', error);
    }
  }

  // إنشاء معرف للمحفظة
  generateWalletId(walletAddress) {
    return crypto.createHash('sha256').update(walletAddress.toLowerCase()).digest('hex').substring(0, 16);
  }

  // إنشاء معرف للمعاملة
  generateTransactionId(from, to, amount, timestamp) {
    const data = `${from}-${to}-${amount}-${timestamp}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // إحصائيات التخزين
  getStorageStats() {
    try {
      const index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      const walletCount = Object.keys(index.wallets || {}).length;
      const transactionCount = Object.keys(index.transactions || {}).length;

      return {
        walletsStored: walletCount,
        transactionsStored: transactionCount,
        lastUpdate: index.lastUpdate,
        storageDir: this.storageDir
      };
    } catch (error) {
      console.error('❌ Error getting storage stats:', error);
      return null;
    }
  }

  // تنظيف الملفات القديمة
  async cleanupOldData(maxAge = 30 * 24 * 60 * 60 * 1000) { // 30 يوم
    try {
      const now = Date.now();
      let cleaned = 0;

      // تنظيف المعاملات القديمة
      const txFiles = fs.readdirSync(this.transactionsDir);
      for (const file of txFiles) {
        const filePath = path.join(this.transactionsDir, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }

      console.log(`🧹 Cleaned ${cleaned} old transaction files`);
      return cleaned;
    } catch (error) {
      console.error('❌ Error cleaning up old data:', error);
      return 0;
    }
  }
}

export default ExternalWalletStorageManager;
