import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { getSlotTimeRange, timesOverlap } from './timeUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'academic.db');
const db = new DatabaseSync(dbPath);

// Enable foreign keys and concurrent access
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    register_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('student', 'faculty', 'admin')),
    phone TEXT,
    year INTEGER CHECK(year IS NULL OR year IN (1, 2, 3, 4)),
    department TEXT DEFAULT 'AIML',
    designation TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL CHECK(year IN (1, 2, 3, 4)),
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(year, name)
  );

  CREATE TABLE IF NOT EXISTS timetables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL CHECK(year IN (1, 2, 3, 4)),
    section_id INTEGER NOT NULL,
    day TEXT NOT NULL CHECK(day IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')),
    period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 7),
    subject TEXT NOT NULL,
    faculty_name TEXT NOT NULL,
    room TEXT DEFAULT 'AIML-LH1',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(section_id) REFERENCES sections(id) ON DELETE CASCADE,
    UNIQUE(year, section_id, day, period)
  );

  CREATE TABLE IF NOT EXISTS faculty_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faculty_id INTEGER NOT NULL,
    day TEXT NOT NULL CHECK(day IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')),
    period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 7),
    status TEXT NOT NULL,
    note TEXT,
    override_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(faculty_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(faculty_id, day, period)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    performed_by_id INTEGER,
    target_user_id INTEGER,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(performed_by_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(target_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('faculty', 'admin')),
    user_id INTEGER NOT NULL,
    attempts INTEGER DEFAULT 0,
    verified INTEGER DEFAULT 0,
    reset_token TEXT,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS faculty_leaves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faculty_id INTEGER NOT NULL,
    faculty_name TEXT NOT NULL,
    leave_date TEXT NOT NULL,
    status TEXT DEFAULT 'leave',
    reason TEXT DEFAULT 'Personal Leave',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(faculty_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(faculty_id, leave_date)
  );

  CREATE TABLE IF NOT EXISTS global_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'faculty_leave',
    faculty_id INTEGER,
    faculty_name TEXT NOT NULL,
    leave_date TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('theory', 'lab')),
    capacity INTEGER DEFAULT 60,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS faculty_workload_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faculty_id INTEGER NOT NULL,
    assigned_subjects TEXT,
    assigned_labs TEXT,
    max_weekly_hours INTEGER DEFAULT 16,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(faculty_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(faculty_id)
  );

  CREATE TABLE IF NOT EXISTS active_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('faculty', 'admin')),
    last_active INTEGER NOT NULL,
    unloaded_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_active_sessions_session ON active_sessions(session_id);
`);

// Additive columns for sections table
try { db.exec("ALTER TABLE sections ADD COLUMN sem INTEGER DEFAULT 1;"); } catch (e) {}
try { db.exec("ALTER TABLE sections ADD COLUMN academic_year TEXT DEFAULT '2026-2027';"); } catch (e) {}
try { db.exec("ALTER TABLE sections ADD COLUMN batch TEXT DEFAULT '2024-2028';"); } catch (e) {}
try { db.exec("ALTER TABLE sections ADD COLUMN effective_date TEXT DEFAULT '15-07-2026';"); } catch (e) {}

// Ensure status and qualification columns exist in users table
try {
  db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';");
} catch (e) {
  // column already exists
}
try {
  db.exec("ALTER TABLE users ADD COLUMN qualification TEXT;");
} catch (e) {
  // column already exists
}

// Migrate faculty_overrides table to allow 'busy' and 'leave' statuses and add override_date
try {
  const ovTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='faculty_overrides'").get();
  if (ovTable && ovTable.sql && (!ovTable.sql.includes('override_date') || ovTable.sql.includes('mentoring'))) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS faculty_overrides_temp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        faculty_id INTEGER NOT NULL,
        day TEXT NOT NULL CHECK(day IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')),
        period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 7),
        status TEXT NOT NULL,
        note TEXT,
        override_date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(faculty_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(faculty_id, day, period)
      );
      INSERT OR IGNORE INTO faculty_overrides_temp (id, faculty_id, day, period, status, note, created_at)
        SELECT id, faculty_id, day, period,
               CASE WHEN status IN ('unavailable', 'office_hours', 'meeting', 'mentoring') THEN 'busy' ELSE status END,
               note, created_at
        FROM faculty_overrides;
      DROP TABLE faculty_overrides;
      ALTER TABLE faculty_overrides_temp RENAME TO faculty_overrides;
    `);
  }
} catch (e) {
  console.error('faculty_overrides migration error:', e.message);
}

// Automatically purge notifications older than 1 month
export function purgeOldNotifications() {
  try {
    const res = db.prepare("DELETE FROM global_notifications WHERE datetime(created_at) < datetime('now', '-1 month')").run();
    if (res.changes > 0) {
      console.log(`🧹 Auto-purged ${res.changes} expired notification(s) older than 1 month.`);
    }
  } catch (err) {
    // silent
  }
}
const purgeInterval = setInterval(purgeOldNotifications, 60 * 60 * 1000);
if (purgeInterval.unref) purgeInterval.unref();

// 13 Official Sections: 1st Yr (4), 2nd Yr (4), 3rd Yr (4), 4th Yr (1)
export const OFFICIAL_SECTIONS = [
  { year: 1, name: 'Section A', sem: 1, academic_year: '2026-2027', batch: '2026-2030', effective_date: '15-07-2026' },
  { year: 1, name: 'Section B', sem: 1, academic_year: '2026-2027', batch: '2026-2030', effective_date: '15-07-2026' },
  { year: 1, name: 'Section C', sem: 1, academic_year: '2026-2027', batch: '2026-2030', effective_date: '15-07-2026' },
  { year: 1, name: 'Section D', sem: 1, academic_year: '2026-2027', batch: '2026-2030', effective_date: '15-07-2026' },
  { year: 2, name: 'Section A', sem: 1, academic_year: '2026-2027', batch: '2025-2029', effective_date: '15-07-2026' },
  { year: 2, name: 'Section B', sem: 1, academic_year: '2026-2027', batch: '2025-2029', effective_date: '15-07-2026' },
  { year: 2, name: 'Section C', sem: 1, academic_year: '2026-2027', batch: '2025-2029', effective_date: '15-07-2026' },
  { year: 2, name: 'Section D', sem: 1, academic_year: '2026-2027', batch: '2025-2029', effective_date: '15-07-2026' },
  { year: 3, name: 'Section A', sem: 1, academic_year: '2026-2027', batch: '2024-2028', effective_date: '15-07-2026' },
  { year: 3, name: 'Section B', sem: 1, academic_year: '2026-2027', batch: '2024-2028', effective_date: '15-07-2026' },
  { year: 3, name: 'Section C', sem: 1, academic_year: '2026-2027', batch: '2024-2028', effective_date: '15-07-2026' },
  { year: 3, name: 'Section D', sem: 1, academic_year: '2026-2027', batch: '2024-2028', effective_date: '15-07-2026' },
  { year: 4, name: 'Section A', sem: 1, academic_year: '2026-2027', batch: '2023-2027', effective_date: '15-07-2026' },
];

// 19 Official RGMCET Faculty Members (Department of CSE - AI & ML)
export const OFFICIAL_FACULTY = [
  { id: 'FAC001', name: 'Dr. G. Kishor Kumar', desig: 'Professor', qual: 'M.Tech & Ph.D', phone: '9848022301', status: 'active' },
  { id: 'FAC002', name: 'Dr. J. Avinash', desig: 'Assistant Professor', qual: 'M.Tech & Ph.D', phone: '9848022302', status: 'active' },
  { id: 'FAC003', name: 'Dr. G. Chandana Swathi', desig: 'Assistant Professor', qual: 'M.Tech & Ph.D', phone: '9848022303', status: 'active' },
  { id: 'FAC004', name: 'Dr. Chakrapani', desig: 'Assistant Professor', qual: 'M.Tech & Ph.D', phone: '9848022304', status: 'active' },
  { id: 'FAC005', name: 'Mrs. C. Leelavathi', desig: 'Assistant Professor', qual: 'M.Tech', phone: '9848022305', status: 'active' },
  { id: 'FAC006', name: 'Mr. P. Sreekanth Reddy', desig: 'Assistant Professor', qual: 'M.Tech', phone: '9848022306', status: 'active' },
  { id: 'FAC007', name: 'Ms. D. Saraswathi', desig: 'Assistant Professor', qual: 'M.Tech', phone: '9848022307', status: 'active' },
  { id: 'FAC008', name: 'Mr. S. Kalim Peerulla Basha', desig: 'Assistant Professor', qual: 'M.Tech', phone: '9848022308', status: 'active' },
  { id: 'FAC009', name: 'Ms. E. Naveena', desig: 'Assistant Professor', qual: 'M.Tech', phone: '9848022309', status: 'active' },
  { id: 'FAC010', name: 'Mr. S. Sunil Kumar', desig: 'Assistant Professor', qual: 'M.Tech, (Ph.D)', phone: '9848022310', status: 'active' },
  { id: 'FAC011', name: 'Mr. V. Phanishwara Hara Gopal', desig: 'Assistant Professor', qual: 'M.Tech', phone: '9848022311', status: 'active' },
  { id: 'FAC012', name: 'Dr. CH. Srilakshmi Prasanna', desig: 'Assistant Professor', qual: 'M.Tech & Ph.D', phone: '9848022312', status: 'active' },
  { id: 'FAC013', name: 'Mr. P. Arun Babu', desig: 'Assistant Professor', qual: 'M.Tech', phone: '9848022313', status: 'active' },
  { id: 'FAC014', name: 'Mrs. P. Priyanka', desig: 'Assistant Professor', qual: 'M.Tech', phone: '9848022314', status: 'active' },
  { id: 'FAC015', name: 'Mrs. B.V.S.N. Lakshmi', desig: 'Assistant Professor', qual: 'M.Tech', phone: '9848022315', status: 'active' },
  { id: 'FAC016', name: 'Mr. N. Bala Kishore', desig: 'Assistant Professor', qual: 'M.Tech', phone: '9848022316', status: 'active' },
  { id: 'FAC017', name: 'Mrs. K. Jabeen', desig: 'Assistant Professor', qual: 'M.Tech', phone: '9848022317', status: 'active' },
  { id: 'FAC018', name: 'Mr. V. Raghavendra', desig: 'Assistant Professor', qual: 'M.Tech', phone: '9848022318', status: 'active' },
  { id: 'FAC019', name: 'Ms. P. Supriya', desig: 'Assistant Professor', qual: 'M.Tech', phone: '9848022319', status: 'active' },
];

