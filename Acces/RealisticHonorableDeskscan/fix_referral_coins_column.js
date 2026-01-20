
/**
 * Fix referrals table to support decimal coin values
 * Changes the coins column from INTEGER to NUMERIC to support 0.15 values
 */

import { pool } from './db.js';

async function fixReferralCoinsColumn() {
  try {
    console.log('Fixing referrals table coins column to support decimal values...');

    // Check if referrals table exists and get current column type
    const tableCheck = await pool.query(`
      SELECT column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns 
      WHERE table_name = 'referrals' AND column_name = 'coins'
    `);

    if (tableCheck.rows.length === 0) {
      console.log('Referrals table or coins column not found. Creating/updating table...');
      
      // Ensure referrals table exists with proper schema
      await pool.query(`
        CREATE TABLE IF NOT EXISTS referrals (
          id SERIAL PRIMARY KEY,
          referrer_id INTEGER REFERENCES users(id),
          referee_id INTEGER REFERENCES users(id),
          date VARCHAR(255),
          coins NUMERIC(10,8) DEFAULT 0,
          status VARCHAR(50) DEFAULT 'completed',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      console.log('✅ Referrals table created with NUMERIC coins column');
    } else {
      const currentType = tableCheck.rows[0].data_type;
      console.log(`Current coins column type: ${currentType}`);
      
      if (currentType === 'integer') {
        console.log('Converting coins column from INTEGER to NUMERIC...');
        
        // Convert the column type
        await pool.query(`
          ALTER TABLE referrals 
          ALTER COLUMN coins TYPE NUMERIC(10,8) USING coins::NUMERIC(10,8)
        `);
        
        console.log('✅ Coins column converted to NUMERIC(10,8)');
      } else if (currentType === 'numeric') {
        console.log('✅ Coins column is already NUMERIC type');
      } else {
        console.log(`⚠️  Unexpected column type: ${currentType}. Converting to NUMERIC...`);
        await pool.query(`
          ALTER TABLE referrals 
          ALTER COLUMN coins TYPE NUMERIC(10,8) USING coins::NUMERIC(10,8)
        `);
        console.log('✅ Coins column converted to NUMERIC(10,8)');
      }
    }

    // Verify the change
    const verifyCheck = await pool.query(`
      SELECT column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns 
      WHERE table_name = 'referrals' AND column_name = 'coins'
    `);

    if (verifyCheck.rows.length > 0) {
      const col = verifyCheck.rows[0];
      console.log(`✅ Verification: coins column is now ${col.data_type}(${col.numeric_precision},${col.numeric_scale})`);
    }

    console.log('✅ Referrals table coins column fix completed successfully');
    return true;

  } catch (error) {
    console.error('❌ Error fixing referrals coins column:', error);
    return false;
  }
}

// Run the fix if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fixReferralCoinsColumn()
    .then(() => {
      console.log('Fix completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('Fix failed:', err);
      process.exit(1);
    });
}

export { fixReferralCoinsColumn };
