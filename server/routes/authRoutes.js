import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import db, { 
  getActiveSessionByUserId, 
  createActiveSession, 
  touchSession, 
  markSessionUnloading, 
  invalidateSession, 
  invalidateUserSessions, 
  cleanStaleSessions 
} from '../db.js';
import { generateToken, authenticateToken, requireAdmin } from '../auth.js';

const router = express.Router();

// Registration: Students, Faculty, and Admin (admins can register new admins)
router.post('/register', (req, res) => {
  try {
    const { name, register_id, password, role, phone, year, designation } = req.body;

    if (!name || !register_id || !password || !role) {
      return res.status(400).json({ error: 'Name, Register ID / Employee ID, password, and role are required.' });
    }

    const cleanId = register_id.trim().toUpperCase();
    const cleanRole = role.trim().toLowerCase();

    // Check permissions for admin creation
    if (cleanRole === 'admin') {
      const authHeader = req.headers['authorization'];
      if (!authHeader) {
        return res.status(403).json({ error: 'Self-registration is not permitted for Administrator role. Only existing admins can create new admin accounts.' });
      }
    } else if (!['student', 'faculty'].includes(cleanRole)) {
      return res.status(400).json({ error: 'Invalid role. Role must be student or faculty.' });
    }

    // Students must specify year (1st-4th)
    let studentYear = null;
    if (cleanRole === 'student') {
      studentYear = parseInt(year, 10);
      if (![1, 2, 3, 4].includes(studentYear)) {
        return res.status(400).json({ error: 'Student registration requires year to be 1, 2, 3, or 4.' });
      }
    }

    // Check for duplicate Register ID / Employee ID
    const existing = db.prepare('SELECT id, register_id FROM users WHERE UPPER(register_id) = ?').get(cleanId);
    if (existing) {
      return res.status(409).json({
        error: `Register ID / Employee ID "${cleanId}" is already taken. Please verify your ID or log in.`
      });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const userDesignation = designation ? designation.trim() : (cleanRole === 'admin' ? 'Administrator' : cleanRole === 'faculty' ? 'Faculty Member' : 'Student');

    const stmt = db.prepare(`
      INSERT INTO users (register_id, name, password_hash, role, phone, year, department, designation, status)
      VALUES (?, ?, ?, ?, ?, ?, 'AIML', ?, 'active')
    `);

    const info = stmt.run(cleanId, name.trim(), passwordHash, cleanRole, phone ? phone.trim() : null, studentYear, userDesignation);
    const newUserId = info.lastInsertRowid;

    // Record in audit log if created by admin
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      try {
        const decoded = jwt.decode(authHeader.split(' ')[1]);
        if (decoded && decoded.id) {
          db.prepare(`
            INSERT INTO audit_logs (action, performed_by_id, target_user_id, details)
            VALUES ('ADMIN_CREATE_USER', ?, ?, ?)
          `).run(decoded.id, newUserId, `Admin created new ${cleanRole}: ${cleanId} (${name.trim()})`);
        }
      } catch (e) {}
    }

    const user = db.prepare('SELECT id, register_id, name, role, phone, year, department, designation, status FROM users WHERE id = ?').get(newUserId);
    const token = generateToken(user);

    return res.status(201).json({
      message: `${cleanRole.charAt(0).toUpperCase() + cleanRole.slice(1)} registered successfully!`,
      token,
      user
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Failed to complete registration: ' + error.message });
  }
});

// Admin endpoint to explicitly create an administrator account
router.post('/register-admin', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, register_id, password, phone, designation } = req.body;

    if (!name || !register_id || !password) {
      return res.status(400).json({ error: 'Name, Admin ID, and password are required.' });
    }

    const cleanId = register_id.trim();
    const existing = db.prepare('SELECT id FROM users WHERE UPPER(register_id) = UPPER(?)').get(cleanId);
    if (existing) {
      return res.status(409).json({ error: `Admin ID "${cleanId}" is already taken.` });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare(`
      INSERT INTO users (register_id, name, password_hash, role, phone, department, designation, status)
      VALUES (?, ?, ?, 'admin', ?, 'AIML', ?, 'active')
    `);

    const info = stmt.run(cleanId, name.trim(), passwordHash, phone ? phone.trim() : null, designation ? designation.trim() : 'Administrator');
    const newUserId = info.lastInsertRowid;

    db.prepare(`
      INSERT INTO audit_logs (action, performed_by_id, target_user_id, details)
      VALUES ('ADMIN_CREATE_ADMIN', ?, ?, ?)
    `).run(req.user.id, newUserId, `Admin ${req.user.name} created new Admin account: ${cleanId} (${name.trim()})`);

    const newAdmin = db.prepare('SELECT id, register_id, name, role, phone, department, designation, status FROM users WHERE id = ?').get(newUserId);
    res.status(201).json({ message: 'Administrator account created successfully!', admin: newAdmin });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login: Student, Faculty, Admin
router.post('/login', (req, res) => {
  try {
    const { register_id, password, expected_role } = req.body;

    if (!register_id || !password) {
      return res.status(400).json({ error: 'Register ID / Employee ID and password are required.' });
    }

    const cleanId = register_id.trim();
    const user = db.prepare('SELECT * FROM users WHERE UPPER(register_id) = UPPER(?)').get(cleanId);

    if (!user) {
      return res.status(401).json({ error: 'Invalid Register ID or password.' });
    }

    // Check account status
    if (user.status && user.status !== 'active') {
      return res.status(403).json({ error: 'Account has been deactivated or suspended. Please contact the administrator.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid Register ID or password.' });
    }

    // If login was initiated from a specific portal, enforce role alignment
    if (expected_role && user.role !== expected_role) {
      return res.status(403).json({
        error: `Account is registered as "${user.role.toUpperCase()}". Please log in through the ${user.role} portal.`
      });
    }

    // Single Active Login Check for Faculty & Admin
    let activeSessionInfo = null;
    if (user.role === 'faculty' || user.role === 'admin') {
      cleanStaleSessions(25000);
      const existingSession = getActiveSessionByUserId(user.id, 25000);
      if (existingSession) {
        return res.status(409).json({
          error: 'This account is already logged in on another device or browser. Please log out from the existing session before signing in again.'
        });
      }
      activeSessionInfo = createActiveSession(user.id, user.role);
    }

    const userSafe = {
      id: user.id,
      register_id: user.register_id,
      name: user.name,
      role: user.role,
      phone: user.phone,
      year: user.year,
      department: user.department,
      designation: user.designation,
      status: user.status || 'active',
      session_id: activeSessionInfo ? activeSessionInfo.sessionId : null
    };

    const token = generateToken(userSafe, activeSessionInfo ? activeSessionInfo.sessionId : null);
    return res.json({
      message: 'Login successful',
      token,
      user: userSafe,
      session_id: activeSessionInfo ? activeSessionInfo.sessionId : null
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Failed to process login: ' + error.message });
  }
});

// Logout: Invalidate active session for Faculty/Admin
router.post('/logout', (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.decode(token);
        if (decoded) {
          if (decoded.session_id) {
            invalidateSession(decoded.session_id);
          } else if (decoded.id && (decoded.role === 'faculty' || decoded.role === 'admin')) {
            invalidateUserSessions(decoded.id);
          }
        }
      } catch (e) {}
    }
    if (req.body?.session_id) {
      invalidateSession(req.body.session_id);
    }
    return res.json({ message: 'Logged out successfully' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Heartbeat: Keep active session alive for Faculty/Admin tabs
router.post('/session/heartbeat', authenticateToken, (req, res) => {
  try {
    if (req.user && req.user.session_id) {
      touchSession(req.user.session_id);
    }
    return res.json({ success: true, timestamp: Date.now() });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Unload: Called when tab is closing or unloading
router.post('/session/unload', (req, res) => {
  try {
    let sessionId = req.body?.session_id;
    if (!sessionId) {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      if (token) {
        const decoded = jwt.decode(token);
        if (decoded?.session_id) sessionId = decoded.session_id;
      }
    }
    if (sessionId) {
      markSessionUnloading(sessionId);
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// FORGOT PASSWORD FLOW (Faculty & Admin Only)
// Students MUST have passwords reset by Admin/Faculty and cannot use OTP.
// ============================================================================

// 1. Request OTP
router.post('/forgot-password/request-otp', (req, res) => {
  try {
    const { phone, role } = req.body;

    if (!phone || !phone.trim()) {
      return res.status(400).json({ error: 'Registered mobile number is required.' });
    }

    const cleanRole = (role || '').trim().toLowerCase();

    // STRICT PRIVACY / SECURITY RULE: Students cannot self-service reset passwords via OTP!
    if (cleanRole === 'student') {
      return res.status(403).json({
        error: 'Student password resets cannot be performed via self-service OTP. Please contact an authorized Faculty mentor or Department Administrator.'
      });
    }

    if (!['faculty', 'admin'].includes(cleanRole)) {
      return res.status(400).json({ error: 'Forgot password is only available for Faculty and Administrator accounts.' });
    }

    const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }

    // Rate Limiting: Max 3 OTP requests in 15 minutes per phone
    const recentRequests = db.prepare(`
      SELECT COUNT(*) as count 
      FROM password_resets 
      WHERE phone = ? AND created_at >= datetime('now', '-15 minutes')
    `).get(cleanPhone);

    if (recentRequests && recentRequests.count >= 3) {
      return res.status(429).json({
        error: 'Too many OTP requests for this mobile number. Please wait 15 minutes before requesting again.'
      });
    }

    // Generic response message that doesn't reveal whether user exists
    const genericResponse = {
      message: `If this mobile number is associated with an active ${cleanRole === 'admin' ? 'Administrator' : 'Faculty'} account, a 6-digit verification code has been dispatched.`,
      expires_in: 600
    };

    // Lookup user by phone and role
    const matchedUser = db.prepare(`
      SELECT id, name, register_id, role, phone, status 
      FROM users 
      WHERE phone = ? AND role = ?
    `).get(cleanPhone, cleanRole);

    if (!matchedUser || matchedUser.status === 'suspended') {
      // Return generic message without revealing that no user was found
      return res.json(genericResponse);
    }

    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Expire any existing unverified OTPs for this user
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND verified = 0').run(matchedUser.id);

    // Store in password_resets table with 10-minute expiry
    db.prepare(`
      INSERT INTO password_resets (phone, otp_code, role, user_id, attempts, verified, expires_at)
      VALUES (?, ?, ?, ?, 0, 0, datetime('now', '+10 minutes'))
    `).run(cleanPhone, otpCode, cleanRole, matchedUser.id);

    console.log(`\n========================================================`);
    console.log(`📱 [SMS OTP GATEWAY SIMULATOR]`);
    console.log(`Recipient: ${matchedUser.name} (${cleanRole.toUpperCase()} - ${matchedUser.register_id})`);
    console.log(`Phone: ${cleanPhone}`);
    console.log(`One-Time Password (OTP): ${otpCode}`);
    console.log(`Valid for: 10 minutes`);
    console.log(`========================================================\n`);

    // In development / demo environment, also return debug_otp for easy verification
    return res.json({
      ...genericResponse,
      debug_otp: otpCode
    });
  } catch (error) {
    console.error('Request OTP error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 2. Verify OTP
router.post('/forgot-password/verify-otp', (req, res) => {
  try {
    const { phone, otp, otp_code, role } = req.body;
    const rawOtp = otp || otp_code;

    if (!phone || !rawOtp) {
      return res.status(400).json({ error: 'Mobile number and verification OTP code are required.' });
    }

    const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
    const cleanRole = (role || '').trim().toLowerCase();
    const cleanOtp = rawOtp.toString().trim();

    // Find the latest active unverified OTP for this phone and role
    const record = db.prepare(`
      SELECT * FROM password_resets
      WHERE phone = ? AND role = ? AND verified = 0 AND expires_at >= datetime('now')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(cleanPhone, cleanRole);

    if (!record) {
      return res.status(400).json({
        error: 'Verification code has expired or was not requested. Please request a new OTP.'
      });
    }

    // Check attempt threshold (Max 5 attempts)
    if (record.attempts >= 5) {
      db.prepare('DELETE FROM password_resets WHERE id = ?').run(record.id);
      return res.status(400).json({
        error: 'Maximum verification attempts exceeded. For security, please request a new OTP.'
      });
    }

    // Validate code
    if (record.otp_code !== cleanOtp) {
      db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(record.id);
      const remainingAttempts = 5 - (record.attempts + 1);
      return res.status(400).json({
        error: `Invalid OTP code. ${remainingAttempts} attempt(s) remaining.`
      });
    }

    // OTP Verified! Generate single-use reset token valid for 15 minutes
    const resetToken = crypto.randomUUID();
    db.prepare(`
      UPDATE password_resets 
      SET verified = 1, reset_token = ?, expires_at = datetime('now', '+15 minutes')
      WHERE id = ?
    `).run(resetToken, record.id);

    return res.json({
      message: 'Mobile number successfully verified!',
      reset_token: resetToken
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 3. Reset Password (with valid reset_token)
router.post('/forgot-password/reset-password', (req, res) => {
  try {
    const { reset_token, new_password, confirm_password } = req.body;

    if (!reset_token) {
      return res.status(400).json({ error: 'Reset session token is missing. Please restart verification.' });
    }

    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    // Find verified session
    const resetRecord = db.prepare(`
      SELECT * FROM password_resets
      WHERE reset_token = ? AND verified = 1 AND expires_at >= datetime('now')
    `).get(reset_token);

    if (!resetRecord) {
      return res.status(400).json({
        error: 'Password reset session has expired or is invalid. Please request a new OTP.'
      });
    }

    // Fetch user
    const targetUser = db.prepare('SELECT id, name, register_id, role FROM users WHERE id = ?').get(resetRecord.user_id);
    if (!targetUser) {
      return res.status(404).json({ error: 'Associated user account not found.' });
    }

    // Hash new password securely
    const passwordHash = bcrypt.hashSync(new_password, 10);

    // Update password in users table
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, targetUser.id);

    // Invalidate reset token immediately
    db.prepare('DELETE FROM password_resets WHERE id = ?').run(resetRecord.id);

    // Invalidate any active sessions for this user
    invalidateUserSessions(targetUser.id);

    // Log action to audit_logs
    db.prepare(`
      INSERT INTO audit_logs (action, performed_by_id, target_user_id, details)
      VALUES ('SELF_PASSWORD_RESET_OTP', ?, ?, ?)
    `).run(targetUser.id, targetUser.id, `User ${targetUser.name} (${targetUser.register_id}) reset password via verified mobile OTP.`);

    return res.json({
      message: 'Password reset successfully! You can now log in with your new password.',
      register_id: targetUser.register_id
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Get current session user
router.get('/me', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT id, register_id, name, role, phone, year, department, designation, status FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;

