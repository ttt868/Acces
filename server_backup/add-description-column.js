
// Script to add description column to transactions table
async function addDescriptionColumn() {
  try {
    // Use dynamic import to import ESM module in CommonJS
    const { pool } = await import('./db.js');
    
    // Add description column if it doesn't exist
    await pool.query(`
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS description TEXT;
    `);
    
    console.log('✅ Successfully added description column to transactions table');
    
    // Close the pool when done
    await pool.end();
  } catch (err) {
    console.error('❌ Error adding description column:', err);
  }
}

// Run the function
addDescriptionColumn();
