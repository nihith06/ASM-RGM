import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import config from '../env.js';
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
import { sendOtpSms } from '../services/smsService.js';

const router = express.Router();

function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}

function validateRegisterId(id) {
  if (!id || typeof id !== 'string') return false;
  const clean = id.trim();
  return clean.length >= 3 && clean.length <= 30 && /^[A-Za-z0-9_-]+$/.test(clean);
}

function validateName(name) {
  if (!name || typeof name !== 'string') return false;
  const clean = name.trim();
  return clean.length >= 2 && clean.length <= 100;
}

function validatePhone(phone) {
  if (!phone) return true; // optional
  const clean = String(phone).trim().replace(/[^0-9]/g, '');
  return clean.length === 10;
}

// Registration: Faculty (Public)
// SECURITY RULE: Administrators can NEVER be created via public self-registration.
// Student accounts are no longer maintained; timetables are public without an account.
// Faculty accounts are created with status 'pending' and require Admin activation.
router.post('/register', (req, res) => {
  try {
    const { name, register_id, password, role, phone, designation } = req.body;

    if (!name || !register_id || !password || !role) {
      return res.status(400).json({ error: 'Name, Register ID / Employee ID, password, and role are required.' });
    }

    const cleanRole = role.trim().toLowerCase();

    // STRICT BLOCK: Public registration cannot create admin accounts under any circumstance
    if (cleanRole === 'admin') {
      return res.status(403).json({
        error: 'Administrator accounts cannot be self-registered. They must be created by an existing administrator via the admin portal.'
      });
    }

    // STRICT BLOCK: Student accounts are no longer registered or supported
    if (cleanRole === 'student') {
      return res.status(400).json({
        error: 'Student accounts are no longer registered or supported. Timetables are publicly accessible without an account.'
      });
    }

    if (cleanRole !== 'faculty') {
      return res.status(400).json({ error: 'Invalid role. Only faculty accounts can be self-registered.' });
    }

    if (!validateName(name)) {
      return res.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
    }

    if (!validateRegisterId(register_id)) {
      return res.status(400).json({ error: 'Register ID / Employee ID must be 3-30 alphanumeric characters.' });
    }

    const pwError = validatePasswordStrength(password);
    if (pwError) {
      return res.status(400).json({ error: pwError });
    }

    if (phone && !validatePhone(phone)) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }

    const cleanId = register_id.trim().toUpperCase();

    // Check for duplicate Register ID / Employee ID
    const existing = db.prepare('SELECT id, register_id FROM users WHERE UPPER(register_id) = ?').get(cleanId);
    if (existing) {
      return res.status(409).json({
        error: `Register ID / Employee ID "${cleanId}" is already taken. Please verify your ID or log in.`
      });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const userDesignation = designation && designation.trim() ? designation.trim() : 'Faculty Member';
    
    // Faculty accounts start as 'pending' until approved by an administrator
    const initialStatus = 'pending';

    const stmt = db.prepare(`
      INSERT INTO users (register_id, name, password_hash, role, phone, department, designation, status, must_change_password)
      VALUES (?, ?, ?, 'faculty', ?, 'AIML', ?, ?, 0)
    `);

    const info = stmt.run(cleanId, name.trim(), passwordHash, phone ? phone.trim() : null, userDesignation, initialStatus);
    const newUserId = info.lastInsertRowid;

    try {
      db.prepare(`
        INSERT INTO audit_logs (action, target_user_id, details)
        VALUES ('USER_REGISTER', ?, ?)
      `).run(newUserId, `New faculty registered: ${cleanId} (${name.trim()}) with status: ${initialStatus}`);
    } catch (e) {}

    const user = db.prepare('SELECT id, register_id, name, role, phone, department, designation, status FROM users WHERE id = ?').get(newUserId);

    return res.status(201).json({
      message: 'Faculty registration submitted successfully! Your account is pending administrator approval before you can sign in.',
      status: 'pending',
      user
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Failed to complete registration.' });
  }
});

// Admin endpoint to explicitly create an administrator account
router.post('/register-admin', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, register_id, password, phone, designation } = req.body;

    if (!name || !register_id || !password) {
      return res.status(400).json({ error: 'Name, Admin ID, and password are required.' });
    }

    if (!validateName(name)) {
      return res.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
    }

    if (!validateRegisterId(register_id)) {
      return res.status(400).json({ error: 'Admin ID must be 3-30 alphanumeric characters.' });
    }

    const pwError = validatePasswordStrength(password);
    if (pwError) {
      return res.status(400).json({ error: pwError });
    }

    if (phone && !validatePhone(phone)) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }

    const cleanId = register_id.trim().toUpperCase();
    const existing = db.prepare('SELECT id FROM users WHERE UPPER(register_id) = ?').get(cleanId);
    if (existing) {
      return res.status(409).json({ error: `Admin ID "${cleanId}" is already taken.` });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare(`
      INSERT INTO users (register_id, name, password_hash, role, phone, department, designation, status, must_change_password)
      VALUES (?, ?, ?, 'admin', ?, 'AIML', ?, 'active', 0)
    `);

    const info = stmt.run(cleanId, name.trim(), passwordHash, phone ? phone.trim() : null, designation ? designation.trim() : 'Administrator');
    const newUserId = info.lastInsertRowid;

    try {
      db.prepare(`
        INSERT INTO audit_logs (action, performed_by_id, target_user_id, details)
        VALUES ('ADMIN_CREATE_ADMIN', ?, ?, ?)
      `).run(req.user.id, newUserId, `Admin ${req.user.name} created new Admin account: ${cleanId} (${name.trim()})`);
    } catch (e) {}

    const newAdmin = db.prepare('SELECT id, register_id, name, role, phone, department, designation, status FROM users WHERE id = ?').get(newUserId);
    res.status(201).json({ message: 'Administrator account created successfully!', admin: newAdmin });
  } catch (error) {
    console.error('Register admin error:', error);
    res.status(500).json({ error: 'Failed to create administrator account.' });
  }
});

