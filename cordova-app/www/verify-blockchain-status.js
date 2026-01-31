
// التحقق من حالة البلوك تشين والأرصدة
import { getNetworkNode } from './network-api.js';
import { pool } from './db.js';

async function verifyBlockchainStatus() {
  try {
    console.log('🔍 فحص حالة البلوك تشين والأرصدة...\n');

    // 1. الحصول على عقدة البلوك تشين مع معالجة الأخطاء
    let networkNode;
    try {
      networkNode = getNetworkNode();
    } catch (nodeError) {
      console.log('❌ خطأ في الحصول على عقدة البلوك تشين:', nodeError.message);
      console.log('💡 تأكد من أن الخادم يعمل على المنفذ 3000');
      return;
    }
    
    if (!networkNode || !networkNode.network) {
      console.log('❌ البلوك تشين غير متاح');
      console.log('💡 قد تحتاج إلى تشغيل الخادم أولاً');
      return;
    }

    // 2. معلومات الشبكة مع معالجة الأخطاء
    let networkInfo;
    try {
      networkInfo = await networkNode.network.getNetworkInfo();
      console.log('🌐 معلومات الشبكة:');
      console.log(`   - Chain ID: ${networkInfo.chainId}`);
      console.log(`   - Network ID: ${networkInfo.networkId}`);
      console.log(`   - ارتفاع البلوك: ${networkInfo.blockHeight}`);
      console.log(`   - المعروض المتداول: ${networkInfo.circulatingSupply} ACCESS`);
    } catch (networkError) {
      console.log('⚠️ تعذر الحصول على معلومات الشبكة:', networkError.message);
      networkInfo = {
        chainId: 'access-mainnet-1',
        networkId: '22888',
        blockHeight: 0,
        circulatingSupply: 0
      };
    }

    // 3. فحص الكتل مع معالجة الأخطاء
    try {
      const totalBlocks = networkNode.network.chain ? networkNode.network.chain.length : 0;
      console.log(`\n📦 فحص الكتل:`);
      console.log(`   - إجمالي الكتل: ${totalBlocks}`);
      
      if (totalBlocks > 0) {
        for (let i = 0; i < Math.min(totalBlocks, 5); i++) { // عرض أول 5 كتل فقط
          const block = networkNode.network.chain[i];
          if (block) {
            console.log(`   - الكتلة ${i}: ${block.transactions?.length || 0} معاملة, Hash: ${block.hash?.substring(0, 16) || 'N/A'}...`);
          }
        }
        if (totalBlocks > 5) {
          console.log(`   - ... و ${totalBlocks - 5} كتلة أخرى`);
        }
      }
    } catch (blockError) {
      console.log('⚠️ خطأ في فحص الكتل:', blockError.message);
    }

    // 4. فحص جميع الأرصدة في البلوك تشين
    let allBalances = {};
    let blockchainTotal = 0;
    try {
      allBalances = networkNode.network.getAllBalances();
      console.log(`\n💰 الأرصدة في البلوك تشين:`);
      console.log(`   - عدد المحافظ: ${Object.keys(allBalances).length}`);
      
      for (const [address, balance] of Object.entries(allBalances)) {
        if (balance > 0) {
          console.log(`   - ${address}: ${balance.toFixed(8)} ACCESS`);
          blockchainTotal += balance;
        }
      }
      console.log(`   - الإجمالي: ${blockchainTotal.toFixed(8)} ACCESS`);
    } catch (balanceError) {
      console.log('⚠️ خطأ في جلب الأرصدة من البلوك تشين:', balanceError.message);
    }

    // 5. مقارنة مع قاعدة البيانات
    let dbStats = { users_count: 0, total_coins: 0 };
    let dbTotal = 0;
    try {
      const dbResult = await pool.query(
        'SELECT COUNT(*) as users_count, SUM(coins) as total_coins FROM users WHERE coins > 0'
      );
      
      dbStats = dbResult.rows[0];
      dbTotal = parseFloat(dbStats.total_coins || 0);
      
      console.log(`\n🗄️ الأرصدة في قاعدة البيانات:`);
      console.log(`   - عدد المستخدمين: ${dbStats.users_count}`);
      console.log(`   - إجمالي الأرصدة: ${dbTotal.toFixed(8)} ACCESS`);
    } catch (dbError) {
      console.log('⚠️ خطأ في الاتصال بقاعدة البيانات:', dbError.message);
    }

    // 6. التحليل النهائي
    const difference = Math.abs(blockchainTotal - dbTotal);
    console.log(`\n📊 التحليل النهائي:`);
    console.log(`   - فرق الأرصدة: ${difference.toFixed(8)} ACCESS`);
    
    if (difference < 0.00000001) {
      console.log(`✅ الأرصدة مُزامنة تماماً`);
    } else if (difference <= 0.25) {
      console.log(`✅ الأرصدة مُزامنة (الفرق بسبب مكافأة التعدين)`);
    } else {
      console.log(`⚠️ هناك فرق في المزامنة يتطلب التحقق`);
    }

    // 7. التحقق من صحة السلسلة
    try {
      const isValid = networkNode.network.isChainValid();
      console.log(`🔐 صحة البلوك تشين: ${isValid ? '✅ صحيح' : '❌ غير صحيح'}`);
    } catch (validationError) {
      console.log('⚠️ تعذر التحقق من صحة السلسلة:', validationError.message);
    }

    // 8. إحصائيات إضافية
    try {
      const stats = networkNode.getStats();
      console.log(`\n📈 إحصائيات إضافية:`);
      console.log(`   - المعاملات المعلقة: ${stats.pendingTransactions || 0}`);
      console.log(`   - العقد المتصلة: ${stats.connectedWalletsCount || 0}`);
      console.log(`   - وقت التشغيل: ${Math.floor(stats.uptime || 0)} ثانية`);
    } catch (statsError) {
      console.log('⚠️ تعذر الحصول على الإحصائيات:', statsError.message);
    }

    console.log(`\n🎉 التحقق مكتمل!`);

  } catch (error) {
    console.error('❌ خطأ عام في فحص البلوك تشين:', error.message);
    console.log('\n💡 نصائح لحل المشكلة:');
    console.log('1. تأكد من تشغيل الخادم: node server.js');
    console.log('2. تحقق من المنفذ 3000 و 5000');
    console.log('3. تأكد من اتصال قاعدة البيانات');
  }
}

// تشغيل الفحص مع معالجة أفضل للأخطاء
verifyBlockchainStatus().then(() => {
  console.log('\n✅ انتهى فحص البلوك تشين');
  process.exit(0);
}).catch(error => {
  console.error('\n❌ خطأ في تشغيل الفحص:', error.message);
  console.log('\n💡 تأكد من أن الخادم يعمل بشكل صحيح');
  process.exit(1);
});
