
/**
 * Script to fix issues with processing rewards when referral status changes
 * - Ensures consistent use of accumulatedReward field
 * - Handles transition between referral states properly
 */
const { pool } = require('./RealisticHonorableDeskscan/db.js');

async function fixProcessingRewards() {
  try {
    console.log('Starting processing rewards fix...');
    
    // Check if columns exist and create if needed
    await pool.query(`
      DO $$
      BEGIN
        -- Ensure we only have the standardized column names
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'accumulatedreward'
        ) THEN
          ALTER TABLE users ADD COLUMN accumulatedReward NUMERIC DEFAULT 0;
        END IF;
        
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'baseaccumulatedreward'
        ) THEN
          ALTER TABLE users ADD COLUMN baseAccumulatedReward NUMERIC DEFAULT 0;
        END IF;
        
        -- Make sure old column is gone to prevent confusion
        IF EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'accumulated_processing_reward'
        ) THEN
          ALTER TABLE users DROP COLUMN accumulated_processing_reward;
        END IF;
      END$$;
    `);
    
    // Scan through active processing users and update their accumulated rewards properly
    const activeMiners = await pool.query(`
      SELECT id, processing_start_time, processing_end_time, processing_rate, processing_boost_multiplier, accumulatedReward
      FROM users
      WHERE processing_active = 1 AND processing_start_time IS NOT NULL
    `);
    
    console.log(`Found ${activeMiners.rows.length} active miners to process`);
    
    // Process each active miner
    for (const miner of activeMiners.rows) {
      // Count active referrals
      const referralsResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM referrals r
        JOIN users u ON r.referee_id = u.id
        WHERE r.referrer_id = $1 AND u.processing_active = 1
      `, [miner.id]);
      
      const activeReferralCount = parseInt(referralsResult.rows[0].count);
      
      // Calculate boost
      const baseHashrate = 10; // MH/s
      const boostPerReferral = 0.4; // MH/s per active referral
      const totalHashrate = baseHashrate + (activeReferralCount * boostPerReferral);
      const boostMultiplier = totalHashrate / baseHashrate;
      
      console.log(`User ${miner.id}: ${activeReferralCount} active referrals, boost: ${boostMultiplier.toFixed(2)}x`);
      
      // Update hashrate and multiplier
      await pool.query(`
        UPDATE users
        SET processing_rate = $1,
            processing_boost_multiplier = $2
        WHERE id = $3
      `, [totalHashrate, boostMultiplier, miner.id]);
      
      // Calculate correct reward amount based on progress
      const now = Date.now();
      const startTime = parseInt(miner.processing_start_time);
      const endTime = parseInt(miner.processing_end_time);
      
      if (startTime > 0 && endTime > now) {
        const totalDuration = endTime - startTime;
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / totalDuration);
        
        // Base reward with boost
        const baseReward = 0.25;
        const boostedReward = baseReward * boostMultiplier;
        const correctAmount = boostedReward * progress;
        
        console.log(`User ${miner.id}: progress ${(progress * 100).toFixed(1)}%, reward: ${correctAmount.toFixed(8)}`);
        
        // Update accumulated reward
        await pool.query(`
          UPDATE users
          SET accumulatedReward = $1,
              baseAccumulatedReward = $2,
              last_processing_accumulation = $3
          WHERE id = $4
        `, [correctAmount, baseReward * progress, now, miner.id]);
      }
    }
    
    console.log('Processing rewards fix completed successfully.');
    return { success: true };
  } catch (error) {
    console.error('Error fixing processing rewards:', error);
    return { success: false, error: error.message };
  }
}

// Run the fix
fixProcessingRewards().then(result => {
  console.log('Fix result:', result);
  process.exit(result.success ? 0 : 1);
}).catch(err => {
  console.error('Failed to run fix script:', err);
  process.exit(1);
});