// Login: Faculty & Admin
router.post('/login', (req, res) => {
  try {
    const { register_id, password, expected_role } = req.body;

    if (!register_id || !password) {
      return res.status(400).json({ error: 'Register ID / Employee ID and password are required.' });
    }

    if (expected_role === 'student') {
      return res.status(400).json({
        error: 'Student accounts are no longer supported. Timetables are publicly accessible without signing in.'
      });
    }

    const cleanId = register_id.trim();
    const user = db.prepare('SELECT * FROM users WHERE UPPER(register_id) = UPPER(?)').get(cleanId);

    if (!user || user.role === 'student') {
      try {
        db.prepare(`
          INSERT INTO audit_logs (action, details)
          VALUES ('LOGIN_FAILED', ?)
        `).run(`Failed login attempt for unknown or retired ID: ${cleanId} from IP: ${req.ip}`);
      } catch (e) {}
      return res.status(401).json({ error: 'Invalid Register ID or password.' });
    }

    // Check account status
    if (user.status === 'pending') {
      return res.status(403).json({
        error: 'Your account is pending administrator approval. Please contact the department administrator.'
      });
    }

    if (user.status && user.status !== 'active') {
      return res.status(403).json({
        error: 'Account has been deactivated or suspended. Please contact the administrator.'
      });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      try {
        db.prepare(`
          INSERT INTO audit_logs (action, target_user_id, details)
          VALUES ('LOGIN_FAILED', ?, ?)
        `).run(user.id, `Failed password attempt for user: ${user.register_id} from IP: ${req.ip}`);
      } catch (e) {}
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
    cleanStaleSessions(35000);
    const existingSession = getActiveSessionByUserId(user.id, 35000);
    if (existingSession) {
      return res.status(409).json({
        error: 'This account is already logged in on another device or browser. Please log out from the existing session before signing in again.'
      });
    }
    activeSessionInfo = createActiveSession(user.id, user.role);

    const userSafe = {
      id: user.id,
      register_id: user.register_id,
      name: user.name,
      role: user.role,
      phone: user.phone,
      department: user.department,
      designation: user.designation,
      status: user.status || 'active',
      must_change_password: Boolean(user.must_change_password),
      session_id: activeSessionInfo ? activeSessionInfo.sessionId : null
    };

    const token = generateToken(userSafe, activeSessionInfo ? activeSessionInfo.sessionId : null);

    try {
      db.prepare(`
        INSERT INTO audit_logs (action, performed_by_id, target_user_id, details)
        VALUES ('LOGIN_SUCCESS', ?, ?, ?)
      `).run(user.id, user.id, `User ${user.name} (${user.role.toUpperCase()}) logged in successfully from IP: ${req.ip}`);
    } catch (e) {}

    return res.json({
      message: 'Login successful',
      token,
      user: userSafe,
      must_change_password: Boolean(user.must_change_password),
      session_id: activeSessionInfo ? activeSessionInfo.sessionId : null
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Failed to process login.' });
  }
});

// Authenticated user password rotation
router.post('/change-password', authenticateToken, (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({ error: 'Current password, new password, and confirmation are required.' });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'New password and confirmation do not match.' });
    }

    const pwError = validatePasswordStrength(new_password);
    if (pwError) {
      return res.status(400).json({ error: pwError });
    }

    const user = db.prepare('SELECT id, name, register_id, role, password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const isMatch = bcrypt.compareSync(current_password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    if (current_password === new_password) {
      return res.status(400).json({ error: 'New password must be different from your current password.' });
    }

    const newHash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(newHash, user.id);

    // Invalidate any active sessions on other tabs
    invalidateUserSessions(user.id);

    try {
      db.prepare(`
        INSERT INTO audit_logs (action, performed_by_id, target_user_id, details)
        VALUES ('USER_CHANGE_PASSWORD', ?, ?, ?)
      `).run(user.id, user.id, `User ${user.name} (${user.register_id}) updated account password.`);
    } catch (e) {}

    return res.json({
      success: true,
      message: 'Password changed successfully. Please log in again with your new credentials.'
    });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'Failed to change password.' });
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
    return res.status(500).json({ error: 'Logout failed.' });
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
    return res.status(500).json({ error: 'Heartbeat update failed.' });
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
    return res.status(500).json({ error: 'Session unload failed.' });
  }
});

