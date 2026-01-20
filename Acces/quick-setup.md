
# Quick Database Migration Guide

This guide helps you easily move your application between different hosting platforms while maintaining database access.

## 🎯 Quick Start for New Platform

### Step 1: Choose Your Target Platform
```bash
# See available options
node migration-helper.js

# Create environment template for your chosen platform
node migration-helper.js template railway    # For Railway
node migration-helper.js template heroku     # For Heroku  
node migration-helper.js template local      # For local development
```

### Step 2: Setup Database Credentials
```bash
# This creates .env.railway (or your chosen platform)
# Edit the file with your actual database credentials
# Then rename it to .env
```

### Step 3: Test Connection
```bash
# Test if your database connection works
node migration-helper.js test
```

### Step 4: Export Current Data (if migrating)
```bash
# Create backup of current database
node migration-helper.js export
```

## 🔄 Platform Migration Process

### From Replit to Railway:
1. Create Railway account and PostgreSQL database
2. `node migration-helper.js template railway`
3. Edit `.env.railway` with Railway credentials
4. Rename to `.env`
5. `node migration-helper.js test`
6. Deploy your code to Railway

### From Replit to Heroku:
1. Create Heroku app with PostgreSQL addon
2. `node migration-helper.js template heroku`
3. Edit `.env.heroku` with Heroku credentials
4. Rename to `.env`
5. Deploy to Heroku

### From Any Platform to Local Development:
1. Install PostgreSQL locally
2. `node migration-helper.js template local`
3. Edit `.env.local` with local credentials
4. Rename to `.env`
5. Run locally: `npm start`

## 📁 Files You Need to Copy

When moving to a new platform, copy these files:
- `package.json` (dependencies)
- `database-config.js` (database configuration)
- `migration-helper.js` (migration tools)
- `.env` (your database credentials)
- `RealisticHonorableDeskscan/` (entire app folder)

## 🔧 Environment Variables Required

Your `.env` file should always contain:
```env
# Database (primary requirement)
DATABASE_URL=your_database_connection_string

# Firebase (for authentication)
FIREBASE_API_KEY=your_api_key
FIREBASE_AUTH_DOMAIN=your_domain
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_bucket
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id

# Application
PORT=3000
```

## ⚡ Emergency Migration (Platform Down)

If your current platform goes down:
1. `node migration-helper.js export` (if accessible)
2. Choose new platform
3. `node migration-helper.js template <new-platform>`
4. Setup database on new platform
5. Update `.env` with new credentials
6. Deploy application
7. Import data using backup

## 🔍 Troubleshooting

**Connection fails?**
- Check DATABASE_URL format
- Verify credentials
- Ensure database server is running
- Check firewall/network settings

**Migration issues?**
- Verify both databases are accessible
- Check table structures match
- Ensure sufficient permissions
- Test with small data subset first

## 📞 Quick Commands Reference

```bash
node migration-helper.js test           # Test connection
node migration-helper.js status         # Show current setup
node migration-helper.js template <name> # Create .env template
node migration-helper.js export         # Backup current data
```