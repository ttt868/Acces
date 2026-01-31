
import pkg from 'pg';
const { Pool } = pkg;

// إعدادات قاعدة البيانات
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/blockchain_db',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function normalizeAllAddresses() {
  console.log('🔄 بدء النظام الصارم لتوحيد العناوين...');
  
  let client;
  
  try {
    client = await pool.connect();
    console.log('✅ تم الاتصال بقاعدة البيانات');
    
    // 1. توحيد العناوين في external_wallets
    console.log('📝 Phase 1: توحيد العناوين في external_wallets...');
    
    // تحويل جميع العناوين إلى أحرف صغيرة
    const updateResult1 = await client.query(`
      UPDATE external_wallets 
      SET address = LOWER(address) 
      WHERE address IS NOT NULL AND address != LOWER(address)
    `);
    console.log(`✅ تم توحيد ${updateResult1.rowCount} عنوان في external_wallets`);
    
    // دمج العناوين المكررة وجمع أرصدتها
    console.log('🔄 دمج العناوين المكررة في external_wallets...');
    const mergeQuery1 = `
      WITH address_totals AS (
        SELECT 
          LOWER(address) as normalized_address,
          SUM(COALESCE(balance, 0)) as total_balance,
          MIN(id) as keep_id,
          COUNT(*) as duplicate_count
        FROM external_wallets 
        WHERE address IS NOT NULL
        GROUP BY LOWER(address)
        HAVING COUNT(*) > 1
      )
      UPDATE external_wallets 
      SET balance = address_totals.total_balance
      FROM address_totals 
      WHERE external_wallets.id = address_totals.keep_id
    `;
    
    const mergeResult1 = await client.query(mergeQuery1);
    console.log(`✅ تم دمج ${mergeResult1.rowCount} عنوان مكرر في external_wallets`);
    
    // حذف التكرارات
    const deleteQuery1 = `
      DELETE FROM external_wallets 
      WHERE id NOT IN (
        SELECT MIN(id) 
        FROM external_wallets 
        WHERE address IS NOT NULL
        GROUP BY LOWER(address)
      )
    `;
    
    const deleteResult1 = await client.query(deleteQuery1);
    console.log(`🗑️ تم حذف ${deleteResult1.rowCount} تكرار من external_wallets`);
    
    // 2. توحيد العناوين في users
    console.log('👤 Phase 2: توحيد العناوين في users...');
    
    const updateResult2 = await client.query(`
      UPDATE users 
      SET wallet_address = LOWER(wallet_address) 
      WHERE wallet_address IS NOT NULL AND wallet_address != LOWER(wallet_address)
    `);
    console.log(`✅ تم توحيد ${updateResult2.rowCount} عنوان في users`);
    
    // دمج المستخدمين بنفس العنوان (إذا وُجد)
    console.log('🔄 فحص المستخدمين بعناوين مكررة...');
    const duplicateUsers = await client.query(`
      SELECT 
        LOWER(wallet_address) as normalized_address,
        COUNT(*) as user_count,
        STRING_AGG(email, ', ') as emails
      FROM users 
      WHERE wallet_address IS NOT NULL
      GROUP BY LOWER(wallet_address)
      HAVING COUNT(*) > 1
    `);
    
    if (duplicateUsers.rows.length > 0) {
      console.log(`⚠️ تم العثور على ${duplicateUsers.rows.length} عنوان مكرر بين المستخدمين:`);
      duplicateUsers.rows.forEach(row => {
        console.log(`   - ${row.normalized_address}: ${row.user_count} مستخدم (${row.emails})`);
      });
    }
    
    // 3. توحيد العناوين في transactions
    console.log('💸 Phase 3: توحيد العناوين في transactions...');
    
    const updateResult3 = await client.query(`
      UPDATE transactions 
      SET 
        sender_address = LOWER(sender_address),
        recipient_address = LOWER(recipient_address)
      WHERE 
        (sender_address IS NOT NULL AND sender_address != LOWER(sender_address))
        OR 
        (recipient_address IS NOT NULL AND recipient_address != LOWER(recipient_address))
    `);
    console.log(`✅ تم توحيد ${updateResult3.rowCount} عنوان في transactions`);
    
    // 4. توحيد العناوين في blockchain_transactions
    console.log('🔗 Phase 4: توحيد العناوين في blockchain_transactions...');
    
    const updateResult4 = await client.query(`
      UPDATE transactions 
      SET 
        from_address = LOWER(from_address),
        to_address = LOWER(to_address)
      WHERE 
        (from_address IS NOT NULL AND from_address != LOWER(from_address))
        OR 
        (to_address IS NOT NULL AND to_address != LOWER(to_address))
    `);
    console.log(`✅ تم توحيد ${updateResult4.rowCount} عنوان في blockchain_transactions`);
    
    // 5. إنشاء فهارس فريدة لمنع التكرار المستقبلي
    console.log('🔒 Phase 5: إنشاء فهارس فريدة لمنع التكرار...');
    
    try {
      // إنشاء فهرس فريد للعناوين في external_wallets
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_external_wallets_address_unique 
        ON external_wallets(LOWER(address))
        WHERE address IS NOT NULL
      `);
      console.log('✅ تم إنشاء فهرس فريد لـ external_wallets');
      
      // إنشاء فهرس فريد للعناوين في users
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallet_address_unique 
        ON users(LOWER(wallet_address))
        WHERE wallet_address IS NOT NULL
      `);
      console.log('✅ تم إنشاء فهرس فريد لـ users');
      
    } catch (indexError) {
      console.warn('⚠️ تحذير: لم يتم إنشاء بعض الفهارس:', indexError.message);
    }
    
    // 6. إحصائيات نهائية
    console.log('📊 Phase 6: إحصائيات نهائية...');
    
    const stats = await client.query(`
      SELECT 
        'external_wallets' as table_name,
        COUNT(*) as total_addresses,
        COUNT(DISTINCT LOWER(address)) as unique_addresses
      FROM external_wallets 
      WHERE address IS NOT NULL
      
      UNION ALL
      
      SELECT 
        'users' as table_name,
        COUNT(*) as total_addresses,
        COUNT(DISTINCT LOWER(wallet_address)) as unique_addresses
      FROM users 
      WHERE wallet_address IS NOT NULL
    `);
    
    console.log('📈 إحصائيات العناوين بعد التوحيد:');
    stats.rows.forEach(row => {
      console.log(`   ${row.table_name}: ${row.total_addresses} إجمالي، ${row.unique_addresses} فريد`);
    });
    
    console.log('🎉 تم توحيد العناوين بنجاح! العناوين أصبحت موحدة وبدون تكرار.');
    
  } catch (error) {
    console.error('❌ خطأ في توحيد العناوين:', error);
    throw error;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

// تشغيل عملية التوحيد
normalizeAllAddresses()
  .then(() => {
    console.log('✅ عملية توحيد العناوين اكتملت بنجاح');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ فشل في توحيد العناوين:', error);
    process.exit(1);
  });
