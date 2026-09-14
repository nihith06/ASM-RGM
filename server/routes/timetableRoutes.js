import express from 'express';
import db, { isYear1AimlSubject, isYear2AimlSubject, isHodFaculty } from '../db.js';
import { authenticateToken, requireAdmin } from '../auth.js';
import { checkFacultyConflict, getSlotTimeRange, timesOverlap } from '../timeUtils.js';
import { generateSchedule } from '../services/scheduleGenerator.js';
import { 
  registerClient, 
  broadcastTimetableUpdate, 
  getTimetableVersion,
  shouldCreateTimetableNotification
} from '../services/realtimeService.js';

const router = express.Router();

const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Helper to notify clients and persist global notification for timetable updates
function notifyTimetableUpdate(year, sectionId, customMessage = null) {
  try {
    const sec = db.prepare('SELECT name FROM sections WHERE id = ?').get(sectionId);
    const secName = sec ? sec.name : `Section ${sectionId}`;
    const yearSuffix = year === 1 ? '1st' : year === 2 ? '2nd' : year === 3 ? '3rd' : '4th';
    const message = customMessage || `Admin updated the timetable for ${yearSuffix} Year - ${secName}.`;
    const today = new Date().toISOString().split('T')[0];

    const notifKey = `${year}_${sectionId}`;
    if (shouldCreateTimetableNotification(notifKey)) {
      db.prepare(`
        INSERT INTO global_notifications (type, faculty_name, leave_date, message)
        VALUES ('timetable_update', 'Administrator', ?, ?)
      `).run(today, message);
    }

    broadcastTimetableUpdate({
      year,
      section_id: sectionId,
      section_name: secName,
      action: 'timetable_changed',
      message
    });
  } catch (err) {
    console.error('Error notifying timetable update:', err);
  }
}

// GET real-time Server-Sent Events stream
router.get('/events', authenticateToken, (req, res) => {
  registerClient(req, res);
});

// GET current timetable version for polling fallback
router.get('/version', authenticateToken, (req, res) => {
  res.json(getTimetableVersion());
});

