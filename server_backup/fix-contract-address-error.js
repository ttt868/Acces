#!/usr/bin/env node

/**
 * حل المشكلة: "This address is a contract address"
 * تنظيف جميع الحسابات والتأكد من أن جميع العناوين لها codeHash فارغ
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ACCOUNTS_DIR = path.join(__dirname, 'ethereum-network-data', 'accounts');

function fixAccountFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // تنظيف البيانات - التأكد من أن codeHash و storageRoot فارغة
    const originalCodeHash = data.codeHash;
    const originalStorageRoot = data.storageRoot;
    
    data.codeHash = '0x';
    data.storageRoot = '0x';
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    
    if (originalCodeHash !== '0x' || originalStorageRoot !== '0x') {
      console.log(`✅ Fixed: ${path.basename(filePath)}`);
      return { fixed: true, address: data.address };
    }
    return { fixed: false, address: data.address };
  } catch (error) {
    console.error(`❌ Error fixing ${filePath}:`, error.message);
    return { fixed: false, address: 'unknown', error: error.message };
  }
}

function cleanupAllAccounts() {
  console.log('🔧 جاري تنظيف جميع حسابات الشبكة...\n');
  
  if (!fs.existsSync(ACCOUNTS_DIR)) {
    console.error('❌ مجلد الحسابات غير موجود:', ACCOUNTS_DIR);
    return;
  }
  
  const files = fs.readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith('.json'));
  let fixed = 0;
  let skipped = 0;
  
  files.forEach(file => {
    const filePath = path.join(ACCOUNTS_DIR, file);
    const result = fixAccountFile(filePath);
    
    if (result.fixed) {
      fixed++;
    } else if (!result.error) {
      skipped++;
    }
  });
  
  console.log(`\n✨ النتائج:`);
  console.log(`📊 إجمالي الملفات: ${files.length}`);
  console.log(`✅ تم إصلاحها: ${fixed}`);
  console.log(`⏭️  تم تخطيها (صحيحة بالفعل): ${skipped}`);
  console.log(`\n⚠️  نصيحة مهمة:`);
  console.log(`1️⃣  قم بحذف شبكة ACCESS من MetaMask`);
  console.log(`2️⃣  أعد إضافة الشبكة بنفس البيانات`);
  console.log(`3️⃣  هذا يحذف الـ cache من MetaMask`);
  console.log(`4️⃣  جرب الآن - يجب أن يعمل بدون أخطاء\n`);
}

// تشغيل التنظيف
cleanupAllAccounts();
