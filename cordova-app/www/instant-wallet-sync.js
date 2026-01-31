// نظام المزامنة الفورية للمحافظ الخارجية
import { EventEmitter } from 'events';

class InstantWalletSync extends EventEmitter {
  constructor(blockchain) {
    super();
    this.blockchain = blockchain;
    this.walletConnections = new Map();
    this.subscriptions = new Map();
    this.syncInterval = 10; // ⚡ 10ms - أسرع 5 مرات من قبل
    this.trustWalletOptimizations = true;
    this.forceRefreshQueue = new Set();
    this.trackedWallets = new Set();
    this.lastBalanceMap = new Map(); // لتتبع التغييرات
    this.setupInstantSync();
  }

  setupInstantSync() {
    // ⚡ ETHEREUM-STYLE: مزامنة فائقة السرعة كل 10ms
    setInterval(() => {
      this.syncAllWalletsEnhanced();
      this.processForceRefreshQueue();
    }, this.syncInterval);

    // ⚡ Trust Wallet مزامنة كل 50ms
    setInterval(() => {
      this.trustWalletSpecialSync();
    }, 50);

    // استمع لأحداث البلوك تشين
    this.blockchain.on('transaction', (tx) => {
      this.handleTransactionInstant(tx);
    });

    this.blockchain.on('blockMined', (block) => {
      this.handleBlockMined(block);
    });

    // رسالة صامتة في الإنتاج
    if (process.env.NODE_ENV !== 'production') {
      // Enhanced sync initialized silently
    }
  }

  // 🚀 الاستماع لأحداث Optimistic Balance Manager
  setupOptimisticBalanceListeners() {
    // عند تسجيل معاملة معلقة - إشعار فوري
    optimisticBalanceManager.on('optimistic_update', (data) => {
      this.broadcastOptimisticUpdate(data);
    });

    // عند تأكيد المعاملة
    optimisticBalanceManager.on('transaction_confirmed', (data) => {
      this.broadcastTransactionConfirmed(data);
    });

    // عند إلغاء المعاملة (فشل)
    optimisticBalanceManager.on('transaction_reverted', (data) => {
      this.broadcastTransactionReverted(data);
    });

    // عند تحديث الرصيد
    optimisticBalanceManager.on('balance_update', (data) => {
      this.broadcastBalanceUpdate(data);
    });

    console.log('🔗 Optimistic Balance Manager listeners connected');
  }

  // 📡 بث تحديث optimistic للمحافظ المتصلة
  async broadcastOptimisticUpdate(data) {
    const { from, to, amount, gasFee, txHash } = data;
    
    // تحديث المرسل فوراً
    await this.sendInstantBalanceUpdate(from, 'pending_deduction', txHash);
    
    // تحديث المستقبل فوراً
    await this.sendInstantBalanceUpdate(to, 'pending_credit', txHash);
    
    console.log(`⚡ OPTIMISTIC UPDATE broadcasted: ${from} → ${to} (${amount} ACCESS)`);
  }

  // 📡 بث تأكيد المعاملة
  async broadcastTransactionConfirmed(data) {
    const { from, to, txHash } = data;
    
    await this.sendInstantBalanceUpdate(from, 'transaction_confirmed', txHash);
    await this.sendInstantBalanceUpdate(to, 'transaction_confirmed', txHash);
    
    console.log(`✅ Transaction confirmed broadcasted: ${txHash.substring(0, 10)}...`);
  }

  // 📡 بث إلغاء المعاملة
  async broadcastTransactionReverted(data) {
    const { from, to, txHash } = data;
    
    await this.sendInstantBalanceUpdate(from, 'transaction_reverted', txHash);
    await this.sendInstantBalanceUpdate(to, 'transaction_reverted', txHash);
    
    console.log(`🔄 Transaction reverted broadcasted: ${txHash.substring(0, 10)}...`);
  }

  // 📡 بث تحديث الرصيد
  async broadcastBalanceUpdate(data) {
    const { address, optimisticDelta } = data;
    await this.sendInstantBalanceUpdate(address, 'balance_changed', null);
  }

