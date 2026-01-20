#!/usr/bin/env node

/**
 * Database Configuration Helper
 * Helps you set up PostgreSQL connection string
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
  console.log('\n🗄️ PostgreSQL Connection Setup Helper\n');
  console.log('Choose your database provider:\n');
  console.log('1. Railway.app (⭐ Recommended)');
  console.log('2. Neon (⚡ Fastest)');
  console.log('3. Render.com (⭐ Production)');
  console.log('4. Supabase (🔥 Full Stack)');
  console.log('5. Custom PostgreSQL\n');

  const choice = await question('Enter your choice (1-5): ');

  let provider, url;

  switch (choice) {
    case '1':
      provider = 'Railway.app';
      console.log('\n📖 Instructions for Railway:\n');
      console.log('1. Go to https://railway.app');
      console.log('2. Sign up with GitHub');
      console.log('3. Click "+ New Project"');
      console.log('4. Select "PostgreSQL"');
      console.log('5. Wait 30 seconds');
      console.log('6. Click on the PostgreSQL card');
      console.log('7. Go to "Connect" tab');
      console.log('8. Copy the "DATABASE_URL"\n');
      break;

    case '2':
      provider = 'Neon';
      console.log('\n📖 Instructions for Neon:\n');
      console.log('1. Go to https://neon.tech');
      console.log('2. Sign up with GitHub');
      console.log('3. Create new project');
      console.log('4. Copy "Connection string" (starts with postgresql://)\n');
      break;

    case '3':
      provider = 'Render.com';
      console.log('\n📖 Instructions for Render:\n');
      console.log('1. Go to https://render.com');
      console.log('2. Sign up');
      console.log('3. New → PostgreSQL');
      console.log('4. Copy "External Database URL"\n');
      break;

    case '4':
      provider = 'Supabase';
      console.log('\n📖 Instructions for Supabase:\n');
      console.log('1. Go to https://supabase.com');
      console.log('2. Sign up');
      console.log('3. Create new project');
      console.log('4. Go to Settings → Database');
      console.log('5. Copy "Connection string" (URI mode)\n');
      break;

    case '5':
      provider = 'Custom PostgreSQL';
      console.log('\n🔧 Manual Setup:\n');
      const host = await question('Database host (e.g., localhost): ');
      const port = await question('Port (default 5432): ') || '5432';
      const user = await question('Username (e.g., postgres): ');
      const password = await question('Password: ');
      const database = await question('Database name (e.g., access_network): ');
      
      url = `postgresql://${user}:${password}@${host}:${port}/${database}`;
      break;

    default:
      console.log('❌ Invalid choice');
      rl.close();
      return;
  }

  if (!url && choice !== '5') {
    url = await question('Paste your DATABASE_URL here: ');
  }

  if (!url) {
    console.log('❌ No URL provided');
    rl.close();
    return;
  }

  // Update .env file
  const envPath = path.join(process.cwd(), '.env');
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  if (envContent.includes('DATABASE_URL=')) {
    envContent = envContent.replace(/DATABASE_URL=.*/, `DATABASE_URL=${url}`);
  } else {
    envContent += (envContent.endsWith('\n') ? '' : '\n') + `DATABASE_URL=${url}`;
  }

  fs.writeFileSync(envPath, envContent);

  console.log('\n✅ Successfully updated .env\n');
  console.log('📋 Your configuration:');
  console.log(`   Provider: ${provider}`);
  console.log(`   URL: ${url.substring(0, 50)}...`);
  console.log('\n🚀 Next steps:\n');
  console.log('1. Run: node test-db-setup.js');
  console.log('2. Run: PORT=3000 BLOCKCHAIN_PORT=5000 node server.js\n');

  rl.close();
}

main().catch(console.error);
