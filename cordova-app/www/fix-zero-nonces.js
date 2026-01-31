
import { pool } from './db.js';

async function fixZeroNonces() {
  try {
    console.log('🔧 بدء إصلاح المعاملات ذات nonce = 0...');

    // الحصول على جميع المعاملات ذات nonce = 0
    const zeroNonceTransactions = await pool.query(`
      SELECT tx_hash, from_address, timestamp, block_index
      FROM transactions 
      WHERE nonce = 0 
      ORDER BY from_address, timestamp ASC
    `);

    console.log(`📊 تم العثور على ${zeroNonceTransactions.rows.length} معاملة بـ nonce = 0`);

    // تجميع المعاملات حسب العنوان
    const addressGroups = {};
    for (const tx of zeroNonceTransactions.rows) {
      const address = tx.from_address.toLowerCase();
      if (!addressGroups[address]) {
        addressGroups[address] = [];
      }
      addressGroups[address].push(tx);
    }

    let totalFixed = 0;

    // إصلاح nonce لكل عنوان
    for (const [address, transactions] of Object.entries(addressGroups)) {
      console.log(`\n🔄 إصلاح ${transactions.length} معاملة للعنوان ${address}...`);

      // ترتيب المعاملات حسب الوقت
      transactions.sort((a, b) => parseInt(a.timestamp) - parseInt(b.timestamp));

      // تعيين nonce تدريجي
      for (let i = 0; i < transactions.length; i++) {
        const correctNonce = i + 1; // نبدأ من 1 بدلاً من 0
        
        try {
          await pool.query(`
            UPDATE transactions 
            SET nonce = $1 
            WHERE tx_hash = $2
          `, [correctNonce, transactions[i].tx_hash]);

          console.log(`  ✅ تم إصلاح ${transactions[i].tx_hash}: nonce 0 → ${correctNonce}`);
          totalFixed++;
        } catch (updateError) {
          console.error(`  ❌ فشل في إصلاح ${transactions[i].tx_hash}:`, updateError.message);
        }
      }
    }

    // إنشاء جدول تتبع nonce
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nonce_tracker (
        id SERIAL PRIMARY KEY,
        address VARCHAR(42) NOT NULL,
        nonce BIGINT NOT NULL,
        tx_hash VARCHAR(66),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(address, nonce)
      )
    `);

    // ملء جدول تتبع nonce من البيانات الموجودة
    const allTransactions = await pool.query(`
      SELECT from_address, nonce, tx_hash 
      FROM transactions 
      WHERE nonce > 0 
      ORDER BY from_address, nonce
    `);

    for (const tx of allTransactions.rows) {
      try {
        await pool.query(`
          INSERT INTO nonce_tracker (address, nonce, tx_hash)
          VALUES ($1, $2, $3)
          ON CONFLICT (address, nonce) DO NOTHING
        `, [tx.from_address.toLowerCase(), tx.nonce, tx.tx_hash]);
      } catch (insertError) {
        // تجاهل الأخطاء المكررة
      }
    }

    console.log(`\n✅ تم إصلاح ${totalFixed} معاملة بنجاح`);
    console.log(`📊 تم إنشاء جدول nonce_tracker مع ${allTransactions.rows.length} سجل`);
    console.log('🎯 الآن سيتم حفظ nonce بشكل دائم لجميع المعاملات الجديدة');

  } catch (error) {
    console.error('❌ خطأ في إصلاح nonce:', error);
  } finally {
    process.exit(0);
  }
}

// تشغيل السكريبت
fixZeroNonces();
