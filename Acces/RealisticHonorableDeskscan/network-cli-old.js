
#!/usr/bin/env node

// أداة سطر الأوامر لإدارة الشبكة
import NetworkStorageManager from './network-storage-manager.js';
import { AccessNetwork } from './network-system.js';

class NetworkCLI {
  constructor() {
    this.storage = new NetworkStorageManager();
    this.commands = {
      'status': this.showStatus.bind(this),
      'backup': this.createBackup.bind(this),
      'restore': this.restoreFromBackup.bind(this),
      'export': this.exportData.bind(this),
      'cleanup': this.cleanup.bind(this),
      'verify': this.verifyChain.bind(this),
      'help': this.showHelp.bind(this)
    };
  }
  
  async run() {
    const command = process.argv[2];
    const args = process.argv.slice(3);
    
    if (!command || !this.commands[command]) {
      this.showHelp();
      return;
    }
    
    try {
      await this.commands[command](args);
    } catch (error) {
      console.error('❌ Error:', error.message);
    }
  }
  
  showStatus() {
    console.log('📊 === Blockchain Status ===');
    
    const stats = this.storage.getStorageStats();
    
    Object.entries(stats).forEach(([filename, info]) => {
      if (filename !== 'backups') {
        const status = info.exists ? '✅' : '❌';
        const size = info.exists ? this.formatBytes(info.size) : 'N/A';
        console.log(`${status} ${filename}: ${size}`);
      }
    });
    
    if (stats.backups) {
      console.log(`🗂️ Backups: ${stats.backups.count} files (${this.formatBytes(stats.backups.totalSize)})`);
    }
    
    // محاولة تحميل البلوكتشين
    try {
      const blockchain = new AccessBlockchain();
      console.log(`🔗 Chain Length: ${blockchain.chain.length} blocks`);
      console.log(`💰 Active Balances: ${blockchain.balances.size} accounts`);
      console.log(`⏳ Pending Transactions: ${blockchain.pendingTransactions.length}`);
    } catch (error) {
      console.log('❌ Cannot load blockchain:', error.message);
    }
  }
  
  createBackup(args) {
    const outputPath = args[0] || `./blockchain-backup-${Date.now()}.json`;
    
    if (this.storage.exportData(outputPath)) {
      console.log('✅ Backup created successfully');
    } else {
      console.log('❌ Backup failed');
    }
  }
  
  restoreFromBackup(args) {
    console.log('🔄 Restore functionality will be implemented in next version');
    console.log('For now, manually copy backup files to blockchain-data directory');
  }
  
  exportData(args) {
    const outputPath = args[0] || `./blockchain-export-${Date.now()}.json`;
    this.createBackup([outputPath]);
  }
  
  cleanup() {
    console.log('🧹 Cleaning up old backups...');
    this.storage.cleanupOldBackups();
    console.log('✅ Cleanup completed');
  }
  
  async verifyChain() {
    console.log('🔍 Verifying blockchain integrity...');
    
    try {
      const blockchain = new AccessBlockchain();
      
      if (blockchain.isChainValid()) {
        console.log('✅ Blockchain is valid');
      } else {
        console.log('❌ Blockchain integrity check failed');
      }
      
      // فحص إضافي للأرصدة
      const allBalances = blockchain.getAllBalances();
      const totalSupply = Object.values(allBalances).reduce((sum, balance) => sum + balance, 0);
      
      console.log(`💰 Total Supply: ${totalSupply.toFixed(8)} ACCESS`);
      console.log(`👥 Total Accounts: ${Object.keys(allBalances).length}`);
      
    } catch (error) {
      console.log('❌ Verification failed:', error.message);
    }
  }
  
  showHelp() {
    console.log(`
🔗 Access Blockchain CLI

Usage: node blockchain-cli.js <command> [args]

Commands:
  status    - Show blockchain status and storage info
  backup    - Create a backup of blockchain data
  restore   - Restore from backup (coming soon)
  export    - Export blockchain data to file
  cleanup   - Clean up old backup files
  verify    - Verify blockchain integrity
  help      - Show this help message

Examples:
  node blockchain-cli.js status
  node blockchain-cli.js backup ./my-backup.json
  node blockchain-cli.js verify
  node blockchain-cli.js cleanup
    `);
  }
  
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// تشغيل الأداة
if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new BlockchainCLI();
  cli.run();
}

export default BlockchainCLI;