export function isYear1AimlSubject(subject) {
  if (!subject) return false;
  const s = subject.trim().toUpperCase();
  return s === 'IP' || s.startsWith('IP ') || s.includes('CP LAB');
}

export function isYear2AimlSubject(subject) {
  if (!subject) return false;
  const s = subject.trim().toUpperCase();
  return s === 'AI' || s === 'ADSA' || s === 'ADSA LAB' || s === 'UHV' || s === 'PYP' || s === 'PYP LAB' || s === 'OOPJ' || s === 'OOPJ LAB';
}

export function isHodFaculty(nameOrId) {
  if (!nameOrId) return false;
  const s = String(nameOrId).trim().toLowerCase();
  if (s.includes('bala kishore') || s.includes('fac016')) return false;
  return s.includes('kishor kumar') || s.includes('dr. g. kishor') || s === 'fac001' || (s.includes('kishor') && !s.includes('bala'));
}

export function syncSectionsAndFaculty() {
  console.log('🔄 Synchronizing official 13 Sections and 19 Faculty registry...');

  // 1. Purge legacy admin accounts so that ONLY the official 3 Admin accounts exist initially
  db.prepare("DELETE FROM users WHERE role = 'admin' AND UPPER(register_id) IN ('ADMIN001', 'ADMIN002', 'ADMIN003')").run();

  // 2. Initialize the official 3 Admin accounts (admin01, admin02, admin03)
  const initialAdminHash = bcrypt.hashSync('1352468', 10);
  const OFFICIAL_ADMINS = [
    { id: 'admin01', name: 'System Administrator', phone: '9848011220', desig: 'System Administrator' },
    { id: 'admin02', name: 'Academic Administrator', phone: '9848011221', desig: 'Academic Administrator' },
    { id: 'admin03', name: 'Department Administrator', phone: '9848011222', desig: 'Department Administrator' }
  ];

  for (const adm of OFFICIAL_ADMINS) {
    const existingAdmin = db.prepare('SELECT id, password_hash FROM users WHERE LOWER(register_id) = LOWER(?)').get(adm.id);
    if (!existingAdmin) {
      db.prepare(`
        INSERT INTO users (register_id, name, password_hash, role, phone, department, designation, status)
        VALUES (?, ?, ?, 'admin', ?, 'AIML', ?, 'active')
      `).run(adm.id, adm.name, initialAdminHash, adm.phone, adm.desig);
    } else {
      // Update metadata without overwriting password if it was changed via OTP
      db.prepare(`
        UPDATE users
        SET name = ?, phone = ?, designation = ?, role = 'admin', status = 'active'
        WHERE id = ?
      `).run(adm.name, adm.phone, adm.desig, existingAdmin.id);
    }
  }

  // Purge legacy unwanted faculty members and removed pending slots (safeguarding all admins)
  db.prepare(`
    DELETE FROM users 
    WHERE role != 'admin'
      AND (LOWER(name) LIKE '%shoba%' 
       OR LOWER(name) LIKE '%prof. administrator%' 
       OR register_id IN ('FAC020', 'FAC021') 
       OR status = 'pending');
  `).run();
  db.prepare(`
    DELETE FROM timetables 
    WHERE LOWER(faculty_name) LIKE '%shoba%' 
       OR LOWER(faculty_name) LIKE '%prof. administrator%'
       OR LOWER(faculty_name) LIKE '%faculty slot%';
  `).run();
  db.prepare(`
    DELETE FROM faculty_overrides 
    WHERE faculty_id NOT IN (SELECT id FROM users);
  `).run();

  // 1. Clean and insert the 16 official sections
  const currentSections = db.prepare('SELECT id, year, name FROM sections').all();
  for (const cs of currentSections) {
    const isOfficial = OFFICIAL_SECTIONS.some(os => os.year === cs.year && os.name.toLowerCase() === cs.name.toLowerCase());
    if (!isOfficial) {
      db.prepare('DELETE FROM timetables WHERE section_id = ?').run(cs.id);
      db.prepare('DELETE FROM sections WHERE id = ?').run(cs.id);
    }
  }

  const insertSectionStmt = db.prepare(`
    INSERT INTO sections (year, name, sem, academic_year, batch, effective_date) 
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(year, name) DO UPDATE SET
      sem = excluded.sem,
      academic_year = excluded.academic_year,
      batch = excluded.batch,
      effective_date = excluded.effective_date
  `);
  for (const s of OFFICIAL_SECTIONS) {
    insertSectionStmt.run(s.year, s.name, s.sem || 1, s.academic_year || '2026-2027', s.batch || '2024-2028', s.effective_date || '15-07-2026');
  }

  // 1b. Seed 10 Theory Rooms and 2 Labs
  const insertRoomStmt = db.prepare('INSERT OR IGNORE INTO rooms (name, type, capacity) VALUES (?, ?, ?)');
  for (let r = 1; r <= 10; r++) {
    insertRoomStmt.run(`AIML-LH${r}`, 'theory', 60);
  }
  insertRoomStmt.run('AIML-LAB1', 'lab', 60);
  insertRoomStmt.run('AIML-LAB2', 'lab', 60);

  // 2. Upsert the 19 official faculty members with default password: 12345678
  const facHash = bcrypt.hashSync('12345678', 10);
  for (const f of OFFICIAL_FACULTY) {
    const existingFaculty = db.prepare("SELECT id, register_id, name FROM users WHERE role = 'faculty' AND (register_id = ? OR name = ?)").get(f.id, f.name);
    if (existingFaculty) {
      db.prepare(`
        UPDATE users
        SET designation = COALESCE(designation, ?),
            qualification = COALESCE(qualification, ?),
            status = COALESCE(status, ?),
            phone = CASE WHEN users.phone IS NULL OR users.phone = '' THEN ? ELSE users.phone END
        WHERE id = ?
      `).run(f.desig, f.qual, f.status, f.phone, existingFaculty.id);
    } else {
      db.prepare(`
        INSERT INTO users (register_id, name, password_hash, role, phone, department, designation, qualification, status)
        VALUES (?, ?, ?, 'faculty', ?, 'AIML', ?, ?, ?)
      `).run(f.id, f.name, facHash, f.phone, f.desig, f.qual, f.status);
    }
  }

  // Set default password to 12345678 for all existing faculty accounts on legacy default 'faculty123'
  const allFaculty = db.prepare("SELECT id, password_hash FROM users WHERE role = 'faculty'").all();
  for (const fac of allFaculty) {
    if (bcrypt.compareSync('faculty123', fac.password_hash)) {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(facHash, fac.id);
    }
  }

  // 2b. Upsert faculty workload and subject/lab competencies (max 16 hrs/week cap; HOD 0 hrs)
  const insertWorkloadStmt = db.prepare(`
    INSERT INTO faculty_workload_config (faculty_id, assigned_subjects, assigned_labs, max_weekly_hours)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(faculty_id) DO UPDATE SET
      assigned_subjects = excluded.assigned_subjects,
      assigned_labs = excluded.assigned_labs,
      max_weekly_hours = excluded.max_weekly_hours
  `);

  const facultyWorkloadMap = {
    'FAC001': { subjects: [], labs: [], max_weekly_hours: 0 }, // HOD: Strictly 0 teaching subjects/labs
    'FAC002': { subjects: ['ADSA', 'AI', 'EDA', 'CV&IP', 'IP', 'Deep Learning', 'DEEP LEARNING', 'MLOPS', 'BIG DATA'], labs: ['ADSA LAB', 'TINKERING LAB', 'CV&ML LAB', 'DL LAB'] },
    'FAC003': { subjects: ['NLP', 'CV&IP', 'SSP', 'MLOPS', 'Deep Learning', 'DEEP LEARNING'], labs: ['CV&ML LAB', 'TINKERING LAB', 'DL LAB'] },
    'FAC004': { subjects: ['CV&IP', 'IP', 'PROJECT WORK', 'Deep Learning', 'DEEP LEARNING', 'BIG DATA'], labs: ['CV&ML LAB', 'TINKERING LAB', 'DL LAB'] },
    'FAC005': { subjects: ['IP', 'UHV', 'EDA', 'AI ETHICS'], labs: ['CP LAB', 'DL LAB'] },
    'FAC006': { subjects: ['EDA', 'OOPJ', 'FSD', 'PYP', 'IP', 'PROJECT WORK', 'MLOPS', 'BIG DATA'], labs: ['CP LAB', 'OOPJ LAB', 'BIG DATA LAB'] },
    'FAC007': { subjects: ['QT&A', 'EDA', 'AI', 'CV&IP', 'BIG DATA', 'Deep Learning', 'DEEP LEARNING'], labs: ['AI&SP LAB', 'BIG DATA LAB', 'DL LAB'] },
    'FAC008': { subjects: ['FSD', 'PYP', 'QT&A', 'OOPJ', 'PROJECT WORK', 'MLOPS', 'Deep Learning', 'DEEP LEARNING'], labs: ['PYP LAB', 'BIG DATA LAB', 'DL LAB'] },
    'FAC009': { subjects: ['SSP', 'ADSA', 'AI', 'UHV', 'Deep Learning', 'DEEP LEARNING', 'BIG DATA'], labs: ['AI&SP LAB', 'TINKERING LAB', 'DL LAB'] },
    'FAC010': { subjects: ['NLP', 'FSD', 'AI', 'CV&IP', 'Deep Learning', 'DEEP LEARNING', 'MLOPS'], labs: ['AI&SP LAB', 'TINKERING LAB', 'CV&ML LAB', 'DL LAB'] },
    'FAC011': { subjects: ['NLP', 'AI', 'CV&IP', 'Deep Learning', 'DEEP LEARNING', 'MLOPS', 'BIG DATA'], labs: ['AI&SP LAB', 'TINKERING LAB', 'CV&ML LAB', 'DL LAB'] },
    'FAC012': { subjects: ['ADSA', 'SSP', 'QT&A', 'NLP', 'UHV', 'BIG DATA', 'MLOPS'], labs: ['ADSA LAB', 'CV&ML LAB', 'BIG DATA LAB', 'DL LAB'] },
    'FAC013': { subjects: ['CV&IP', 'IP', 'FSD', 'PROJECT WORK', 'Deep Learning', 'DEEP LEARNING', 'BIG DATA'], labs: ['CV&ML LAB', 'TINKERING LAB', 'DL LAB'] },
    'FAC014': { subjects: ['SSP', 'UHV', 'QT&A', 'AI ETHICS'], labs: ['CP LAB', 'DL LAB'] },
    'FAC015': { subjects: ['OOPJ', 'AI', 'FSD', 'PYP', 'NLP', 'PROJECT WORK', 'MLOPS', 'Deep Learning', 'DEEP LEARNING'], labs: ['OOPJ LAB', 'DL LAB'] },
    'FAC016': { subjects: ['PYP', 'FSD', 'OOPJ', 'PROJECT WORK', 'BIG DATA', 'MLOPS'], labs: ['PYP LAB', 'BIG DATA LAB', 'DL LAB'] },
    'FAC017': { subjects: ['EDA', 'ADSA', 'SSP', 'CV&IP', 'BIG DATA', 'Deep Learning', 'DEEP LEARNING'], labs: ['ADSA LAB', 'CV&ML LAB', 'BIG DATA LAB', 'DL LAB'] },
    'FAC018': { subjects: ['PYP', 'OOPJ', 'FSD', 'PROJECT WORK', 'Deep Learning', 'DEEP LEARNING', 'MLOPS'], labs: ['PYP LAB', 'BIG DATA LAB', 'DL LAB'] },
    'FAC019': { subjects: ['QT&A', 'IP', 'EDA', 'PROJECT WORK', 'BIG DATA'], labs: ['CP LAB', 'DL LAB', 'BIG DATA LAB'] }
  };

  for (const f of OFFICIAL_FACULTY) {
    const userRec = db.prepare("SELECT id FROM users WHERE role = 'faculty' AND (register_id = ? OR name = ?)").get(f.id, f.name);
    if (userRec) {
      const config = facultyWorkloadMap[f.id] || { subjects: ['AI'], labs: ['AI&SP LAB'], max_weekly_hours: 16 };
      insertWorkloadStmt.run(userRec.id, JSON.stringify(config.subjects), JSON.stringify(config.labs), config.max_weekly_hours !== undefined ? config.max_weekly_hours : 16);
    }
  }

  // 3. Populate timetables across all 13 sections
  populateTimetablesData();
  db.prepare("UPDATE timetables SET faculty_name = '—' WHERE UPPER(TRIM(subject)) = 'SEM'").run();
  db.prepare(`
    UPDATE timetables 
    SET faculty_name = '—' 
    WHERE year = 1 
      AND UPPER(TRIM(subject)) != 'IP' 
      AND UPPER(TRIM(subject)) NOT LIKE 'IP %' 
      AND UPPER(TRIM(subject)) NOT LIKE '%CP LAB%'
  `).run();
  db.prepare(`
    UPDATE timetables 
    SET faculty_name = '—' 
    WHERE year = 2 
      AND UPPER(TRIM(subject)) NOT IN ('AI', 'ADSA', 'UHV', 'PYP', 'ADSA LAB', 'OOPJ', 'OOPJ LAB', 'PYP LAB')
  `).run();
  db.prepare(`
    UPDATE timetables 
    SET faculty_name = '—' 
    WHERE LOWER(faculty_name) LIKE '%kishor kumar%' 
       OR (LOWER(faculty_name) LIKE '%kishor%' AND LOWER(faculty_name) NOT LIKE '%bala kishore%')
  `).run();
  db.prepare("UPDATE users SET designation = 'Professor' WHERE register_id = 'FAC001'").run();
}

