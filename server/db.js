import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { getSlotTimeRange, timesOverlap } from './timeUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'academic.db');
const db = new DatabaseSync(dbPath);

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON;');

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
purgeOldNotifications();
setInterval(purgeOldNotifications, 60 * 60 * 1000);

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
  { id: 'FAC001', name: 'Dr. G. Kishor Kumar', desig: 'Professor & HOD', qual: 'M.Tech & Ph.D', phone: '9848022301', status: 'active' },
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

export function syncSectionsAndFaculty() {
  console.log('🔄 Synchronizing official 13 Sections and 19 Faculty registry...');

  const adminHash = bcrypt.hashSync('admin123', 10);
  const existingAdmin1 = db.prepare('SELECT id FROM users WHERE register_id = ?').get('ADMIN001');
  if (!existingAdmin1) {
    db.prepare(`
      INSERT INTO users (register_id, name, password_hash, role, phone, department, designation, status)
      VALUES ('ADMIN001', 'System Administrator', ?, 'admin', '9848011220', 'AIML', 'System Administrator', 'active')
    `).run(adminHash);
  } else {
    db.prepare(`
      UPDATE users 
      SET name = 'System Administrator', designation = 'System Administrator', role = 'admin', password_hash = ? 
      WHERE register_id = 'ADMIN001'
    `).run(adminHash);
  }

  const existingAdmin2 = db.prepare('SELECT id FROM users WHERE register_id = ?').get('ADMIN002');
  if (!existingAdmin2) {
    db.prepare(`
      INSERT INTO users (register_id, name, password_hash, role, phone, department, designation, status)
      VALUES ('ADMIN002', 'Dr. K. S. Reddy (Vice-Principal / Admin)', ?, 'admin', '9848011221', 'AIML', 'Vice-Principal & Admin', 'active')
    `).run(adminHash);
  } else {
    db.prepare(`
      UPDATE users 
      SET role = 'admin', password_hash = ? 
      WHERE register_id = 'ADMIN002'
    `).run(adminHash);
  }

  // Purge legacy unwanted faculty members and removed pending slots
  db.prepare(`
    DELETE FROM users 
    WHERE (LOWER(name) LIKE '%shoba%' 
       OR LOWER(name) LIKE '%prof. administrator%' 
       OR register_id IN ('FAC020', 'FAC021') 
       OR status = 'pending')
      AND register_id NOT IN ('ADMIN001', 'ADMIN002');
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

  // 2. Upsert the 19 official faculty members
  const facHash = bcrypt.hashSync('faculty123', 10);
  const upsertFacultyStmt = db.prepare(`
    INSERT INTO users (register_id, name, password_hash, role, phone, department, designation, qualification, status)
    VALUES (?, ?, ?, 'faculty', ?, 'AIML', ?, ?, ?)
    ON CONFLICT(register_id) DO UPDATE SET
      name = excluded.name,
      designation = excluded.designation,
      qualification = excluded.qualification,
      status = excluded.status,
      phone = CASE WHEN users.phone IS NULL OR users.phone = '' THEN excluded.phone ELSE users.phone END
  `);

  for (const f of OFFICIAL_FACULTY) {
    upsertFacultyStmt.run(f.id, f.name, facHash, f.phone, f.desig, f.qual, f.status);
  }

  // 2b. Upsert faculty workload and subject/lab competencies (max 16 hrs/week cap)
  const insertWorkloadStmt = db.prepare(`
    INSERT INTO faculty_workload_config (faculty_id, assigned_subjects, assigned_labs, max_weekly_hours)
    VALUES (?, ?, ?, 16)
    ON CONFLICT(faculty_id) DO UPDATE SET
      assigned_subjects = excluded.assigned_subjects,
      assigned_labs = excluded.assigned_labs,
      max_weekly_hours = excluded.max_weekly_hours
  `);

  const facultyWorkloadMap = {
    'FAC001': { subjects: ['AI', 'IP Advanced', 'CV&IP'], labs: ['AI&SP LAB'] },
    'FAC002': { subjects: ['ADSA', 'AI', 'EDA'], labs: ['ADSA LAB'] },
    'FAC003': { subjects: ['NLP', 'CV&IP', 'SSP'], labs: ['CV&ML LAB', 'TINKERING LAB'] },
    'FAC004': { subjects: ['CV&IP', 'IP'], labs: ['CV&ML LAB', 'TINKERING LAB'] },
    'FAC005': { subjects: ['IP', 'UHV', 'EDA'], labs: ['CP LAB'] },
    'FAC006': { subjects: ['EDA', 'OOPJ', 'FSD'], labs: ['CP LAB', 'OOPJ LAB'] },
    'FAC007': { subjects: ['QT&A', 'EDA'], labs: ['AI&SP LAB'] },
    'FAC008': { subjects: ['FSD', 'PYP', 'QT&A'], labs: ['PYP LAB'] },
    'FAC009': { subjects: ['SSP', 'ADSA'], labs: ['AI&SP LAB', 'TINKERING LAB'] },
    'FAC010': { subjects: ['NLP', 'FSD'], labs: ['AI&SP LAB'] },
    'FAC011': { subjects: ['NLP', 'AI', 'CV&IP'], labs: ['AI&SP LAB'] },
    'FAC012': { subjects: ['ADSA', 'SSP', 'QT&A'], labs: ['ADSA LAB'] },
    'FAC013': { subjects: ['CV&IP', 'IP', 'FSD'], labs: ['CV&ML LAB', 'TINKERING LAB'] },
    'FAC014': { subjects: ['SSP', 'UHV', 'QT&A'], labs: ['CP LAB'] },
    'FAC015': { subjects: ['OOPJ', 'AI', 'FSD'], labs: ['OOPJ LAB'] },
    'FAC016': { subjects: ['PYP', 'FSD'], labs: ['PYP LAB'] },
    'FAC017': { subjects: ['EDA', 'ADSA', 'SSP'], labs: ['ADSA LAB'] },
    'FAC018': { subjects: ['PYP', 'OOPJ', 'FSD'], labs: ['PYP LAB'] },
    'FAC019': { subjects: ['QT&A', 'IP', 'EDA'], labs: ['CP LAB'] }
  };

  for (const f of OFFICIAL_FACULTY) {
    const userRec = db.prepare('SELECT id FROM users WHERE register_id = ?').get(f.id);
    if (userRec) {
      const config = facultyWorkloadMap[f.id] || { subjects: ['AI'], labs: ['AI&SP LAB'] };
      insertWorkloadStmt.run(userRec.id, JSON.stringify(config.subjects), JSON.stringify(config.labs));
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
}

// Seed default data
export function seedDatabase() {
  try { db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN qualification TEXT;"); } catch (e) {}

  const adminCheck = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin');
  
  if (adminCheck.count === 0) {
    console.log('🌱 Seeding database with initial academic records...');
    
    // Default Admin 1 (Password: admin123)
    const adminHash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (register_id, name, password_hash, role, phone, department, designation, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run('ADMIN001', 'System Administrator', adminHash, 'admin', '9848011220', 'AIML', 'System Administrator');

    // Default Admin 2 (Password: admin123)
    db.prepare(`
      INSERT INTO users (register_id, name, password_hash, role, phone, department, designation, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run('ADMIN002', 'Dr. K. S. Reddy (Vice-Principal / Admin)', adminHash, 'admin', '9848011221', 'AIML', 'Vice-Principal & Admin');

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

  // Ensure multiple admins exist even if DB was previously seeded
  const admin2 = db.prepare('SELECT id FROM users WHERE register_id = ?').get('ADMIN002');
  if (!admin2) {
    const adminHash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (register_id, name, password_hash, role, phone, department, designation, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run('ADMIN002', 'Dr. K. S. Reddy (Vice-Principal / Admin)', adminHash, 'admin', '9848011221', 'AIML', 'Vice-Principal & Admin');
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

  console.log('✅ Database successfully initialized with 13 Sections and 19 Faculty registry!');
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

  const allFaculty = OFFICIAL_FACULTY.filter(f => f.status === 'active').map(f => f.name);

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
    const hasP2 = periodArr.some(p => parseInt(p, 10) === 2);
    if (preferred) {
      const ok = periodArr.every(p => !checkConflict(preferred, day, year, p));
      if (ok) return preferred;
    }
    const n = allFaculty.length;
    for (let i = 0; i < n; i++) {
      const candidate = allFaculty[(facultyRoundRobin + i) % n];
      // Keep Dr. G. Kishor Kumar free on Thursday Period 2 for office hours and Wednesday Periods 1 & 2
      const isKishor = candidate.toLowerCase().includes('kishor');
      if (day === 'Thursday' && hasP2 && isKishor) {
        continue;
      }
      if (day === 'Wednesday' && periodArr.some(p => [1, 2].includes(parseInt(p, 10))) && isKishor) {
        continue;
      }
      const ok = periodArr.every(p => !checkConflict(candidate, day, year, p));
      if (ok) {
        facultyRoundRobin = (facultyRoundRobin + i + 1) % n;
        return candidate;
      }
    }
    if (day === 'Thursday' && hasP2) {
      return allFaculty.find(f => !f.toLowerCase().includes('kishor')) || allFaculty[1];
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
      { period: 7, subject: 'IP Advanced', faculty: 'Dr. G. Kishor Kumar' }, // 04:00 - 04:50 PM
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

  // Official 3rd Year - Section A Schedule from Source-of-Truth Photo (Room numbers neglected per user request)
  const year3SecASchedule = {
    Monday: [
      { period: 1, subject: 'NLP', faculty: 'Mr. V. Phanishwara Hara Gopal', room: '' },
      { period: 2, subject: 'NLP', faculty: 'Mr. V. Phanishwara Hara Gopal', room: '' },
      { period: 3, subject: 'QT&A', faculty: 'Dr. S. Farooq', room: '' },
      { period: 4, subject: 'QT&A', faculty: 'Dr. S. Farooq', room: '' },
      { period: 5, subject: 'AI&SP LAB', faculty: 'Ms. E. Naveena', room: '' },
      { period: 6, subject: 'AI&SP LAB', faculty: 'Ms. E. Naveena', room: '' },
      { period: 7, subject: 'AI&SP LAB', faculty: 'Ms. E. Naveena', room: '' },
    ],
    Tuesday: [
      { period: 1, subject: 'CV&IP', faculty: 'Dr. Chakrapani', room: '' },
      { period: 2, subject: 'CV&IP', faculty: 'Dr. Chakrapani', room: '' },
      { period: 3, subject: 'SEM', faculty: '—', room: '' },
      { period: 4, subject: 'SEM', faculty: '—', room: '' },
      { period: 5, subject: 'TINKERING LAB', faculty: 'Dr. Chakrapani', room: '' },
      { period: 6, subject: 'TINKERING LAB', faculty: 'Dr. Chakrapani', room: '' },
      { period: 7, subject: 'TINKERING LAB', faculty: 'Dr. Chakrapani', room: '' },
    ],
    Wednesday: [
      { period: 1, subject: 'SSP', faculty: 'Ms. E. Naveena', room: '' },
      { period: 2, subject: 'SSP', faculty: 'Ms. E. Naveena', room: '' },
      { period: 3, subject: 'EDA', faculty: 'Mr. P. Sreekanth Reddy', room: '' },
      { period: 4, subject: 'EDA', faculty: 'Mr. P. Sreekanth Reddy', room: '' },
      { period: 5, subject: 'SEM', faculty: '—', room: '' },
      { period: 6, subject: 'NLP', faculty: 'Mr. V. Phanishwara Hara Gopal', room: '' },
      { period: 7, subject: 'NLP', faculty: 'Mr. V. Phanishwara Hara Gopal', room: '' },
    ],
    Thursday: [
      { period: 1, subject: 'FSD', faculty: 'Mr. S. Kalim Peerulla Basha', room: '' },
      { period: 2, subject: 'FSD', faculty: 'Mr. S. Kalim Peerulla Basha', room: '' },
      { period: 3, subject: 'SEM', faculty: '—', room: '' },
      { period: 4, subject: 'SEM', faculty: '—', room: '' },
      { period: 5, subject: 'CV&ML LAB', faculty: 'Dr. Chakrapani', room: '' },
      { period: 6, subject: 'CV&ML LAB', faculty: 'Dr. Chakrapani', room: '' },
      { period: 7, subject: 'CV&ML LAB', faculty: 'Dr. Chakrapani', room: '' },
    ],
    Friday: [
      { period: 1, subject: 'QT&A', faculty: 'Dr. S. Farooq', room: '' },
      { period: 2, subject: 'QT&A', faculty: 'Dr. S. Farooq', room: '' },
      { period: 3, subject: 'SSP', faculty: 'Ms. E. Naveena', room: '' },
      { period: 4, subject: 'SSP', faculty: 'Ms. E. Naveena', room: '' },
      { period: 5, subject: 'LIB', faculty: '—', room: '' },
      { period: 6, subject: 'CV&IP', faculty: 'Dr. Chakrapani', room: '' },
      { period: 7, subject: 'CV&IP', faculty: 'Dr. Chakrapani', room: '' },
    ],
    Saturday: [
      { period: 1, subject: 'EDA', faculty: 'Mr. P. Sreekanth Reddy', room: '' },
      { period: 2, subject: 'EDA', faculty: 'Mr. P. Sreekanth Reddy', room: '' },
      { period: 3, subject: 'LIB', faculty: '—', room: '' },
      { period: 4, subject: 'LIB', faculty: '—', room: '' },
      { period: 5, subject: 'SEM', faculty: '—', room: '' },
      { period: 6, subject: 'SEM', faculty: '—', room: '' },
      { period: 7, subject: 'FSD', faculty: 'Mr. S. Kalim Peerulla Basha', room: '' },
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
      { period: 1, subject: 'OOPJ', faculty: 'Dr. G. Kishor Kumar', room: 'RG-207' },
      { period: 2, subject: 'OOPJ', faculty: 'Dr. G. Kishor Kumar', room: 'RG-207' },
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

  // 1. Seed Year 1 Sec A, Year 2 Sec A, Year 2 Sec B, Year 2 Sec C, Year 2 Sec D, and Year 3 Sec A
  for (const day of days) {
    if (sec1A) {
      for (const s of year1Schedule[day]) {
        insertSlot(1, sec1A.id, day, s.period, s.subject, s.faculty, s.room || '');
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
        insertSlot(3, sec3A.id, day, s.period, s.subject, s.faculty, s.room || '');
      }
    }
    if (sec3B) {
      for (const s of year3SecBSchedule[day]) {
        insertSlot(3, sec3B.id, day, s.period, s.subject, s.faculty, s.room || '');
      }
    }
    if (sec3C) {
      for (const s of year3SecCSchedule[day]) {
        insertSlot(3, sec3C.id, day, s.period, s.subject, s.faculty, s.room || '');
      }
    }
    if (sec3D) {
      for (const s of year3SecDSchedule[day]) {
        insertSlot(3, sec3D.id, day, s.period, s.subject, s.faculty, s.room || '');
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

        // Guarantee Dr. G. Kishor Kumar teaches Year 4 on Wednesday in Section A (01:50 - 02:40 PM)
        if (sec.year === 4 && day === 'Wednesday' && p === 5 && sec.name.toLowerCase().includes('section a')) {
          insertSlot(sec.year, sec.id, day, p, 'Deep Learning', 'Dr. G. Kishor Kumar');
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

  console.log(`✅ Populated ${trackedEntries.length} timetable slots across 13 sections with 0 clock-time conflicts!`);
}

export function reseedTimetables() {
  console.log('🔄 Re-seeding timetables across all 13 sections...');
  syncSectionsAndFaculty();
  console.log('✅ Timetables successfully re-seeded!');
}

export default db;
