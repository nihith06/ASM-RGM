import jwt from 'jsonwebtoken';
import config from './env.js';
import db, { getActiveSessionById, touchSession } from './db.js';

export function generateToken(user, sessionId = null) {
  // All authenticated users (faculty and admin) receive 12-hour session tokens
  const expiresIn = '12h';

  return jwt.sign(
    {
      id: user.id,
      register_id: user.register_id,
      name: user.name,
      role: user.role,
      department: user.department || 'AIML',
      designation: user.designation,
      session_id: sessionId || user.session_id || null
    },
    config.JWT_SECRET,
    { expiresIn }
  );
}

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  jwt.verify(token, config.JWT_SECRET, (err, decodedUser) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    // Verify user still exists in the database and is currently active
    const dbUser = db.prepare(`
      SELECT id, register_id, name, role, phone, department, designation, status, must_change_password 
      FROM users 
      WHERE id = ?
    `).get(decodedUser.id);

    if (!dbUser) {
      return res.status(401).json({ error: 'User account has been deleted or no longer exists.' });
    }

    if (dbUser.status !== 'active') {
      return res.status(403).json({ 
        error: dbUser.status === 'pending'
          ? 'Your account is pending administrator approval.'
          : 'Your account has been deactivated or suspended.'
      });
    }

    // For active sessions with session_id: enforce validity
    if (decodedUser.session_id) {
      const activeSession = getActiveSessionById(decodedUser.session_id, 45000);
      if (!activeSession) {
        return res.status(401).json({ error: 'Session has expired or ended. Please sign in again.' });
      }
      touchSession(decodedUser.session_id);
    }

    req.user = {
      ...decodedUser,
      ...dbUser
    };
    next();
  });
}

/**
 * Optional token authentication: populates req.user if a valid token is provided,
 * but allows the request to continue as an anonymous visitor if no token or an invalid token is provided.
 */
export function optionalAuthenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, config.JWT_SECRET, (err, decodedUser) => {
    if (err || !decodedUser?.id) {
      req.user = null;
      return next();
    }

    try {
      const dbUser = db.prepare(`
        SELECT id, register_id, name, role, phone, department, designation, status, must_change_password 
        FROM users 
        WHERE id = ?
      `).get(decodedUser.id);

      if (dbUser && dbUser.status === 'active') {
        req.user = {
          ...decodedUser,
          ...dbUser
        };
      } else {
        req.user = null;
      }
    } catch (e) {
      req.user = null;
    }
    next();
  });
}

// Strictly enforces the privacy rule:
// Faculty personal contact details are visible ONLY to logged-in faculty members and admin
export function requireFacultyOrAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.user.role !== 'faculty' && req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Access denied: Directory and personal contact details are visible ONLY to logged-in faculty members and admin.'
    });
  }
  next();
}

// Only Admin can perform certain actions like adding sections and editing timetables
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Access denied: Administrator privileges required for this action.'
    });
  }
  next();
}