  // 🚀 إرسال تحديث فوري للرصيد لمحفظة معينة
  async sendInstantBalanceUpdate(address, eventType, txHash) {
    const connection = this.walletConnections.get(address.toLowerCase());
    
    if (connection && connection.readyState === 1) {
      try {
        // ⚡ STATE TRIE ONLY - قراءة مباشرة من State Trie (مثل Ethereum)
        const actualBalance = this.blockchain.getBalance(address);
        
        const balanceHex = '0x' + Math.floor(actualBalance * 1e18).toString(16);
        
        // 🔥 INSTANT NOTIFICATIONS - مثل Ethereum/Binance
        const notifications = [
          // 1. تحديث الرصيد الفوري
          {
            jsonrpc: '2.0',
            method: 'eth_subscription',
            params: {
              subscription: '0xbalance',
              result: {
                address: address,
                balance: balanceHex,
                optimistic: true,
                eventType: eventType,
                txHash: txHash,
                timestamp: Date.now()
              }
            }
          },
          // 2. إشعار accountsChanged (يجبر المحفظة على التحديث)
          {
            jsonrpc: '2.0',
            method: 'accountsChanged',
            params: [[address]],
            _metamask: { isUnlocked: true }
          },
          // 3. إشعار الأصول المتغيرة (Trust Wallet)
          {
            jsonrpc: '2.0',
            method: 'wallet_assetsChanged',
            params: {
              chainId: '0x5968',
              assets: [{
                address: address,
                balance: balanceHex,
                symbol: 'ACCESS',
                decimals: 18,
                optimistic: true
              }]
            }
          },
          // 4. Cache busting للمحافظ
          {
            type: 'instant_balance_update',
            address: address,
            balance: actualBalance.toFixed(8),
            balanceHex: balanceHex,
            actualBalance: actualBalance.toFixed(8),
            eventType: eventType,
            txHash: txHash,
            forceRefresh: true,
            clearCache: true,
            timestamp: Date.now()
          }
        ];

        // إرسال جميع الإشعارات بسرعة فائقة
        for (const notification of notifications) {
          connection.send(JSON.stringify(notification));
          await new Promise(resolve => setTimeout(resolve, 1)); // ⚡ 1ms فقط - فوري
        }

        console.log(`📡 Instant balance update sent to ${address}: ${actualBalance.toFixed(8)} ACCESS (${eventType})`);
      } catch (error) {
        console.error(`Error sending instant update to ${address}:`, error.message);
      }
    }
  }

  // مزامنة فورية عند حدوث معاملة
  async handleTransactionInstant(transaction) {
    // تحديث المرسل فوراً
    if (transaction.from) {
      await this.updateWalletInstant(transaction.from, 'transaction_sent');
    }

    // تحديث المستقبل فوراً
    if (transaction.to) {
      await this.updateWalletInstant(transaction.to, 'transaction_received');
    }
  }

  // تحديث محفظة فوراً
  async updateWalletInstant(address, eventType) {
    const connection = this.walletConnections.get(address.toLowerCase());

    if (connection && connection.readyState === 1) {
      // 🚀 قراءة من network state مباشرة - مثل Ethereum/Solana
      const balance = this.blockchain.getBalance(address);

      // إشعارات فورية متعددة
      const notifications = [
        // إشعار الرصيد
        {
          jsonrpc: '2.0',
          method: 'eth_getBalance',
          params: [address, 'latest'],
          result: '0x' + Math.floor(balance * 1e18).toString(16),
          instant: true
        },
        // إشعار التحديث
        {
          type: 'instant_update',
          event: eventType,
          address: address,
          balance: balance.toFixed(8),
          timestamp: Date.now()
        },
        // إشعار accountsChanged (يجبر تحديث المحفظة)
        {
          jsonrpc: '2.0',
          method: 'accountsChanged',
          params: [address]
        }
      ];

      // إرسال جميع الإشعارات
      for (const notification of notifications) {
        connection.send(JSON.stringify(notification));
        await new Promise(resolve => setTimeout(resolve, 5)); // 5ms فقط
      }
    }
  }

