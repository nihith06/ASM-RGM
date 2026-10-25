import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import config from './env.js';
import db, { seedDatabase } from './db.js';
import authRoutes from './routes/authRoutes.js';
import timetableRoutes from './routes/timetableRoutes.js';
import facultyRoutes from './routes/facultyRoutes.js';
import directoryRoutes from './routes/directoryRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust reverse proxy (e.g. Nginx on college server)
app.set('trust proxy', config.TRUST_PROXY);

// Security Headers via Helmet (configured for Vite inline scripts and PDF rendering)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// CORS Configuration: restricted to ALLOWED_ORIGINS or same-origin
const allowedOrigins = config.ALLOWED_ORIGINS;
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) {
      if (!config.isProduction) return callback(null, true);
      return callback(new Error('CORS blocked: No external origins permitted.'), false);
    }
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked: Origin ${origin} is not allowed.`), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate Limiters
const isTestEnv = process.env.NODE_ENV === 'test';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  keyGenerator: (req) => `${req.ip}_${(req.body?.register_id || '').toLowerCase().trim()}`,
  validate: { keyGeneratorIpFallback: false },
  skip: (req) => isTestEnv && !req.headers['x-test-rate-limit'],
  message: { error: 'Too many login attempts. Please wait 15 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  skip: (req) => isTestEnv && !req.headers['x-test-rate-limit'],
  message: { error: 'Too many verification code requests. Please wait 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 15,
  skip: (req) => isTestEnv && !req.headers['x-test-rate-limit'],
  message: { error: 'Too many registration requests. Please wait an hour.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Timetable upload routes allow up to 2MB for large CSV / batch cell payloads
app.use('/api/timetables', express.json({ limit: '2mb' }), express.urlencoded({ extended: true, limit: '2mb' }));

// Global body parser limited to 100KB for all standard endpoints (mitigates body flooding DoS)
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Initialize and seed database if empty
seedDatabase();

// Rate limiting on sensitive auth endpoints
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/auth/forgot-password', otpLimiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/timetables', timetableRoutes);
// Convenience alias for /api/sections -> timetableRoutes /sections
app.use('/api/sections', (req, res, next) => {
  req.url = '/sections' + (req.url === '/' ? '' : req.url);
  timetableRoutes(req, res, next);
});
app.use('/api/faculty', facultyRoutes);
app.use('/api/directory', directoryRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check endpoint with database connectivity verification
app.get('/api/health', (req, res) => {
  let dbStatus = 'healthy';
  try {
    db.prepare('SELECT 1').get();
  } catch (err) {
    dbStatus = `unhealthy: ${err.message}`;
  }

  const isHealthy = dbStatus === 'healthy';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'online' : 'degraded',
    database: dbStatus,
    college: 'Rajeev Gandhi Memorial College of Engineering and Technology (RGMCET)',
    department: 'Artificial Intelligence & Machine Learning (AIML)',
    timestamp: new Date().toISOString()
  });
});

// Serve frontend build if it exists (Express 5 compatible fallback)
const clientDistPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.use((req, res, next) => {
    // If request starts with /api, pass it through to 404 handler
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'API route not found' });
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Global Express Error Handler (never leaks internal stack traces in production)
app.use((err, req, res, next) => {
  console.error(`[Unhandled Error] ${req.method} ${req.url}:`, err);
  if (res.headersSent) {
    return next(err);
  }
  const isProd = config.isProduction;
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: isProd
      ? (status < 500 ? err.message : 'An internal server error occurred. Please contact the administrator.')
      : err.message
  });
});

// Process-level unhandled rejection and exception safety
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection at Promise]:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err);
});

// Bind to HOST and PORT
const server = app.listen(config.PORT, config.HOST, () => {
  console.log(`🚀 RGMCET AIML Academic Schedule Server running on http://${config.HOST}:${config.PORT}`);
});

export default server;
