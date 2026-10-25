import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { authenticateToken, requireFacultyOrAdmin, requireAdmin } from '../auth.js';
import { getKolkataDate } from '../timeUtils.js';

const router = express.Router();

// GET Student Directory - Retired (returns 404)
router.get('/students', (req, res) => {
  return res.status(404).json({ error: 'Student directory has been removed. Student accounts are not maintained.' });
});

// GET Faculty Directory
// PRIVACY RULE: Only logged-in Faculty members and Admin can access!
// Status logic:
// 1. Source of truth is the current-day saved Leave record in faculty_leaves
// 2. Default status for all faculty: 'active' (displayed as 'Active')
// 3. ONLY when a faculty member has saved Leave for the CURRENT DATE -> status = 'inactive' (displayed as 'Inactive')
// 4. Busy status or other availability state does NOT cause Inactive
// 5. Previous-day Leave does NOT carry over (automatically resets to Active on date rollover)
router.get('/faculty', authenticateToken, requireFacultyOrAdmin, (req, res) => {
  try {
    const { search, date: reqDate } = req.query;
    // Determine calendar date (YYYY-MM-DD) strictly in Asia/Kolkata
    const todayStr = (reqDate && /^\d{4}-\d{2}-\d{2}$/.test(reqDate.trim())) 
      ? reqDate.trim() 
      : getKolkataDate();

    let query = `
      SELECT id, register_id, name, phone, department, designation, qualification, status, role, created_at
      FROM users
      WHERE role = 'faculty'
        AND register_id != 'FAC001'
        AND LOWER(name) NOT LIKE '%kishor kumar%'
        AND (LOWER(name) NOT LIKE '%kishor%' OR LOWER(name) LIKE '%bala kishore%')
        AND LOWER(name) NOT LIKE '%shoba%'
        AND LOWER(name) NOT LIKE '%prof. administrator%'
    `;
    const params = [];

    if (search && search.trim()) {
      query += ' AND (LOWER(name) LIKE ? OR LOWER(register_id) LIKE ? OR phone LIKE ?)';
      const term = `%${search.trim().toLowerCase()}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY name ASC';

    const faculty = db.prepare(query).all(...params);

    // Fetch active leaves strictly for todayStr where status = 'leave'
    // Ignores 'busy' status and any other availability state
    const activeLeaves = db.prepare(`
      SELECT faculty_id, faculty_name, leave_date, status
      FROM faculty_leaves
      WHERE leave_date = ? AND LOWER(TRIM(status)) = 'leave'
    `).all(todayStr);

    const leaveFacultyIds = new Set(activeLeaves.map(l => String(l.faculty_id)));
    const leaveFacultyNames = new Set(activeLeaves.map(l => (l.faculty_name || '').trim().toLowerCase()));

    // Calculate daily status dynamically:
    // - Default: 'active' (displayed as 'Active')
    // - Saved leave today: 'inactive' (displayed as 'Inactive')
    // - Pending reserved slot: 'pending' (displayed as 'Pending Details')
    const facultyWithDailyStatus = faculty.map(f => {
      const isPending = f.status === 'pending';
      const isOnLeaveToday = !isPending && (
        leaveFacultyIds.has(String(f.id)) ||
        leaveFacultyIds.has(String(f.register_id)) ||
        leaveFacultyNames.has((f.name || '').trim().toLowerCase())
      );

      const computedStatus = isPending ? 'pending' : (isOnLeaveToday ? 'inactive' : 'active');
      const displayStatus = isPending ? 'Pending Details' : (isOnLeaveToday ? 'Inactive' : 'Active');

      return {
        ...f,
        status: computedStatus,
        daily_status: displayStatus,
        display_status: displayStatus,
        is_on_leave: isOnLeaveToday,
        date: todayStr
      };
    });

    res.json({ count: facultyWithDailyStatus.length, faculty: facultyWithDailyStatus, date: todayStr });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET overall statistics (for Admin & Faculty dashboard overviews)
router.get('/stats', authenticateToken, (req, res) => {
  try {
    const facultyCount = db.prepare(`
      SELECT COUNT(*) as count FROM users 
      WHERE role = 'faculty'
        AND register_id != 'FAC001'
        AND LOWER(name) NOT LIKE '%kishor kumar%'
        AND (LOWER(name) NOT LIKE '%kishor%' OR LOWER(name) LIKE '%bala kishore%')
        AND LOWER(name) NOT LIKE '%shoba%'
        AND LOWER(name) NOT LIKE '%prof. administrator%'
    `).get().count;
    const sectionCount = db.prepare("SELECT COUNT(*) as count FROM sections").get().count;
    const timetableCount = db.prepare("SELECT COUNT(*) as count FROM timetables").get().count;

    res.json({
      faculty: facultyCount,
      sections: sectionCount,
      timetable_slots: timetableCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin User Management: Update user details (Admin only)
router.put('/users/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { register_id, name, phone, designation, qualification, status } = req.body;

    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Process and validate register_id (Employee ID)
    let cleanRegisterId = existing.register_id;
    if (register_id !== undefined) {
      cleanRegisterId = String(register_id).trim().toUpperCase();
      if (!cleanRegisterId) {
        return res.status(400).json({ error: 'Employee ID is required and cannot be empty.' });
      }

      // Check duplicate register_id across other users
      const duplicate = db.prepare('SELECT id, name, role FROM users WHERE register_id = ? AND id != ?').get(cleanRegisterId, userId);
      if (duplicate) {
        return res.status(400).json({
          error: `Employee ID "${cleanRegisterId}" already belongs to another user: ${duplicate.name} (${duplicate.role}).`
        });
      }
    }

    const cleanName = name ? name.trim() : existing.name;
    const cleanPhone = phone !== undefined ? phone.trim() : existing.phone;
    const cleanDesig = designation !== undefined ? designation.trim() : existing.designation;
    const cleanQual = qualification !== undefined ? qualification.trim() : existing.qualification;
    const cleanStatus = status !== undefined ? status.trim() : (existing.status || 'active');

    db.prepare(`
      UPDATE users
      SET register_id = ?,
          name = ?,
          phone = ?,
          designation = ?,
          qualification = ?,
          status = ?
      WHERE id = ?
    `).run(
      cleanRegisterId,
      cleanName,
      cleanPhone,
      cleanDesig,
      cleanQual,
      cleanStatus,
      userId
    );

    // If faculty name changed, cascade update timetable references to maintain integrity
    if (existing.role === 'faculty' && cleanName !== existing.name) {
      db.prepare('UPDATE timetables SET faculty_name = ? WHERE faculty_name = ?').run(cleanName, existing.name);
    }

    // Log update event to Security Audit Trail
    try {
      db.prepare(`
        INSERT INTO audit_logs (action, performed_by_id, target_user_id, details)
        VALUES ('UPDATE_USER_PROFILE', ?, ?, ?)
      `).run(
        req.user.id,
        userId,
        `Updated ${existing.role} profile: ${cleanName} (ID: ${cleanRegisterId})`
      );
    } catch (e) {
      // ignore
    }

    const updated = db.prepare('SELECT id, register_id, name, role, phone, year, department, designation, qualification, status FROM users WHERE id = ?').get(userId);
    res.json({ message: 'User updated successfully', user: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin User Management: Delete user (Admin only)
router.delete('/users/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own active administrator account.' });
    }

    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    try {
      db.prepare(`
        INSERT INTO audit_logs (action, performed_by_id, details)
        VALUES ('ADMIN_DELETE_USER', ?, ?)
      `).run(req.user.id, `Admin ${req.user.name} removed user: ${existing.name} (${existing.register_id}, role: ${existing.role})`);
    } catch (e) {}

    res.json({ message: `User "${existing.name}" (${existing.register_id}) has been removed.` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// POST Student Password Reset - Retired (returns 404)
router.post('/students/:id/reset-password', (req, res) => {
  return res.status(404).json({ error: 'Student password reset endpoint has been removed. Student accounts are not maintained.' });
});

// GET Audit Logs (Admin only)
router.get('/audit-logs', authenticateToken, requireAdmin, (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT 
        a.id, a.action, a.details, a.created_at,
        p.name as performed_by_name, p.register_id as performed_by_id, p.role as performed_by_role,
        t.name as target_user_name, t.register_id as target_user_id
      FROM audit_logs a
      LEFT JOIN users p ON a.performed_by_id = p.id
      LEFT JOIN users t ON a.target_user_id = t.id
      ORDER BY a.created_at DESC
      LIMIT 100
    `).all();

    res.json({ count: logs.length, logs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve audit logs.' });
  }
});

// GET Export Audit Logs (Admin only)
router.get('/audit-logs/export', authenticateToken, requireAdmin, (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT 
        a.id, a.action, a.details, a.created_at,
        p.name as performed_by_name, p.register_id as performed_by_id, p.role as performed_by_role,
        t.name as target_user_name, t.register_id as target_user_id
      FROM audit_logs a
      LEFT JOIN users p ON a.performed_by_id = p.id
      LEFT JOIN users t ON a.target_user_id = t.id
      ORDER BY a.created_at DESC
    `).all();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="asms_audit_logs.json"');
    res.json({ exported_at: new Date().toISOString(), total_records: logs.length, logs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to export audit logs.' });
  }
});

// DELETE Audit Logs (Forbidden - Immutable Trail)
router.delete('/audit-logs', authenticateToken, requireAdmin, (req, res) => {
  return res.status(403).json({
    error: 'Audit logs cannot be deleted. Security audit records are immutable and must be preserved for compliance and non-repudiation.'
  });
});

export default router;
