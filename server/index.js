import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { seedDatabase } from './db.js';
import authRoutes from './routes/authRoutes.js';
import timetableRoutes from './routes/timetableRoutes.js';
import facultyRoutes from './routes/facultyRoutes.js';
import directoryRoutes from './routes/directoryRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON body parser
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize and seed database
seedDatabase();

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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
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

app.listen(PORT, () => {
  console.log(`🚀 RGMCET AIML Academic Schedule Server running on http://localhost:${PORT}`);
});
