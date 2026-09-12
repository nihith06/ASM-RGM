import express from 'express';
import db from '../db.js';
import { authenticateToken, requireAdmin } from '../auth.js';

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
// Returns global academic intimations
// Role-based visibility:
// - Students: Automatically cleared at 12:00 AM (only current day's notifications visible)
// - Admin & Faculty: All active notifications within 1-month lifespan visible with date metadata
// Automatically purges expired notifications (older than 1 month) upon access
router.get('/', authenticateToken, (req, res) => {
  try {
    // 1. Auto-cleanup: remove notifications older than 1 month
    purgeExpiredNotifications();

    // Determine current local application date
    // Supports optional ?date=YYYY-MM-DD parameter for explicit date simulation / verification
    const localToday = req.query.date || db.prepare("SELECT date('now', 'localtime') as d").get().d;

    // 2. Fetch active notifications
    if (req.user && req.user.role === 'student') {
      // Student view: Automatic daily clear after 12:00 AM (midnight)
      // Only notifications created on the current local day are returned
      const notifications = db.prepare(`
        SELECT id, type, faculty_id, faculty_name, leave_date, message, created_at,
               date(created_at, 'localtime') as created_date
        FROM global_notifications
        WHERE date(created_at, 'localtime') = ?
        ORDER BY id DESC
        LIMIT 100
      `).all(localToday);

      return res.json({ notifications, role: 'student', local_date: localToday });
    }

    // Admin & Faculty: Persistent across days with date metadata for visual divider
    const notifications = db.prepare(`
      SELECT id, type, faculty_id, faculty_name, leave_date, message, created_at,
             date(created_at, 'localtime') as created_date
      FROM global_notifications
      ORDER BY id DESC
      LIMIT 100
    `).all();

    res.json({
      notifications,
      role: req.user ? req.user.role : 'guest',
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
// Admin can delete individual notifications globally (removes for Admin, Faculty, and Students)
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
