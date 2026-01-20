
#!/usr/bin/env node
// Migration Execution Script
import { exportDatabaseSchema, exportAllData, generateSQLDump, testDatabaseConnection, importData } from './migration-tools.js';

async function runMigration() {
  console.log('=== DATABASE MIGRATION TOOL ===');
  
  const action = process.argv[2];
  
  switch (action) {
    case 'export-schema':
      await exportDatabaseSchema();
      break;
      
    case 'export-data':
      await exportAllData();
      break;
      
    case 'export-sql':
      await generateSQLDump();
      break;
      
    case 'full-export':
      console.log('Performing full database export...');
      await exportDatabaseSchema();
      await exportAllData();
      await generateSQLDump();
      console.log('Full export completed!');
      break;
      
    case 'test-connection':
      const connString = process.argv[3];
      if (!connString) {
        console.error('Please provide connection string: node migration-script.js test-connection "postgresql://..."');
        process.exit(1);
      }
      await testDatabaseConnection(connString);
      break;
      
    case 'import':
      const newConnString = process.argv[3];
      const dataFile = process.argv[4];
      if (!newConnString || !dataFile) {
        console.error('Usage: node migration-script.js import "postgresql://..." "data-file.json"');
        process.exit(1);
      }
      await importData(newConnString, dataFile);
      break;
      
    default:
      console.log(`
Usage:
  node migration-script.js export-schema     # Export table structure
  node migration-script.js export-data       # Export all data as JSON
  node migration-script.js export-sql        # Generate SQL dump
  node migration-script.js full-export       # Export everything
  node migration-script.js test-connection "conn-string"  # Test new DB connection
  node migration-script.js import "conn-string" "data.json"  # Import to new DB
      `);
  }
}

runMigration().catch(console.error);