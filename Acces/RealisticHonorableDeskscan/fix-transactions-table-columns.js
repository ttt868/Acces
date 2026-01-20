
import { pool } from './db.js';

async function fixTransactionsTableColumns() {
  try {
    console.log('🔧 إضافة الأعمدة المفقودة إلى جدول transactions...');

    // Add missing columns to transactions table
    await pool.query(`
      ALTER TABLE transactions 
      ADD COLUMN IF NOT EXISTS from_address VARCHAR(42),
      ADD COLUMN IF NOT EXISTS to_address VARCHAR(42),
      ADD COLUMN IF NOT EXISTS sender_address VARCHAR(42),
      ADD COLUMN IF NOT EXISTS recipient_address VARCHAR(42),
      ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(66),
      ADD COLUMN IF NOT EXISTS block_hash VARCHAR(66),
      ADD COLUMN IF NOT EXISTS block_index INTEGER,
      ADD COLUMN IF NOT EXISTS is_external BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(20) DEFAULT 'transfer',
      ADD COLUMN IF NOT EXISTS chain_id VARCHAR(10) DEFAULT '0x5968',
      ADD COLUMN IF NOT EXISTS network_id VARCHAR(10) DEFAULT '22888',
      ADD COLUMN IF NOT EXISTS gas_used INTEGER DEFAULT 21000,
      ADD COLUMN IF NOT EXISTS gas_price DECIMAL(20,8) DEFAULT 0.00002,
      ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS confirmations INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS input TEXT
    `);

    console.log('✅ تم إضافة الأعمدة المفقودة بنجاح');

    // Update existing data if needed
    await pool.query(`
      UPDATE transactions 
      SET 
        from_address = COALESCE(from_address, sender_address, sender),
        to_address = COALESCE(to_address, recipient_address, recipient),
        tx_hash = COALESCE(tx_hash, hash)
      WHERE from_address IS NULL OR to_address IS NULL OR tx_hash IS NULL
    `);

    console.log('✅ تم تحديث البيانات الموجودة');

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_from_address ON transactions(from_address);
      CREATE INDEX IF NOT EXISTS idx_transactions_to_address ON transactions(to_address);
      CREATE INDEX IF NOT EXISTS idx_transactions_tx_hash ON transactions(tx_hash);
      CREATE INDEX IF NOT EXISTS idx_transactions_block_hash ON transactions(block_hash);
      CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
    `);

    console.log('✅ تم إنشاء الفهارس للأداء المحسن');

    // Test the fix
    const testResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'transactions' 
      AND column_name IN ('from_address', 'to_address', 'tx_hash')
      ORDER BY column_name
    `);

    console.log(`✅ تم التحقق من الأعمدة: ${testResult.rows.map(r => r.column_name).join(', ')}`);

    return true;
  } catch (error) {
    console.error('❌ خطأ في إصلاح جدول transactions:', error);
    return false;
  }
}

// Run the fix
fixTransactionsTableColumns()
  .then(success => {
    if (success) {
      console.log('🎉 تم إصلاح جدول transactions بنجاح');
    } else {
      console.log('❌ فشل في إصلاح جدول transactions');
    }
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('❌ خطأ غير متوقع:', error);
    process.exit(1);
  });

export { fixTransactionsTableColumns };
