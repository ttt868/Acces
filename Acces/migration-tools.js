
// Database Migration Utilities
import fs from 'fs';
import path from 'path';
import { pool } from './RealisticHonorableDeskscan/db.js';

// Export database schema
export async function exportDatabaseSchema() {
  try {
    const schemaQuery = `
      SELECT 
        table_name,
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `;
    
    const result = await pool.query(schemaQuery);
    
    // Group by table
    const schema = {};
    result.rows.forEach(row => {
      if (!schema[row.table_name]) {
        schema[row.table_name] = [];
      }
      schema[row.table_name].push({
        column: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        default: row.column_default
      });
    });
    
    fs.writeFileSync('database-schema.json', JSON.stringify(schema, null, 2));
    console.log('Database schema exported to database-schema.json');
    return schema;
  } catch (error) {
    console.error('Error exporting schema:', error);
    throw error;
  }
}

// Export all data
export async function exportAllData() {
  try {
    const tables = ['users', 'referrals', 'transactions', 'processing_history', 'user_wallets', 'wallet_balances'];
    const exportData = {};
    
    for (const table of tables) {
      try {
        const result = await pool.query(`SELECT * FROM ${table}`);
        exportData[table] = result.rows;
        console.log(`Exported ${result.rows.length} rows from ${table}`);
      } catch (err) {
        console.log(`Table ${table} doesn't exist, skipping...`);
        exportData[table] = [];
      }
    }
    
    // Write to file with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `database-export-${timestamp}.json`;
    fs.writeFileSync(filename, JSON.stringify(exportData, null, 2));
    
    console.log(`Database exported to ${filename}`);
    return exportData;
  } catch (error) {
    console.error('Error exporting data:', error);
    throw error;
  }
}

// Generate SQL dump
export async function generateSQLDump() {
  try {
    const tables = ['users', 'referrals', 'transactions', 'processing_history', 'user_wallets', 'wallet_balances'];
    let sqlDump = '';
    
    for (const table of tables) {
      try {
        // Get table structure
        const structureQuery = `
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns 
          WHERE table_name = '${table}' AND table_schema = 'public'
          ORDER BY ordinal_position;
        `;
        
        const structure = await pool.query(structureQuery);
        
        // Create table SQL
        sqlDump += `\n-- Table: ${table}\n`;
        sqlDump += `DROP TABLE IF EXISTS ${table} CASCADE;\n`;
        sqlDump += `CREATE TABLE ${table} (\n`;
        
        const columns = structure.rows.map(col => {
          let columnDef = `  ${col.column_name} ${col.data_type}`;
          if (col.is_nullable === 'NO') columnDef += ' NOT NULL';
          if (col.column_default) columnDef += ` DEFAULT ${col.column_default}`;
          return columnDef;
        });
        
        sqlDump += columns.join(',\n') + '\n);\n\n';
        
        // Export data
        const data = await pool.query(`SELECT * FROM ${table}`);
        if (data.rows.length > 0) {
          const columnNames = structure.rows.map(col => col.column_name).join(', ');
          sqlDump += `-- Data for ${table}\n`;
          
          for (const row of data.rows) {
            const values = structure.rows.map(col => {
              const value = row[col.column_name];
              if (value === null) return 'NULL';
              if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
              return value;
            }).join(', ');
            
            sqlDump += `INSERT INTO ${table} (${columnNames}) VALUES (${values});\n`;
          }
          sqlDump += '\n';
        }
      } catch (err) {
        console.log(`Error processing table ${table}:`, err.message);
      }
    }
    
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `database-dump-${timestamp}.sql`;
    fs.writeFileSync(filename, sqlDump);
    
    console.log(`SQL dump generated: ${filename}`);
    return filename;
  } catch (error) {
    console.error('Error generating SQL dump:', error);
    throw error;
  }
}

// Test database connectivity for migration
export async function testDatabaseConnection(connectionString) {
  const { Pool } = await import('pg');
  const testPool = new Pool({ connectionString });
  
  try {
    const client = await testPool.connect();
    await client.query('SELECT NOW()');
    client.release();
    await testPool.end();
    
    console.log('Database connection test successful');
    return true;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}

// Import data to new database
export async function importData(connectionString, dataFile) {
  const { Pool } = await import('pg');
  const newPool = new Pool({ connectionString });
  
  try {
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    
    for (const [tableName, rows] of Object.entries(data)) {
      if (rows.length === 0) continue;
      
      console.log(`Importing ${rows.length} rows to ${tableName}...`);
      
      // Get column names from first row
      const columns = Object.keys(rows[0]);
      const columnNames = columns.join(', ');
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      
      const insertQuery = `INSERT INTO ${tableName} (${columnNames}) VALUES (${placeholders})`;
      
      for (const row of rows) {
        const values = columns.map(col => row[col]);
        await newPool.query(insertQuery, values);
      }
    }
    
    await newPool.end();
    console.log('Data import completed successfully');
  } catch (error) {
    console.error('Error importing data:', error);
    throw error;
  }
}