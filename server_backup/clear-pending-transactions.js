
// أداة تنظيف المعاملات المعلقة القديمة
import { pool } from './db.js';

async function clearPendingTransactions() {
  try {
    console.log('🧹 بدء تنظيف المعاملات المعلقة القديمة...');
    
    // حذف المعاملات المعلقة القديمة (أكثر من ساعة)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    const result = await pool.query(`
      DELETE FROM blockchain_transactions 
      WHERE is_confirmed = false 
      AND timestamp < $1
    `, [oneHourAgo]);
    
    console.log(`✅ تم حذف ${result.rowCount} معاملة معلقة قديمة`);
    
    // إعادة تعيين nonce للمحافظ النشطة
    const activeWallets = await pool.query(`
      SELECT DISTINCT from_address 
      FROM blockchain_transactions 
      WHERE timestamp > $1
    `, [Date.now() - (24 * 60 * 60 * 1000)]); // آخر 24 ساعة
    
    console.log(`🔄 إعادة تعيين nonce لـ ${activeWallets.rows.length} محفظة نشطة`);
    
    // تنظيف جدول المعاملات الخارجية أيضاً
    await pool.query(`
      DELETE FROM external_wallet_transactions 
      WHERE is_confirmed = false 
      AND timestamp < $1
    `, [oneHourAgo]);
    
    console.log('✅ تنظيف المعاملات المعلقة مكتمل');
    
    return {
      success: true,
      clearedTransactions: result.rowCount,
      activeWallets: activeWallets.rows.length
    };
    
  } catch (error) {
    console.error('❌ خطأ في تنظيف المعاملات المعلقة:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// تشغيل التنظيف
if (import.meta.url === `file://${process.argv[1]}`) {
  clearPendingTransactions()
    .then(result => {
      console.log('نتيجة التنظيف:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('فشل التنظيف:', error);
      process.exit(1);
    });
}

export { clearPendingTransactions };
