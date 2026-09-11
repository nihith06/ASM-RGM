// Helper utilities for calculating exact timetable period times and detecting actual time conflicts

export const YEAR_1_SLOTS = {
  1: { start: 9 * 60, end: 9 * 60 + 50, label: '09:00 - 09:50 AM' },
  2: { start: 9 * 60 + 50, end: 10 * 60 + 40, label: '09:50 - 10:40 AM' },
  3: { start: 11 * 60, end: 11 * 60 + 50, label: '11:00 - 11:50 AM' },
  4: { start: 13 * 60, end: 13 * 60 + 50, label: '01:00 - 01:50 PM' },
  5: { start: 13 * 60 + 50, end: 14 * 60 + 40, label: '01:50 - 02:40 PM' },
  6: { start: 15 * 60, end: 15 * 60 + 50, label: '03:00 - 03:50 PM' },
  7: { start: 16 * 60, end: 16 * 60 + 50, label: '04:00 - 04:50 PM' }
};

export const SENIOR_YEAR_SLOTS = {
  1: { start: 9 * 60, end: 9 * 60 + 50, label: '09:00 - 09:50 AM' },
  2: { start: 9 * 60 + 50, end: 10 * 60 + 40, label: '09:50 - 10:40 AM' },
  3: { start: 11 * 60, end: 11 * 60 + 50, label: '11:00 - 11:50 AM' },
  4: { start: 11 * 60 + 50, end: 12 * 60 + 40, label: '11:50 - 12:40 PM' },
  5: { start: 13 * 60 + 50, end: 14 * 60 + 40, label: '01:50 - 02:40 PM' },
  6: { start: 14 * 60 + 40, end: 15 * 60 + 30, label: '02:40 - 03:30 PM' },
  7: { start: 15 * 60 + 30, end: 16 * 60 + 20, label: '03:30 - 04:20 PM' }
};

export const PERIOD_LABELS = {
  1: '09:00 AM–09:50 AM',
  2: '09:50 AM–10:40 AM',
  3: '11:00 AM–11:50 AM',
  4: '11:50 AM–12:40 PM',
  5: '01:50 PM–02:40 PM',
  6: '02:40 PM–03:30 PM',
  7: '03:30 PM–05:00 PM'
};

export function formatDateHuman(dateStr) {
  if (!dateStr || !dateStr.includes('-')) {
    dateStr = new Date().toISOString().split('T')[0];
  }
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return `${parseInt(dayStr, 10)} ${monthNames[parseInt(monthStr, 10) - 1]} ${yearStr}`;
}

export function getSlotTimeRange(year, period) {
  const p = parseInt(period, 10);
  const yr = parseInt(year, 10);
  if (yr === 1) {
    return YEAR_1_SLOTS[p] || null;
  }
  return SENIOR_YEAR_SLOTS[p] || null;
}

// Checks whether two time ranges overlap in minutes
export function timesOverlap(rangeA, rangeB) {
  if (!rangeA || !rangeB) return false;
  return rangeA.start < rangeB.end && rangeB.start < rangeA.end;
}

// Checks if assigning a faculty member to a specific year and period creates an actual clock-time overlap
export function checkFacultyConflict(db, faculty_name, day, year, period, excludeCell = null) {
  if (!faculty_name || faculty_name.trim() === '—' || !faculty_name.trim()) {
    return { conflict: false };
  }

  const yr = parseInt(year, 10);
  const p = parseInt(period, 10);
  const proposedRange = getSlotTimeRange(yr, p);
  if (!proposedRange) {
    return { conflict: false };
  }

  const cleanFaculty = faculty_name.trim().toLowerCase();

  // Find all classes taught by this faculty on this day across all years & sections
  const existingClasses = db.prepare(`
    SELECT t.id, t.year, t.section_id, t.day, t.period, t.subject, t.faculty_name, s.name as section_name
    FROM timetables t
    LEFT JOIN sections s ON t.section_id = s.id
    WHERE LOWER(TRIM(t.faculty_name)) = ?
      AND t.day = ?
      AND t.subject != '—'
  `).all(cleanFaculty, day);

  for (const item of existingClasses) {
    // Exclude the cell currently being edited if specified
    if (excludeCell) {
      if (excludeCell.id && item.id === excludeCell.id) continue;
      if (
        excludeCell.year === item.year &&
        excludeCell.section_id === item.section_id &&
        excludeCell.day === item.day &&
        excludeCell.period === item.period
      ) {
        continue;
      }
    }

    const existingRange = getSlotTimeRange(item.year, item.period);
    if (existingRange && timesOverlap(proposedRange, existingRange)) {
      return {
        conflict: true,
        faculty_name,
        day,
        proposedSlot: { year: yr, period: p, timeRange: proposedRange },
        conflictingClass: {
          year: item.year,
          section: item.section_name,
          period: item.period,
          subject: item.subject,
          timeRange: existingRange
        },
        message: `Schedule Conflict: ${faculty_name} is already teaching "${item.subject}" (Year ${item.year}, ${item.section_name || 'Section'}) at ${existingRange.label}, which overlaps with the requested slot ${proposedRange.label}.`
      };
    }
  }

  return { conflict: false };
}
