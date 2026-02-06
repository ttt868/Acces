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
      'verify': this.verifyNetwork.bind(this),
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
  
  async showStatus() {
    console.log('📊 Access Network Status');
    console.log('='.repeat(30));
    
    try {
      const chainData = await this.storage.loadChain();
      if (chainData && chainData.length > 0) {
        console.log(`🔗 Total Blocks: ${chainData.length}`);
        console.log(`⏰ Last Block: ${new Date(chainData[chainData.length - 1].timestamp)}`);
      } else {
        console.log('🔍 No blockchain data found');
      }
      
      const stats = await this.storage.getStorageStats();
      console.log(`💾 Storage Used: ${stats?.storageUsed || 'Unknown'}`);
      console.log(`📈 Performance: ${stats?.performance || 'Unknown'}`);
      
    } catch (error) {
      console.error('❌ Error fetching status:', error.message);
    }
  }
  
  async createBackup(args) {
    const filename = args[0] || `access-network-backup-${Date.now()}.json`;
    console.log(`💾 Creating backup: ${filename}`);
    
    try {
      const result = await this.storage.createBackup(filename);
      console.log(`✅ Backup created successfully: ${result.filename}`);
      console.log(`📊 Backed up ${result.blocks} blocks and ${result.transactions} transactions`);
    } catch (error) {
      console.error('❌ Backup failed:', error.message);
    }
  }
  
  async restoreFromBackup(args) {
    const filename = args[0];
    if (!filename) {
      console.error('❌ Please provide backup filename');
      return;
    }
    
    console.log(`🔄 Restoring from backup: ${filename}`);
    
    try {
      const result = await this.storage.restoreFromBackup(filename);
      console.log(`✅ Restore completed successfully`);
      console.log(`📊 Restored ${result.blocks} blocks and ${result.transactions} transactions`);
    } catch (error) {
      console.error('❌ Restore failed:', error.message);
    }
  }
  
  async exportData(args) {
    const format = args[0] || 'json';
    console.log(`📤 Exporting data in ${format} format`);
    
    try {
      const result = await this.storage.exportData(format);
      console.log(`✅ Data exported successfully: ${result.filename}`);
    } catch (error) {
      console.error('❌ Export failed:', error.message);
    }
  }
  
  async cleanup() {
    console.log('🧹 Starting cleanup process...');
    
    try {
      const result = await this.storage.cleanup();
      console.log(`✅ Cleanup completed`);
      console.log(`🗑️ Removed ${result.removedFiles} temporary files`);
      console.log(`💾 Freed ${result.freedSpace} of disk space`);
    } catch (error) {
      console.error('❌ Cleanup failed:', error.message);
    }
  }
  
  async verifyNetwork() {
    console.log('🔍 Verifying network integrity...');
    
    try {
      const result = await this.storage.verifyNetworkIntegrity();
      
      if (result.isValid) {
        console.log('✅ Network integrity verified');
        console.log(`📊 Verified ${result.totalBlocks} blocks`);
      } else {
        console.log('❌ Network integrity check failed');
        console.log(`🚨 Found ${result.errors.length} errors:`);
        result.errors.forEach(error => console.log(`  - ${error}`));
      }
    } catch (error) {
      console.error('❌ Verification failed:', error.message);
    }
  }
  
  showHelp() {
    console.log(`
🚀 Access Network CLI Tool

Usage: node blockchain-cli.js <command> [args]

Commands:
  status                    Show network status
  backup [filename]         Create a backup
  restore <filename>        Restore from backup  
  export [format]           Export data (json, csv)
  cleanup                   Clean temporary files
  verify                    Verify network integrity
  help                      Show this help

Examples:
  node network-cli.js status
  node network-cli.js backup my-backup.json
  node network-cli.js restore my-backup.json
  node network-cli.js export csv
`);
  }
}

// Run the CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new NetworkCLI();
  cli.run();
}

export default NetworkCLI;