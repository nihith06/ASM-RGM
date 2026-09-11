import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { authenticateToken, requireFacultyOrAdmin, requireAdmin } from '../auth.js';

const router = express.Router();

// GET Student Directory
// PRIVACY RULE: Only logged-in Faculty members and Admin can access!
router.get('/students', authenticateToken, requireFacultyOrAdmin, (req, res) => {
  try {
    const { year, search } = req.query;
    let query = `
      SELECT id, register_id, name, phone, year, department, designation, created_at
      FROM users
      WHERE role = 'student'
    `;
    const params = [];

    if (year) {
      query += ' AND year = ?';
      params.push(parseInt(year, 10));
    }

    if (search && search.trim()) {
      query += ' AND (LOWER(name) LIKE ? OR LOWER(register_id) LIKE ? OR phone LIKE ?)';
      const term = `%${search.trim().toLowerCase()}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY year ASC, register_id ASC';

    const students = db.prepare(query).all(...params);
    res.json({ count: students.length, students });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET Faculty Directory
// PRIVACY RULE: Only logged-in Faculty members and Admin can access!
router.get('/faculty', authenticateToken, requireFacultyOrAdmin, (req, res) => {
  try {
    const { search } = req.query;
    let query = `
      SELECT id, register_id, name, phone, department, designation, qualification, status, role, created_at
      FROM users
      WHERE role = 'faculty'
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
    res.json({ count: faculty.length, faculty });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET overall statistics (for Admin & Faculty dashboard overviews)
router.get('/stats', authenticateToken, (req, res) => {
  try {
    const studentCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get().count;
    const facultyCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'faculty'").get().count;
    const sectionCount = db.prepare("SELECT COUNT(*) as count FROM sections").get().count;
    const timetableCount = db.prepare("SELECT COUNT(*) as count FROM timetables").get().count;

    // Year-wise student distribution
    const yearCounts = db.prepare(`
      SELECT year, COUNT(*) as count
      FROM users
      WHERE role = 'student' AND year IS NOT NULL
      GROUP BY year
      ORDER BY year ASC
    `).all();

    res.json({
      students: studentCount,
      faculty: facultyCount,
      sections: sectionCount,
      timetable_slots: timetableCount,
      year_distribution: yearCounts
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin User Management: Update user details (Admin only)
router.put('/users/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { name, phone, year, designation, qualification, status } = req.body;

    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    const cleanName = name ? name.trim() : existing.name;
    const cleanPhone = phone !== undefined ? phone.trim() : existing.phone;
    const cleanYear = year !== undefined ? (year ? parseInt(year, 10) : null) : existing.year;
    const cleanDesig = designation !== undefined ? designation.trim() : existing.designation;
    const cleanQual = qualification !== undefined ? qualification.trim() : existing.qualification;
    const cleanStatus = status !== undefined ? status.trim() : (existing.status || 'active');

    db.prepare(`
      UPDATE users
      SET name = ?,
          phone = ?,
          year = ?,
          designation = ?,
          qualification = ?,
          status = ?
      WHERE id = ?
    `).run(
      cleanName,
      cleanPhone,
      cleanYear,
      cleanDesig,
      cleanQual,
      cleanStatus,
      userId
    );

    // If faculty name changed, cascade update timetable references to maintain integrity
    if (existing.role === 'faculty' && cleanName !== existing.name) {
      db.prepare('UPDATE timetables SET faculty_name = ? WHERE faculty_name = ?').run(cleanName, existing.name);
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
    res.json({ message: `User "${existing.name}" (${existing.register_id}) has been removed.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin & Faculty Student Password Management
// Allows authorized Admin or Faculty to reset a student's password with audit logging
router.post('/students/:id/reset-password', authenticateToken, requireFacultyOrAdmin, (req, res) => {
  try {
    const studentId = parseInt(req.params.id, 10);
    const { new_password } = req.body;

    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    const student = db.prepare('SELECT id, register_id, name, role FROM users WHERE id = ?').get(studentId);
    if (!student) {
      return res.status(404).json({ error: 'Student record not found.' });
    }

    if (student.role !== 'student') {
      return res.status(403).json({ error: 'This management endpoint can only reset passwords for student accounts.' });
    }

    // Hash new password securely
    const passwordHash = bcrypt.hashSync(new_password, 10);

    // Update password in database
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, student.id);

    // Record action in audit log
    const actionName = req.user.role === 'admin' ? 'ADMIN_RESET_STUDENT_PASSWORD' : 'FACULTY_RESET_STUDENT_PASSWORD';
    db.prepare(`
      INSERT INTO audit_logs (action, performed_by_id, target_user_id, details)
      VALUES (?, ?, ?, ?)
    `).run(
      actionName,
      req.user.id,
      student.id,
      `Password reset for Student: ${student.name} (${student.register_id}) by ${req.user.name} (${req.user.role.toUpperCase()})`
    );

    res.json({
      message: `Password for student "${student.name}" (${student.register_id}) has been reset successfully!`,
      student: { id: student.id, register_id: student.register_id, name: student.name }
    });
  } catch (error) {
    console.error('Student password reset error:', error);
    res.status(500).json({ error: error.message });
  }
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
    res.status(500).json({ error: error.message });
  }
});

export default router;
