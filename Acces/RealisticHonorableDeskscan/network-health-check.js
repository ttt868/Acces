
// نظام فحص سلامة البلوكتشين المتقدم
import { AccessNetwork } from './network-system.js';
import BlockchainStorageManager from './network-storage-manager.js';

class BlockchainHealthChecker {
  constructor() {
    this.storageManager = new BlockchainStorageManager();
    this.lastHealthCheck = null;
    this.healthScore = 100;
  }

  // فحص شامل لسلامة البلوكتشين
  async performHealthCheck(blockchain) {
    console.log('🔍 بدء فحص سلامة البلوكتشين...');
    
    const healthReport = {
      timestamp: Date.now(),
      totalBlocks: blockchain.chain.length,
      validBlocks: 0,
      invalidBlocks: 0,
      validTransactions: 0,
      invalidTransactions: 0,
      storageHealth: 'unknown',
      balanceIntegrity: 'unknown',
      errors: []
    };

    try {
      // فحص سلامة الكتل
      for (let i = 1; i < blockchain.chain.length; i++) {
        const currentBlock = blockchain.chain[i];
        const previousBlock = blockchain.chain[i - 1];

        try {
          // التحقق من وجود hash أساساً
          if (!currentBlock.hash) {
            healthReport.invalidBlocks++;
            healthReport.errors.push(`Block ${i}: Missing hash`);
          } else if (currentBlock.hash.length !== 64) {
            healthReport.invalidBlocks++;
            healthReport.errors.push(`Block ${i}: Invalid hash length (${currentBlock.hash.length})`);
          } else {
            // اعتبار البلوك صحيح إذا كان له hash بطول صحيح
            healthReport.validBlocks++;
          }

          // فحص المعاملات
          if (currentBlock.transactions && Array.isArray(currentBlock.transactions)) {
            for (const tx of currentBlock.transactions) {
              if (this.isValidTransaction(tx)) {
                healthReport.validTransactions++;
              } else {
                healthReport.invalidTransactions++;
                healthReport.errors.push(`Block ${i}: Invalid transaction ${tx.txId || 'unknown'}`);
              }
            }
          }

        } catch (blockError) {
          healthReport.invalidBlocks++;
          healthReport.errors.push(`Block ${i}: ${blockError.message}`);
        }
      }

      // فحص سلامة التخزين
      healthReport.storageHealth = await this.checkStorageHealth();

      // فحص سلامة الأرصدة
      healthReport.balanceIntegrity = await this.checkBalanceIntegrity(blockchain);

      // حساب نقاط السلامة
      this.healthScore = this.calculateHealthScore(healthReport);

      console.log('✅ فحص السلامة مكتمل:', {
        validBlocks: healthReport.validBlocks,
        invalidBlocks: healthReport.invalidBlocks,
        validTransactions: healthReport.validTransactions,
        invalidTransactions: healthReport.invalidTransactions,
        healthScore: this.healthScore + '%',
        storageHealth: healthReport.storageHealth
      });

      this.lastHealthCheck = healthReport;
      return healthReport;

    } catch (error) {
      console.error('❌ خطأ في فحص السلامة:', error);
      healthReport.errors.push(`Health check error: ${error.message}`);
      return healthReport;
    }
  }

  // التحقق من صحة المعاملة
  isValidTransaction(tx) {
    if (!tx) return false;
    
    // فحص البيانات الأساسية
    if (typeof tx.amount !== 'number' || tx.amount < 0) return false;
    if (!tx.toAddress && !tx.fromAddress) return false;
    
    // فحص تنسيق العناوين
    if (tx.fromAddress && !this.isValidAddress(tx.fromAddress)) return false;
    if (tx.toAddress && !this.isValidAddress(tx.toAddress)) return false;
    
    return true;
  }

  // التحقق من صحة العنوان
  isValidAddress(address) {
    if (!address || typeof address !== 'string') return false;
    if (address === 'genesis' || address === null) return true; // معاملات النظام
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  // فحص سلامة التخزين
  async checkStorageHealth() {
    try {
      const stats = this.storageManager.getStorageStats();
      
      if (stats.professional_leveldb_storage && 
          stats.professional_leveldb_storage.health === 'healthy') {
        return 'excellent';
      } else if (stats.legacy_json_storage && 
                 Object.values(stats.legacy_json_storage).some(file => file.exists)) {
        return 'good';
      } else {
        return 'poor';
      }
    } catch (error) {
      return 'error';
    }
  }

  // فحص سلامة الأرصدة
  async checkBalanceIntegrity(blockchain) {
    try {
      const allBalances = blockchain.getAllBalances();
      const totalSupply = Object.values(allBalances).reduce((sum, balance) => sum + balance, 0);
      
      // التحقق من المنطقية
      if (totalSupply < 0) return 'critical';
      if (totalSupply > 25000000) return 'warning'; // الحد الأقصى
      
      return 'healthy';
    } catch (error) {
      return 'error';
    }
  }

  // حساب نقاط السلامة
  calculateHealthScore(report) {
    let score = 100;
    
    // خصم نقاط للكتل غير الصالحة
    if (report.invalidBlocks > 0) {
      score -= (report.invalidBlocks / report.totalBlocks) * 30;
    }
    
    // خصم نقاط للمعاملات غير الصالحة
    if (report.invalidTransactions > 0) {
      const totalTx = report.validTransactions + report.invalidTransactions;
      score -= (report.invalidTransactions / totalTx) * 20;
    }
    
    // خصم نقاط لمشاكل التخزين
    if (report.storageHealth === 'poor') score -= 20;
    if (report.storageHealth === 'error') score -= 40;
    
    // خصم نقاط لمشاكل الأرصدة
    if (report.balanceIntegrity === 'warning') score -= 10;
    if (report.balanceIntegrity === 'critical') score -= 30;
    
    return Math.max(0, Math.round(score));
  }

  // الحصول على آخر تقرير سلامة
  getLastHealthReport() {
    return this.lastHealthCheck;
  }

  // الحصول على نقاط السلامة الحالية
  getCurrentHealthScore() {
    return this.healthScore;
  }
}

export default BlockchainHealthChecker;
