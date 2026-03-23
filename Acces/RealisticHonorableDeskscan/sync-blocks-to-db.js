// مزامنة البلوكات من ملفات JSON إلى قاعدة البيانات PostgreSQL
// يُشغّل مرة واحدة لملء DB بعد إصلاح ON CONFLICT DO UPDATE
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import crypto from 'crypto';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

const blocksDir = './ethereum-network-data/blocks';

function calculateStateRoot(block) {
  const stateData = JSON.stringify({
    blockIndex: block.index,
    transactions: block.transactions?.length || 0,
    timestamp: block.timestamp
  });
  return '0x' + crypto.createHash('sha256').update(stateData).digest('hex');
}

function calculateTransactionsRoot(block) {
  if (!block.transactions || block.transactions.length === 0) {
    return '0x0000000000000000000000000000000000000000000000000000000000000000';
  }
  const txData = JSON.stringify(block.transactions);
  return '0x' + crypto.createHash('sha256').update(txData).digest('hex');
}

function calculateGasUsed(block) {
  if (!block.transactions || block.transactions.length === 0) return 0;
  return block.transactions.reduce((total, tx) => total + (tx.gasUsed || 21000), 0);
}

async function syncBlocks() {
  console.log('🔄 بدء مزامنة البلوكات من JSON إلى PostgreSQL...');

  // عدّ الملفات
  const files = fs.readdirSync(blocksDir).filter(f => f.startsWith('block_') && f.endsWith('.json'));
  files.sort((a, b) => {
    const numA = parseInt(a.replace('block_', '').replace('.json', ''));
    const numB = parseInt(b.replace('block_', '').replace('.json', ''));
    return numA - numB;
  });
  console.log(`📦 وُجد ${files.length} ملف بلوك`);

  // حذف البلوكات القديمة التي تجاوزت السلسلة الحالية
  const maxIndex = parseInt(files[files.length - 1].replace('block_', '').replace('.json', ''));
  const delResult = await pool.query('DELETE FROM ethereum_blocks WHERE block_index > $1', [maxIndex]);
  if (delResult.rowCount > 0) {
    console.log(`🗑️ حُذف ${delResult.rowCount} بلوك يتيم (أكبر من ${maxIndex})`);
  }

  // مزامنة بدُفعات
  const BATCH_SIZE = 50;
  let synced = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = [];
    let paramIndex = 1;

    for (const file of batch) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(blocksDir, file), 'utf8'));
        const block = data;

        values.push(
          block.index,
          block.hash,
          block.previousHash,
          calculateStateRoot(block),
          calculateTransactionsRoot(block),
          block.timestamp,
          calculateGasUsed(block),
          21000 * (block.transactions?.length || 0),
          block.difficulty || 2,
          block.nonce || 0,
          JSON.stringify({ ethereumStyle: true }),
          JSON.stringify(block).length
        );

        placeholders.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3}, $${paramIndex+4}, $${paramIndex+5}, $${paramIndex+6}, $${paramIndex+7}, $${paramIndex+8}, $${paramIndex+9}, $${paramIndex+10}, $${paramIndex+11})`);
        paramIndex += 12;
      } catch (err) {
        errors++;
      }
    }

    if (placeholders.length > 0) {
      try {
        await pool.query(`
          INSERT INTO ethereum_blocks
          (block_index, block_hash, parent_hash, state_root, transactions_root,
           timestamp, gas_used, gas_limit, difficulty, nonce, extra_data, size)
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (block_index) DO UPDATE SET
            block_hash = EXCLUDED.block_hash,
            parent_hash = EXCLUDED.parent_hash,
            state_root = EXCLUDED.state_root,
            transactions_root = EXCLUDED.transactions_root,
            timestamp = EXCLUDED.timestamp,
            gas_used = EXCLUDED.gas_used,
            gas_limit = EXCLUDED.gas_limit,
            difficulty = EXCLUDED.difficulty,
            nonce = EXCLUDED.nonce,
            extra_data = EXCLUDED.extra_data,
            size = EXCLUDED.size
        `, values);
        synced += placeholders.length;
      } catch (err) {
        console.error(`❌ خطأ في الدفعة ${Math.floor(i/BATCH_SIZE)+1}:`, err.message);
        errors += batch.length;
      }
    }

    if ((i + BATCH_SIZE) % 200 === 0 || i + BATCH_SIZE >= files.length) {
      console.log(`  ✅ ${Math.min(synced, files.length)}/${files.length} بلوك...`);
    }
  }

  // تحقق نهائي
  const countResult = await pool.query('SELECT COUNT(*) as total, MAX(block_index) as max_block FROM ethereum_blocks');
  console.log(`\n📊 النتيجة النهائية:`);
  console.log(`  - بلوكات في DB: ${countResult.rows[0].total}`);
  console.log(`  - أعلى بلوك: ${countResult.rows[0].max_block}`);
  console.log(`  - تمت مزامنة: ${synced}`);
  console.log(`  - أخطاء: ${errors}`);
  console.log(`✅ اكتملت المزامنة!`);

  await pool.end();
}

syncBlocks().catch(err => {
  console.error('❌ خطأ:', err);
  pool.end();
  process.exit(1);
});
