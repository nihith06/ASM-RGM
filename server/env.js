import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Node.js Version and native node:sqlite Availability Check
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22) {
  console.error(`\n❌ FATAL STARTUP ERROR:`);
  console.error(`RGMCET ASMS requires Node.js >= 22.13.0 for native SQLite support.`);
  console.error(`Current Node.js version is v${process.versions.node}.`);
  console.error(`Please install Node.js 22 LTS or newer.\n`);
  process.exit(1);
}

try {
  const { DatabaseSync } = await import('node:sqlite');
  if (typeof DatabaseSync !== 'function') {
    throw new Error('DatabaseSync constructor is unavailable on node:sqlite');
  }
} catch (sqliteErr) {
  console.error(`\n❌ FATAL STARTUP ERROR:`);
  console.error(`Native node:sqlite is not available: ${sqliteErr.message}`);
  if (nodeMajor === 22 && nodeMinor < 13) {
    console.error(`On Node.js versions prior to 22.13.0, launch node with the '--experimental-sqlite' flag:`);
    console.error(`  node --experimental-sqlite server/index.js`);
  } else {
    console.error(`Please update to Node.js LTS (>= 22.13.0) where node:sqlite is enabled by default.`);
  }
  console.error('');
  process.exit(1);
}

// Attempt loading .env file using native process.loadEnvFile
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    console.warn(`[Config] Notice: Could not parse .env file: ${err.message}`);
  }
}

// Enforce Asia/Kolkata timezone default
if (!process.env.TZ) {
  process.env.TZ = 'Asia/Kolkata';
}

const isProduction = process.env.NODE_ENV === 'production';

// Strict Production Security Checks for JWT_SECRET
if (isProduction) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 32) {
    console.error('\n❌ FATAL CONFIGURATION ERROR:');
    console.error('When NODE_ENV=production, JWT_SECRET must be defined and at least 32 characters in length.');
    console.error('Please configure a strong JWT_SECRET in your environment or .env file.\n');
    process.exit(1);
  }
} else {
  if (!process.env.JWT_SECRET) {
    console.warn('[Config] ⚠️ WARNING: JWT_SECRET is not set. Using temporary development key.');
    process.env.JWT_SECRET = 'rgmcet_aiml_academic_schedule_secret_key_dev_2026';
  }
}

export const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  isProduction,
  PORT: parseInt(process.env.PORT, 10) || 5000,
  HOST: process.env.HOST || '127.0.0.1',
  JWT_SECRET: process.env.JWT_SECRET,
  TRUST_PROXY: process.env.TRUST_PROXY !== undefined ? parseInt(process.env.TRUST_PROXY, 10) : 1,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : [],
  DB_PATH: process.env.DB_PATH || path.join(__dirname, 'data', 'academic.db'),
  SMS_PROVIDER: (process.env.SMS_PROVIDER || (isProduction ? 'none' : 'console')).toLowerCase().trim(),
  ADMIN_INITIAL_PASSWORD: process.env.ADMIN_INITIAL_PASSWORD || '1352468',
  TZ: process.env.TZ
};

export default config;
