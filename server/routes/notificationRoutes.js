import express from 'express';
import db from '../db.js';
import { authenticateToken } from '../auth.js';

const router = express.Router();

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
// Returns global faculty leave notifications (accessible to all logged-in users)
// Automatically purges expired notifications (older than 1 month) upon access
router.get('/', authenticateToken, (req, res) => {
  try {
    // 1. Auto-cleanup: remove notifications older than 1 month
    purgeExpiredNotifications();

    // 2. Fetch active notifications within 1-month lifespan
    const notifications = db.prepare(`
      SELECT id, type, faculty_id, faculty_name, leave_date, message, created_at
      FROM global_notifications
      ORDER BY id DESC
      LIMIT 100
    `).all();

    res.json({ notifications });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notifications/clear
// Manual clearing is forbidden per system specifications
router.post('/clear', authenticateToken, (req, res) => {
  res.status(403).json({
    error: 'Manual deletion of notifications is not permitted. Notifications automatically expire after 1 month.'
  });
});

// DELETE /api/notifications/:id
// Manual dismissal is forbidden per system specifications
router.delete('/:id', authenticateToken, (req, res) => {
  res.status(403).json({
    error: 'Manual dismissal of notifications is not permitted. Notifications automatically expire after 1 month.'
  });
});

export default router;
