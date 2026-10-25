import express from 'express';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { authenticateToken, requireAdmin, optionalAuthenticateToken } from '../auth.js';
import { getKolkataDate } from '../timeUtils.js';

const router = express.Router();

const isTestEnv = process.env.NODE_ENV === 'test';

// Rate Limiter for public notifications GET endpoint (60 requests/min per IP)
const publicGetLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  skip: (req) => isTestEnv && !req.headers['x-test-rate-limit'],
  message: { error: 'Too many requests. Please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Purge notifications that are older than exactly 1 month from creation.
 */
export function purgeExpiredNotifications() {
  try {
    const result = db.prepare(`
      DELETE FROM global_notifications
      WHERE datetime(created_at) < datetime('now', '-1 month')
    `).run();
    return result.changes;
  } catch (err) {
    console.error('Error purging expired notifications:', err.message);
    return 0;
  }
}

// GET /api/notifications
// Public access: Returns global academic intimations
// Role-based visibility:
// - Anonymous Visitors / Guests: Automatically cleared at 12:00 AM IST (only current day's notifications visible)
// - Admin & Faculty (authenticated): All active notifications within 1-month lifespan visible with date metadata
// Automatically purges expired notifications (older than 1 month) upon access
router.get('/', publicGetLimiter, optionalAuthenticateToken, (req, res) => {
  try {
    // 1. Auto-cleanup: remove notifications older than 1 month
    purgeExpiredNotifications();

    // Determine current local application date in Asia/Kolkata
    // Supports optional ?date=YYYY-MM-DD parameter for explicit date simulation / verification
    const localToday = req.query.date || getKolkataDate();

    const isPrivileged = req.user && (req.user.role === 'faculty' || req.user.role === 'admin');

    // 2. Fetch active notifications
    if (!isPrivileged) {
      // Public / Guest view: Automatic daily clear after 12:00 AM (midnight IST)
      // Only notifications created on the current local day are returned
      const notifications = db.prepare(`
        SELECT id, type, faculty_name, leave_date, message, created_at,
               date(created_at, '+330 minutes') as created_date
        FROM global_notifications
        WHERE date(created_at, '+330 minutes') = ?
        ORDER BY id DESC
        LIMIT 100
      `).all(localToday);

      return res.json({ notifications, role: 'guest', local_date: localToday });
    }

    // Admin & Faculty: Persistent across days with date metadata for visual divider
    const notifications = db.prepare(`
      SELECT id, type, faculty_id, faculty_name, leave_date, message, created_at,
             date(created_at, '+330 minutes') as created_date
      FROM global_notifications
      ORDER BY id DESC
      LIMIT 100
    `).all();

    res.json({
      notifications,
      role: req.user.role,
      local_date: localToday
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notifications/clear
// Manual bulk clearing is forbidden per system specifications
router.post('/clear', authenticateToken, (req, res) => {
  res.status(403).json({
    error: 'Manual bulk clearing of notifications is not permitted. Notifications automatically expire after 1 month.'
  });
});

// DELETE /api/notifications/:id
// Admin can delete individual notifications globally
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const notifId = parseInt(req.params.id, 10);
    if (isNaN(notifId)) {
      return res.status(400).json({ error: 'Valid notification ID required.' });
    }

    const existing = db.prepare('SELECT id FROM global_notifications WHERE id = ?').get(notifId);
    if (!existing) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    db.prepare('DELETE FROM global_notifications WHERE id = ?').run(notifId);

    res.json({
      success: true,
      message: 'Notification deleted successfully from all users.',
      id: notifId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
