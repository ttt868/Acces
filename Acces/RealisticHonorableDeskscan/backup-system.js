// ================================================
// ACCESS NETWORK - BACKUP & RECOVERY SYSTEM
// Built for Web3 wallet protection & data integrity
// ================================================

import { pool } from './db.js';
import fs from 'fs/promises';
import path from 'path';

class BackupSystem {
  constructor() {
    this.backupDir = './backups';
    this.retentionDays = 30; // Keep backups for 30 days
  }

  async initialize() {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
    } catch (error) {
      console.error('❌ Failed to initialize backup system:', error);
    }
  }

  // ✅ BACKUP ALL CRITICAL DATA
  async createFullBackup() {
    const timestamp = Date.now();
    const backupFile = path.join(this.backupDir, `backup_${timestamp}.json`);

    try {
      console.log('🔄 Creating full backup...');

      // Backup all critical tables
      const [users, transactions, wallets, blocks, history] = await Promise.all([
        pool.query('SELECT * FROM users'),
        pool.query('SELECT * FROM transactions ORDER BY timestamp DESC LIMIT 100000'),
        pool.query('SELECT * FROM permanent_wallet_balances'),
        pool.query('SELECT *, parent_hash as previous_hash FROM ethereum_blocks ORDER BY block_index DESC LIMIT 10000'),
        pool.query('SELECT * FROM processing_history ORDER BY timestamp DESC LIMIT 50000')
      ]);

      const backup = {
        timestamp,
        date: new Date(timestamp).toISOString(),
        version: '1.0.0',
        tables: {
          users: users.rows,
          transactions: transactions.rows,
          wallets: wallets.rows,
          blocks: blocks.rows,
          history: history.rows
        },
        stats: {
          totalUsers: users.rows.length,
          totalTransactions: transactions.rows.length,
          totalWallets: wallets.rows.length,
          totalBlocks: blocks.rows.length,
          circulatingSupply: users.rows.reduce((sum, u) => sum + parseFloat(u.coins || 0), 0)
        }
      };

      await fs.writeFile(backupFile, JSON.stringify(backup, null, 2));
      
      console.log(`✅ Full backup created: ${backupFile}`);
      console.log(`📊 Backed up: ${backup.stats.totalUsers} users, ${backup.stats.totalTransactions} transactions`);
      
      // Cleanup old backups
      await this.cleanupOldBackups();

      return { success: true, file: backupFile, stats: backup.stats };
    } catch (error) {
      console.error('❌ Backup failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ✅ BACKUP ONLY WEB3 WALLETS (Critical for user funds)
  async backupWalletsOnly() {
    const timestamp = Date.now();
    const backupFile = path.join(this.backupDir, `wallets_${timestamp}.json`);

    try {
      const walletsData = await pool.query(`
        SELECT 
          u.id, 
          u.email, 
          u.wallet_address, 
          u.coins,
          u.account_created_date,
          p.balance as permanent_balance
        FROM users u
        LEFT JOIN permanent_wallet_balances p ON p.address = u.wallet_address
        WHERE u.wallet_address IS NOT NULL
        ORDER BY u.id
      `);

      const backup = {
        timestamp,
        date: new Date(timestamp).toISOString(),
        type: 'wallets_only',
        wallets: walletsData.rows,
        total: walletsData.rows.length,
        totalBalance: walletsData.rows.reduce((sum, w) => sum + parseFloat(w.coins || 0), 0)
      };

      await fs.writeFile(backupFile, JSON.stringify(backup, null, 2));
      
      console.log(`✅ Wallet backup created: ${backupFile}`);
      console.log(`💰 Protected: ${backup.total} wallets, ${backup.totalBalance.toFixed(8)} ACCESS`);

      return { success: true, file: backupFile, total: backup.total };
    } catch (error) {
      console.error('❌ Wallet backup failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ✅ RESTORE FROM BACKUP
  async restoreFromBackup(backupFile) {
    try {
      console.log(`🔄 Restoring from backup: ${backupFile}`);
      
      const backupData = JSON.parse(await fs.readFile(backupFile, 'utf-8'));
      
      if (!backupData.tables) {
        throw new Error('Invalid backup file format');
      }

      // Begin transaction for atomic restore
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');

        // Restore users (most critical)
        if (backupData.tables.users) {
          for (const user of backupData.tables.users) {
            await client.query(`
              INSERT INTO users (id, email, name, wallet_address, coins, referral_code, account_created_date)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (id) DO UPDATE SET
                coins = EXCLUDED.coins,
                wallet_address = EXCLUDED.wallet_address
            `, [user.id, user.email, user.name, user.wallet_address, user.coins, user.referral_code, user.account_created_date]);
          }
        }

        // Restore wallets
        if (backupData.tables.wallets) {
          for (const wallet of backupData.tables.wallets) {
            await client.query(`
              INSERT INTO permanent_wallet_balances (address, balance, created_at, updated_at)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (address) DO UPDATE SET
                balance = EXCLUDED.balance
            `, [wallet.address, wallet.balance, wallet.created_at, wallet.updated_at]);
          }
        }

        await client.query('COMMIT');
        
        console.log('✅ Restore completed successfully');
        return { success: true, message: 'Data restored' };

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    } catch (error) {
      console.error('❌ Restore failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ✅ EXPORT FOR MIGRATION (To move to new hosting)
  async exportForMigration() {
    const timestamp = Date.now();
    const exportFile = path.join(this.backupDir, `migration_export_${timestamp}.sql`);

    try {
      console.log('🔄 Creating migration export (SQL format)...');

      // Get all data
      const [users, wallets, transactions] = await Promise.all([
        pool.query('SELECT * FROM users'),
        pool.query('SELECT * FROM permanent_wallet_balances'),
        pool.query('SELECT * FROM transactions ORDER BY timestamp DESC LIMIT 100000')
      ]);

      let sql = `-- ACCESS NETWORK MIGRATION EXPORT\n`;
      sql += `-- Generated: ${new Date().toISOString()}\n`;
      sql += `-- Total Users: ${users.rows.length}\n`;
      sql += `-- Total Wallets: ${wallets.rows.length}\n\n`;

      // Users table
      sql += `-- USERS TABLE\n`;
      for (const user of users.rows) {
        sql += `INSERT INTO users (id, email, name, wallet_address, coins, referral_code, account_created_date) VALUES (`;
        sql += `${user.id}, '${user.email}', '${user.name || ''}', '${user.wallet_address || ''}', ${user.coins || 0}, '${user.referral_code}', ${user.account_created_date || 'NULL'});\n`;
      }

      // Wallets table
      sql += `\n-- PERMANENT WALLET BALANCES TABLE\n`;
      for (const wallet of wallets.rows) {
        sql += `INSERT INTO permanent_wallet_balances (address, balance, created_at, updated_at) VALUES (`;
        sql += `'${wallet.address}', ${wallet.balance}, ${wallet.created_at}, ${wallet.updated_at});\n`;
      }

      await fs.writeFile(exportFile, sql);
      
      console.log(`✅ Migration export created: ${exportFile}`);
      console.log(`📦 Ready for migration to new hosting`);

      return { success: true, file: exportFile };

    } catch (error) {
      console.error('❌ Export failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ✅ CLEANUP OLD BACKUPS
  async cleanupOldBackups() {
    try {
      const files = await fs.readdir(this.backupDir);
      const now = Date.now();
      const maxAge = this.retentionDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        const filePath = path.join(this.backupDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
          await fs.unlink(filePath);
        }
      }
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
    }
  }

  // ✅ AUTO-BACKUP SCHEDULER (Every 6 hours)
  startAutoBackup() {
    setInterval(async () => {
      await this.createFullBackup();
      await this.backupWalletsOnly();
    }, 6 * 60 * 60 * 1000); // Every 6 hours
  }
}

// Create singleton instance
export const backupSystem = new BackupSystem();

// Initialize on startup
backupSystem.initialize();

// Start auto-backup
backupSystem.startAutoBackup();

// Export functions
export default backupSystem;
