
const { pool } = await import('./db.js');

async function unifyAllAddresses() {
  console.log('🔄 بدء توحيد جميع العناوين في النظام...');
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 1. توحيد العناوين في جدول users
    console.log('📝 Phase 1: توحيد عناوين المستخدمين...');
    const updateUsers = await client.query(`
      UPDATE users 
      SET wallet_address = LOWER(wallet_address) 
      WHERE wallet_address IS NOT NULL AND wallet_address != LOWER(wallet_address)
    `);
    console.log(`✅ تم توحيد ${updateUsers.rowCount} عنوان في جدول users`);
    
    // 2. توحيد العناوين في جدول external_wallets
    console.log('📝 Phase 2: توحيد عناوين المحافظ الخارجية...');
    const updateExternal = await client.query(`
      UPDATE external_wallets 
      SET address = LOWER(address) 
      WHERE address IS NOT NULL AND address != LOWER(address)
    `);
    console.log(`✅ تم توحيد ${updateExternal.rowCount} عنوان في external_wallets`);
    
    // 3. دمج المحافظ الخارجية المكررة
    console.log('🔄 Phase 3: دمج المحافظ الخارجية المكررة...');
    const duplicates = await client.query(`
      SELECT LOWER(address) as unified_address, COUNT(*) as count
      FROM external_wallets 
      GROUP BY LOWER(address)
      HAVING COUNT(*) > 1
    `);
    
    for (const dup of duplicates.rows) {
      const address = dup.unified_address;
      console.log(`🔄 دمج عنوان مكرر: ${address} (${dup.count} نسخ)`);
      
      // احتفظ بأحدث سجل ودمج البيانات
      const keepRecord = await client.query(`
        SELECT id, balance, transaction_count, last_activity 
        FROM external_wallets 
        WHERE LOWER(address) = $1 
        ORDER BY last_activity DESC NULLS LAST, id DESC 
        LIMIT 1
      `, [address]);
      
      if (keepRecord.rows.length > 0) {
        const keep = keepRecord.rows[0];
        
        // جمع إجمالي عدد المعاملات والرصيد
        const totals = await client.query(`
          SELECT 
            SUM(COALESCE(balance, 0)) as total_balance,
            SUM(COALESCE(transaction_count, 0)) as total_transactions,
            MAX(last_activity) as latest_activity
          FROM external_wallets 
          WHERE LOWER(address) = $1
        `, [address]);
        
        const totalData = totals.rows[0];
        
        // تحديث السجل المحتفظ به
        await client.query(`
          UPDATE external_wallets 
          SET 
            balance = $1,
            transaction_count = $2,
            last_activity = $3
          WHERE id = $4
        `, [
          totalData.total_balance || 0,
          totalData.total_transactions || 0,
          totalData.latest_activity || keep.last_activity,
          keep.id
        ]);
        
        // حذف السجلات المكررة
        await client.query(`
          DELETE FROM external_wallets 
          WHERE LOWER(address) = $1 AND id != $2
        `, [address, keep.id]);
        
        console.log(`✅ تم دمج ${address}: رصيد ${totalData.total_balance}, معاملات ${totalData.total_transactions}`);
      }
    }
    
    // 4. توحيد العناوين في جدول transactions
    console.log('📝 Phase 4: توحيد العناوين في المعاملات...');
    const updateTxSender = await client.query(`
      UPDATE transactions 
      SET sender_address = LOWER(sender_address) 
      WHERE sender_address IS NOT NULL AND sender_address != LOWER(sender_address)
    `);
    console.log(`✅ تم توحيد ${updateTxSender.rowCount} عنوان مرسل في المعاملات`);
    
    const updateTxRecipient = await client.query(`
      UPDATE transactions 
      SET recipient_address = LOWER(recipient_address) 
      WHERE recipient_address IS NOT NULL AND recipient_address != LOWER(recipient_address)
    `);
    console.log(`✅ تم توحيد ${updateTxRecipient.rowCount} عنوان مستقبل في المعاملات`);
    
    // 5. التحقق من النتائج النهائية
    console.log('📊 Phase 5: التحقق من النتائج...');
    
    const finalUsers = await client.query(`
      SELECT COUNT(*) as count FROM users WHERE wallet_address IS NOT NULL
    `);
    
    const finalExternal = await client.query(`
      SELECT COUNT(*) as count FROM external_wallets
    `);
    
    const finalTransactions = await client.query(`
      SELECT COUNT(*) as count FROM transactions WHERE sender_address IS NOT NULL OR recipient_address IS NOT NULL
    `);
    
    await client.query('COMMIT');
    
    console.log('✅ توحيد العناوين مكتمل:');
    console.log(`- مستخدمين بمحافظ: ${finalUsers.rows[0].count}`);
    console.log(`- محافظ خارجية: ${finalExternal.rows[0].count}`);
    console.log(`- معاملات: ${finalTransactions.rows[0].count}`);
    console.log('🎯 جميع العناوين الآن موحدة بأحرف صغيرة');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ خطأ في توحيد العناوين:', error);
    throw error;
  } finally {
    client.release();
  }
}

// تشغيل التوحيد
unifyAllAddresses()
  .then(() => {
    console.log('✅ تم توحيد جميع العناوين بنجاح');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ فشل في توحيد العناوين:', error);
    process.exit(1);
  });
