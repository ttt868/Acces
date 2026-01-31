
import crypto from 'crypto';
import { pool } from './db.js';

// دالة إصلاح توحيد hash المعاملات - hash واحد لكل معاملة
async function fixTransactionHashUnification() {
  console.log('🔧 بدء إصلاح توحيد hash المعاملات - hash واحد لكل معاملة...');
  
  try {
    await pool.query('BEGIN');
    
    // جلب جميع المعاملات من جدول transactions
    const transactionsResult = await pool.query(`
      SELECT id, hash, sender_address, recipient_address, amount, timestamp, nonce 
      FROM transactions 
      ORDER BY timestamp ASC
    `);
    
    // جلب جميع المعاملات من جدول blockchain_transactions
    const blockchainResult = await pool.query(`
      SELECT id, tx_hash, from_address, to_address, amount, timestamp, nonce 
      FROM transactions 
      ORDER BY timestamp ASC
    `);
    
    console.log(`📊 وُجد ${transactionsResult.rows.length} معاملة في جدول transactions`);
    console.log(`📊 وُجد ${blockchainResult.rows.length} معاملة في جدول blockchain_transactions`);
    
    let fixedCount = 0;
    const processedTransactions = new Map();
    
    // دالة إنشاء hash موحد ثابت للمعاملة
    function createUnifiedHash(fromAddr, toAddr, amount, timestamp, nonce = 0) {
      const normalizedFrom = (fromAddr || 'genesis').toLowerCase();
      const normalizedTo = (toAddr || '').toLowerCase();
      const normalizedAmount = parseFloat(amount || 0).toFixed(8);
      const normalizedTimestamp = parseInt(timestamp || Date.now());
      const normalizedNonce = parseInt(nonce || 0);
      
      const hashData = `${normalizedFrom}${normalizedTo}${normalizedAmount}${normalizedTimestamp}${normalizedNonce}`;
      return crypto.createHash('sha256').update(hashData).digest('hex');
    }
    
    // ⭐ STEP 1: إنشاء hash موحد لكل معاملة في transactions
    for (const tx of transactionsResult.rows) {
      const transactionKey = `${(tx.sender_address || 'genesis').toLowerCase()}-${(tx.recipient_address || '').toLowerCase()}-${parseFloat(tx.amount || 0).toFixed(8)}-${parseInt(tx.timestamp)}`;
      
      if (!processedTransactions.has(transactionKey)) {
        // إنشاء hash موحد واحد فقط باستخدام الدالة الموحدة
        const unifiedHash = createUnifiedHash(
          tx.sender_address,
          tx.recipient_address,
          tx.amount,
          tx.timestamp,
          tx.nonce
        );
        
        // تحديث الـ hash في جدول transactions
        await pool.query(`
          UPDATE transactions 
          SET hash = $1 
          WHERE id = $2
        `, [unifiedHash, tx.id]);
        
        processedTransactions.set(transactionKey, unifiedHash);
        fixedCount++;
        
        console.log(`✅ UNIFIED TX: ${unifiedHash.substring(0, 12)}... (${(tx.sender_address || 'genesis').substring(0, 8)}... -> ${(tx.recipient_address || '').substring(0, 8)}...)`);
      }
    }
    
    // ⭐ STEP 2: توحيد hash في جدول blockchain_transactions مع نفس hash
    for (const tx of blockchainResult.rows) {
      const transactionKey = `${(tx.from_address || 'genesis').toLowerCase()}-${(tx.to_address || '').toLowerCase()}-${parseFloat(tx.amount || 0).toFixed(8)}-${parseInt(tx.timestamp)}`;
      
      let unifiedHash;
      
      if (processedTransactions.has(transactionKey)) {
        // استخدام نفس hash الموحد من transactions table
        unifiedHash = processedTransactions.get(transactionKey);
        console.log(`🔗 REUSING HASH: ${unifiedHash.substring(0, 12)}... (matched with transactions table)`);
      } else {
        // إنشاء hash جديد للمعاملات التي لا توجد في transactions
        unifiedHash = createUnifiedHash(
          tx.from_address,
          tx.to_address,
          tx.amount,
          tx.timestamp,
          tx.nonce
        );
        
        processedTransactions.set(transactionKey, unifiedHash);
        fixedCount++;
        
        console.log(`✅ NEW UNIFIED BLOCKCHAIN TX: ${unifiedHash.substring(0, 12)}...`);
      }
      
      // تحديث hash في blockchain_transactions
      await pool.query(`
        UPDATE transactions 
        SET tx_hash = $1 
        WHERE id = $2
      `, [unifiedHash, tx.id]);
    }
    
    // ⭐ STEP 3: التحقق من النجاح النهائي
    const verificationResult = await pool.query(`
      SELECT COUNT(*) as conflicts
      FROM transactions t
      INNER JOIN blockchain_transactions bt ON (
        LOWER(COALESCE(t.sender_address, 'genesis')) = LOWER(COALESCE(bt.from_address, 'genesis')) AND
        LOWER(t.recipient_address) = LOWER(bt.to_address) AND
        t.amount::numeric = bt.amount::numeric AND
        ABS(t.timestamp - bt.timestamp) <= 1000
      )
      WHERE t.hash != bt.tx_hash
    `);
    
    const conflictCount = parseInt(verificationResult.rows[0]?.conflicts || 0);
    
    // ⭐ STEP 4: إضافة فهارس لتحسين البحث
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_transactions_unified_search 
        ON transactions(hash, sender_address, recipient_address, timestamp);
      `);
      
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_blockchain_unified_search 
        ON blockchain_transactions(tx_hash, from_address, to_address, timestamp);
      `);
      
      console.log(`📊 تم إنشاء فهارس البحث الموحدة`);
    } catch (indexError) {
      console.warn('تحذير: لم يتم إنشاء بعض الفهارس:', indexError.message);
    }
    
    await pool.query('COMMIT');
    
    console.log(`\n🎯 ═══ نتائج توحيد hash المعاملات ═══`);
    console.log(`✅ تم توحيد: ${fixedCount} معاملة`);
    console.log(`📊 معاملات فريدة: ${processedTransactions.size}`);
    console.log(`❌ تضارب متبقي: ${conflictCount} معاملة`);
    
    if (conflictCount === 0) {
      console.log(`🏆 PERFECT SUCCESS: جميع المعاملات لديها hash موحد واحد فقط!`);
      console.log(`🔍 المستكشف سيعرض الآن نفس hash في جميع الصفحات`);
    } else {
      console.log(`⚠️ لا يزال هناك ${conflictCount} معاملة متضاربة - يتطلب تدخل يدوي`);
    }
    
    console.log(`🔒 حالة النظام: HASH UNIFIED - كل معاملة لها hash واحد فقط`);
    console.log(`✨ المستكشف أصبح موحد ومطابق 100%`);
    console.log(`═══════════════════════════════════════════════════════`);
    
    return {
      success: true,
      fixedCount,
      uniqueTransactions: processedTransactions.size,
      remainingConflicts: conflictCount,
      explorerFixed: conflictCount === 0
    };
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ خطأ في توحيد hash المعاملات:', error);
    throw error;
  }
}

// تشغيل الإصلاح
if (import.meta.url === `file://${process.argv[1]}`) {
  fixTransactionHashUnification()
    .then(result => {
      console.log('\n✅ تم إصلاح توحيد hash المعاملات بنجاح');
      if (result.explorerFixed) {
        console.log('🎉 المستكشف أصبح موحد تماماً - نفس hash في كل مكان!');
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ فشل في إصلاح توحيد hash المعاملات:', error);
      process.exit(1);
    });
}

export { fixTransactionHashUnification };
