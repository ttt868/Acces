
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/blockchain_db',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixBalanceConflicts() {
  console.log('🔄 بدء إصلاح تضارب الأرصدة...');
  
  let client;
  
  try {
    client = await pool.connect();
    console.log('✅ تم الاتصال بقاعدة البيانات');
    
    // 1. فحص المحافظ الخارجية مع التضارب
    console.log('🔍 فحص المحافظ الخارجية...');
    
    const externalWallets = await client.query(`
      SELECT 
        address,
        balance as db_balance,
        (
          SELECT COALESCE(SUM(
            CASE 
              WHEN to_address = LOWER(ew.address) THEN amount::decimal
              WHEN from_address = LOWER(ew.address) THEN -amount::decimal - gas_fee::decimal
              ELSE 0
            END
          ), 0)
          FROM blockchain_transactions bt 
          WHERE (bt.to_address = LOWER(ew.address) OR bt.from_address = LOWER(ew.address))
          AND bt.status = 'confirmed'
        ) as calculated_balance
      FROM external_wallets ew
      WHERE balance > 0
      ORDER BY balance DESC
    `);
    
    console.log(`📊 تم العثور على ${externalWallets.rows.length} محفظة خارجية`);
    
    let conflictsFound = 0;
    let conflictsFixed = 0;
    
    for (const wallet of externalWallets.rows) {
      const dbBalance = parseFloat(wallet.db_balance || 0);
      const calculatedBalance = parseFloat(wallet.calculated_balance || 0);
      const difference = Math.abs(dbBalance - calculatedBalance);
      
      console.log(`\n💰 ${wallet.address}:`);
      console.log(`   قاعدة البيانات: ${dbBalance.toFixed(8)} ACCESS`);
      console.log(`   المحسوب: ${calculatedBalance.toFixed(8)} ACCESS`);
      
      if (difference > 0.00000001) { // تجنب أخطاء الفاصلة العائمة
        conflictsFound++;
        console.log(`   ⚠️ تضارب: فرق ${difference.toFixed(8)} ACCESS`);
        
        // إصلاح الرصيد
        await client.query(`
          UPDATE external_wallets 
          SET balance = $1
          WHERE address = $2
        `, [calculatedBalance.toFixed(8), wallet.address]);
        
        console.log(`   ✅ تم الإصلاح: ${dbBalance.toFixed(8)} → ${calculatedBalance.toFixed(8)} ACCESS`);
        conflictsFixed++;
      } else {
        console.log(`   ✅ متزامن`);
      }
    }
    
    // 2. فحص أرصدة المستخدمين
    console.log('\n👤 فحص أرصدة المستخدمين...');
    
    const users = await client.query(`
      SELECT 
        email,
        wallet_address,
        coins as user_balance,
        (
          SELECT balance 
          FROM external_wallets ew 
          WHERE LOWER(ew.address) = LOWER(u.wallet_address)
          LIMIT 1
        ) as wallet_balance
      FROM users u
      WHERE wallet_address IS NOT NULL AND coins::decimal > 0
      ORDER BY coins::decimal DESC
    `);
    
    console.log(`📊 تم العثور على ${users.rows.length} مستخدم`);
    
    let userConflicts = 0;
    let userConflictsFixed = 0;
    
    for (const user of users.rows) {
      const userBalance = parseFloat(user.user_balance || 0);
      const walletBalance = parseFloat(user.wallet_balance || 0);
      const difference = Math.abs(userBalance - walletBalance);
      
      console.log(`\n👤 ${user.email}:`);
      console.log(`   رصيد المستخدم: ${userBalance.toFixed(8)} ACCESS`);
      console.log(`   رصيد المحفظة: ${walletBalance.toFixed(8)} ACCESS`);
      
      if (difference > 0.00000001) {
        userConflicts++;
        console.log(`   ⚠️ تضارب: فرق ${difference.toFixed(8)} ACCESS`);
        
        // استخدام رصيد المحفظة كمرجع (لأنه محسوب من المعاملات)
        await client.query(`
          UPDATE users 
          SET coins = $1
          WHERE wallet_address = $2
        `, [walletBalance.toFixed(8), user.wallet_address]);
        
        console.log(`   ✅ تم الإصلاح: ${userBalance.toFixed(8)} → ${walletBalance.toFixed(8)} ACCESS`);
        userConflictsFixed++;
      } else {
        console.log(`   ✅ متزامن`);
      }
    }
    
    // 3. فحص المعاملات المعلقة التي قد تسبب تضارب
    console.log('\n🔄 فحص المعاملات المعلقة...');
    
    const pendingTransactions = await client.query(`
      SELECT 
        hash,
        from_address,
        to_address,
        amount,
        gas_fee,
        status,
        created_at
      FROM blockchain_transactions 
      WHERE status = 'pending' 
      AND created_at < NOW() - INTERVAL '10 minutes'
      ORDER BY created_at DESC
    `);
    
    if (pendingTransactions.rows.length > 0) {
      console.log(`⚠️ تم العثور على ${pendingTransactions.rows.length} معاملة معلقة قديمة`);
      
      for (const tx of pendingTransactions.rows) {
        console.log(`   📝 ${tx.hash.substring(0, 10)}... - ${tx.amount} ACCESS (${tx.status})`);
      }
      
      // إزالة المعاملات المعلقة القديمة
      const cleanupResult = await client.query(`
        DELETE FROM blockchain_transactions 
        WHERE status = 'pending' 
        AND created_at < NOW() - INTERVAL '10 minutes'
      `);
      
      console.log(`🗑️ تم حذف ${cleanupResult.rowCount} معاملة معلقة قديمة`);
    } else {
      console.log(`✅ لا توجد معاملات معلقة قديمة`);
    }
    
    // 4. إحصائيات نهائية
    console.log('\n📊 ملخص الإصلاحات:');
    console.log(`   المحافظ الخارجية: ${conflictsFixed}/${conflictsFound} تم إصلاحها`);
    console.log(`   أرصدة المستخدمين: ${userConflictsFixed}/${userConflicts} تم إصلاحها`);
    console.log(`   المعاملات المعلقة: ${pendingTransactions.rows.length} تم حذفها`);
    
    if (conflictsFound === 0 && userConflicts === 0 && pendingTransactions.rows.length === 0) {
      console.log('🎉 جميع الأرصدة متزامنة بشكل صحيح!');
    } else {
      console.log('✅ تم إصلاح جميع التضاربات الموجودة');
    }
    
  } catch (error) {
    console.error('❌ خطأ في إصلاح التضاربات:', error);
    throw error;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

// تشغيل الإصلاح
fixBalanceConflicts()
  .then(() => {
    console.log('✅ اكتمل إصلاح تضارب الأرصدة');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ فشل في إصلاح التضاربات:', error);
    process.exit(1);
  });
