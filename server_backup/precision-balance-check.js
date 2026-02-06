#!/usr/bin/env node

const { pool } = require('./db.js');

async function precisionBalanceCheck() {
  console.log('\n🔍 ═══ فحص الأرصدة بدقة عالية ═══\n');

  try {
    // الحصول على جميع المستخدمين الذين لديهم أرصدة
    const users = await pool.query(
      'SELECT id, email, name, coins, wallet_address FROM users WHERE coins > 0 ORDER BY coins DESC'
    );

    console.log(`📊 تم العثور على ${users.rows.length} مستخدم لديه أرصدة`);

    let totalDatabaseBalance = 0;
    let discrepancyCount = 0;

    for (const user of users.rows) {
      const databaseBalance = parseFloat(user.coins || 0);
      totalDatabaseBalance += databaseBalance;

      console.log(`\n👤 المستخدم: ${user.name} (${user.email})`);
      console.log(`💰 الرصيد في قاعدة البيانات: ${databaseBalance.toFixed(8)} ACCESS`);

      if (user.wallet_address) {
        console.log(`🔗 عنوان المحفظة: ${user.wallet_address}`);
      }

      // فحص المشاكل المحتملة
      if (databaseBalance < 0) {
        console.log('❌ تم اكتشاف رصيد سالب!');
        discrepancyCount++;
      }

      if (databaseBalance > 1000000) {
        console.log('⚠️ تم اكتشاف رصيد مرتفع بشكل غير عادي');
      }
    }

    // فحص المعاملات الحديثة
    console.log('\n💸 ═══ فحص سلامة المعاملات ═══');

    const recentTransactions = await pool.query(
      `SELECT * FROM transactions 
       WHERE timestamp > $1 
       ORDER BY timestamp DESC 
       LIMIT 20`,
      [Date.now() - (24 * 60 * 60 * 1000)] // آخر 24 ساعة
    );

    console.log(`📝 المعاملات الحديثة (24 ساعة): ${recentTransactions.rows.length}`);

    let transactionVolumeOut = 0;
    let transactionVolumeIn = 0;

    for (const tx of recentTransactions.rows) {
      const amount = parseFloat(tx.amount || 0);
      const gasFee = parseFloat(tx.gas_fee || 0);

      if (tx.sender) {
        transactionVolumeOut += amount + gasFee;
      }
      if (tx.recipient) {
        transactionVolumeIn += amount;
      }
    }

    console.log(`📤 الحجم الصادر: ${transactionVolumeOut.toFixed(8)} ACCESS (بما في ذلك الرسوم)`);
    console.log(`📥 الحجم الوارد: ${transactionVolumeIn.toFixed(8)} ACCESS`);

    // الملخص النهائي
    console.log('\n📋 ═══ ملخص الفحص الدقيق ═══');
    console.log(`👥 إجمالي المستخدمين المفحوصين: ${users.rows.length}`);
    console.log(`💰 إجمالي أرصدة النظام: ${totalDatabaseBalance.toFixed(8)} ACCESS`);
    console.log(`⚠️ التضاربات الموجودة: ${discrepancyCount}`);

    if (discrepancyCount === 0) {
      console.log('✅ لم يتم اكتشاف مشاكل - النظام سليم');
    } else {
      console.log('❌ تم اكتشاف مشاكل - مراجعة يدوية مطلوبة');
    }

    console.log('\n🏁 تم اكتمال فحص الأرصدة الدقيق\n');

  } catch (error) {
    console.error('❌ خطأ في فحص الأرصدة الدقيق:', error.message);
  } finally {
    process.exit(0);
  }
}

// تشغيل الفحص
console.log('🚀 بدء فحص الأرصدة المحسن...');
precisionBalanceCheck();