// ============================================================================
// FORGOT PASSWORD FLOW (Faculty & Admin Only)
// Students MUST have passwords reset by Admin/Faculty and cannot use OTP.
// ============================================================================

// 1. Request OTP
router.post('/forgot-password/request-otp', async (req, res) => {
  try {
    const { phone, role } = req.body;

    if (!phone || !phone.trim()) {
      return res.status(400).json({ error: 'Registered mobile number is required.' });
    }

    const cleanRole = (role || '').trim().toLowerCase();

    if (cleanRole === 'student') {
      return res.status(400).json({
        error: 'Student accounts do not exist. Timetables are publicly accessible without an account.'
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
      message: `If this mobile number is associated with an active ${cleanRole === 'admin' ? 'Administrator' : 'Faculty'} account, a verification code has been dispatched.`,
      expires_in: 600
    };

    // Lookup user by phone and role
    const matchedUser = db.prepare(`
      SELECT id, name, register_id, role, phone, status 
      FROM users 
      WHERE phone = ? AND role = ?
    `).get(cleanPhone, cleanRole);

    if (!matchedUser || matchedUser.status === 'suspended') {
      return res.json(genericResponse);
    }

    // Generate 6-digit OTP using cryptographically secure PRNG
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHash('sha256').update(otpCode + config.JWT_SECRET).digest('hex');

    // Expire any existing unverified OTPs for this user
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND verified = 0').run(matchedUser.id);

    // Store in password_resets table with hashed OTP and 10-minute expiry
    db.prepare(`
      INSERT INTO password_resets (phone, otp_hash, otp_code, role, user_id, attempts, verified, expires_at)
      VALUES (?, ?, '', ?, ?, 0, 0, datetime('now', '+10 minutes'))
    `).run(cleanPhone, otpHash, cleanRole, matchedUser.id);

    // Dispatch via SMS gateway provider
    const smsResult = await sendOtpSms({
      phone: cleanPhone,
      otp: otpCode,
      recipientName: matchedUser.name,
      role: cleanRole
    });

    if (!smsResult.success && config.isProduction) {
      return res.status(503).json({
        error: smsResult.error || 'SMS notification service unavailable. Please contact an administrator.'
      });
    }

    // Security: NEVER return debug_otp in any environment!
    return res.json(genericResponse);
  } catch (error) {
    console.error('Request OTP error:', error);
    return res.status(500).json({ error: 'Failed to process OTP request.' });
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

    // Validate hashed code (with backward fallback to legacy plaintext code if present)
    const candidateHash = crypto.createHash('sha256').update(cleanOtp + config.JWT_SECRET).digest('hex');
    const isValid = (record.otp_hash && record.otp_hash === candidateHash) || (record.otp_code && record.otp_code === cleanOtp);

    if (!isValid) {
      db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(record.id);
      const remainingAttempts = 5 - (record.attempts + 1);
      return res.status(400).json({
        error: `Invalid verification code. ${remainingAttempts} attempt(s) remaining.`
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
    return res.status(500).json({ error: 'Failed to verify code.' });
  }
});

// 3. Reset Password (with valid reset_token)
router.post('/forgot-password/reset-password', (req, res) => {
  try {
    const { reset_token, new_password, confirm_password } = req.body;

    if (!reset_token) {
      return res.status(400).json({ error: 'Reset session token is missing. Please restart verification.' });
    }

    const pwError = validatePasswordStrength(new_password);
    if (pwError) {
      return res.status(400).json({ error: pwError });
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

    // Update password in users table and clear forced change flag
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(passwordHash, targetUser.id);

    // Invalidate reset token immediately
    db.prepare('DELETE FROM password_resets WHERE id = ?').run(resetRecord.id);

    // Invalidate any active sessions for this user
    invalidateUserSessions(targetUser.id);

    // Log action to audit_logs
    try {
      db.prepare(`
        INSERT INTO audit_logs (action, performed_by_id, target_user_id, details)
        VALUES ('SELF_PASSWORD_RESET_OTP', ?, ?, ?)
      `).run(targetUser.id, targetUser.id, `User ${targetUser.name} (${targetUser.register_id}) reset password via verified mobile OTP.`);
    } catch (e) {}

    return res.json({
      message: 'Password reset successfully! You can now log in with your new password.',
      register_id: targetUser.register_id
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// Get current session user
router.get('/me', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT id, register_id, name, role, phone, department, designation, status, must_change_password FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to retrieve profile.' });
  }
});

export default router;
