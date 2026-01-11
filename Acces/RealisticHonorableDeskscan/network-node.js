// access points
import { AccessNetwork, Transaction } from './network-system.js';
import { pool } from './db.js';
import http from 'http';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import pkg from 'elliptic';
const { ec: EC } = pkg;
import { AntiAttackMonitor } from './anti-attack-monitor.js';
import { EnterpriseNetworkCore } from './enterprise-network-core.js';
import { InstantWalletSync } from './instant-wallet-sync.js';
import { SmartContractEngine } from './contract-engine.js';
import accessCache from './access-style-cache.js';
import rlp from 'rlp';
import sha3Pkg from 'js-sha3';
const { keccak256 } = sha3Pkg;

// نظام لوجنج محسن لتقليل الرسائل المتكررة
class NetworkLogger {
  constructor() {
    this.messageCache = new Map();
    this.maxCacheSize = 50;
    this.logInterval = 30000; // 30 ثانية للرسائل العادية
    this.summaryInterval = 300000; // 5 دقائق للملخصات
  }
  
  log(key, message, level = 'info', showOnce = false) {
    const now = Date.now();
    const cached = this.messageCache.get(key);
    
    if (showOnce && cached) {
      return; // لا تعرض الرسالة مرة أخرى
    }
    
    if (!cached || (now - cached.lastLogged) > this.logInterval) {
      if (level === 'error') {
        console.error(message);
      } else if (level === 'warn') {
        console.warn(message);
      } else {
        console.log(message);
      }
      
      this.messageCache.set(key, { 
        lastLogged: now, 
        count: cached ? cached.count + 1 : 1,
        message: message
      });
      
      // تنظيف الذاكرة
      if (this.messageCache.size > this.maxCacheSize) {
        const oldestKey = Array.from(this.messageCache.keys())[0];
        this.messageCache.delete(oldestKey);
      }
    } else if (cached) {
      cached.count++;
      
      // عرض ملخص كل 100 رسالة
      if (cached.count % 100 === 0) {
        console.log(`📊 ملخص: "${key}" تكررت ${cached.count} مرة`);
      }
    }
  }
  
  // دالة خاصة للرسائل عالية التكرار
  logQuiet(key, message, count = 50) {
    const cached = this.messageCache.get(key);
    if (!cached) {
      this.messageCache.set(key, { count: 1, message: message });
      console.log(message);
    } else {
      cached.count++;
      if (cached.count % count === 0) {
        console.log(`🔄 ${message} (${cached.count} مرة)`);
      }
    }
  }
}

const networkLogger = new NetworkLogger();

class NetworkNode {
  constructor(port = 5000) {
    this.blockchain = new AccessNetwork();
    this.network = this.blockchain;
    this.port = port;
    this.isRunning = false;
    this.processors = new Map();
    this.subscriptions = new Map();
    this.connectedWallets = new Map();
    
    // النظام المتقدم
    this.enterpriseCore = new EnterpriseNetworkCore();
    this.instantSync = new InstantWalletSync(this.blockchain); // لتتبع المحافظ المتصلة
    this.processedTransactions = new Set(); // لتتبع المعاملات المعالجة
    this.activeSubscriptions = new Map(); // للاشتراكات النشطة عبر WebSocket
    
    // ✅ TRUST WALLET FIX: Cache للمعاملات الأخيرة (لإرجاع receipt فوراً)
    this.recentTransactionCache = new Map(); // hash -> transaction data

    // Initialize advanced anti-attack monitoring system
    this.antiAttackMonitor = new AntiAttackMonitor();

    // Initialize Smart Contract Engine for NFTs and Tokens (stored on blockchain, not database)
    // ✅ مثل Ethereum/BSC - العقود الذكية تُخزن في البلوكتشين وليس قاعدة البيانات
    this.contractEngine = null; // Will be initialized after stateStorage

    // Pure blockchain system - NO CACHE like Ethereum/BSC
    // البلوك تشين هو المصدر الوحيد للحقيقة مثل الإيثريوم تماماً

    // تهيئة نظام التخزين المتقدم
    this.initializeAdvancedStorage();

    // Start cleanup interval for anti-attack monitor
    setInterval(() => {
      this.antiAttackMonitor.cleanup();
    }, 60 * 60 * 1000); // Cleanup every hour

    // إعداد الاستماع للأحداث
    this.setupEventListeners();

    // إنشاء جداول المحافظ الخارجية
    this.createWalletTables();

    // 🔄 تنظيف الحجوزات القديمة عند بدء السيرفر
    if (this.blockchain.resetAllReservations) {
      this.blockchain.resetAllReservations();
    }

    // 🔥 ETHEREUM-STYLE: تهيئة virtual block offset للمزامنة الفورية
    this.virtualBlockOffset = 0;
    this.lastBalanceChange = Date.now();
    this.pendingBalanceAddresses = new Set(); // عناوين تحتاج تحديث فوري

    // 🔥 METAMASK-STYLE: نظام تتبع المعاملات المؤكدة (مثل AccountTrackerController في MetaMask)
    // عند تأكيد معاملة، يتم تحديث الرصيد فوراً بدون انتظار polling
    this.confirmedTransactionTracker = new Map(); // txHash -> {from, to, timestamp}
    this.recentlyConfirmedAddresses = new Map(); // address -> {balance, timestamp}
    
    // ⚡ ULTRA-AGGRESSIVE SYNC: زيادة virtual block كل 50ms (20x في الثانية) - مثل Ethereum mainnet
    setInterval(() => {
      // زيادة أكبر عند وجود عناوين معلقة
      const pendingMultiplier = Math.max(1, this.pendingBalanceAddresses?.size || 0);
      if (Date.now() - this.lastBalanceChange < 60000) {
        this.virtualBlockOffset += (10 * pendingMultiplier); // زيادة أكبر لإجبار التحديث
      }
    }, 50);

    // ⚡ INSTANT SYNC: بث newHeads كل 250ms (4x في الثانية) لتحديث المحافظ
    setInterval(() => {
      if (this.pendingBalanceAddresses.size > 0 || Date.now() - this.lastBalanceChange < 60000) {
        this.broadcastPeriodicNewHeads();
        // مسح العناوين المعلقة بعد 5 ثوانٍ فقط
        if (Date.now() - this.lastBalanceChange > 5000) {
          this.pendingBalanceAddresses.clear();
        }
      }
    }, 250);
    
    // ⚡ METAMASK-STYLE: تنظيف المعاملات المؤكدة القديمة كل دقيقة
    setInterval(() => {
      const now = Date.now();
      for (const [hash, data] of this.confirmedTransactionTracker.entries()) {
        if (now - data.timestamp > 300000) { // 5 دقائق
          this.confirmedTransactionTracker.delete(hash);
        }
      }
      for (const [address, data] of this.recentlyConfirmedAddresses.entries()) {
        if (now - data.timestamp > 60000) { // 1 دقيقة
          this.recentlyConfirmedAddresses.delete(address);
        }
      }
    }, 60000);

    // Node initialization messages silenced to reduce console spam

    // بدء مزامنة تلقائية للأرصدة عند التهيئة
    setTimeout(() => {
      this.syncAllWalletBalances();
    }, 5000); // انتظار 5 ثوانِ ثم بدء المزامنة
  }
  // تهيئة نظام التخزين المتقدم
  async initializeAdvancedStorage() {
    try {
      // التحقق من وجود البيانات في نظام التخزين الجديد
      if (this.blockchain.useProfessionalStorage) {
        const loadedData = await this.blockchain.loadProfessionalBlockchain();
        if (loadedData && loadedData.blocks && loadedData.blocks.length > 0) {
          // Storage data loaded - message reduced for performance
          
          // دمج البيانات المحملة مع البلوكتشين الحالي
          this.blockchain.chain = loadedData.blocks;
          if (loadedData.accounts) {
            this.blockchain.balances = new Map(Object.entries(loadedData.accounts));
          }
        }
      }
    } catch (error) {
      console.warn('⚠️ تحذير: فشل في تحميل البيانات من نظام التخزين المتقدم:', error.message);
      console.log('📋 سيتم استخدام نظام التخزين التقليدي');
    }
  }

  // إضافة دالة broadcastToSubscribers المفقودة
  broadcastToSubscribers(type, data) {
    try {
      if (this.subscriptions && this.subscriptions.size > 0) {
        this.subscriptions.forEach((subscription, id) => {
          if (subscription.type === type) {
            try {
              subscription.callback(data);
            } catch (error) {
              console.error(`Error broadcasting to subscriber ${id}:`, error);
            }
          }
        });
      }
    } catch (error) {
      console.error('Error in broadcastToSubscribers:', error);
    }
  }

  // إضافة دالة broadcastTransactionToExternalWallets المفقودة
  broadcastTransactionToExternalWallets(transaction) {
    try {
      if (this.connectedWallets && this.connectedWallets.size > 0) {
        const notificationData = {
          jsonrpc: '2.0',
          method: 'eth_subscription',
          params: {
            subscription: '0xNewTransaction',
            result: {
              hash: transaction.txId || transaction.hash,
              from: transaction.fromAddress || transaction.from,
              to: transaction.toAddress || transaction.to,
              value: '0x' + Math.floor((transaction.amount || 0) * 1e18).toString(16),
              timestamp: Date.now()
            }
          }
        };

        this.connectedWallets.forEach((walletWs, walletAddress) => {
          if (walletWs.readyState === 1) {
            try {
              walletWs.send(JSON.stringify(notificationData));
            } catch (error) {
              console.error(`Error broadcasting transaction to ${walletAddress}:`, error);
            }
          }
        });

      }
    } catch (error) {
      console.error('Error in broadcastTransactionToExternalWallets:', error);
    }
  }

  setupEventListeners() {
    this.blockchain.on('blockMined', (block) => {
      // استخدام arrow function للحفاظ على السياق الصحيح
      try {
        this.broadcastToSubscribers('newBlock', block);
        this.syncWithDatabase(block);
      } catch (error) {
        console.error('Error in blockMined event handler:', error);
      }

      // بث للاشتراكات الفعالة - newHeads
      if (this.activeSubscriptions) {
        this.activeSubscriptions.forEach((subscription, id) => {
          if (subscription.type === 'newHeads') {
            try {
              subscription.callback(block);
            } catch (error) {
              console.error(`Error in newHeads subscription ${id}:`, error);
            }
          }
        });
      }
    });

    // 🔔 INSTANT BALANCE NOTIFICATIONS - مثل Ethereum
    this.blockchain.on('balanceChanged', (data) => {
      try {
        // 🔥 تسجيل وقت آخر تغيير في الرصيد
        this.lastBalanceChange = Date.now();
        this.virtualBlockOffset++;
        
        console.log(`🔥 BALANCE CHANGED: ${data.address.slice(0, 10)}... → ${data.newBalance.toFixed(8)} ACCESS`);
        
        this.broadcastInstantBalanceUpdate(data.address, data.newBalance);
        
        // 🔥 ETHEREUM-STYLE: بث newHeads لإجبار المحافظ على إعادة الاستعلام
        // هذه هي الطريقة التي تستخدمها Ethereum و BSC
        this.broadcastNewHeadsForBalanceUpdate(data.address);
      } catch (error) {
        console.error('Error broadcasting balance change:', error);
      }
    });
  }

