#!/usr/bin/env node

import 'dotenv/config';
import { pool, initializeDatabase } from './db.js';

async function testDatabaseSetup() {
  console.log('\n🔍 Testing Database Setup...\n');
  
  try {
    // Test 1: Connection
    console.log('1️⃣ Testing database connection...');
    const result = await pool.query('SELECT version()');
    console.log('✅ Connected to PostgreSQL:', result.rows[0].version.split('(')[0].trim());
    
    // Test 2: Initialize tables
    console.log('\n2️⃣ Initializing database schema...');
    await initializeDatabase();
    console.log('✅ All tables created successfully');
    
    // Test 3: List all tables
    console.log('\n3️⃣ Tables created:');
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    tables.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.table_name}`);
    });
    console.log(`\n✅ Total: ${tables.rows.length} tables\n`);
    
    // Test 4: Check environment
    console.log('4️⃣ Environment variables:');
    console.log(`   PORT: ${process.env.PORT || '3000'}`);
    console.log(`   BLOCKCHAIN_PORT: ${process.env.BLOCKCHAIN_PORT || '5000'}`);
    console.log(`   DEPLOYMENT_ENV: ${process.env.DEPLOYMENT_ENV || 'local'}`);
    console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '✅ Configured' : '❌ Missing'}`);
    
    console.log('\n🎉 Database setup complete! Ready to run:\n');
    console.log('   PORT=3000 BLOCKCHAIN_PORT=5000 node server.js\n');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Database setup failed:');
    console.error('Error:', error.message);
    console.error('\n💡 Solutions:');
    console.error('1. Check DATABASE_URL in .env');
    console.error('2. Verify database credentials');
    console.error('3. Make sure PostgreSQL is running');
    console.error('\n📖 See POSTGRES_SETUP.md for detailed instructions\n');
    process.exit(1);
  }
}

testDatabaseSetup();
