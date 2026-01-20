// نظام Sharding للتعامل مع مليارات المعاملات
class ShardingSystem {
  constructor() {
    this.shards = new Map(); // خريطة الشاردات
    this.shardCount = 64; // 64 شارد للبدء
    this.maxTransactionsPerShard = 1000000; // مليون معاملة لكل شارد
    this.currentShard = 0;

    this.initializeShards();
  }

  // تهيئة الشاردات
  initializeShards() {
    for (let i = 0; i < this.shardCount; i++) {
      this.shards.set(i, {
        id: i,
        transactions: [],
        balances: new Map(),
        blockHeight: 0,
        lastUpdate: Date.now()
      });
    }

    console.log(`🔗 تم تهيئة ${this.shardCount} شارد للمعالجة المتوازية`);
  }

  // تحديد الشارد للمعاملة
  getShardForTransaction(transaction) {
    // استخدام hash العنوان لتوزيع عادل
    const addressHash = this.hashString(transaction.fromAddress + transaction.toAddress);
    return addressHash % this.shardCount;
  }

  // حساب hash للنص
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // تحويل إلى 32bit integer
    }
    return Math.abs(hash);
  }

  // إضافة معاملة إلى الشارد المناسب
  addTransactionToShard(transaction) {
    const shardId = this.getShardForTransaction(transaction);
    const shard = this.shards.get(shardId);

    shard.transactions.push(transaction);
    shard.lastUpdate = Date.now();

    // إنشاء شارد جديد إذا امتلأ الحالي
    if (shard.transactions.length >= this.maxTransactionsPerShard) {
      this.createNewShard();
    }

    return shardId;
  }

  // إنشاء شارد جديد
  createNewShard() {
    const newShardId = this.shardCount;
    this.shards.set(newShardId, {
      id: newShardId,
      transactions: [],
      balances: new Map(),
      blockHeight: 0,
      lastUpdate: Date.now()
    });

    this.shardCount++;
    console.log(`📈 تم إنشاء شارد جديد #${newShardId} - إجمالي الشاردات: ${this.shardCount}`);
  }

  // معالجة جميع الشاردات بالتوازي
  async processAllShards() {
    const shardPromises = Array.from(this.shards.values()).map(shard =>
      this.processShard(shard)
    );

    const results = await Promise.all(shardPromises);

    console.log(`⚡ تمت معالجة ${this.shardCount} شارد بالتوازي`);
    return results;
  }

  // معالجة شارد واحد
  async processShard(shard) {
    if (shard.transactions.length === 0) return;

    const startTime = Date.now();
    let processedCount = 0;

    // معالجة المعاملات في دفعات
    const batchSize = 100;
    for (let i = 0; i < shard.transactions.length; i += batchSize) {
      const batch = shard.transactions.slice(i, i + batchSize);

      for (const tx of batch) {
        // معالجة المعاملة
        this.processShardTransaction(shard, tx);
        processedCount++;
      }
    }

    const processingTime = Date.now() - startTime;
    const tps = Math.round(processedCount / (processingTime / 1000));

    console.log(`✅ شارد #${shard.id}: ${processedCount} معاملة في ${processingTime}ms (${tps} TPS)`);

    return {
      shardId: shard.id,
      processedTransactions: processedCount,
      processingTime: processingTime,
      tps: tps
    };
  }

  // معالجة معاملة في الشارد
  processShardTransaction(shard, transaction) {
    // تحديث الأرصدة في الشارد
    const fromBalance = shard.balances.get(transaction.fromAddress) || 0;
    const toBalance = shard.balances.get(transaction.toAddress) || 0;

    if (fromBalance >= transaction.amount) {
      shard.balances.set(transaction.fromAddress, fromBalance - transaction.amount);
      shard.balances.set(transaction.toAddress, toBalance + transaction.amount);

      transaction.status = 'confirmed';
    } else {
      transaction.status = 'failed';
    }
  }

  // الحصول على إحصائيات الشاردات
  getShardingStats() {
    let totalTransactions = 0;
    let totalShards = this.shards.size;
    let activeShards = 0;

    for (const shard of this.shards.values()) {
      totalTransactions += shard.transactions.length;
      if (shard.transactions.length > 0) {
        activeShards++;
      }
    }

    const avgTransactionsPerShard = Math.round(totalTransactions / totalShards);

    return {
      totalShards: totalShards,
      activeShards: activeShards,
      totalTransactions: totalTransactions,
      avgTransactionsPerShard: avgTransactionsPerShard,
      maxCapacity: totalShards * this.maxTransactionsPerShard,
      utilizationPercentage: Math.round((totalTransactions / (totalShards * this.maxTransactionsPerShard)) * 100)
    };
  }
}

export default ShardingSystem;