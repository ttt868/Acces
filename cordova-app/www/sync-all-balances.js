
// سكريپت مزامنة شاملة للأرصدة باستخدام API الموجود
import fetch from 'node-fetch';

async function syncAllBalances() {
  console.log('🔄 بدء مزامنة شاملة للأرصدة عبر API...');

  try {
    // Use the existing API endpoint instead of direct blockchain access
    const response = await fetch('http://localhost:3000/api/blockchain/sync-all-balances', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (result.success) {
      console.log('\n🎯 نتائج المزامنة من API:');
      console.log(`📊 إجمالي المحافظ: ${result.totalWallets || 'غير محدد'}`);
      console.log(`🔄 تم مزامنة: ${result.syncedWallets || result.syncedCount || 'غير محدد'} محفظة`);
      console.log(`💰 إجمالي الرصيد المزامن: ${result.totalAmount ? result.totalAmount.toFixed(8) : 'غير محدد'} ACCESS`);
      console.log(`✅ المزامنة مكتملة بنجاح`);
    } else {
      console.log(`❌ فشلت المزامنة: ${result.error}`);
    }

    return result;

  } catch (error) {
    console.error('❌ خطأ في مزامنة الأرصدة:', error.message);

    if (error.code === 'ECONNREFUSED') {
      console.log('💡 تأكد من أن الخادم الرئيسي يعمل على المنفذ 3000');
      console.log('💡 يمكنك تشغيل: npm start أو node server.js');
    }

    return {
      success: false,
      error: error.message
    };
  }
}

// تشغيل المزامنة إذا تم استدعاء السكريبت مباشرة
if (import.meta.url === `file://${process.argv[1]}`) {
  syncAllBalances().then(result => {
    console.log('نتيجة المزامنة:', result);
    process.exit(result.success ? 0 : 1);
  }).catch(error => {
    console.error('خطأ:', error);
    process.exit(1);
  });
}

export { syncAllBalances };
