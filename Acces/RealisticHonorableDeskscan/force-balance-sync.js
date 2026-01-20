
const { pool } = require('./db.js');

async function forceBalanceSync() {
  console.log('\n🔄 ═══ مزامنة قسرية للأرصدة ═══\n');

  try {
    // جلب جميع المستخدمين النشطين
    const users = await pool.query(
      `SELECT id, email, name, coins, wallet_address 
       FROM users 
       WHERE coins IS NOT NULL 
       ORDER BY id ASC`
    );

    console.log(`📊 سيتم فحص ${users.rows.length} مستخدم`);

    let syncedCount = 0;
    let totalSystemBalance = 0;

    for (const user of users.rows) {
      const currentBalance = parseFloat(user.coins || 0);
      totalSystemBalance += currentBalance;

      console.log(`\n👤 المستخدم ${user.id}: ${user.name || user.email}`);
      console.log(`💰 الرصيد الحالي: ${currentBalance.toFixed(8)} ACCESS`);
      
      if (user.wallet_address) {
        console.log(`🔗 المحفظة: ${user.wallet_address}`);
      }

      // فحص إضافي للمشاكل
      if (currentBalance < 0) {
        console.log('⚠️ رصيد سالب - يحتاج تصحيح');
        
        // تصحيح الرصيد السالب
        await pool.query(
          'UPDATE users SET coins = 0 WHERE id = $1',
          [user.id]
        );
        
        console.log('✅ تم تصحيح الرصيد السالب إلى صفر');
        syncedCount++;
      }

      // فحص المعاملات الحديثة للمستخدم
      const userTransactions = await pool.query(
        'SELECT COUNT(*) as count FROM transactions WHERE sender = $1 OR recipient = $1',
        [user.id]
      );

      const transactionCount = parseInt(userTransactions.rows[0].count || 0);
      console.log(`📄 عدد المعاملات: ${transactionCount}`);

      // تحديث آخر نشاط
      await pool.query(
        'UPDATE users SET last_server_sync = $1 WHERE id = $2',
        [Date.now(), user.id]
      );
    }

    console.log('\n📊 ═══ نتائج المزامنة ═══');
    console.log(`👥 المستخدمين المفحوصين: ${users.rows.length}`);
    console.log(`🔧 المستخدمين المُصححين: ${syncedCount}`);
    console.log(`💰 إجمالي أرصدة النظام: ${totalSystemBalance.toFixed(8)} ACCESS`);

    // فحص صحة قاعدة البيانات
    const dbStats = await pool.query(`
      SELECT 
        COUNT(*) as total_users,
        SUM(coins) as total_balance,
        AVG(coins) as avg_balance,
        MAX(coins) as max_balance,
        MIN(coins) as min_balance
      FROM users 
      WHERE coins IS NOT NULL
    `);

    const stats = dbStats.rows[0];
    console.log('\n📈 ═══ إحصائيات النظام ═══');
    console.log(`👥 إجمالي المستخدمين: ${stats.total_users}`);
    console.log(`💰 إجمالي الأرصدة: ${parseFloat(stats.total_balance || 0).toFixed(8)} ACCESS`);
    console.log(`📊 متوسط الرصيد: ${parseFloat(stats.avg_balance || 0).toFixed(8)} ACCESS`);
    console.log(`📈 أعلى رصيد: ${parseFloat(stats.max_balance || 0).toFixed(8)} ACCESS`);
    console.log(`📉 أقل رصيد: ${parseFloat(stats.min_balance || 0).toFixed(8)} ACCESS`);

    console.log('\n✅ تم اكتمال المزامنة القسرية بنجاح\n');

  } catch (error) {
    console.error('❌ خطأ في المزامنة القسرية:', error.message);
  } finally {
    process.exit(0);
  }
}

// تشغيل المزامنة
console.log('🚀 بدء المزامنة القسرية...');
forceBalanceSync();
