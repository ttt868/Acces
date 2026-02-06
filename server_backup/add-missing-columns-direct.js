
import { pool } from './db.js';

async function addMissingColumnsDirectly() {
  try {
    console.log('🔧 إضافة الأعمدة المفقودة مباشرة إلى جدول transactions...');

    // إضافة العمود from_address
    try {
      await pool.query(`
        ALTER TABLE transactions 
        ADD COLUMN IF NOT EXISTS from_address VARCHAR(42)
      `);
      console.log('✅ تم إضافة العمود from_address');
    } catch (error) {
      console.log('⚠️ العمود from_address موجود مسبقاً أو خطأ:', error.message);
    }

    // إضافة العمود to_address
    try {
      await pool.query(`
        ALTER TABLE transactions 
        ADD COLUMN IF NOT EXISTS to_address VARCHAR(42)
      `);
      console.log('✅ تم إضافة العمود to_address');
    } catch (error) {
      console.log('⚠️ العمود to_address موجود مسبقاً أو خطأ:', error.message);
    }

    // إضافة العمود tx_hash
    try {
      await pool.query(`
        ALTER TABLE transactions 
        ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(66)
      `);
      console.log('✅ تم إضافة العمود tx_hash');
    } catch (error) {
      console.log('⚠️ العمود tx_hash موجود مسبقاً أو خطأ:', error.message);
    }

    // تحديث البيانات الموجودة
    await pool.query(`
      UPDATE transactions 
      SET 
        from_address = COALESCE(from_address, sender_address, sender),
        to_address = COALESCE(to_address, recipient_address, recipient),
        tx_hash = COALESCE(tx_hash, hash)
      WHERE from_address IS NULL OR to_address IS NULL OR tx_hash IS NULL
    `);
    console.log('✅ تم تحديث البيانات الموجودة');

    // التحقق من النتيجة
    const testResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'transactions' 
      AND column_name IN ('from_address', 'to_address', 'tx_hash')
      ORDER BY column_name
    `);

    console.log(`✅ الأعمدة المتاحة الآن: ${testResult.rows.map(r => r.column_name).join(', ')}`);

    return true;
  } catch (error) {
    console.error('❌ خطأ في إضافة الأعمدة:', error);
    return false;
  }
}

// تشغيل السكربت
addMissingColumnsDirectly()
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
