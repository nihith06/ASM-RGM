import express from 'express';
import db from '../db.js';
import { authenticateToken } from '../auth.js';
import { getSlotTimeRange, SENIOR_YEAR_SLOTS, YEAR_1_SLOTS, PERIOD_LABELS, formatDateHuman } from '../timeUtils.js';
import { broadcastTimetableUpdate } from '../services/realtimeService.js';

const router = express.Router();

const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// GET faculty availability: public to all authenticated users (Students, Faculty, Admin)
// Automatically computes free periods across all 4 years & sections, merged with manual overrides and global leaves
router.get('/availability', authenticateToken, (req, res) => {
  try {
    const { day: filterDay, search, date: filterDate } = req.query;

    // Fetch all active faculty members (strictly role = 'faculty' and excluding legacy unwanted profiles)
    let facultyQuery = `
      SELECT id, register_id, name, department, designation, qualification, status
      FROM users
      WHERE role = 'faculty'
        AND register_id != 'FAC001'
        AND LOWER(name) NOT LIKE '%kishor kumar%'
        AND (LOWER(name) NOT LIKE '%kishor%' OR LOWER(name) LIKE '%bala kishore%')
        AND LOWER(name) NOT LIKE '%shoba%'
        AND LOWER(name) NOT LIKE '%prof. administrator%'
    `;
    const facultyParams = [];

    if (search && search.trim()) {
      facultyQuery += ` AND (LOWER(name) LIKE ? OR LOWER(register_id) LIKE ?)`;
      const term = `%${search.trim().toLowerCase()}%`;
      facultyParams.push(term, term);
    }
    facultyQuery += ' ORDER BY name ASC';

    const facultyMembers = db.prepare(facultyQuery).all(...facultyParams);

    // Fetch active leaves for filterDate if provided
    let leavesOnDate = [];
    if (filterDate) {
      leavesOnDate = db.prepare(`
        SELECT faculty_id, faculty_name, leave_date, reason, status
        FROM faculty_leaves
        WHERE leave_date = ?
      `).all(filterDate);
    }
    const leaveMap = new Map();
    for (const lv of leavesOnDate) {
      leaveMap.set(lv.faculty_id, lv);
    }

    // Fetch all teaching assignments from timetables across all years & sections
    const teachingSlots = db.prepare(`
      SELECT t.day, t.period, t.subject, t.faculty_name, t.room, t.year, s.name as section_name
      FROM timetables t
      LEFT JOIN sections s ON t.section_id = s.id
    `).all();

    // Fetch all manual overrides
    const overrides = db.prepare(`
      SELECT o.id, o.faculty_id, o.day, o.period, o.status, o.note, o.override_date
      FROM faculty_overrides o
    `).all();

    // Build map of overrides: key = `${faculty_id}_${day}_${period}`
    const overrideMap = new Map();
    for (const ov of overrides) {
      overrideMap.set(`${ov.faculty_id}_${ov.day}_${ov.period}`, ov);
    }

    // Build map of teaching slots by faculty name: key = `${normalized_name}_${day}_${period}`
    const teachingMap = new Map();
    for (const ts of teachingSlots) {
      if (ts.faculty_name && ts.faculty_name !== '—') {
        const key = `${ts.faculty_name.trim().toLowerCase()}_${ts.day}_${ts.period}`;
        if (!teachingMap.has(key)) {
          teachingMap.set(key, []);
        }
        teachingMap.get(key).push(ts);
      }
    }

    const daysToInclude = filterDay && VALID_DAYS.includes(filterDay) ? [filterDay] : VALID_DAYS;

    const results = facultyMembers.map(faculty => {
      const schedule = {};
      let totalFreePeriods = 0;
      let totalTeachingPeriods = 0;
      let totalOverrides = 0;

      const facultyLeave = leaveMap.get(faculty.id);
      const leaveStatus = facultyLeave ? (facultyLeave.status || 'leave') : 'active';
      const isOnLeave = Boolean(facultyLeave && leaveStatus === 'leave');
      const isBusy = Boolean(facultyLeave && leaveStatus === 'busy');

      for (const d of daysToInclude) {
        schedule[d] = {};
        for (let p = 1; p <= 7; p++) {
          const teachKey = `${faculty.name.trim().toLowerCase()}_${d}_${p}`;
          const taughtClasses = teachingMap.get(teachKey);

          if (taughtClasses && taughtClasses.length > 0) {
            totalTeachingPeriods++;
            schedule[d][p] = {
              status: isOnLeave ? 'on_leave' : 'teaching',
              label: isOnLeave ? 'Faculty on Leave (Class Affected)' : 'Teaching Class',
              is_on_leave: isOnLeave,
              period: p,
              classes: taughtClasses.map(c => {
                const range = getSlotTimeRange(c.year, c.period);
                return {
                  subject: c.subject,
                  year: c.year,
                  section: c.section_name,
                  room: c.room,
                  period: c.period,
                  time_label: range ? range.label : '',
                  start: range ? range.start : null,
                  end: range ? range.end : null,
                  is_on_leave: isOnLeave
                };
              }),
              note: isOnLeave 
                ? `ON LEAVE: ${taughtClasses.map(c => c.subject).join(', ')}`
                : taughtClasses.map(c => {
                    const range = getSlotTimeRange(c.year, c.period);
                    return `${c.subject} (Yr ${c.year} ${c.section_name}${range ? ' · ' + range.label : ''})`;
                  }).join(', ')
            };
          } else {
            // Not assigned to teach -> Check for manual override or Leave/Busy state
            const ovKey = `${faculty.id}_${d}_${p}`;
            const ov = overrideMap.get(ovKey);

            if (isOnLeave) {
              schedule[d][p] = {
                status: 'on_leave',
                period: p,
                is_on_leave: true,
                time_label: p === 7 ? '03:30 - 05:00 PM (Faculty Availability)' : (SENIOR_YEAR_SLOTS[p]?.label || ''),
                label: 'On Leave',
                note: 'Faculty on Leave'
              };
            } else if (isBusy) {
              totalOverrides++;
              schedule[d][p] = {
                status: 'busy',
                period: p,
                is_busy: true,
                time_label: p === 7 ? '03:30 - 05:00 PM (Faculty Availability)' : (SENIOR_YEAR_SLOTS[p]?.label || ''),
                label: 'Busy',
                note: 'Temporarily Unavailable'
              };
            } else if (ov && ov.status !== 'free') {
              totalOverrides++;
              const isOvLeave = ov.status === 'leave' || ov.status === 'unavailable';
              const isOvBusy = ov.status === 'busy' || ov.status === 'office_hours' || ov.status === 'meeting' || ov.status === 'mentoring';
              schedule[d][p] = {
                status: isOvLeave ? 'leave' : 'busy',
                period: p,
                is_on_leave: isOvLeave,
                is_busy: isOvBusy,
                time_label: p === 7 ? '03:30 - 05:00 PM (Faculty Availability)' : (SENIOR_YEAR_SLOTS[p]?.label || ''),
                label: isOvLeave ? 'On Leave' : 'Busy',
                override_id: ov.id
              };
            } else {
              totalFreePeriods++;
              schedule[d][p] = {
                status: 'free',
                period: p,
                label: 'Available (Free Period)',
                time_label: p === 7 ? '03:30 - 05:00 PM (Faculty Availability)' : (SENIOR_YEAR_SLOTS[p]?.label || ''),
                note: (p === 7 ? 'Available until 5:00 PM' : 'Available for consultation')
              };
            }
          }
        }
      }

      return {
        id: faculty.id,
        register_id: faculty.register_id,
        name: faculty.name,
        department: faculty.department,
        designation: faculty.designation,
        qualification: faculty.qualification,
        status: faculty.status || 'active',
        faculty_status: isOnLeave ? 'leave' : isBusy ? 'busy' : 'active',
        is_on_leave: isOnLeave,
        is_busy: isBusy,
        leave_detail: facultyLeave ? {
          date: facultyLeave.leave_date,
          status: facultyLeave.status
        } : null,
        total_free: (isOnLeave || isBusy) ? 0 : totalFreePeriods,
        total_teaching: totalTeachingPeriods,
        total_overrides: totalOverrides,
        schedule
      };
    });

    res.json({
      days: daysToInclude,
      date: filterDate || null,
      faculty_availability: results
    });
  } catch (error) {
    console.error('Error computing faculty availability:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET personal teaching schedule and overrides for the logged-in faculty member
router.get('/my-schedule', authenticateToken, (req, res) => {
  try {
    const facultyUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!facultyUser) {
      return res.status(404).json({ error: 'Faculty record not found' });
    }

    // Find all classes taught by this faculty member across all years and sections
    const classes = db.prepare(`
      SELECT t.id, t.year, t.day, t.period, t.subject, t.room, s.name as section_name
      FROM timetables t
      JOIN sections s ON t.section_id = s.id
      WHERE LOWER(t.faculty_name) = LOWER(?)
      ORDER BY 
        CASE t.day 
          WHEN 'Monday' THEN 1 
          WHEN 'Tuesday' THEN 2 
          WHEN 'Wednesday' THEN 3 
          WHEN 'Thursday' THEN 4 
          WHEN 'Friday' THEN 5 
          WHEN 'Saturday' THEN 6 
          ELSE 7 
        END,
        t.period ASC
    `).all(facultyUser.name);

    // Fetch this faculty's current overrides
    const overrides = db.prepare(`
      SELECT id, day, period, status, note, created_at
      FROM faculty_overrides
      WHERE faculty_id = ?
    `).all(facultyUser.id);

    // Build weekly consolidated schedule
    const weeklySchedule = {};
    for (const d of VALID_DAYS) {
      weeklySchedule[d] = {};
      for (let p = 1; p <= 7; p++) {
        weeklySchedule[d][p] = { 
          status: 'free', 
          period: p,
          time_label: p === 7 ? '03:30 - 05:00 PM (Faculty Availability)' : (SENIOR_YEAR_SLOTS[p]?.label || ''),
          detail: null, 
          override: null 
        };
      }
    }

    const classesWithTime = classes.map(c => {
      const slotRange = getSlotTimeRange(c.year, c.period);
      return {
        ...c,
        time_label: slotRange ? slotRange.label : ''
      };
    });

    for (const c of classesWithTime) {
      weeklySchedule[c.day][c.period] = {
        status: 'teaching',
        period: c.period,
        time_label: c.time_label,
        detail: {
          subject: c.subject,
          year: c.year,
          section: c.section_name,
          room: c.room,
          time_label: c.time_label
        },
        override: null
      };
    }

    for (const o of overrides) {
      if (weeklySchedule[o.day] && weeklySchedule[o.day][o.period]) {
        if (weeklySchedule[o.day][o.period].status !== 'teaching') {
          const ovStatus = (o.status === 'leave' || o.status === 'unavailable') ? 'leave' : 'busy';
          weeklySchedule[o.day][o.period].status = ovStatus;
          weeklySchedule[o.day][o.period].override = o;
        }
      }
    }

    res.json({
      faculty: {
        id: facultyUser.id,
        register_id: facultyUser.register_id,
        name: facultyUser.name,
        department: facultyUser.department,
        designation: facultyUser.designation
      },
      teaching_classes: classesWithTime,
      overrides,
      weekly_schedule: weeklySchedule
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST faculty override (Faculty sets their own availability for a slot)
router.post('/overrides', authenticateToken, (req, res) => {
  try {
    const { day, period, status, date } = req.body;
    const p = parseInt(period, 10);

    if (!VALID_DAYS.includes(day) || p < 1 || p > 7) {
      return res.status(400).json({ error: 'Valid day (Monday-Saturday) and period (1-7) are required.' });
    }

    const normStatus = (status || '').toLowerCase().trim();
    if (!['busy', 'leave'].includes(normStatus)) {
      return res.status(400).json({ error: 'Status must be either Busy or Leave.' });
    }

    // Faculty or Admin can set
    const facultyId = req.user.id;

    // Check if slot is already a teaching period
    const userObj = db.prepare('SELECT id, name FROM users WHERE id = ?').get(facultyId);
    if (!userObj) {
      return res.status(404).json({ error: 'Faculty record not found.' });
    }

    const assignedClass = db.prepare(`
      SELECT subject, year FROM timetables
      WHERE day = ? AND period = ? AND LOWER(faculty_name) = LOWER(?)
    `).get(day, p, userObj.name);

    if (assignedClass) {
      return res.status(400).json({
        error: `Cannot override this slot because you are scheduled to teach "${assignedClass.subject}" (Year ${assignedClass.year}).`
      });
    }

    // Upsert override without note
    const stmt = db.prepare(`
      INSERT INTO faculty_overrides (faculty_id, day, period, status, note, override_date)
      VALUES (?, ?, ?, ?, '', ?)
      ON CONFLICT(faculty_id, day, period) DO UPDATE SET
        status = excluded.status,
        note = '',
        override_date = excluded.override_date
    `);

    stmt.run(facultyId, day, p, normStatus, date || null);

    let notification = null;
    if (normStatus === 'leave') {
      const effectiveDate = date || new Date().toISOString().split('T')[0];
      const formattedDate = formatDateHuman(effectiveDate);
      const slotTime = PERIOD_LABELS[p] || `Period ${p}`;
      const notificationMessage = `${userObj.name} has marked Leave for ${formattedDate}, P${p} (${slotTime}).`;

      // Remove any existing notification for same slot
      db.prepare('DELETE FROM global_notifications WHERE faculty_id = ? AND leave_date = ? AND message LIKE ?')
        .run(facultyId, effectiveDate, `%P${p}%`);

      const notifStmt = db.prepare(`
        INSERT INTO global_notifications (type, faculty_id, faculty_name, leave_date, message)
        VALUES ('faculty_leave', ?, ?, ?, ?)
      `);
      const notifInfo = notifStmt.run(facultyId, userObj.name, effectiveDate, notificationMessage);
      notification = db.prepare('SELECT * FROM global_notifications WHERE id = ?').get(notifInfo.lastInsertRowid);
    }

    res.json({ 
      message: `Slot availability set to ${normStatus === 'busy' ? 'Busy' : 'Leave'} for ${day} Period ${p}.`,
      status: normStatus,
      notification
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE faculty override (revert back to computed availability and notify)
router.delete('/overrides/:day/:period', authenticateToken, (req, res) => {
  try {
    const { day, period } = req.params;
    const { date: reqDate } = req.query;
    const p = parseInt(period, 10);
    const facultyId = req.user.id;

    const facultyUser = db.prepare('SELECT name FROM users WHERE id = ?').get(facultyId);
    if (!facultyUser) {
      return res.status(404).json({ error: 'Faculty record not found.' });
    }

    const existingOv = db.prepare(`
      SELECT * FROM faculty_overrides
      WHERE faculty_id = ? AND day = ? AND period = ?
    `).get(facultyId, day, p);

    db.prepare(`
      DELETE FROM faculty_overrides
      WHERE faculty_id = ? AND day = ? AND period = ?
    `).run(facultyId, day, p);

    const effectiveDate = reqDate || (existingOv && existingOv.override_date) || new Date().toISOString().split('T')[0];
    const formattedDate = formatDateHuman(effectiveDate);
    const slotTime = PERIOD_LABELS[p] || `Period ${p}`;

    const notificationMessage = `${facultyUser.name} removed their availability for ${formattedDate}, P${p} (${slotTime}).`;

    // Insert global notification visible to all users
    const notifStmt = db.prepare(`
      INSERT INTO global_notifications (type, faculty_id, faculty_name, leave_date, message)
      VALUES ('availability_removed', ?, ?, ?, ?)
    `);
    const notifInfo = notifStmt.run(facultyId, facultyUser.name, effectiveDate, notificationMessage);
    const notification = db.prepare('SELECT * FROM global_notifications WHERE id = ?').get(notifInfo.lastInsertRowid);

    res.json({ 
      message: 'Availability removed successfully.',
      notification
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/faculty/leaves
// Accessible to all authenticated users (Students, Faculty, Admin)
router.get('/leaves', authenticateToken, (req, res) => {
  try {
    const { date, faculty_id } = req.query;
    let query = `
      SELECT fl.id, fl.faculty_id, fl.faculty_name, fl.leave_date, fl.leave_date AS date, 
             fl.status, fl.reason, fl.created_at,
             u.register_id, u.register_id AS faculty_register_id, u.designation, u.qualification
      FROM faculty_leaves fl
      LEFT JOIN users u ON fl.faculty_id = u.id
      WHERE 1=1
        AND (u.register_id != 'FAC001' OR u.register_id IS NULL)
        AND LOWER(fl.faculty_name) NOT LIKE '%kishor kumar%'
        AND (LOWER(fl.faculty_name) NOT LIKE '%kishor%' OR LOWER(fl.faculty_name) LIKE '%bala kishore%')
    `;
    const params = [];
    if (date) {
      query += ' AND fl.leave_date = ?';
      params.push(date);
    }
    if (faculty_id) {
      query += ' AND fl.faculty_id = ?';
      params.push(parseInt(faculty_id, 10));
    }
    query += ' ORDER BY fl.leave_date DESC, fl.id DESC';

    const leaves = db.prepare(query).all(...params);
    res.json({ count: leaves.length, leaves });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/faculty/leaves
// Faculty marks leave for themselves (or Admin for a faculty member)
router.post('/leaves', authenticateToken, (req, res) => {
  try {
    const { date, status, reason, faculty_id } = req.body;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Valid date in YYYY-MM-DD format is required.' });
    }

    const normStatus = (status || 'leave').toLowerCase().trim();
    if (!['leave', 'busy', 'active'].includes(normStatus)) {
      return res.status(400).json({ error: 'Invalid status. Must be Leave, Busy, or Active.' });
    }

    let targetFacultyId;
    if (req.user.role === 'admin' && faculty_id) {
      targetFacultyId = parseInt(faculty_id, 10);
    } else if (req.user.role === 'faculty') {
      targetFacultyId = req.user.id;
    } else if (req.user.role === 'admin') {
      targetFacultyId = req.user.id;
    } else {
      return res.status(403).json({ error: 'Only faculty members and administrators can manage status.' });
    }

    const facultyUser = db.prepare('SELECT id, name, register_id, role FROM users WHERE id = ?').get(targetFacultyId);
    if (!facultyUser) {
      return res.status(404).json({ error: 'Faculty member not found.' });
    }

    // Format date nicely for human readable messages: e.g. "7 September 2026"
    const [yearStr, monthStr, dayStr] = date.split('-');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const formattedDate = `${parseInt(dayStr, 10)} ${monthNames[parseInt(monthStr, 10) - 1]} ${yearStr}`;

    // CASE 1: ACTIVE (normal availability - clear any leave/busy record)
    if (normStatus === 'active') {
      db.prepare('DELETE FROM faculty_leaves WHERE faculty_id = ? AND leave_date = ?').run(facultyUser.id, date);
      db.prepare('DELETE FROM global_notifications WHERE faculty_id = ? AND leave_date = ?').run(facultyUser.id, date);

      broadcastTimetableUpdate({ action: 'leave_update', message: `Status updated to Active for ${facultyUser.name}` });

      return res.json({
        message: `Status updated to Active for ${facultyUser.name} on ${formattedDate}.`,
        status: 'active'
      });
    }

    // CASE 2: BUSY (temporarily unavailable - persists, but strictly does NOT trigger global leave notifications)
    if (normStatus === 'busy') {
      const insertBusyStmt = db.prepare(`
        INSERT INTO faculty_leaves (faculty_id, faculty_name, leave_date, status, reason)
        VALUES (?, ?, ?, 'busy', '')
        ON CONFLICT(faculty_id, leave_date) DO UPDATE SET
          status = 'busy',
          reason = ''
      `);
      insertBusyStmt.run(facultyUser.id, facultyUser.name, date);
      const leaveRecord = db.prepare('SELECT * FROM faculty_leaves WHERE faculty_id = ? AND leave_date = ?').get(facultyUser.id, date);
      if (leaveRecord) {
        leaveRecord.date = leaveRecord.leave_date;
        leaveRecord.faculty_register_id = facultyUser.register_id;
      }
      // Remove any previous leave notifications for this date if there were any
      db.prepare('DELETE FROM global_notifications WHERE faculty_id = ? AND leave_date = ?').run(facultyUser.id, date);

      broadcastTimetableUpdate({ action: 'leave_update', message: `Status marked as Busy for ${facultyUser.name}` });

      return res.status(201).json({
        message: `Status marked as Busy for ${facultyUser.name} on ${formattedDate}.`,
        leave: leaveRecord,
        status: 'busy'
      });
    }

    // CASE 3: LEAVE (marks faculty on leave and broadcasts global notification)
    const insertLeaveStmt = db.prepare(`
      INSERT INTO faculty_leaves (faculty_id, faculty_name, leave_date, status, reason)
      VALUES (?, ?, ?, 'leave', '')
      ON CONFLICT(faculty_id, leave_date) DO UPDATE SET
        status = 'leave',
        reason = ''
    `);
    insertLeaveStmt.run(facultyUser.id, facultyUser.name, date);
    const leaveRecord = db.prepare('SELECT * FROM faculty_leaves WHERE faculty_id = ? AND leave_date = ?').get(facultyUser.id, date);
    if (leaveRecord) {
      leaveRecord.date = leaveRecord.leave_date;
      leaveRecord.faculty_register_id = facultyUser.register_id;
    }

    const notificationMessage = `${facultyUser.name} has marked Leave for ${formattedDate}.`;

    // Clear previous notification for this faculty and date to prevent duplicates
    db.prepare('DELETE FROM global_notifications WHERE faculty_id = ? AND leave_date = ?').run(facultyUser.id, date);

    // Insert global notification visible to all users
    const notifStmt = db.prepare(`
      INSERT INTO global_notifications (type, faculty_id, faculty_name, leave_date, message)
      VALUES ('faculty_leave', ?, ?, ?, ?)
    `);
    const notifInfo = notifStmt.run(facultyUser.id, facultyUser.name, date, notificationMessage);
    const notification = db.prepare('SELECT * FROM global_notifications WHERE id = ?').get(notifInfo.lastInsertRowid);

    broadcastTimetableUpdate({ action: 'leave_update', message: `${facultyUser.name} marked Leave for ${formattedDate}` });

    return res.status(201).json({
      message: `Leave successfully marked for ${facultyUser.name} on ${formattedDate}.`,
      leave: leaveRecord,
      notification,
      status: 'leave'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/faculty/leaves/:id
// Cancel / delete leave record
router.delete('/leaves/:id', authenticateToken, (req, res) => {
  try {
    const leaveId = parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM faculty_leaves WHERE id = ?').get(leaveId);
    if (!existing) {
      return res.status(404).json({ error: 'Leave record not found.' });
    }

    // Only the faculty themselves or admin can delete
    if (req.user.role !== 'admin' && req.user.id !== existing.faculty_id) {
      return res.status(403).json({ error: 'Unauthorized to cancel this leave.' });
    }

    db.prepare('DELETE FROM faculty_leaves WHERE id = ?').run(leaveId);
    // Also remove notifications matching this leave
    db.prepare('DELETE FROM global_notifications WHERE faculty_id = ? AND leave_date = ?').run(existing.faculty_id, existing.leave_date);

    broadcastTimetableUpdate({ action: 'leave_update', message: `Leave cancelled for ${existing.faculty_name}` });

    res.json({ message: 'Leave cancelled successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
