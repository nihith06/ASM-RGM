import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'rgmcet_aiml_academic_schedule_secret_key_2026';

export function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      register_id: user.register_id,
      name: user.name,
      role: user.role,
      year: user.year,
      department: user.department || 'AIML',
      designation: user.designation
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.query?.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Strictly enforces the privacy rule:
// "Student personal details and faculty personal details are visible ONLY to logged-in faculty members and admin"
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
