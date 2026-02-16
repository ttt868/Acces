
// Database Configuration Manager
// Supports multiple database providers and easy migration between platforms

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

// Database provider configurations
const DATABASE_PROVIDERS = {
  // Current Neon PostgreSQL (your current setup)
  neon: {
    name: "Neon PostgreSQL",
    type: "postgresql",
    ssl: { rejectUnauthorized: false },
    maxConnections: 10
  },
  
  // For Railway deployment
  railway: {
    name: "Railway PostgreSQL",
    type: "postgresql", 
    ssl: { rejectUnauthorized: false },
    maxConnections: 20
  },
  
  // For Heroku deployment
  heroku: {
    name: "Heroku PostgreSQL",
    type: "postgresql",
    ssl: { rejectUnauthorized: false },
    maxConnections: 20
  },
  
  // For DigitalOcean deployment
  digitalocean: {
    name: "DigitalOcean PostgreSQL",
    type: "postgresql",
    ssl: { rejectUnauthorized: false },
    maxConnections: 25
  },
  
  // For local development
  local: {
    name: "Local PostgreSQL",
    type: "postgresql",
    ssl: false,
    maxConnections: 5
  }
};

// Auto-detect environment and provider
function detectEnvironment() {
  if (process.env.REPL_ID || process.env.REPLIT_DB_URL) {
    return 'replit';
  }
  if (process.env.RAILWAY_PROJECT_ID) {
    return 'railway';
  }
  if (process.env.DYNO) {
    return 'heroku';
  }
  if (process.env.DIGITALOCEAN_APP_ID) {
    return 'digitalocean';
  }
  return 'local';
}

// Get database configuration based on environment or manual selection
function getDatabaseConfig(providerOverride = null) {
  const environment = detectEnvironment();
  const provider = providerOverride || process.env.DB_PROVIDER || environment;
  
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    const errorMessage = `❌ DATABASE_URL not found for ${provider}!`;
    console.error(errorMessage);
    throw new Error(`Database configuration missing for ${provider}`);
  }
  
  const providerConfig = DATABASE_PROVIDERS[provider] || DATABASE_PROVIDERS.local;
  
  return {
    connectionString: databaseUrl,
    ssl: providerConfig.ssl,
    max: providerConfig.maxConnections,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    query_timeout: 20000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    // statement_timeout: 20000 // disabled for PgBouncer,
    provider: provider,
    environment: environment
  };
}

// Create environment-specific .env template
function createEnvTemplate(provider = 'neon') {
  const templates = {
    neon: `# Neon PostgreSQL Configuration
DATABASE_URL=postgresql://username:password@ep-xxx.us-west-2.aws.neon.tech/database?sslmode=require
PGDATABASE=your_database_name
PGHOST=ep-xxx.us-west-2.aws.neon.tech
PGPORT=5432
PGUSER=your_username
PGPASSWORD=your_password`,

    railway: `# Railway PostgreSQL Configuration  
DATABASE_URL=postgresql://postgres:password@containers-us-west-xxx.railway.app:port/railway
PGDATABASE=railway
PGHOST=containers-us-west-xxx.railway.app
PGPORT=port_number
PGUSER=postgres
PGPASSWORD=your_password`,

    heroku: `# Heroku PostgreSQL Configuration
DATABASE_URL=postgres://username:password@ec2-xxx.compute-1.amazonaws.com:5432/database
PGDATABASE=database_name
PGHOST=ec2-xxx.compute-1.amazonaws.com
PGPORT=5432
PGUSER=username
PGPASSWORD=password`,

    local: `# Local PostgreSQL Configuration
DATABASE_URL=postgresql://localhost:5432/your_local_db
PGDATABASE=your_local_db
PGHOST=localhost
PGPORT=5432
PGUSER=your_username
PGPASSWORD=your_password`
  };

  return templates[provider] + `

# Firebase Configuration (same across all platforms)
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id
FIREBASE_MEASUREMENT_ID=your_measurement_id

# Application Configuration
PORT=3000
NODE_ENV=production`;
}

// Migration helper functions
function createMigrationPlan(fromProvider, toProvider) {
  return {
    from: DATABASE_PROVIDERS[fromProvider],
    to: DATABASE_PROVIDERS[toProvider],
    steps: [
      '1. Export data from current database',
      '2. Set up new database with target provider',
      '3. Create tables in new database',
      '4. Import data to new database',
      '5. Update environment variables',
      '6. Test application with new database',
      '7. Update DNS/deployment if needed'
    ],
    envTemplate: createEnvTemplate(toProvider)
  };
}

// Test database connection
async function testDatabaseConnection(config = null) {
  try {
    const dbConfig = config || getDatabaseConfig();
    const pg = await import('pg');
    const { Pool } = pg.default;
    
    const pool = new Pool(dbConfig);
    const client = await pool.connect();
    
    console.log('✅ Database connection successful!');
    console.log(`📊 Provider: ${dbConfig.provider}`);
    console.log(`🌍 Environment: ${dbConfig.environment}`);
    
    client.release();
    await pool.end();
    
    return { success: true, provider: dbConfig.provider };
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Export current database schema and data
async function exportDatabase() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const exportPath = `./database-export-${timestamp}.sql`;
  
  console.log('📦 Exporting database...');
  
  // This would use pg_dump or similar tool
  // For now, we'll create a backup script placeholder
  const backupScript = `#!/bin/bash
# Database Export Script - Generated ${new Date().toISOString()}
# Run this script to export your database

echo "Exporting database..."
pg_dump $DATABASE_URL > database-backup-${timestamp}.sql
echo "Export completed: database-backup-${timestamp}.sql"
`;
  
  fs.writeFileSync(`export-database-${timestamp}.sh`, backupScript);
  console.log(`📄 Export script created: export-database-${timestamp}.sh`);
  
  return `export-database-${timestamp}.sh`;
}

// ES Module exports - use both named and default for compatibility
export {
  DATABASE_PROVIDERS,
  detectEnvironment,
  getDatabaseConfig,
  createEnvTemplate,
  createMigrationPlan,
  testDatabaseConnection,
  exportDatabase
};

// Default export for better compatibility
export default {
  DATABASE_PROVIDERS,
  detectEnvironment,
  getDatabaseConfig,
  createEnvTemplate,
  createMigrationPlan,
  testDatabaseConnection,
  exportDatabase
};