// GET all sections (optionally filtered by year)
router.get('/sections', authenticateToken, (req, res) => {
  try {
    const { year } = req.query;
    let query = 'SELECT * FROM sections';
    const params = [];

    if (year) {
      query += ' WHERE year = ?';
      params.push(parseInt(year, 10));
    }
    query += ` ORDER BY year ASC, CASE 
      WHEN LOWER(name) LIKE '%section a%' THEN 1 
      WHEN LOWER(name) LIKE '%section b%' THEN 2 
      WHEN LOWER(name) LIKE '%section c%' THEN 3 
      WHEN LOWER(name) LIKE '%section d%' THEN 4 
      ELSE 5 
    END, name ASC`;

    const sections = db.prepare(query).all(...params);
    res.json({ sections });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST add section (Admin only)
router.post('/sections', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { year, name } = req.body;
    const yr = parseInt(year, 10);

    if (![1, 2, 3, 4].includes(yr) || !name || !name.trim()) {
      return res.status(400).json({ error: 'Valid year (1-4) and section name are required.' });
    }

    const cleanName = name.trim();
    const existing = db.prepare('SELECT id FROM sections WHERE year = ? AND LOWER(name) = LOWER(?)').get(yr, cleanName);
    if (existing) {
      return res.status(409).json({ error: `Section "${cleanName}" already exists for Year ${yr}.` });
    }

    const info = db.prepare('INSERT INTO sections (year, name) VALUES (?, ?)').run(yr, cleanName);
    const newSection = db.prepare('SELECT * FROM sections WHERE id = ?').get(info.lastInsertRowid);

    broadcastTimetableUpdate({
      year: yr,
      section_id: newSection.id,
      section_name: newSection.name,
      action: 'section_added',
      message: `Admin added section ${newSection.name} for Year ${yr}.`
    });

    res.status(201).json({ message: 'Section created successfully', section: newSection });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE section (Admin only)
router.delete('/sections/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Section not found' });
    }

    // Delete associated timetables and section
    db.prepare('DELETE FROM timetables WHERE section_id = ?').run(id);
    db.prepare('DELETE FROM sections WHERE id = ?').run(id);

    broadcastTimetableUpdate({
      year: existing.year,
      section_id: id,
      section_name: existing.name,
      action: 'section_deleted',
      message: `Admin deleted section ${existing.name} from Year ${existing.year}.`
    });

    res.json({ message: `Section "${existing.name}" (Year ${existing.year}) deleted successfully.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET timetable: accessible to all logged-in users (Students, Faculty, Admin)
// Can view any year (1, 2, 3, 4) and section
router.get('/', authenticateToken, (req, res) => {
  try {
    const year = parseInt(req.query.year || 1, 10);
    let sectionId = req.query.section_id ? parseInt(req.query.section_id, 10) : null;

    if (![1, 2, 3, 4].includes(year)) {
      return res.status(400).json({ error: 'Year must be 1, 2, 3, or 4.' });
    }

    const sections = db.prepare(`
      SELECT * FROM sections 
      WHERE year = ? 
      ORDER BY CASE 
        WHEN LOWER(name) LIKE '%section a%' THEN 1 
        WHEN LOWER(name) LIKE '%section b%' THEN 2 
        WHEN LOWER(name) LIKE '%section c%' THEN 3 
        WHEN LOWER(name) LIKE '%section d%' THEN 4 
        ELSE 5 
      END, name ASC
    `).all(year);
    
    if (sections.length === 0) {
      return res.json({ year, section: null, sections: [], grid: {} });
    }

    // If sectionId is not specified or invalid, default to the first section
    let activeSection = sections.find(s => s.id === sectionId) || sections[0];
    sectionId = activeSection.id;

    // Fetch timetable cells
    const entries = db.prepare(`
      SELECT day, period, subject, faculty_name, room
      FROM timetables
      WHERE year = ? AND section_id = ?
      ORDER BY 
        CASE day 
          WHEN 'Monday' THEN 1 
          WHEN 'Tuesday' THEN 2 
          WHEN 'Wednesday' THEN 3 
          WHEN 'Thursday' THEN 4 
          WHEN 'Friday' THEN 5 
          WHEN 'Saturday' THEN 6 
          ELSE 7 
        END,
        period ASC
    `).all(year, sectionId);

    // Build structured grid object { [Day]: { [period]: { subject, faculty_name, room } } }
    const grid = {};
    for (const day of VALID_DAYS) {
      grid[day] = {};
      for (let p = 1; p <= 7; p++) {
        grid[day][p] = { subject: '—', faculty_name: '—', room: '' };
      }
    }

    const filterDate = req.query.date;
    const leaveMap = new Map();
    let leavesForDate = [];
    if (filterDate) {
      leavesForDate = db.prepare(`
        SELECT faculty_id, faculty_name, leave_date, reason, status
        FROM faculty_leaves
        WHERE leave_date = ? AND status = 'leave'
      `).all(filterDate);
      for (const lv of leavesForDate) {
        if (lv.faculty_name) {
          leaveMap.set(lv.faculty_name.trim().toLowerCase(), lv);
        }
      }
    }

    // Determine the day of week for filterDate if provided
    let dateDayName = null;
    if (filterDate) {
      const parsedDate = new Date(filterDate + 'T00:00:00');
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      dateDayName = days[parsedDate.getDay()];
    }

    for (const entry of entries) {
      if (grid[entry.day] && grid[entry.day][entry.period]) {
        const facKey = (entry.faculty_name || '').trim().toLowerCase();
        const facultyLeave = leaveMap.get(facKey);
        // An affected class occurs if the entry's day matches the date's day of week, or if any leave is on this date
        const isClassAffected = Boolean(facultyLeave && (!dateDayName || dateDayName === entry.day));

        grid[entry.day][entry.period] = {
          subject: entry.subject || '—',
          faculty_name: entry.faculty_name || '—',
          room: entry.room || '',
          is_on_leave: isClassAffected,
          leave_reason: isClassAffected ? (facultyLeave.reason || 'Personal Leave') : null
        };
      }
    }

    // Extract unique faculty teaching in this section for the PDF footer
    const facultyListInSec = db.prepare(`
      SELECT DISTINCT t.subject, t.faculty_name, u.phone
      FROM timetables t
      LEFT JOIN users u ON LOWER(TRIM(u.name)) = LOWER(TRIM(t.faculty_name)) AND u.role = 'faculty'
      WHERE t.year = ? AND t.section_id = ? AND t.subject != '—' AND t.faculty_name != '—'
      ORDER BY t.subject ASC
    `).all(year, sectionId);

    const isStudent = req.user && req.user.role === 'student';
    const faculty_details = facultyListInSec.map(item => ({
      subject: item.subject,
      faculty_name: item.faculty_name,
      phone: isStudent ? 'Protected' : (item.phone || '—')
    }));

    res.json({
      year,
      section: activeSection,
      sections,
      date: filterDate || null,
      grid,
      faculty_details
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST update a single timetable cell or merged block of periods (Admin only)
router.post('/cell', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { year, section_id, day, period, periods, subject, faculty_name, room } = req.body;
    const yr = parseInt(year, 10);
    const secId = parseInt(section_id, 10);

    const periodList = Array.isArray(periods) && periods.length > 0 
      ? periods.map(p => parseInt(p, 10)) 
      : [parseInt(period, 10)];

    if (![1, 2, 3, 4].includes(yr) || !VALID_DAYS.includes(day) || periodList.some(p => isNaN(p) || p < 1 || p > 7)) {
      return res.status(400).json({ error: 'Invalid year, day, or period (1-7).' });
    }

    const cleanSubject = (subject || '').trim();
    const isSem = cleanSubject.toUpperCase() === 'SEM';
    const isYear1NonAiml = yr === 1 && !isYear1AimlSubject(cleanSubject);
    const isYear2NonAiml = yr === 2 && !isYear2AimlSubject(cleanSubject);
    const cleanFaculty = (isSem || isYear1NonAiml || isYear2NonAiml) ? '—' : (faculty_name || '').trim();

    // Exclusion: Dr. G. Kishor Kumar must not be assigned or allocated any teaching subjects
    if (cleanFaculty && cleanFaculty !== '—' && isHodFaculty(cleanFaculty)) {
      return res.status(422).json({
        error: 'This faculty member cannot be assigned or allocated any teaching subjects.'
      });
    }

    // Perform clock-time conflict check for each period (skip for SEM, Year 1 non-AIML, and Year 2 non-allowed since they have no faculty)
    if (!isSem && !isYear1NonAiml && !isYear2NonAiml && cleanSubject && cleanSubject !== '—' && cleanFaculty && cleanFaculty !== '—') {
      for (const p of periodList) {
        const conflict = checkFacultyConflict(db, cleanFaculty, day, yr, p, {
          year: yr,
          section_id: secId,
          day,
          period: p
        });

        if (conflict.conflict) {
          return res.status(409).json({
            error: conflict.message,
            conflict
          });
        }
      }
    }

    // Upsert into timetables table
    const stmt = db.prepare(`
      INSERT INTO timetables (year, section_id, day, period, subject, faculty_name, room)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(year, section_id, day, period) DO UPDATE SET
        subject = excluded.subject,
        faculty_name = excluded.faculty_name,
        room = excluded.room
    `);

    db.exec('BEGIN TRANSACTION;');
    try {
      for (const p of periodList) {
        stmt.run(
          yr,
          secId,
          day,
          p,
          cleanSubject || '—',
          cleanFaculty || '—',
          (room || '').trim() || ''
        );
      }
      db.exec('COMMIT;');
      notifyTimetableUpdate(yr, secId);
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }

    res.json({ message: periodList.length > 1 ? `Updated ${periodList.length} consecutive periods successfully` : 'Cell updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST bulk upload/update whole grid for a year & section (Admin only)
router.post('/bulk-grid', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { year, section_id, cells } = req.body;
    const yr = parseInt(year, 10);
    const secId = parseInt(section_id, 10);

    if (![1, 2, 3, 4].includes(yr) || !secId || !Array.isArray(cells)) {
      return res.status(400).json({ error: 'Valid year, section_id, and cells array required.' });
    }

    // Validate faculty conflicts before applying updates
    for (const c of cells) {
      const p = parseInt(c.period, 10);
      const sub = (c.subject || '').trim();
      const isSem = sub.toUpperCase() === 'SEM';
      const isYear1NonAiml = yr === 1 && !isYear1AimlSubject(sub);
      const isYear2NonAiml = yr === 2 && !isYear2AimlSubject(sub);
      const isHod = isHodFaculty(c.faculty_name);
      const fac = (isSem || isYear1NonAiml || isYear2NonAiml || isHod) ? '—' : (c.faculty_name || '').trim();

      if (!isSem && !isYear1NonAiml && !isYear2NonAiml && !isHod && VALID_DAYS.includes(c.day) && p >= 1 && p <= 7 && sub && sub !== '—' && fac && fac !== '—') {
        const conflict = checkFacultyConflict(db, fac, c.day, yr, p, {
          year: yr,
          section_id: secId,
          day: c.day,
          period: p
        });

        if (conflict.conflict) {
          return res.status(409).json({
            error: `Bulk upload stopped: ${conflict.message}`,
            conflict
          });
        }
      }
    }

    const stmt = db.prepare(`
      INSERT INTO timetables (year, section_id, day, period, subject, faculty_name, room)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(year, section_id, day, period) DO UPDATE SET
        subject = excluded.subject,
        faculty_name = excluded.faculty_name,
        room = excluded.room
    `);

    db.exec('BEGIN TRANSACTION;');
    try {
      for (const c of cells) {
        if (VALID_DAYS.includes(c.day) && c.period >= 1 && c.period <= 7) {
          const sub = (c.subject || '').trim();
          const isSem = sub.toUpperCase() === 'SEM';
          const isYear1NonAiml = yr === 1 && !isYear1AimlSubject(sub);
          const isYear2NonAiml = yr === 2 && !isYear2AimlSubject(sub);
          const isHod = isHodFaculty(c.faculty_name);
          const fac = (isSem || isYear1NonAiml || isYear2NonAiml || isHod) ? '—' : ((c.faculty_name || '').trim() || '—');
          stmt.run(
            yr,
            secId,
            c.day,
            c.period,
            sub || '—',
            fac,
            (c.room || '').trim() || ''
          );
        }
      }
      db.exec('COMMIT;');
      notifyTimetableUpdate(yr, secId);
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }

    res.json({ message: `Successfully updated ${cells.length} periods for Year ${yr}!` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST import CSV data string (Admin only)
router.post('/import-csv', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { year, section_id, csv_data } = req.body;
    const yr = parseInt(year, 10);
    const secId = parseInt(section_id, 10);

    if (![1, 2, 3, 4].includes(yr) || !secId || !csv_data) {
      return res.status(400).json({ error: 'Year, section_id, and csv_data string are required.' });
    }

    // Expected format: Day,Period,Subject,Faculty,Room
    const lines = csv_data.split(/\r?\n/).filter(line => line.trim().length > 0);
    const parsedCells = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip header line if present
      if (i === 0 && line.toLowerCase().includes('day') && line.toLowerCase().includes('period')) {
        continue;
      }

      const parts = line.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      if (parts.length >= 4) {
        const day = parts[0];
        const period = parseInt(parts[1], 10);
        const subject = parts[2];
        const isSem = (subject || '').trim().toUpperCase() === 'SEM';
        const isYear1NonAiml = yr === 1 && !isYear1AimlSubject(subject);
        const isYear2NonAiml = yr === 2 && !isYear2AimlSubject(subject);
        const isHod = isHodFaculty(parts[3]);
        const faculty_name = (isSem || isYear1NonAiml || isYear2NonAiml || isHod) ? '—' : parts[3];
        const room = parts[4] || '';

        if (VALID_DAYS.includes(day) && period >= 1 && period <= 7) {
          parsedCells.push({ day, period, subject, faculty_name, room });
        }
      }
    }

    if (parsedCells.length === 0) {
      return res.status(400).json({ error: 'No valid timetable rows found. CSV format: Day,Period,Subject,Faculty,Room' });
    }

    // Validate faculty conflicts for parsed cells
    for (const c of parsedCells) {
      const isSem = (c.subject || '').trim().toUpperCase() === 'SEM';
      const isYear1NonAiml = yr === 1 && !isYear1AimlSubject(c.subject);
      const isYear2NonAiml = yr === 2 && !isYear2AimlSubject(c.subject);
      const isHod = isHodFaculty(c.faculty_name);
      if (!isSem && !isYear1NonAiml && !isYear2NonAiml && !isHod && c.subject && c.subject !== '—' && c.faculty_name && c.faculty_name !== '—') {
        const conflict = checkFacultyConflict(db, c.faculty_name, c.day, yr, c.period, {
          year: yr,
          section_id: secId,
          day: c.day,
          period: c.period
        });

        if (conflict.conflict) {
          return res.status(409).json({
            error: `CSV Import conflict: ${conflict.message}`,
            conflict
          });
        }
      }
    }

    const stmt = db.prepare(`
      INSERT INTO timetables (year, section_id, day, period, subject, faculty_name, room)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(year, section_id, day, period) DO UPDATE SET
        subject = excluded.subject,
        faculty_name = excluded.faculty_name,
        room = excluded.room
    `);

    db.exec('BEGIN TRANSACTION;');
    try {
      for (const c of parsedCells) {
        stmt.run(yr, secId, c.day, c.period, c.subject, c.faculty_name, c.room);
      }
      db.exec('COMMIT;');
      notifyTimetableUpdate(yr, secId);
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }

    res.json({ message: `Successfully imported ${parsedCells.length} slots from CSV!`, count: parsedCells.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST generate timetable using constraint satisfaction solver (Admin only)
router.post('/generate', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { section_id, all_sections, year } = req.body;
    const result = generateSchedule({
      sectionId: section_id ? parseInt(section_id, 10) : null,
      allSections: Boolean(all_sections),
      year: year ? parseInt(year, 10) : null
    });

    if (!result.success) {
      return res.status(422).json(result);
    }

    // Log to audit log
    try {
      db.prepare(`
        INSERT INTO audit_logs (action, performed_by_id, details)
        VALUES (?, ?, ?)
      `).run(
        'GENERATE_SCHEDULE',
        req.user.id,
        `Generated schedule: ${result.message}`
      );
    } catch (e) {}

    if (!req.body.dryRun) {
      const yearSuffix = year ? (year === 1 ? '1st' : year === 2 ? '2nd' : year === 3 ? '3rd' : '4th') : '';
      const notifMsg = all_sections
        ? 'Admin regenerated timetables across all academic sections.'
        : `Admin regenerated timetable for ${yearSuffix ? yearSuffix + ' Year' : 'the department'}.`;
      const today = new Date().toISOString().split('T')[0];
      try {
        db.prepare(`
          INSERT INTO global_notifications (type, faculty_name, leave_date, message)
          VALUES ('timetable_update', 'Administrator', ?, ?)
        `).run(today, notifMsg);
      } catch (e) {}

      broadcastTimetableUpdate({
        year: year ? parseInt(year, 10) : null,
        section_id: section_id ? parseInt(section_id, 10) : null,
        action: 'schedule_generated',
        message: notifMsg
      });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function normalizeDayName(str) {
  if (!str) return null;
  const clean = str.trim().toLowerCase();
  for (const d of VALID_DAYS) {
    if (d.toLowerCase() === clean || clean === d.toLowerCase().slice(0, 3)) {
      return d;
    }
  }
  return null;
}

// POST validate uploaded timetable before any creation/replacement (Admin only)
// Strictly checks ONLY the existing upload validation rules:
// 1. Day (Monday-Saturday) & Hour (1-7)
// 2. Faculty Teaching Conflict (only actual teaching hour overlaps; ignores Busy & Leave status)
// (Note: Empty Subject, Faculty, or Room are accepted; subjects can appear any number of times per week)
router.post('/validate-upload', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { year, section_id, cells } = req.body;
    const yr = parseInt(year, 10);
    const secId = parseInt(section_id, 10);

    if (![1, 2, 3, 4].includes(yr) || !secId || !Array.isArray(cells) || cells.length === 0) {
      return res.status(400).json({ valid: false, error: 'Valid year, section_id, and timetable cells are required.' });
    }

    const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(secId);
    if (!section) {
      return res.status(404).json({ valid: false, error: 'Section not found.' });
    }

    // ==========================================
    // RULE 1 — DAY & HOUR
    // ==========================================
    for (const c of cells) {
      const day = normalizeDayName(c.day);
      const period = typeof c.period === 'number' ? c.period : parseInt(c.period, 10);

      if (!day || !VALID_DAYS.includes(day) || isNaN(period) || period < 1 || period > 7) {
        return res.status(400).json({
          valid: false,
          error: 'Cannot create timetable. Invalid Day or Hour. Day must be Monday to Saturday and Hour must be 1 to 7.'
        });
      }
    }

    // ==========================================
    // RULE 2 — FACULTY TEACHING CONFLICT
    // ==========================================
    // Intra-upload conflict: same faculty assigned multiple times to the same Day & Hour in uploaded file
    const intraMap = new Map();
    for (const c of cells) {
      const day = normalizeDayName(c.day);
      const period = parseInt(c.period, 10);
      const fac = (c.faculty_name || '').trim();

      if (!fac || fac === '—' || fac === '-' || fac.toLowerCase() === 'nil' || fac.toLowerCase() === 'free') {
        continue;
      }

      const key = `${day}_${period}`;
      if (intraMap.has(key)) {
        const prevFac = intraMap.get(key);
        if (prevFac.toLowerCase() === fac.toLowerCase()) {
          const currentYearSuffix = yr === 1 ? '1st' : yr === 2 ? '2nd' : yr === 3 ? '3rd' : '4th';
          return res.status(409).json({
            valid: false,
            error: `Cannot create timetable. ${fac} is already teaching on ${day} during Hour ${period} in ${currentYearSuffix} Year - ${section.name}.`
          });
        }
      }
      intraMap.set(key, fac);
    }

    // Database conflict: check if faculty is already teaching during SAME DAY and SAME HOUR in another year or section
    for (const c of cells) {
      const day = normalizeDayName(c.day);
      const period = parseInt(c.period, 10);
      const fac = (c.faculty_name || '').trim();

      // If Faculty parameter is empty, skip this check for that hour
      if (!fac || fac === '—' || fac === '-' || fac.toLowerCase() === 'nil' || fac.toLowerCase() === 'free') {
        continue;
      }

      const candidateRange = getSlotTimeRange(yr, period);

      const otherClasses = db.prepare(`
        SELECT t.id, t.year, t.section_id, t.day, t.period, t.subject, t.faculty_name, s.name as section_name
        FROM timetables t
        LEFT JOIN sections s ON t.section_id = s.id
        WHERE LOWER(TRIM(t.faculty_name)) = ?
          AND t.day = ?
          AND t.subject != '—'
          AND TRIM(t.subject) != ''
          AND NOT (t.year = ? AND t.section_id = ?)
      `).all(fac.toLowerCase(), day, yr, secId);

      for (const item of otherClasses) {
        const isSameHour = item.period === period;
        const existingRange = getSlotTimeRange(item.year, item.period);
        const isTimeOverlap = candidateRange && existingRange && timesOverlap(candidateRange, existingRange);

        if (isSameHour || isTimeOverlap) {
          const conflictYearSuffix = item.year === 1 ? '1st' : item.year === 2 ? '2nd' : item.year === 3 ? '3rd' : '4th';
          const conflictSecName = item.section_name || `Section ${item.section_id}`;
          return res.status(409).json({
            valid: false,
            error: `Cannot create timetable. ${fac} is already teaching on ${day} during Hour ${item.period} in ${conflictYearSuffix} Year - ${conflictSecName}.`
          });
        }
      }
    }

    const validCells = cells.map(c => {
      const d = normalizeDayName(c.day);
      const p = parseInt(c.period, 10);
      const rawSub = (c.subject || '').trim();
      const rawFac = (c.faculty_name || '').trim();
      const rawRoom = (c.room || '').trim();

      const sub = (!rawSub || rawSub === '-' || rawSub.toLowerCase() === 'nil' || rawSub.toLowerCase() === 'free') ? '—' : rawSub;
      const fac = (!rawFac || rawFac === '-' || rawFac.toLowerCase() === 'nil' || rawFac.toLowerCase() === 'free') ? '—' : rawFac;
      const room = (!rawRoom || rawRoom === '-' || rawRoom.toLowerCase() === 'nil') ? '' : rawRoom;

      return {
        day: d,
        period: p,
        subject: sub,
        faculty_name: fac,
        room: room
      };
    });

    return res.json({
      valid: true,
      count: validCells.length,
      cells: validCells
    });
  } catch (error) {
    res.status(500).json({ valid: false, error: error.message });
  }
});

// POST replace timetable for currently selected year and section (Admin only)
// Executed ONLY after Admin clicks "Confirm Create" following successful validation.
router.post('/replace-section-timetable', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { year, section_id, cells } = req.body;
    const yr = parseInt(year, 10);
    const secId = parseInt(section_id, 10);

    if (![1, 2, 3, 4].includes(yr) || !secId || !Array.isArray(cells) || cells.length === 0) {
      return res.status(400).json({ error: 'Valid year, section_id, and timetable cells are required.' });
    }

    const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(secId);
    if (!section) {
      return res.status(404).json({ error: 'Section not found.' });
    }

    const yearSuffix = yr === 1 ? '1st' : yr === 2 ? '2nd' : yr === 3 ? '3rd' : '4th';

    const insertStmt = db.prepare(`
      INSERT INTO timetables (year, section_id, day, period, subject, faculty_name, room)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Delete existing timetable strictly for this year and section
      db.prepare('DELETE FROM timetables WHERE year = ? AND section_id = ?').run(yr, secId);

      // Create map of uploaded cells
      const cellMap = new Map();
      for (const c of cells) {
        const d = normalizeDayName(c.day);
        const p = parseInt(c.period, 10);
        if (VALID_DAYS.includes(d) && p >= 1 && p <= 7) {
          const rawSub = (c.subject || '').trim();
          const rawFac = (c.faculty_name || '').trim();
          const rawRoom = (c.room || '').trim();

          const sub = (!rawSub || rawSub === '-' || rawSub.toLowerCase() === 'nil' || rawSub.toLowerCase() === 'free') ? '—' : rawSub;
          const fac = (!rawFac || rawFac === '-' || rawFac.toLowerCase() === 'nil' || rawFac.toLowerCase() === 'free') ? '—' : rawFac;
          const room = (!rawRoom || rawRoom === '-' || rawRoom.toLowerCase() === 'nil') ? '' : rawRoom;

          cellMap.set(`${d}_${p}`, { sub, fac, room });
        }
      }

      // 2. Insert slots for all valid days and periods 1-7
      for (const d of VALID_DAYS) {
        for (let p = 1; p <= 7; p++) {
          const key = `${d}_${p}`;
          const slot = cellMap.get(key) || { sub: '—', fac: '—', room: '' };
          insertStmt.run(yr, secId, d, p, slot.sub, slot.fac, slot.room);
        }
      }

      db.exec('COMMIT;');

      // 3. Notify and audit log
      notifyTimetableUpdate(yr, secId, `Admin uploaded and replaced timetable for ${yearSuffix} Year - ${section.name}.`);

      try {
        db.prepare(`
          INSERT INTO audit_logs (action, performed_by_id, details)
          VALUES (?, ?, ?)
        `).run(
          'UPLOAD_TIMETABLE',
          req.user.id,
          `Uploaded and replaced timetable for ${yearSuffix} Year - ${section.name} (${cells.length} slots).`
        );
      } catch (e) {}

      res.json({
        success: true,
        message: `Timetable for ${yearSuffix} Year - ${section.name} successfully updated!`,
        count: cells.length
      });
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

