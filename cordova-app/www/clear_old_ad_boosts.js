
/**
 * سكريبت تنظيف لمرة واحدة لمسح بيانات ad boost القديمة
 * يصلح المستخدمين الذين لا يزالون يحصلون على 1.2 من جلسات سابقة
 */

import { pool } from './db.js';

async function clearOldAdBoosts() {
  const client = await pool.connect();
  
  try {
    console.log('🧹 بدء تنظيف بيانات ad boost القديمة...');
    
    // الحصول على جميع المستخدمين الذين لديهم جلسات معالجة نشطة
    const activeUsers = await client.query(`
      SELECT id, email, ad_boost_active, ad_boost_granted_at, 
             processing_active, processing_start_time_seconds
      FROM users 
      WHERE processing_active = 1
    `);
    
    console.log(`تم العثور على ${activeUsers.rows.length} مستخدم لديهم جلسات معالجة نشطة`);
    
    let clearedCount = 0;
    
    for (const user of activeUsers.rows) {
      // مسح جميع بيانات ad boost لهؤلاء المستخدمين
      await client.query(`
        UPDATE users 
        SET ad_boost_active = FALSE,
            ad_boost_granted_at = NULL,
            ad_boost_session_start = NULL,
            last_ad_watch_timestamp = NULL,
            session_locked_boost = 1.0,
            processing_boost_multiplier = 1.0
        WHERE id = $1
      `, [user.id]);
      
      console.log(`✅ تم مسح ad boost للمستخدم ${user.email} (ID: ${user.id})`);
      clearedCount++;
    }
    
    console.log(`\n✅ اكتمل التنظيف بنجاح!`);
    console.log(`📊 إجمالي المستخدمين الذين تم تنظيفهم: ${clearedCount}`);
    console.log(`\n🎯 الخطوات التالية:`);
    console.log(`   - جميع المستخدمين لديهم الآن جلسات نظيفة (10.0 XP/s أساسي)`);
    console.log(`   - يجب عليهم مشاهدة إعلان جديد في هذه الجلسة للحصول على التعزيز`);
    
  } catch (error) {
    console.error('❌ خطأ أثناء التنظيف:', error);
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
}

// تنفيذ التنظيف
clearOldAdBoosts();