  // 🚀 مزامنة محسنة لجميع المحافظ - مع تحسينات خاصة لـ Trust Wallet
  async syncAllWalletsEnhanced() {
    const syncPromises = [];

    this.walletConnections.forEach((connection, address) => {
      if (connection.readyState === 1) {
        syncPromises.push(this.syncSingleWalletEnhanced(address, connection));
      }
    });

    await Promise.all(syncPromises);
  }

  // 🚀 TRUST WALLET ULTRA-FAST SYNC - مزامنة فائقة السرعة مع Cache Busting
  async trustWalletSpecialSync() {
    if (!this.trustWalletOptimizations) return;

    this.walletConnections.forEach(async (connection, address) => {
      if (connection.readyState === 1) {
        try {
          const balance = this.blockchain.getBalance(address);
          const balanceHex = '0x' + Math.floor(balance * 1e18).toString(16);

          // 🔥 CACHE BUSTING NOTIFICATIONS
          const trustWalletUltraSync = [
            // Clear cache first
            {
              jsonrpc: '2.0',
              method: 'wallet_revokePermissions',
              params: [{ eth_accounts: {} }],
              id: Date.now()
            },
            // Force account change
            {
              jsonrpc: '2.0',
              method: 'wallet_accountsChanged',
              params: [address],
              id: Date.now() + 1
            },
            // Chain changed (forces refresh)
            {
              jsonrpc: '2.0',
              method: 'wallet_chainChanged',
              params: { chainId: '0x5968' },
              id: Date.now() + 2
            },
            // Balance update with cache bypass
            {
              jsonrpc: '2.0',
              method: 'eth_getBalance',
              params: [address, 'latest'],
              result: balanceHex,
              forceUpdate: true,
              bypassCache: true,
              cacheControl: 'no-store'
            },
            // Assets changed event
            {
              jsonrpc: '2.0',
              method: 'wallet_assetsChanged',
              params: {
                address: address,
                assets: [{
                  chainId: '0x5968',
                  balance: balanceHex,
                  symbol: 'ACCESS'
                }]
              }
            },
            // Custom Trust Wallet refresh
            {
              type: 'trustwallet_ultra_refresh',
              method: 'balance_force_update',
              address: address,
              balance: balance.toFixed(8),
              balanceWei: balanceHex,
              timestamp: Date.now(),
              forceRefresh: true,
              clearCache: true
            }
          ];

          // Send all notifications rapidly
          for (const notification of trustWalletUltraSync) {
            connection.send(JSON.stringify(notification));
            await new Promise(resolve => setTimeout(resolve, 10)); // ⚡ 10ms - أسرع
          }
        } catch (error) {
          console.warn('Trust Wallet ultra sync error:', error.message);
        }
      }
    });
  }

  // 🔄 معالجة قائمة التحديث القسري
  async processForceRefreshQueue() {
    if (this.forceRefreshQueue.size === 0) return;

    const addresses = Array.from(this.forceRefreshQueue);
    this.forceRefreshQueue.clear();

    for (const address of addresses) {
      const connection = this.walletConnections.get(address.toLowerCase());
      if (connection && connection.readyState === 1) {
        await this.forceWalletRefresh(address, connection);
      }
    }
  }

  // 🛠️ إجبار تحديث المحفظة - للحالات الحرجة
  async forceWalletRefresh(address, connection) {
    try {
      // 🚀 قراءة من network state مباشرة - مثل Ethereum/Solana
      const balance = this.blockchain.getBalance(address);

      // مجموعة إشعارات قوية لإجبار التحديث
      const forceNotifications = [
        {
          jsonrpc: '2.0',
          method: 'eth_getBalance',
          params: [address, 'latest'],
          result: '0x' + Math.floor(balance * 1e18).toString(16),
          forceRefresh: true
        },
        {
          jsonrpc: '2.0',
          method: 'wallet_switchEthereumChain',
          params: [{
            chainId: '0x5968'
          }]
        },
        {
          type: 'force_balance_refresh',
          address: address,
          balance: balance.toFixed(8),
          action: 'refresh_now',
          timestamp: Date.now()
        }
      ];

      for (const notification of forceNotifications) {
        connection.send(JSON.stringify(notification));
        await new Promise(resolve => setTimeout(resolve, 5)); // 5ms delay
      }

      console.log(`🔥 Force refresh sent for ${address}: ${balance.toFixed(8)} ACCESS`);
    } catch (error) {
      console.error('Force refresh error:', error);
    }
  }

