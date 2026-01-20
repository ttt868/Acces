
import { pool } from './db.js';
import fs from 'fs';

async function fixDatabaseColumns() {
  try {
    console.log('🔧 بدء إصلاح أعمدة قاعدة البيانات...');
    
    // قراءة وتنفيذ SQL لإضافة الأعمدة المفقودة
    const sqlScript = fs.readFileSync('./add-nonce-column.sql', 'utf8');
    
    await pool.query(sqlScript);
    
    console.log('✅ تم إصلاح أعمدة قاعدة البيانات بنجاح');
    console.log('📊 الأعمدة المضافة:');
    console.log('  - nonce: لحفظ رقم المعاملة');
    console.log('  - confirmations: لحفظ عدد التأكيدات');
    console.log('  - is_confirmed: لحفظ حالة التأكيد');
    
  } catch (error) {
    console.error('❌ خطأ في إصلاح قاعدة البيانات:', error);
  } finally {
    process.exit(0);
  }
}

fixDatabaseColumns();
