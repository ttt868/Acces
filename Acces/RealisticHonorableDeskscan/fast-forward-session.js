// أداة تطوير: تقديم جلسة مستخدم للاختبار
// الاستخدام: node fast-forward-session.js email@example.com [دقائق]

import { pool } from './db.js';

async function fastForwardSession(email, minutesRemaining = 1) {
  try {
    // البحث عن المستخدم
    const userResult = await pool.query(
      'SELECT id, email, processing_active, processing_end_time FROM users WHERE email = $1', 
      [email]
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ المستخدم غير موجود:', email);
      process.exit(1);
    }
    
    const user = userResult.rows[0];
    console.log('✅ المستخدم:', user.email);
    console.log('   ID:', user.id);
    console.log('   الجلسة نشطة:', user.processing_active ? 'نعم' : 'لا');
    
    if (!user.processing_active) {
      console.log('❌ لا توجد جلسة نشطة لهذا المستخدم');
      process.exit(1);
    }
    
    // تعيين وقت النهاية
    const nowMs = Date.now();
    const newEndTime = nowMs + (minutesRemaining * 60 * 1000);
    const newStartTime = newEndTime - (24 * 60 * 60 * 1000); // 24 ساعة قبل النهاية
    const newStartTimeSec = Math.floor(newStartTime / 1000);
    
    await pool.query(`
      UPDATE users 
      SET processing_end_time = $1,
          processing_start_time = $2,
          processing_start_time_seconds = $3
      WHERE id = $4
    `, [newEndTime, newStartTime, newStartTimeSec, user.id]);
    
    console.log('');
    console.log('✅ تم تقديم الجلسة!');
    console.log('   وقت النهاية الجديد:', new Date(newEndTime).toLocaleString());
    console.log('   المتبقي:', minutesRemaining, 'دقيقة');
    console.log('');
    console.log('📌 أعد تحميل الصفحة في المتصفح لرؤية العداد');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ خطأ:', error.message);
    process.exit(1);
  }
}

// قراءة البريد الإلكتروني من سطر الأوامر
const email = process.argv[2];
const minutes = parseInt(process.argv[3]) || 1;

if (!email) {
  console.log('الاستخدام: node fast-forward-session.js email@example.com [دقائق]');
  console.log('مثال: node fast-forward-session.js test@test.com 1');
  process.exit(1);
}

fastForwardSession(email, minutes);
