
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const BLOCKS_DIR = './ethereum-network-data/blocks';

// ✅ دالة حساب hash البلوك - مطابقة 100% لـ network-system.js
function calculateBlockHash(block) {
  // ⚠️ CRITICAL: Must match EXACT order from network-system.js line 30-37
  // The original uses: index + previousHash + timestamp + JSON.stringify(transactions) + nonce
  return crypto
    .createHash('sha256')
    .update(
      block.index +
      block.previousHash +
      block.timestamp +
      JSON.stringify(block.transactions) +
      (block.nonce || 0)
    )
    .digest('hex');
}

async function fixInvalidBlocks() {
  console.log('🔧 Starting block hash validation and repair...');
  
  try {
    const files = fs.readdirSync(BLOCKS_DIR);
    let fixedCount = 0;
    let validCount = 0;
    let errorCount = 0;
    
    // ترتيب الملفات حسب رقم البلوك
    const blockFiles = files
      .filter(file => file.startsWith('block_') && file.endsWith('.json'))
      .sort((a, b) => {
        const numA = parseInt(a.replace('block_', '').replace('.json', ''));
        const numB = parseInt(b.replace('block_', '').replace('.json', ''));
        return numA - numB;
      });
    
    console.log(`📊 Found ${blockFiles.length} block files to check`);
    
    for (const file of blockFiles) {
      const filePath = path.join(BLOCKS_DIR, file);
      
      try {
        const blockData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        // التحقق من وجود البيانات الأساسية
        if (blockData.index === undefined || blockData.index === null) {
          console.log(`⚠️ Skipping ${file}: Missing index`);
          errorCount++;
          continue;
        }
        
        // حساب hash صحيح
        const calculatedHash = calculateBlockHash(blockData);
        
        // التحقق من صحة الـ hash الموجود
        if (!blockData.hash || blockData.hash !== calculatedHash) {
          console.log(`🔧 Block ${blockData.index}: Hash mismatch`);
          console.log(`   Old hash: ${blockData.hash || 'missing'}`);
          console.log(`   New hash: ${calculatedHash}`);
          
          // تحديث الـ hash
          blockData.hash = calculatedHash;
          
          // حفظ البلوك المحدث
          fs.writeFileSync(filePath, JSON.stringify(blockData, null, 2));
          fixedCount++;
          console.log(`✅ Fixed block ${blockData.index}`);
        } else {
          validCount++;
        }
        
      } catch (error) {
        errorCount++;
        console.error(`❌ Error processing ${file}:`, error.message);
      }
    }
    
    console.log('\n📊 Block Repair Summary:');
    console.log(`✅ Valid blocks: ${validCount}`);
    console.log(`🔧 Fixed blocks: ${fixedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📁 Total files processed: ${blockFiles.length}`);
    
    if (fixedCount > 0) {
      console.log('\n✅ Block repair completed successfully!');
      console.log('🔄 Please restart the server for changes to take effect.');
    } else {
      console.log('\n✅ All blocks are already valid!');
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

fixInvalidBlocks();
