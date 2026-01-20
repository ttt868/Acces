

import { pool } from './db.js';
import crypto from 'crypto';

async function fixTransactionHashConsistency() {
  console.log('🔧 بدء إصلاح تناسق hash المعاملات - hash واحد لكل معاملة...');
  
  try {
    // الحصول على جميع المعاملات من كلا الجدولين
    console.log('📊 جلب جميع المعاملات من قواعد البيانات...');
    
    const transactionsResult = await pool.query(`
      SELECT id, hash, sender_address, recipient_address, amount, timestamp, nonce 
      FROM transactions 
      ORDER BY timestamp ASC
    `);
    
    const blockchainResult = await pool.query(`
      SELECT id, tx_hash, from_address, to_address, amount, timestamp, nonce 
      FROM transactions 
      ORDER BY timestamp ASC
    `);
    
    console.log(`📊 وُجد ${transactionsResult.rows.length} معاملة في جدول transactions`);
    console.log(`📊 وُجد ${blockchainResult.rows.length} معاملة في جدول blockchain_transactions`);
    
    let fixedCount = 0;
    const processedKeys = new Set();
    
    // ⭐ STEP 1: توحيد hash في جدول transactions
    console.log('🔄 STEP 1: توحيد hash في جدول transactions...');
    
    for (const tx of transactionsResult.rows) {
      // إنشاء مفتاح فريد للمعاملة
      const uniqueKey = `${tx.sender_address || 'genesis'}-${tx.recipient_address}-${tx.amount}-${tx.timestamp}`;
      
      if (!processedKeys.has(uniqueKey)) {
        // إنشاء hash واحد موحد
        const singleHash = crypto
          .createHash('sha256')
          .update(`${tx.sender_address || 'genesis'}${tx.recipient_address}${tx.amount}${tx.timestamp}${tx.nonce || 0}`)
          .digest('hex');
        
        // تحديث الـ hash في جدول transactions
        await pool.query(`
          UPDATE transactions 
          SET hash = $1 
          WHERE id = $2
        `, [singleHash, tx.id]);
        
        processedKeys.add(uniqueKey);
        fixedCount++;
        
        console.log(`✅ FIXED TX: ${singleHash.substring(0, 10)}... (${tx.sender_address?.substring(0, 8) || 'genesis'}... -> ${tx.recipient_address?.substring(0, 8)}...)`);
      }
    }
    
    // ⭐ STEP 2: توحيد hash في جدول blockchain_transactions
    console.log('🔄 STEP 2: توحيد hash في جدول blockchain_transactions...');
    
    const processedBlockchainKeys = new Set();
    
    for (const tx of blockchainResult.rows) {
      const uniqueKey = `${tx.from_address || 'genesis'}-${tx.to_address}-${tx.amount}-${tx.timestamp}`;
      
      if (!processedBlockchainKeys.has(uniqueKey)) {
        // إنشاء نفس hash الموحد
        const singleHash = crypto
          .createHash('sha256')
          .update(`${tx.from_address || 'genesis'}${tx.to_address}${tx.amount}${tx.timestamp}${tx.nonce || 0}`)
          .digest('hex');
        
        // تحديث الـ hash في جدول blockchain_transactions
        await pool.query(`
          UPDATE transactions 
          SET tx_hash = $1 
          WHERE id = $2
        `, [singleHash, tx.id]);
        
        processedBlockchainKeys.add(uniqueKey);
        fixedCount++;
        
        console.log(`✅ FIXED BLOCKCHAIN TX: ${singleHash.substring(0, 10)}... (${tx.from_address?.substring(0, 8) || 'genesis'}... -> ${tx.to_address?.substring(0, 8)}...)`);
      }
    }
    
    // ⭐ STEP 3: التحقق من التناسق النهائي
    console.log('🔍 STEP 3: التحقق من التناسق النهائي...');
    
    const verificationResult = await pool.query(`
      SELECT COUNT(*) as total_inconsistent
      FROM transactions t
      FULL OUTER JOIN blockchain_transactions bt ON (
        t.sender_address = bt.from_address AND
        t.recipient_address = bt.to_address AND
        t.amount = bt.amount AND
        ABS(t.timestamp - bt.timestamp) < 1000 AND
        t.hash != bt.tx_hash
      )
      WHERE t.hash != bt.tx_hash AND t.hash IS NOT NULL AND bt.tx_hash IS NOT NULL
    `);
    
    const inconsistentCount = parseInt(verificationResult.rows[0]?.total_inconsistent || 0);
    
    console.log(`\n🎯 ═══ نتائج إصلاح hash المعاملات ═══`);
    console.log(`✅ تم إصلاح: ${fixedCount} معاملة`);
    console.log(`📊 معاملات غير متسقة متبقية: ${inconsistentCount}`);
    console.log(`🔒 حالة النظام: ${inconsistentCount === 0 ? 'مثالي - hash واحد لكل معاملة' : 'يحتاج مراجعة إضافية'}`);
    console.log(`═══════════════════════════════════════════════\n`);
    
    return {
      success: true,
      fixedCount,
      remainingInconsistent: inconsistentCount,
      status: inconsistentCount === 0 ? 'PERFECT' : 'NEEDS_REVIEW'
    };
    
  } catch (error) {
    console.error('❌ خطأ في إصلاح تناسق hash المعاملات:', error);
    throw error;
  }
}

// تشغيل الإصلاح إذا تم استدعاء الملف مباشرة
if (import.meta.url === `file://${process.argv[1]}`) {
  fixTransactionHashConsistency()
    .then(result => {
      console.log('🎉 انتهى الإصلاح بنجاح:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 فشل في الإصلاح:', error);
      process.exit(1);
    });
}

export { fixTransactionHashConsistency };