  // 🔧 مزامنة محفظة واحدة محسنة
  async syncSingleWalletEnhanced(address, connection) {
    try {
      // 🚀 قراءة من network state مباشرة - مثل Ethereum/Solana
      const balance = this.blockchain.getBalance(address);

      // إشعارات متعددة للتوافق مع جميع المحافظ
      const syncNotifications = [
        {
          type: 'balance_sync_enhanced',
          address: address,
          balance: balance.toFixed(8),
          balanceHex: '0x' + Math.floor(balance * 1e18).toString(16),
          timestamp: Date.now(),
          chainId: '0x5968',
          optimized: true
        },
        {
          jsonrpc: '2.0',
          method: 'eth_subscription',
          params: {
            subscription: 'balanceUpdate',
            result: {
              address: address,
              balance: '0x' + Math.floor(balance * 1e18).toString(16)
            }
          }
        }
      ];

      for (const notification of syncNotifications) {
        connection.send(JSON.stringify(notification));
      }
    } catch (error) {
      console.error(`Enhanced sync error for ${address}:`, error);
    }
  }

  // مزامنة محفظة واحدة - الطريقة القديمة للتوافق
  async syncSingleWallet(address, connection) {
    try {
      const balance = this.blockchain.getBalance(address);

      connection.send(JSON.stringify({
        type: 'balance_sync',
        address: address,
        balance: balance.toFixed(8),
        balanceHex: '0x' + Math.floor(balance * 1e18).toString(16),
        timestamp: Date.now(),
        chainId: '0x5968'
      }));
    } catch (error) {
      console.error(`Sync error for ${address}:`, error);
    }
  }

  // 🆕 إضافة محفظة للتحديث القسري
  addToForceRefreshQueue(address) {
    this.forceRefreshQueue.add(address.toLowerCase());
    console.log(`📋 Added ${address} to force refresh queue`);
  }

  // تسجيل محفظة للمزامنة الفورية
  registerWallet(address, websocket) {
    this.walletConnections.set(address.toLowerCase(), websocket);
    // Track this wallet for balance updates
    this.trackedWallets.add(address.toLowerCase());

    // إرسال حالة الشبكة فوراً
    websocket.send(JSON.stringify({
      type: 'network_status',
      chainId: '0x5968',
      networkId: '22888',
      status: 'connected',
      syncMode: 'instant_optimistic', // Ethereum-style optimistic updates
      updateInterval: this.syncInterval + 'ms',
      features: {
        optimisticBalance: true,
        instantDeduction: true,
        pendingTransactions: true,
        subscriptions: true
      }
    }));

    // إرسال الرصيد الحالي فوراً
    this.sendInstantBalanceUpdate(address, 'wallet_connected', null);
  }

  // إلغاء تسجيل المحفظة
  unregisterWallet(address) {
    this.walletConnections.delete(address.toLowerCase());
    // Remove from tracked wallets
    this.trackedWallets.delete(address.toLowerCase());
  }

