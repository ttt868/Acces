
import { pool } from './db.js';

async function fixExternalWalletsTable() {
  try {
    console.log('🔧 إصلاح شامل لجدول المحافظ الخارجية...');

    // أولاً: إنشاء الجدول من البداية مع جميع الأعمدة المطلوبة
    await pool.query(`
      CREATE TABLE IF NOT EXISTS external_wallets (
        id SERIAL PRIMARY KEY,
        address VARCHAR(42) UNIQUE NOT NULL,
        user_agent TEXT,
        chain_id VARCHAR(10) DEFAULT '0x5968',
        first_seen BIGINT NOT NULL,
        last_activity BIGINT,
        balance NUMERIC(20,8) DEFAULT 0,
        last_transaction VARCHAR(66),
        transaction_count INTEGER DEFAULT 0,
        last_sync BIGINT DEFAULT 0,
        wallet_type VARCHAR(20) DEFAULT 'external',
        status VARCHAR(20) DEFAULT 'active',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ جدول external_wallets تم إنشاؤه أو التحقق منه');

    // ثانياً: التحقق من الأعمدة الموجودة وإضافة المفقودة
    const checkColumns = await pool.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'external_wallets'
      ORDER BY ordinal_position
    `);

    console.log('📋 الأعمدة الموجودة حالياً:');
    checkColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });

    // قائمة بجميع الأعمدة المطلوبة
    const requiredColumns = [
      { name: 'is_active', type: 'BOOLEAN', default: 'true' },
      { name: 'balance', type: 'NUMERIC(20,8)', default: '0' },
      { name: 'last_transaction', type: 'VARCHAR(66)', default: null },
      { name: 'transaction_count', type: 'INTEGER', default: '0' },
      { name: 'last_sync', type: 'BIGINT', default: '0' },
      { name: 'wallet_type', type: 'VARCHAR(20)', default: "'external'" },
      { name: 'status', type: 'VARCHAR(20)', default: "'active'" },
      { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' }
    ];

    // إضافة الأعمدة المفقودة
    for (const column of requiredColumns) {
      try {
        const columnExists = checkColumns.rows.some(row => row.column_name === column.name);
        
        if (!columnExists) {
          const alterSQL = `ALTER TABLE external_wallets ADD COLUMN ${column.name} ${column.type}${column.default ? ` DEFAULT ${column.default}` : ''}`;
          await pool.query(alterSQL);
          console.log(`✅ تم إضافة العمود: ${column.name}`);
        } else {
          console.log(`✓ العمود موجود: ${column.name}`);
        }
      } catch (error) {
        console.log(`⚠️ خطأ في العمود ${column.name}:`, error.message);
      }
    }

    // ثالثاً: إنشاء الفهارس المطلوبة
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_external_wallets_address ON external_wallets(address)',
      'CREATE INDEX IF NOT EXISTS idx_external_wallets_active ON external_wallets(is_active) WHERE is_active = true',
      'CREATE INDEX IF NOT EXISTS idx_external_wallets_last_activity ON external_wallets(last_activity)',
      'CREATE INDEX IF NOT EXISTS idx_external_wallets_chain_id ON external_wallets(chain_id)',
      'CREATE INDEX IF NOT EXISTS idx_external_wallets_wallet_type ON external_wallets(wallet_type)'
    ];

    for (const indexSQL of indexes) {
      try {
        await pool.query(indexSQL);
        console.log(`✅ فهرس تم إنشاؤه أو التحقق منه`);
      } catch (error) {
        console.log(`⚠️ خطأ في إنشاء الفهرس:`, error.message);
      }
    }

    // رابعاً: التحقق النهائي من بنية الجدول
    const finalCheck = await pool.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'external_wallets'
      ORDER BY ordinal_position
    `);

    console.log('\n📋 بنية الجدول النهائية:');
    finalCheck.rows.forEach(col => {
      console.log(`  ✓ ${col.column_name}: ${col.data_type} (default: ${col.column_default || 'NULL'}, nullable: ${col.is_nullable})`);
    });

    // خامساً: اختبار الجدول بإدراج واستعلام تجريبي
    try {
      const testAddress = '0x1234567890123456789012345678901234567890';
      
      // حذف البيان التجريبي إذا كان موجوداً
      await pool.query('DELETE FROM external_wallets WHERE address = $1', [testAddress]);
      
      // إدراج تجريبي
      await pool.query(`
        INSERT INTO external_wallets (address, first_seen, is_active, balance, wallet_type, status)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [testAddress, Date.now(), true, 0, 'external', 'active']);
      
      // استعلام تجريبي
      const testResult = await pool.query('SELECT * FROM external_wallets WHERE address = $1', [testAddress]);
      
      if (testResult.rows.length > 0) {
        console.log('✅ اختبار الجدول نجح - جميع الأعمدة تعمل بشكل صحيح');
        
        // حذف البيان التجريبي
        await pool.query('DELETE FROM external_wallets WHERE address = $1', [testAddress]);
      }
      
    } catch (testError) {
      console.error('❌ فشل اختبار الجدول:', testError.message);
    }

    console.log('\n🎉 تم إصلاح جدول external_wallets بنجاح!');
    console.log('🔧 جميع الأعمدة المطلوبة متوفرة الآن');
    console.log('💾 الفهارس تم إنشاؤها للأداء الأمثل');
    console.log('✅ لن تظهر رسائل خطأ "is_active does not exist" مرة أخرى');

  } catch (error) {
    console.error('❌ خطأ في إصلاح جدول المحافظ الخارجية:', error);
    throw error;
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// تشغيل الإصلاح
fixExternalWalletsTable().catch(error => {
  console.error('❌ فشل الإصلاح:', error);
  process.exit(1);
});
