
// التحقق من حالة ربط البلوك تشين مع العملات
import { pool } from './db.js';

async function checkBlockchainStatus() {
  try {
    console.log('=== فحص حالة ربط البلوك تشين ===');
    
    // 1. فحص العملات في قاعدة البيانات
    const dbResult = await pool.query(
      'SELECT COUNT(*) as users_count, SUM(coins) as total_coins FROM users WHERE coins > 0'
    );
    
    const dbStats = dbResult.rows[0];
    console.log(`📊 في قاعدة البيانات:`);
    console.log(`   - عدد المستخدمين لديهم عملات: ${dbStats.users_count}`);
    console.log(`   - إجمالي العملات: ${parseFloat(dbStats.total_coins || 0).toFixed(8)}`);
    
    // 2. فحص البلوك تشين
    try {
      const response = await fetch('http://localhost:5000', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const blockchainInfo = await response.json();
        console.log(`\n🔗 في البلوك تشين:`);
        console.log(`   - إجمالي المعروض: ${blockchainInfo.totalSupply || 0}`);
        console.log(`   - المعروض المتداول: ${blockchainInfo.circulatingSupply || 0}`);
        console.log(`   - ارتفاع السلسلة: ${blockchainInfo.blockHeight || 0}`);
        
        // 3. مقارنة الأرقام
        const dbTotal = parseFloat(dbStats.total_coins || 0);
        const blockchainTotal = parseFloat(blockchainInfo.totalSupply || 0);
        
        console.log(`\n📊 المقارنة:`);
        console.log(`   - عملات قاعدة البيانات: ${dbTotal.toFixed(8)}`);
        console.log(`   - عملات البلوك تشين: ${blockchainTotal.toFixed(8)}`);
        
        if (Math.abs(dbTotal - blockchainTotal) < 0.00000001) {
          console.log(`✅ العملات مُزامنة بين قاعدة البيانات والبلوك تشين`);
          console.log(`✅ النظام مرتبط بالبلوك تشين`);
        } else {
          console.log(`❌ العملات غير مُزامنة`);
          console.log(`❌ النظام لم يتم ربطه بالبلوك تشين بعد`);
          console.log(`\n🔧 لربط النظام بالبلوك تشين، قم بتشغيل:`);
          console.log(`   node migrate-balances.js`);
        }
        
      } else {
        console.log(`❌ لا يمكن الوصول لخادم البلوك تشين على المنفذ 5000`);
        console.log(`❌ البلوك تشين غير متصل`);
      }
    } catch (fetchError) {
      console.log(`❌ خطأ في الاتصال بالبلوك تشين:`, fetchError.message);
      console.log(`❌ البلوك تشين غير نشط`);
    }
    
    // 4. فحص جداول البلوك تشين
    try {
      const blockchainTables = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name LIKE '%blockchain%'
      `);
      
      console.log(`\n🗃️ جداول البلوك تشين في قاعدة البيانات:`);
      if (blockchainTables.rows.length > 0) {
        blockchainTables.rows.forEach(table => {
          console.log(`   - ${table.table_name}`);
        });
      } else {
        console.log(`   - لا توجد جداول بلوك تشين`);
      }
      
    } catch (tableError) {
      console.log(`❌ خطأ في فحص جداول البلوك تشين:`, tableError.message);
    }
    
  } catch (error) {
    console.error('خطأ في فحص حالة البلوك تشين:', error);
  }
}

// تشغيل الفحص
checkBlockchainStatus();
