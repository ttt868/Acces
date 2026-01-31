
// إصلاح الأرصدة المستبدلة خطأً
import { pool } from './db.js';
import { AccessNetwork } from './network-system.js';

async function restoreReplacedBalances() {
  try {
    console.log('🔄 بدء استعادة الأرصدة المستبدلة...');
    
    // البحث عن المعاملات التي سببت استبدال الرصيد
    const suspiciousTransactions = await pool.query(`
      SELECT bt.tx_hash, bt.from_address, bt.to_address, bt.amount, bt.timestamp,
             ew_before.balance as balance_before,
             ew_after.balance as balance_after
      FROM blockchain_transactions bt
      LEFT JOIN external_wallets ew_before ON ew_before.address = bt.to_address
      LEFT JOIN external_wallets ew_after ON ew_after.address = bt.to_address
      WHERE bt.timestamp > $1 
      AND bt.to_address LIKE '0x%'
      ORDER BY bt.timestamp DESC
      LIMIT 50
    `, [Date.now() - 86400000]); // آخر 24 ساعة

    console.log(`🔍 فحص ${suspiciousTransactions.rows.length} معاملة...`);

    const blockchain = new AccessNetwork();

    for (const tx of suspiciousTransactions.rows) {
      const toAddress = tx.to_address;
      const amount = parseFloat(tx.amount);
      
      // فحص إذا كان الرصيد تم استبداله بدلاً من الإضافة
      const walletHistory = await pool.query(`
        SELECT balance, last_activity 
        FROM external_wallets 
        WHERE address = $1
        ORDER BY last_activity DESC
        LIMIT 2
      `, [toAddress]);

      if (walletHistory.rows.length >= 2) {
        const currentBalance = parseFloat(walletHistory.rows[0].balance);
        const previousBalance = parseFloat(walletHistory.rows[1].balance);
        
        // إذا كان الرصيد الحالي يساوي المبلغ المرسل (استبدال) وليس (إضافة)
        if (Math.abs(currentBalance - amount) < 0.00000001 && previousBalance > 0) {
          const correctBalance = previousBalance + amount;
          
          console.log(`🔧 إصلاح رصيد ${toAddress}:`);
          console.log(`   من: ${currentBalance.toFixed(8)} ACCESS`);
          console.log(`   إلى: ${correctBalance.toFixed(8)} ACCESS`);
          console.log(`   المبلغ المسترد: ${previousBalance.toFixed(8)} ACCESS`);

          // تحديث الرصيد الصحيح
          await pool.query(`
            UPDATE external_wallets 
            SET balance = $1, last_activity = $2
            WHERE address = $3
          `, [correctBalance.toFixed(8), Date.now(), toAddress]);

          // تحديث البلوك تشين أيضاً
          blockchain.updateBalance(toAddress, correctBalance);

          console.log(`✅ تم استعادة رصيد ${toAddress} بنجاح`);
        }
      }
    }

    console.log('✅ انتهت عملية استعادة الأرصدة');
    
  } catch (error) {
    console.error('❌ خطأ في استعادة الأرصدة:', error);
  }
}

// تشغيل الإصلاح
restoreReplacedBalances().then(() => {
  console.log('🏁 تم انتهاء عملية الإصلاح');
  process.exit(0);
}).catch((error) => {
  console.error('❌ خطأ في تشغيل الإصلاح:', error);
  process.exit(1);
});
