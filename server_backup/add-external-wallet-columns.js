import { pool } from './db.js';

async function addExternalWalletColumns() {
  try {
    console.log('🔧 إضافة أعمدة محسنة لجدول المحافظ الخارجية...');

    // إضافة أعمدة جديدة للمحافظ الخارجية
    await pool.query(`
      ALTER TABLE external_wallets 
      ADD COLUMN IF NOT EXISTS balance DECIMAL(20, 8) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_transaction VARCHAR(64),
      ADD COLUMN IF NOT EXISTS transaction_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS wallet_type VARCHAR(50) DEFAULT 'external',
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'
    `);

    // إضافة أعمدة للمعاملات الخارجية
    await pool.query(`
      ALTER TABLE blockchain_transactions 
      ADD COLUMN IF NOT EXISTS gas_used BIGINT DEFAULT 21000,
      ADD COLUMN IF NOT EXISTS gas_price BIGINT DEFAULT 1000000000,
      ADD COLUMN IF NOT EXISTS chain_id VARCHAR(10) DEFAULT '0x5968',
      ADD COLUMN IF NOT EXISTS network_id VARCHAR(10) DEFAULT '22888',
      ADD COLUMN IF NOT EXISTS is_external BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS confirmations INTEGER DEFAULT 1
    `);

    console.log('✅ تم إضافة الأعمدة المحسنة بنجاح');

    // إنشاء فهارس لتحسين الأداء
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_external_wallets_balance ON external_wallets(balance);
      CREATE INDEX IF NOT EXISTS idx_external_wallets_activity ON external_wallets(last_activity);
      CREATE INDEX IF NOT EXISTS idx_blockchain_tx_external ON blockchain_transactions(is_external);
      CREATE INDEX IF NOT EXISTS idx_blockchain_tx_addresses ON blockchain_transactions(from_address, to_address);
    `);

    console.log('📊 تم إنشاء الفهارس لتحسين الأداء');

  } catch (error) {
    console.error('❌ خطأ في إضافة الأعمدة:', error);
  } finally {
    process.exit(0);
  }
}

addExternalWalletColumns();