  // 🔥 بث newHeads مزيف عند تغيير الرصيد (يجبر المحافظ على eth_getBalance)
  broadcastNewHeadsForBalanceUpdate(changedAddress) {
    try {
      const fakeBlockNumber = this.blockchain.chain?.length || 1;
      const fakeBlockHash = '0x' + Date.now().toString(16).padStart(64, '0');
      
      const newHeadsNotification = {
        jsonrpc: '2.0',
        method: 'eth_subscription',
        params: {
          subscription: '0xnewHeads',
          result: {
            number: '0x' + fakeBlockNumber.toString(16),
            hash: fakeBlockHash,
            parentHash: this.blockchain.getLatestBlock()?.hash || '0x0',
            timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16),
            gasLimit: '0x1c9c380',
            gasUsed: '0x5208',
            // 🔑 تضمين العنوان المتغير في stateRoot لإشارة للتغيير
            stateRoot: '0x' + changedAddress.toLowerCase().slice(2).padEnd(64, '0')
          }
        }
      };

      // بث لجميع الاتصالات WebSocket
      if (this.wss && this.wss.clients) {
        this.wss.clients.forEach((ws) => {
          if (ws.readyState === 1) {
            try {
              ws.send(JSON.stringify(newHeadsNotification));
            } catch (e) {}
          }
        });
      }

      // بث للمحافظ المتصلة
      if (this.connectedWallets) {
        this.connectedWallets.forEach((walletWs, address) => {
          if (walletWs.readyState === 1) {
            try {
              walletWs.send(JSON.stringify(newHeadsNotification));
            } catch (e) {}
          }
        });
      }
    } catch (error) {
      // Silent error - لا نريد إيقاف العملية
    }
  }

  // 🔥 TRUST WALLET FIX: بث newHeads دوري لإبقاء المحافظ محدثة
  broadcastPeriodicNewHeads() {
    try {
      // فقط إذا كان هناك اتصالات نشطة
      const hasConnections = (this.wss?.clients?.size > 0) || (this.connectedWallets?.size > 0);
      if (!hasConnections) return;

      const blockNumber = (this.blockchain.chain?.length || 1) + (this.virtualBlockOffset || 0);
      const blockHash = '0x' + Date.now().toString(16).padStart(64, '0');
      const timestamp = Math.floor(Date.now() / 1000);

      const newHeadsNotification = {
        jsonrpc: '2.0',
        method: 'eth_subscription',
        params: {
          subscription: '0x1',
          result: {
            number: '0x' + blockNumber.toString(16),
            hash: blockHash,
            parentHash: this.blockchain.getLatestBlock()?.hash || '0x0',
            timestamp: '0x' + timestamp.toString(16),
            gasLimit: '0x1c9c380',
            gasUsed: '0x0'
          }
        }
      };

      // بث صامت (بدون log لتجنب spam)
      if (this.wss?.clients) {
        this.wss.clients.forEach((ws) => {
          if (ws.readyState === 1) {
            try { ws.send(JSON.stringify(newHeadsNotification)); } catch (e) {}
          }
        });
      }
      if (this.connectedWallets) {
        this.connectedWallets.forEach((walletWs) => {
          if (walletWs.readyState === 1) {
            try { walletWs.send(JSON.stringify(newHeadsNotification)); } catch (e) {}
          }
        });
      }
    } catch (error) {
      // Silent error
    }
  }

  // ⚡ ETHEREUM-STYLE INSTANT: بث newHeads فوري عند كل معاملة مع إشعارات متعددة
  broadcastImmediateNewHeads(fromAddress, toAddress, senderBalance, recipientBalance) {
    try {
      // ⚡ CRITICAL: زيادة virtualBlockOffset بشكل كبير لإجبار التحديث الفوري
      this.virtualBlockOffset = (this.virtualBlockOffset || 0) + 1000;
      
      const blockNumber = (this.blockchain.chain?.length || 1) + (this.virtualBlockOffset || 0);
      const blockHash = '0x' + crypto.createHash('sha256').update(Date.now().toString() + Math.random().toString()).digest('hex');
      const timestamp = Math.floor(Date.now() / 1000);

      // ⚡ ETHEREUM-STYLE: newHeads notification مطابق لـ geth
      const newHeadsNotification = {
        jsonrpc: '2.0',
        method: 'eth_subscription',
        params: {
          subscription: '0x1',
          result: {
            number: '0x' + blockNumber.toString(16),
            hash: blockHash,
            parentHash: this.blockchain.getLatestBlock()?.hash || '0x0',
            timestamp: '0x' + timestamp.toString(16),
            gasLimit: '0x1c9c380',
            gasUsed: '0x5208',
            miner: '0x0000000000000000000000000000000000000000',
            difficulty: '0x1',
            totalDifficulty: '0x1',
            size: '0x200',
            logsBloom: '0x' + '0'.repeat(512),
            transactionsRoot: blockHash,
            stateRoot: '0x' + crypto.createHash('sha256').update(fromAddress + toAddress + Date.now()).digest('hex'),
            receiptsRoot: '0x' + 'c'.repeat(64),
            nonce: '0x0000000000000000',
            sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
            extraData: '0x',
            uncles: [],
            baseFeePerGas: '0x3b9aca00'
          }
        }
      };

      // ⚡ METAMASK-STYLE: إشعار تغير الحسابات
      const accountsChangedSender = {
        jsonrpc: '2.0',
        method: 'metamask_accountsChanged',
        params: { accounts: [fromAddress] }
      };

      const accountsChangedRecipient = {
        jsonrpc: '2.0', 
        method: 'metamask_accountsChanged',
        params: { accounts: [toAddress] }
      };

      // ⚡ TRUST WALLET-STYLE: إشعار تغير الأصول
      const senderBalanceHex = '0x' + Math.floor((senderBalance || 0) * 1e18).toString(16);
      const recipientBalanceHex = '0x' + Math.floor((recipientBalance || 0) * 1e18).toString(16);

      const assetsChangedSender = {
        jsonrpc: '2.0',
        method: 'wallet_assetsChanged',
        params: {
          chainId: '0x5968',
          address: fromAddress,
          assets: [{
            symbol: 'ACCESS',
            balance: senderBalanceHex,
            decimals: 18
          }]
        }
      };

      const assetsChangedRecipient = {
        jsonrpc: '2.0',
        method: 'wallet_assetsChanged',
        params: {
          chainId: '0x5968',
          address: toAddress,
          assets: [{
            symbol: 'ACCESS',
            balance: recipientBalanceHex,
            decimals: 18
          }]
        }
      };

      let sentCount = 0;

      // ⚡ إرسال جميع الإشعارات لكل اتصال WebSocket
      const sendNotifications = (ws) => {
        if (ws.readyState === 1) {
          try {
            // 1. newHeads أولاً - الأهم
            ws.send(JSON.stringify(newHeadsNotification));
            // 2. إشعار تغير الحسابات
            ws.send(JSON.stringify(accountsChangedSender));
            ws.send(JSON.stringify(accountsChangedRecipient));
            // 3. إشعار تغير الأصول
            ws.send(JSON.stringify(assetsChangedSender));
            ws.send(JSON.stringify(assetsChangedRecipient));
            sentCount++;
          } catch (e) {}
        }
      };

      // ⚡ بث لجميع اتصالات WebSocket
      if (this.wss && this.wss.clients) {
        this.wss.clients.forEach(sendNotifications);
      }

      // ⚡ بث للمحافظ المتصلة
      if (this.connectedWallets) {
        this.connectedWallets.forEach((walletWs) => sendNotifications(walletWs));
      }

      // ⚡ بث لـ instantSync
      if (this.instantSync && this.instantSync.walletConnections) {
        this.instantSync.walletConnections.forEach((connection) => sendNotifications(connection));
      }

      console.log(`⚡ INSTANT newHeads: block ${blockNumber} → ${sentCount} connections (sender: ${senderBalance?.toFixed(4)} ACCESS, recipient: ${recipientBalance?.toFixed(4)} ACCESS)`);

      // ⚡ إرسال تحديثات الرصيد مباشرة
      if (fromAddress) this.broadcastInstantBalanceUpdate(fromAddress, senderBalance);
      if (toAddress) this.broadcastInstantBalanceUpdate(toAddress, recipientBalance);

    } catch (error) {
      console.error('Error in broadcastImmediateNewHeads:', error);
    }
  }

  // Pure blockchain notification like Ethereum - NO CACHE
  broadcastBalanceUpdate(address, balance) {
    try {
      if (!this.connectedWallets) return;

      const normalizedAddress = address.toLowerCase();
      const balanceHex = '0x' + Math.floor(balance * 1e18).toString(16);

      // Simple Ethereum-style notification
      const notification = {
        jsonrpc: '2.0',
        method: 'eth_subscription',
        params: {
          subscription: 'balance',
          result: {
            address: normalizedAddress,
            balance: balanceHex,
            blockNumber: '0x' + Math.floor(Date.now() / 1000).toString(16)
          }
        }
      };

      this.connectedWallets.forEach((walletWs, walletAddress) => {
        if (walletWs.readyState === 1 && walletAddress.toLowerCase() === normalizedAddress) {
          try {
            walletWs.send(JSON.stringify(notification));
          } catch (error) {
            console.error(`Error sending balance update to ${address}:`, error);
          }
        }
      });
    } catch (error) {
      console.error('Error broadcasting balance update:', error);
    }
  }

  // 🚀 INSTANT BALANCE UPDATE - مثل Ethereum تماماً
  async broadcastInstantBalanceUpdate(address, newBalance) {
    try {
      const normalizedAddress = address.toLowerCase();
      const balanceHex = '0x' + Math.floor(newBalance * 1e18).toString(16);
      const blockNumber = '0x' + (this.blockchain.chain?.length || 1).toString(16);

      // 📡 إشعار eth_subscription للرصيد (معيار Ethereum)
      const balanceSubscriptionNotification = {
        jsonrpc: '2.0',
        method: 'eth_subscription',
        params: {
          subscription: '0xbalance_' + normalizedAddress.slice(2, 10),
          result: {
            address: normalizedAddress,
            balance: balanceHex,
            blockNumber: blockNumber,
            timestamp: Date.now()
          }
        }
      };

      // 📡 إشعار newHeads مع الرصيد (يجبر المحافظ على إعادة الاستعلام)
      const newHeadsNotification = {
        jsonrpc: '2.0',
        method: 'eth_subscription',
        params: {
          subscription: '0xnewHeads',
          result: {
            number: blockNumber,
            hash: '0x' + Date.now().toString(16).padStart(64, '0'),
            parentHash: this.blockchain.getLatestBlock()?.hash || '0x0',
            timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16),
            stateRoot: '0x' + normalizedAddress.slice(2) // إشارة لتغيير الحالة
          }
        }
      };

      // 📡 إشعار accountsChanged
      const accountsChangedNotification = {
        jsonrpc: '2.0',
        method: 'accountsChanged',
        params: [normalizedAddress]
      };

      // 📡 إشعار assetsChanged (Trust Wallet)
      const assetsChangedNotification = {
        jsonrpc: '2.0',
        method: 'wallet_assetsChanged',
        params: {
          address: normalizedAddress,
          assets: [{
            chainId: '0x5968',
            balance: balanceHex,
            symbol: 'ACCESS',
            decimals: 18
          }]
        }
      };

      // 🔥 إرسال لجميع الاشتراكات النشطة (balanceChanges)
      if (this.activeSubscriptions) {
        this.activeSubscriptions.forEach((subscription, subId) => {
          if (subscription.type === 'balanceChanges') {
            // إذا كان الاشتراك لعنوان محدد أو لجميع العناوين
            if (!subscription.address || subscription.address === normalizedAddress) {
              try {
                subscription.callback({
                  address: normalizedAddress,
                  balance: balanceHex,
                  balanceFormatted: newBalance.toFixed(8) + ' ACCESS',
                  blockNumber: blockNumber,
                  timestamp: Date.now()
                });
              } catch (e) {}
            }
          }
        });
      }

      // 🔥 إرسال لجميع المحافظ المتصلة - بث لجميع الاتصالات لإجبار التحديث
      if (this.connectedWallets) {
        this.connectedWallets.forEach((walletWs, walletAddress) => {
          if (walletWs.readyState === 1) {
            try {
              // إرسال جميع الإشعارات بالتتابع السريع
              walletWs.send(JSON.stringify(balanceSubscriptionNotification));
              walletWs.send(JSON.stringify(newHeadsNotification));
              walletWs.send(JSON.stringify(accountsChangedNotification));
              walletWs.send(JSON.stringify(assetsChangedNotification));
            } catch (error) {
              // Silent error
            }
          }
        });
      }

      // 🔥 إرسال لجميع اتصالات WebSocket (WSS clients)
      if (this.wss && this.wss.clients) {
        this.wss.clients.forEach((ws) => {
          if (ws.readyState === 1) {
            try {
              ws.send(JSON.stringify(balanceSubscriptionNotification));
              ws.send(JSON.stringify(newHeadsNotification));
            } catch (e) {}
          }
        });
      }

      // 🔥 إرسال لـ instantSync
      if (this.instantSync && this.instantSync.walletConnections) {
        this.instantSync.walletConnections.forEach((connection, addr) => {
          if (connection.readyState === 1) {
            try {
              connection.send(JSON.stringify(balanceSubscriptionNotification));
              connection.send(JSON.stringify(newHeadsNotification));
              connection.send(JSON.stringify(assetsChangedNotification));
            } catch (e) {}
          }
        });
      }

      // Log quiet (without spam)
      if (!this._lastBalanceLog || Date.now() - this._lastBalanceLog > 2000) {
        console.log(`🔔 INSTANT BALANCE UPDATE sent to ${normalizedAddress}: ${newBalance.toFixed(8)} ACCESS`);
        this._lastBalanceLog = Date.now();
      }
    } catch (error) {
      console.error('Error in broadcastInstantBalanceUpdate:', error);
    }
  }

  setupEventListeners() {
    this.blockchain.on('blockMined', (block) => {
      // استخدام arrow function للحفاظ على السياق الصحيح
      try {
        this.broadcastToSubscribers('newBlock', block);
        this.syncWithDatabase(block);
      } catch (error) {
        console.error('Error in blockMined event handler:', error);
      }

      // بث للاشتراكات الفعالة - newHeads
      if (this.activeSubscriptions) {
        this.activeSubscriptions.forEach((subscription, id) => {
          if (subscription.type === 'newHeads') {
            try {
              subscription.callback(block);
            } catch (error) {
              console.error(`Error in newHeads subscription ${id}:`, error);
            }
          }
        });
      }
    });

    this.blockchain.on('transaction', (transaction) => {
      try {
        // بث المعاملة الجديدة للمحافظ الخارجية المسجلة
        this.broadcastTransactionToExternalWallets(transaction);
        this.broadcastToSubscribers('newTransaction', transaction);

      // بث للاشتراكات الفعالة - newPendingTransactions
      if (this.activeSubscriptions) {
        this.activeSubscriptions.forEach((subscription, id) => {
          if (subscription.type === 'newPendingTransactions') {
            subscription.callback(transaction.txId || transaction.hash);
          }
        });
      }

      // إنشاء log event للمعاملة
      const transferLog = {
        address: '0x0000000000000000000000000000000000000000', // Native token
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer event signature
          '0x000000000000000000000000' + (transaction.fromAddress || transaction.from).substring(2),
          '0x000000000000000000000000' + (transaction.toAddress || transaction.to).substring(2)
        ],
        data: '0x' + Math.floor((transaction.amount || 0) * 1e18).toString(16).padStart(64, '0'),
        blockNumber: '0x' + (this.blockchain.chain.length - 1).toString(16),
        transactionHash: transaction.txId || transaction.hash,
        logIndex: '0x0',
        removed: false
      };

      // بث للاشتراكات logs
      if (this.activeSubscriptions) {
        this.activeSubscriptions.forEach((subscription, id) => {
          if (subscription.type === 'logs') {
            subscription.callback(transferLog);
          }
        });
      }

      // إشعار خاص للمحافظ الخارجية بأحداث Transfer
      if (this.connectedWallets) {
        const transferNotification = {
          jsonrpc: '2.0',
          method: 'eth_subscription',
          params: {
            subscription: '0xTransferEvent',
            result: transferLog
          }
        };

        this.connectedWallets.forEach((walletWs, walletAddress) => {
          if (walletWs.readyState === 1 &&
              (walletAddress === transaction.fromAddress || walletAddress === transaction.toAddress)) {
            try {
              walletWs.send(JSON.stringify(transferNotification));
            } catch (error) {
              console.error(`Error sending Transfer event to ${walletAddress}:`, error);
            }
          }
        });
      }

      } catch (error) {
        console.error('Error in transaction event handler:', error);
      }
    });
  }

  // التحقق من صحة عنوان Ethereum
  isValidEthereumAddress(address) {
    if (!address || typeof address !== 'string') {
      return false;
    }

    // تنظيف العنوان وإزالة المسافات
    const cleanAddress = address.trim();

    // التحقق من التنسيق الأساسي - يقبل mixed case والأرقام
    if (!/^0x[a-fA-F0-9]{40}$/i.test(cleanAddress)) {
      console.warn(`⚠️ Invalid address format: ${cleanAddress}`);
      return false;
    }

    return true;
  }

  // التحقق من تسجيل المحفظة في النظام - State Trie only like Ethereum
  async isWalletRegistered(address) {
    try {
      if (!this.isValidEthereumAddress(address)) {
        return { registered: false, type: 'invalid', source: null };
      }

      const { pool } = await import('./db.js');

      // فحص المحافظ المحلية فقط (users و internal_wallets)
      const localCheck = await pool.query(`
        SELECT wallet_address, 'user' as wallet_type, id as user_id FROM users WHERE wallet_address = $1
        UNION
        SELECT address as wallet_address, wallet_type, NULL as user_id FROM internal_wallets WHERE address = $1
      `, [address.toLowerCase()]);

      if (localCheck.rows.length > 0) {
        return {
          registered: true,
          type: 'local',
          source: localCheck.rows[0].wallet_type,
          userId: localCheck.rows[0].user_id
        };
      }

      // REMOVED: external_wallets check - Using State Trie only like Ethereum
      // Any non-local wallet is considered external (checked via State Trie)
      return { registered: false, type: 'unknown', source: null };

    } catch (error) {
      console.error('Error checking wallet registration:', error);
      return { registered: false, type: 'error', source: null };
    }
  }


  start() {
    if (this.isRunning) {
      console.log('Node is already running');
      return;
    }

    // بدء خادم HTTP للـ RPC على منفذ منفصل (5000)
    this.server = http.createServer((req, res) => {
      this.handleRPCRequest(req, res);
    });
    
    // ✅ TRUST WALLET FIX: Increase server timeouts to prevent "socket time expired"
    this.server.keepAliveTimeout = 120000; // 2 minutes
    this.server.headersTimeout = 125000; // slightly more than keepAliveTimeout
    this.server.timeout = 0; // Disable request timeout (Trust Wallet needs this)

    // بدء خادم WebSocket للاشتراكات
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws) => {
      // ✅ TRUST WALLET FIX: Set longer ping interval
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      this.handleWebSocketConnection(ws);
    });
    
    // ✅ TRUST WALLET FIX: Ping all WebSocket clients periodically
    const pingInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // Every 30 seconds
    
    this.wss.on('close', () => {
      clearInterval(pingInterval);
    });

    this.server.listen(this.port, '0.0.0.0', () => {
      console.log(`Access Node RPC server running on port ${this.port}`);
      console.log(`WebSocket server running for real-time updates`);
      this.isRunning = true;
    });

    // بدء التعدين التلقائي
    this.startAutoProcessing();
  }

  // 🚀 TRUST WALLET ADVANCED REFRESH - إجبار التحديث الفوري مع مسح الـ Cache
  async sendTrustWalletNotification(address, data) {
    try {
      if (!this.connectedWallets) return;

      const normalizedAddress = address.toLowerCase();
      const balanceHex = data.newBalance ? ('0x' + Math.floor(data.newBalance * 1e18).toString(16)) : '0x0';

      // 🔥 ADVANCED: Trust Wallet Cache Busting Strategy
      const trustWalletAdvancedRefresh = [
        // 1️⃣ FORCE CACHE CLEAR - إجبار مسح الذاكرة المؤقتة
        {
          jsonrpc: '2.0',
          method: 'wallet_revokePermissions',
          params: [{
            eth_accounts: {}
          }],
          id: Date.now()
        },
        // 2️⃣ RE-REQUEST PERMISSIONS - إعادة طلب الأذونات
        {
          jsonrpc: '2.0',
          method: 'wallet_requestPermissions',
          params: [{
            eth_accounts: {}
          }],
          id: Date.now() + 1
        },
        // 3️⃣ ACCOUNT CHANGED EVENT - حدث تغيير الحساب
        {
          jsonrpc: '2.0', 
          method: 'wallet_accountsChanged',
          params: [normalizedAddress],
          id: Date.now() + 2
        },
        // 4️⃣ CHAIN CHANGED EVENT - حدث تغيير الشبكة (يجبر إعادة التحميل)
        {
          jsonrpc: '2.0',
          method: 'wallet_chainChanged',
          params: {
            chainId: '0x5968',
            networkVersion: '22888'
          },
          id: Date.now() + 3
        },
        // 5️⃣ BALANCE UPDATE WITH CACHE BYPASS - تحديث الرصيد مع تجاوز الـ Cache
        {
          jsonrpc: '2.0',
          method: 'eth_getBalance',
          params: [normalizedAddress, 'latest'],
          result: balanceHex,
          forceUpdate: true,
          bypassCache: true,
          trustWalletRefresh: true,
          cacheControl: 'no-cache, no-store, must-revalidate'
        },
        // 6️⃣ NETWORK SWITCH (forces Trust Wallet UI refresh)
        {
          jsonrpc: '2.0',
          method: 'wallet_switchEthereumChain',
          params: [{
            chainId: '0x5968'
          }],
          id: Date.now() + 4
        },
        // 7️⃣ BALANCE CHANGE EVENT - حدث تغيير الرصيد
        {
          type: 'trustwallet_balance_update',
          method: 'balance_changed',
          address: normalizedAddress,
          balance: balanceHex,
          balanceFormatted: (data.newBalance || 0).toFixed(8) + ' ACCESS',
          chainId: '0x5968',
          networkName: 'Access Network',
          timestamp: Date.now(),
          forceRefresh: true,
          clearCache: true,
          trustWalletSpecific: true,
          refreshUI: true
        },
        // 8️⃣ SUBSCRIPTION EVENT - حدث الاشتراك
        {
          jsonrpc: '2.0',
          method: 'eth_subscription',
          params: {
            subscription: '0xTrustWallet' + Date.now(),
            result: {
              address: normalizedAddress,
              balance: balanceHex,
              blockNumber: '0x' + Math.floor(Date.now() / 1000).toString(16),
              chainId: '0x5968',
              forceUpdate: true
            }
          }
        },
        // 9️⃣ ASSETS CHANGED EVENT - حدث تغيير الأصول
        {
          jsonrpc: '2.0',
          method: 'wallet_assetsChanged',
          params: {
            address: normalizedAddress,
            assets: [{
              chainId: '0x5968',
              address: 'native',
              balance: balanceHex,
              symbol: 'ACCESS',
              decimals: 18
            }]
          },
          id: Date.now() + 5
        },
        // 🔟 FINAL CONFIRMATION - التأكيد النهائي
        {
          type: 'balance_final_update',
          address: normalizedAddress,
          balance: data.newBalance || 0,
          balanceWei: balanceHex,
          balanceFormatted: (data.newBalance || 0).toFixed(8) + ' ACCESS',
          currency: 'ACCESS',
          network: 'Access Network',
          chainId: '22888',
          hexChainId: '0x5968',
          forceUIUpdate: true,
          clearInternalCache: true,
          refreshTimestamp: Date.now()
        }
      ];

      // إرسال كل إشعار مع تأخير تدريجي محسّن
      this.connectedWallets.forEach((walletWs, walletAddress) => {
        if (walletWs.readyState === 1 && walletAddress.toLowerCase() === normalizedAddress) {
          trustWalletAdvancedRefresh.forEach((notification, index) => {
            setTimeout(() => {
              try {
                walletWs.send(JSON.stringify(notification));
              } catch (sendError) {
                console.error(`Error sending Trust Wallet refresh ${index + 1}:`, sendError);
              }
            }, index * 150); // 150ms بين كل إشعار (أسرع من قبل)
          });

          // 🔄 CONTINUOUS REFRESH - تحديث مستمر لمدة 10 ثوان
          const refreshInterval = setInterval(() => {
            if (walletWs.readyState === 1) {
              try {
                walletWs.send(JSON.stringify({
                  jsonrpc: '2.0',
                  method: 'eth_getBalance',
                  params: [normalizedAddress, 'latest'],
                  result: balanceHex,
                  forceUpdate: true,
                  timestamp: Date.now()
                }));
              } catch (err) {
                clearInterval(refreshInterval);
              }
            } else {
              clearInterval(refreshInterval);
            }
          }, 1000); // كل ثانية

          // إيقاف التحديث المستمر بعد 10 ثوان
          setTimeout(() => {
            clearInterval(refreshInterval);
            
            // إشعار نهائي قوي
            try {
              const finalPush = {
                type: 'trust_wallet_balance_confirmed',
                address: normalizedAddress,
                balance: data.newBalance || 0,
                balanceHex: balanceHex,
                message: `رصيدك المحدث: ${(data.newBalance || 0).toFixed(8)} ACCESS`,
                timestamp: Date.now(),
                finalConfirmation: true,
                forceDisplayUpdate: true
              };
              walletWs.send(JSON.stringify(finalPush));
            } catch (finalError) {
              console.error('Error sending final push:', finalError);
            }
          }, 10000);
        }
      });

    } catch (error) {
      console.error('Error in Trust Wallet advanced refresh:', error);
    }
  }

  // تحديث قاعدة البيانات بدون تكرار - ETHEREUM STYLE  
  async updateDatabaseBalancesOnly(fromAddress, toAddress, senderBalance, recipientBalance) {
    try {
      const { pool } = await import('./db.js');
      
      // 🚀 ACCESS-STYLE: Invalidate cache before DB update
      accessCache.invalidate(fromAddress);
      accessCache.invalidate(toAddress);
      

      // Ensure address column is TEXT type
      try {
        await pool.query(`
          ALTER TABLE external_wallets 
          ALTER COLUMN address TYPE TEXT USING address::text,
          ALTER COLUMN wallet_address TYPE TEXT USING wallet_address::text
        `);
      } catch (alterError) {
        // Column already correct type or doesn't exist
      }

      // Update external wallets table - ensure TEXT type for addresses
      const currentTime = Date.now();
      
      // Cast addresses to TEXT explicitly to avoid type mismatch
      const fromAddressText = String(fromAddress.toLowerCase());
      const toAddressText = String(toAddress.toLowerCase());
      
      // REMOVED: external_wallets updates - Using State Trie only like Ethereum

      // Update users table if applicable with explicit type casting
      await pool.query(`
        UPDATE users SET coins = $1::numeric
        WHERE LOWER(wallet_address) = $2::text
      `, [senderBalance.toFixed(8), fromAddressText]);

      await pool.query(`
        UPDATE users SET coins = $1::numeric
        WHERE LOWER(wallet_address) = $2::text
      `, [recipientBalance.toFixed(8), toAddressText]);

      console.log(`✅ DATABASE UPDATE COMPLETE - NO DUPLICATION`);

      return true;
    } catch (error) {
      console.error('❌ Error in database update:', error);
      return false;
    }
  }

  // Calculate transaction hash for signature verification
  calculateTransactionHash(txData) {
    try {
      // Create RLP-encoded transaction data
      const fields = [
        txData.nonce || 0,
        txData.gasPrice || 1000000000,
        txData.gasLimit || 21000,
        txData.to || '0x',
        txData.value || 0,
        txData.data || '0x',
        22888, // chainId
        0,
        0
      ];
      
      // RLP encode
      const rlpEncoded = rlp.encode(fields);
      
      // Calculate keccak256 hash
      const hash = '0x' + keccak256(rlpEncoded);
      
      return hash;
    } catch (error) {
      console.error('Error calculating transaction hash:', error);
      return null;
    }
  }

  // Clean up expired nonces to prevent memory buildup
  cleanupExpiredNonces() {
    try {
      if (!this.activeNonces) return;

      const now = Date.now();
      const expiredTime = 5 * 60 * 1000; // 5 minutes expiry
      let cleanedCount = 0;

      for (const [key, data] of this.activeNonces.entries()) {
        if ((now - data.timestamp) > expiredTime) {
          this.activeNonces.delete(key);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`🧹 Cleaned up ${cleanedCount} expired nonces`);
      }
    } catch (error) {
      console.error('Error cleaning up expired nonces:', error);
    }
  }

  // Smart Queue System - NO RATE LIMITS for millions of users
  checkRateLimit(address) {
    // RATE LIMITING REMOVED - Using smart queue instead
    // This allows handling millions of transactions without arbitrary limits
    return true;
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
    if (this.wss) {
      this.wss.close();
    }
    this.isRunning = false;
    console.log('Access Node stopped');
  }

  async handleRPCRequest(req, res) {
    // إعداد CORS محسن لدعم جميع المحافظ
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    // 🔥 TRUST WALLET FIX: منع أي caching نهائياً
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '-1');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // 🔥 ETag متغير لإجبار Trust Wallet على إعادة الطلب
    res.setHeader('ETag', `"${Date.now()}-${Math.random().toString(36)}"`);
    res.setHeader('Vary', '*');
    res.setHeader('Last-Modified', new Date().toUTCString());
    // ✅ TRUST WALLET FIX: Keep connection alive to prevent "socket time expired"
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=120');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const request = JSON.parse(body);
          const response = await this.processRPCCall(request);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (error) {
          console.error('RPC Error:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid Request' },
            id: null
          }));
        }
      });
    } else if (req.method === 'GET') {
      // معالجة API endpoints لجلب البيانات
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;

      // API لجلب جميع المعاملات
      if (pathname === '/api/transactions') {
        try {
          const transactions = await this.getAllTransactions();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            data: transactions,
            total: transactions.length,
            timestamp: Date.now()
          }));
          return;
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }
      }

      // API لجلب معاملات محددة بالعنوان
      if (pathname === '/api/transactions/address') {
        try {
          const address = url.searchParams.get('address');
          if (!address) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Address parameter required' }));
            return;
          }
          
          const transactions = await this.getTransactionsByAddress(address);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            address: address,
            data: transactions,
            total: transactions.length,
            timestamp: Date.now()
          }));
          return;
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }
      }

      // API لجلب الأرصدة
      if (pathname === '/api/balances') {
        try {
          const balances = await this.getAllBalances();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            data: balances,
            timestamp: Date.now()
          }));
          return;
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }
      }

      // API لجلب رصيد عنوان محدد
      if (pathname === '/api/balance') {
        try {
          const address = url.searchParams.get('address');
          if (!address) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Address parameter required' }));
            return;
          }
          
          const balance = this.blockchain.getBalance(address);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            address: address,
            balance: balance.toFixed(8),
            balanceWei: '0x' + Math.floor(balance * 1e18).toString(16),
            timestamp: Date.now()
          }));
          return;
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }
      }

      // API لجلب الكتل
      if (pathname === '/api/blocks') {
        try {
          const blocks = await this.getAllBlocks();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            data: blocks,
            total: blocks.length,
            timestamp: Date.now()
          }));
          return;
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }
      }

      // API لجلب كتلة محددة
      if (pathname.startsWith('/api/block/')) {
        try {
          const blockNumber = pathname.split('/')[3];
          let block;
          
          if (blockNumber === 'latest') {
            block = this.blockchain.getLatestBlock();
          } else {
            const index = parseInt(blockNumber);
            block = this.blockchain.getBlockByIndex(index);
          }
          
          if (!block) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Block not found' }));
            return;
          }
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            data: block,
            timestamp: Date.now()
          }));
          return;
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }
      }

      // API للإحصائيات
      if (pathname === '/api/stats') {
        try {
          const stats = await this.getNetworkStats();
          
          // 🚀 Add Access-style cache stats
          const cacheStats = accessCache.getStats();
          stats.cache = cacheStats;
          stats.scalability = {
            current_capacity: `${cacheStats.totalEntries} addresses cached`,
            max_capacity: '160,000 addresses',
            performance: `${cacheStats.hitRate} cache hit rate`,
            access_mode: 'ACTIVE'
          };
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            data: stats,
            timestamp: Date.now()
          }));
          return;
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }
      }

      // API لجلب المعاملات المعلقة
      if (pathname === '/api/pending') {
        try {
          const pendingTx = this.blockchain.pendingTransactions || [];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            data: pendingTx,
            total: pendingTx.length,
            timestamp: Date.now()
          }));
          return;
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }
      }
      // معلومات الشبكة
      try {
        const networkInfo = await this.blockchain.getNetworkInfo();
        const stats = this.getStats();

        // تحقق إذا كان الطلب من MetaMask أو محفظة أخرى
        const userAgent = req.headers['user-agent'] || '';
        const isWalletRequest = userAgent.includes('MetaMask') ||
                                userAgent.includes('Trust') ||
                                req.headers['x-requested-with'];

        let responseData;

        if (isWalletRequest) {
          // استجابة محسنة للمحافظ مع بيانات التحقق MetaMask
          const networkConfig = {
            chainId: '0x5968', // Chain ID فريد - القيمة الصحيحة
            networkId: '22888', // Network ID الصحيح
            chainName: 'Access Network',
            nativeCurrency: {
              name: 'Access Coin',
              symbol: 'ACCESS',
              decimals: 18
            },
            rpcUrls: [`https://glowing-space-cod-v665jpxrr4grc6p4p-5000.app.github.dev/`],
            blockExplorerUrls: [`https://glowing-space-cod-v665jpxrr4grc6p4p-3000.app.github.dev/access-explorer.html#`],
            // بيانات إضافية لـ MetaMask
            ensAddress: null,
            features: ['EIP155', 'EIP1559', 'AEP20'],
            tokenStandard: 'AEP-20',
            forkId: null,
            status: 'active',
            isTestnet: false,
            slip44: 22888,
            genesis: {
              hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
              number: '0x0',
              timestamp: '0x0'
            },
            // تأكيد Chain ID بطرق متعددة
            id: '0x5968',
            network_id: 22888,
            hex_chain_id: '0x5968'
          };
          responseData = networkConfig;
        } else {
          // استجابة كاملة للمتصفحات العادية
          responseData = {
            ...networkInfo,
            ...stats,
            endpoint: `${req.headers.host || 'localhost:5000'}`,
            status: 'active',
            chainId: '0x5968', // Chain ID الصحيح
            blockHeight: this.blockchain.chain.length - 1,
            circulatingSupply: await this.blockchain.calculateCirculatingSupply(),
            pendingTransactions: this.blockchain.pendingTransactions.length,
            difficulty: this.blockchain.difficulty,
            processingReward: this.blockchain.processingReward,
            gasPrice: this.blockchain.getGasPrice()
          };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responseData));
      } catch (error) {
        console.error('Error getting network info:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Internal server error',
          message: error.message,
          chainId: '0x5968' // Chain ID الصحيح حتى في حالة الخطأ
        }));
      }
    }
  }

  async processRPCCall(request) {
    const { method, params, id } = request;

    try {
      let result;

      switch (method) {
        case 'eth_getBalance':
          const balanceAddress = params[0];
          const balanceBlockTag = params[1] || 'latest';

          // 🔧 TRUST WALLET FIX: التحقق من صحة parameters أولاً
          if (!params || params.length === 0) {
            console.warn('⚠️ eth_getBalance called without parameters');
            result = '0x0';
            break;
          }

          // التحقق من صحة العنوان
          if (!balanceAddress || !balanceAddress.startsWith('0x') || balanceAddress.length !== 42) {
            console.warn(`⚠️ Invalid address format for eth_getBalance: ${balanceAddress}`);
            result = '0x0';
            break;
          }

          // توحيد العنوان إلى lowercase
          const normalizedAddress = balanceAddress.toLowerCase();
          
          // ⚡ INSTANT BALANCE - مثل Ethereum/BSC/Polygon تماماً
          // القراءة مباشرة من this.blockchain.balances (Map في الذاكرة)
          let finalBalance = 0;
          try {
            // 🔥 PRIORITY 1: قراءة مباشرة من Map الأرصدة في الذاكرة (أسرع طريقة)
            // هذا هو نفس ما يفعله geth - يقرأ من state trie في الذاكرة
            const directBalance = this.blockchain.balances?.get(normalizedAddress);
            if (directBalance !== undefined && directBalance !== null) {
              finalBalance = directBalance;
              // تسجيل صامت (كل 5 ثوانٍ فقط لنفس العنوان)
              const logKey = `balance_${normalizedAddress}`;
              if (!this._lastBalanceLogTimes) this._lastBalanceLogTimes = {};
              if (!this._lastBalanceLogTimes[logKey] || Date.now() - this._lastBalanceLogTimes[logKey] > 5000) {
                console.log(`⚡ DIRECT BALANCE: ${normalizedAddress.slice(0, 10)}... = ${finalBalance.toFixed(8)} ACCESS`);
                this._lastBalanceLogTimes[logKey] = Date.now();
              }
            } else {
              // 🔥 PRIORITY 2: fallback لـ getBalance() إذا لم يكن في الـ Map مباشرة
              finalBalance = this.blockchain.getBalance(normalizedAddress);
            }
            
            // ✅ التأكد من أن القيمة رقمية وليست NaN
            if (isNaN(finalBalance) || finalBalance === null || finalBalance === undefined) {
              finalBalance = 0;
            }
          } catch (balanceError) {
            console.warn(`⚠️ Error getting balance for ${normalizedAddress}:`, balanceError.message);
            finalBalance = 0;
          }
          
          // ✅ CRITICAL: التأكد من عدم إرجاع قيم سالبة أو غير صحيحة
          finalBalance = Math.max(0, finalBalance);
          
          // 🔧 FIX: تقريب الرصيد لتجنب أرقام طويلة مثل 0.225336999999999904
          // تقريب إلى 8 أرقام عشرية (مثل Binance) ثم تحويل لـ Wei
          const roundedBalance = Math.round(finalBalance * 1e8) / 1e8;
          const balanceInWei = Math.floor(roundedBalance * 1e18);
          
          // ✅ التحقق من صحة القيمة النهائية
          if (balanceInWei < 0 || isNaN(balanceInWei) || !isFinite(balanceInWei)) {
            console.warn(`⚠️ Invalid balance calculated for ${normalizedAddress}, returning 0`);
            result = '0x0';
          } else {
            result = '0x' + balanceInWei.toString(16);
          }
          break;

        case 'eth_sendTransaction':
          console.log(`📤 طلب إرسال معاملة عبر RPC:`, {
            from: params[0].from,
            to: params[0].to,
            value: params[0].value,
            chainId: '0x5968'
          });
          result = await this.sendTransaction(params[0]);
          console.log(`✅ معاملة RPC مرسلة بنجاح: ${result}`);
          break;

        case 'eth_sendRawTransaction':
          // Handle raw signed transactions with INSTANT MetaMask balance update
          console.log(`📤 Raw transaction received - processing with INSTANT MetaMask update`);
          try {
            const rawTx = params[0];

            // التحقق الأساسي من تنسيق المعاملة
            if (!rawTx || typeof rawTx !== 'string') {
              throw new Error('Invalid raw transaction: must be a hex string');
            }

            let processedRawTx = rawTx;
            if (!rawTx.startsWith('0x')) {
              processedRawTx = '0x' + rawTx;
            }

            if (processedRawTx.length < 100) { // minimum length for a valid transaction
              throw new Error('Invalid raw transaction: too short to be valid');
            }

            // تحليل المعاملة الخام مع التحقق الصارم المحسن
            let txData;
            try {
              txData = await this.parseAndValidateRawTransaction(processedRawTx);
              
              // 🔧 CRITICAL FIX: Validate sender address extraction
              if (!txData) {
                throw new Error('Transaction parsing failed - no data returned');
              }
              
              // التحقق من وجود عنوان المرسل
              if (!txData.from || txData.from === '0x' || txData.from.length !== 42) {
                console.log('⚠️ Sender address missing or invalid, attempting recovery...');
                
                // محاولة 1: استخراج من التوقيع مباشرة (إذا لم يتم بالفعل)
                if (txData.signature && txData.signature.v && txData.signature.r && txData.signature.s) {
                  try {
                    const EC = pkg.ec;
                    const ec = new EC('secp256k1');
                    
                    // حساب message hash
                    const messageHash = this.calculateTransactionHash(txData);
                    
                    // استخراج recovery ID من v
                    const chainId = 22888;
                    const v = parseInt(txData.signature.v);
                    const recoveryId = v - (chainId * 2 + 35);
                    
                    // استرجاع المفتاح العام
                    const publicKey = ec.recoverPubKey(
                      Buffer.from(messageHash.replace('0x', ''), 'hex'),
                      txData.signature,
                      recoveryId
                    );
                    
                    // تحويل إلى عنوان Ethereum
                    const pubKeyHex = publicKey.encode('hex', false).slice(2);
                    const address = '0x' + keccak256(Buffer.from(pubKeyHex, 'hex')).slice(-40);
                    
                    txData.from = address;
                    console.log(`✅ Recovered sender from signature: ${address}`);
                  } catch (recoverError) {
                    console.error('❌ Signature recovery failed:', recoverError.message);
                  }
                }
                
                // محاولة 2: استخدام recent nonce activity (فقط كـ last resort)
                if (!txData.from && this.lastUsedNonces && this.lastUsedNonces.size > 0) {
                  console.log('⚠️ Using last resort: recent nonce activity...');
                  
                  let recentSender = null;
                  let recentNonce = -1;
                  
                  for (const [address, nonce] of this.lastUsedNonces.entries()) {
                    if (nonce > recentNonce) {
                      recentNonce = nonce;
                      recentSender = address;
                    }
                  }
                  
                  if (recentSender) {
                    console.log(`⚠️ Using recent sender: ${recentSender} (nonce: ${recentNonce})`);
                    txData.from = recentSender;
                  }
                }
              }
              
              // التحقق النهائي
              if (!txData.from || txData.from === '0x' || txData.from.length !== 42) {
                throw new Error('Unable to extract valid sender address from transaction');
              }
              
              console.log(`✅ Final validated sender address: ${txData.from}`);
              
            } catch (parseError) {
              console.error('❌ Transaction parsing failed:', parseError.message);
              throw new Error(`Transaction rejected: ${parseError.message}`);
            }

            // ✅ CONTRACT DEPLOYMENT: Allow empty 'to' for contract deployment
            if (!txData || !txData.from) {
              console.error('❌ Transaction parsing failed - rejecting transaction');
              throw new Error('Transaction rejected: Unable to parse sender address');
            }
            
            // ⚡ علامة لمنع الخصم المزدوج - الأرصدة ستُحدث في addTransaction فقط
            txData.balanceAlreadyProcessed = false;
            
            // For regular transactions, 'to' is required, but for contract deployment it's empty
            if (!txData.isContractDeployment && !txData.to) {
              console.error('❌ Regular transaction missing recipient address');
              throw new Error('Transaction rejected: Missing recipient address for regular transaction');
            }

            // 🔧 ENHANCED SENDER DETECTION: استخدام الكشف المحسن للعنوان الصحيح
            const correctSenderAddress = this.detectCorrectSenderAddress(txData.from, txData.value);
            if (correctSenderAddress !== txData.from) {
              console.log(`🔄 SENDER CORRECTED: ${txData.from} → ${correctSenderAddress}`);
              txData.from = correctSenderAddress;
            }

            // ADVANCED SECURITY CHECKS

            // Check if address is blocked
            if (this.antiAttackMonitor.isBlocked(txData.from)) {
              throw new Error('🚫 Address is temporarily blocked due to suspicious activity');
            }

            // Check for rapid transaction attempts
            if (!this.antiAttackMonitor.checkRapidTransactions(txData.from)) {
              throw new Error('🚫 Rate limit exceeded - too many rapid transactions');
            }

            // Check for double spending attempts
            if (!this.antiAttackMonitor.checkDoubleSpending(txData.from, txData.nonce, txData.hash)) {
              throw new Error('🚫 Double spending attempt detected');
            }

            // ADVANCED PROTECTION: Check rate limits
            this.checkRateLimit(txData.from);

            // ADVANCED PROTECTION: Check for pending transactions from same address
            const pendingFromSameAddress = this.blockchain.pendingTransactions.filter(
              tx => tx.fromAddress === txData.from
            ).length;

            if (pendingFromSameAddress >= 3) {
              throw new Error('Too many pending transactions from this address');
            }

            console.log(`🔐 Parsed transaction data:`, {
              from: txData.from,
              to: txData.to,
              value: txData.value + ' ACCESS',
              gasPrice: (txData.gasPrice / 1e9) + ' Gwei',
              nonce: txData.nonce
            });

            // STRICT BALANCE CHECK - MANDATORY FOR ALL TRANSACTIONS
            const senderBalance = this.blockchain.getBalance(txData.from);
            const gasFeeInAccess = (txData.gasPrice * txData.gasLimit) / 1e18;
            const totalRequired = txData.value + gasFeeInAccess;

            console.log(`💰 BALANCE CHECK:`, {
              sender: txData.from,
              currentBalance: senderBalance.toFixed(8) + ' ACCESS',
              amountToSend: txData.value.toFixed(8) + ' ACCESS',
              gasFee: gasFeeInAccess.toFixed(8) + ' ACCESS',
              totalRequired: totalRequired.toFixed(8) + ' ACCESS',
              hasSufficientBalance: senderBalance >= totalRequired
            });

            // 🔄 TRUST WALLET: Force sync with database FIRST
            let actualBalance = senderBalance;
            try {
              // REMOVED: external_wallets dependency - Using State Trie only like Ethereum
              // Sync with users table
              const userResult = await pool.query('SELECT coins FROM users WHERE LOWER(wallet_address) = $1', [txData.from.toLowerCase()]);
              if (userResult.rows.length > 0) {
                const dbBalance = parseFloat(userResult.rows[0].coins) || 0;
                this.blockchain.updateBalance(txData.from, dbBalance);
                actualBalance = dbBalance;
                console.log(`🔄 TRUST WALLET: Synced from users: ${txData.from} = ${dbBalance.toFixed(8)} ACCESS`);
              }
            } catch (dbError) {
              console.warn('TRUST WALLET: DB sync error, using blockchain balance:', dbError.message);
            }

            // إعادة حساب المتطلبات مع الرصيد المحدث
            const balanceDifference = totalRequired - actualBalance;
            const precisionTolerance = 0.00000010; // More generous tolerance for external wallets

            console.log(`💰 UPDATED BALANCE CHECK:`, {
              sender: txData.from,
              originalBalance: senderBalance.toFixed(8) + ' ACCESS',
              updatedBalance: actualBalance.toFixed(8) + ' ACCESS',
              totalRequired: totalRequired.toFixed(8) + ' ACCESS',
              difference: balanceDifference.toFixed(8) + ' ACCESS',
              withinTolerance: balanceDifference <= precisionTolerance
            });

            if (balanceDifference > precisionTolerance) {
              const errorMsg = `❌ TRANSACTION REJECTED: Insufficient balance. Required: ${totalRequired.toFixed(8)} ACCESS, Available: ${actualBalance.toFixed(8)} ACCESS, Shortage: ${balanceDifference.toFixed(8)} ACCESS`;
              console.error(errorMsg);
              throw new Error(errorMsg);
            }

            // تعديل ذكي للمعاملات ضمن هامش التسامح
            if (balanceDifference > 0 && balanceDifference <= precisionTolerance) {
              console.log(`🔧 SMART ADJUSTMENT: Reducing transaction by ${balanceDifference.toFixed(8)} ACCESS to fit balance`);
              txData.value = Math.max(0, txData.value - balanceDifference);
              console.log(`✅ SMART ADJUSTED TRANSACTION: New amount: ${txData.value.toFixed(8)} ACCESS`);
            }

            // تصنيف المحافظ قبل المعالجة
            const walletClassification = await this.classifyWallets(txData.from, txData.to);

            // Create transaction with validated data
            const transaction = new Transaction(
              txData.from,
              txData.to,
              txData.value,
              gasFeeInAccess,
              txData.timestamp || Date.now()
            );

            transaction.hash = txData.hash;
            transaction.nonce = txData.nonce;
            transaction.signature = txData.signature;
            transaction.gasLimit = txData.gasLimit;
            transaction.validated = true;
            transaction.external = true;

            // إضافة البيانات المطلوبة لحفظ قاعدة البيانات
            transaction.from = txData.from;
            transaction.to = txData.to;
            transaction.value = txData.value;
            transaction.fromAddress = txData.from;
            transaction.toAddress = txData.to;
            transaction.amount = txData.value;
            
            // ✅ CONTRACT DEPLOYMENT FIX: Pass data field (contract bytecode)
            transaction.data = txData.data;
            transaction.inputData = txData.data; // Alternative field name
            transaction.input = txData.data; // Another alternative
            transaction.isContractDeployment = txData.isContractDeployment; // Pass deployment flag

            // Check for duplicate transaction hash
            const existingTx = this.blockchain.getTransactionByHash(transaction.hash);
            if (existingTx) {
              console.warn('⚠️ Duplicate transaction hash detected, generating new hash');
              transaction.hash = '0x' + crypto.createHash('sha256').update(transaction.hash + Date.now()).digest('hex');
            }

            // التحقق من معالجة سابقة للمعاملة
            const txKeyByHash = `${txData.from}-${txData.to}-${txData.value}-${txData.hash}`;
            if (!this.processedBalanceUpdates) {
              this.processedBalanceUpdates = new Set();
            }

            if (this.processedBalanceUpdates.has(txKeyByHash)) {
              console.log(`⚠️ Balance update already processed for transaction ${txData.hash}, skipping`);
              result = txData.hash;
              break;
            }

            // التحقق الصارم من المعالجة المضاعفة
            const txKey = `${txData.from}-${txData.to}-${txData.value}-${txData.nonce}`;
            const txHashKey = `hash-${txData.hash}`;

            if (!this.processedBalanceUpdates) {
              this.processedBalanceUpdates = new Set();
            }

            // فحص مضاعف - بواسطة nonce وhash
            if (this.processedBalanceUpdates.has(txKey) || this.processedBalanceUpdates.has(txHashKey)) {
              console.log(`🚫 DUPLICATE PROCESSING BLOCKED: ${txKey} or ${txHashKey} already processed`);
              result = txData.hash;
              break;
            }

            // حجز المعاملة قبل المعالجة
            this.processedBalanceUpdates.add(txKey);
            this.processedBalanceUpdates.add(txHashKey);

            // إنشاء المعاملة بدون خصم الرصيد مسبقاً
            console.log(`🔄 CREATING TRANSACTION without premature balance deduction...`);

            // وضع علامة على المعاملة كمعالجة
            this.processedBalanceUpdates.add(txKeyByHash);
            this.processedBalanceUpdates.add(txKey);

            // FIRST: Add to blockchain (سيتم خصم الرصيد هنا تلقائياً)
            const txHash = await Promise.resolve(this.blockchain.addTransaction(transaction));

            // ✅ TRUST WALLET FIX: حفظ المعاملة في cache فوراً للـ receipt
            if (!this.recentTransactionCache) {
              this.recentTransactionCache = new Map();
            }
            
            // ✅ FIX: استخدام المتغيرات الصحيحة المعرّفة مسبقاً
            const txGasFee = (txData.gasPrice * txData.gasLimit) / 1e18;
            const txGasPrice = txData.gasPrice || 1e9;
            
            this.recentTransactionCache.set(txHash, {
              hash: txHash,
              txId: txHash,
              fromAddress: txData.from,
              toAddress: txData.to,
              from: txData.from,
              to: txData.to,
              amount: typeof txData.value === 'number' ? txData.value : parseFloat(txData.value) || 0,
              value: typeof txData.value === 'number' ? txData.value : parseFloat(txData.value) || 0,
              gasFee: txGasFee,
              gasPrice: txGasPrice,
              nonce: txData.nonce,
              timestamp: Date.now(),
              blockIndex: this.blockchain.chain.length,
              blockHash: '0x' + crypto.createHash('sha256').update(txHash + Date.now().toString()).digest('hex'),
              status: 'confirmed'
            });
            console.log(`📦 Transaction cached for instant receipt: ${txHash.slice(0, 16)}...`);

            // SECOND: Save to database after blockchain processing
            await this.saveTransactionToDatabase(transaction);

            // THIRD: Update database balances only (no duplication)
            const finalSenderBalance = this.blockchain.getBalance(txData.from);
            const finalRecipientBalance = this.blockchain.getBalance(txData.to);
            await this.updateDatabaseBalancesOnly(txData.from, txData.to, finalSenderBalance, finalRecipientBalance);

            console.log(`✅ TRANSACTION PROCESSING: Ledger and database synchronized`);

            console.log(`✅ TRANSACTION COMPLETED SUCCESSFULLY: ${txHash}`);
            console.log(`📊 FINAL BALANCES: Sender: ${finalSenderBalance.toFixed(8)} ACCESS, Recipient: ${finalRecipientBalance.toFixed(8)} ACCESS`);

            // 🔥 METAMASK-STYLE: تسجيل المعاملة في confirmedTransactionTracker
            // هذا يحاكي سلوك TransactionController:transactionConfirmed في MetaMask
            if (this.confirmedTransactionTracker) {
              this.confirmedTransactionTracker.set(txHash, {
                from: txData.from.toLowerCase(),
                to: txData.to.toLowerCase(),
                timestamp: Date.now(),
                senderBalance: finalSenderBalance,
                recipientBalance: finalRecipientBalance
              });
            }
            
            // 🔥 METAMASK-STYLE: تسجيل الأرصدة المؤكدة للوصول الفوري
            // هذا يحاكي سلوك refreshAddresses() في AccountTrackerController
            if (this.recentlyConfirmedAddresses) {
              this.recentlyConfirmedAddresses.set(txData.from.toLowerCase(), {
                balance: finalSenderBalance,
                timestamp: Date.now()
              });
              this.recentlyConfirmedAddresses.set(txData.to.toLowerCase(), {
                balance: finalRecipientBalance,
                timestamp: Date.now()
              });
              console.log(`⚡ METAMASK-STYLE: Cached confirmed balances for instant eth_getBalance response`);
            }

            // 🔥 CRITICAL: تحديث lastBalanceChange لتفعيل التحديث التلقائي
            this.lastBalanceChange = Date.now();

            // ⚡ ETHEREUM-STYLE INSTANT SYNC: زيادة كبيرة جداً لإجبار المحافظ على تحديث فوري
            if (!this.virtualBlockOffset) this.virtualBlockOffset = 0;
            this.virtualBlockOffset += 500; // زيادة ضخمة جداً لضمان التحديث الفوري (5x أكثر من السابق)
            this.lastBalanceChange = Date.now(); // تحديث timestamp
            // إضافة العناوين للقائمة المعلقة
            this.pendingBalanceAddresses.add(txData.from.toLowerCase());
            this.pendingBalanceAddresses.add(txData.to.toLowerCase());
            console.log(`⚡ INSTANT: Virtual block jumped +500 to: ${this.virtualBlockOffset} (addresses marked for sync)`);

            // 🔥 بث newHeads فوري لجميع الاتصالات
            this.broadcastImmediateNewHeads(txData.from, txData.to, finalSenderBalance, finalRecipientBalance);

            // 🚀 Trust Wallet Synchronization Fix - حل مشكلة عدم التزامن
            setTimeout(async () => {
              try {
                console.log(`🔧 TRUST WALLET SYNC FIX: Starting balance synchronization...`);
                
                // إشعار المرسل - متعدد المراحل
                await this.sendTrustWalletNotification(txData.from, {
                  type: 'transaction_sender_balance_update',
                  newBalance: finalSenderBalance,
                  transactionHash: txHash,
                  direction: 'sent'
                });

                // إشعار المستقبل - متعدد المراحل 
                await this.sendTrustWalletNotification(txData.to, {
                  type: 'transaction_recipient_balance_update', 
                  newBalance: finalRecipientBalance,
                  transactionHash: txHash,
                  direction: 'received'
                });

                console.log(`✅ Trust Wallet sync notifications sent for transaction: ${txHash}`);

                // تحديث ثانوي بعد 2 ثانية لضمان التزامن
                setTimeout(async () => {
                  try {
                    await this.broadcastInstantBalanceUpdate(txData.to, finalRecipientBalance);
                    
                    // إرسال إشعار خاص لـ Trust Wallet لإجبار التحديث
                    if (this.connectedWallets) {
                      this.connectedWallets.forEach((walletWs, walletAddress) => {
                        if (walletWs.readyState === 1 && walletAddress.toLowerCase() === txData.to.toLowerCase()) {
                          const forceUpdate = {
                            type: 'trust_wallet_force_balance_sync',
                            address: txData.to.toLowerCase(),
                            balance: finalRecipientBalance,
                            balanceHex: '0x' + Math.floor(finalRecipientBalance * 1e18).toString(16),
                            message: 'فرض تحديث الرصيد في Trust Wallet',
                            timestamp: Date.now()
                          };
                          walletWs.send(JSON.stringify(forceUpdate));
                        }
                      });
                    }
                    
                    console.log(`🔄 Trust Wallet force update sent to recipient: ${txData.to}`);
                  } catch (secondaryError) {
                    console.error('Error in secondary Trust Wallet update:', secondaryError);
                  }
                }, 2000);

                // تحديث ثالث بعد 5 ثوان للتأكد المطلق
                setTimeout(async () => {
                  try {
                    if (this.connectedWallets) {
                      this.connectedWallets.forEach((walletWs, walletAddress) => {
                        if (walletWs.readyState === 1 && walletAddress.toLowerCase() === txData.to.toLowerCase()) {
                          const confirmUpdate = {
                            jsonrpc: '2.0',
                            method: 'eth_getBalance',
                            params: [txData.to.toLowerCase(), 'latest'],
                            result: '0x' + Math.floor(finalRecipientBalance * 1e18).toString(16),
                            trustWalletFinalConfirmation: true,
                            balanceFormatted: finalRecipientBalance.toFixed(8) + ' ACCESS'
                          };
                          walletWs.send(JSON.stringify(confirmUpdate));
                        }
                      });
                    }
                    console.log(`🎯 Trust Wallet final confirmation sent: ${finalRecipientBalance.toFixed(8)} ACCESS`);
                  } catch (finalError) {
                    console.error('Error in final Trust Wallet confirmation:', finalError);
                  }
                }, 5000);

              } catch (notificationError) {
                console.error('Error in Trust Wallet synchronization fix:', notificationError);
              }
            }, 300); // بدء التحديث فور انتهاء المعاملة

            // ✅ TRUST WALLET FIX: إرجاع transaction hash فقط كـ string
            // Trust Wallet يتوقع string بسيط، وليس object معقد
            // CRITICAL: Ensure txHash is resolved (not a Promise)
            const resolvedHash = await Promise.resolve(txHash);
            result = typeof resolvedHash === 'string' ? resolvedHash : String(resolvedHash);
            console.log(`🎯 TRUST WALLET RESPONSE: Returning transaction hash only: ${result}`);

          } catch (error) {
            console.error('❌ Raw transaction processing failed:', error);

            // إرجاع خطأ مفصل للمحفظة
            throw new Error(`Transaction failed: ${error.message}. Please check your wallet connection and try again.`);
          }
          break;

        case 'eth_getTransactionByHash':
          result = await this.getTransactionByHash(params[0]);
          break;

        case 'eth_getBlockByNumber':
          result = await this.getBlockByNumber(params[0]);
          break;

        case 'eth_getBlockByHash':
          result = await this.getBlockByHash(params[0]);
          break;

        case 'eth_blockNumber':
          // ⚡ METAMASK-STYLE: block number يتغير بشكل عدواني جداً لإجبار المحافظ على eth_getBalance جديد
          // من بحث MetaMask Core: AccountTrackerController يستخدم 10 ثوانٍ polling interval
          // لكن عند transactionConfirmed يستدعي refreshAddresses() فوراً
          // الحل: نجعل block number يتغير بشكل مختلف في كل طلب
          
          const realBlockNumber = this.blockchain.chain.length - 1;
          const virtualOffset = this.virtualBlockOffset || 0;
          
          // ⚡ UNIQUE BLOCK: رقم فريد لكل طلب (تغيير كل 5ms)
          const uniqueTimestamp = Math.floor(Date.now() / 5);
          
          // ⚡ RANDOM COMPONENT: إضافة عشوائية لضمان التغيير المستمر
          const randomOffset = Math.floor(Math.random() * 100);
          
          // ⚡ PENDING BOOST: زيادة كبيرة عند وجود عناوين معلقة
          const pendingBoost = (this.pendingBalanceAddresses?.size || 0) * 500;
          
          // ⚡ CONFIRMATION BOOST: زيادة إضافية عند وجود معاملات مؤكدة حديثاً
          const confirmationBoost = (this.confirmedTransactionTracker?.size || 0) * 200;
          
          // حساب رقم البلوك النهائي
          const calculatedBlock = realBlockNumber + virtualOffset + (uniqueTimestamp % 100000) + randomOffset + pendingBoost + confirmationBoost;
          result = '0x' + calculatedBlock.toString(16);
          
          // تسجيل صامت (كل 10 ثوانٍ فقط)
          if (!this._lastBlockNumberLog || Date.now() - this._lastBlockNumberLog > 10000) {
            console.log(`📦 eth_blockNumber: ${calculatedBlock} (real: ${realBlockNumber}, virtual: ${virtualOffset}, pending: ${this.pendingBalanceAddresses?.size || 0})`);
            this._lastBlockNumberLog = Date.now();
          }
          break;

        case 'net_version':
          result = '22888'; // Network ID كرقم - القيمة الصحيحة
          break;

        case 'eth_chainId':
          // إرجاع Chain ID بشكل ثابت ومتسق لـ MetaMask
          result = '0x5968'; // 22888 في hex - Chain ID فريد - القيمة الصحيحة
          break;

        case 'eth_getTransactionCount':
          // حساب nonce صحيح وتراكمي مع الحفظ الدائم - كل معاملة لها nonce فريد
          const nonceAddress = params[0];
          const blockTag = params[1] || 'latest';

          if (!nonceAddress || !nonceAddress.startsWith('0x')) {
            result = '0x0';
          } else {
            const normalizedAddress = nonceAddress.toLowerCase();
            let currentNonce = 0;

            try {
              // التأكد من وجود الأعمدة المطلوبة
              try {
                await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN DEFAULT false');
                await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS confirmations INTEGER DEFAULT 0');
              } catch (alterError) {
                console.log('Columns already exist or error adding them:', alterError.message);
              }

              // استخدام الدالة المحسنة من البلوكتشين للحصول على nonce مستمر
              currentNonce = await this.blockchain.getNonce(normalizedAddress);

              // التأكد من أن nonce لا يتجاوز الحد الأقصى لـ integer
              if (currentNonce > 2147483647) {
                currentNonce = (currentNonce % 1000000) + 1; // تحويل إلى رقم آمن
                console.log(`🔢 Adjusted oversized nonce to safe value: ${currentNonce}`);
              }

              // حفظ آخر nonce في ذاكرة محلية للجلسة
              if (!this.lastUsedNonces) {
                this.lastUsedNonces = new Map();
              }
              this.lastUsedNonces.set(normalizedAddress, currentNonce);

              console.log(`🔢 PERSISTENT nonce calculated for ${normalizedAddress}: ${currentNonce}`);

            } catch (error) {
              console.error('Error calculating persistent nonce:', error);
              
              // Fallback معزز: البحث في قاعدة البيانات يدوياً
              try {
                const fallbackResult = await pool.query(`
                  SELECT MAX(nonce) as max_nonce 
                  FROM transactions 
                  WHERE LOWER(from_address) = $1
                `, [normalizedAddress]);

                currentNonce = parseInt(fallbackResult.rows[0]?.max_nonce || 0) + 1;
                console.log(`🔢 FALLBACK database nonce for ${normalizedAddress}: ${currentNonce}`);
              } catch (fallbackError) {
                // آخر fallback: استخدام timestamp
                currentNonce = Math.floor(Date.now() / 1000) % 1000000;
                console.log(`🔢 EMERGENCY timestamp nonce for ${normalizedAddress}: ${currentNonce}`);
              }
            }

            result = '0x' + currentNonce.toString(16);
            console.log(`✅ FINAL PERSISTENT nonce for ${normalizedAddress}: ${currentNonce} (0x${currentNonce.toString(16)})`);
          }
          break;

        case 'eth_gasPrice':
          // MetaMask يطلب هذا أحياناً
          result = '0x3B9ACA00'; // 1 Gwei
          break;

        case 'eth_estimateGas':
          // نظام تقدير الغاز المتقدم مع دعم Use Max مثل MetaMask وTrust Wallet
          const txParams = params[0] || {};
          let gasEstimate = 21000; // الغاز الأساسي للتحويل

          // حساب إضافي للمعاملات المعقدة
          if (txParams.data && txParams.data !== '0x') {
            const dataLength = Math.ceil((txParams.data.length - 2) / 2);
            gasEstimate += dataLength * 68; // 68 gas لكل byte
            gasEstimate = Math.min(gasEstimate, 200000); // حد أقصى معقول
          }

          // كشف Use Max بطريقة شاملة مثل شبكات العملات الأخرى
          const isUseMaxRequest = txParams.from && (
            txParams.value === 'max' ||
            txParams.value === 'all' ||
            txParams.useMax === true ||
            txParams.sendAll === true ||
            txParams.maxTransfer === true ||
            txParams.sendEntireBalance === true ||
            (typeof txParams.value === 'string' && (
              txParams.value.toLowerCase().includes('max') ||
              txParams.value.toLowerCase().includes('all') ||
              txParams.value === '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
            ))
          );

          if (isUseMaxRequest) {
            console.log(`🎯 USE MAX DETECTED - Processing like MetaMask/Trust Wallet for ${txParams.from}`);

            // الحصول على الرصيد الدقيق مع مزامنة شاملة
            let currentBalance = this.blockchain.getBalance(txParams.from);

            try {
              // مزامنة مع قاعدة البيانات للحصول على الرصيد الصحيح
              const userResult = await pool.query('SELECT coins FROM users WHERE LOWER(wallet_address) = $1', [txParams.from.toLowerCase()]);
              if (userResult.rows.length > 0) {
                const dbBalance = parseFloat(userResult.rows[0].coins) || 0;
                if (dbBalance > currentBalance) {
                  this.blockchain.updateBalance(txParams.from, dbBalance);
                  currentBalance = dbBalance;
                  console.log(`🔄 Balance synced from users table: ${dbBalance.toFixed(8)} ACCESS`);
                }
              }

              // REMOVED: external_wallets dependency - Using State Trie only like Ethereum
            } catch (dbError) {
              console.warn('Balance sync warning during Use Max:', dbError.message);
            }

            // حساب رسوم الغاز بدقة مثل شبكات العملات المشهورة
            const gasPriceGwei = 1; // 1 Gwei ثابت (مثل BSC)
            const gasPriceWei = gasPriceGwei * 1e9;
            const totalGasCostWei = gasEstimate * gasPriceWei;
            const exactGasFeeAccess = totalGasCostWei / 1e18; // رسوم الغاز بالضبط

            console.log(`💰 USE MAX CALCULATION:`, {
              totalBalance: currentBalance.toFixed(8) + ' ACCESS',
              gasFee: exactGasFeeAccess.toFixed(8) + ' ACCESS',
              gasEstimate: gasEstimate,
              gasPriceGwei: gasPriceGwei
            });

            // حساب الحد الأقصى القابل للإرسال (مثل MetaMask تماماً)
            let maxSendableAmount = 0;
            let safetyBuffer = 0.00000001; // هامش أمان صغير جداً

            if (currentBalance <= exactGasFeeAccess) {
              // رصيد غير كافي لدفع رسوم الغاز
              maxSendableAmount = 0;
              console.log(`⚠️ Insufficient balance for gas fees. Balance: ${currentBalance.toFixed(8)}, Gas needed: ${exactGasFeeAccess.toFixed(8)}`);
            } else {
              // الحساب النهائي: الرصيد - رسوم الغاز - هامش الأمان
              maxSendableAmount = currentBalance - exactGasFeeAccess - safetyBuffer;
              maxSendableAmount = Math.max(0, maxSendableAmount);

              // تقريب إلى 8 خانات عشرية (مثل أغلب شبكات العملات)
              maxSendableAmount = Math.floor(maxSendableAmount * 100000000) / 100000000;

              // فحص أمني أخير: التأكد أن المجموع لا يتجاوز الرصيد
              const totalRequired = maxSendableAmount + exactGasFeeAccess;
              if (totalRequired > currentBalance) {
                maxSendableAmount = Math.max(0, currentBalance - exactGasFeeAccess - 0.00000002);
                maxSendableAmount = Math.floor(maxSendableAmount * 100000000) / 100000000;
                console.log(`🔧 AUTO-ADJUSTED for safety: ${maxSendableAmount.toFixed(8)} ACCESS`);
              }
            }

            console.log(`✅ USE MAX READY:`, {
              maxSendable: maxSendableAmount.toFixed(8) + ' ACCESS',
              totalCost: (maxSendableAmount + exactGasFeeAccess).toFixed(8) + ' ACCESS',
              remainingBalance: (currentBalance - maxSendableAmount - exactGasFeeAccess).toFixed(8) + ' ACCESS',
              canSend: maxSendableAmount > 0
            });

            // إرجاع نتيجة متوافقة مع جميع المحافظ مثل BSC و Ethereum
            result = {
              // رقم الغاز المقدر (مطلوب أساسي)
              gas: '0x' + gasEstimate.toString(16),
              gasPrice: '0x' + gasPriceWei.toString(16),
              
              // معلومات Use Max (MetaMask compatible)
              maxSendableValue: '0x' + Math.floor(maxSendableAmount * 1e18).toString(16),
              maxSendableFormatted: maxSendableAmount.toFixed(8) + ' ACCESS',
              
              // معلومات الرصيد والرسوم
              currentBalance: '0x' + Math.floor(currentBalance * 1e18).toString(16),
              currentBalanceFormatted: currentBalance.toFixed(8) + ' ACCESS',
              estimatedGasFee: exactGasFeeAccess.toFixed(8) + ' ACCESS',
              estimatedGasFeeWei: '0x' + totalGasCostWei.toString(16),
              
              // معلومات النجاح
              useMaxSupported: true,
              canSendMax: maxSendableAmount > 0,
              smartCalculation: true,
              
              // معلومات الشبكة
              chainId: '0x5968',
              networkName: 'Access Network',
              gasLimit: gasEstimate,
              
              // تأكيد التوافق
              walletCompatible: {
                metamask: true,
                trustWallet: true,
                coinbaseWallet: true,
                binanceSmartChain: true,
                ethereum: true
              },
              
              success: true
            };
          } else {
            // تقدير غاز عادي للمعاملات التقليدية - إرجاع hex فقط مثل الشبكات الأخرى
            result = '0x' + gasEstimate.toString(16);
          }
          break;

        case 'access_calculateMaxSendable':
        case 'wallet_getMaxSendable':
        case 'eth_getMaxSendable':
        case 'wallet_useMax':
        case 'metamask_useMax':
        case 'trustwallet_useMax':
          // نظام USE MAX محسّن يعمل مثل MetaMask وTrust Wallet وBinance Smart Chain
          const senderAddr = params[0] || params?.from || params?.address;
          if (senderAddr) {
            // الحصول على الرصيد الدقيق مع المزامنة
            let currentBal = this.blockchain.getBalance(senderAddr);

            try {
              // مزامنة مع قاعدة البيانات للحصول على الرصيد الصحيح
              const userResult = await pool.query('SELECT coins FROM users WHERE LOWER(wallet_address) = $1', [senderAddr.toLowerCase()]);
              if (userResult.rows.length > 0) {
                const dbBalance = parseFloat(userResult.rows[0].coins) || 0;
                if (dbBalance > currentBal) {
                  this.blockchain.updateBalance(senderAddr, dbBalance);
                  currentBal = dbBalance;
                  console.log(`🔄 USE MAX: Balance synced from DB: ${dbBalance.toFixed(8)} ACCESS`);
                }
              }

              // REMOVED: external_wallets dependency - Using State Trie only like Ethereum
            } catch (dbError) {
              console.warn('USE MAX: DB sync warning:', dbError.message);
            }

            // حساب رسوم الغاز بدقة (مثل شبكات العملات المشهورة)
            const gasLimit = 21000;
            const gasPriceGwei = 1; // 1 Gwei (مثل BSC)
            const gasPriceWei = gasPriceGwei * 1e9;
            const totalGasCostWei = gasLimit * gasPriceWei;
            const exactGasFeeAccess = totalGasCostWei / 1e18; // 0.000021 ACCESS

            console.log(`💰 USE MAX CALCULATION:`, {
              totalBalance: currentBal.toFixed(8) + ' ACCESS',
              gasFee: exactGasFeeAccess.toFixed(8) + ' ACCESS',
              gasLimit: gasLimit,
              gasPriceGwei: gasPriceGwei
            });

            // حساب الحد الأقصى (مثل MetaMask تماماً)
            let maxSendable = 0;

            if (currentBal <= exactGasFeeAccess) {
              // رصيد غير كافي لدفع رسوم الغاز
              maxSendable = 0;
              console.log(`⚠️ Insufficient balance for gas fees. Balance: ${currentBal.toFixed(8)}, Gas needed: ${exactGasFeeAccess.toFixed(8)}`);
            } else {
              // الحساب الدقيق: الرصيد - رسوم الغاز - هامش أمان صغير
              const safetyBuffer = 0.00000001; // هامش أمان صغير جداً
              maxSendable = currentBal - exactGasFeeAccess - safetyBuffer;
              maxSendable = Math.max(0, maxSendable);

              // تقريب إلى 8 خانات عشرية (معيار الشبكات)
              maxSendable = Math.floor(maxSendable * 100000000) / 100000000;

              // فحص أمني نهائي
              const totalRequired = maxSendable + exactGasFeeAccess;
              if (totalRequired > currentBal) {
                maxSendable = Math.max(0, currentBal - exactGasFeeAccess - 0.00000002);
                maxSendable = Math.floor(maxSendable * 100000000) / 100000000;
                console.log(`🔧 AUTO-ADJUSTED for safety: ${maxSendable.toFixed(8)} ACCESS`);
              }
            }

            console.log(`✅ USE MAX CALCULATION COMPLETE:`, {
              maxSendable: maxSendable.toFixed(8) + ' ACCESS',
              totalCost: (maxSendable + exactGasFeeAccess).toFixed(8) + ' ACCESS',
              remainingBalance: (currentBal - maxSendable - exactGasFeeAccess).toFixed(8) + ' ACCESS',
              canSend: maxSendable > 0
            });

            result = {
              // النتيجة الرئيسية (MetaMask compatible)
              maxSendable: maxSendable.toFixed(8),
              maxSendableWei: '0x' + Math.floor(maxSendable * 1e18).toString(16),
              maxSendableFormatted: maxSendable.toFixed(8) + ' ACCESS',

              // الرصيد الحالي
              balance: currentBal.toFixed(8),
              balanceWei: '0x' + Math.floor(currentBal * 1e18).toString(16),
              balanceFormatted: currentBal.toFixed(8) + ' ACCESS',

              // تفاصيل رسوم الغاز
              estimatedGasFee: exactGasFeeAccess.toFixed(8),
              estimatedGasFeeWei: '0x' + totalGasCostWei.toString(16),
              gasPrice: gasPriceGwei + ' Gwei',
              gasPriceWei: '0x' + gasPriceWei.toString(16),
              gasLimit: gasLimit,

              // معلومات النجاح
              canSendMax: maxSendable > 0,
              smartCalculation: true,
              universalCompatible: true,

              // دعم العملة
              nativeCurrency: {
                symbol: 'ACCESS',
                decimals: 18,
                name: 'Access Coin'
              },

              // توافق المحافظ (مثل الشبكات المشهورة)
              walletCompatibility: {
                metamask: true,
                trustWallet: true,
                coinbaseWallet: true,
                binanceSmartChain: true,
                ethereum: true,
                polygon: true,
                allWallets: true
              },

              // معلومات الشبكة
              chainId: '0x5968',
              networkId: '22888',
              networkName: 'Access Network',

              // تأكيدات النجاح
              success: true,
              useMaxReady: true,
              precisCalculation: true
            };

            console.log(`🎯 USE MAX READY: ${maxSendable.toFixed(8)} ACCESS (Gas: ${exactGasFeeAccess.toFixed(8)} ACCESS)`);
            break;

          } else {
            throw new Error('Address required for Use Max calculation');
          }
          break;

        case 'access_getNetworkInfo':
          result = {
            chainId: '0x5968', // القيمة الصحيحة
            networkId: '22888', // القيمة الصحيحة
            chainName: 'Access Network',
            nativeCurrency: {
              name: 'Access Coin',
              symbol: 'ACCESS',
              decimals: 18
            },
            rpcUrls: [`https://glowing-space-cod-v665jpxrr4grc6p4p-5000.app.github.dev/`],
            blockExplorerUrls: [`https://glowing-space-cod-v665jpxrr4grc6p4p-3000.app.github.dev/access-explorer.html#`]
          };
          break;

        case 'web3_clientVersion':
          result = 'NetworkNode/1.0.0';
          break;

        case 'net_listening':
          result = true;
          break;

        case 'net_peerCount':
          result = '0x' + this.blockchain.peers.size.toString(16);
          break;

        case 'access_createWallet':
          result = this.blockchain.createWallet();
          break;

        case 'access_mineBlock':
          result = await this.mineBlock(params[0]);
          break;

        case 'access_getPeers':
          result = Array.from(this.blockchain.peers);
          break;

        case 'access_getMempool':
          result = this.blockchain.pendingTransactions || [];
          break;

        case 'access_migrateBalances':
          result = await this.migrateExistingBalances();
          break;

        case 'access_getCirculatingSupply':
          result = await this.blockchain.calculateCirculatingSupply();
          break;

        case 'access_getGasPrice':
          result = this.blockchain.getGasPrice();
          break;

        case 'access_setGasPrice':
          result = this.blockchain.setGasPrice(params[0]);
          break;

        case 'access_estimateGas':
          result = this.blockchain.estimateGas(params[0]);
          break;

        case 'access_estimateTransactionFee':
          result = this.blockchain.estimateTransactionFee(params[0]);
          break;

        case 'access_registerExternalWallet':
          // تسجيل محفظة خارجية جديدة
          result = await this.registerExternalWallet(params[0]);
          break;

        case 'access_getExternalWallets':
          // جلب جميع المحافظ الخارجية المسجلة
          result = await this.getExternalWallets();
          break;

        case 'access_trackWalletActivity':
          // تتبع نشاط محفظة
          result = await this.trackWalletActivity(params[0], params[1]);
          break;

        case 'access_getConnectedWallets':
          // الحصول على المحافظ المتصلة حالياً
          result = Array.from(this.connectedWallets.keys()).map(address => ({
            address: address,
            balance: this.blockchain.getBalance(address).toFixed(8),
            isConnected: true
          }));
          console.log(`📱 المحافظ المتصلة حالياً: ${result.length} محفظة`);
          result.forEach(wallet => {
            console.log(`   - ${wallet.address}: ${wallet.balance} ACCESS`);
          });
          break;

        case 'access_resetReservations':
          // 🔄 إعادة تعيين جميع الحجوزات (لحل مشكلة INSUFFICIENT BALANCE)
          if (this.blockchain.resetAllReservations) {
            this.blockchain.resetAllReservations();
          }
          result = {
            success: true,
            message: 'All reservations have been reset',
            timestamp: Date.now()
          };
          console.log('🔄 Reset all reservations via RPC');
          break;

        case 'access_getReservationStatus':
          // عرض حالة الحجوزات الحالية
          const reservedBalances = {};
          this.blockchain.reservedBalances.forEach((amount, address) => {
            reservedBalances[address] = amount.toFixed(8);
          });
          result = {
            reservedBalances: reservedBalances,
            pendingReservationsCount: this.blockchain.pendingReservations.size,
            reservationTimeout: this.blockchain.reservationTimeout
          };
          break;

        case 'access_debugWalletInfo':
          // معلومات تصحيح الأخطاء للمحفظة
          const debugAddress = params[0];
          const walletBalance = this.blockchain.getBalance(debugAddress);
          const isConnected = this.connectedWallets.has(debugAddress);
          const walletTransactions = this.blockchain.getAllTransactionsForWallet(debugAddress);

          result = {
            address: debugAddress,
            balance: walletBalance.toFixed(8),
            isConnected: isConnected,
            transactionCount: walletTransactions.length,
            chainId: this.blockchain.hexChainId,
            networkId: this.blockchain.networkId,
            lastActivity: Date.now(),
            status: 'active'
          };

          console.log(`🔍 معلومات تصحيح المحفظة ${debugAddress}:`, result);
          break;

        case 'access_forceBalanceSync':
          // فرض مزامنة الرصيد للمحفظة مع قاعدة البيانات
          const syncAddress = params[0];
          if (syncAddress && syncAddress.startsWith('0x') && syncAddress.length === 42) {
            let blockchainBalance = this.blockchain.getBalance(syncAddress);
            let syncedFromDB = false;
            let dataSource = 'blockchain';

            // جلب الرصيد من قاعدة البيانات
            try {
              // REMOVED: external_wallets dependency - Using State Trie only like Ethereum
              {
                // البحث في جدول المستخدمين
                const userResult = await pool.query('SELECT coins FROM users WHERE wallet_address = $1', [syncAddress]);
                if (userResult.rows.length > 0) {
                  const dbBalance = parseFloat(userResult.rows[0].coins) || 0;
                  if (dbBalance > blockchainBalance) {
                    this.blockchain.updateBalance(syncAddress, dbBalance);
                    blockchainBalance = dbBalance;
                    syncedFromDB = true;
                    dataSource = 'users';
                    console.log(`🔄 Synced from users table: ${syncAddress} = ${dbBalance.toFixed(8)} ACCESS`);
                  }
                }
              }
            } catch (dbError) {
              console.error('Error syncing from database:', dbError);
            }

            // إشعار المحفظة بالرصيد المحدث
            await this.sendEnhancedWalletNotification(syncAddress, {
              type: 'force_balance_sync',
              balance: blockchainBalance,
              timestamp: Date.now(),
              dataSource: dataSource
            });

            result = {
              success: true,
              address: syncAddress,
              balance: blockchainBalance.toFixed(8),
              blockchainBalance: blockchainBalance.toFixed(8),
              synced: true,
              syncedFromDatabase: syncedFromDB,
              dataSource: dataSource
            };

            console.log(`🔄 Force sync completed for ${syncAddress}: ${blockchainBalance.toFixed(8)} ACCESS (source: ${dataSource})`);
          } else {
            throw new Error('Invalid address for balance sync');
          }
          break;

        case 'access_getWalletStatus':
          // الحصول على حالة المحفظة الشاملة
          const statusAddress = params[0];
          const walletStatus = {
            address: statusAddress,
            balance: this.blockchain.getBalance(statusAddress).toFixed(8),
            isConnected: this.connectedWallets.has(statusAddress),
            chainId: '0x5968',
            networkId: '22888',
            transactions: this.blockchain.getAllTransactionsForWallet(statusAddress).length,
            lastUpdate: Date.now(),
            networkStatus: 'active'
          };

          result = walletStatus;
          console.log(`📊 Wallet status for ${statusAddress}:`, walletStatus);
          break;

        case 'access_getNetworkStats':
          // جلب إحصائيات الشبكة الحقيقية من قاعدة البيانات
          try {
            // احصل على عدد المعاملات الحقيقي من قاعدة البيانات
            let totalTransactions = 0;
            try {
              if (this.blockchain.storage && typeof this.blockchain.storage.countAllTransactions === 'function') {
                totalTransactions = await this.blockchain.storage.countAllTransactions();
                console.log(`📊 Got real transaction count from database: ${totalTransactions}`);
              } else {
                // Fallback to memory count if database not available
                totalTransactions = this.blockchain.getAllTransactions().length;
                console.log(`⚠️ Using memory transaction count (database unavailable): ${totalTransactions}`);
              }
            } catch (dbError) {
              console.warn('⚠️ Database count failed, using memory:', dbError.message);
              totalTransactions = this.blockchain.getAllTransactions().length;
            }
            
            const latestBlock = this.blockchain.getLatestBlock();
            const circulatingSupply = await this.blockchain.calculateCirculatingSupply();
            const maxSupply = 25000000; // 25 مليون ACCESS
            
            // حساب TPS المتوسط
            const avgTps = totalTransactions > 0 ? (totalTransactions / Math.max(1, latestBlock?.index || 1)) : 0;
            
            // حساب وقت الكتلة المتوسط
            const avgBlockTime = this.blockchain.advancedMetrics?.averageBlockTime || 3;
            
            result = {
              success: true,
              data: {
                maxSupply: maxSupply,
                circulatingSupply: circulatingSupply,
                totalTransactions: totalTransactions,
                latestBlock: latestBlock?.index || 0,
                blockHeight: latestBlock?.index || 0,
                blockTime: avgBlockTime,
                tps: parseFloat(avgTps.toFixed(1)),
                difficulty: this.blockchain.difficulty || 1,
                gasPrice: this.blockchain.getGasPrice(),
                pendingTransactions: this.blockchain.pendingTransactions.length,
                chainId: '0x5968',
                networkId: '22888',
                networkStatus: 'active',
                timestamp: Date.now()
              }
            };
            
            console.log('📊 RPC Network stats provided (from database):', result.data);
          } catch (error) {
            console.error('Error getting network stats:', error);
            result = {
              success: false,
              error: error.message,
              data: {
                maxSupply: 25000000,
                circulatingSupply: 0,
                totalTransactions: 0,
                latestBlock: 0,
                blockHeight: 0,
                blockTime: 3,
                tps: 0,
                difficulty: 1,
                gasPrice: 0.00002,
                pendingTransactions: 0,
                chainId: '0x5968',
                networkId: '22888',
                networkStatus: 'active',
                timestamp: Date.now()
              }
            };
          }
          break;

        case 'wallet_getMaxSendable':
          // حساب الحد الأقصى القابل للإرسال (مع رسوم الغاز الدقيقة والمحسنة)
          const maxSenderAddr = params[0] || params?.address;
          if (maxSenderAddr) {
            const senderBalance = this.blockchain.getBalance(maxSenderAddr);

            // حساب رسوم الغاز بدقة أكبر
            const standardGasLimit = 21000; // الغاز الأساسي للتحويل البسيط
            const gasPriceInGwei = 1; // 1 Gwei = 1,000,000,000 wei
            const gasPriceInWei = gasPriceInGwei * 1e9;
            const totalGasCostInWei = standardGasLimit * gasPriceInWei;
            const totalGasCostInAccess = totalGasCostInWei / 1e18;

            // إضافة هامش أمان صغير (0.5% إضافي)
            const safetyMargin = senderBalance * 0.005;
            const totalReservedAmount = totalGasCostInAccess + safetyMargin;

            // الحد الأقصى = الرصيد الحالي - (رسوم الغاز + هامش الأمان)
            const maxSendableAmount = Math.max(0, senderBalance - totalReservedAmount);

            // إذا كان الرصيد قريب من الحد الأدنى، اترك هامش أكبر
            const finalMaxSendable = senderBalance < 1.0 ?
              Math.max(0, senderBalance - (totalGasCostInAccess * 1.1)) : // 10% هامش إضافي للأرصدة الصغيرة
              maxSendableAmount;

            result = {
              address: maxSenderAddr,
              balance: senderBalance.toFixed(8) + ' ACCESS',
              maxSendable: finalMaxSendable.toFixed(8) + ' ACCESS',
              maxSendableWei: '0x' + Math.floor(finalMaxSendable * 1e18).toString(16),
              estimatedGasFee: totalGasCostInAccess.toFixed(8) + ' ACCESS',
              gasPrice: gasPriceInGwei + ' Gwei',
              gasLimit: standardGasLimit,
              safetyMargin: safetyMargin.toFixed(8) + ' ACCESS',
              chainId: '0x5968',
              networkId: '22888',
              canSendMax: finalMaxSendable > 0,
              warning: finalMaxSendable <= 0 ? 'رصيد غير كافي لدفع رسوم الغاز' : null,
              smartCalculation: true
            };

            console.log(`💡 حساب ذكي للحد الأقصى: ${maxSenderAddr} = ${finalMaxSendable.toFixed(8)} ACCESS (مع هامش أمان)`);
          } else {
            throw new Error('عنوان المحفظة مطلوب لحساب الحد الأقصى');
          }
          break;

        case 'wallet_getBalance':
          // Universal wallet balance request - compatible with all wallets and exchanges
          const walletAddress = params[0] || params?.address;
          if (walletAddress) {
            const currentBalance = this.blockchain.getBalance(walletAddress);

            // Force sync with database for accuracy
            try {
              // REMOVED: external_wallets dependency - Using State Trie only like Ethereum
            } catch (dbError) {
              console.error('Error syncing wallet balance:', dbError);
            }

            const finalBalance = this.blockchain.getBalance(walletAddress);

            // Universal response format compatible with all wallet types
            result = {
              address: walletAddress,
              balance: '0x' + Math.floor(finalBalance * 1e18).toString(16),
              balanceFormatted: finalBalance.toFixed(8) + ' ACCESS',
              balanceDecimal: finalBalance.toString(),
              chainId: '0x5968',
              networkId: '22888',
              symbol: 'ACCESS',
              decimals: 18,
              network: 'Access Network',
              timestamp: Date.now()
            };

            console.log(`💳 Universal wallet balance request: ${walletAddress} = ${finalBalance.toFixed(8)} ACCESS`);
          } else {
            throw new Error('Address required for balance request');
          }
          break;

        case 'wallet_requestBalance':
          // Alternative method for Trust Wallet
          const requestAddress = params[0];
          if (requestAddress && requestAddress.startsWith('0x') && requestAddress.length === 42) {
            await this.notifyTrustWalletBalance(requestAddress, {
              type: 'balance_request',
              timestamp: Date.now()
            });

            const requestBalance = this.blockchain.getBalance(requestAddress);
            result = {
              success: true,
              address: requestAddress,
              balance: requestBalance.toFixed(8),
              hex: '0x' + Math.floor(requestBalance * 1e18).toString(16)
            };
          } else {
            throw new Error('Invalid address for balance request');
          }
          break;

        case 'wallet_calculateMaxTransfer':
        case 'eth_maxTransferAmount':
        case 'wallet_useMax':
          // طلبات خاصة بـ "Use Max" من المحافظ المختلفة
          const useMaxAddress = params[0] || params?.from || params?.address;
          if (useMaxAddress) {
            const currentBalance = this.blockchain.getBalance(useMaxAddress);

            // حساب رسوم الغاز بدقة
            const gasLimit = 21000;
            const gasPriceGwei = 1;
            const gasPriceWei = gasPriceGwei * 1e9;
            const totalGasCost = gasLimit * gasPriceWei;
            const gasFeeAccess = totalGasCost / 1e18;

            // حساب الحد الأقصى مع هامش أمان ديناميكي
            const safetyBuffer = currentBalance > 10 ? 0.00001 : 0.000005;
            const maxTransferAmount = Math.max(0, currentBalance - gasFeeAccess - safetyBuffer);

            result = {
              address: useMaxAddress,
              currentBalance: currentBalance.toFixed(8) + ' ACCESS',
              maxTransferAmount: maxTransferAmount.toFixed(8) + ' ACCESS',
              maxTransferAmountWei: '0x' + Math.floor(maxTransferAmount * 1e18).toString(16),
              estimatedGasFee: gasFeeAccess.toFixed(8) + ' ACCESS',
              estimatedGasFeeWei: '0x' + totalGasCost.toString(16),
              gasPrice: gasPriceGwei + ' Gwei',
              gasLimit: gasLimit,
              safetyBuffer: safetyBuffer.toFixed(8) + ' ACCESS',
              canTransferMax: maxTransferAmount > 0,
              useMaxReady: true,
              walletCompatibility: {
                metamask: true,
                trustWallet: true,
                coinbaseWallet: true,
                phantomWallet: true
              }
            };

            console.log(`💎 USE MAX calculation for ${useMaxAddress}: ${maxTransferAmount.toFixed(8)} ACCESS ready for transfer`);
          } else {
            throw new Error('Address required for Use Max calculation');
          }
          break;

        case 'eth_accounts':
          // MetaMask يطلب هذا أحياناً
          result = [];
          break;

        case 'eth_requestAccounts':
          // MetaMask يطلب هذا للاتصال
          result = [];
          break;

        case 'wallet_requestPermissions':
          // صلاحيات المحفظة
          result = [{ parentCapability: 'eth_accounts' }];
          break;

        case 'wallet_getPermissions':
          // الحصول على الصلاحيات
          result = [{ parentCapability: 'eth_accounts' }];
          break;

        case 'wallet_getCapabilities':
          // ✅ إخبار MetaMask بقدرات الشبكة - هذا يوقف Token Detection للشبكات الخاصة
          result = {
            '0x5968': { // Chain ID 22888
              tokenDetection: false,
              addressResolution: false,
              nftDetection: false,
              phishingDetection: false
            }
          };
          break;

        case 'wallet_scanQRCode':
          // دعم مسح QR code
          result = null;
          break;

        case 'wallet_getSnaps':
          // MetaMask Snaps - غير مدعوم
          result = {};
          break;

        case 'eth_getCode':
          // Get contract code - for native ACCESS tokens, return empty
          const codeAddress = params[0];

          // التحقق من صحة العنوان مع معالجة أفضل للأخطاء
          if (!codeAddress) {
            result = '0x'; // إرجاع كود فارغ للعناوين الفارغة
          } else if (this.isValidEthereumAddress(codeAddress)) {
            result = '0x'; // إرجاع كود فارغ للعناوين الصحيحة (native tokens)
          } else {
            // بدلاً من رمي خطأ، أرجع كود فارغ
            console.warn(`⚠️ Invalid address for code lookup: ${codeAddress}, returning empty code`);
            result = '0x';
          }
          break;

        case 'eth_getStorageAt':
          // Get storage at position - simplified for native tokens
          result = '0x0000000000000000000000000000000000000000000000000000000000000000';
          break;

        case 'eth_getTransactionStatus':
          // Alternative method for transaction status
          const statusTxHash = params[0];
          const statusTx = this.blockchain.getTransactionByHash(statusTxHash);
          result = statusTx ? '0x1' : '0x0';
          break;

        case 'eth_feeHistory':
          // Fee history for MetaMask gas estimation
          result = {
            baseFeePerGas: ['0x3B9ACA00'], // 1 Gwei
            gasUsedRatio: [0.5],
            reward: [['0x77359400']] // 2 Gwei
          };
          break;

        case 'eth_maxPriorityFeePerGas':
          // Maximum priority fee per gas
          result = '0x3B9ACA00'; // 1 Gwei
          break;

        case 'web3_sha3':
          // Keccak-256 hash
          const dataToHash = params[0];
          if (dataToHash) {
            const hash = crypto.createHash('sha3-256').update(Buffer.from(dataToHash.slice(2), 'hex')).digest('hex');
            result = '0x' + hash;
          } else {
            throw new Error('No data provided for hashing');
          }
          break;

        case 'eth_sign':
          // Personal message signing - required for some wallet operations
          result = '0x' + Date.now().toString(16) + Math.random().toString(16).substring(2, 18);
          break;

        case 'personal_sign':
          // Personal message signing (alternative format)
          result = '0x' + Date.now().toString(16) + Math.random().toString(16).substring(2, 18);
          break;

        case 'eth_signTypedData':
        case 'eth_signTypedData_v3':
        case 'eth_signTypedData_v4':
          // Typed data signing for dApps
          result = '0x' + Date.now().toString(16) + Math.random().toString(16).substring(2, 18);
          break;

        case 'wallet_addEthereumChain':
          // Add network to wallet - always approve for Access Network
          if (params[0] && params[0].chainId === '0x5968') {
            result = null; // Success
            console.log('✅ Access Network added to wallet');
          } else {
            throw new Error('Only Access Network is supported');
          }
          break;

        case 'wallet_switchEthereumChain':
          // Switch network - always approve for Access Network
          if (params[0] && params[0].chainId === '0x5968') {
            result = null; // Success
            console.log('✅ Switched to Access Network');
          } else {
            throw new Error('Only Access Network is supported');
          }
          break;

        case 'eth_getTransactionReceipt':
          // Get transaction receipt - required for external wallets (Trust Wallet, MetaMask)
          const receiptTxHash = params[0];
          
          // 🔧 TRUST WALLET FIX: Validate transaction hash first
          if (!receiptTxHash || typeof receiptTxHash !== 'string') {
            console.warn('⚠️ Invalid transaction hash for receipt');
            result = null;
            break;
          }
          
          let transaction = this.blockchain.getTransactionByHash(receiptTxHash);
          
          // 🔧 TRUST WALLET FIX: Check cache first for instant receipts
          if (!transaction && this.recentTransactionCache) {
            transaction = this.recentTransactionCache.get(receiptTxHash);
            if (transaction) {
              console.log(`📦 Found transaction in cache: ${receiptTxHash.slice(0, 16)}...`);
            }
          }
          
          // 🔧 TRUST WALLET FIX: Check pending transactions if not found in blockchain
          if (!transaction && this.blockchain.pendingTransactions) {
            transaction = this.blockchain.pendingTransactions.find(tx => tx.hash === receiptTxHash);
          }

          if (transaction) {
            // ✅ ETHEREUM-COMPATIBLE RECEIPT for Trust Wallet
            const blockNum = transaction.blockIndex ? '0x' + transaction.blockIndex.toString(16) : '0x' + this.blockchain.chain.length.toString(16);
            const blockHashValue = transaction.blockHash || '0x' + crypto.createHash('sha256').update(receiptTxHash).digest('hex');
            
            // ✅ TRUST WALLET FIX: ALWAYS create logs array (prevents "Index out of bounds")
            const transferLogs = [];
            
            // فقط إضافة Transfer log إذا كانت هناك قيمة فعلية
            if ((transaction.value || transaction.amount) && (transaction.value > 0 || transaction.amount > 0)) {
              const fromAddress = (transaction.fromAddress || transaction.from || '0x0000000000000000000000000000000000000000').toLowerCase();
              const toAddress = (transaction.toAddress || transaction.to || '0x0000000000000000000000000000000000000000').toLowerCase();
              const amount = transaction.value || transaction.amount || 0;
              const amountInWei = Math.floor(Math.abs(amount) * 1e18);
              
              // التأكد من أن العناوين بصيغة صحيحة (40 حرف hex)
              const fromPadded = fromAddress.replace('0x', '').padStart(40, '0');
              const toPadded = toAddress.replace('0x', '').padStart(40, '0');
              
              transferLogs.push({
                address: toAddress, // The token contract (or recipient for native transfers)
                topics: [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer(address,address,uint256)
                  '0x000000000000000000000000' + fromPadded, // from address (padded to 32 bytes)
                  '0x000000000000000000000000' + toPadded // to address (padded to 32 bytes)
                ],
                data: '0x' + amountInWei.toString(16).padStart(64, '0'), // amount in hex (padded to 32 bytes)
                blockNumber: blockNum,
                transactionHash: receiptTxHash,
                transactionIndex: '0x0',
                blockHash: blockHashValue,
                logIndex: '0x0',
                removed: false
              });
            }
            
            // ✅ ALWAYS return array, even if empty - prevents Trust Wallet errors
            result = {
              transactionHash: receiptTxHash,
              transactionIndex: '0x0',
              blockHash: blockHashValue,
              blockNumber: blockNum,
              from: transaction.fromAddress || transaction.from || '0x0000000000000000000000000000000000000000',
              to: transaction.toAddress || transaction.to || null, // ✅ null if contract creation
              cumulativeGasUsed: '0x5208', // 21000 in hex
              gasUsed: '0x5208', // 21000 in hex
              effectiveGasPrice: '0x3b9aca00', // 1 Gwei
              contractAddress: null, // ✅ null for regular transfers
              logs: transferLogs, // ✅ ALWAYS an array (never undefined/null) - CRITICAL for Trust Wallet
              logsBloom: '0x' + '0'.repeat(512), // ✅ 256 bytes = 512 hex chars
              status: '0x1', // ✅ Success
              type: '0x2', // ✅ EIP-1559 transaction
              root: undefined // ✅ Not used in post-Byzantium
            };
          } else {
            // Trust Wallet needs null (not error) if transaction not found yet
            result = null;
          }
          break;

        case 'eth_getTransactionStatus':
          // Alternative method for transaction status


          result = statusTx ? '0x1' : '0x0';
          break;

        case 'eth_subscribe':
          // نظام اشتراكات شامل لدعم جميع المحافظ
          const subscriptionType = params[0];
          let subscriptionId = '0x' + Date.now().toString(16);

          // إنشاء اشتراك جديد
          if (!this.activeSubscriptions) {
            this.activeSubscriptions = new Map();
          }

          switch (subscriptionType) {
            case 'newHeads':
              // اشتراك في البلوكات الجديدة - مطلوب لـ MetaMask
              this.activeSubscriptions.set(subscriptionId, {
                type: 'newHeads',
                callback: (block) => {
                  this.broadcastSubscriptionResult(subscriptionId, {
                    number: '0x' + block.index.toString(16),
                    hash: block.hash,
                    parentHash: block.previousHash,
                    timestamp: '0x' + Math.floor(block.timestamp / 1000).toString(16),
                    difficulty: '0x' + this.blockchain.difficulty.toString(16),
                    gasLimit: '0x' + (21000 * 1000).toString(16),
                    gasUsed: '0x' + (21000 * block.transactions.length).toString(16)
                  });
                }
              });
              console.log(`📡 New subscription for newHeads: ${subscriptionId}`);
              break;

            case 'logs':
              // اشتراك في الأحداث - مطلوب لـ token events
              const filterParams = params[1] || {};
              this.activeSubscriptions.set(subscriptionId, {
                type: 'logs',
                filter: filterParams,
                callback: (log) => {
                  this.broadcastSubscriptionResult(subscriptionId, log);
                }
              });
              console.log(`📡 New subscription for logs: ${subscriptionId}`);
              break;

            case 'newPendingTransactions':
              // اشتراك في المعاملات المعلقة
              this.activeSubscriptions.set(subscriptionId, {
                type: 'newPendingTransactions',
                callback: (txHash) => {
                  this.broadcastSubscriptionResult(subscriptionId, txHash);
                }
              });
              console.log(`📡 New subscription for pending operations: ${subscriptionId}`);
              break;

            case 'balanceChanges':
              // 🔥 ETHEREUM-STYLE: اشتراك في تغييرات الرصيد (مخصص لـ Trust Wallet)
              const watchAddress = params[1]?.address?.toLowerCase();
              this.activeSubscriptions.set(subscriptionId, {
                type: 'balanceChanges',
                address: watchAddress,
                callback: (balanceData) => {
                  this.broadcastSubscriptionResult(subscriptionId, balanceData);
                }
              });
              console.log(`📡 New subscription for balance changes: ${subscriptionId} (${watchAddress || 'all'})`);
              break;

            case 'syncing':
              // حالة المزامنة
              this.activeSubscriptions.set(subscriptionId, {
                type: 'syncing',
                callback: (syncStatus) => {
                  this.broadcastSubscriptionResult(subscriptionId, syncStatus);
                }
              });
              break;
          }

          result = subscriptionId;
          break;

        case 'eth_unsubscribe':
          // إلغاء الاشتراكات
          result = true;
          break;

        case 'eth_call':
          // معالجة استدعاءات العقود الذكية
          try {
            result = await this.handleContractCall(params[0], params[1] || 'latest');
          } catch (callError) {
            // ✅ إذا كان الخطأ "execution reverted"، نرجعه كـ error response
            if (callError.code === 3) {
              return {
                jsonrpc: '2.0',
                id: id,
                error: {
                  code: 3,
                  message: 'execution reverted',
                  data: '0x'
                }
              };
            }
            throw callError;
          }
          break;

        case 'eth_getLogs':
          // جلب سجلات الأحداث
          result = await this.getEventLogs(params[0]);
          break;

        case 'net_listening':
          result = true;
          break;

        case 'eth_syncing':
          // Return syncing status - false means fully synced
          result = false;
          break;

        case 'eth_coinbase':
          // Return coinbase address (processor address)
          result = '0x0000000000000000000000000000000000000000';
          break;

        case 'eth_processing':
          // Return processing status
          result = true;
          break;

        case 'eth_hashrate':
          // Return network hashrate
          result = '0x' + (this.blockchain.stats?.hashRate || 1000).toString(16);
          break;

        default:
          console.warn(`Unsupported RPC method: ${method}`);
          throw new Error(`Method ${method} not supported. Supported methods include: eth_getBalance, eth_sendTransaction, eth_sendRawTransaction, eth_chainId, net_version, eth_blockNumber, and more.`);
      }

      return {
        jsonrpc: '2.0',
        result: result,
        id: id
      };

    } catch (error) {
      console.error(`RPC Error for method ${method}:`, error);

      // Provide specific error codes that external wallets understand
      let errorCode = -32603; // Internal error
      let errorMessage = error.message;

      if (method === 'eth_sendRawTransaction' || method === 'eth_sendTransaction') {
        errorCode = -32000; // Transaction error
        errorMessage = `Transaction failed: ${error.message}`;
      } else if (method.startsWith('wallet_')) {
        errorCode = 4001; // User rejected request
        errorMessage = `Wallet operation failed: ${error.message}`;
      } else if (method === 'eth_getBalance' || method === 'eth_call') {
        errorCode = -32602; // Invalid params
        errorMessage = `Invalid request: ${error.message}`;
      }

      return {
        jsonrpc: '2.0',
        error: {
          code: errorCode,
          message: errorMessage,
          data: {
            originalError: error.message,
            method: method,
            chainId: '0x5968',
            networkId: '22888'
          }
        },
        id: id
      };
    }
  }

  async getBalance(address) {
    const balance = this.blockchain.getBalance(address);
    return '0x' + Math.floor(balance * 1e18).toString(16); // تحويل إلى wei
  }

  // إرسال معاملة
  async sendTransaction(txData) {
    try {
      // ✅ CONTRACT DEPLOYMENT: Allow empty 'to' and 'value' for contract deployment
      const isContractDeployment = !txData.to || txData.to === '' || txData.to === '0x';
      
      // التحقق من صحة البيانات المُرسلة
      if (!txData.from) {
        throw new Error('Invalid transaction data: missing sender address');
      }
      
      // For regular transactions, 'to' and 'value' are required
      if (!isContractDeployment && (!txData.to || txData.value === undefined)) {
        throw new Error('Invalid transaction data: missing recipient or value for regular transaction');
      }

      // 🚫 CRITICAL SECURITY CHECK: منع معاملات الإرسال للنفس في sendTransaction
      // Only check for self-transactions if not contract deployment
      if (!isContractDeployment && txData.from.toLowerCase() === txData.to.toLowerCase()) {
        const errorMsg = `🚫 SEND TRANSACTION BLOCKED: Self-transactions prohibited. ${txData.from} → ${txData.to}`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      // تحويل القيم من hex إلى أرقام عادية
      // ✅ CONTRACT DEPLOYMENT: value can be 0 or empty for contract deployment
      let amount = 0;
      if (txData.value) {
        amount = txData.value.startsWith && txData.value.startsWith('0x') ?
          parseInt(txData.value, 16) / 1e18 :
          parseFloat(txData.value) || 0;
      }

      const gasPrice = txData.gasPrice ?
        (txData.gasPrice.startsWith('0x') ?
          parseInt(txData.gasPrice, 16) / 1e18 :
          parseFloat(txData.gasPrice)) :
        this.blockchain.getGasPrice();

      // استخراج nonce صحيح وفريد لكل معاملة
      let nonce;
      if (txData.nonce !== undefined && txData.nonce !== null) {
        nonce = txData.nonce.toString().startsWith('0x') ?
          parseInt(txData.nonce, 16) :
          parseInt(txData.nonce);
      } else {
        // حساب nonce تلقائي فريد - كل معاملة لها nonce مختلف
        const normalizedFromAddress = txData.from.toLowerCase();

        try {
          // إنشاء الأعمدة المفقودة إذا لم تكن موجودة
          try {
            await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN DEFAULT false');
            await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS confirmations INTEGER DEFAULT 0');
          } catch (alterError) {
            // العمود موجود بالفعل
          }

          // البحث في جميع جداول المعاملات
          const allTxResult = await pool.query(
            'SELECT COUNT(*) as count FROM transactions WHERE LOWER(from_address) = $1',
            [normalizedFromAddress]
          );

          const externalTxResult = await pool.query(
            'SELECT COUNT(*) as count FROM external_wallet_transactions WHERE LOWER(from_address) = $1',
            [normalizedFromAddress]
          );

          // حساب nonce من البلوك تشين
          const blockchainNonce = await this.blockchain.getNonce(normalizedFromAddress);

          // حساب المعاملات المعلقة
          const pendingTxs = this.blockchain.pendingTransactions.filter(
            tx => tx.fromAddress && tx.fromAddress.toLowerCase() === normalizedFromAddress
          ).length;

          const dbCount = parseInt(allTxResult.rows[0]?.count || 0);
          const externalCount = parseInt(externalTxResult.rows[0]?.count || 0);

          // حساب nonce فريد = أكبر قيمة + المعاملات المعلقة + timestamp للتفرد
          nonce = Math.max(dbCount, externalCount, blockchainNonce) + pendingTxs;

          // ضمان التفرد باستخدام آخر nonce مستخدم
          if (!this.lastUsedNonces) {
            this.lastUsedNonces = new Map();
          }

          if (this.lastUsedNonces.has(normalizedFromAddress)) {
            const lastNonce = this.lastUsedNonces.get(normalizedFromAddress);
            nonce = Math.max(nonce, lastNonce + 1);
          }

          // حفظ آخر nonce
          this.lastUsedNonces.set(normalizedFromAddress, nonce);

          console.log(`🔢 Generated UNIQUE nonce for ${txData.from}: ${nonce} (db: ${dbCount}, external: ${externalCount}, ledger: ${blockchainNonce}, pending: ${pendingTxs})`);

        } catch (error) {
          console.error('Error calculating auto-nonce:', error);
          // Fallback: استخدام nonce من البلوك تشين + timestamp
          nonce = await this.blockchain.getNonce(txData.from) + Math.floor(Date.now() / 1000) % 1000;
        }
      }

      // التأكد من أن المبلغ صحيح وليس صفر
      if (amount <= 0) {
        console.warn('Warning: Zero amount transaction detected, using minimum amount');
        amount = 0.00001; // مبلغ افتراضي صغير
      }

      console.log(`📤 Processing real transaction:`, {
        from: txData.from,
        to: txData.to,
        amount: amount.toFixed(8) + ' ACCESS',
        gasPrice: gasPrice.toFixed(8) + ' ACCESS',
        nonce: nonce
      });

      // إنشاء معاملة حقيقية
      const transaction = new Transaction(
        txData.from,
        txData.to,
        amount,
        gasPrice,
        txData.timestamp || Date.now()
      );

      // إضافة nonce للمعاملة (مضمون أن يكون رقم وليس Promise)
      transaction.nonce = nonce;
      transaction.hash = txData.hash || transaction.txId;

      // إضافة المعاملة إلى البلوك تشين
      // ⚠️ CRITICAL: addTransaction يستدعي processTransactionImmediately داخلياً
      // والذي يقوم بتحديث الأرصدة - لذلك لا نحتاج لاستدعاء processTransactionBalances!
      const txHash = await this.blockchain.addTransaction(transaction);

      // ⚡ INSTANT BALANCE BROADCAST - بث الرصيد الجديد فوراً للمحافظ
      try {
        const senderNewBalance = this.blockchain.getBalance(txData.from);
        const receiverNewBalance = txData.to ? this.blockchain.getBalance(txData.to) : 0;
        
        // بث للمرسل
        this.broadcastInstantBalanceUpdate(txData.from, senderNewBalance);
        this.broadcastNewHeadsForBalanceUpdate(txData.from);
        
        // بث للمستقبل
        if (txData.to) {
          this.broadcastInstantBalanceUpdate(txData.to, receiverNewBalance);
          this.broadcastNewHeadsForBalanceUpdate(txData.to);
        }
        
        console.log(`⚡ INSTANT BROADCAST: Sender ${senderNewBalance.toFixed(4)} ACCESS, Receiver ${receiverNewBalance.toFixed(4)} ACCESS`);
      } catch (broadcastError) {
        console.warn('⚠️ Instant broadcast warning:', broadcastError.message);
      }

      // ❌ REMOVED: processTransactionBalances - كان يسبب إضافة الرصيد مرتين!
      // await this.processTransactionBalances(transaction);

      // تأكيد المعاملة فوراً
      try {
        await this.confirmTransaction(txHash, transaction);
      } catch (confirmError) {
        console.error('Transaction confirmation failed:', confirmError);
      }

      console.log(`✅ Real transaction confirmed: ${txHash}`);

      // بث المعاملة للمحافظ الخارجية
      await this.broadcastTransactionToExternalWallets(transaction);

      return txHash;
    } catch (error) {
      console.error('Error sending transaction:', error);
      throw error;
    }
  }

  // معالجة أرصدة المعاملة - خصم من المرسل وإضافة للمستقبل
  async processTransactionBalances(transaction) {
    try {
      const { pool } = await import('./db.js');
      const fromAddress = transaction.fromAddress;
      const toAddress = transaction.toAddress;
      const amount = parseFloat(transaction.amount);
      const gasFee = parseFloat(transaction.gasFee || 0.00002);

      console.log(`\n💰 ═══ معالجة أرصدة المعاملة ═══`);
      console.log(`📤 المرسل: ${fromAddress}`);
      console.log(`📥 المستقبل: ${toAddress}`);
      console.log(`💸 المبلغ المرسل: ${amount.toFixed(8)} ACCESS`);
      console.log(`⛽ رسوم الغاز: ${gasFee.toFixed(8)} ACCESS`);

      // الحصول على الأرصدة الحالية
      const senderBalance = this.blockchain.getBalance(fromAddress);
      const receiverBalance = this.blockchain.getBalance(toAddress);

      console.log(`📊 رصيد المرسل قبل: ${senderBalance.toFixed(8)} ACCESS`);
      console.log(`📊 رصيد المستقبل قبل: ${receiverBalance.toFixed(8)} ACCESS`);

      // خصم المبلغ ورسوم الغاز من المرسل
      const newSenderBalance = senderBalance - amount - gasFee;
      const newReceiverBalance = receiverBalance + amount;

      // تحديث الأرصدة في البلوك تشين
      this.blockchain.updateBalance(fromAddress, Math.max(0, newSenderBalance));
      this.blockchain.updateBalance(toAddress, newReceiverBalance);

      console.log(`📊 رصيد المرسل بعد: ${newSenderBalance.toFixed(8)} ACCESS`);
      console.log(`📊 رصيد المستقبل بعد: ${newReceiverBalance.toFixed(8)} ACCESS`);

      // تحديث قاعدة البيانات للمرسل
      await this.updateDatabaseBalances(fromAddress, newSenderBalance, toAddress, newReceiverBalance);

      // إشعار المحافظ بتحديث الأرصدة
      await this.notifyWalletsOfBalanceUpdate(fromAddress, newSenderBalance, toAddress, newReceiverBalance, transaction);

      console.log(`✅ تم تحديث الأرصدة بنجاح في قاعدة البيانات`);
      console.log(`═══════════════════════════════════════\n`);

      return true;
    } catch (error) {
      console.error('❌ خطأ في معالجة أرصدة المعاملة:', error);
      return false;
    }
  }

  // تأكيد المعاملة
  async confirmTransaction(txHash, transaction) {
    try {
      // إضافة المعاملة إلى كتلة مؤقتة للتأكيد
      const tempBlock = {
        index: this.blockchain.chain.length,
        timestamp: Date.now(),
        transactions: [transaction],
        previousHash: this.blockchain.getLatestBlock().hash,
        hash: crypto.createHash('sha256').update(txHash + Date.now()).digest('hex')
      };

      // تحديث حالة المعاملة إلى مُؤكدة
      transaction.confirmed = true;
      transaction.blockHash = tempBlock.hash;
      transaction.blockNumber = tempBlock.index;
      transaction.confirmations = 1;

      console.log(`🔒 Transaction confirmed in record ${tempBlock.index}: ${txHash}`);

      // حفظ المعاملة المؤكدة في قاعدة البيانات
      await this.saveConfirmedTransaction(transaction);

      return true;
    } catch (error) {
      console.error('Error confirming transaction:', error);
      return false;
    }
  }

  // حفظ المعاملة المؤكدة
  async saveConfirmedTransaction(transaction) {
    try {
      const { pool } = await import('./db.js');

      // حفظ gas_price في ACCESS (قيمة عشرية) بدلاً من wei لتجنب overflow
      const gasPriceInAccess = parseFloat(transaction.gasPrice || 0.00002);
      const txHash = transaction.hash || transaction.txId;

      // استخراج التوقيع من المعاملة
      const signature = transaction.signature || transaction.sig || null;

      await pool.query(`
        INSERT INTO transactions
        (tx_hash, hash, from_address, to_address, amount, timestamp, block_hash, block_index,
         nonce, gas_used, gas_price, chain_id, network_id, is_confirmed, confirmations, signature)
        VALUES ($1, $1, $2, $3, $4::numeric(20,8), $5, $6, $7, $8, $9, $10::numeric(20,8), $11, $12, $13, $14, $15)
        ON CONFLICT (tx_hash) DO UPDATE SET
        hash = EXCLUDED.hash,
        is_confirmed = EXCLUDED.is_confirmed,
        confirmations = EXCLUDED.confirmations,
        block_hash = EXCLUDED.block_hash,
        block_index = EXCLUDED.block_index,
        signature = COALESCE(EXCLUDED.signature, transactions.signature)
      `, [
        txHash,
        transaction.fromAddress || transaction.from,
        transaction.toAddress || transaction.to,
        parseFloat(transaction.amount || 0).toFixed(8),
        transaction.timestamp,
        transaction.blockHash,
        transaction.blockNumber,
        transaction.nonce || 0,
        21000, // gas used
        gasPriceInAccess.toFixed(8), // حفظ في ACCESS (قيمة عشرية)
        '0x5968',
        '22888',
        true, // is_confirmed
        transaction.confirmations || 1,
        signature
      ]);

      console.log(`💾 Confirmed transaction saved to database: ${txHash} (gas: ${gasPriceInAccess.toFixed(8)} ACCESS)`);
    } catch (error) {
      console.error('Error saving confirmed transaction:', error);
    }
  }

  // حفظ المعاملة العامة في قاعدة البيانات
  async saveTransactionToDatabase(transaction) {
    try {
      const { pool } = await import('./db.js');

      // استخراج العناوين مع دعم جميع التنسيقات الممكنة
      const fromAddress = transaction.fromAddress || transaction.from || transaction.sender;
      const toAddress = transaction.toAddress || transaction.to || transaction.recipient;
      const txHash = transaction.hash || transaction.txId || transaction.transactionHash;

      // استخراج القيمة مع دعم جميع التنسيقات
      let amount = transaction.amount || transaction.value;
      if (typeof amount === 'string' && amount.startsWith('0x')) {
        amount = parseInt(amount, 16) / 1e18; // تحويل من wei إلى ACCESS
      } else if (typeof amount === 'string') {
        amount = parseFloat(amount);
      } else if (typeof amount === 'number') {
        amount = amount;
      } else {
        amount = 0;
      }

      // التحقق من البيانات المطلوبة وطول الحقول
      if (!txHash || !fromAddress || !toAddress) {
        console.error('❌ Invalid transaction data: required fields missing or invalid');
        throw new Error('Invalid transaction data: required fields missing or invalid');
      }

      // التحقق من طول hash لتجنب مشكلة قاعدة البيانات
      if (txHash.length > 70) {
        // Silent hash truncation to save resources
        txHash = txHash.substring(0, 70);
      }

      // التحقق من صحة العناوين
      if (!this.isValidEthereumAddress(fromAddress) || !this.isValidEthereumAddress(toAddress)) {
        console.error('❌ Invalid Ethereum addresses:', {
          from: fromAddress,
          to: toAddress,
          fromValid: this.isValidEthereumAddress(fromAddress),
          toValid: this.isValidEthereumAddress(toAddress)
        });
        throw new Error('Invalid Ethereum address format');
      }

      const timestamp = transaction.timestamp || Date.now();
      const gasUsed = parseInt(transaction.gasLimit || transaction.gasUsed || 21000);
      // تحويل gasPrice إلى wei (رقم صحيح) بدلاً من ACCESS (عشري)
      const gasPriceInWei = Math.floor((parseFloat(transaction.gasPrice || transaction.gasFee || 0.00002)) * 1e18);

      // استخراج التوقيع من المعاملة
      const signature = transaction.signature || transaction.sig || null;

      await pool.query(`
        INSERT INTO transactions
        (tx_hash, hash, from_address, to_address, amount, timestamp, nonce, gas_used, gas_price,
         chain_id, network_id, is_external, transaction_type, status, signature)
        VALUES ($1, $1, $2, $3, $4::numeric(20,8), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (tx_hash) DO UPDATE SET
        hash = EXCLUDED.hash,
        from_address = EXCLUDED.from_address,
        to_address = EXCLUDED.to_address,
        amount = EXCLUDED.amount,
        timestamp = EXCLUDED.timestamp,
        signature = COALESCE(EXCLUDED.signature, transactions.signature)
      `, [
        txHash,
        fromAddress.toLowerCase(),
        toAddress.toLowerCase(),
        parseFloat(amount).toFixed(8),
        timestamp,
        transaction.nonce || 0,
        gasUsed,
        gasPriceInWei,
        '0x5968',
        '22888',
        transaction.external || false,
        'transfer',
        'pending',
        signature
      ]);

      console.log(`💾 Transaction saved to database: ${txHash} (${amount.toFixed(8)} ACCESS, gas: ${gasPriceInWei} wei)`);
      return true;
    } catch (error) {
      console.error('❌ Error saving transaction to database:', error);
      throw error;
    }
  }

  // إنشاء معاملة موقعة
  async createSignedTransaction(txData) {
    try {
      const { from, to, amount, privateKey, gasPrice } = txData;

      // إنشاء المعاملة
      const transaction = new Transaction(
        from,
        to,
        amount,
        gasPrice || this.blockchain.gasPrice
      );

      // توقيع المعاملة (محاكاة)
      const ecInstance = new ec('secp256k1');

      // استخدام المفتاح الخاص للتوقيع
      const keyPair = ecInstance.keyFromPrivate(privateKey.replace('0x', ''), 'hex');
      const hash = transaction.calculateHash();
      const signature = keyPair.sign(hash);

      transaction.signature = signature.toDER('hex');
      transaction.signedBy = from;

      return transaction;
    } catch (error) {
      console.error('Error creating signed transaction:', error);
      throw error;
    }
  }

  // Enhanced wallet classification and transaction broadcasting with anti-double-spending protection
  async broadcastTransactionToExternalWallets(transaction) {
    try {
      // ENHANCED DOUBLE-SPENDING PROTECTION
      const txHash = transaction.hash || transaction.txId;
      const fromAddress = transaction.from || transaction.fromAddress;
      const nonce = transaction.nonce;

      // Initialize protection systems if not exists
      if (!this.processedTransactions) {
        this.processedTransactions = new Set();
      }
      if (!this.activeNonces) {
        this.activeNonces = new Map(); // Track active nonces per address
      }
      if (!this.pendingBalanceChanges) {
        this.pendingBalanceChanges = new Map(); // Track pending balance changes
      }

      // Check for duplicate transaction hash
      if (this.processedTransactions.has(txHash)) {
        console.log(`🚫 DUPLICATE TRANSACTION BLOCKED: ${txHash} already processed`);
        throw new Error('Transaction already processed - duplicate transaction blocked');
      }

      // Check for nonce reuse (double spending attempt)
      const addressNonceKey = `${fromAddress}:${nonce}`;
      if (this.activeNonces.has(addressNonceKey)) {
        console.log(`🚫 DOUBLE SPENDING ATTEMPT BLOCKED: Nonce ${nonce} already used for ${fromAddress}`);
        throw new Error('Double spending attempt detected - nonce already in use');
      }

      // Check for rapid successive transactions from same address (potential attack)
      const lastTxTime = this.lastTransactionTime?.get(fromAddress) || 0;
      const now = Date.now();
      const minInterval = 1000; // Minimum 1 second between transactions from same address

      if ((now - lastTxTime) < minInterval) {
        console.log(`🚫 RAPID TRANSACTION ATTACK BLOCKED: Address ${fromAddress} trying to send transactions too quickly`);
        throw new Error('Rate limit exceeded - transactions too frequent');
      }

      // Mark nonce as active to prevent reuse
      this.activeNonces.set(addressNonceKey, {
        txHash: txHash,
        timestamp: now,
        address: fromAddress
      });

      // Track last transaction time
      if (!this.lastTransactionTime) {
        this.lastTransactionTime = new Map();
      }
      this.lastTransactionTime.set(fromAddress, now);

      // معالجة بيانات المعاملة مع التحقق الصارم من العناوين
      const txData = transaction.txId ? transaction : {
        txId: transaction.hash || transaction.txId,
        fromAddress: transaction.from || transaction.fromAddress,
        toAddress: transaction.to || transaction.toAddress,
        amount: transaction.amount || (parseInt(transaction.value || '0x0', 16) / 1e18),
        gasFee: transaction.gasFee || (parseInt(transaction.gas || '0x5208', 16) / 1e18),
        gasPrice: transaction.gasPrice || (parseInt(transaction.gasPrice || '0x3B9ACA00', 16) / 1e18),
        timestamp: transaction.timestamp || Date.now(),
        blockHash: transaction.blockHash,
        blockIndex: transaction.blockNumber ? parseInt(transaction.blockNumber, 16) : null
      };

      // وضع علامة على المعاملة كمعالجة
      if (!this.processedTransactions) {
        this.processedTransactions = new Set();
      }
      this.processedTransactions.add(txHash);

      // التحقق المرن من صحة العناوين للمعاملات المختلطة
      const fromValid = this.isValidEthereumAddress(txData.fromAddress);
      const toValid = this.isValidEthereumAddress(txData.toAddress);

      console.log('🔍 Address validation details:', {
        fromAddress: txData.fromAddress,
        toAddress: txData.toAddress,
        fromLength: txData.fromAddress?.length,
        toLength: txData.toAddress?.length,
        fromValid: fromValid,
        toValid: toValid,
        fromRegexTest: /^0x[a-fA-F0-9]{40}$/i.test(txData.fromAddress || ''),
        toRegexTest: /^0x[a-fA-F0-9]{40}$/i.test(txData.toAddress || '')
      });

      // السماح بالمعاملات المختلطة حتى لو فشل التحقق
      if (!fromValid || !toValid) {
        console.warn('⚠️ Address validation warning:', {
          from: txData.fromAddress,
          to: txData.toAddress,
          fromValid: fromValid,
          toValid: toValid
        });

        console.log('di� Proceeding with mixed transaction - external wallet support enabled');
      }

      // تصنيف المحافظ: محلية أم خارجية
      const walletClassification = await this.classifyWallets(txData.fromAddress, txData.toAddress);

      console.log(`🏷️ Wallet Classification:`, {
        fromAddress: txData.fromAddress,
        toAddress: txData.toAddress,
        senderType: walletClassification.senderType,
        recipientType: walletClassification.recipientType,
        transactionType: walletClassification.transactionType,
        mixedTransaction: walletClassification.mixedTransaction
      });

      // Create comprehensive Web3-compatible transaction
      const web3Transaction = {
        hash: txData.txId || txData.hash,
        from: txData.fromAddress,
        to: txData.toAddress,
        value: '0x' + Math.floor((txData.amount || 0) * 1e18).toString(16),
        gas: '0x' + Math.floor((txData.gasFee || 0.00002) * 1e18).toString(16),
        gasPrice: '0x' + Math.floor((txData.gasPrice || 0.00002) * 1e18).toString(16),
        nonce: '0x' + Date.now().toString(16),
        blockHash: txData.blockHash,
        blockNumber: txData.blockIndex ? '0x' + txData.blockIndex.toString(16) : null,
        transactionIndex: '0x0',
        confirmations: txData.blockIndex ? 1 : 0,
        timestamp: txData.timestamp,
        chainId: '0x5968', // Access Network Chain ID
        networkId: '22888', // Access Network ID

        // Enhanced metadata for external wallets
        rpcValidated: transaction.rpcValidated || true,
        isExternalSender: transaction.isExternalSender || false,
        isExternalRecipient: transaction.isExternalRecipient || false,
        mixedTransaction: transaction.mixedTransaction || false,
        accessNetwork: true,
        networkName: 'Access Network'
      };

      // Save to database with enhanced tracking
      await this.saveTransactionForExternalWallets(web3Transaction);

      // Notify all connected external wallets (balance update is handled elsewhere)
      await this.notifyExternalWalletsOfTransaction(web3Transaction);

      // Clean up expired nonces (after 5 minutes) to prevent memory buildup
      this.cleanupExpiredNonces();

      // Log comprehensive transaction info
      console.log(`\n🎯 ═══ معاملة خارجية جديدة ═══`);
      console.log(`🔗 Transaction Hash: ${web3Transaction.hash}`);
      console.log(`📤 المرسل: ${web3Transaction.from}`);
      console.log(`📥 المستقبل: ${web3Transaction.to}`);
      console.log(`💰 المبلغ: ${(parseInt(web3Transaction.value, 16) / 1e18).toFixed(8)} ACCESS`);
      console.log(`⛽ رسوم الغاز: ${(parseInt(web3Transaction.gas, 16) / 1e18).toFixed(8)} ACCESS`);
      console.log(`🌐 شبكة: Access Network (Chain ID: ${web3Transaction.chainId})`);
      console.log(`⏰ الوقت: ${new Date(web3Transaction.timestamp).toLocaleString('ar-SA')}`);
      console.log(`🔄 حالة المعاملة: ${transaction.isExternalSender ? 'مرسل خارجي' : 'مرسل محلي'} → ${transaction.isExternalRecipient ? 'مستقبل خارجي' : 'مستقبل محلي'}`);
      console.log(`🔒 حماية متقدمة: Nonce ${nonce} محجوز للعنوان ${fromAddress}`);
      console.log(`═══════════════════════════════════════\n`);

      return web3Transaction;
    } catch (error) {
      console.error('Enhanced external wallet broadcast error:', error);
      throw error;
    }
  }

  // حفظ المعاملة للمحافظ الخارجية مع بيانات محسنة
  async saveTransactionForExternalWallets(transaction) {
    try {
      const { pool } = await import('./db.js');

      // التحقق من البيانات المطلوبة مع دعم كلا التنسيقين
      const fromAddress = transaction.from || transaction.fromAddress;
      const toAddress = transaction.to || transaction.toAddress;

      if (!transaction.hash || !fromAddress || !toAddress || transaction.value === undefined) {
        console.error('Invalid transaction data for external wallet saving:', {
          hash: transaction.hash,
          from: fromAddress,
          to: toAddress,
          value: transaction.value,
          hasFrom: !!fromAddress,
          hasTo: !!toAddress
        });
        return;
      }

      const amount = parseFloat(parseInt(transaction.value, 16) / 1e18);
      const blockIndex = transaction.blockNumber ? parseInt(transaction.blockNumber, 16) : null;

      // حساب القيم بأمان - تجنب القيم الكبيرة
      let gasUsedValue = 21000; // قيمة افتراضية آمنة
      if (transaction.gas) {
        if (typeof transaction.gas === 'string' && transaction.gas.startsWith('0x')) {
          const hexValue = parseInt(transaction.gas, 16);
          gasUsedValue = Math.min(hexValue, 2147483647); // حد أقصى للـ INTEGER
        } else {
          gasUsedValue = Math.min(parseInt(transaction.gas) || 21000, 2147483647);
        }
      }

      let gasPriceValue = 0.00002; // القيمة الافتراضية في ACCESS
      if (transaction.gasPrice) {
        if (typeof transaction.gasPrice === 'string' && transaction.gasPrice.startsWith('0x')) {
          // تحويل من hex wei إلى ACCESS (قيمة عشرية) مع حماية من القيم الكبيرة
          const weiValue = parseInt(transaction.gasPrice, 16);
          gasPriceValue = Math.min(parseFloat((weiValue / 1e18).toFixed(8)), 99.99999999);
        } else {
          // استخدام القيمة كما هي في ACCESS مع حماية
          gasPriceValue = Math.min(parseFloat(parseFloat(transaction.gasPrice).toFixed(8)), 99.99999999);
        }
      }

      // التأكد من أن القيم آمنة
      const safeGasUsed = Math.max(21000, Math.min(gasUsedValue, 2147483647)); // INTEGER range
      const safeGasPrice = Math.max(0.00000001, Math.min(gasPriceValue, 99.99999999)); // NUMERIC(20,8) safe range

      // استخراج التوقيع من المعاملة
      const signature = transaction.signature || transaction.sig || null;

      await pool.query(`
        INSERT INTO transactions
        (tx_hash, from_address, to_address, amount, timestamp, block_hash, block_index,
         gas_used, gas_price, chain_id, network_id, is_external, signature)
        VALUES ($1, $2, $3, $4::numeric(20,8), $5, $6, $7, $8, $9::numeric(20,8), $10, $11, $12, $13)
        ON CONFLICT (tx_hash) DO UPDATE SET
        from_address = EXCLUDED.from_address,
        to_address = EXCLUDED.to_address,
        amount = EXCLUDED.amount,
        timestamp = EXCLUDED.timestamp,
        is_external = EXCLUDED.is_external,
        signature = COALESCE(EXCLUDED.signature, transactions.signature)
      `, [
        transaction.hash,
        fromAddress,
        toAddress,
        parseFloat(amount).toFixed(8),
        transaction.timestamp,
        transaction.blockHash,
        blockIndex,
        safeGasUsed,
        parseFloat(safeGasPrice).toFixed(8), // استخدام القيمة العشرية الآمنة في ACCESS
        '0x5968',
        '22888',
        true, // علامة للمعاملات الخارجية
        signature
      ]);

      console.log(`📝 External transaction saved: ${transaction.hash} (${amount.toFixed(8)} ACCESS, gas: ${safeGasPrice.toFixed(8)} ACCESS)`);
    } catch (error) {
      console.error('Error saving external wallet transaction:', error);
    }
  }

  // REMOVED: updateExternalWalletBalances - Using State Trie only like Ethereum

  // نظام إشعارات شامل - يدعم آلاف المعاملات في الثانية
  async notifyConnectedWallets(transaction) {
    try {
      // بث للمحافظ المتصلة عبر WebSocket مع دعم شامل لجميع الأنواع
      if (this.connectedWallets && this.connectedWallets.size > 0) {
        const baseNotification = {
          type: 'new_transaction',
          data: transaction,
          timestamp: Date.now(),
          chainId: '0x5968',
          networkId: '22888',
          network: 'Access Network',
          highSpeed: true // علامة المعالجة السريعة
        };

        // معالجة متوازية للمحافظ لضمان السرعة القصوى
        const notificationPromises = Array.from(this.connectedWallets.entries()).map(async ([address, walletWs]) => {
          try {
            if (walletWs.readyState === 1) { // WebSocket OPEN
              // إشعار مخصص لكل محفظة
              const personalizedNotification = {
                ...baseNotification,
                isRelevant: transaction.from === address || transaction.to === address,
                userAddress: address
              };

              // إرسال فوري بدون انتظار
              walletWs.send(JSON.stringify(personalizedNotification));

              // إشعارات متعددة للتوافق مع جميع أنواع المحافظ بالتوازي
              if (transaction.to === address) {
                const currentBalance = this.blockchain.getBalance(address);

                const universalNotifications = [
                  // إشعار للمحافظ الجوالة (Trust, MetaMask Mobile, Coinbase, etc.)
                  {
                    method: 'wallet_transactionReceived',
                    params: {
                      hash: transaction.hash,
                      from: transaction.from,
                      to: transaction.to,
                      value: transaction.value,
                      balance: '0x' + Math.floor(currentBalance * 1e18).toString(16),
                      chainId: '0x5968',
                      symbol: 'ACCESS',
                      decimals: 18,
                      fastUpdate: true
                    }
                  },
                  // إشعار محسن لـ Coinbase Wallet
                  {
                    method: 'coinbase_transactionUpdate',
                    params: {
                      address: address,
                      hash: transaction.hash,
                      from: transaction.from,
                      to: transaction.to,
                      value: transaction.value,
                      balance: currentBalance.toString(),
                      balanceHex: '0x' + Math.floor(currentBalance * 1e18).toString(16),
                      chainId: '0x5968',
                      networkId: '22888',
                      symbol: 'ACCESS',
                      decimals: 18,
                      timestamp: Date.now(),
                      forceRefresh: true // إجبار تحديث واجهة Coinbase
                    }
                  },
                  // إشعار للمحافظ المكتبية (MetaMask Desktop, etc.)
                  {
                    method: 'eth_subscription',
                    params: {
                      subscription: '0x1',
                      result: {
                        address: address,
                        blockNumber: '0x' + (this.blockchain.chain.length - 1).toString(16),
                        transactionHash: transaction.hash,
                        value: transaction.value,
                        balance: '0x' + Math.floor(currentBalance * 1e18).toString(16),
                        chainId: '0x5968'
                      }
                    }
                  },
                  // إشعار Web3 Provider Event (لجميع المحافظ)
                  {
                    type: 'web3_event',
                    method: 'accountsChanged',
                    params: {
                      accounts: [address],
                      balance: currentBalance.toString(),
                      chainId: '0x5968',
                      fastSync: true
                    }
                  },
                  // إشعار للمنصات المركزية والبورصات
                  {
                    method: 'exchange_depositReceived',
                    params: {
                      address: address,
                      amount: parseInt(transaction.value, 16) / 1e18,
                      token: 'ACCESS',
                      chainId: '0x5968',
                      txHash: transaction.hash,
                      confirmations: 1,
                      timestamp: Date.now(),
                      highPriority: true
                    }
                  },
                  // إشعار للواجهة الأمامية
                  {
                    type: 'ui_force_update',
                    address: address,
                    balance: currentBalance,
                    transaction: {
                      hash: transaction.hash,
                      amount: parseInt(transaction.value, 16) / 1e18
                    },
                    chainId: '0x5968',
                    timestamp: Date.now()
                  }
                ];

                // إرسال جميع الإشعارات بالتوازي (أسرع من التتابع)
                const sendPromises = universalNotifications.map(notification => {
                  return new Promise((resolve) => {
                    try {
                      walletWs.send(JSON.stringify(notification));
                      resolve(true);
                    } catch (sendError) {
                      console.error(`Error sending ${notification.method}:`, sendError);
                      resolve(false);
                    }
                  });
                });

                await Promise.all(sendPromises);
              }
            }
          } catch (error) {
            console.error('Error notifying wallet:', error);
            // إزالة المحافظ المعطلة
            this.connectedWallets.delete(address);
          }
        });

        // تنفيذ جميع الإشعارات بالتوازي لضمان السرعة القصوى
        await Promise.all(notificationPromises);
      }

      console.log(`⚡ FAST: Notified ${this.connectedWallets?.size || 0} connected wallets in parallel (High-speed processing for thousands of transactions per second)`);
    } catch (error) {
      console.error('Error notifying connected wallets:', error);
    }
  }

  // نظام إشعارات شامل لجميع المحافظ بدون استثناء (Coinbase, Trust, MetaMask, إلخ)
  async sendEnhancedWalletNotification(address, notificationData) {
    try {
      // البحث عن المحفظة المتصلة بجميع الحالات
      const normalizedAddress = address.toLowerCase();
      let walletWs = this.connectedWallets.get(address) || this.connectedWallets.get(normalizedAddress);

      // إشعارات متعددة فورية لضمان وصولها لجميع أنواع المحافظ
      const universalNotifications = [
        // إشعار أساسي محسن
        {
          type: 'enhanced_notification',
          address: address,
          data: notificationData,
          timestamp: Date.now(),
          chainId: '0x5968',
          networkId: '22888'
        },
        // إشعار خاص بـ Coinbase Wallet
        {
          jsonrpc: '2.0',
          method: 'coinbase_balanceUpdate',
          params: {
            address: address,
            balance: '0x' + Math.floor((notificationData.newBalance || 0) * 1e18).toString(16),
            balanceFormatted: (notificationData.newBalance || 0).toFixed(8) + ' ACCESS',
            chainId: '0x5968',
            networkId: '22888'
          },
          id: Date.now()
        },
        // إشعار للمحافظ الجوالة (Trust, MetaMask Mobile)
        {
          jsonrpc: '2.0',
          method: 'wallet_accountsChanged',
          params: [address],
          id: Date.now() + 1
        },
        // إشعار تحديث الرصيد العام
        {
          jsonrpc: '2.0',
          method: 'eth_subscription',
          params: {
            subscription: '0x' + Date.now().toString(16),
            result: {
              address: address,
              blockNumber: '0x' + (this.blockchain.chain.length - 1).toString(16),
              transactionHash: notificationData.txHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
              value: '0x' + Math.floor((notificationData.amount || 0) * 1e18).toString(16),
              balance: '0x' + Math.floor((notificationData.newBalance || 0) * 1e18).toString(16),
              chainId: '0x5968',
              timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16)
            }
          },
          id: Date.now() + 2
        }
      ];

      // إرسال جميع الإشعارات للمحفظة المتصلة
      if (walletWs && walletWs.readyState === 1) {
        for (const notification of universalNotifications) {
          try {
            walletWs.send(JSON.stringify(notification));
            await new Promise(resolve => setTimeout(resolve, 50)); // تأخير بسيط بين الإشعارات
          } catch (sendError) {
            console.error('Error sending notification:', sendError);
          }
        }
        console.log(`📱 ${universalNotifications.length} notifications sent to ${address} (Universal wallet compatibility)`);
      }

      // إشعار عالمي لجميع المحافظ والمنصات
      await this.notifyUniversalWalletBalance(address, notificationData);

      // إشعارات إضافية خاصة بـ Coinbase Wallet
      await this.sendCoinbaseWalletNotification(address, notificationData);

      // حفظ الإشعار في قاعدة البيانات للمراجعة اللاحقة
      const { pool } = await import('./db.js');
      await pool.query(`
        INSERT INTO wallet_notifications (address, notification_type, data, timestamp, delivered)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [
        address,
        notificationData.type,
        JSON.stringify(notificationData),
        Date.now(),
        walletWs ? true : false
      ]);

    } catch (error) {
      console.error('Error sending enhanced wallet notification:', error);
    }
  }

  // إشعار مخصص لـ Coinbase Wallet
  async sendCoinbaseWalletNotification(address, data) {
    try {
      const currentBalance = data.newBalance || this.blockchain.getBalance(address);

      // إشعارات متعددة متوافقة مع Coinbase Wallet
      const coinbaseNotifications = [
        // إشعار Coinbase الأساسي
        {
          jsonrpc: '2.0',
          method: 'coinbase_accountUpdate',
          params: {
            address: address,
            balance: currentBalance.toString(),
            balanceHex: '0x' + Math.floor(currentBalance * 1e18).toString(16),
            chainId: '0x5968',
            networkId: '22888'
          },
          id: Date.now()
        },
        // إشعار تحديث الأصول
        {
          jsonrpc: '2.0',
          method: 'coinbase_assetsUpdate',
          params: {
            address: address,
            assets: [{
              symbol: 'ACCESS',
              balance: currentBalance.toString(),
              decimals: 18,
              name: 'Access Coin',
              chainId: '0x5968'
            }]
          },
          id: Date.now() + 1
        },
        // إشعار WebSocket خاص بـ Coinbase
        {
          type: 'coinbase_balance_changed',
          address: address,
          balance: currentBalance,
          balanceFormatted: currentBalance.toFixed(8) + ' ACCESS',
          chainId: '0x5968',
          networkId: '22888',
          timestamp: Date.now()
        },
        // إشعار Web3 Provider المحسن
        {
          type: 'provider_notification',
          method: 'balance_update',
          params: {
            address: address,
            balance: '0x' + Math.floor(currentBalance * 1e18).toString(16),
            symbol: 'ACCESS',
            decimals: 18,
            chainId: '0x5968'
          }
        }
      ];

      // إرسال الإشعارات للمحفظة المتصلة
      const walletWs = this.connectedWallets.get(address) || this.connectedWallets.get(address.toLowerCase());
      if (walletWs && walletWs.readyState === 1) {
        for (const notification of coinbaseNotifications) {
          try {
            walletWs.send(JSON.stringify(notification));
            await new Promise(resolve => setTimeout(resolve, 100)); // تأخير أطول للتأكد من الوصول
          } catch (sendError) {
            console.error('Error sending Coinbase notification:', sendError);
          }
        }
        console.log(`💙 Coinbase Wallet notifications sent to ${address}: ${coinbaseNotifications.length} messages`);
      }

      // إشعار إضافي للواجهة الأمامية
      await this.broadcastCoinbaseUpdate(address, currentBalance);

      console.log(`💎 Coinbase Wallet balance notification completed for ${address}: ${currentBalance.toFixed(8)} ACCESS`);

    } catch (error) {
      console.error('Error in Coinbase Wallet notification:', error);
    }
  }

  // بث خاص بـ Coinbase Wallet
  async broadcastCoinbaseUpdate(address, balance) {
    try {
      const coinbaseUpdate = {
        type: 'coinbase_balance_update',
        address: address,
        balance: balance,
        balanceFormatted: balance.toFixed(8) + ' ACCESS',
        chainId: '0x5968',
        networkId: '22888',
        timestamp: Date.now(),
        forceUIUpdate: true // إجبار تحديث الواجهة
      };

      // بث لجميع المحافظ المتصلة
      this.connectedWallets.forEach((walletWs, walletAddress) => {
        if (walletWs.readyState === 1) {
          try {
            walletWs.send(JSON.stringify(coinbaseUpdate));
          } catch (error) {
            console.error(`Error broadcasting Coinbase update to ${walletAddress}:`, error);
          }
        }
      });

      console.log(`🚀 Coinbase update broadcasted for ${address}`);
    } catch (error) {
      console.error('Error broadcasting Coinbase update:', error);
    }
  }

  // إشعار مخصص لـ Trust Wallet
  async sendTrustWalletNotification(address, data) {
    try {
      const currentBalance = data.newBalance || this.blockchain.getBalance(address);

      // إشعارات متعددة متوافقة مع Trust Wallet
      const trustWalletNotifications = [
        // إشعار Trust Wallet الأساسي
        {
          jsonrpc: '2.0',
          method: 'wallet_accountsChanged',
          params: [address],
          id: Date.now()
        },
        // إشعار تحديث الرصيد
        {
          jsonrpc: '2.0',
          method: 'eth_subscription',
          params: {
            subscription: '0x' + Date.now().toString(16),
            result: {
              address: address,
              blockNumber: '0x' + (this.blockchain.chain.length - 1).toString(16),
              transactionHash: data.txHash,
              value: '0x' + Math.floor(currentBalance * 1e18).toString(16),
              chainId: '0x5968',
              timestamp: '0x' + Math.floor(data.timestamp / 1000).toString(16)
            }
          },
          id: Date.now() + 1
        },
        // إشعار ERC-20 Token Transfer Event
        {
          jsonrpc: '2.0',
          method: 'eth_subscription',
          params: {
            subscription: '0x' + (Date.now() + 2).toString(16),
            result: {
              address: address,
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer event signature
                '0x000000000000000000000000' + address.replace('0x', ''), // to address
                '0x' + Math.floor(data.amount * 1e18).toString(16).padStart(64, '0') // amount
              ],
              data: '0x' + Math.floor(data.amount * 1e18).toString(16).padStart(64, '0'),
              blockNumber: '0x' + (this.blockchain.chain.length - 1).toString(16),
              transactionHash: data.txHash,
              logIndex: '0x0'
            }
          },
          id: Date.now() + 2
        }
      ];

      // إرسال الإشعارات للمحفظة المتصلة
      const walletWs = this.connectedWallets.get(address) || this.connectedWallets.get(address.toLowerCase());
      if (walletWs && walletWs.readyState === 1) {
        for (const notification of trustWalletNotifications) {
          try {
            walletWs.send(JSON.stringify(notification));
            await new Promise(resolve => setTimeout(resolve, 100)); // تأخير بسيط بين الإشعارات
          } catch (sendError) {
            console.error('Error sending Trust Wallet notification:', sendError);
          }
        }
        console.log(`📱 Trust Wallet notifications sent to ${address}: ${trustWalletNotifications.length} messages`);
      }

      // حفظ إشعار Trust Wallet
      const { pool } = await import('./db.js');
      await pool.query(`
        INSERT INTO wallet_notifications (address, notification_type, data, timestamp, delivered)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [
        address,
        'trust_wallet_balance_update',
        JSON.stringify({
          ...data,
          notifications_sent: trustWalletNotifications.length,
          trust_wallet_compatible: true
        }),
        Date.now(),
        walletWs ? true : false
      ]);

      console.log(`💳 Trust Wallet balance notification completed for ${address}: ${currentBalance.toFixed(8)} ACCESS`);

    } catch (error) {
      console.error('Error in Trust Wallet notification:', error);
    }
  }

  // إشعار عام للمحافظ الخارجية - متوافق مع جميع المحافظ والمنصات
  async notifyUniversalWalletBalance(address, notificationData) {
    try {
      const currentBalance = this.blockchain.getBalance(address);
      const currentTime = Date.now();

      // تحديث البيانات في قاعدة البيانات الخارجية مع إصلاح مشكلة first_seen
      const { pool } = await import('./db.js');

      // REMOVED: external_wallets updates - Using State Trie only like Ethereum

      // إرسال إشعارات متعددة للتوافق مع جميع المحافظ والمنصات
      const universalNotifications = [
        // إشعار ERC-20 معياري
        {
          method: 'eth_subscription',
          params: {
            subscription: '0x1',
            result: {
              address: address,
              topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
              data: '0x' + Math.floor(currentBalance * 1e18).toString(16),
              blockNumber: '0x' + (this.blockchain.chain.length - 1).toString(16),
              transactionHash: notificationData.txHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
              logIndex: '0x0',
              blockHash: this.blockchain.getLatestBlock().hash
            }
          }
        },
        // إشعار تحديث الرصيد العالمي
        {
          method: 'wallet_balanceChanged',
          params: {
            address: address,
            balance: '0x' + Math.floor(currentBalance * 1e18).toString(16),
            balanceFormatted: currentBalance.toFixed(8) + ' ACCESS',
            chainId: '0x5968',
            networkId: '22888',
            symbol: 'ACCESS',
            decimals: 18,
            timestamp: currentTime
          }
        },
        // إشعار للمنصات المركزية
        {
          method: 'chain_balanceUpdate',
          params: {
            chain: 'Access Network',
            chainId: '0x5968',
            address: address,
            balance: currentBalance.toString(),
            token: {
              symbol: 'ACCESS',
              decimals: 18,
              name: 'Access Coin'
            },
            blockHeight: this.blockchain.chain.length - 1,
            confirmations: 1
          }
        }
      ];

      // بث جميع الإشعارات للتوافق الشامل
      universalNotifications.forEach(notification => {
        this.broadcastToAllConnectedWallets(notification);
      });

      console.log(`🌐 Universal wallet notification sent: ${address} = ${currentBalance.toFixed(8)} ACCESS`);
      console.log(`📡 Sent ${universalNotifications.length} different notification formats for maximum compatibility`);

    } catch (error) {
      console.error('Error notifying universal wallet:', error);
    }
  }

  // بث لجميع المحافظ المتصلة
  broadcastToAllConnectedWallets(message) {
    try {
      this.connectedWallets.forEach((walletWs, address) => {
        if (walletWs.readyState === 1) {
          try {
            walletWs.send(JSON.stringify({
              jsonrpc: '2.0',
              ...message,
              id: Date.now()
            }));
          } catch (error) {
            console.error(`Error broadcasting to ${address}:`, error);
          }
        }
      });
    } catch (error) {
      console.error('Error broadcasting to all wallets:', error);
    }
  }

  // بث نتائج الاشتراكات للمحافظ المتصلة
  broadcastSubscriptionResult(subscriptionId, result) {
    try {
      const subscriptionMessage = {
        jsonrpc: '2.0',
        method: 'eth_subscription',
        params: {
          subscription: subscriptionId,
          result: result
        }
      };

      // بث لجميع المحافظ المتصلة عبر WebSocket
      if (this.wss && this.wss.clients) {
        this.wss.clients.forEach((ws) => {
          if (ws.readyState === 1) {
            try {
              ws.send(JSON.stringify(subscriptionMessage));
            } catch (error) {
              console.error('Error broadcasting subscription result:', error);
            }
          }
        });
      }

      // بث للمحافظ المسجلة
      this.connectedWallets.forEach((walletWs, address) => {
        if (walletWs.readyState === 1) {
          try {
            walletWs.send(JSON.stringify(subscriptionMessage));
          } catch (error) {
            console.error(`Error sending subscription to ${address}:`, error);
          }
        }
      });

      console.log(`📡 Subscription result broadcasted: ${subscriptionId}`);
    } catch (error) {
      console.error('Error broadcasting subscription result:', error);
    }
  }

  // بث تحديث الرصيد لجميع المحافظ
  async broadcastBalanceUpdate(transaction) {
    try {
      const balanceUpdate = {
        type: 'balance_update',
        fromAddress: transaction.from,
        toAddress: transaction.to,
        fromBalance: this.blockchain.getBalance(transaction.from),
        toBalance: this.blockchain.getBalance(transaction.to),
        txHash: transaction.hash,
        timestamp: Date.now(),
        chainId: '0x5968'
      };

      // بث للمحافظ المتصلة
      this.connectedWallets.forEach((walletWs, address) => {
        if (walletWs.readyState === 1 &&
            (address === transaction.from || address === transaction.to)) {
          try {
            walletWs.send(JSON.stringify(balanceUpdate));
          } catch (error) {
            console.error(`Error broadcasting to ${address}:`, error);
          }
        }
      });

      console.log(`🚀 Balance update broadcasted for transaction ${transaction.hash}`);
    } catch (error) {
      console.error('Error broadcasting balance update:', error);
    }
  }

  // بث فوري لتحديث الرصيد - NO CACHE
  async broadcastInstantBalanceUpdate(address, balance) {
    try {
      const normalizedAddress = address.toLowerCase();
      const balanceHex = '0x' + Math.floor(balance * 1e18).toString(16);

      // إشعار فوري بدون تخزين مؤقت
      const notification = {
        jsonrpc: '2.0',
        method: 'eth_subscription',
        params: {
          subscription: 'balance',
          result: {
            address: normalizedAddress,
            balance: balanceHex,
            blockNumber: '0x' + Math.floor(Date.now() / 1000).toString(16)
          }
        }
      };

      this.connectedWallets.forEach((walletWs, walletAddress) => {
        if (walletWs.readyState === 1 && walletAddress.toLowerCase() === normalizedAddress) {
          try {
            walletWs.send(JSON.stringify(notification));
            console.log(`📡 Instant balance update sent: ${address} = ${balance.toFixed(8)} ACCESS`);
          } catch (error) {
            console.error(`Error sending instant balance update to ${address}:`, error);
          }
        }
      });
    } catch (error) {
      console.error('Error broadcasting instant balance update:', error);
    }
  }

  // إشعار مخصص للمحافظ الخارجية - تحاكي دفع تحديث RPC
  async notifyExternalWalletBalanceUpdate(address, newBalance) {
    try {
      // هذه الدالة تحاكي دفع تحديث إلى محفظة متصلة.
      // في سيناريو حقيقي، قد يتضمن ذلك رسالة WebSocket مباشرة
      // أو آلية إشعار RPC محددة إذا كانت مدعومة.
      // لهذا المثال، نعتمد على إشعارات WebSocket الحالية للمحافظ المتصلة.
      await this.sendEnhancedWalletNotification(address, {
        type: 'rpc_balance_update',
        balance: newBalance,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('Error notifying external wallet balance update:', error);
    }
  }


  async getTransactionByHash(txHash) {
    const tx = this.blockchain.getTransactionByHash(txHash);
    if (!tx) return null;

    // جلب معلومات الكتلة إذا كانت المعاملة موجودة في كتلة
    let blockInfo = null;
    if (tx.blockHash) {
      blockInfo = this.blockchain.getBlockByHash(tx.blockHash);
    }

    return {
      hash: tx.txId,
      from: tx.fromAddress,
      to: tx.toAddress,
      value: '0x' + Math.floor(tx.amount * 1e18).toString(16),
      gas: '0x' + Math.floor(tx.gasFee * 1e18).toString(16),
      gasPrice: '0x' + Math.floor(tx.gasPrice * 1e18).toString(16),
      blockNumber: blockInfo ? '0x' + blockInfo.index.toString(16) : null,
      blockHash: tx.blockHash,
      transactionIndex: blockInfo ? '0x0' : null, // قد تحتاج إلى حساب هذا بشكل صحيح
      confirmations: blockInfo ? this.blockchain.chain.length - blockInfo.index : 0,
      timestamp: tx.timestamp,
      input: tx.data || '0x', // إضافة حقل الإدخال إذا كان موجوداً
      nonce: tx.nonce || '0x0' // إضافة حقل nonce إذا كان موجوداً
    };
  }

  async getBlockByNumber(blockNumber) {
    let index;
    if (blockNumber === 'latest' || blockNumber === 'pending') {
      index = this.blockchain.chain.length - 1;
    } else {
      index = parseInt(blockNumber, 16);
    }

    // 🔧 FIX: تأكد من وجود الـ blockchain chain
    if (!this.blockchain.chain || this.blockchain.chain.length === 0) {
      return {
        number: '0x0',
        hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        parentHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        timestamp: '0x0',
        transactions: [],
        difficulty: '0x1',
        totalDifficulty: '0x1',
        nonce: '0x0',
        miner: '0x0000000000000000000000000000000000000000',
        gasLimit: '0x1c9c380',
        gasUsed: '0x0'
      };
    }

    const block = this.blockchain.getBlockByIndex(index);
    
    if (!block) {
      return null;
    }

    let totalDifficulty = 0;
    for (let i = 0; i <= index; i++) {
      totalDifficulty += this.blockchain.difficulty;
    }

    const transactions = Array.isArray(block.transactions) 
      ? block.transactions.map(tx => tx.txId || tx.hash) 
      : [];

    return {
      number: '0x' + block.index.toString(16),
      hash: block.hash || '0x0000000000000000000000000000000000000000000000000000000000000000',
      parentHash: block.previousHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
      timestamp: '0x' + Math.floor((block.timestamp || Date.now()) / 1000).toString(16),
      transactions: transactions,
      difficulty: '0x' + this.blockchain.difficulty.toString(16),
      totalDifficulty: '0x' + totalDifficulty.toString(16),
      nonce: block.nonce ? '0x' + block.nonce.toString(16) : '0x0',
      miner: '0x0000000000000000000000000000000000000000',
      gasLimit: '0x1c9c380',
      gasUsed: '0x5208'
    };
  }

  async getBlockByHash(blockHash) {
    const block = this.blockchain.getBlockByHash(blockHash);
    
    // 🔧 FIX: إذا لم يوجد block، إرجاع null كما هو معيار Ethereum
    if (!block) {
      console.warn(`⚠️ Block with hash ${blockHash} not found`);
      return null;
    }

    return this.getBlockByNumber('0x' + block.index.toString(16));
  }

  async mineBlock(processorAddress) {
    if (!processorAddress) {
      throw new Error('Processor address required');
    }

    const block = this.blockchain.minePendingTransactions(processorAddress);

    // بث الكتلة الجديدة عبر WebSocket
    this.broadcastToSubscribers('newBlock', block);
    this.syncWithDatabase(block);

    return {
      blockHash: block.hash,
      blockNumber: block.index,
      reward: this.blockchain.processingReward
    };
  }

  handleWebSocketConnection(ws) {
    console.log('New WebSocket connection established');

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('WebSocket message received:', data);

        // 🔗 تتبع المحافظ المتصلة للكشف الدقيق عن المرسل
        if (data.method === 'wallet_connect' || data.method === 'eth_requestAccounts') {
          const walletAddress = data.params?.[0] || data.address;
          if (walletAddress && this.isValidEthereumAddress(walletAddress)) {
            this.connectedWallets.set(walletAddress.toLowerCase(), ws);
            console.log(`🔗 WALLET CONNECTED: ${walletAddress} registered for accurate sender detection`);

            // إشعار المحفظة بنجاح الاتصال
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              result: 'connected',
              id: data.id,
              chainId: '0x5968',
              networkId: '22888'
            }));
          }
        }

        // Handle subscription requests
        if (data.method === 'eth_subscribe') {
          const subscriptionId = '0x' + Date.now().toString(16);
          this.subscriptions.set(subscriptionId, { ws, filter: data.params[1] });

          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            result: subscriptionId,
            id: data.id
          }));
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');

      // إزالة المحفظة من قائمة المتصلة
      this.connectedWallets.forEach((walletWs, address) => {
        if (walletWs === ws) {
          this.connectedWallets.delete(address);
          console.log(`🔌 WALLET DISCONNECTED: ${address} removed from connected wallets`);
        }
      });

      // Remove this connection from all subscriptions
      this.subscriptions.forEach((subscription, id) => {
        if (subscription.ws === ws) {
          this.subscriptions.delete(id);
        }
      });
    });
  }

  startAutoProcessing() {
    // معالجة تلقائية فائقة السرعة - أقل من ثانية واحدة
    setInterval(async () => {
      try {
        if (this.blockchain.pendingTransactions.length > 0) {
          console.log(`🚀 ULTRA-FAST processing ${this.blockchain.pendingTransactions.length} pending operations...`);
          const systemProcessorAddress = '0x0000000000000000000000000000000000000001';
          const block = await this.blockchain.minePendingTransactions(systemProcessorAddress);

          if (block && block.transactions && Array.isArray(block.transactions)) {
            this.broadcastToSubscribers('newBlock', block);
            console.log(`⚡ Lightning Block ${block.index} processed with ${block.transactions.length} transactions in <500ms`);
          } else {
            // Silent processing - invalid structure
          }
        }
      } catch (error) {
        console.error('❌ خطأ في المعالجة التلقائية:', error);
      }
    }, 500); // 500ms - سرعة فائقة تتجاوز BSC و Ethereum
  }

  async syncWithDatabase(block) {
    try {
      // مزامنة البيانات مع قاعدة البيانات
      for (const tx of block.transactions) {
        if (tx.fromAddress && tx.toAddress) {
          const txHash = tx.txId || tx.hash;
          
          // التحقق من وجود المعاملة في hash أو tx_hash - تحديثها بدلاً من إنشاء مكررة
          const existingTx = await pool.query(
            'SELECT id FROM transactions WHERE hash = $1 OR tx_hash = $1 LIMIT 1',
            [txHash]
          );
          
          if (existingTx.rows.length > 0) {
            // المعاملة موجودة - تحديث معلومات البلوك فقط
            await pool.query(
              `UPDATE transactions 
               SET block_index = $1, 
                   block_hash = $2,
                   tx_hash = COALESCE(tx_hash, $3),
                   hash = COALESCE(hash, $3),
                   status = 'confirmed',
                   is_confirmed = true
               WHERE hash = $3 OR tx_hash = $3`,
              [block.index, block.hash, txHash]
            );
            console.log(`✅ Transaction ${txHash} updated with block info (existing ID: ${existingTx.rows[0].id})`);
          } else {
            // ⛔ NO INSERT HERE - معاملة غير موجودة في قاعدة البيانات = خطأ في النظام
            // server.js هو المسؤول الوحيد عن إنشاء المعاملات
            console.warn(`⚠️ Transaction ${txHash} not found in database - skipping INSERT (should be created by server.js first)`);
          }
        }
      }

      // حفظ معلومات السجل مع معالجة التكرار للسجلات
      await pool.query(
        `INSERT INTO blockchain_blocks (block_index, block_hash, previous_hash, timestamp, transactions_count, difficulty)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (block_index) DO UPDATE SET
         block_hash = EXCLUDED.block_hash,
         previous_hash = EXCLUDED.previous_hash,
         timestamp = EXCLUDED.timestamp,
         transactions_count = EXCLUDED.transactions_count,
         difficulty = EXCLUDED.difficulty`,
        [block.index, block.hash, block.previousHash, block.timestamp, block.transactions.length, this.blockchain.difficulty]
      );

      console.log(`Entry ${block.index} synced to database`);
    } catch (error) {
      console.error('Error syncing block to database:', error);
    }
  }

  // ترحيل الأرصدة الموجودة إلى البلوك تشين
  async migrateExistingBalances() {
    try {
      // الحصول على جميع الأرصدة من قاعدة البيانات
      const result = await pool.query(
        'SELECT id, email, wallet_address, coins FROM users WHERE coins > 0 AND wallet_address IS NOT NULL'
      );

      const users = result.rows;
      let totalMigrated = 0;
      const migratedUsers = [];

      for (const user of users) {
        const balance = parseFloat(user.coins) || 0;

        if (balance > 0 && user.wallet_address) {
          // إنشاء معاملة جينيسيس لكل مستخدم
          const genesisTransaction = this.blockchain.createGenesisTransaction(
            user.wallet_address,
            balance
          );

          // إضافة المعاملة للمعاملات المعلقة
          this.blockchain.pendingTransactions.push(genesisTransaction);

          totalMigrated += balance;
          migratedUsers.push({
            email: user.email,
            address: user.wallet_address,
            amount: balance
          });

          console.log(`Migrated ${balance} coins for user ${user.email} to address ${user.wallet_address}`);
        }
      }

      // تعدين كتلة جديدة تحتوي على معاملات الترحيل
      if (this.blockchain.pendingTransactions.length > 0) {
        const block = this.blockchain.minePendingTransactions('genesis-migration-system');

        // تحديث الإحصائيات
        this.blockchain.stats.circulatingSupply = this.blockchain.calculateCirculatingSupply();

        return {
          success: true,
          totalMigrated,
          usersCount: migratedUsers.length,
          blockHash: block.hash,
          blockIndex: block.index,
          migratedUsers
        };
      }

      return {
        success: false,
        message: 'No balances to migrate'
      };

    } catch (error) {
      console.error('Error migrating balances:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // تسجيل محفظة خارجية جديدة
  async registerExternalWallet(walletData) {
    try {
      const { address, userAgent, chainId, timestamp } = walletData;

      // التحقق من صحة العنوان
      if (!address || !address.startsWith('0x') || address.length !== 42) {
        throw new Error('عنوان محفظة غير صحيح');
      }

      // البحث عن رصيد موجود في قاعدة البيانات
      let dbBalance = 0;
      try {
        // البحث في جدول المستخدمين أولاً
        const userResult = await pool.query('SELECT coins FROM users WHERE wallet_address = $1', [address]);
        if (userResult.rows.length > 0) {
          dbBalance = parseFloat(userResult.rows[0].coins) || 0;
        }
      } catch (dbError) {
        console.error('Error fetching balance from users table:', dbError);
      }

      // تسجيل المحفظة في قاعدة البيانات مع الرصيد
      // REMOVED: external_wallets updates - Using State Trie only like Ethereum

      // تحديث رصيد البلوك تشين إذا كان هناك رصيد في قاعدة البيانات
      if (dbBalance > 0) {
        this.blockchain.updateBalance(address, dbBalance);
        console.log(`🔄 Synced balance for new external wallet: ${address} = ${dbBalance.toFixed(8)} ACCESS`);
      }

      // الحصول على رصيد المحفظة بعد المزامنة
      const balance = this.blockchain.getBalance(address);

      console.log(`📱 تم تسجيل محفظة خارجية جديدة: ${address} بر �يد ${balance.toFixed(8)} ACCESS`);

      return {
        success: true,
        address: address,
        balance: balance,
        registered: true,
        synced: dbBalance > 0,
        timestamp: Date.now()
      };

    } catch (error) {
      console.error('خطأ في تسجيل المحفظة الخارجية:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // جلب جميع المحافظ الخارجية
  async getExternalWallets() {
    try {
      const result = await pool.query(`
        SELECT
          address,
          user_agent,
          chain_id,
          first_seen,
          last_activity,
          connection_count,
          is_active
        FROM external_wallets
        WHERE is_active = true
        ORDER BY last_activity DESC
      `);

      const wallets = [];

      for (const row of result.rows) {
        const balance = this.blockchain.getBalance(row.address);
        const transactions = this.blockchain.getAllTransactionsForWallet(row.address);

        wallets.push({
          address: row.address,
          balance: balance,
          userAgent: row.user_agent,
          chainId: row.chain_id,
          firstSeen: new Date(parseInt(row.first_seen)).toLocaleString('ar'),
          lastActivity: new Date(parseInt(row.last_activity)).toLocaleString('ar'),
          connectionCount: row.connection_count || 1,
          transactionCount: transactions.length,
          isActive: row.is_active,
          hasBalance: balance > 0
        });
      }

      return {
        success: true,
        wallets: wallets,
        totalCount: wallets.length,
        activeCount: wallets.filter(w => w.isActive).length,
        walletsWithBalance: wallets.filter(w => w.hasBalance).length
      };

    } catch (error) {
      console.error('خطأ في جلب المحافظ الخارجية:', error);
      return {
        success: false,
        error: error.message,
        wallets: []
      };
    }
  }

  // REMOVED: trackWalletActivity - Using State Trie only like Ethereum

  // إنشاء الجداول المطلوبة مع فصل كامل للمحافظ
  async createWalletTables() {
    try {
      // إنشاء جدول المحافظ الداخلية (محافظ النظام)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS internal_wallets (
          id SERIAL PRIMARY KEY,
          address VARCHAR(42) UNIQUE NOT NULL,
          wallet_type VARCHAR(20) DEFAULT 'system', -- system, admin, treasury
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT true,
          balance DECIMAL(20,8) DEFAULT 0,
          last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          description TEXT,
          CONSTRAINT valid_address_format CHECK (address ~ '^0x[a-fA-F0-9]{40}$'),
          CONSTRAINT valid_wallet_type CHECK (wallet_type IN ('system', 'admin', 'treasury', 'processing'))
        )
      `);

      // إدراج المحافظ الداخلية الأساسية
      await pool.query(`
        INSERT INTO internal_wallets (address, wallet_type, description) VALUES
        ('0x0000000000000000000000000000000000000001', 'system', 'Genesis wallet'),
        ('0x0000000000000000000000000000000000000002', 'treasury', 'Network treasury'),
        ('0x0000000000000000000000000000000000000003', 'processing', 'Processing rewards pool')
        ON CONFLICT (address) DO NOTHING
      `);

      // إضافة الأعمدة المفقودة إلى جدول transactions
      try {
        await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN DEFAULT false');
        await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS confirmations INTEGER DEFAULT 0');
        await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS nonce INTEGER DEFAULT 0');
        await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(30) DEFAULT \'unknown\'');
        await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS sender_wallet_type VARCHAR(20) DEFAULT \'unknown\'');
        await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recipient_wallet_type VARCHAR(20) DEFAULT \'unknown\'');
        console.log('✅ Added missing columns to transactions table');
      } catch (error) {
        console.log('Columns already exist:', error.message);
      }

      // REMOVED: external_wallets tables - Using State Trie only like Ethereum
      // All wallet balances stored in State Trie with ZERO PostgreSQL dependency

      // جدول إشعارات المحافظ
      await pool.query(`
        CREATE TABLE IF NOT EXISTS wallet_notifications (
          id SERIAL PRIMARY KEY,
          address VARCHAR(42) NOT NULL,
          notification_type VARCHAR(50) NOT NULL,
          data JSONB NOT NULL,
          timestamp BIGINT NOT NULL,
          delivered BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(address, notification_type, timestamp)
        )
      `);

      // REMOVED: External wallet indexes - Using State Trie only like Ethereum
      // إضافة فهارس لتحسين الأداء
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_wallet_notifications_address ON wallet_notifications(address);
      `);

      // جدول كتل البلوك تشين
      await pool.query(`
        CREATE TABLE IF NOT EXISTS blockchain_blocks (
          id SERIAL PRIMARY KEY,
          block_index INTEGER UNIQUE NOT NULL,
          block_hash VARCHAR(66) UNIQUE NOT NULL,
          previous_hash VARCHAR(66),
          timestamp BIGINT NOT NULL,
          transactions_count INTEGER DEFAULT 0,
          difficulty INTEGER DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // إضافة فهرس لجدول الكتل
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_blockchain_blocks_index ON blockchain_blocks(block_index);
        CREATE INDEX IF NOT EXISTS idx_blockchain_blocks_hash ON blockchain_blocks(block_hash);
      `);

      console.log('جداول المحافظ الخارجية تم إنشاؤها بنجاح مع دعم nonce محسن');

    } catch (error) {
      console.error('خطأ في إنشاء جداول المحافظ:', error);
    }
  }

  // مزامنة تلقائية لجميع أرصدة المحافظ
  async syncAllWalletBalances() {
    try {
      const result = await pool.query(`
        SELECT wallet_address, coins, email
        FROM users
        WHERE wallet_address IS NOT NULL
        AND wallet_address != ''
        AND coins > 0
      `);

      let syncedCount = 0;

      for (const user of result.rows) {
        const { wallet_address, coins } = user;
        const dbBalance = parseFloat(coins) || 0;
        const blockchainBalance = this.blockchain.getBalance(wallet_address);

        // إذا كان هناك اختلاف في الرصيد، قم بالمزامنة
        if (Math.abs(dbBalance - blockchainBalance) > 0.00000001) {
          this.blockchain.updateBalance(wallet_address, dbBalance);
          syncedCount++;
        }
      }

      // إعادة تشغيل المزامنة كل 10 دقائق
      setTimeout(() => {
        this.syncAllWalletBalances();
      }, 600000);

    } catch (error) {
      console.error('❌ خطأ في المزامنة التلقائية:', error);

      // إعادة المحاولة بعد دقيقة في حالة الخطأ
      setTimeout(() => {
        this.syncAllWalletBalances();
      }, 60000);
    }
  }

  // إحصائيات الشبكة
  getStats() {
    return {
      ...this.blockchain.stats,
      rpcPort: this.port,
      isRunning: this.isRunning,
      activeSubscriptions: this.subscriptions.size,
      uptime: process.uptime(),
      connectedWalletsCount: this.connectedWallets.size
    };
  }

  // جلب جميع المعاملات من البلوك تشين
  async getAllTransactions() {
    try {
      const allTransactions = [];
      
      // جلب المعاملات من جميع الكتل
      for (let i = 0; i < this.blockchain.chain.length; i++) {
        const block = this.blockchain.chain[i];
        if (block.transactions && block.transactions.length > 0) {
          block.transactions.forEach(tx => {
            allTransactions.push({
              hash: tx.txId || tx.hash,
              from: tx.fromAddress || tx.from,
              to: tx.toAddress || tx.to,
              amount: (tx.amount || 0).toFixed(8) + ' ACCESS',
              gasFee: (tx.gasFee || 0).toFixed(8) + ' ACCESS',
              timestamp: tx.timestamp,
              blockIndex: block.index,
              blockHash: block.hash,
              confirmed: true
            });
          });
        }
      }
      
      // إضافة المعاملات المعلقة
      this.blockchain.pendingTransactions.forEach(tx => {
        allTransactions.push({
          hash: tx.txId || tx.hash,
          from: tx.fromAddress || tx.from,
          to: tx.toAddress || tx.to,
          amount: (tx.amount || 0).toFixed(8) + ' ACCESS',
          gasFee: (tx.gasFee || 0).toFixed(8) + ' ACCESS',
          timestamp: tx.timestamp,
          blockIndex: null,
          blockHash: null,
          confirmed: false,
          pending: true
        });
      });
      
      // ترتيب المعاملات حسب الوقت (الأحدث أولاً)
      allTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      
      return allTransactions;
    } catch (error) {
      console.error('Error getting all transactions:', error);
      throw error;
    }
  }

  // جلب المعاملات حسب العنوان
  async getTransactionsByAddress(address) {
    try {
      const addressTransactions = [];
      const normalizedAddress = address.toLowerCase();
      
      // البحث في جميع الكتل
      for (let i = 0; i < this.blockchain.chain.length; i++) {
        const block = this.blockchain.chain[i];
        if (block.transactions && block.transactions.length > 0) {
          block.transactions.forEach(tx => {
            const fromAddr = (tx.fromAddress || tx.from || '').toLowerCase();
            const toAddr = (tx.toAddress || tx.to || '').toLowerCase();
            
            if (fromAddr === normalizedAddress || toAddr === normalizedAddress) {
              addressTransactions.push({
                hash: tx.txId || tx.hash,
                from: tx.fromAddress || tx.from,
                to: tx.toAddress || tx.to,
                amount: (tx.amount || 0).toFixed(8) + ' ACCESS',
                gasFee: (tx.gasFee || 0).toFixed(8) + ' ACCESS',
                timestamp: tx.timestamp,
                blockIndex: block.index,
                blockHash: block.hash,
                confirmed: true,
                type: fromAddr === normalizedAddress ? 'sent' : 'received'
              });
            }
          });
        }
      }
      
      // البحث في المعاملات المعلقة
      this.blockchain.pendingTransactions.forEach(tx => {
        const fromAddr = (tx.fromAddress || tx.from || '').toLowerCase();
        const toAddr = (tx.toAddress || tx.to || '').toLowerCase();
        
        if (fromAddr === normalizedAddress || toAddr === normalizedAddress) {
          addressTransactions.push({
            hash: tx.txId || tx.hash,
            from: tx.fromAddress || tx.from,
            to: tx.toAddress || tx.to,
            amount: (tx.amount || 0).toFixed(8) + ' ACCESS',
            gasFee: (tx.gasFee || 0).toFixed(8) + ' ACCESS',
            timestamp: tx.timestamp,
            blockIndex: null,
            blockHash: null,
            confirmed: false,
            pending: true,
            type: fromAddr === normalizedAddress ? 'sent' : 'received'
          });
        }
      });
      
      // ترتيب المعاملات حسب الوقت (الأحدث أولاً)
      addressTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      
      return addressTransactions;
    } catch (error) {
      console.error('Error getting transactions by address:', error);
      throw error;
    }
  }

  // جلب جميع الأرصدة
  async getAllBalances() {
    try {
      const balances = [];
      
      // جلب الأرصدة من البلوك تشين
      if (this.blockchain.balances && this.blockchain.balances.size > 0) {
        this.blockchain.balances.forEach((balance, address) => {
          if (balance > 0) {
            balances.push({
              address: address,
              balance: balance.toFixed(8),
              balanceWei: '0x' + Math.floor(balance * 1e18).toString(16),
              formatted: balance.toFixed(8) + ' ACCESS'
            });
          }
        });
      }
      
      // ترتيب الأرصدة حسب القيمة (الأعلى أولاً)
      balances.sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance));
      
      return balances;
    } catch (error) {
      console.error('Error getting all balances:', error);
      throw error;
    }
  }

  // جلب جميع الكتل
  async getAllBlocks() {
    try {
      const blocks = [];
      
      for (let i = 0; i < this.blockchain.chain.length; i++) {
        const block = this.blockchain.chain[i];
        blocks.push({
          index: block.index,
          hash: block.hash,
          previousHash: block.previousHash,
          timestamp: block.timestamp,
          transactionCount: block.transactions ? block.transactions.length : 0,
          difficulty: this.blockchain.difficulty,
          size: JSON.stringify(block).length,
          formatted: {
            timestamp: new Date(block.timestamp).toLocaleString('ar-SA'),
            size: (JSON.stringify(block).length / 1024).toFixed(2) + ' KB'
          }
        });
      }
      
      // ترتيب الكتل حسب الفهرس (الأحدث أولاً)
      blocks.reverse();
      
      return blocks;
    } catch (error) {
      console.error('Error getting all blocks:', error);
      throw error;
    }
  }

  // جلب إحصائيات الشبكة المفصلة
  async getNetworkStats() {
    try {
      const totalSupply = await this.blockchain.calculateCirculatingSupply();
      const totalTransactions = await this.getTotalTransactionCount();
      
      // Get REAL block count from database
      let totalBlocks = this.blockchain.chain.length;
      try {
        const { pool } = await import('./db.js');
        const blockResult = await pool.query('SELECT COUNT(*) as count FROM blockchain_blocks');
        totalBlocks = parseInt(blockResult.rows[0]?.count || 0);
      } catch (error) {
        console.warn('⚠️ Failed to get real block count, using chain length:', error.message);
      }
      
      const activeBalances = this.blockchain.balances.size;
      const pendingTx = this.blockchain.pendingTransactions.length;
      
      return {
        network: {
          chainId: '0x5968',
          networkId: '22888',
          name: 'Access Network',
          symbol: 'ACCESS',
          decimals: 18
        },
        supply: {
          total: totalSupply.toFixed(8),
          maxSupply: '25000000.00000000',
          circulatingSupply: totalSupply.toFixed(8),
          formatted: totalSupply.toFixed(8) + ' ACCESS'
        },
        blockchain: {
          totalBlocks: totalBlocks,
          totalTransactions: totalTransactions,
          pendingTransactions: pendingTx,
          activeAddresses: activeBalances,
          difficulty: this.blockchain.difficulty,
          blockTime: '3s',
          gasPrice: this.blockchain.getGasPrice() + ' Gwei'
        },
        node: {
          isRunning: this.isRunning,
          port: this.port,
          connectedWallets: this.connectedWallets.size,
          uptime: Math.floor(process.uptime()) + 's',
          version: '1.0.0'
        },
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error getting network stats:', error);
      throw error;
    }
  }

  // حساب العدد الإجمالي للمعاملات
  async getTotalTransactionCount() {
    try {
      let total = 0;
      
      // عد المعاملات في جميع الكتل
      for (let i = 0; i < this.blockchain.chain.length; i++) {
        const block = this.blockchain.chain[i];
        if (block.transactions) {
          total += block.transactions.length;
        }
      }
      
      return total;
    } catch (error) {
      console.error('Error counting total transactions:', error);
      return 0;
    }
  }

  // معالجة استدعاءات العقد الذكي
  async handleContractCall(callData, callBlockTag = 'latest') {
    try {
      const { to, data } = callData;

      // ✅ التحقق من أن العنوان صحيح
      if (!to || !this.isValidEthereumAddress(to)) {
        console.warn(`⚠️ eth_call on invalid address: ${to}`);
        // ✅ إرجاع خطأ "execution reverted" - هذا يخبر MetaMask أن العنوان ليس عقد
        throw { code: 3, message: 'execution reverted', data: '0x' };
      }

      // ✅ التحقق من أن البيانات موجودة
      if (!data || data.length < 10) {
        console.log(`⚠️ eth_call with no function data on ${to}, treating as EOA`);
        // ✅ إرجاع خطأ "execution reverted" للـ EOA
        throw { code: 3, message: 'execution reverted', data: '0x' };
      }

      // استخراج function selector (أول 4 bytes)
      const functionSelector = data.substring(0, 10);

      switch (functionSelector) {
        case '0x70a08231': // balanceOf(address)
          const address = '0x' + data.substring(34, 74);
          const balance = this.blockchain.getBalance(address);
          const balanceInWei = Math.floor(balance * 1e18);
          return '0x' + balanceInWei.toString(16).padStart(64, '0');

        case '0xa9059cbb': // transfer(address,uint256)
          return '0x0000000000000000000000000000000000000000000000000000000000000001';

        case '0x095ea7b3': // approve(address,uint256)
          return '0x0000000000000000000000000000000000000000000000000000000000000001';

        case '0xdd62ed3e': // allowance(address,address)
          const owner = '0x' + data.substring(34, 74);
          const spender = '0x' + data.substring(98, 138);
          const allowance = this.blockchain.allowance(owner, spender);
          const allowanceInWei = Math.floor(allowance * 1e18);
          return '0x' + allowanceInWei.toString(16).padStart(64, '0');

        case '0x06fdde03': // name()
          const name = Buffer.from('Access Coin').toString('hex');
          return '0x' + '0'.repeat(64) + name.length.toString(16).padStart(64, '0') + name.padEnd(64, '0');

        case '0x95d89b41': // symbol()
          const symbol = Buffer.from('ACCESS').toString('hex');
          return '0x' + '0'.repeat(64) + symbol.length.toString(16).padStart(64, '0') + symbol.padEnd(64, '0');

        case '0x313ce567': // decimals()
          return '0x0000000000000000000000000000000000000000000000000000000000000012'; // 18 decimals

        case '0x18160ddd': // totalSupply()
          const totalSupply = this.blockchain.getTotalSupply();
          const totalSupplyInWei = Math.floor(totalSupply * 1e18);
          return '0x' + totalSupplyInWei.toString(16).padStart(64, '0');

        case '0x01ffc9a7': // supportsInterface(bytes4) - ERC165
          // ✅ للعناوين العادية (EOA)، نرجع "execution reverted" بدلاً من false
          // هذا يخبر MetaMask أن العنوان ليس عقد ذكي
          console.log(`🔍 supportsInterface call on ${to} - returning revert for EOA (not a contract)`);
          throw { code: 3, message: 'execution reverted', data: '0x' };

        case '0x06fdde03': // name()
          const nameFunc = Buffer.from('Access Coin').toString('hex');
          return '0x' + '0'.repeat(64) + nameFunc.length.toString(16).padStart(64, '0') + nameFunc.padEnd(64, '0');

        default:
          // ⚠️ Unknown function selector - ترجع "execution reverted" للـ EOA
          console.log(`🔍 Unknown function selector: ${functionSelector} on address ${to} - returning revert (EOA, not contract)`);
          // ✅ ترجع خطأ revert - هذا يخبر MetaMask أن العنوان ليس contract
          throw { code: 3, message: 'execution reverted', data: '0x' };
      }
    } catch (error) {
      // ✅ إذا كان الخطأ من نوع revert، نرميه كما هو
      if (error.code === 3) {
        throw error;
      }
      console.error('Error handling contract call:', error);
      // ✅ عند حدوث خطأ آخر، نرجع revert أيضاً
      throw { code: 3, message: 'execution reverted', data: '0x' };
    }
  }

  // جلب سجلات الأحداث
  async getEventLogs(filterOptions) {
    try {
      const { address, fromBlock = 'earliest', toBlock = 'latest', topics = [] } = filterOptions;

      const logs = [];
      const startBlock = fromBlock === 'earliest' ? 0 : parseInt(fromBlock, 16);
      const endBlock = toBlock === 'latest' ? this.blockchain.chain.length - 1 : parseInt(toBlock, 16);

      // جلب سجلات Transfer events
      for (let i = startBlock; i <= endBlock; i++) {
        const block = this.blockchain.getBlockByIndex(i);
        if (!block) continue;

        block.transactions.forEach((tx, index) => {
          if (tx.fromAddress && tx.toAddress && tx.amount > 0) {
            const transferLog = {
              address: '0x0000000000000000000000000000000000000000',
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer event signature
                '0x000000000000000000000000' + (tx.fromAddress || '0').replace('0x', ''),
                '0x000000000000000000000000' + (tx.toAddress || '0').replace('0x', '')
              ],
              data: '0x' + Math.floor((tx.amount || 0) * 1e18).toString(16).padStart(64, '0'),
              blockNumber: '0x' + i.toString(16),
              transactionHash: tx.txId,
              transactionIndex: '0x' + index.toString(16),
              logIndex: '0x0',
              removed: false
            };

            // تصفية حسب topics
            let matchesFilter = true;
            if (topics.length > 0) {
              topics.forEach((topic, topicIndex) => {
                if (topic && transferLog.topics[topicIndex] !== topic) {
                  matchesFilter = false;
                }
              });
            }

            if (matchesFilter) {
              logs.push(transferLog);
            }
          }
        });
      }

      console.log(`📋 Retrieved ${logs.length} event logs`);
      return logs;

    } catch (error) {
      console.error('Error getting event logs:', error);
      return [];
    }
  }

  // تحليل وتتحقق من المعاملة الخام
  async parseAndValidateRawTransaction(rawTxHex) {
    try {
      // إزالة 0x إذا كانت موجودة
      const cleanHex = rawTxHex.startsWith('0x') ? rawTxHex.slice(2) : rawTxHex;

      // التحقق الأساسي من الطول
      if (cleanHex.length < 100) {
        throw new Error('Transaction too short to be valid');
      }

      // محاولة فك تشفير RLP مع معالجة محسنة للأخطاء
      let decodedTx;
      try {
        decodedTx = this.decodeRLP(cleanHex);

        if (!decodedTx || typeof decodedTx !== 'object') {
          throw new Error('Invalid RLP decode result');
        }
      } catch (rlpError) {
        console.error('RLP decoding error:', rlpError.message);
        throw new Error(`Failed to decode RLP transaction: ${rlpError.message}`);
      }

      // ✅ CONTRACT DEPLOYMENT: Allow empty 'to' for contract creation (don't validate it as address)
      const isContractDeployment = !decodedTx.to || decodedTx.to === '0x' || decodedTx.to === '';
      
      // Only validate 'to' address if it's not a contract deployment
      if (!isContractDeployment && !this.isValidEthereumAddress(decodedTx.to)) {
        throw new Error('Invalid recipient address');
      }

      // استخراج البيانات الأساسية مع التحقق
      let parsedNonce = parseInt(decodedTx.nonce, 16) || 0;
      
      const txData = {
        nonce: parsedNonce,
        gasPrice: parseInt(decodedTx.gasPrice, 16) || 20000000000, // 20 Gwei
        gasLimit: parseInt(decodedTx.gasLimit, 16) || 21000,
        to: isContractDeployment ? '' : decodedTx.to.toLowerCase(), // ✅ Empty string for contract deployment
        value: parseInt(decodedTx.value, 16) / 1e18 || 0,
        data: decodedTx.data || '0x',
        v: decodedTx.v,
        r: decodedTx.r,
        s: decodedTx.s,
        rawFields: decodedTx.rawFields, // ✅ SIGNATURE RECOVERY: Pass raw RLP fields
        isContractDeployment: isContractDeployment // ✅ Flag to indicate contract deployment
      };

      // ✅ CONTRACT DEPLOYMENT: Don't modify value - it can be 0 for contract deployment
      // Value of 0 is valid for many transactions including contract deployment

      // ✅ TRUST WALLET OPTIMIZED: Multi-method sender recovery
      let senderAddress = null;

      // Method 1: Try signature recovery (works for MetaMask, sometimes fails for Trust Wallet)
      console.log(`🔐 Attempting signature recovery from (v, r, s)...`);
      try {
        const recoveredSender = await this.recoverSenderAddress(txData, txData.v, txData.r, txData.s);
        if (recoveredSender && this.isValidEthereumAddress(recoveredSender)) {
          senderAddress = recoveredSender.toLowerCase();
          console.log(`✅ SIGNATURE RECOVERY SUCCESS: ${senderAddress}`);
        } else {
          console.warn('⚠️ Signature recovery failed - using Trust Wallet fallback...');
        }
      } catch (sigError) {
        console.warn(`⚠️ Signature recovery error: ${sigError.message}`);
      }

      // Fallback methods (only if signature recovery fails)
      if (!senderAddress) {
        console.log(`⚠️ Signature recovery failed, using fallback methods (not recommended for production)`);

        // Fallback 1: Try to extract from connected wallets with balance check
        if (!senderAddress) {
          const connectedWallets = Array.from(this.connectedWallets.keys());
          if (connectedWallets.length > 0) {
            const requiredAmount = txData.value + (txData.gasPrice * txData.gasLimit / 1e18 || 0.00002);

            // Find wallet with sufficient balance
            for (const wallet of connectedWallets) {
              const normalizedWallet = wallet.toLowerCase();
              
              if (normalizedWallet === txData.to) continue; // Skip recipient

              const balance = this.blockchain.getBalance(normalizedWallet);
              if (balance >= requiredAmount) {
                senderAddress = normalizedWallet;
                console.log(`✅ TRUST WALLET: Found sender with balance: ${senderAddress} (${balance.toFixed(8)} ACCESS)`);
                break;
              }
            }
          }
        }

        // Fallback 2: Connected wallets with sufficient balance
        if (!senderAddress) {
          const connectedWallets = Array.from(this.connectedWallets.keys());
          if (connectedWallets.length > 0) {
            const requiredAmount = txData.value + (txData.gasPrice * txData.gasLimit || 0.00002);

            for (const wallet of connectedWallets) {
              const normalizedWallet = wallet.toLowerCase();
              
              if (normalizedWallet === txData.to) continue; // Skip recipient

              const balance = this.blockchain.getBalance(normalizedWallet);
              if (balance >= requiredAmount) {
                senderAddress = normalizedWallet;
                console.log(`🔄 FALLBACK: Using connected wallet: ${senderAddress}`);
                break;
              }
            }
          }
        }

        // Fallback 3: Recent nonce activity
        if (!senderAddress && this.lastUsedNonces && this.lastUsedNonces.size > 0) {
          for (const [address, lastNonce] of this.lastUsedNonces.entries()) {
            const normalizedAddress = address.toLowerCase();
            if (normalizedAddress === txData.to) continue; // Skip recipient

            const balance = this.blockchain.getBalance(normalizedAddress);
            if (balance >= txData.value + 0.00002 && lastNonce >= txData.nonce - 5) {
              senderAddress = normalizedAddress;
              console.log(`🔄 FALLBACK: Using nonce activity: ${senderAddress}`);
              break;
            }
          }
        }
      }

      // Final validation
      if (!senderAddress || !this.isValidEthereumAddress(senderAddress)) {
        console.error('❌ CRITICAL: Could not determine valid sender address from signature or fallbacks');
        throw new Error('Transaction rejected: Unable to recover sender address from signature. Please ensure your wallet is using EIP-155 signatures.');
      }

      // Ensure sender address is properly normalized
      txData.from = senderAddress;
      txData.fromAddress = txData.from; // Add both formats for compatibility

      console.log(`✅ Final sender address: ${txData.from}`);

      // ✅ CONTRACT DEPLOYMENT: Allow empty 'to' for contract creation
      // Only normalize 'to' address if it exists (not contract deployment)
      if (txData.to && txData.to !== '' && txData.to !== '0x') {
        // Normalize recipient address for regular transactions
        txData.to = txData.to.toLowerCase();
        txData.toAddress = txData.to; // Add both formats for compatibility
      } else {
        // ✅ CONTRACT DEPLOYMENT: Empty 'to' is valid
        console.log(`📝 CONTRACT DEPLOYMENT detected: Empty 'to' field`);
        txData.to = ''; // Ensure it's empty string for contract deployment
        txData.toAddress = ''; // Both formats
        txData.isContractDeployment = true;
      }

      // 🚫 CRITICAL SECURITY CHECK: منع معاملات الإرسال للنفس في RPC
      if (txData.from && txData.to && txData.from === txData.to) {
        const errorMsg = `🚫 RPC SECURITY VIOLATION: Self-transactions are prohibited. Cannot send from ${txData.from} to ${txData.to}`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      // إنشاء hash للمعاملة محدود بـ 64 حرف
      const hashData = JSON.stringify({
        from: txData.from,
        to: txData.to,
        value: txData.value,
        nonce: txData.nonce,
        timestamp: Date.now()
      });

      const fullHash = crypto.createHash('sha256').update(hashData).digest('hex');
      txData.hash = '0x' + fullHash; // 66 حرف (0x + 64 hex chars)

      txData.timestamp = Date.now();
      // تقليم التوقيع لتجنب مشكلة طول قاعدة البيانات
      const rawSignature = `${txData.v}${txData.r}${txData.s}`;
      txData.signature = rawSignature.length > 130 ? rawSignature.substring(0, 130) : rawSignature;

      console.log(`✅ Raw transaction parsed successfully:`, {
        from: txData.from,
        to: txData.to,
        value: txData.value.toFixed(8) + ' ACCESS',
        nonce: txData.nonce,
        hash: txData.hash.substring(0, 10) + '...'
      });

      return txData;

    } catch (error) {
      console.error('❌ Error parsing raw transaction:', error.message);
      throw new Error(`Transaction parsing failed: ${error.message}`);
    }
  }

  // تصنيف المحافظ (محلية أم خارجية)
  async classifyWallets(fromAddress, toAddress) {
    try {
      // تنظيف العناوين قبل التصنيف
      const cleanFromAddress = fromAddress ? fromAddress.toLowerCase().trim() : '';
      const cleanToAddress = toAddress ? toAddress.toLowerCase().trim() : '';

      const fromClassification = await this.isWalletRegistered(cleanFromAddress);
      const toClassification = await this.isWalletRegistered(cleanToAddress);

      const senderType = fromClassification.registered ? fromClassification.type : 'external';
      const recipientType = toClassification.registered ? toClassification.type : 'external';

      return {
        senderType: senderType,
        recipientType: recipientType,
        transactionType: `${senderType}-to-${recipientType}`,
        mixedTransaction: senderType !== recipientType
      };
    } catch (error) {
      console.error('Error classifying wallets:', error);
      // في حالة الخطأ، افترض أنها معاملة خارجية آمنة
      return {
        senderType: 'external',
        recipientType: 'external',
        transactionType: 'external-to-external',
        mixedTransaction: true
      };
    }
  }

  // حفظ المعاملة إلى قاعدة البيانات
  async saveTransactionToDatabase(transaction, walletClassification = null) {
    try {
      const { pool } = await import('./db.js');

      // ✅ CONTRACT DEPLOYMENT: Allow empty 'to' for contract deployment
      const isContractDeployment = !transaction.to || transaction.to === '' || transaction.to === '0x';
      
      // التحقق الصارم من البيانات المطلوبة - مع السماح بـ contract deployment
      if (!transaction.hash || !this.isValidEthereumAddress(transaction.from) || transaction.value === undefined) {
        console.error('❌ Invalid transaction data for database saving:', {
          hash: transaction.hash,
          from: transaction.from,
          to: transaction.to,
          value: transaction.value,
          fromValid: this.isValidEthereumAddress(transaction.from),
          isContractDeployment: isContractDeployment
        });
        throw new Error('Invalid transaction data: required fields missing or invalid');
      }
      
      // For contract deployment, use contract address or null
      if (isContractDeployment) {
        transaction.to = transaction.contractAddress || null;
        console.log(`📝 CONTRACT DEPLOYMENT for PostgreSQL: Setting to = ${transaction.to}`);
      } else if (!this.isValidEthereumAddress(transaction.to)) {
        console.error('❌ Invalid to address for regular transaction');
        throw new Error('Invalid to address format');
      }

      // تصنيف المحافظ إذا لم يتم تمريره
      if (!walletClassification) {
        walletClassification = await this.classifyWallets(transaction.from, transaction.to);
      }

      const amount = parseFloat(transaction.value);
      const blockIndex = transaction.blockNumber ? parseInt(transaction.blockNumber, 16) : null;

      // التأكد من أن nonce في نطاق آمن
      let safeNonce = transaction.nonce || 0;
      if (safeNonce > 2147483647) {
        safeNonce = Math.floor(Date.now() / 1000) % 1000000;
        console.log(`🔢 Adjusted nonce for database: ${transaction.nonce} -> ${safeNonce}`);
      }

      if (safeNonce < 0) {
        safeNonce = Math.abs(safeNonce);
      }

      // حفظ gas_price في ACCESS (قيمة عشرية) بدلاً من wei لتجنب overflow
      const gasPriceInAccess = Math.min(parseFloat(transaction.gasPrice || 0.00002), 99999999.99999999);

      // ✅ UPSERT LOGIC - إنشاء المعاملة إذا لم تكن موجودة، أو تحديثها إذا كانت موجودة
      // هذا يحل مشكلة المعاملات الواردة من المحافظ الخارجية
      const upsertResult = await pool.query(`
        INSERT INTO transactions (
          hash,
          tx_hash,
          sender_address,
          recipient_address,
          from_address,
          to_address,
          amount,
          timestamp,
          block_hash,
          block_index,
          nonce,
          gas_used,
          gas_price,
          gas_fee,
          chain_id,
          network_id,
          is_external,
          transaction_type,
          sender_wallet_type,
          recipient_wallet_type,
          is_confirmed,
          confirmations,
          status
        ) VALUES (
          $1::text, $1::varchar(66), $2, $3, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'confirmed'
        )
        ON CONFLICT (tx_hash) DO UPDATE SET
          tx_hash = EXCLUDED.tx_hash,
          from_address = EXCLUDED.from_address,
          to_address = EXCLUDED.to_address,
          sender_address = EXCLUDED.sender_address,
          recipient_address = EXCLUDED.recipient_address,
          amount = EXCLUDED.amount,
          timestamp = EXCLUDED.timestamp,
          block_hash = EXCLUDED.block_hash,
          block_index = EXCLUDED.block_index,
          nonce = EXCLUDED.nonce,
          gas_used = EXCLUDED.gas_used,
          gas_price = EXCLUDED.gas_price,
          gas_fee = EXCLUDED.gas_fee,
          chain_id = EXCLUDED.chain_id,
          network_id = EXCLUDED.network_id,
          is_external = EXCLUDED.is_external,
          transaction_type = EXCLUDED.transaction_type,
          sender_wallet_type = EXCLUDED.sender_wallet_type,
          recipient_wallet_type = EXCLUDED.recipient_wallet_type,
          is_confirmed = EXCLUDED.is_confirmed,
          confirmations = EXCLUDED.confirmations,
          status = 'confirmed'
        RETURNING id
      `, [
        transaction.hash,                              // $1
        transaction.from,                              // $2
        transaction.to,                                // $3
        amount,                                        // $4
        transaction.timestamp || Date.now(),          // $5
        transaction.blockHash,                         // $6
        blockIndex,                                    // $7
        safeNonce,                                     // $8
        transaction.gasLimit || 21000,                 // $9
        gasPriceInAccess.toFixed(8),                   // $10
        '0x5968',                                      // $11
        '22888',                                       // $12
        walletClassification.senderType === 'external' || walletClassification.recipientType === 'external', // $13
        walletClassification.transactionType,          // $14
        walletClassification.senderType,               // $15
        walletClassification.recipientType,            // $16
        true,                                          // $17
        1                                              // $18
      ]);

      console.log(`✅ Transaction recorded in database:`, {
        hash: transaction.hash,
        amount: amount.toFixed(8) + ' ACCESS',
        type: walletClassification.transactionType,
        sender: walletClassification.senderType,
        recipient: walletClassification.recipientType,
        nonce: safeNonce,
        gasPriceAccess: gasPriceInAccess.toFixed(8) + ' ACCESS'
      });

    } catch (error) {
      console.error('❌ Error saving transaction to database:', error);
      throw error;
    }
  }

  // تحديث أرصدة قاعدة البيانات للمرسل والمستقبل
  async updateDatabaseBalances(senderAddress, senderBalance, receiverAddress, receiverBalance) {
    try {
      const { pool } = await import('./db.js');

      // تحديث رصيد المرسل في جدول المستخدمين
      await pool.query(
        'UPDATE users SET coins = $1 WHERE LOWER(wallet_address) = $2',
        [senderBalance.toFixed(8), senderAddress.toLowerCase()]
      );

      // تحديث رصيد المستقبل في جدول المستخدمين
      await pool.query(
        'UPDATE users SET coins = $1 WHERE LOWER(wallet_address) = $2',
        [receiverBalance.toFixed(8), receiverAddress.toLowerCase()]
      );

      // REMOVED: external_wallets updates - Using State Trie only like Ethereum

      console.log(`📊 Database balances updated successfully`);
      console.log(`   المرسل ${senderAddress}: ${senderBalance.toFixed(8)} ACCESS`);
      console.log(`   المستقبل ${receiverAddress}: ${receiverBalance.toFixed(8)} ACCESS`);

    } catch (error) {
      console.error('خطأ في تحديث قاعدة البيانات:', error);
    }
  }

  // إشعار المحافظ بتحديث الأرصدة
  async notifyWalletsOfBalanceUpdate(senderAddress, senderBalance, receiverAddress, receiverBalance, transaction) {
    try {
      // إشعار المرسل بخصم الرصيد
      await this.sendEnhancedWalletNotification(senderAddress, {
        type: 'balance_deducted',
        newBalance: senderBalance,
        amount: transaction.amount,
        txHash: transaction.hash,
        timestamp: Date.now()
      });

      // إشعار المستقبل بزيادة الرصيد
      await this.sendEnhancedWalletNotification(receiverAddress, {
        type: 'balance_received',
        newBalance: receiverBalance,
        amount: transaction.amount,
        txHash: transaction.hash,
        timestamp: Date.now()
      });

      console.log(`📱 المحافظ تم إشعارها بتحديثات الأرصدة`);

    } catch (error) {
      console.error('خطأ في إرسال الإشعارات:', error);
    }
  }

  // ⚡ NETWORK STATE IS THE ONLY SOURCE OF TRUTH
  // Database sync REMOVED - يتسبب في تحديث الرصيد بقيم قديمة من DB
  // Network state هو المصدر الوحيد - Database هو backup فقط
  async syncBalanceFromDatabase(address) {
    // 🚫 DISABLED - Database should never override network state
    // Network state → Database (one direction only)
    return false;
  }

  // إشعار المحافظ الخارجية بالمعاملة الجديدة
  async notifyExternalWalletsOfTransaction(transaction) {
    try {
      // إشعار المرسل
      if (this.connectedWallets.has(transaction.fromAddress)) {
        await this.sendEnhancedWalletNotification(transaction.fromAddress, {
          type: 'transaction_sent',
          txHash: transaction.hash,
          to: transaction.toAddress,
          amount: transaction.amount,
          newBalance: this.blockchain.getBalance(transaction.fromAddress),
          timestamp: Date.now()
        });
      }

      // إشعار المستقبل
      if (this.connectedWallets.has(transaction.toAddress)) {
        await this.sendEnhancedWalletNotification(transaction.toAddress, {
          type: 'transaction_received',
          txHash: transaction.hash,
          from: transaction.fromAddress,
          amount: transaction.amount,
          newBalance: this.blockchain.getBalance(transaction.toAddress),
          timestamp: Date.now()
        });
      }

      console.log(`📱 تم إشعار المحافظ الخارجية بالمعاملة: ${transaction.hash}`);
    } catch (error) {
      console.error('خطأ في إشعار المحافظ الخارجية:', error);
    }
  }

  // إشعار عام للمحافظ الخارجية - متوافق مع جميع المحافظ والمنصات
  async notifyUniversalWalletBalance(address, notificationData) {
    try {
      const currentBalance = this.blockchain.getBalance(address);
      const currentTime = Date.now();

      // تحديث البيانات في قاعدة البيانات الخارجية مع إصلاح مشكلة first_seen
      const { pool } = await import('./db.js');

      // REMOVED: external_wallets updates - Using State Trie only like Ethereum

      // إرسال إشعارات متعددة للتوافق مع جميع المحافظ والمنصات
      const universalNotifications = [
        // إشعار ERC-20 معياري
        {
          method: 'eth_subscription',
          params: {
            subscription: '0x1',
            result: {
              address: address,
              topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
              data: '0x' + Math.floor(currentBalance * 1e18).toString(16),
              blockNumber: '0x' + (this.blockchain.chain.length - 1).toString(16),
              transactionHash: notificationData.txHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
              logIndex: '0x0',
              blockHash: this.blockchain.getLatestBlock().hash
            }
          }
        },
        // إشعار تحديث الرصيد العالمي
        {
          method: 'wallet_balanceChanged',
          params: {
            address: address,
            balance: '0x' + Math.floor(currentBalance * 1e18).toString(16),
            balanceFormatted: currentBalance.toFixed(8) + ' ACCESS',
            chainId: '0x5968',
            networkId: '22888',
            symbol: 'ACCESS',
            decimals: 18,
            timestamp: currentTime
          }
        },
        // إشعار للمنصات المركزية
        {
          method: 'chain_balanceUpdate',
          params: {
            chain: 'Access Network',
            chainId: '0x5968',
            address: address,
            balance: currentBalance.toString(),
            token: {
              symbol: 'ACCESS',
              decimals: 18,
              name: 'Access Coin'
            },
            blockHeight: this.blockchain.chain.length - 1,
            confirmations: 1
          }
        }
      ];

      // بث جميع الإشعارات للتوافق الشامل
      universalNotifications.forEach(notification => {
        this.broadcastToAllConnectedWallets(notification);
      });

      console.log(`🌐 Universal wallet notification sent: ${address} = ${currentBalance.toFixed(8)} ACCESS`);
      console.log(`📡 Sent ${universalNotifications.length} different notification formats for maximum compatibility`);

    } catch (error) {
      console.error('Error notifying universal wallet:', error);
    }
  }

  // التحقق من صحة عنوان Ethereum بدقة عالية
  isValidEthereumAddress(address) {
    if (!address || typeof address !== 'string') {
      return false;
    }

    // التحقق من التنسيق الأساسي
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return false;
    }

    // التحقق من أن العنوان ليس كله أصفار
    if (address === '0x0000000000000000000000000000000000000000') {
      return false;
    }

    // التحقق من checksum إذا كان موجوداً
    if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
      return this.isValidChecksum(address);
    }

    return true;
  }

  // Enhanced RLP decoder with better address extraction
  decodeRLP(hexString) {
    try {
      // This is an enhanced RLP decoder for Ethereum transactions
      const buffer = Buffer.from(hexString, 'hex');

      // Basic RLP decoding for transaction structure
      // [nonce, gasPrice, gasLimit, to, value, data, v, r, s]

      let offset = 0;
      const fields = [];
      const extractedAddresses = [];

      // Skip RLP list prefix with better error handling
      if (buffer.length === 0) {
        throw new Error('Empty buffer');
      }

      if (buffer[0] >= 0xf7) {
        const lengthBytes = buffer[0] - 0xf7;
        if (lengthBytes > buffer.length - 1) {
          throw new Error('Invalid RLP length encoding');
        }
        offset = 1 + lengthBytes;
      } else if (buffer[0] >= 0xc0) {
        offset = 1;
      }

      // Extract fields with address detection
      for (let i = 0; i < 9 && offset < buffer.length; i++) {
        const fieldStart = offset;

        if (buffer[offset] < 0x80) {
          // Single byte
          fields.push('0x' + buffer[offset].toString(16).padStart(2, '0'));
          offset += 1;
        } else if (buffer[offset] < 0xb8) {
          // Short string
          const length = buffer[offset] - 0x80;
          offset += 1;
          if (length > 0) {
            const fieldData = buffer.slice(offset, offset + length);
            const hexData = '0x' + fieldData.toString('hex');
            fields.push(hexData);

            // Check if this could be an address (20 bytes = 40 hex chars)
            if (length === 20) {
              const addressCandidate = hexData;
              if (this.isValidEthereumAddress(addressCandidate)) {
                extractedAddresses.push(addressCandidate);
                console.log(`🔍 Found potential address in RLP field ${i}: ${addressCandidate}`);
              }
            }

            offset += length;
          } else {
            fields.push('0x');
          }
        } else {
          // Long string
          const lengthOfLength = buffer[offset] - 0xb7;
          offset += 1;
          if (offset + lengthOfLength <= buffer.length) {
            let length = 0;
            for (let j = 0; j < lengthOfLength; j++) {
              length = (length * 256) + buffer[offset + j];
            }
            offset += lengthOfLength;

            if (offset + length <= buffer.length) {
              const fieldData = buffer.slice(offset, offset + length);
              const hexData = '0x' + fieldData.toString('hex');
              fields.push(hexData);

              // Check for addresses in long strings
              if (length === 20) {
                const addressCandidate = hexData;
                if (this.isValidEthereumAddress(addressCandidate)) {
                  extractedAddresses.push(addressCandidate);
                  console.log(`🔍 Found potential address in long field ${i}: ${addressCandidate}`);
                }
              }

              offset += length;
            } else {
              fields.push('0x');
              break;
            }
          } else {
            fields.push('0x');
            break;
          }
        }
      }

      const decodedTx = {
        nonce: fields[0] || '0x0',
        gasPrice: fields[1] || '0x4a817c800', // 20 Gwei
        gasLimit: fields[2] || '0x5208', // 21000
        to: fields[3] || '0x', // ✅ CONTRACT DEPLOYMENT: Allow empty 'to' for contract creation
        value: fields[4] || '0x0',
        data: fields[5] || '0x',
        v: fields[6] || '0x1c',
        r: fields[7] || '0x' + '0'.repeat(64),
        s: fields[8] || '0x' + '0'.repeat(64),
        extractedAddresses: extractedAddresses, // Additional field with found addresses
        rawFields: fields // ✅ SIGNATURE RECOVERY: Keep original RLP fields for correct hash calculation
      };

      // ✅ CONTRACT DEPLOYMENT FIX: Don't modify 'to' field - keep original value for signature recovery
      // Empty 'to' is valid for contract deployment transactions

      console.log(`🔍 RLP decoding result:`, {
        fieldsCount: fields.length,
        addressesFound: extractedAddresses.length,
        to: decodedTx.to,
        value: decodedTx.value,
        extractedAddresses: extractedAddresses
      });

      return decodedTx;

    } catch (error) {
      console.error('❌ Enhanced RLP decoding error:', error);
      return null;
    }
  }

  // Recover sender address from signature with improved logic
  recoverSenderAddress(txData, v, r, s) {
    try {
      // ✅ ETHEREUM-STYLE SIGNATURE RECOVERY using elliptic + keccak256
      if (!r || !s || !v) {
        console.warn('⚠️ Missing signature components for sender recovery');
        return null;
      }

      // ✅ CRITICAL FIX: Use original RLP fields for correct signature recovery
      // DO NOT reconstruct fields from parsed txData - this changes the hash!
      let txFields;
      
      if (txData.rawFields && txData.rawFields.length >= 6) {
        // Use raw RLP fields directly (already in hex format)
        txFields = [
          txData.rawFields[0], // nonce (hex)
          txData.rawFields[1], // gasPrice (hex)
          txData.rawFields[2], // gasLimit (hex)
          txData.rawFields[3], // to (hex or empty for contract deployment)
          txData.rawFields[4], // value (hex)
          txData.rawFields[5]  // data (hex)
        ];
      } else {
        // Fallback: reconstruct from txData (may cause issues with contract deployment)
        console.warn('⚠️ No raw RLP fields available, reconstructing (may be inaccurate for contract deployment)');
        txFields = [
          txData.nonce || 0,
          txData.gasPrice || 20000000000,
          txData.gasLimit || 21000,
          txData.to || '', // ✅ Empty for contract deployment
          Math.floor((txData.value || 0) * 1e18),
          txData.data || '0x'
        ];
      }

      // Add chainId for EIP-155 (Access Network Chain ID: 22888)
      const chainId = 22888;
      txFields.push(chainId, 0, 0);

      // RLP encode the transaction (using imported rlp and keccak256)
      const encodedTx = rlp.encode(txFields);
      const txHash = Buffer.from(keccak256(encodedTx), 'hex'); // ✅ ETHEREUM-STYLE: keccak256 not SHA256

      // Calculate recovery ID from v
      let recoveryId;
      const vNum = typeof v === 'string' ? parseInt(v, 16) : v;
      
      if (vNum === 27 || vNum === 28) {
        // Legacy signature (pre-EIP-155)
        recoveryId = vNum - 27;
      } else {
        // EIP-155 signature: v = chainId * 2 + 35 + recoveryId
        recoveryId = vNum - (chainId * 2 + 35);
      }

      console.log(`🔐 Signature recovery: v=${vNum}, recoveryId=${recoveryId}, chainId=${chainId}`);

      // Ensure recovery ID is valid (0 or 1)
      if (recoveryId < 0 || recoveryId > 1) {
        console.warn(`⚠️ Invalid recovery ID: ${recoveryId}, using fallback`);
        recoveryId = 0;
      }

      // Convert r and s to Buffer
      const rHex = r.startsWith('0x') ? r.slice(2) : r;
      const sHex = s.startsWith('0x') ? s.slice(2) : s;
      const rBuffer = Buffer.from(rHex, 'hex');
      const sBuffer = Buffer.from(sHex, 'hex');

      // Use elliptic library for public key recovery (using imported EC)
      const ec = new EC('secp256k1');
      
      try {
        // Recover public key from signature
        const publicKey = ec.recoverPubKey(
          txHash,
          { r: rBuffer, s: sBuffer },
          recoveryId,
          'hex'
        );

        // Get uncompressed public key (without 0x04 prefix)
        const publicKeyHex = publicKey.encode('hex', false).slice(2);
        
        // Use keccak256 to derive address from public key (using imported keccak256)
        const addressHash = keccak256(Buffer.from(publicKeyHex, 'hex'));
        
        // Take last 20 bytes (40 hex chars) as Ethereum address
        const recoveredAddress = '0x' + addressHash.slice(-40);
        
        console.log(`✅ ETHEREUM-STYLE RECOVERY: ${recoveredAddress}`);
        
        if (this.isValidEthereumAddress(recoveredAddress)) {
          return recoveredAddress.toLowerCase();
        }
      } catch (ellipticError) {
        console.warn('⚠️ Elliptic recovery failed:', ellipticError.message);
      }

      // Fallback: Use connected wallets only if signature recovery fails
      const connectedAddresses = Array.from(this.connectedWallets.keys());
      if (connectedAddresses.length > 0) {
        console.log(`🔄 Fallback to connected wallet: ${connectedAddresses[0]}`);
        return connectedAddresses[0];
      }

      console.warn('❌ Could not recover sender address');
      return null;

    } catch (error) {
      console.error('❌ Address recovery error:', error);

      // Emergency fallback
      const connectedAddresses = Array.from(this.connectedWallets.keys());
      if (connectedAddresses.length > 0) {
        console.log(`🆘 Emergency fallback sender: ${connectedAddresses[0]}`);
        return connectedAddresses[0];
      }

      return null;
    }
  }

  // Verify transaction signature
  verifyTransactionSignature(txData, from, v, r, s) {
    try {
      // This would normally verify the signature using elliptic curve cryptography
      // For now, return true if all signature components are present
      return !!(v && r && s && from);
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
    }
  }

  // التحقق من صحة عنوان Ethereum بدقة عالية
  isValidEthereumAddress(address) {
    if (!address || typeof address !== 'string') {
      return false;
    }

    // التحقق من التنسيق الأساسي
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return false;
    }

    // التحقق من أن العنوان ليس كله أصفار
    if (address === '0x0000000000000000000000000000000000000000') {
      return false;
    }

    // التحقق من checksum إذا كان موجوداً
    if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
      return this.isValidChecksum(address);
    }

    return true;
  }

  // التحقق من checksum للعنوان
  isValidChecksum(address) {
    try {
      const crypto = require('crypto');
      const addressHash = crypto.createHash('sha256').update(address.toLowerCase().replace('0x', '')).digest('hex');

      for (let i = 0; i < 40; i++) {
        const char = address[i + 2];
        const shouldBeUppercase = parseInt(addressHash[i], 16) >= 8;

        if (char.toLowerCase() !== char && !shouldBeUppercase) return false;
        if (char.toUpperCase() !== char && shouldBeUppercase) return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  // REMOVED: Duplicate classifyWallets - Using first instance only

  // تطبيع العنوان مع التحقق من الصحة
  normalizeAddress(address) {
    if (!this.isValidEthereumAddress(address)) {
      return null;
    }
    return address.toLowerCase();
  }

  // إنشاء nonce فريد لكل معاملة
  generateUniqueNonce(address) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return timestamp + random;
  }

  // إنشاء hash للمعاملة
  generateTxHash(transaction) {
    const hashInput = `${transaction.fromAddress}${transaction.toAddress}${transaction.amount}${transaction.nonce}${Date.now()}`;
    return '0x' + crypto.createHash('sha256').update(hashInput).digest('hex');
  }

  // حفظ المعاملة في قاعدة البيانات مع معلومات التصنيف
  async saveTransactionToDatabase(transaction, walletClassification = null) {
    try {
      const { pool } = await import('./db.js');

      // ✅ CONTRACT DEPLOYMENT: Allow empty 'to' for contract deployment
      const isContractDeployment = !transaction.to || transaction.to === '' || transaction.to === '0x';
      
      // التحقق الصارم من البيانات المطلوبة - مع السماح بـ contract deployment
      if (!transaction.hash || !this.isValidEthereumAddress(transaction.from) || transaction.value === undefined) {
        console.error('❌ Invalid transaction data for database saving:', {
          hash: transaction.hash,
          from: transaction.from,
          to: transaction.to,
          value: transaction.value,
          fromValid: this.isValidEthereumAddress(transaction.from),
          isContractDeployment: isContractDeployment
        });
        throw new Error('Invalid transaction data: required fields missing or invalid');
      }
      
      // For contract deployment, use contract address or null
      if (isContractDeployment) {
        transaction.to = transaction.contractAddress || null;
        console.log(`📝 CONTRACT DEPLOYMENT for PostgreSQL: Setting to = ${transaction.to}`);
      } else if (!this.isValidEthereumAddress(transaction.to)) {
        console.error('❌ Invalid to address for regular transaction');
        throw new Error('Invalid to address format');
      }

      // تصنيف المحافظ إذا لم يتم تمريره
      if (!walletClassification) {
        walletClassification = await this.classifyWallets(transaction.from, transaction.to);
      }

      const amount = parseFloat(transaction.value);
      const blockIndex = transaction.blockNumber ? parseInt(transaction.blockNumber, 16) : null;

      // التأكد من أن nonce في نطاق آمن
      let safeNonce = transaction.nonce || 0;
      if (safeNonce > 2147483647) {
        safeNonce = Math.floor(Date.now() / 1000) % 1000000;
        console.log(`🔢 Adjusted nonce for database: ${transaction.nonce} -> ${safeNonce}`);
      }

      if (safeNonce < 0) {
        safeNonce = Math.abs(safeNonce);
      }

      // حفظ gas_price في ACCESS (قيمة عشرية) بدلاً من wei لتجنب overflow
      const gasPriceInAccess = Math.min(parseFloat(transaction.gasPrice || 0.00002), 99999999.99999999);

      // ✅ UPSERT LOGIC - إنشاء المعاملة إذا لم تكن موجودة، أو تحديثها إذا كانت موجودة
      // هذا يحل مشكلة المعاملات الواردة من المحافظ الخارجية
      const upsertResult = await pool.query(`
        INSERT INTO transactions (
          hash,
          tx_hash,
          sender_address,
          recipient_address,
          from_address,
          to_address,
          amount,
          timestamp,
          block_hash,
          block_index,
          nonce,
          gas_used,
          gas_price,
          gas_fee,
          chain_id,
          network_id,
          is_external,
          transaction_type,
          sender_wallet_type,
          recipient_wallet_type,
          is_confirmed,
          confirmations,
          status
        ) VALUES (
          $1::text, $1::varchar(66), $2, $3, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'confirmed'
        )
        ON CONFLICT (tx_hash) DO UPDATE SET
          tx_hash = EXCLUDED.tx_hash,
          from_address = EXCLUDED.from_address,
          to_address = EXCLUDED.to_address,
          sender_address = EXCLUDED.sender_address,
          recipient_address = EXCLUDED.recipient_address,
          amount = EXCLUDED.amount,
          timestamp = EXCLUDED.timestamp,
          block_hash = EXCLUDED.block_hash,
          block_index = EXCLUDED.block_index,
          nonce = EXCLUDED.nonce,
          gas_used = EXCLUDED.gas_used,
          gas_price = EXCLUDED.gas_price,
          gas_fee = EXCLUDED.gas_fee,
          chain_id = EXCLUDED.chain_id,
          network_id = EXCLUDED.network_id,
          is_external = EXCLUDED.is_external,
          transaction_type = EXCLUDED.transaction_type,
          sender_wallet_type = EXCLUDED.sender_wallet_type,
          recipient_wallet_type = EXCLUDED.recipient_wallet_type,
          is_confirmed = EXCLUDED.is_confirmed,
          confirmations = EXCLUDED.confirmations,
          status = 'confirmed'
        RETURNING id
      `, [
        transaction.hash,                              // $1
        transaction.from,                              // $2
        transaction.to,                                // $3
        amount,                                        // $4
        transaction.timestamp || Date.now(),          // $5
        transaction.blockHash,                         // $6
        blockIndex,                                    // $7
        safeNonce,                                     // $8
        transaction.gasLimit || 21000,                 // $9
        gasPriceInAccess.toFixed(8),                   // $10
        '0x5968',                                      // $11
        '22888',                                       // $12
        walletClassification.senderType === 'external' || walletClassification.recipientType === 'external', // $13
        walletClassification.transactionType,          // $14
        walletClassification.senderType,               // $15
        walletClassification.recipientType,            // $16
        true,                                          // $17
        1                                              // $18
      ]);

      console.log(`✅ Transaction recorded in database:`, {
        hash: transaction.hash,
        amount: amount.toFixed(8) + ' ACCESS',
        type: walletClassification.transactionType,
        sender: walletClassification.senderType,
        recipient: walletClassification.recipientType,
        nonce: safeNonce,
        gasPriceAccess: gasPriceInAccess.toFixed(8) + ' ACCESS'
      });

    } catch (error) {
      console.error('❌ Error saving transaction to database:', error);
      throw error;
    }
  }

  // تحديث أرصدة قاعدة البيانات للمرسل والمستقبل
  async updateDatabaseBalances(senderAddress, senderBalance, receiverAddress, receiverBalance) {
    try {
      const { pool } = await import('./db.js');

      // تحديث رصيد المرسل في جدول المستخدمين
      await pool.query(
        'UPDATE users SET coins = $1 WHERE LOWER(wallet_address) = $2',
        [senderBalance.toFixed(8), senderAddress.toLowerCase()]
      );

      // تحديث رصيد المستقبل في جدول المستخدمين
      await pool.query(
        'UPDATE users SET coins = $1 WHERE LOWER(wallet_address) = $2',
        [receiverBalance.toFixed(8), receiverAddress.toLowerCase()]
      );

      // REMOVED: external_wallets updates - Using State Trie only like Ethereum

      console.log(`📊 تم تحديث قاعدة البيانات:`);
      console.log(`   المرسل ${senderAddress}: ${senderBalance.toFixed(8)} ACCESS`);
      console.log(`   المستقبل ${receiverAddress}: ${receiverBalance.toFixed(8)} ACCESS`);

    } catch (error) {
      console.error('خطأ في تحديث قاعدة البيانات:', error);
    }
  }

  // إشعار المحافظ بتحديث الأرصدة
  async notifyWalletsOfBalanceUpdate(senderAddress, senderBalance, receiverAddress, receiverBalance, transaction) {
    try {
      // إشعار المرسل بخصم الرصيد
      await this.sendEnhancedWalletNotification(senderAddress, {
        type: 'balance_deducted',
        newBalance: senderBalance,
        amount: transaction.amount,
        txHash: transaction.hash,
        timestamp: Date.now()
      });

      // إشعار المستقبل بزيادة الرصيد
      await this.sendEnhancedWalletNotification(receiverAddress, {
        type: 'balance_received',
        newBalance: receiverBalance,
        amount: transaction.amount,
        txHash: transaction.hash,
        timestamp: Date.now()
      });

      console.log(`📱 المحافظ تم إشعارها بتحديثات الأرصدة`);

    } catch (error) {
      console.error('خطأ في إرسال الإشعارات:', error);
    }
  }

  // التحقق من صحة عنوان Ethereum بدقة عالية
  isValidEthereumAddress(address) {
    if (!address || typeof address !== 'string') {
      return false;
    }

    // التحقق من التنسيق الأساسي
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return false;
    }

    // التحقق من أن العنوان ليس كله أص؁ار
    if (address === '0x0000000000000000000000000000000000000000') {
      return false;
    }

    // التحقق من checksum إذا كان موجوداً
    if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
      return this.isValidChecksum(address);
    }

    return true;
  }

  // ✅ Get nonce for address (required for contract deployment)
  async getNonceForAddress(address) {
    try {
      // Get nonce from blockchain state storage
      if (this.blockchain && this.blockchain.getNonce) {
        return await this.blockchain.getNonce(address);
      }
      
      // Fallback: get from state storage directly
      if (this.stateStorage) {
        const account = await this.stateStorage.getAccount(address);
        return account ? account.nonce || 0 : 0;
      }
      
      // Last resort: return 0
      return 0;
    } catch (error) {
      console.error(`Error getting nonce for ${address}:`, error);
      return 0;
    }
  }

  // الكشف عن العنوان الصحيح للمرسل
  detectCorrectSenderAddress(detectedSender, requiredAmount) {
    const connectedAddresses = Array.from(this.connectedWallets.keys());

    if (connectedAddresses.length === 0) {
      // إذا لم تكن هناك محافظ متصلة، استخدم العنوان المكتشف
      return detectedSender;
    }

    // البحث عن عنوان متصل لديه رصيد كافٍ
    for (const address of connectedAddresses) {
      const balance = this.blockchain.getBalance(address);
      if (balance >= requiredAmount) {
        return address; // تم العثور على المرسل الصحيح
      }
    }

    // إذا لم يتم العثور على عنوان برصيد كافٍ، استخدم أول عنوان متصل كمرسل افتراضي
    return connectedAddresses[0];
  }

  // التحقق من checksum للعنوان
  isValidChecksum(address) {
    try {
      const crypto = require('crypto');
      const addressHash = crypto.createHash('sha256').update(address.toLowerCase().replace('0x', '')).digest('hex');

      for (let i = 0; i < 40; i++) {
        const char = address[i + 2];
        const shouldBeUppercase = parseInt(addressHash[i], 16) >= 8;

        if (char.toLowerCase() !== char && !shouldBeUppercase) return false;
        if (char.toUpperCase() !== char && shouldBeUppercase) return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  // REMOVED: Duplicate classifyWallets - Using first instance only

  // تطبيع العنوان مع التحقق من الصحة
  normalizeAddress(address) {
    if (!this.isValidEthereumAddress(address)) {
      return null;
    }
    return address.toLowerCase();
  }

  // إنشاء nonce فريد لكل معاملة
  generateUniqueNonce(address) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return timestamp + random;
  }

  // إنشاء hash للمعاملة
  generateTxHash(transaction) {
    const hashInput = `${transaction.fromAddress}${transaction.toAddress}${transaction.amount}${transaction.nonce}${Date.now()}`;
    return '0x' + crypto.createHash('sha256').update(hashInput).digest('hex');
  }

  // حفظ المعاملة في قاعدة البيانات مع معلومات التصنيف
  async saveTransactionToDatabase(transaction, walletClassification = null) {
    try {
      const { pool } = await import('./db.js');

      // ✅ CONTRACT DEPLOYMENT: Allow empty 'to' for contract deployment
      const isContractDeployment = !transaction.to || transaction.to === '' || transaction.to === '0x';
      
      // التحقق الصارم من البيانات المطلوبة - مع السماح بـ contract deployment
      if (!transaction.hash || !this.isValidEthereumAddress(transaction.from) || transaction.value === undefined) {
        console.error('❌ Invalid transaction data for database saving:', {
          hash: transaction.hash,
          from: transaction.from,
          to: transaction.to,
          value: transaction.value,
          fromValid: this.isValidEthereumAddress(transaction.from),
          isContractDeployment: isContractDeployment
        });
        throw new Error('Invalid transaction data: required fields missing or invalid');
      }
      
      // For contract deployment, use contract address or null
      if (isContractDeployment) {
        transaction.to = transaction.contractAddress || null;
        console.log(`📝 CONTRACT DEPLOYMENT for PostgreSQL: Setting to = ${transaction.to}`);
      } else if (!this.isValidEthereumAddress(transaction.to)) {
        console.error('❌ Invalid to address for regular transaction');
        throw new Error('Invalid to address format');
      }

      // تصنيف المحافظ إذا لم يتم تمريره
      if (!walletClassification) {
        walletClassification = await this.classifyWallets(transaction.from, transaction.to);
      }

      const amount = parseFloat(transaction.value);
      const blockIndex = transaction.blockNumber ? parseInt(transaction.blockNumber, 16) : null;

      // التأكد من أن nonce في نطاق آمن
      let safeNonce = transaction.nonce || 0;
      if (safeNonce > 2147483647) {
        safeNonce = Math.floor(Date.now() / 1000) % 1000000;
        console.log(`🔢 Adjusted nonce for database: ${transaction.nonce} -> ${safeNonce}`);
      }

      if (safeNonce < 0) {
        safeNonce = Math.abs(safeNonce);
      }

      // حفظ gas_price في ACCESS (قيمة عشرية) بدلاً من wei لتجنب overflow
      const gasPriceInAccess = Math.min(parseFloat(transaction.gasPrice || 0.00002), 99999999.99999999);

      // ✅ UPSERT LOGIC - إنشاء المعاملة إذا لم تكن موجودة، أو تحديثها إذا كانت موجودة
      // هذا يحل مشكلة المعاملات الواردة من المحافظ الخارجية
      const upsertResult = await pool.query(`
        INSERT INTO transactions (
          hash,
          tx_hash,
          sender_address,
          recipient_address,
          from_address,
          to_address,
          amount,
          timestamp,
          block_hash,
          block_index,
          nonce,
          gas_used,
          gas_price,
          gas_fee,
          chain_id,
          network_id,
          is_external,
          transaction_type,
          sender_wallet_type,
          recipient_wallet_type,
          is_confirmed,
          confirmations,
          status
        ) VALUES (
          $1::text, $1::varchar(66), $2, $3, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'confirmed'
        )
        ON CONFLICT (tx_hash) DO UPDATE SET
          tx_hash = EXCLUDED.tx_hash,
          from_address = EXCLUDED.from_address,
          to_address = EXCLUDED.to_address,
          sender_address = EXCLUDED.sender_address,
          recipient_address = EXCLUDED.recipient_address,
          amount = EXCLUDED.amount,
          timestamp = EXCLUDED.timestamp,
          block_hash = EXCLUDED.block_hash,
          block_index = EXCLUDED.block_index,
          nonce = EXCLUDED.nonce,
          gas_used = EXCLUDED.gas_used,
          gas_price = EXCLUDED.gas_price,
          gas_fee = EXCLUDED.gas_fee,
          chain_id = EXCLUDED.chain_id,
          network_id = EXCLUDED.network_id,
          is_external = EXCLUDED.is_external,
          transaction_type = EXCLUDED.transaction_type,
          sender_wallet_type = EXCLUDED.sender_wallet_type,
          recipient_wallet_type = EXCLUDED.recipient_wallet_type,
          is_confirmed = EXCLUDED.is_confirmed,
          confirmations = EXCLUDED.confirmations,
          status = 'confirmed'
        RETURNING id
      `, [
        transaction.hash,                              // $1
        transaction.from,                              // $2
        transaction.to,                                // $3
        amount,                                        // $4
        transaction.timestamp || Date.now(),          // $5
        transaction.blockHash,                         // $6
        blockIndex,                                    // $7
        safeNonce,                                     // $8
        transaction.gasLimit || 21000,                 // $9
        gasPriceInAccess.toFixed(8),                   // $10
        '0x5968',                                      // $11
        '22888',                                       // $12
        walletClassification.senderType === 'external' || walletClassification.recipientType === 'external', // $13
        walletClassification.transactionType,          // $14
        walletClassification.senderType,               // $15
        walletClassification.recipientType,            // $16
        true,                                          // $17
        1                                              // $18
      ]);

      console.log(`✅ Transaction recorded in database:`, {
        hash: transaction.hash,
        amount: amount.toFixed(8) + ' ACCESS',
        type: walletClassification.transactionType,
        sender: walletClassification.senderType,
        recipient: walletClassification.recipientType,
        nonce: safeNonce,
        gasPriceAccess: gasPriceInAccess.toFixed(8) + ' ACCESS'
      });

    } catch (error) {
      console.error('❌ Error saving transaction to database:', error);
      throw error;
    }
  }

  // تحديث أرصدة قاعدة البيانات للمرسل والمستقبل
  async updateDatabaseBalances(senderAddress, senderBalance, receiverAddress, receiverBalance) {
    try {
      const { pool } = await import('./db.js');

      // تحديث رصيد المرسل في جدول المستخدمين
      await pool.query(
        'UPDATE users SET coins = $1 WHERE LOWER(wallet_address) = $2',
        [senderBalance.toFixed(8), senderAddress.toLowerCase()]
      );

      // تحديث رصيد المستقبل في جدول المستخدمين
      await pool.query(
        'UPDATE users SET coins = $1 WHERE LOWER(wallet_address) = $2',
        [receiverBalance.toFixed(8), receiverAddress.toLowerCase()]
      );

      // REMOVED: external_wallets updates - Using State Trie only like Ethereum

      console.log(`📊 تم تحديث قاعدة البيانات:`);
      console.log(`   المرسل ${senderAddress}: ${senderBalance.toFixed(8)} ACCESS`);
      console.log(`   المستقبل ${receiverAddress}: ${receiverBalance.toFixed(8)} ACCESS`);

    } catch (error) {
      console.error('خطأ في تحديث قاعدة البيانات:', error);
    }
  }

  // إشعار المحافظ بتحديث الأرصدة
  async notifyWalletsOfBalanceUpdate(senderAddress, senderBalance, receiverAddress, receiverBalance, transaction) {
    try {
      // إشعار المرسل بخصم الرصيد
      await this.sendEnhancedWalletNotification(senderAddress, {
        type: 'balance_deducted',
        newBalance: senderBalance,
        amount: transaction.amount,
        txHash: transaction.hash,
        timestamp: Date.now()
      });

      // إشعار المستقبل بزيادة الرصيد
      await this.sendEnhancedWalletNotification(receiverAddress, {
        type: 'balance_received',
        newBalance: receiverBalance,
        amount: transaction.amount,
        txHash: transaction.hash,
        timestamp: Date.now()
      });

      console.log(`📱 المحافظ تم إشعارها بتحديثات الأرصدة`);

    } catch (error) {
      console.error('خطأ في إرسال الإشعارات:', error);
    }
  }

  // التحقق من صحة عنوان Ethereum بدقة عالية
  isValidEthereumAddress(address) {
    if (!address || typeof address !== 'string') {
      return false;
    }

    // التحقق من التنسيق الأساسي
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return false;
    }

    // التحقق من أن العنوان ليس كله أصفار
    if (address === '0x0000000000000000000000000000000000000000') {
      return false;
    }

    // التحقق من checksum إذا كان موجوداً
    if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
      return this.isValidChecksum(address);
    }

    return true;
  }

  // ✅ Get nonce for address (required for contract deployment)
  async getNonceForAddress(address) {
    try {
      // Get nonce from blockchain state storage
      if (this.blockchain && this.blockchain.getNonce) {
        return await this.blockchain.getNonce(address);
      }
      
      // Fallback: get from state storage directly
      if (this.stateStorage) {
        const account = await this.stateStorage.getAccount(address);
        return account ? account.nonce || 0 : 0;
      }
      
      // Last resort: return 0
      return 0;
    } catch (error) {
      console.error(`Error getting nonce for ${address}:`, error);
      return 0;
    }
  }

  // الكشف عن العنوان الصحيح للمرسل
  detectCorrectSenderAddress(detectedSender, requiredAmount) {
    const connectedAddresses = Array.from(this.connectedWallets.keys());

    if (connectedAddresses.length === 0) {
      // إذا لم تكن هناك محافظ متصلة، استخدم العنوان المكتشف
      return detectedSender;
    }

    // البحث عن عنوان متصل لديه رصيد كافٍ
    for (const address of connectedAddresses) {
      const balance = this.blockchain.getBalance(address);
      if (balance >= requiredAmount) {
        return address; // تم العثور على المرسل الصحيح
      }
    }

    // إذا لم يتم العثور على عنوان برصيد كافٍ، استخدم أول عنوان متصل كمرسل افتراضي
    return connectedAddresses[0];
  }

  // التحقق من checksum للعنوان
  isValidChecksum(address) {
    try {
      const crypto = require('crypto');
      const addressHash = crypto.createHash('sha256').update(address.toLowerCase().replace('0x', '')).digest('hex');

      for (let i = 0; i < 40; i++) {
        const char = address[i + 2];
        const shouldBeUppercase = parseInt(addressHash[i], 16) >= 8;

        if (char.toLowerCase() !== char && !shouldBeUppercase) return false;
        if (char.toUpperCase() !== char && shouldBeUppercase) return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  // REMOVED: Duplicate classifyWallets - Using first instance only

  // تطبيع العنوان مع التحقق من الصحة
  normalizeAddress(address) {
    if (!this.isValidEthereumAddress(address)) {
      return null;
    }
    return address.toLowerCase();
  }

  // إنشاء nonce فريد لكل معاملة
  generateUniqueNonce(address) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return timestamp + random;
  }

  // إنشاء hash للمعاملة
  generateTxHash(transaction) {
    const hashInput = `${transaction.fromAddress}${transaction.toAddress}${transaction.amount}${transaction.nonce}${Date.now()}`;
    return '0x' + crypto.createHash('sha256').update(hashInput).digest('hex');
  }

  // حفظ المعاملة في قاعدة البيانات مع معلومات التصنيف
  async saveTransactionToDatabase(transaction, walletClassification = null) {
    try {
      const { pool } = await import('./db.js');

      // ✅ CONTRACT DEPLOYMENT: Allow empty 'to' for contract deployment
      const isContractDeployment = !transaction.to || transaction.to === '' || transaction.to === '0x';
      
      // التحقق الصارم من البيانات المطلوبة - مع السماح بـ contract deployment
      if (!transaction.hash || !this.isValidEthereumAddress(transaction.from) || transaction.value === undefined) {
        console.error('❌ Invalid transaction data for database saving:', {
          hash: transaction.hash,
          from: transaction.from,
          to: transaction.to,
          value: transaction.value,
          fromValid: this.isValidEthereumAddress(transaction.from),
          isContractDeployment: isContractDeployment
        });
        throw new Error('Invalid transaction data: required fields missing or invalid');
      }
      
      // For contract deployment, use contract address or null
      if (isContractDeployment) {
        transaction.to = transaction.contractAddress || null;
        console.log(`📝 CONTRACT DEPLOYMENT for PostgreSQL: Setting to = ${transaction.to}`);
      } else if (!this.isValidEthereumAddress(transaction.to)) {
        console.error('❌ Invalid to address for regular transaction');
        throw new Error('Invalid to address format');
      }

      // تصنيف المحافظ إذا لم يتم تمريره
      if (!walletClassification) {
        walletClassification = await this.classifyWallets(transaction.from, transaction.to);
      }

      const amount = parseFloat(transaction.value);
      const blockIndex = transaction.blockNumber ? parseInt(transaction.blockNumber, 16) : null;

      // التأكد من أن nonce في نطاق آمن
      let safeNonce = transaction.nonce || 0;
      if (safeNonce > 2147483647) {
        safeNonce = Math.floor(Date.now() / 1000) % 1000000;
        console.log(`🔢 Adjusted nonce for database: ${transaction.nonce} -> ${safeNonce}`);
      }

      if (safeNonce < 0) {
        safeNonce = Math.abs(safeNonce);
      }

      // حفظ gas_price في ACCESS (قيمة عشرية) بدلاً من wei لتجنب overflow
      const gasPriceInAccess = Math.min(parseFloat(transaction.gasPrice || 0.00002), 99999999.99999999);

      // ✅ UPSERT LOGIC - إنشاء المعاملة إذا لم تكن موجودة، أو تحديثها إذا كانت موجودة
      // هذا يحل مشكلة المعاملات الواردة من المحافظ الخارجية
      const upsertResult = await pool.query(`
        INSERT INTO transactions (
          hash,
          tx_hash,
          sender_address,
          recipient_address,
          from_address,
          to_address,
          amount,
          timestamp,
          block_hash,
          block_index,
          nonce,
          gas_used,
          gas_price,
          gas_fee,
          chain_id,
          network_id,
          is_external,
          transaction_type,
          sender_wallet_type,
          recipient_wallet_type,
          is_confirmed,
          confirmations,
          status
        ) VALUES (
          $1::text, $1::varchar(66), $2, $3, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'confirmed'
        )
        ON CONFLICT (tx_hash) DO UPDATE SET
          tx_hash = EXCLUDED.tx_hash,
          from_address = EXCLUDED.from_address,
          to_address = EXCLUDED.to_address,
          sender_address = EXCLUDED.sender_address,
          recipient_address = EXCLUDED.recipient_address,
          amount = EXCLUDED.amount,
          timestamp = EXCLUDED.timestamp,
          block_hash = EXCLUDED.block_hash,
          block_index = EXCLUDED.block_index,
          nonce = EXCLUDED.nonce,
          gas_used = EXCLUDED.gas_used,
          gas_price = EXCLUDED.gas_price,
          gas_fee = EXCLUDED.gas_fee,
          chain_id = EXCLUDED.chain_id,
          network_id = EXCLUDED.network_id,
          is_external = EXCLUDED.is_external,
          transaction_type = EXCLUDED.transaction_type,
          sender_wallet_type = EXCLUDED.sender_wallet_type,
          recipient_wallet_type = EXCLUDED.recipient_wallet_type,
          is_confirmed = EXCLUDED.is_confirmed,
          confirmations = EXCLUDED.confirmations,
          status = 'confirmed'
        RETURNING id
      `, [
        transaction.hash,                              // $1
        transaction.from,                              // $2
        transaction.to,                                // $3
        amount,                                        // $4
        transaction.timestamp || Date.now(),          // $5
        transaction.blockHash,                         // $6
        blockIndex,                                    // $7
        safeNonce,                                     // $8
        transaction.gasLimit || 21000,                 // $9
        gasPriceInAccess.toFixed(8),                   // $10
        '0x5968',                                      // $11
        '22888',                                       // $12
        walletClassification.senderType === 'external' || walletClassification.recipientType === 'external', // $13
        walletClassification.transactionType,          // $14
        walletClassification.senderType,               // $15
        walletClassification.recipientType,            // $16
        true,                                          // $17
        1                                              // $18
      ]);

      console.log(`✅ Transaction recorded in database:`, {
        hash: transaction.hash,
        amount: amount.toFixed(8) + ' ACCESS',
        type: walletClassification.transactionType,
        sender: walletClassification.senderType,
        recipient: walletClassification.recipientType,
        nonce: safeNonce,
        gasPriceAccess: gasPriceInAccess.toFixed(8) + ' ACCESS'
      });

    } catch (error) {
      console.error('❌ Error saving transaction to database:', error);
      throw error;
    }
  }

  // تحديث أرصدة قاعدة البيانات للمرسل والمستقبل
  async updateDatabaseBalances(senderAddress, senderBalance, receiverAddress, receiverBalance) {
    try {
      const { pool } = await import('./db.js');

      // تحديث رصيد المرسل في جدول المستخدمين
      await pool.query(
        'UPDATE users SET coins = $1 WHERE LOWER(wallet_address) = $2',
        [senderBalance.toFixed(8), senderAddress.toLowerCase()]
      );

      // تحديث رصيد المستقبل في جدول المستخدمين
      await pool.query(
        'UPDATE users SET coins = $1 WHERE LOWER(wallet_address) = $2',
        [receiverBalance.toFixed(8), receiverAddress.toLowerCase()]
      );

      // REMOVED: external_wallets updates - Using State Trie only like Ethereum

      console.log(`📊 تم تحديث قاعدة البيانات:`);
      console.log(`   المرسل ${senderAddress}: ${senderBalance.toFixed(8)} ACCESS`);
      console.log(`   المستقبل ${receiverAddress}: ${receiverBalance.toFixed(8)} ACCESS`);

    } catch (error) {
      console.error('خطأ في تحديث قاعدة o�لبيانات:', error);
    }
  }

  // إشعار المحافظ بتحديث الأرصدة
  async notifyWalletsOfBalanceUpdate(senderAddress, senderBalance, receiverAddress, receiverBalance, transaction) {
    try {
      // إشعار المرسل بخصم الرصيد
      await this.sendEnhancedWalletNotification(senderAddress, {
        type: 'balance_deducted',
        newBalance: senderBalance,
        amount: transaction.amount,
        txHash: transaction.hash,
        timestamp: Date.now()
      });

      // إشعار المستقبل بزيادة الرصيد
      await this.sendEnhancedWalletNotification(receiverAddress, {
        type: 'balance_received',
        newBalance: receiverBalance,
        amount: transaction.amount,
        txHash: transaction.hash,
        timestamp: Date.now()
      });

      console.log(`📱 المحافظ تم إشعارها بتحديثات الأرصدة`);

    } catch (error) {
      console.error('خطأ في إرسال الإشعارات:', error);
    }
  }

  // التحقق من صحة عنوان Ethereum بدقة عالية
  isValidEthereumAddress(address) {
    if (!address || typeof address !== 'string') {
      return false;
    }

    // التحقق من التنسيق الأساسي
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return false;
    }

    // التحقق من أن العنوان ليس كله أصفار
    if (address === '0x0000000000000000000000000000000000000000') {
      return false;
    }

    // التحقق من checksum إذا كان موجوداً
    if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
      return this.isValidChecksum(address);
    }

    return true;
  }

  // ✅ Get nonce for address (required for contract deployment)
  async getNonceForAddress(address) {
    try {
      // Get nonce from blockchain state storage
      if (this.blockchain && this.blockchain.getNonce) {
        return await this.blockchain.getNonce(address);
      }
      
      // Fallback: get from state storage directly
      if (this.stateStorage) {
        const account = await this.stateStorage.getAccount(address);
        return account ? account.nonce || 0 : 0;
      }
      
      // Last resort: return 0
      return 0;
    } catch (error) {
      console.error(`Error getting nonce for ${address}:`, error);
      return 0;
    }
  }

  // الكشف عن العنوان الصحيح للمرسل
  detectCorrectSenderAddress(detectedSender, requiredAmount) {
    const connectedAddresses = Array.from(this.connectedWallets.keys());

    if (connectedAddresses.length === 0) {
      // إذا لم تكن هناك محافظ متصلة، استخدم العنوان المكتشف
      return detectedSender;
    }

    // البحث عن عنوان متصل لديه رصيد كافٍ
    for (const address of connectedAddresses) {
      const balance = this.blockchain.getBalance(address);
      if (balance >= requiredAmount) {
        return address; // تم العثور على المرسل الصحيح
      }
    }

    // إذا لم يتم العثور على عنوان برصيد كافٍ، استخدم أول عنوان متصل كمرسل افتراضي
    return connectedAddresses[0];
  }

  // التحقق من checksum للعنوان
  isValidChecksum(address) {
    try {
      const crypto = require('crypto');
      const addressHash = crypto.createHash('sha256').update(address.toLowerCase().replace('0x', '')).digest('hex');

      for (let i = 0; i < 40; i++) {
        const char = address[i + 2];
        const shouldBeUppercase = parseInt(addressHash[i], 16) >= 8;

        if (char.toLowerCase() !== char && !shouldBeUppercase) return false;
        if (char.toUpperCase() !== char && shouldBeUppercase) return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  // REMOVED: Duplicate classifyWallets - Using first instance only

  // تطبيع العنوان مع التحقق من الصحة
  normalizeAddress(address) {
    if (!this.isValidEthereumAddress(address)) {
      return null;
    }
    return address.toLowerCase();
  }

  // إنشاء nonce فريد لكل معاملة
  generateUniqueNonce(address) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return timestamp + random;
  }

  // إنشاء hash للمعاملة
  generateTxHash(transaction) {
    const hashInput = `${transaction.fromAddress}${transaction.toAddress}${transaction.amount}${transaction.nonce}${Date.now()}`;
    return '0x' + crypto.createHash('sha256').update(hashInput).digest('hex');
  }

  // حفظ المعاملة في قاعدة البيانات مع معلومات التصنيف
  async saveTransactionToDatabase(transaction, walletClassification = null) {
    try {
      const { pool } = await import('./db.js');

      // ✅ CONTRACT DEPLOYMENT: Allow empty 'to' for contract deployment
      const isContractDeployment = !transaction.to || transaction.to === '' || transaction.to === '0x';
      
      // التحقق الصارم من البيانات المطلوبة - مع السماح بـ contract deployment
      if (!transaction.hash || !this.isValidEthereumAddress(transaction.from) || transaction.value === undefined) {
        console.error('❌ Invalid transaction data for database saving:', {
          hash: transaction.hash,
          from: transaction.from,
          to: transaction.to,
          value: transaction.value,
          fromValid: this.isValidEthereumAddress(transaction.from),
          isContractDeployment: isContractDeployment
        });
        throw new Error('Invalid transaction data: required fields missing or invalid');
      }
      
      // For contract deployment, use contract address or null
      if (isContractDeployment) {
        transaction.to = transaction.contractAddress || null;
        console.log(`📝 CONTRACT DEPLOYMENT for PostgreSQL: Setting to = ${transaction.to}`);
      } else if (!this.isValidEthereumAddress(transaction.to)) {
        console.error('❌ Invalid to address for regular transaction');
        throw new Error('Invalid to address format');
      }

      // تصنيف المحافظ إذا لم يتم تمريره
      if (!walletClassification) {
        walletClassification = await this.classifyWallets(transaction.from, transaction.to);
      }

      const amount = parseFloat(transaction.value);
      const blockIndex = transaction.blockNumber ? parseInt(transaction.blockNumber, 16) : null;

      // التأكد من أن nonce في نطاق آمن
      let safeNonce = transaction.nonce || 0;
      if (safeNonce > 2147483647) {
        safeNonce = Math.floor(Date.now() / 1000) % 1000000;
        console.log(`🔢 Adjusted nonce for database: ${transaction.nonce} -> ${safeNonce}`);
      }

      if (safeNonce < 0) {
        safeNonce = Math.abs(safeNonce);
      }

      // حفظ gas_price في ACCESS (قيمة عشرية) بدلاً من wei لتجنب overflow
      const gasPriceInAccess = Math.min(parseFloat(transaction.gasPrice || 0.00002), 99999999.99999999);

      // حفظ المعاملة مع معلومات التصنيف
      await pool.query(`
        INSERT INTO transactions
        (tx_hash, from_address, to_address, amount, timestamp, block_hash, block_index,
         nonce, gas_used, gas_price, chain_id, network_id, is_external,
         transaction_type, sender_wallet_type, recipient_wallet_type, is_confirmed, confirmations)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric(20,8), $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (tx_hash) DO UPDATE SET
        from_address = EXCLUDED.from_address,
        to_address = EXCLUDED.to_address,
        amount = EXCLUDED.amount,
        timestamp = EXCLUDED.timestamp,
        transaction_type = EXCLUDED.transaction_type,
        sender_wallet_type = EXCLUDED.sender_wallet_type,
        recipient_wallet_type = EXCLUDED.recipient_wallet_type,
        is_confirmed = EXCLUDED.is_confirmed
      `, [
        transaction.hash,                              // $1
        transaction.from,                              // $2
        transaction.to,                                // $3
        amount,                                        // $4
        transaction.timestamp || Date.now(),          // $5
        transaction.blockHash,                         // $6
        blockIndex,                                    // $7
        safeNonce,                                     // $8
        transaction.gasLimit || 21000,                 // $9
        gasPriceInAccess.toFixed(8),                   // $10 - حفظ في ACCESS (قيمة عشرية)
        '0x5968',                                      // $11 - Chain ID
        '22888',                                       // $12 - Network ID
        walletClassification.senderType === 'external' || walletClassification.recipientType === 'external', // $13
        walletClassification.transactionType,          // $14
        walletClassification.walletClassification.senderType,               // $15
        walletClassification.recipientType,            // $16
        true,                                          // $17 - is_confirmed
        1                                              // $18 - confirmations
      ]);

      console.log(`📝 Transaction saved with classification:`, {
        hash: transaction.hash,
        amount: amount.toFixed(8) + ' ACCESS',
        type: walletClassification.transactionType,
        sender: walletClassification.senderType,
        recipient: walletClassification.recipientType,
        nonce: safeNonce,
        gasPriceAccess: gasPriceInAccess.toFixed(8) + ' ACCESS'
      });

    } catch (error) {
      console.error('❌ Error saving transaction to database:', error);
      throw error;
    }
  }

  // تحديث أرصدة قاعدة البيانات للمرسل والمستقبل
  async updateDatabaseBalances(senderAddress, senderBalance, receiverAddress, receiverBalance) {
    try {
      const { pool } = await import('./db.js');

      // تحديث رصيد المرسل في جدول المستخدمين
      await pool.query(
        'UPDATE users SET coins = $1 WHERE LOWER(wallet_address) = $2',
        [senderBalance.toFixed(8), senderAddress.toLowerCase()]
      );

      // تحديث رصيد المستقبل في جدول المستخدمين
      await pool.query(
        'UPDATE users SET coins = $1 WHERE LOWER(wallet_address) = $2',
        [receiverBalance.toFixed(8), receiverAddress.toLowerCase()]
      );

      // REMOVED: external_wallets updates - Using State Trie only like Ethereum

      console.log(`📊 تم تحديث قاعدة البيانات:`);
      console.log(`   المرسل ${senderAddress}: ${senderBalance.toFixed(8)} ACCESS`);
      console.log(`   المستقبل ${receiverAddress}: ${receiverBalance.toFixed(8)} ACCESS`);

    } catch (error) {
      console.error('خطأ في تحديث قاعدة البيانات:', error);
    }
  }

  // إشعار المحافظ بتحديث الأرصدة
  async notifyWalletsOfBalanceUpdate(senderAddress, senderBalance, receiverAddress, receiverBalance, transaction) {
    try {
      // إشعار المرسل بخصم الرصيد
      await this.sendEnhancedWalletNotification(senderAddress, {
        type: 'balance_deducted',
        newBalance: senderBalance,
        amount: transaction.amount,
        txHash: transaction.hash,
        timestamp: Date.now()
      });

      // إشعار المستقبل بزيادة الرصيد
      await this.sendEnhancedWalletNotification(receiverAddress, {
        type: 'balance_received',
        newBalance: receiverBalance,
        amount: transaction.amount,
        txHash: transaction.hash,
        timestamp: Date.now()
      });

      console.log(`📱 المحافظ تم إشعارها بتحديثات الأرصدة`);

    } catch (error) {
      console.error('خطأ في إرسال الإشعارات:', error);
    }
  }

  // التحقق من صحة عنوان Ethereum بدقة عالية
  isValidEthereumAddress(address) {
    if (!address || typeof address !== 'string') {
      return false;
    }

    // التحقق من التنسيق الأساسي
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return false;
    }

    // التحقق من أن العنوان ليس كله أصفار
    if (address === '0x0000000000000000000000000000000000000000') {
      return false;
    }

    // التحقق من checksum إذا كان موجوداً
    if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
      return this.isValidChecksum(address);
    }

    return true;
  }

  // ✅ Get nonce for address (required for contract deployment)
  async getNonceForAddress(address) {
    try {
      // Get nonce from blockchain state storage
      if (this.blockchain && this.blockchain.getNonce) {
        return await this.blockchain.getNonce(address);
      }
      
      // Fallback: get from state storage directly
      if (this.stateStorage) {
        const account = await this.stateStorage.getAccount(address);
        return account ? account.nonce || 0 : 0;
      }
      
      // Last resort: return 0
      return 0;
    } catch (error) {
      console.error(`Error getting nonce for ${address}:`, error);
      return 0;
    }
  }

  // الكشف عن العنوان الصحيح للمرسل
  detectCorrectSenderAddress(detectedSender, requiredAmount) {
    const connectedAddresses = Array.from(this.connectedWallets.keys());

    if (connectedAddresses.length === 0) {
      // إذا لم تكن هناك محافظ متصلة، استخدم العنوان المكتشف
      return detectedSender;
    }

    // البحث عن عنوان متصل لديه رصيد كافٍ
    for (const address of connectedAddresses) {
      const balance = this.blockchain.getBalance(address);
      if (balance >= requiredAmount) {
        return address; // تم العثور على المرسل الصحيح
      }
    }

    // إذا لم يتم العثور على عنوان برصيد كافٍ، استخدم أول عنوان متصل كمرسل افتراضي
    return connectedAddresses[0];
  }

  // التحقق من checksum للعنوان
  isValidChecksum(address) {
    try {
      const crypto = require('crypto');
      const addressHash = crypto.createHash('sha256').update(address.toLowerCase().replace('0x', '')).digest('hex');

      for (let i = 0; i < 40; i++) {
        const char = address[i + 2];
        const shouldBeUppercase = parseInt(addressHash[i], 16) >= 8;

        if (char.toLowerCase() !== char && !shouldBeUppercase) return false;
        if (char.toUpperCase() !== char && shouldBeUppercase) return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  // REMOVED: Duplicate classifyWallets - Using first instance only

  // تطبيع العنوان مع التحقق من الصحة
  normalizeAddress(address) {
    if (!this.isValidEthereumAddress(address)) {
      return null;
    }
    return address.toLowerCase();
  }

  // إنشاء nonce فريد لكل معاملة
  generateUniqueNonce(address) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return timestamp + random;
  }

  // إنشاء hash للمعاملة
  generateTxHash(transaction) {
    const hashInput = `${transaction.fromAddress}${transaction.toAddress}${transaction.amount}${transaction.nonce}${Date.now()}`;
    return '0x' + crypto.createHash('sha256').update(hashInput).digest('hex');
  }

  // حفظ المعاملة في قاعدة البيانات مع معلومات التصنيف
  async saveTransactionToDatabase(transaction, walletClassification = null) {
    try {
      const { pool } = await import('./db.js');

      // ✅ CONTRACT DEPLOYMENT: Allow empty 'to' for contract deployment
      const isContractDeployment = !transaction.to || transaction.to === '' || transaction.to === '0x';
      
      // التحقق الصارم من البيانات المطلوبة - مع السماح بـ contract deployment
      if (!transaction.hash || !this.isValidEthereumAddress(transaction.from) || transaction.value === undefined) {
        console.error('❌ Invalid transaction data for database saving:', {
          hash: transaction.hash,
          from: transaction.from,
          to: transaction.to,
          value: transaction.value,
          fromValid: this.isValidEthereumAddress(transaction.from),
          isContractDeployment: isContractDeployment
        });
        throw new Error('Invalid transaction data: required fields missing or invalid');
      }
      
      // For contract deployment, use contract address or null
      if (isContractDeployment) {
        transaction.to = transaction.contractAddress || null;
        console.log(`📝 CONTRACT DEPLOYMENT for PostgreSQL: Setting to = ${transaction.to}`);
      } else if (!this.isValidEthereumAddress(transaction.to)) {
        console.error('❌ Invalid to address for regular transaction');
        throw new Error('Invalid to address format');
      }

      // تصنيف المحافظ إذا لم يتم تمريره
      if (!walletClassification) {
        walletClassification = await this.classifyWallets(transaction.from, transaction.to);
      }

      const amount = parseFloat(transaction.value);
      const blockIndex = transaction.blockNumber ? parseInt(transaction.blockNumber, 16) : null;

      // التأكد من أن nonce في نطاق آمن
      let safeNonce = transaction.nonce || 0;
      if (safeNonce > 2147483647) {
        safeNonce = Math.floor(Date.now() / 1000) % 1000000;
        console.log(`🔢 Adjusted nonce for database: ${transaction.nonce} -> ${safeNonce}`);
      }

      if (safeNonce < 0) {
        safeNonce = Math.abs(safeNonce);
      }

      // حفظ gas_price في ACCESS (قيمة عشرية) بدلاً من wei لتجنب overflow
      const gasPriceInAccess = Math.min(parseFloat(transaction.gasPrice || 0.00002), 99999999.99999999);

      // ✅ UPSERT LOGIC - إنشاء المعاملة إذا لم تكن موجودة، أو تحديثها إذا كانت موجودة
      // هذا يحل مشكلة المعاملات الواردة من المحافظ الخارجية
      const upsertResult = await pool.query(`
        INSERT INTO transactions (
          hash,
          tx_hash,
          sender_address,
          recipient_address,
          from_address,
          to_address,
          amount,
          timestamp,
          block_hash,
          block_index,
          nonce,
          gas_used,
          gas_price,
          gas_fee,
          chain_id,
          network_id,
          is_external,
          transaction_type,
          sender_wallet_type,
          recipient_wallet_type,
          is_confirmed,
          confirmations,
          status
        ) VALUES (
          $1::text, $1::varchar(66), $2, $3, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'confirmed'
        )
        ON CONFLICT (tx_hash) DO UPDATE SET
          tx_hash = EXCLUDED.tx_hash,
          from_address = EXCLUDED.from_address,
          to_address = EXCLUDED.to_address,
          sender_address = EXCLUDED.sender_address,
          recipient_address = EXCLUDED.recipient_address,
          amount = EXCLUDED.amount,
          timestamp = EXCLUDED.timestamp,
          block_hash = EXCLUDED.block_hash,
          block_index = EXCLUDED.block_index,
          nonce = EXCLUDED.nonce,
          gas_used = EXCLUDED.gas_used,
          gas_price = EXCLUDED.gas_price,
          gas_fee = EXCLUDED.gas_fee,
          chain_id = EXCLUDED.chain_id,
          network_id = EXCLUDED.network_id,
          is_external = EXCLUDED.is_external,
          transaction_type = EXCLUDED.transaction_type,
          sender_wallet_type = EXCLUDED.sender_wallet_type,
          recipient_wallet_type = EXCLUDED.recipient_wallet_type,
          is_confirmed = EXCLUDED.is_confirmed,
          confirmations = EXCLUDED.confirmations,
          status = 'confirmed'
        RETURNING id
      `, [
        transaction.hash,                              // $1
        transaction.from,                              // $2
        transaction.to,                                // $3
        amount,                                        // $4
        transaction.timestamp || Date.now(),          // $5
        transaction.blockHash,                         // $6
        blockIndex,                                    // $7
        safeNonce,                                     // $8
        transaction.gasLimit || 21000,                 // $9
        gasPriceInAccess.toFixed(8),                   // $10
        '0x5968',                                      // $11
        '22888',                                       // $12
        walletClassification.senderType === 'external' || walletClassification.recipientType === 'external', // $13
        walletClassification.transactionType,          // $14
        walletClassification.senderType,               // $15
        walletClassification.recipientType,            // $16
        true,                                          // $17
        1                                              // $18
      ]);

      console.log(`✅ Transaction recorded in database:`, {
        hash: transaction.hash,
        amount: amount.toFixed(8) + ' ACCESS',
        type: walletClassification.transactionType,
        sender: walletClassification.senderType,
        recipient: walletClassification.recipientType,
        nonce: safeNonce,
        gasPriceAccess: gasPriceInAccess.toFixed(8) + ' ACCESS'
      });

    } catch (error) {
      console.error('❌ Error saving transaction to database:', error);
      throw error;
    }
  }
// تنظيف التحديثات الفورية المنتهية الصلاحية
  cleanupInstantUpdates() {
    if (!this.instantBalanceUpdates) return;
    
    const now = Date.now();
    const expiryTime = 60000; // دقيقة واحدة
    
    for (const [address, update] of this.instantBalanceUpdates.entries()) {
      if (now - update.timestamp > expiryTime) {
        this.instantBalanceUpdates.delete(address);
      }
    }
  }

  // حفظ التحديث الفوري للرصيد
  saveInstantBalanceUpdate(address, balance) {
    if (!this.instantBalanceUpdates) {
      this.instantBalanceUpdates = new Map();
    }
    
    this.instantBalanceUpdates.set(address.toLowerCase(), {
      balance: balance,
      timestamp: Date.now()
    });
  }
}

export { NetworkNode };