// Seed default data
export function seedDatabase() {
  try { db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN qualification TEXT;"); } catch (e) {}

  const studentCheck = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('student');
  
  if (studentCheck.count === 0) {
    console.log('🌱 Seeding database with initial academic records...');

    // Sample Students (Password: student123)
    const stuHash = bcrypt.hashSync('student123', 10);
    const studentList = [
      { id: '24091A3301', name: 'Rahul Varma', phone: '9123456701', year: 1 },
      { id: '24091A3302', name: 'Keerthi Rao', phone: '9123456702', year: 1 },
      { id: '23091A3315', name: 'Sneha Reddy', phone: '9123456703', year: 2 },
      { id: '23091A3316', name: 'Aditya Varma', phone: '9123456704', year: 2 },
      { id: '22091A3324', name: 'Karthik Kumar', phone: '9123456705', year: 3 },
      { id: '22091A3325', name: 'Pooja Nair', phone: '9123456706', year: 3 },
      { id: '21091A3340', name: 'Ananya Sharma', phone: '9123456707', year: 4 },
      { id: '21091A3341', name: 'Vikram Seth', phone: '9123456708', year: 4 },
    ];

    const insertUserStmt = db.prepare(`
      INSERT INTO users (register_id, name, password_hash, role, phone, department, designation, year)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const s of studentList) {
      insertUserStmt.run(s.id, s.name, stuHash, 'student', s.phone, 'AIML', 'Student', s.year);
    }
  }

  // Ensure default demo student exists
  const demoStudent = db.prepare('SELECT id FROM users WHERE register_id = ?').get('22091A3324');
  if (!demoStudent) {
    const stuHash = bcrypt.hashSync('student123', 10);
    db.prepare(`
      INSERT INTO users (register_id, name, password_hash, role, phone, department, designation, year)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('22091A3324', 'Karthik Kumar', stuHash, 'student', '9123456705', 'AIML', 'Student', 3);
  }

  // Always synchronize 13 sections & 19 faculty members
  syncSectionsAndFaculty();

  // Seed sample faculty overrides for demonstration
  const fac1 = db.prepare('SELECT id FROM users WHERE register_id = ?').get('FAC001');
  const fac2 = db.prepare('SELECT id FROM users WHERE register_id = ?').get('FAC002');
  if (fac1) {
    db.prepare(`
      INSERT OR IGNORE INTO faculty_overrides (faculty_id, day, period, status, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(fac1.id, 'Tuesday', 5, 'busy', 'Unavailable');
  }
  if (fac2) {
    db.prepare(`
      INSERT OR IGNORE INTO faculty_overrides (faculty_id, day, period, status, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(fac2.id, 'Wednesday', 5, 'busy', 'Unavailable');
  }

  // Ensure any legacy overrides are cleaned to busy
  db.prepare(`
    UPDATE faculty_overrides 
    SET status = 'busy', note = '' 
    WHERE status IN ('office_hours', 'meeting', 'mentoring', 'unavailable')
  `).run();

  // Ensure all timetable slots across all sections have valid room assignments
  ensureAllRoomsAssigned();

  console.log('✅ Database successfully initialized with 13 Sections and 19 Faculty registry!');
}

export function ensureAllRoomsAssigned() {
  const allSecs = db.prepare("SELECT id, year, name FROM sections").all();
  const updateRoomStmt = db.prepare("UPDATE timetables SET room = ? WHERE id = ?");
  const emptyRows = db.prepare("SELECT id, year, section_id, subject FROM timetables WHERE room IS NULL OR room = ''").all();

  if (emptyRows.length > 0) {
    db.exec('BEGIN TRANSACTION;');
    try {
      for (const row of emptyRows) {
        const sec = allSecs.find(s => s.id === row.section_id);
        const sub = (row.subject || '').toUpperCase();
        let assignedRoom = '';

        if (sub.includes('AI&SP LAB') || sub.includes('AI&SP')) assignedRoom = 'AI&SP LAB';
        else if (sub.includes('CV&ML LAB') || sub.includes('CV&ML')) assignedRoom = 'CV&ML LAB';
        else if (sub.includes('TINKERING')) assignedRoom = 'TINKERING LAB';
        else if (sub.includes('BEE LAB')) assignedRoom = 'BEE LAB';
        else if (sub.includes('CP LAB')) assignedRoom = 'CP LAB';
        else if (sub.includes('EP LAB')) assignedRoom = 'EP LAB';
        else if (sub.includes('ADSA LAB')) assignedRoom = 'ADSA LAB';
        else if (sub.includes('OOPJ LAB')) assignedRoom = 'OOPJ LAB';
        else if (sub.includes('PYP LAB')) assignedRoom = 'PYP LAB';
        else if (sub.includes('LIB')) assignedRoom = 'LIBRARY';
        else if (row.year === 1) {
          if (sec?.name?.includes('B')) assignedRoom = 'AIML-LH2';
          else if (sec?.name?.includes('C')) assignedRoom = 'AIML-LH3';
          else if (sec?.name?.includes('D')) assignedRoom = 'AIML-LH4';
          else assignedRoom = 'AIML-LH1';
        } else if (row.year === 2) {
          if (sec?.name?.includes('B')) assignedRoom = 'RG-208';
          else if (sec?.name?.includes('C')) assignedRoom = 'RG-209';
          else if (sec?.name?.includes('D')) assignedRoom = 'RG-210';
          else assignedRoom = 'RG-207';
        } else if (row.year === 3) {
          if (sec?.name?.includes('B')) assignedRoom = 'ET-3050';
          else if (sec?.name?.includes('C')) assignedRoom = 'ET-3070';
          else if (sec?.name?.includes('D')) assignedRoom = 'ET-3060';
          else assignedRoom = 'ET-3080';
        } else if (row.year === 4) {
          assignedRoom = 'ET-401';
        }
        updateRoomStmt.run(assignedRoom, row.id);
      }
      db.exec('COMMIT;');
      console.log(`✅ Populated room numbers for ${emptyRows.length} timetable entries.`);
    } catch (e) {
      db.exec('ROLLBACK;');
      console.error('Failed to populate room numbers:', e);
    }
  }

  // Ensure Year 3 Section A matches Image 2 rooms
  const sec3A = allSecs.find(s => s.year === 3 && s.name.toLowerCase().includes('section a'));
  if (sec3A) {
    const updateSec3AStmt = db.prepare("UPDATE timetables SET room = ? WHERE year = 3 AND section_id = ? AND day = ? AND period = ?");
    const sec3ARooms = {
      Monday: { 1: 'ET-3080', 2: 'ET-3080', 3: 'ET-3080', 4: 'ET-3080', 5: 'AI&SP LAB', 6: 'AI&SP LAB', 7: 'AI&SP LAB' },
      Tuesday: { 1: 'ET-3080', 2: 'ET-3080', 3: 'ET-3050', 4: 'ET-3050', 5: 'TINKERING LAB', 6: 'TINKERING LAB', 7: 'TINKERING LAB' },
      Wednesday: { 1: 'ET-3080', 2: 'ET-3080', 3: 'ET-3070', 4: 'ET-3070', 5: 'ET-3070', 6: 'ET-3070', 7: 'ET-3070' },
      Thursday: { 1: 'ET-3080', 2: 'ET-3080', 3: 'ET-3050', 4: 'ET-3050', 5: 'CV&ML LAB', 6: 'CV&ML LAB', 7: 'CV&ML LAB' },
      Friday: { 1: 'ET-3080', 2: 'ET-3080', 3: 'ET-3080', 4: 'ET-3080', 5: 'LIBRARY', 6: 'ET-3080', 7: 'ET-3080' },
      Saturday: { 1: 'ET-3050', 2: 'ET-3050', 3: 'LIBRARY', 4: 'LIBRARY', 5: 'ET-3050', 6: 'ET-3050', 7: 'ET-3050' },
    };
    for (const [day, pMap] of Object.entries(sec3ARooms)) {
      for (const [p, rm] of Object.entries(pMap)) {
        updateSec3AStmt.run(rm, sec3A.id, day, parseInt(p, 10));
      }
    }
  }
}

export function populateTimetablesData() {
  console.log('🌱 Populating official timetables across all 13 sections with 0 conflicts...');
  db.prepare('DELETE FROM timetables').run();

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const insertTtStmt = db.prepare(`
    INSERT INTO timetables (year, section_id, day, period, subject, faculty_name, room)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const allSections = db.prepare(`
    SELECT * FROM sections 
    ORDER BY year ASC, 
      CASE 
        WHEN LOWER(name) LIKE '%section a%' THEN 1 
        WHEN LOWER(name) LIKE '%section b%' THEN 2 
        WHEN LOWER(name) LIKE '%section c%' THEN 3 
        WHEN LOWER(name) LIKE '%section d%' THEN 4 
        ELSE 5 
      END, name ASC
  `).all();

  // Exclude HOD (Dr. G. Kishor Kumar) completely from teaching faculty allocations
  const allFaculty = OFFICIAL_FACULTY.filter(f => f.status === 'active' && !isHodFaculty(f.name) && f.id !== 'FAC001').map(f => f.name);

  // In-memory tracker of inserted entries to guarantee zero time conflicts
  const trackedEntries = [];

  function checkConflict(faculty, day, year, period) {
    if (!faculty || faculty === '—') return false;
    const range = getSlotTimeRange(year, period);
    for (const item of trackedEntries) {
      if (item.faculty && item.faculty !== '—' && item.day === day && item.faculty.toLowerCase() === faculty.toLowerCase()) {
        if (timesOverlap(range, item.range)) {
          return true;
        }
      }
    }
    return false;
  }

  let facultyRoundRobin = 0;
  function findFreeFaculty(day, year, periods, preferred = null) {
    const periodArr = Array.isArray(periods) ? periods : [periods];
    if (preferred && !isHodFaculty(preferred)) {
      const ok = periodArr.every(p => !checkConflict(preferred, day, year, p));
      if (ok) return preferred;
    }
    const n = allFaculty.length;
    for (let i = 0; i < n; i++) {
      const candidate = allFaculty[(facultyRoundRobin + i) % n];
      const ok = periodArr.every(p => !checkConflict(candidate, day, year, p));
      if (ok) {
        facultyRoundRobin = (facultyRoundRobin + i + 1) % n;
        return candidate;
      }
    }
    return allFaculty[0];
  }

  function insertSlot(year, sectionId, day, period, subject, faculty, room = '') {
    const isSem = subject && subject.trim().toUpperCase() === 'SEM';
    const isYear1NonAiml = year === 1 && !isYear1AimlSubject(subject);
    const isYear2NonAiml = year === 2 && !isYear2AimlSubject(subject);
    const effectiveFaculty = (isSem || isYear1NonAiml || isYear2NonAiml) ? '—' : (faculty || '—');
    const range = getSlotTimeRange(year, period);
    trackedEntries.push({ year, sectionId, day, period, subject, faculty: effectiveFaculty, range });
    insertTtStmt.run(year, sectionId, day, period, subject, effectiveFaculty, room || '');
  }

  const sec1A = allSections.find(s => s.year === 1 && s.name.toLowerCase().includes('section a'));
  const sec2A = allSections.find(s => s.year === 2 && s.name.toLowerCase().includes('section a'));
  const sec2B = allSections.find(s => s.year === 2 && s.name.toLowerCase().includes('section b'));
  const sec2C = allSections.find(s => s.year === 2 && s.name.toLowerCase().includes('section c'));
  const sec2D = allSections.find(s => s.year === 2 && s.name.toLowerCase().includes('section d'));
  const sec3A = allSections.find(s => s.year === 3 && s.name.toLowerCase().includes('section a'));
  const sec3B = allSections.find(s => s.year === 3 && s.name.toLowerCase().includes('section b'));
  const sec3C = allSections.find(s => s.year === 3 && s.name.toLowerCase().includes('section c'));
  const sec3D = allSections.find(s => s.year === 3 && s.name.toLowerCase().includes('section d'));

  // Image 2: 1st Year Reference (7 periods, 50 minutes each, classes until 5:00 PM)
  // Non-AIML subjects (BEE, EP, ITWS, LAAC, EG) are unassigned ('—') as they are taught by other departments
  const year1Schedule = {
    Monday: [
      { period: 1, subject: 'BEE - A', faculty: '—' },
      { period: 2, subject: 'BEE - A', faculty: '—' },
      { period: 3, subject: 'IP', faculty: 'Dr. Chakrapani' },
      { period: 4, subject: 'EP', faculty: '—' },
      { period: 5, subject: 'ITWS', faculty: '—' },
      { period: 6, subject: 'ITWS', faculty: '—' },
      { period: 7, subject: 'ITWS', faculty: '—' },
    ],
    Tuesday: [
      { period: 1, subject: 'IP', faculty: 'Mrs. C. Leelavathi' },
      { period: 2, subject: 'IP', faculty: 'Mrs. C. Leelavathi' },
      { period: 3, subject: 'EP', faculty: '—' },
      { period: 4, subject: 'LAAC', faculty: '—' },
      { period: 5, subject: 'EG', faculty: '—' },
      { period: 6, subject: 'EG', faculty: '—' },
      { period: 7, subject: 'EG', faculty: '—' },
    ],
    Wednesday: [
      { period: 1, subject: 'BEE LAB', faculty: '—' },
      { period: 2, subject: 'BEE LAB', faculty: '—' },
      { period: 3, subject: 'BEE-B', faculty: '—' },
      { period: 4, subject: 'IP', faculty: 'Mrs. C. Leelavathi' },
      { period: 5, subject: 'IP', faculty: 'Mrs. C. Leelavathi' },
      { period: 6, subject: 'LAAC', faculty: '—' },
      { period: 7, subject: 'IP Advanced', faculty: 'Mrs. C. Leelavathi' }, // 04:00 - 04:50 PM
    ],
    Thursday: [
      { period: 1, subject: 'EP', faculty: '—' },
      { period: 2, subject: 'EP', faculty: '—' },
      { period: 3, subject: 'BEE-A', faculty: '—' },
      { period: 4, subject: 'CP LAB', faculty: 'Mr. P. Sreekanth Reddy' },
      { period: 5, subject: 'CP LAB', faculty: 'Mr. P. Sreekanth Reddy' },
      { period: 6, subject: 'IP', faculty: 'Mrs. C. Leelavathi' },
      { period: 7, subject: 'IP', faculty: 'Mrs. C. Leelavathi' },
    ],
    Friday: [
      { period: 1, subject: 'EG', faculty: '—' },
      { period: 2, subject: 'EG', faculty: '—' },
      { period: 3, subject: 'EG', faculty: '—' },
      { period: 4, subject: 'BEE-B', faculty: '—' },
      { period: 5, subject: 'BEE-B', faculty: '—' },
      { period: 6, subject: 'LAAC', faculty: '—' },
      { period: 7, subject: 'LAAC', faculty: '—' },
    ],
    Saturday: [
      { period: 1, subject: 'EP LAB', faculty: '—' },
      { period: 2, subject: 'EP LAB', faculty: '—' },
      { period: 3, subject: 'EP LAB', faculty: '—' },
      { period: 4, subject: 'CP LAB', faculty: 'Mr. P. Sreekanth Reddy' },
      { period: 5, subject: 'CP LAB', faculty: 'Mr. P. Sreekanth Reddy' },
      { period: 6, subject: 'BEE LAB', faculty: '—' },
      { period: 7, subject: 'BEE LAB', faculty: '—' },
    ],
  };

  // Official 3rd Year - Section A Schedule from Source-of-Truth Photo (Image 2 with ET-3080/3050/3070 and Labs)
  const year3SecASchedule = {
    Monday: [
      { period: 1, subject: 'NLP', faculty: 'Mr. V. Phanishwara Hara Gopal', room: 'ET-3080' },
      { period: 2, subject: 'NLP', faculty: 'Mr. V. Phanishwara Hara Gopal', room: 'ET-3080' },
      { period: 3, subject: 'QT&A', faculty: 'Dr. S. Farooq', room: 'ET-3080' },
      { period: 4, subject: 'QT&A', faculty: 'Dr. S. Farooq', room: 'ET-3080' },
      { period: 5, subject: 'AI&SP LAB', faculty: 'Ms. E. Naveena', room: 'AI&SP LAB' },
      { period: 6, subject: 'AI&SP LAB', faculty: 'Ms. E. Naveena', room: 'AI&SP LAB' },
      { period: 7, subject: 'AI&SP LAB', faculty: 'Ms. E. Naveena', room: 'AI&SP LAB' },
    ],
    Tuesday: [
      { period: 1, subject: 'CV&IP', faculty: 'Dr. Chakrapani', room: 'ET-3080' },
      { period: 2, subject: 'CV&IP', faculty: 'Dr. Chakrapani', room: 'ET-3080' },
      { period: 3, subject: 'SEM', faculty: '—', room: 'ET-3050' },
      { period: 4, subject: 'SEM', faculty: '—', room: 'ET-3050' },
      { period: 5, subject: 'TINKERING LAB', faculty: 'Dr. Chakrapani', room: 'TINKERING LAB' },
      { period: 6, subject: 'TINKERING LAB', faculty: 'Dr. Chakrapani', room: 'TINKERING LAB' },
      { period: 7, subject: 'TINKERING LAB', faculty: 'Dr. Chakrapani', room: 'TINKERING LAB' },
    ],
    Wednesday: [
      { period: 1, subject: 'SSP', faculty: 'Ms. E. Naveena', room: 'ET-3080' },
      { period: 2, subject: 'SSP', faculty: 'Ms. E. Naveena', room: 'ET-3080' },
      { period: 3, subject: 'EDA', faculty: 'Mr. P. Sreekanth Reddy', room: 'ET-3070' },
      { period: 4, subject: 'EDA', faculty: 'Mr. P. Sreekanth Reddy', room: 'ET-3070' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'ET-3070' },
      { period: 6, subject: 'NLP', faculty: 'Mr. V. Phanishwara Hara Gopal', room: 'ET-3070' },
      { period: 7, subject: 'NLP', faculty: 'Mr. V. Phanishwara Hara Gopal', room: 'ET-3070' },
    ],
    Thursday: [
      { period: 1, subject: 'FSD', faculty: 'Mr. S. Kalim Peerulla Basha', room: 'ET-3080' },
      { period: 2, subject: 'FSD', faculty: 'Mr. S. Kalim Peerulla Basha', room: 'ET-3080' },
      { period: 3, subject: 'SEM', faculty: '—', room: 'ET-3050' },
      { period: 4, subject: 'SEM', faculty: '—', room: 'ET-3050' },
      { period: 5, subject: 'CV&ML LAB', faculty: 'Dr. Chakrapani', room: 'CV&ML LAB' },
      { period: 6, subject: 'CV&ML LAB', faculty: 'Dr. Chakrapani', room: 'CV&ML LAB' },
      { period: 7, subject: 'CV&ML LAB', faculty: 'Dr. Chakrapani', room: 'CV&ML LAB' },
    ],
    Friday: [
      { period: 1, subject: 'QT&A', faculty: 'Dr. S. Farooq', room: 'ET-3080' },
      { period: 2, subject: 'QT&A', faculty: 'Dr. S. Farooq', room: 'ET-3080' },
      { period: 3, subject: 'SSP', faculty: 'Ms. E. Naveena', room: 'ET-3080' },
      { period: 4, subject: 'SSP', faculty: 'Ms. E. Naveena', room: 'ET-3080' },
      { period: 5, subject: 'LIB', faculty: '—', room: 'LIBRARY' },
      { period: 6, subject: 'CV&IP', faculty: 'Dr. Chakrapani', room: 'ET-3080' },
      { period: 7, subject: 'CV&IP', faculty: 'Dr. Chakrapani', room: 'ET-3080' },
    ],
    Saturday: [
      { period: 1, subject: 'EDA', faculty: 'Mr. P. Sreekanth Reddy', room: 'ET-3050' },
      { period: 2, subject: 'EDA', faculty: 'Mr. P. Sreekanth Reddy', room: 'ET-3050' },
      { period: 3, subject: 'LIB', faculty: '—', room: 'LIBRARY' },
      { period: 4, subject: 'LIB', faculty: '—', room: 'LIBRARY' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'ET-3050' },
      { period: 6, subject: 'SEM', faculty: '—', room: 'ET-3050' },
      { period: 7, subject: 'FSD', faculty: 'Mr. S. Kalim Peerulla Basha', room: 'ET-3050' },
    ],
  };

  // Official 3rd Year - Section B Schedule from Source-of-Truth Photo (Room numbers neglected per user request)
  const year3SecBSchedule = {
    Monday: [
      { period: 1, subject: 'NLP', faculty: 'Dr. J. Avinash', room: '' },
      { period: 2, subject: 'NLP', faculty: 'Dr. J. Avinash', room: '' },
      { period: 3, subject: 'QT&A', faculty: 'Dr. B. Jamalaiah', room: '' },
      { period: 4, subject: 'QT&A', faculty: 'Dr. B. Jamalaiah', room: '' },
      { period: 5, subject: 'SEM', faculty: '—', room: '' },
      { period: 6, subject: 'SSP', faculty: 'Mr. N. Bala Kishore', room: '' },
      { period: 7, subject: 'SSP', faculty: 'Mr. N. Bala Kishore', room: '' },
    ],
    Tuesday: [
      { period: 1, subject: 'FSD', faculty: 'Ms. P. Supriya', room: '' },
      { period: 2, subject: 'FSD', faculty: 'Ms. P. Supriya', room: '' },
      { period: 3, subject: 'SEM', faculty: '—', room: '' },
      { period: 4, subject: 'SEM', faculty: '—', room: '' },
      { period: 5, subject: 'CV&ML Lab', faculty: 'Mr. V. Raghavendra', room: '' },
      { period: 6, subject: 'CV&ML Lab', faculty: 'Mr. V. Raghavendra', room: '' },
      { period: 7, subject: 'CV&ML Lab', faculty: 'Mr. V. Raghavendra', room: '' },
    ],
    Wednesday: [
      { period: 1, subject: 'SSP', faculty: 'Mr. N. Bala Kishore', room: '' },
      { period: 2, subject: 'SSP', faculty: 'Mr. N. Bala Kishore', room: '' },
      { period: 3, subject: 'EDA', faculty: 'Mrs. K. Jabeen', room: '' },
      { period: 4, subject: 'EDA', faculty: 'Mrs. K. Jabeen', room: '' },
      { period: 5, subject: 'SEM', faculty: '—', room: '' },
      { period: 6, subject: 'NLP', faculty: 'Dr. J. Avinash', room: '' },
      { period: 7, subject: 'NLP', faculty: 'Dr. J. Avinash', room: '' },
    ],
    Thursday: [
      { period: 1, subject: 'CV&IP', faculty: 'Mr. V. Raghavendra', room: '' },
      { period: 2, subject: 'CV&IP', faculty: 'Mr. V. Raghavendra', room: '' },
      { period: 3, subject: 'SEM', faculty: '—', room: '' },
      { period: 4, subject: 'SEM', faculty: '—', room: '' },
      { period: 5, subject: 'SEM', faculty: '—', room: '' },
      { period: 6, subject: 'EDA', faculty: 'Mrs. K. Jabeen', room: '' },
      { period: 7, subject: 'EDA', faculty: 'Mrs. K. Jabeen', room: '' },
    ],
    Friday: [
      { period: 1, subject: 'QT&A', faculty: 'Dr. B. Jamalaiah', room: '' },
      { period: 2, subject: 'QT&A', faculty: 'Dr. B. Jamalaiah', room: '' },
      { period: 3, subject: 'AI&SP Lab', faculty: 'Mr. N. Bala Kishore', room: '' },
      { period: 4, subject: 'AI&SP Lab', faculty: 'Mr. N. Bala Kishore', room: '' },
      { period: 5, subject: 'TINKERING LAB', faculty: 'Mrs. K. Jabeen', room: '' },
      { period: 6, subject: 'TINKERING LAB', faculty: 'Mrs. K. Jabeen', room: '' },
      { period: 7, subject: 'TINKERING LAB', faculty: 'Mrs. K. Jabeen', room: '' },
    ],
    Saturday: [
      { period: 1, subject: 'CV&IP', faculty: 'Mr. V. Raghavendra', room: '' },
      { period: 2, subject: 'CV&IP', faculty: 'Mr. V. Raghavendra', room: '' },
      { period: 3, subject: 'SEM', faculty: '—', room: '' },
      { period: 4, subject: 'SEM', faculty: '—', room: '' },
      { period: 5, subject: 'SEM', faculty: '—', room: '' },
      { period: 6, subject: 'FSD', faculty: 'Ms. P. Supriya', room: '' },
      { period: 7, subject: 'SEM', faculty: '—', room: '' },
    ],
  };

  // Official 3rd Year - Section C Schedule from Source-of-Truth Photo (Room numbers neglected per user request)
  const year3SecCSchedule = {
    Monday: [
      { period: 1, subject: 'NLP', faculty: 'Mr. S. Kalim Peerulla Basha', room: '' },
      { period: 2, subject: 'NLP', faculty: 'Mr. S. Kalim Peerulla Basha', room: '' },
      { period: 3, subject: 'QT&A', faculty: 'Dr. K. Venkata Krishnaiah', room: '' },
      { period: 4, subject: 'QT&A', faculty: 'Dr. K. Venkata Krishnaiah', room: '' },
      { period: 5, subject: 'SEM', faculty: '—', room: '' },
      { period: 6, subject: 'SSP', faculty: 'Ms. D. Saraswathi', room: '' },
      { period: 7, subject: 'SSP', faculty: 'Ms. D. Saraswathi', room: '' },
    ],
    Tuesday: [
      { period: 1, subject: 'CV&IP', faculty: 'Mr. V. Phanishwara Hara Gopal', room: '' },
      { period: 2, subject: 'CV&IP', faculty: 'Mr. V. Phanishwara Hara Gopal', room: '' },
      { period: 3, subject: 'AI&SP LAB', faculty: 'Ms. D. Saraswathi', room: '' },
      { period: 4, subject: 'AI&SP LAB', faculty: 'Ms. D. Saraswathi', room: '' },
      { period: 5, subject: 'SEM', faculty: '—', room: '' },
      { period: 6, subject: 'SEM', faculty: '—', room: '' },
      { period: 7, subject: 'FSD', faculty: 'Mr. S. Kalim Peerulla Basha', room: '' },
    ],
    Wednesday: [
      { period: 1, subject: 'SSP', faculty: 'Ms. D. Saraswathi', room: '' },
      { period: 2, subject: 'SSP', faculty: 'Ms. D. Saraswathi', room: '' },
      { period: 3, subject: 'SEM', faculty: '—', room: '' },
      { period: 4, subject: 'SEM', faculty: '—', room: '' },
      { period: 5, subject: 'SEM', faculty: '—', room: '' },
      { period: 6, subject: 'NLP', faculty: 'Mr. S. Kalim Peerulla Basha', room: '' },
      { period: 7, subject: 'NLP', faculty: 'Mr. S. Kalim Peerulla Basha', room: '' },
    ],
    Thursday: [
      { period: 1, subject: 'QT&A', faculty: 'Dr. K. Venkata Krishnaiah', room: '' },
      { period: 2, subject: 'QT&A', faculty: 'Dr. K. Venkata Krishnaiah', room: '' },
      { period: 3, subject: 'CV&ML LAB', faculty: 'Mr. V. Phanishwara Hara Gopal', room: '' },
      { period: 4, subject: 'CV&ML LAB', faculty: 'Mr. V. Phanishwara Hara Gopal', room: '' },
      { period: 5, subject: 'TINKERING LAB', faculty: 'Mr. S. Sunil Kumar', room: '' },
      { period: 6, subject: 'TINKERING LAB', faculty: 'Mr. S. Sunil Kumar', room: '' },
      { period: 7, subject: 'TINKERING LAB', faculty: 'Mr. S. Sunil Kumar', room: '' },
    ],
    Friday: [
      { period: 1, subject: 'EDA', faculty: 'Dr. Chakrapani', room: '' },
      { period: 2, subject: 'EDA', faculty: 'Dr. Chakrapani', room: '' },
      { period: 3, subject: 'SEM', faculty: '—', room: '' },
      { period: 4, subject: 'SEM', faculty: '—', room: '' },
      { period: 5, subject: 'SEM', faculty: '—', room: '' },
      { period: 6, subject: 'CV&IP', faculty: 'Mr. V. Phanishwara Hara Gopal', room: '' },
      { period: 7, subject: 'CV&IP', faculty: 'Mr. V. Phanishwara Hara Gopal', room: '' },
    ],
    Saturday: [
      { period: 1, subject: 'FSD', faculty: 'Mr. S. Kalim Peerulla Basha', room: '' },
      { period: 2, subject: 'FSD', faculty: 'Mr. S. Kalim Peerulla Basha', room: '' },
      { period: 3, subject: 'MINOR DEGREE CLASS', faculty: '—', room: '' },
      { period: 4, subject: 'MINOR DEGREE CLASS', faculty: '—', room: '' },
      { period: 5, subject: 'SEM', faculty: '—', room: '' },
      { period: 6, subject: 'EDA', faculty: 'Dr. Chakrapani', room: '' },
      { period: 7, subject: 'EDA', faculty: 'Dr. Chakrapani', room: '' },
    ],
  };

  // Official 3rd Year - Section D Schedule from Source-of-Truth Photo (Room numbers neglected per user request)
  const year3SecDSchedule = {
    Monday: [
      { period: 1, subject: 'NLP', faculty: 'Dr. G. Chandana Swathi', room: '' },
      { period: 2, subject: 'NLP', faculty: 'Dr. G. Chandana Swathi', room: '' },
      { period: 3, subject: 'QT&A', faculty: 'Dr. N. Ravi Chandra Raju', room: '' },
      { period: 4, subject: 'QT&A', faculty: 'Dr. N. Ravi Chandra Raju', room: '' },
      { period: 5, subject: 'SEM', faculty: '—', room: '' },
      { period: 6, subject: 'SSP', faculty: 'Mr. P. Arun Babu', room: '' },
      { period: 7, subject: 'SSP', faculty: 'Mr. P. Arun Babu', room: '' },
    ],
    Tuesday: [
      { period: 1, subject: 'CV&IP', faculty: 'Mr. V. Raghavendra', room: '' },
      { period: 2, subject: 'CV&IP', faculty: 'Mr. V. Raghavendra', room: '' },
      { period: 3, subject: 'SEM', faculty: '—', room: '' },
      { period: 4, subject: 'SEM', faculty: '—', room: '' },
      { period: 5, subject: 'SEM', faculty: '—', room: '' },
      { period: 6, subject: 'EDA', faculty: 'Mrs. K. Jabeen', room: '' },
      { period: 7, subject: 'EDA', faculty: 'Mrs. K. Jabeen', room: '' },
    ],
    Wednesday: [
      { period: 1, subject: 'AI&SP LAB', faculty: 'Mr. P. Arun Babu', room: '' },
      { period: 2, subject: 'AI&SP LAB', faculty: 'Mr. P. Arun Babu', room: '' },
      { period: 3, subject: 'SEM', faculty: '—', room: '' },
      { period: 4, subject: 'SEM', faculty: '—', room: '' },
      { period: 5, subject: 'FSD', faculty: 'Ms. P. Supriya', room: '' },
      { period: 6, subject: 'NLP', faculty: 'Dr. G. Chandana Swathi', room: '' },
      { period: 7, subject: 'NLP', faculty: 'Dr. G. Chandana Swathi', room: '' },
    ],
    Thursday: [
      { period: 1, subject: 'QT&A', faculty: 'Dr. N. Ravi Chandra Raju', room: '' },
      { period: 2, subject: 'QT&A', faculty: 'Dr. N. Ravi Chandra Raju', room: '' },
      { period: 3, subject: 'SEM', faculty: '—', room: '' },
      { period: 4, subject: 'SEM', faculty: '—', room: '' },
      { period: 5, subject: 'SEM', faculty: '—', room: '' },
      { period: 6, subject: 'CV&IP', faculty: 'Mr. V. Raghavendra', room: '' },
      { period: 7, subject: 'CV&IP', faculty: 'Mr. V. Raghavendra', room: '' },
    ],
    Friday: [
      { period: 1, subject: 'EDA', faculty: 'Mrs. K. Jabeen', room: '' },
      { period: 2, subject: 'EDA', faculty: 'Mrs. K. Jabeen', room: '' },
      { period: 3, subject: 'SSP', faculty: 'Mr. P. Arun Babu', room: '' },
      { period: 4, subject: 'SSP', faculty: 'Mr. P. Arun Babu', room: '' },
      { period: 5, subject: 'CV&ML LAB', faculty: 'Mr. V. Raghavendra', room: '' },
      { period: 6, subject: 'CV&ML LAB', faculty: 'Mr. V. Raghavendra', room: '' },
      { period: 7, subject: 'CV&ML LAB', faculty: 'Mr. V. Raghavendra', room: '' },
    ],
    Saturday: [
      { period: 1, subject: 'FSD', faculty: 'Ms. P. Supriya', room: '' },
      { period: 2, subject: 'FSD', faculty: 'Ms. P. Supriya', room: '' },
      { period: 3, subject: 'SEM', faculty: '—', room: '' },
      { period: 4, subject: 'SEM', faculty: '—', room: '' },
      { period: 5, subject: 'TINKERING LAB', faculty: 'Mr. S. Sunil Kumar', room: '' },
      { period: 6, subject: 'TINKERING LAB', faculty: 'Mr. S. Sunil Kumar', room: '' },
      { period: 7, subject: 'TINKERING LAB', faculty: 'Mr. S. Sunil Kumar', room: '' },
    ],
  };

  // Official 2nd Year - Section A Schedule from Source-of-Truth Photo (Room RG-207)
  const year2SecASchedule = {
    Monday: [
      { period: 1, subject: 'PYP', faculty: 'Mr. N. Bala Kishore', room: 'RG-207' },
      { period: 2, subject: 'PYP', faculty: 'Mr. N. Bala Kishore', room: 'RG-207' },
      { period: 3, subject: 'OOPJ LAB', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-207' },
      { period: 4, subject: 'OOPJ LAB', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-207' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-207' },
      { period: 6, subject: 'DMGT', faculty: '—', room: 'RG-207' },
      { period: 7, subject: 'DMGT', faculty: '—', room: 'RG-207' },
    ],
    Tuesday: [
      { period: 1, subject: 'TRAINING PROGRAM', faculty: '—', room: 'RG-207' },
      { period: 2, subject: 'TRAINING PROGRAM', faculty: '—', room: 'RG-207' },
      { period: 3, subject: 'SEM', faculty: '—', room: 'RG-207' },
      { period: 4, subject: 'SEM', faculty: '—', room: 'RG-207' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-207' },
      { period: 6, subject: 'ADSA', faculty: 'Dr. J. Avinash', room: 'RG-207' },
      { period: 7, subject: 'ADSA', faculty: 'Dr. J. Avinash', room: 'RG-207' },
    ],
    Wednesday: [
      { period: 1, subject: 'OOPJ', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-207' },
      { period: 2, subject: 'OOPJ', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-207' },
      { period: 3, subject: 'ES', faculty: '—', room: 'RG-207' },
      { period: 4, subject: 'ES', faculty: '—', room: 'RG-207' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-207' },
      { period: 6, subject: 'AI', faculty: 'Mrs. P. Priyanka', room: 'RG-207' },
      { period: 7, subject: 'AI', faculty: 'Mrs. P. Priyanka', room: 'RG-207' },
    ],
    Thursday: [
      { period: 1, subject: 'DMGT', faculty: '—', room: 'RG-207' },
      { period: 2, subject: 'DMGT', faculty: '—', room: 'RG-207' },
      { period: 3, subject: 'OOPJ', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-207' },
      { period: 4, subject: 'OOPJ', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-207' },
      { period: 5, subject: 'PYP', faculty: 'Mr. N. Bala Kishore', room: 'RG-207' },
      { period: 6, subject: 'ADSA', faculty: 'Dr. J. Avinash', room: 'RG-207' },
      { period: 7, subject: 'ADSA', faculty: 'Dr. J. Avinash', room: 'RG-207' },
    ],
    Friday: [
      { period: 1, subject: 'ADSA LAB', faculty: 'Dr. J. Avinash', room: 'RG-207' },
      { period: 2, subject: 'ADSA LAB', faculty: 'Dr. J. Avinash', room: 'RG-207' },
      { period: 3, subject: 'SEM', faculty: '—', room: 'RG-207' },
      { period: 4, subject: 'SEM', faculty: '—', room: 'RG-207' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-207' },
      { period: 6, subject: 'UHV', faculty: 'Ms. P. Supriya', room: 'RG-207' },
      { period: 7, subject: 'UHV', faculty: 'Ms. P. Supriya', room: 'RG-207' },
    ],
    Saturday: [
      { period: 1, subject: 'UHV', faculty: 'Mrs. K. Jabeen', room: 'RG-207' },
      { period: 2, subject: 'UHV', faculty: 'Mrs. K. Jabeen', room: 'RG-207' },
      { period: 3, subject: 'SEM', faculty: '—', room: 'RG-207' },
      { period: 4, subject: 'SEM', faculty: '—', room: 'RG-207' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-207' },
      { period: 6, subject: 'AI', faculty: 'Mrs. P. Priyanka', room: 'RG-207' },
      { period: 7, subject: 'AI', faculty: 'Mrs. P. Priyanka', room: 'RG-207' },
    ],
  };

  // Official 2nd Year - Section B Schedule from Source-of-Truth Photo (Room RG-208)
  const year2SecBSchedule = {
    Monday: [
      { period: 1, subject: 'DMGT', faculty: '—', room: 'RG-208' },
      { period: 2, subject: 'DMGT', faculty: '—', room: 'RG-208' },
      { period: 3, subject: 'SEM', faculty: '—', room: 'RG-208' },
      { period: 4, subject: 'SEM', faculty: '—', room: 'RG-208' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-208' },
      { period: 6, subject: 'UHV', faculty: 'Ms. P. Supriya', room: 'RG-208' },
      { period: 7, subject: 'UHV', faculty: 'Ms. P. Supriya', room: 'RG-208' },
    ],
    Tuesday: [
      { period: 1, subject: 'OOPJ', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-208' },
      { period: 2, subject: 'OOPJ', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-208' },
      { period: 3, subject: 'UHV', faculty: 'Ms. P. Supriya', room: 'RG-208' },
      { period: 4, subject: 'UHV', faculty: 'Ms. P. Supriya', room: 'RG-208' },
      { period: 5, subject: 'PYP', faculty: 'Mr. N. Bala Kishore', room: 'RG-208' },
      { period: 6, subject: 'ADSA', faculty: 'Mr. P. Arun Babu', room: 'RG-208' },
      { period: 7, subject: 'ADSA', faculty: 'Mr. P. Arun Babu', room: 'RG-208' },
    ],
    Wednesday: [
      { period: 1, subject: 'AI', faculty: 'Mrs. P. Priyanka', room: 'RG-208' },
      { period: 2, subject: 'AI', faculty: 'Mrs. P. Priyanka', room: 'RG-208' },
      { period: 3, subject: 'TRAINING PROGRAM', faculty: '—', room: 'RG-208' },
      { period: 4, subject: 'TRAINING PROGRAM', faculty: '—', room: 'RG-208' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-208' },
      { period: 6, subject: 'ADSA LAB', faculty: 'Dr. Chakrapani', room: 'RG-208' },
      { period: 7, subject: 'ADSA LAB', faculty: 'Dr. Chakrapani', room: 'RG-208' },
    ],
    Thursday: [
      { period: 1, subject: 'OOPJ LAB', faculty: 'Mr. P. Arun Babu', room: 'RG-208' },
      { period: 2, subject: 'OOPJ LAB', faculty: 'Mr. P. Arun Babu', room: 'RG-208' },
      { period: 3, subject: 'SEM', faculty: '—', room: 'RG-208' },
      { period: 4, subject: 'SEM', faculty: '—', room: 'RG-208' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-208' },
      { period: 6, subject: 'DMGT', faculty: '—', room: 'RG-208' },
      { period: 7, subject: 'DMGT', faculty: '—', room: 'RG-208' },
    ],
    Friday: [
      { period: 1, subject: 'ADSA', faculty: 'Mr. P. Arun Babu', room: 'RG-208' },
      { period: 2, subject: 'ADSA', faculty: 'Mr. P. Arun Babu', room: 'RG-208' },
      { period: 3, subject: 'AI', faculty: 'Mrs. P. Priyanka', room: 'RG-208' },
      { period: 4, subject: 'AI', faculty: 'Mrs. P. Priyanka', room: 'RG-208' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-208' },
      { period: 6, subject: 'OOPJ', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-208' },
      { period: 7, subject: 'OOPJ', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-208' },
    ],
    Saturday: [
      { period: 1, subject: 'ES', faculty: '—', room: 'RG-208' },
      { period: 2, subject: 'ES', faculty: '—', room: 'RG-208' },
      { period: 3, subject: 'SEM', faculty: '—', room: 'RG-208' },
      { period: 4, subject: 'SEM', faculty: '—', room: 'RG-208' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-208' },
      { period: 6, subject: 'PYP', faculty: 'Mr. N. Bala Kishore', room: 'RG-208' },
      { period: 7, subject: 'PYP', faculty: 'Mr. N. Bala Kishore', room: 'RG-208' },
    ],
  };

  // Official 2nd Year - Section C Schedule from Source-of-Truth Photo (Room RG-209)
  const year2SecCSchedule = {
    Monday: [
      { period: 1, subject: 'ADSA LAB', faculty: 'Dr. Chakrapani', room: 'RG-209' },
      { period: 2, subject: 'ADSA LAB', faculty: 'Dr. Chakrapani', room: 'RG-209' },
      { period: 3, subject: 'LIB', faculty: '—', room: 'RG-209' },
      { period: 4, subject: 'LIB', faculty: '—', room: 'RG-209' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-209' },
      { period: 6, subject: 'AI', faculty: 'Mrs. P. Priyanka', room: 'RG-209' },
      { period: 7, subject: 'AI', faculty: 'Mrs. P. Priyanka', room: 'RG-209' },
    ],
    Tuesday: [
      { period: 1, subject: 'ADSA', faculty: 'Mr. P. Arun Babu', room: 'RG-209' },
      { period: 2, subject: 'ADSA', faculty: 'Mr. P. Arun Babu', room: 'RG-209' },
      { period: 3, subject: 'OOPJ LAB', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-209' },
      { period: 4, subject: 'OOPJ LAB', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-209' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-209' },
      { period: 6, subject: 'UHV', faculty: 'Mrs. K. Jabeen', room: 'RG-209' },
      { period: 7, subject: 'UHV', faculty: 'Mrs. K. Jabeen', room: 'RG-209' },
    ],
    Wednesday: [
      { period: 1, subject: 'DMGT', faculty: '—', room: 'RG-209' },
      { period: 2, subject: 'DMGT', faculty: '—', room: 'RG-209' },
      { period: 3, subject: 'SEM', faculty: '—', room: 'RG-209' },
      { period: 4, subject: 'SEM', faculty: '—', room: 'RG-209' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-209' },
      { period: 6, subject: 'OOPJ', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-209' },
      { period: 7, subject: 'OOPJ', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-209' },
    ],
    Thursday: [
      { period: 1, subject: 'AI', faculty: 'Mrs. P. Priyanka', room: 'RG-209' },
      { period: 2, subject: 'AI', faculty: 'Mrs. P. Priyanka', room: 'RG-209' },
      { period: 3, subject: 'TRAINING PROGRAM', faculty: '—', room: 'RG-209' },
      { period: 4, subject: 'TRAINING PROGRAM', faculty: '—', room: 'RG-209' },
      { period: 5, subject: 'PYP', faculty: 'Ms. E. Naveena', room: 'RG-209' },
      { period: 6, subject: 'ADSA', faculty: 'Mr. P. Arun Babu', room: 'RG-209' },
      { period: 7, subject: 'ADSA', faculty: 'Mr. P. Arun Babu', room: 'RG-209' },
    ],
    Friday: [
      { period: 1, subject: 'PYP', faculty: 'Mr. N. Bala Kishore', room: 'RG-209' },
      { period: 2, subject: 'PYP', faculty: 'Mr. N. Bala Kishore', room: 'RG-209' },
      { period: 3, subject: 'DMGT', faculty: '—', room: 'RG-209' },
      { period: 4, subject: 'DMGT', faculty: '—', room: 'RG-209' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-209' },
      { period: 6, subject: 'OOPJ', faculty: 'Mr. P. Arun Babu', room: 'RG-209' },
      { period: 7, subject: 'OOPJ', faculty: 'Mr. P. Arun Babu', room: 'RG-209' },
    ],
    Saturday: [
      { period: 1, subject: 'ES', faculty: '—', room: 'RG-209' },
      { period: 2, subject: 'ES', faculty: '—', room: 'RG-209' },
      { period: 3, subject: 'LIB', faculty: '—', room: 'RG-209' },
      { period: 4, subject: 'LIB', faculty: '—', room: 'RG-209' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-209' },
      { period: 6, subject: 'UHV', faculty: 'Dr. G. Chandana Swathi', room: 'RG-209' },
      { period: 7, subject: 'UHV', faculty: 'Dr. G. Chandana Swathi', room: 'RG-209' },
    ],
  };

  // Official 2nd Year - Section D Schedule from Source-of-Truth Photo (Room RG-210)
  const year2SecDSchedule = {
    Monday: [
      { period: 1, subject: 'OOPJ', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-210' },
      { period: 2, subject: 'OOPJ', faculty: 'Mrs. B.V.S.N. Lakshmi', room: 'RG-210' },
      { period: 3, subject: 'SEM', faculty: '—', room: 'RG-210' },
      { period: 4, subject: 'SEM', faculty: '—', room: 'RG-210' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-210' },
      { period: 6, subject: 'AI', faculty: 'Dr. CH. Srilakshmi Prasanna', room: 'RG-210' },
      { period: 7, subject: 'AI', faculty: 'Dr. CH. Srilakshmi Prasanna', room: 'RG-210' },
    ],
    Tuesday: [
      { period: 1, subject: 'OOPJ LAB', faculty: 'Mr. V. Raghavendra', room: 'RG-210' },
      { period: 2, subject: 'OOPJ LAB', faculty: 'Mr. V. Raghavendra', room: 'RG-210' },
      { period: 3, subject: 'TRAINING PROGRAM', faculty: '—', room: 'RG-210' },
      { period: 4, subject: 'TRAINING PROGRAM', faculty: '—', room: 'RG-210' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-210' },
      { period: 6, subject: 'ADSA', faculty: 'Dr. G. Chandana Swathi', room: 'RG-210' },
      { period: 7, subject: 'ADSA', faculty: 'Dr. G. Chandana Swathi', room: 'RG-210' },
    ],
    Wednesday: [
      { period: 1, subject: 'DMGT', faculty: '—', room: 'RG-210' },
      { period: 2, subject: 'DMGT', faculty: '—', room: 'RG-210' },
      { period: 3, subject: 'ADSA LAB', faculty: 'Dr. J. Avinash', room: 'RG-210' },
      { period: 4, subject: 'ADSA LAB', faculty: 'Dr. J. Avinash', room: 'RG-210' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-210' },
      { period: 6, subject: 'SEM', faculty: '—', room: 'RG-210' },
      { period: 7, subject: 'PYP', faculty: 'Mr. N. Bala Kishore', room: 'RG-210' },
    ],
    Thursday: [
      { period: 1, subject: 'ADSA', faculty: 'Dr. J. Avinash', room: 'RG-210' },
      { period: 2, subject: 'ADSA', faculty: 'Dr. J. Avinash', room: 'RG-210' },
      { period: 3, subject: 'UHV', faculty: 'Mrs. K. Jabeen', room: 'RG-210' },
      { period: 4, subject: 'UHV', faculty: 'Mrs. K. Jabeen', room: 'RG-210' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-210' },
      { period: 6, subject: 'AI', faculty: 'Mrs. P. Priyanka', room: 'RG-210' },
      { period: 7, subject: 'AI', faculty: 'Mrs. P. Priyanka', room: 'RG-210' },
    ],
    Friday: [
      { period: 1, subject: 'ES', faculty: '—', room: 'RG-210' },
      { period: 2, subject: 'ES', faculty: '—', room: 'RG-210' },
      { period: 3, subject: 'DMGT', faculty: '—', room: 'RG-210' },
      { period: 4, subject: 'DMGT', faculty: '—', room: 'RG-210' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-210' },
      { period: 6, subject: 'OOPJ', faculty: 'Dr. G. Chandana Swathi', room: 'RG-210' },
      { period: 7, subject: 'OOPJ', faculty: 'Dr. G. Chandana Swathi', room: 'RG-210' },
    ],
    Saturday: [
      { period: 1, subject: 'PYP LAB', faculty: 'Mr. N. Bala Kishore', room: 'RG-210' },
      { period: 2, subject: 'PYP LAB', faculty: 'Mr. N. Bala Kishore', room: 'RG-210' },
      { period: 3, subject: 'SEM', faculty: '—', room: 'RG-210' },
      { period: 4, subject: 'SEM', faculty: '—', room: 'RG-210' },
      { period: 5, subject: 'SEM', faculty: '—', room: 'RG-210' },
      { period: 6, subject: 'UHV', faculty: 'Mrs. K. Jabeen', room: 'RG-210' },
      { period: 7, subject: 'UHV', faculty: 'Mrs. K. Jabeen', room: 'RG-210' },
    ],
  };

  // 1. Seed Year 1 Sec A, Year 2 Sec A-D, and Year 3 Sec A-D
  for (const day of days) {
    if (sec1A) {
      for (const s of year1Schedule[day]) {
        insertSlot(1, sec1A.id, day, s.period, s.subject, s.faculty, s.room || (s.subject.includes('LAB') ? s.subject : 'AIML-LH1'));
      }
    }
    if (sec2A) {
      for (const s of year2SecASchedule[day]) {
        insertSlot(2, sec2A.id, day, s.period, s.subject, s.faculty, s.room || 'RG-207');
      }
    }
    if (sec2B) {
      for (const s of year2SecBSchedule[day]) {
        insertSlot(2, sec2B.id, day, s.period, s.subject, s.faculty, s.room || 'RG-208');
      }
    }
    if (sec2C) {
      for (const s of year2SecCSchedule[day]) {
        insertSlot(2, sec2C.id, day, s.period, s.subject, s.faculty, s.room || 'RG-209');
      }
    }
    if (sec2D) {
      for (const s of year2SecDSchedule[day]) {
        insertSlot(2, sec2D.id, day, s.period, s.subject, s.faculty, s.room || 'RG-210');
      }
    }
    if (sec3A) {
      for (const s of year3SecASchedule[day]) {
        insertSlot(3, sec3A.id, day, s.period, s.subject, s.faculty, s.room || 'ET-3080');
      }
    }
    if (sec3B) {
      for (const s of year3SecBSchedule[day]) {
        insertSlot(3, sec3B.id, day, s.period, s.subject, s.faculty, s.room || (s.subject.toUpperCase().includes('LAB') ? s.subject : 'ET-3050'));
      }
    }
    if (sec3C) {
      for (const s of year3SecCSchedule[day]) {
        insertSlot(3, sec3C.id, day, s.period, s.subject, s.faculty, s.room || (s.subject.toUpperCase().includes('LAB') ? s.subject : 'ET-3070'));
      }
    }
    if (sec3D) {
      for (const s of year3SecDSchedule[day]) {
        insertSlot(3, sec3D.id, day, s.period, s.subject, s.faculty, s.room || (s.subject.toUpperCase().includes('LAB') ? s.subject : 'ET-3060'));
      }
    }
  }

  // Curricula templates
  const y1Curriculum = ['BEE - A', 'BEE - A', 'IP', 'EP', 'ITWS', 'ITWS', 'ITWS', 'LAAC', 'EG', 'EG', 'CP LAB', 'CP LAB'];
  const y2Curriculum = ['DMGT', 'DMGT', 'ADSA', 'ADSA', 'OOPJ', 'OOPJ', 'AI', 'AI', 'ES', 'UHV', 'PYP', 'ADSA LAB', 'OOPJ LAB', 'SEM'];
  const y3Curriculum = ['NLP', 'NLP', 'QT&A', 'QT&A', 'SEM', 'SSP', 'SSP', 'CV&IP', 'CV&IP', 'EDA', 'AI&SP LAB', 'AI&SP LAB', 'FSD', 'CV&ML LAB', 'TINKERING LAB', 'LIB'];
  const y4Curriculum = ['Reinforcement Learning', 'Reinforcement Learning', 'Computer Vision', 'Computer Vision', 'Deep Learning', 'Cloud Computing', 'Advanced CV & RL Lab', 'Advanced CV & RL Lab', 'Advanced CV & RL Lab'];

  // Populate remaining slots across all 13 sections
  for (const sec of allSections) {
    const curr = sec.year === 1 ? y1Curriculum : sec.year === 2 ? y2Curriculum : sec.year === 3 ? y3Curriculum : y4Curriculum;
    for (let dIdx = 0; dIdx < days.length; dIdx++) {
      const day = days[dIdx];
      let p = 1;
      while (p <= 7) {
        const existing = trackedEntries.find(e => e.year === sec.year && e.sectionId === sec.id && e.day === day && e.period === p);
        if (existing) {
          p++;
          continue;
        }

        // Year 4 on Wednesday in Section A (01:50 - 02:40 PM)
        if (sec.year === 4 && day === 'Wednesday' && p === 5 && sec.name.toLowerCase().includes('section a')) {
          insertSlot(sec.year, sec.id, day, p, 'Deep Learning', 'Mr. V. Raghavendra');
          p += 1;
          continue;
        }

        const sub = curr[(p - 1 + dIdx * 2 + sec.id * 3) % curr.length];
        if (sub && sub.toUpperCase() === 'SEM') {
          insertSlot(sec.year, sec.id, day, p, sub, '—');
          p += 1;
          continue;
        }

        const nextSub = p < 7 ? curr[(p + dIdx * 2 + sec.id * 3) % curr.length] : null;
        const willSpan2 = nextSub && nextSub === sub && !trackedEntries.some(e => e.year === sec.year && e.sectionId === sec.id && e.day === day && e.period === p + 1);

        if (sec.year === 1 && !isYear1AimlSubject(sub)) {
          if (willSpan2) {
            insertSlot(sec.year, sec.id, day, p, sub, '—');
            insertSlot(sec.year, sec.id, day, p + 1, sub, '—');
            p += 2;
          } else {
            insertSlot(sec.year, sec.id, day, p, sub, '—');
            p += 1;
          }
          continue;
        }

        if (sec.year === 2 && !isYear2AimlSubject(sub)) {
          if (willSpan2) {
            insertSlot(sec.year, sec.id, day, p, sub, '—');
            insertSlot(sec.year, sec.id, day, p + 1, sub, '—');
            p += 2;
          } else {
            insertSlot(sec.year, sec.id, day, p, sub, '—');
            p += 1;
          }
          continue;
        }

        if (willSpan2) {
          const fac = findFreeFaculty(day, sec.year, [p, p + 1]);
          insertSlot(sec.year, sec.id, day, p, sub, fac);
          insertSlot(sec.year, sec.id, day, p + 1, sub, fac);
          p += 2;
        } else {
          const fac = findFreeFaculty(day, sec.year, [p]);
          insertSlot(sec.year, sec.id, day, p, sub, fac);
          p += 1;
        }
      }
    }
  }

  // Final database-level enforcement: guarantee zero faculty allocated to SEM, Year 1 non-AIML, and Year 2 non-allowed subjects
  db.prepare("UPDATE timetables SET faculty_name = '—' WHERE UPPER(TRIM(subject)) = 'SEM'").run();
  db.prepare(`
    UPDATE timetables 
    SET faculty_name = '—' 
    WHERE year = 1 
      AND UPPER(TRIM(subject)) != 'IP' 
      AND UPPER(TRIM(subject)) NOT LIKE 'IP %' 
      AND UPPER(TRIM(subject)) NOT LIKE '%CP LAB%'
  `).run();
  db.prepare(`
    UPDATE timetables 
    SET faculty_name = '—' 
    WHERE year = 2 
      AND UPPER(TRIM(subject)) NOT IN ('AI', 'ADSA', 'UHV', 'PYP', 'ADSA LAB', 'OOPJ', 'OOPJ LAB', 'PYP LAB')
  `).run();
  db.prepare(`
    UPDATE timetables 
    SET faculty_name = '—' 
    WHERE LOWER(faculty_name) LIKE '%kishor kumar%' 
       OR (LOWER(faculty_name) LIKE '%kishor%' AND LOWER(faculty_name) NOT LIKE '%bala kishore%')
  `).run();

  console.log(`✅ Populated ${trackedEntries.length} timetable slots across 13 sections with 0 clock-time conflicts!`);
}

export function reseedTimetables() {
  console.log('🔄 Re-seeding timetables across all 13 sections...');
  syncSectionsAndFaculty();
  console.log('✅ Timetables successfully re-seeded!');
}

// ============================================================================
// FACULTY & ADMIN ACTIVE SESSION MANAGEMENT
// Enforces "One Account = One Active Login" and "Tab-Scoped Session Lifetime"
// ============================================================================

export function cleanStaleSessions(timeoutMs = 25000) {
  try {
    const now = Date.now();
    const staleThreshold = now - timeoutMs;
    const unloadThreshold = now - 4000;
    db.prepare(`
      DELETE FROM active_sessions 
      WHERE last_active < ? 
         OR (unloaded_at IS NOT NULL AND unloaded_at < ?)
    `).run(staleThreshold, unloadThreshold);
  } catch (err) {
    console.error('Error cleaning stale sessions:', err);
  }
}

export function getActiveSessionByUserId(userId, timeoutMs = 25000) {
  cleanStaleSessions(timeoutMs);
  const now = Date.now();
  const staleThreshold = now - timeoutMs;
  const unloadThreshold = now - 4000;
  return db.prepare(`
    SELECT * FROM active_sessions 
    WHERE user_id = ? 
      AND last_active >= ?
      AND (unloaded_at IS NULL OR unloaded_at >= ?)
    ORDER BY id DESC LIMIT 1
  `).get(userId, staleThreshold, unloadThreshold);
}

export function getActiveSessionById(sessionId, timeoutMs = 35000) {
  cleanStaleSessions(timeoutMs);
  const now = Date.now();
  const staleThreshold = now - timeoutMs;
  return db.prepare(`
    SELECT * FROM active_sessions 
    WHERE session_id = ? 
      AND last_active >= ?
  `).get(sessionId, staleThreshold);
}

export function createActiveSession(userId, role) {
  cleanStaleSessions();
  db.prepare('DELETE FROM active_sessions WHERE user_id = ?').run(userId);
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO active_sessions (session_id, user_id, role, last_active, unloaded_at, created_at)
    VALUES (?, ?, ?, ?, NULL, ?)
  `).run(sessionId, userId, role, now, now);
  return { sessionId, userId, role, last_active: now, created_at: now };
}

export function touchSession(sessionId) {
  try {
    return db.prepare(`
      UPDATE active_sessions 
      SET last_active = ?, unloaded_at = NULL 
      WHERE session_id = ?
    `).run(Date.now(), sessionId);
  } catch (e) {
    return null;
  }
}

export function markSessionUnloading(sessionId) {
  try {
    return db.prepare(`
      UPDATE active_sessions 
      SET unloaded_at = ? 
      WHERE session_id = ?
    `).run(Date.now(), sessionId);
  } catch (e) {
    return null;
  }
}

export function invalidateSession(sessionId) {
  try {
    return db.prepare('DELETE FROM active_sessions WHERE session_id = ?').run(sessionId);
  } catch (e) {
    return null;
  }
}

export function invalidateUserSessions(userId) {
  try {
    return db.prepare('DELETE FROM active_sessions WHERE user_id = ?').run(userId);
  } catch (e) {
    return null;
  }
}

export default db;
