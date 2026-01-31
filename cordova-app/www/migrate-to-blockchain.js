
// سكريبت ترحيل الأرصدة إلى البلوكتشين
import { initializeNetwork, migrateBalancesToNetwork } from './network-api.js';

async function runMigration() {
  try {
    console.log('🚀 بدء ترحيل الأرصدة إلى البلوكتشين...');
    
    // تهيئة الشبكة
    const node = initializeNetwork();
    
    // انتظار حتى تكون العقدة جاهزة
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // تشغيل الترحيل
    await migrateBalancesToNetwork();
    
    console.log('✅ اكتمل الترحيل بنجاح');
    
    // عرض معلومات الشبكة
    const networkInfo = node.network.getNetworkInfo();
    console.log('📊 معلومات الشبكة:', networkInfo);
    
    // عرض جميع الأرصدة في الشبكة
    const allBalances = node.network.getAllBalances();
    console.log('💰 جميع الأرصدة في الشبكة:', allBalances);
    
  } catch (error) {
    console.error('❌ خطأ في الترحيل:', error);
  }
}

// تشغيل الترحيل إذا تم استدعاء السكريبت مباشرة
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration();
}

export { runMigration };
