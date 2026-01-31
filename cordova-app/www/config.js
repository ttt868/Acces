
import 'dotenv/config';

// Environment detection
const isReplit = process.env.REPL_ID || process.env.REPLIT_DB_URL;
const isLocal = !isReplit;

// Database configuration
export const getDatabaseConfig = () => {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not found!');
    
    if (isReplit) {
      console.error('Please add DATABASE_URL to your Replit Secrets:');
      console.error('1. Go to Tools > Secrets');
      console.error('2. Add key: DATABASE_URL');
      console.error('3. Add your PostgreSQL connection string as value');
    } else {
      console.error('Please create a .env file with your DATABASE_URL');
    }
    
    throw new Error('Database configuration missing');
  }
  
  return {
    connectionString: databaseUrl,
    ssl: {
      rejectUnauthorized: false
    },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    query_timeout: 20000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    statement_timeout: 20000
  };
};

// Firebase configuration
export const getFirebaseConfig = () => {
  return {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
  };
};

// Port configuration
export const getPort = () => {
  return process.env.PORT || 3000;
};

// Environment info
export const getEnvironmentInfo = () => {
  return {
    isReplit,
    isLocal,
    environment: process.env.NODE_ENV || 'development'
  };
};
