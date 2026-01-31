
import { pool } from './db.js';
import { getNetworkNode } from './network-api.js';

async function checkSyncStatus() {
  try {
    console.log('=== فحص حالة ربط الأرصدة مع البلوك تشين ===\n');
    
    // 1. الحصول على إجمالي الأرصدة من قاعدة البيانات
    const dbResult = await pool.query(
      'SELECT COUNT(*) as users_count, SUM(coins) as total_coins FROM users WHERE coins > 0'
    );
    
    const dbStats = dbResult.rows[0];
    const dbTotal = parseFloat(dbStats.total_coins || 0);
    
    console.log(`📊 أرصدة قاعدة البيانات:`);
    console.log(`   - عدد المستخدمين: ${dbStats.users_count}`);
    console.log(`   - إجمالي الأرصدة: ${dbTotal.toFixed(8)} ACCESS`);
    
    // 2. الحصول على إجمالي الأرصدة من البلوك تشين
    const networkNode = getNetworkNode();
    
    if (networkNode && networkNode.network) {
      const allBalances = networkNode.network.getAllBalances();
      const networkTotal = Object.values(allBalances).reduce((sum, balance) => sum + balance, 0);
      
      console.log(`\n🔗 أرصدة الشبكة:`);
      console.log(`   - عدد المحافظ: ${Object.keys(allBalances).length}`);
      console.log(`   - إجمالي الأرصدة: ${networkTotal.toFixed(8)} ACCESS`);
      
      // 3. مقارنة الأرصدة
      const difference = Math.abs(dbTotal - networkTotal);
      const isSynced = difference < 0.00000001;
      
      console.log(`\n📊 نتيجة المقارنة:`);
      console.log(`   - الفرق: ${difference.toFixed(8)} ACCESS`);
      console.log(`   - حالة المزامنة: ${isSynced ? '✅ مُزامن' : '❌ غير مُزامن'}`);
      
      // 4. معلومات الشبكة
      const networkInfo = blockchainNode.blockchain.getNetworkInfo();
      console.log(`\n🌐 معلومات الشبكة:`);
      console.log(`   - Chain ID: ${networkInfo.chainId}`);
      console.log(`   - Network ID: ${networkInfo.networkId}`);
      console.log(`   - RPC Endpoint: /rpc (same port as main server)`);
      console.log(`   - عدد الكتل: ${networkInfo.blockHeight + 1}`);
      
      return {
        success: true,
        isSynced: isSynced,
        dbTotal: dbTotal,
        networkTotal: networkTotal,
        networkInfo: networkInfo
      };
    } else {
      console.log('❌ البلوك تشين غير متصل');
      return { success: false, error: 'Blockchain not connected' };
    }
    
  } catch (error) {
    console.error('خطأ في فحص حالة المزامنة:', error);
    return { success: false, error: error.message };
  }
}

// تشغيل الفحص
checkSyncStatus()
  .then(result => {
    if (result.success && result.isSynced) {
      console.log('\n🎉 جميع الأرصدة مرتبطة بنجاح مع البلوك تشين!');
    }
    process.exit(0);
  })
  .catch(error => {
    console.error('خطأ:', error);
    process.exit(1);
  });
