
import { pool } from './db.js';

async function fixPermanentStorageTables() {
  const client = await pool.connect();
  
  try {
    // ✅ Removed verbose logging for performance
    
    // إنشاء جدول permanent_wallet_balances مع العمود المطلوب
    await client.query(`
      CREATE TABLE IF NOT EXISTS permanent_wallet_balances (
        address TEXT PRIMARY KEY,
        balance DECIMAL(20, 8) NOT NULL DEFAULT 0,
        block_number BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        transaction_count INTEGER DEFAULT 0
      )
    `);
    
    // إضافة عمود block_number إذا لم يكن موجوداً
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'permanent_wallet_balances' AND column_name = 'block_number'
        ) THEN
          ALTER TABLE permanent_wallet_balances ADD COLUMN block_number BIGINT NOT NULL DEFAULT 0;
          RAISE NOTICE 'Added block_number column';
        ELSE
          RAISE NOTICE 'block_number column already exists';
        END IF;
      END$$;
    `);
    
    // إنشاء جدول balance_update_history
    await client.query(`
      CREATE TABLE IF NOT EXISTS balance_update_history (
        id SERIAL PRIMARY KEY,
        address TEXT NOT NULL,
        balance DECIMAL(20, 8) NOT NULL,
        block_number BIGINT NOT NULL,
        timestamp BIGINT NOT NULL,
        transaction_type TEXT DEFAULT 'balance_update',
        transaction_hash TEXT,
        gas_used DECIMAL(20, 8) DEFAULT 0
      )
    `);
    
    // إنشاء فهارس
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_balance_history_address 
      ON balance_update_history(address, block_number DESC)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_permanent_wallets_block 
      ON permanent_wallet_balances(block_number DESC)
    `);
    
    // ✅ Removed verbose logging for performance
    
  } catch (error) {
    console.error('❌ خطأ في إصلاح الجداول:', error);
  } finally {
    client.release();
  }
}

// تشغيل الإصلاح
fixPermanentStorageTables()
  .then(() => {
    // ✅ Removed verbose logging for performance
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ فشل الإصلاح:', err);
    process.exit(1);
  });