  // 🚀 CRITICAL: إشعار فوري بتحديث الرصيد للمحافظ الخارجية
  async notifyBalanceUpdate(address, newBalance, eventType = 'balance_update') {
    try {
      const normalizedAddress = address.toLowerCase();
      const balanceHex = '0x' + Math.floor(newBalance * 1e18).toString(16);
      
      console.log(`📡 INSTANT BALANCE NOTIFICATION: ${normalizedAddress.slice(0, 10)}... = ${newBalance.toFixed(8)} ACCESS (${eventType})`);
      
      // 1. إشعار المحفظة المتصلة عبر WebSocket (إن وجدت)
      const connection = this.walletConnections.get(normalizedAddress);
      if (connection && connection.readyState === 1) {
        const notifications = [
          // إشعار الرصيد الفوري
          {
            jsonrpc: '2.0',
            method: 'eth_subscription',
            params: {
              subscription: '0xbalance',
              result: {
                address: normalizedAddress,
                balance: balanceHex,
                balanceFormatted: newBalance.toFixed(8) + ' ACCESS',
                eventType: eventType,
                timestamp: Date.now()
              }
            }
          },
          // إشعار تغيير الحسابات (يجبر المحفظة على التحديث)
          {
            jsonrpc: '2.0',
            method: 'accountsChanged',
            params: [normalizedAddress]
          },
          // إشعار تغيير الأصول (Trust Wallet)
          {
            jsonrpc: '2.0',
            method: 'wallet_assetsChanged',
            params: {
              chainId: '0x5968',
              assets: [{
                address: normalizedAddress,
                balance: balanceHex,
                symbol: 'ACCESS',
                decimals: 18
              }]
            }
          }
        ];

        for (const notification of notifications) {
          try {
            connection.send(JSON.stringify(notification));
          } catch (e) {}
        }
      }
      
      // 2. إضافة للقائمة للتحديث القسري
      this.addToForceRefreshQueue(normalizedAddress);
      
      // 3. إرسال حدث لـ NetworkNode للبث عبر جميع القنوات
      this.emit('balanceUpdated', {
        address: normalizedAddress,
        balance: newBalance,
        balanceHex: balanceHex,
        eventType: eventType,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error(`Error in notifyBalanceUpdate for ${address}:`, error.message);
    }
  }

  // معالجة كتلة جديدة تم تعدينها - إشعار فوري لجميع المحافظ
  async handleBlockMinedInstant(block) {
    try {
      console.log(`🔗 معالجة كتلة جديدة: ${block.index} (${block.hash})`);

      // إشعار جميع المحافظ المتصلة بالكتلة الجديدة
      this.walletConnections.forEach(async (connection, address) => {
        if (connection.readyState === 1) {
          const balance = this.blockchain.getBalance(address);

          const blockNotification = {
            jsonrpc: '2.0',
            method: 'eth_subscription',
            params: {
              subscription: 'newBlocks',
              result: {
                number: '0x' + block.index.toString(16),
                hash: block.hash,
                parentHash: block.previousHash,
                timestamp: '0x' + block.timestamp.toString(16)
              }
            }
          };

          const balanceUpdate = {
            type: 'block_mined',
            blockIndex: block.index,
            blockHash: block.hash,
            address: address,
            balance: balance.toFixed(8),
            timestamp: Date.now()
          };

          connection.send(JSON.stringify(blockNotification));
          connection.send(JSON.stringify(balanceUpdate));
        }
      });

      console.log(`✅ تم إشعار ${this.walletConnections.size} محفظة بالكتلة الجديدة`);
    } catch (error) {
      console.error('خطأ في معالجة الكتلة الجديدة:', error);
    }
  }

  // دالة معالجة الكتل المعدنة الجديدة
  handleBlockMined(block) {
    try {

      // تحديث الأرصدة للعناوين المتأثرة
      block.transactions.forEach(tx => {
        if (tx.fromAddress && this.trackedWallets.has(tx.fromAddress)) {
          this.syncWalletBalance(tx.fromAddress);
        }
        if (tx.toAddress && this.trackedWallets.has(tx.toAddress)) {
          this.syncWalletBalance(tx.toAddress);
        }
      });

    } catch (error) {
      console.error('Error handling mined block:', error);
    }
  }

  // Helper function to sync a single wallet's balance
  async syncWalletBalance(address) {
    const connection = this.walletConnections.get(address.toLowerCase());
    if (connection && connection.readyState === 1) {
      try {
        const balance = this.blockchain.getBalance(address);
        connection.send(JSON.stringify({
          type: 'balance_update',
          address: address,
          balance: balance.toFixed(8),
          balanceWei: '0x' + Math.floor(balance * 1e18).toString(16),
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error(`Error syncing balance for ${address}:`, error);
      }
    }
  }
}

export { InstantWalletSync };