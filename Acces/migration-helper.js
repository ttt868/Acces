
#!/usr/bin/env node
// Database Migration Helper
// Makes it easy to migrate between different hosting platforms

import { getDatabaseConfig, createMigrationPlan, createEnvTemplate, testDatabaseConnection, exportDatabase } from './database-config.js';
import fs from 'fs';
import { execSync } from 'child_process';

// Command line interface for database migration
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  console.log('🚀 Database Migration Helper');
  console.log('============================');
  
  switch (command) {
    case 'test':
      await testConnection();
      break;
      
    case 'export':
      await exportCurrentDatabase();
      break;
      
    case 'plan':
      createMigrationPlan(args[1], args[2]);
      break;
      
    case 'template':
      createTemplate(args[1]);
      break;
      
    case 'status':
      showStatus();
      break;
      
    default:
      showHelp();
  }
}

async function testConnection() {
  console.log('🔍 Testing database connection...');
  const result = await testDatabaseConnection();
  
  if (result.success) {
    console.log(`✅ Connected successfully to ${result.provider} database`);
  } else {
    console.log(`❌ Connection failed: ${result.error}`);
  }
}

async function exportCurrentDatabase() {
  console.log('📦 Exporting current database...');
  const scriptPath = await exportDatabase();
  console.log(`✅ Export script created: ${scriptPath}`);
  console.log('Run the script to export your data:');
  console.log(`chmod +x ${scriptPath} && ./${scriptPath}`);
}

function createTemplate(provider = 'railway') {
  console.log(`📝 Creating .env template for ${provider}...`);
  const template = createEnvTemplate(provider);
  const filename = `.env.${provider}`;
  
  fs.writeFileSync(filename, template);
  console.log(`✅ Template created: ${filename}`);
  console.log('Edit the file with your actual credentials, then rename to .env');
}

function showStatus() {
  try {
    const config = getDatabaseConfig();
    console.log('📊 Current Database Status:');
    console.log(`Provider: ${config.provider}`);
    console.log(`Environment: ${config.environment}`);
    console.log(`Max Connections: ${config.max}`);
    console.log(`SSL Enabled: ${config.ssl ? 'Yes' : 'No'}`);
  } catch (error) {
    console.log('❌ No database configuration found');
    console.log('Create a .env file with DATABASE_URL');
  }
}

function showHelp() {
  console.log(`
📖 Usage: node migration-helper.js <command>

Commands:
  test             Test current database connection
  export           Export current database (creates backup script)
  template <name>  Create .env template for provider (neon, railway, heroku, local)
  status           Show current database configuration
  plan <from> <to> Show migration plan between providers

Examples:
  node migration-helper.js test
  node migration-helper.js template railway
  node migration-helper.js export
  node migration-helper.js plan neon railway

Supported Providers:
  - neon (current)
  - railway
  - heroku
  - digitalocean
  - local
`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}