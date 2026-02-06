// أداة إدارة تخزين البلوكتشين - Persistent Storage Manager
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ProfessionalBlockchainStorage } from './leveldb-storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class NetworkStorageManager {
  constructor(dataDir = './blockchain-data') {
    this.dataDir = dataDir;
    this.blocksFile = path.join(dataDir, 'blocks.json');
    this.stateFile = path.join(dataDir, 'state.json');
    this.mempoolFile = path.join(dataDir, 'mempool.json');
    this.backupDir = path.join(dataDir, 'backups');

    // تهيئة التخزين الاحترافي
    this.professionalStorage = new ProfessionalBlockchainStorage();
    this.useProfessionalStorage = true;

    this.initializeStorage();
  }

  // إنشاء هيكل التخزين
  initializeStorage() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }

      // Advanced storage system active
    } catch (error) {
      console.error('❌ Error initializing storage:', error);
    }
  }

  // حفظ مع نسخ احتياطية
  saveWithBackup(filename, data) {
    try {
      const fullPath = path.join(this.dataDir, filename);

      // إنشاء نسخة احتياطية إذا كان الملف موجود
      if (fs.existsSync(fullPath)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(this.backupDir, `${filename}.backup.${timestamp}`);
        fs.copyFileSync(fullPath, backupPath);
      }

      // حفظ البيانات الجديدة
      fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));

      return true;
    } catch (error) {
      console.error(`❌ Error saving ${filename}:`, error);
      return false;
    }
  }

  // تحميل مع معالجة الأخطاء
  loadWithRecovery(filename) {
    try {
      const fullPath = path.join(this.dataDir, filename);

      if (!fs.existsSync(fullPath)) {
        console.log(`📋 File ${filename} not found, starting fresh`);
        return null;
      }

      const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

      // التحقق من سلامة البيانات
      if (this.validateData(filename, data)) {
        return data;
      } else {
        console.warn(`⚠️ Data corruption detected in ${filename}, attempting recovery`);
        return this.attemptRecovery(filename);
      }

    } catch (error) {
      console.error(`❌ Error loading ${filename}:`, error);
      return this.attemptRecovery(filename);
    }
  }

  // التحقق من سلامة البيانات
  validateData(filename, data) {
    try {
      if (filename.includes('blocks')) {
        return data.blocks && Array.isArray(data.blocks) && data.metadata;
      } else if (filename.includes('state')) {
        return data.balances && data.metadata;
      } else if (filename.includes('mempool')) {
        return data.transactions && Array.isArray(data.transactions);
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  // محاولة الاسترداد من النسخ الاحتياطية
  attemptRecovery(filename) {
    try {
      const backupFiles = fs.readdirSync(this.backupDir)
        .filter(file => file.startsWith(filename))
        .sort()
        .reverse(); // أحدث نسخة أولاً

      for (const backupFile of backupFiles) {
        try {
          const backupPath = path.join(this.backupDir, backupFile);
          const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

          if (this.validateData(filename, data)) {
            console.log(`🔄 Recovered ${filename} from backup: ${backupFile}`);
            return data;
          }
        } catch (error) {
          console.warn(`⚠️ Backup ${backupFile} is also corrupted`);
        }
      }

      console.error(`❌ No valid backup found for ${filename}`);
      return null;

    } catch (error) {
      console.error(`❌ Error during recovery attempt:`, error);
      return null;
    }
  }

  // تنظيف النسخ الاحتياطية القديمة
  cleanupOldBackups(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 أيام
    try {
      const backupFiles = fs.readdirSync(this.backupDir);
      const now = Date.now();

      let cleaned = 0;

      for (const file of backupFiles) {
        const filePath = path.join(this.backupDir, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`🧹 Cleaned up ${cleaned} old backup files`);
      }

    } catch (error) {
      console.error('❌ Error cleaning up backups:', error);
    }
  }

  // إحصائيات التخزين المتقدمة
  getStorageStats() {
    try {
      // إحصائيات JSON التقليدية
      const legacyStats = {};

      ['blocks.json', 'state.json', 'mempool.json'].forEach(filename => {
        const filePath = path.join(this.dataDir, filename);
        if (fs.existsSync(filePath)) {
          const fileStats = fs.statSync(filePath);
          legacyStats[filename] = {
            size: fileStats.size,
            lastModified: fileStats.mtime,
            exists: true
          };
        } else {
          legacyStats[filename] = { exists: false };
        }
      });

      // حجم النسخ الاحتياطية
      const backupFiles = fs.readdirSync(this.backupDir);
      const totalBackupSize = backupFiles.reduce((total, file) => {
        const filePath = path.join(this.backupDir, file);
        return total + fs.statSync(filePath).size;
      }, 0);

      legacyStats.backups = {
        count: backupFiles.length,
        totalSize: totalBackupSize
      };

      // إحصائيات التخزين الاحترافي
      const professionalStats = this.professionalStorage.getAdvancedStats();

      return {
        legacy_json_storage: legacyStats,
        professional_leveldb_storage: professionalStats,
        storage_comparison: {
          primary_storage: this.useProfessionalStorage ? 'LevelDB-style' : 'JSON files',
          performance_mode: this.useProfessionalStorage ? 'High Performance' : 'Basic',
          scalability: this.useProfessionalStorage ? 'Enterprise Grade' : 'Development',
          data_integrity: this.useProfessionalStorage ? 'WAL + Compaction' : 'File backups'
        }
      };

    } catch (error) {
      console.error('❌ Error getting storage stats:', error);
      return {};
    }
  }

  // حفظ block بالطريقة الاحترافية
  async saveProfessionalBlock(block) {
    if (this.useProfessionalStorage) {
      return await this.professionalStorage.saveBlock(block);
    }
    return false;
  }

  // تحميل البلوكتشين بالطريقة الاحترافية
  async loadProfessionalBlockchain() {
    if (this.useProfessionalStorage) {
      return await this.professionalStorage.loadBlockchain();
    }
    return { blocks: [], accounts: {}, transactions: [] };
  }

  // إغلاق آمن للتخزين الاحترافي
  async closeProfessionalStorage() {
    if (this.useProfessionalStorage) {
      await this.professionalStorage.close();
    }
  }

  // تصدير البيانات
  exportData(outputPath) {
    try {
      const exportData = {
        timestamp: Date.now(),
        version: '1.0',
        blockchain: this.loadWithRecovery('blocks.json'),
        state: this.loadWithRecovery('state.json'),
        mempool: this.loadWithRecovery('mempool.json')
      };

      fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
      console.log(`📤 Blockchain data exported to: ${outputPath}`);

      return true;
    } catch (error) {
      console.error('❌ Error exporting data:', error);
      return false;
    }
  }
}

export default NetworkStorageManager;