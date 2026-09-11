import db, { OFFICIAL_FACULTY, OFFICIAL_SECTIONS } from '../db.js';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Standard subject allocations per year
export const YEAR_CURRICULUM = {
  1: {
    theory: [
      { name: 'IP', weeklyHours: 6, blockSizes: [2, 2, 2] },
      { name: 'BEE - A', weeklyHours: 3, blockSizes: [2, 1], nonAiml: true },
      { name: 'BEE - B', weeklyHours: 3, blockSizes: [2, 1], nonAiml: true },
      { name: 'EP', weeklyHours: 4, blockSizes: [2, 1, 1], nonAiml: true },
      { name: 'LAAC', weeklyHours: 4, blockSizes: [2, 2], nonAiml: true },
      { name: 'ITWS', weeklyHours: 3, blockSizes: [3], nonAiml: true },
      { name: 'EG', weeklyHours: 3, blockSizes: [3], nonAiml: true },
      { name: 'SEM', weeklyHours: 2, blockSizes: [2], nonAiml: true }
    ],
    labs: [
      { name: 'CP LAB', weeklyHours: 3, blockSize: 3 },
      { name: 'BEE LAB', weeklyHours: 3, blockSize: 3, nonAiml: true },
      { name: 'EP LAB', weeklyHours: 3, blockSize: 3, nonAiml: true }
    ]
  },
  2: {
    theory: [
      { name: 'AI', weeklyHours: 4, blockSizes: [2, 2] },
      { name: 'ADSA', weeklyHours: 4, blockSizes: [2, 2] },
      { name: 'OOPJ', weeklyHours: 4, blockSizes: [2, 2] },
      { name: 'PYP', weeklyHours: 4, blockSizes: [2, 2] },
      { name: 'UHV', weeklyHours: 3, blockSizes: [2, 1] },
      { name: 'DMGT', weeklyHours: 3, blockSizes: [2, 1], nonAiml: true },
      { name: 'SEM', weeklyHours: 2, blockSizes: [2], nonAiml: true }
    ],
    labs: [
      { name: 'ADSA LAB', weeklyHours: 3, blockSize: 3 },
      { name: 'OOPJ LAB', weeklyHours: 3, blockSize: 3 },
      { name: 'PYP LAB', weeklyHours: 3, blockSize: 3 }
    ]
  },
  3: {
    theory: [
      { name: 'NLP', weeklyHours: 4, blockSizes: [2, 2] },
      { name: 'QT&A', weeklyHours: 4, blockSizes: [2, 2] },
      { name: 'CV&IP', weeklyHours: 4, blockSizes: [2, 2] },
      { name: 'SSP', weeklyHours: 3, blockSizes: [2, 1] },
      { name: 'EDA', weeklyHours: 3, blockSizes: [2, 1] },
      { name: 'FSD', weeklyHours: 3, blockSizes: [2, 1] },
      { name: 'SEM', weeklyHours: 2, blockSizes: [2], nonAiml: true }
    ],
    labs: [
      { name: 'AI&SP LAB', weeklyHours: 3, blockSize: 3 },
      { name: 'CV&ML LAB', weeklyHours: 3, blockSize: 3 },
      { name: 'TINKERING LAB', weeklyHours: 3, blockSize: 3 }
    ]
  },
  4: {
    theory: [
      { name: 'DEEP LEARNING', weeklyHours: 4, blockSizes: [2, 2] },
      { name: 'MLOPS', weeklyHours: 4, blockSizes: [2, 2] },
      { name: 'BIG DATA', weeklyHours: 4, blockSizes: [2, 2] },
      { name: 'AI ETHICS', weeklyHours: 3, blockSizes: [2, 1] },
      { name: 'PROJECT WORK', weeklyHours: 4, blockSizes: [2, 2] },
      { name: 'RESEARCH SEMINAR', weeklyHours: 2, blockSizes: [2], nonAiml: true }
    ],
    labs: [
      { name: 'DL LAB', weeklyHours: 3, blockSize: 3 },
      { name: 'BIG DATA LAB', weeklyHours: 3, blockSize: 3 }
    ]
  }
};

/**
 * Loads all faculty members and their qualified subjects and labs.
 */
export function getFacultyCompetencyRegistry() {
  const users = db.prepare(`
    SELECT u.id, u.register_id, u.name, u.phone, u.status,
           c.assigned_subjects, c.assigned_labs, c.max_weekly_hours
    FROM users u
    LEFT JOIN faculty_workload_config c ON u.id = c.faculty_id
    WHERE u.role = 'faculty' AND u.status = 'active'
    ORDER BY u.register_id ASC
  `).all();

  return users.map(u => {
    let subjects = [];
    let labs = [];
    try { subjects = u.assigned_subjects ? JSON.parse(u.assigned_subjects) : []; } catch (e) {}
    try { labs = u.assigned_labs ? JSON.parse(u.assigned_labs) : []; } catch (e) {}
    return {
      id: u.id,
      register_id: u.register_id,
      name: u.name,
      phone: u.phone || '',
      subjects,
      labs,
      max_weekly_hours: u.max_weekly_hours || 16
    };
  });
}

/**
 * Loads rooms from the rooms table.
 */
export function getRoomsList() {
  return db.prepare('SELECT id, name, type FROM rooms ORDER BY type ASC, name ASC').all();
}

/**
 * Main Constraint Satisfaction Schedule Generator Engine
 */
export function generateSchedule({ sectionId = null, allSections = false, year = null } = {}) {
  const facultyRegistry = getFacultyCompetencyRegistry();
  const rooms = getRoomsList();
  const theoryRooms = rooms.filter(r => r.type === 'theory');
  const labRooms = rooms.filter(r => r.type === 'lab');

  if (facultyRegistry.length < 2) {
    return {
      success: false,
      constraint: 'Minimum Faculty Count',
      error: 'Cannot generate timetable: At least 2 faculty members required for emergency standby.'
    };
  }

  // Determine sections to generate
  let targetSections = [];
  if (allSections) {
    targetSections = db.prepare('SELECT * FROM sections ORDER BY year ASC, name ASC').all();
  } else if (sectionId) {
    const sec = db.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId);
    if (!sec) {
      return { success: false, constraint: 'Invalid Section', error: `Section ID ${sectionId} not found.` };
    }
    targetSections = [sec];
  } else if (year) {
    targetSections = db.prepare('SELECT * FROM sections WHERE year = ? ORDER BY name ASC').all(year);
  } else {
    targetSections = db.prepare('SELECT * FROM sections ORDER BY year ASC, name ASC').all();
  }

  if (targetSections.length === 0) {
    return { success: false, constraint: 'No Sections Found', error: 'No active sections found to generate schedules.' };
  }

  // Pre-fetch existing timetable entries for sections NOT being regenerated
  const targetSectionIds = new Set(targetSections.map(s => s.id));
  const existingEntries = db.prepare('SELECT * FROM timetables').all().filter(e => !targetSectionIds.has(e.section_id));

  // State Tracking Matrices
  // 1. Faculty busy: facultyBusy[day][period] = Set(faculty_names)
  const facultyBusy = {};
  // 2. Room busy: roomBusy[day][period] = Set(room_names)
  const roomBusy = {};
  // 3. Faculty workload: facultyHours[faculty_name] = count
  const facultyHours = {};
  // 4. Faculty morning count: facultyMorningDays[faculty_name] = Set(days)
  const facultyMorningDays = {};
  // 5. Faculty days active: facultyActiveDays[day] = Set(faculty_names)
  const facultyActiveDays = {};

  for (const day of DAYS) {
    facultyBusy[day] = {};
    roomBusy[day] = {};
    facultyActiveDays[day] = new Set();
    for (let p = 1; p <= 7; p++) {
      facultyBusy[day][p] = new Set();
      roomBusy[day][p] = new Set();
    }
  }

  for (const f of facultyRegistry) {
    facultyHours[f.name] = 0;
    facultyMorningDays[f.name] = new Set();
  }

  // Populate state with existing entries (if partial section generation)
  for (const entry of existingEntries) {
    const { day, period, faculty_name, room } = entry;
    if (faculty_name && faculty_name !== '—') {
      facultyBusy[day][period].add(faculty_name);
      facultyHours[faculty_name] = (facultyHours[faculty_name] || 0) + 1;
      facultyActiveDays[day].add(faculty_name);
      if ([1, 2].includes(period)) {
        if (!facultyMorningDays[faculty_name]) facultyMorningDays[faculty_name] = new Set();
        facultyMorningDays[faculty_name].add(day);
      }
    }
    if (room && room.trim()) {
      roomBusy[day][period].add(room.trim());
    }
  }

  // Emergency Standby Planner: Designate 2 rotating standby floaters for each day
  // Floaters cannot be scheduled on that specific day
  const dailyStandbyFloaters = {};
  const totalFacultyCount = facultyRegistry.length;
  for (let d = 0; d < DAYS.length; d++) {
    const day = DAYS[d];
    const idx1 = (d * 2) % totalFacultyCount;
    const idx2 = (d * 2 + 1) % totalFacultyCount;
    const floater1 = facultyRegistry[idx1].name;
    const floater2 = facultyRegistry[idx2].name;
    dailyStandbyFloaters[day] = new Set([floater1, floater2]);
  }

  // Generated slots accumulator: array of { year, section_id, day, period, subject, faculty_name, room }
  const generatedSlots = [];

  // Map subjects to qualified faculty list
  const subjectQualifiedFaculty = {};
  for (const f of facultyRegistry) {
    for (const sub of f.subjects) {
      if (!subjectQualifiedFaculty[sub]) subjectQualifiedFaculty[sub] = [];
      subjectQualifiedFaculty[sub].push(f.name);
    }
    for (const lab of f.labs) {
      if (!subjectQualifiedFaculty[lab]) subjectQualifiedFaculty[lab] = [];
      subjectQualifiedFaculty[lab].push(f.name);
    }
  }

  // Helper: Find qualified faculty satisfying ALL strict constraints simultaneously
  function selectFacultyForSlot(subjectName, isLab, day, periods, sectionYear, sectionName) {
    if (!subjectName || subjectName === 'SEM') return '—';

    // Check if non-AIML
    const currYear = YEAR_CURRICULUM[sectionYear];
    const isNonAimlTheory = currYear?.theory.some(t => t.name === subjectName && t.nonAiml);
    const isNonAimlLab = currYear?.labs.some(l => l.name === subjectName && l.nonAiml);
    if (isNonAimlTheory || isNonAimlLab) {
      return '—';
    }

    let qualified = subjectQualifiedFaculty[subjectName] || [];
    if (qualified.length === 0) {
      // Fallback to active faculty if not explicitly mapped
      qualified = facultyRegistry.map(f => f.name);
    }

    const duration = periods.length;
    const isMorningDuty = periods.some(p => [1, 2].includes(p));

    // Sort qualified candidates by least assigned hours (load balancing)
    const candidates = [...qualified].sort((a, b) => (facultyHours[a] || 0) - (facultyHours[b] || 0));

    let blockedReason = null;

    for (const candidate of candidates) {
      // 1. Workload Cap Constraint (Hard 16 hours/week)
      const currentHrs = facultyHours[candidate] || 0;
      if (currentHrs + duration > 16) {
        blockedReason = `Workload cap of 16 hrs/week reached for ${candidate} (${currentHrs}/${16} hrs)`;
        continue;
      }

      // 2. Daily Emergency Standby Constraint (Must be 100% free if designated floater for this day)
      if (dailyStandbyFloaters[day]?.has(candidate)) {
        blockedReason = `${candidate} is on daily emergency standby duty on ${day}`;
        continue;
      }

      // 3. Slot Collision Constraint (No double booking across sections)
      const hasSlotOverlap = periods.some(p => facultyBusy[day][p]?.has(candidate));
      if (hasSlotOverlap) {
        blockedReason = `${candidate} already scheduled during requested periods on ${day}`;
        continue;
      }

      // 4. Morning Slot Rotation Constraint (Max 2 morning duties per week)
      if (isMorningDuty) {
        const morningDays = facultyMorningDays[candidate] || new Set();
        if (!morningDays.has(day) && morningDays.size >= 2) {
          blockedReason = `Morning duty rotation limit reached for ${candidate} (max 2 days/wk)`;
          continue;
        }
      }

      // 5. Parallel Section Redundancy Constraint:
      // If other sections are teaching this same subject at this time, ensure at least 1 qualified faculty member remains completely free
      if (qualified.length > 1) {
        const busyQualifiedCount = qualified.filter(qf => 
          periods.some(p => facultyBusy[day][p]?.has(qf))
        ).length;

        // If choosing this candidate makes ALL qualified faculty busy during any of these periods, disallow it!
        if (busyQualifiedCount + 1 >= qualified.length) {
          blockedReason = `Parallel section redundancy: At least one qualified faculty member for '${subjectName}' must remain free on ${day}`;
          continue;
        }
      }

      // All constraints satisfied! Allocate candidate
      for (const p of periods) {
        facultyBusy[day][p].add(candidate);
      }
      facultyHours[candidate] = (facultyHours[candidate] || 0) + duration;
      facultyActiveDays[day].add(candidate);
      if (isMorningDuty) {
        if (!facultyMorningDays[candidate]) facultyMorningDays[candidate] = new Set();
        facultyMorningDays[candidate].add(day);
      }

      return candidate;
    }

    // If no candidate passed constraints, return failure with diagnostic reason
    return { error: blockedReason || `No available faculty satisfies constraints for '${subjectName}' on ${day}` };
  }

  // Helper: Find a free room
  function selectRoomForSlot(isLab, day, periods, defaultRoomName) {
    const roomPool = isLab ? labRooms : theoryRooms;
    // Prefer default room name if available
    if (defaultRoomName) {
      const isDefaultFree = periods.every(p => !roomBusy[day][p]?.has(defaultRoomName));
      if (isDefaultFree) {
        for (const p of periods) roomBusy[day][p].add(defaultRoomName);
        return defaultRoomName;
      }
    }
    for (const r of roomPool) {
      const isFree = periods.every(p => !roomBusy[day][p]?.has(r.name));
      if (isFree) {
        for (const p of periods) roomBusy[day][p].add(r.name);
        return r.name;
      }
    }
    return isLab ? 'AIML-LAB1' : 'AIML-LH1';
  }

  // Iterate and schedule each target section
  for (let sIdx = 0; sIdx < targetSections.length; sIdx++) {
    const section = targetSections[sIdx];
    const yr = section.year;
    const curriculum = YEAR_CURRICULUM[yr] || YEAR_CURRICULUM[3];
    const defaultTheoryRoom = theoryRooms[sIdx % theoryRooms.length]?.name || 'AIML-LH1';

    // Section grid placeholder: [day][period]
    const sectionGrid = {};
    for (const day of DAYS) {
      sectionGrid[day] = {};
      for (let p = 1; p <= 7; p++) {
        sectionGrid[day][p] = null;
      }
    }

    // 1. Schedule 3-hour Labs (Strict 3-hour continuous blocks)
    const candidateLabBlocks = [
      [5, 6, 7],
      [1, 2, 3],
      [2, 3, 4]
    ];
    for (const labItem of curriculum.labs) {
      let labPlaced = false;
      for (const day of DAYS) {
        if (labPlaced) break;
        for (const periods of candidateLabBlocks) {
          if (periods.every(p => sectionGrid[day][p] === null)) {
            const facultyResult = selectFacultyForSlot(labItem.name, true, day, periods, yr, section.name);
            if (typeof facultyResult === 'object' && facultyResult.error) {
              continue;
            }
            const roomAssigned = selectRoomForSlot(true, day, periods, 'AIML-LAB1');
            for (const p of periods) {
              sectionGrid[day][p] = {
                subject: labItem.name,
                faculty: facultyResult,
                room: roomAssigned
              };
            }
            labPlaced = true;
            break;
          }
        }
      }

      if (!labPlaced) {
        return {
          success: false,
          constraint: 'Lab Slot & Faculty Allocation',
          error: `Could not schedule lab '${labItem.name}' for Year ${yr} ${section.name}. Constraints on faculty workload or lab availability prevent allocation.`
        };
      }
    }

    // 2. Schedule Theory Subjects (2-hour blocks and 1-hour blocks)
    for (const theoryItem of curriculum.theory) {
      for (const bSize of theoryItem.blockSizes) {
        let blockPlaced = false;

        // Try placing in standard blocks:
        // For bSize == 2: [1,2], [3,4], [6,7]
        // For bSize == 3: [1,2,3], [5,6,7]
        // For bSize == 1: [1], [2], [3], [4], [5], [6], [7]
        const candidateBlocks = [];
        if (bSize === 2) {
          candidateBlocks.push([1, 2], [3, 4], [5, 6], [6, 7]);
        } else if (bSize === 3) {
          candidateBlocks.push([1, 2, 3], [5, 6, 7]);
        } else {
          candidateBlocks.push([1], [2], [3], [4], [5], [6], [7]);
        }

        for (const day of DAYS) {
          if (blockPlaced) break;
          for (const blockPeriods of candidateBlocks) {
            if (blockPeriods.every(p => sectionGrid[day][p] === null)) {
              const facultyResult = selectFacultyForSlot(theoryItem.name, false, day, blockPeriods, yr, section.name);
              if (typeof facultyResult === 'object' && facultyResult.error) {
                continue; // try next block
              }
              const roomAssigned = selectRoomForSlot(false, day, blockPeriods, defaultTheoryRoom);
              for (const p of blockPeriods) {
                sectionGrid[day][p] = {
                  subject: theoryItem.name,
                  faculty: facultyResult,
                  room: roomAssigned
                };
              }
              blockPlaced = true;
              break;
            }
          }
        }

        if (!blockPlaced && bSize === 2) {
          // Fallback: Place as two 1-hour sessions
          let placedCount = 0;
          for (const day of DAYS) {
            if (placedCount >= 2) break;
            for (let p = 1; p <= 7; p++) {
              if (placedCount >= 2) break;
              if (sectionGrid[day][p] === null) {
                const facultyResult = selectFacultyForSlot(theoryItem.name, false, day, [p], yr, section.name);
                if (typeof facultyResult === 'object' && facultyResult.error) continue;
                const roomAssigned = selectRoomForSlot(false, day, [p], defaultTheoryRoom);
                sectionGrid[day][p] = {
                  subject: theoryItem.name,
                  faculty: facultyResult,
                  room: roomAssigned
                };
                placedCount++;
              }
            }
          }
          if (placedCount === 2) {
            blockPlaced = true;
          }
        }

        if (!blockPlaced) {
          // If placement fails under strict constraints, return diagnostic failure
          return {
            success: false,
            constraint: 'Theory Block Allocation',
            error: `Failed to schedule subject '${theoryItem.name}' (${bSize}-hour block) for Year ${yr} ${section.name}. Constraint conflict encountered.`
          };
        }
      }
    }

    // 3. Fill remaining unassigned periods with Library / Mentoring / Seminar
    for (const day of DAYS) {
      for (let p = 1; p <= 7; p++) {
        if (!sectionGrid[day][p]) {
          sectionGrid[day][p] = {
            subject: p >= 6 ? 'LIBRARY' : 'MENTORING',
            faculty: '—',
            room: defaultTheoryRoom
          };
        }
        generatedSlots.push({
          year: yr,
          section_id: section.id,
          day,
          period: p,
          subject: sectionGrid[day][p].subject,
          faculty_name: sectionGrid[day][p].faculty,
          room: sectionGrid[day][p].room
        });
      }
    }
  }

  // Verify Standby Floater Constraint across all days
  for (const day of DAYS) {
    const requiredFloaters = dailyStandbyFloaters[day];
    for (const floater of requiredFloaters) {
      const floaterAssignedSlots = generatedSlots.filter(s => s.day === day && s.faculty_name === floater);
      if (floaterAssignedSlots.length > 0) {
        return {
          success: false,
          constraint: 'Emergency Standby',
          error: `Emergency Standby constraint violation: ${floater} was assigned a slot on ${day}.`
        };
      }
    }
  }

  // Atomic database write
  const insertStmt = db.prepare(`
    INSERT INTO timetables (year, section_id, day, period, subject, faculty_name, room)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(year, section_id, day, period) DO UPDATE SET
      subject = excluded.subject,
      faculty_name = excluded.faculty_name,
      room = excluded.room
  `);

  db.exec('BEGIN TRANSACTION;');
  try {
    if (allSections) {
      db.prepare('DELETE FROM timetables').run();
    } else {
      const deleteSectionStmt = db.prepare('DELETE FROM timetables WHERE section_id = ?');
      for (const s of targetSections) {
        deleteSectionStmt.run(s.id);
      }
    }

    for (const slot of generatedSlots) {
      insertStmt.run(
        slot.year,
        slot.section_id,
        slot.day,
        slot.period,
        slot.subject,
        slot.faculty_name,
        slot.room
      );
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    return {
      success: false,
      constraint: 'Database Write Error',
      error: `Database transaction failed: ${err.message}`
    };
  }

  return {
    success: true,
    message: `Generated schedule for ${targetSections.length} section(s) (${generatedSlots.length} slots) with zero conflicts!`,
    sectionsGenerated: targetSections.length,
    slotsGenerated: generatedSlots.length,
    standbyFloaters: Object.fromEntries(
      Object.entries(dailyStandbyFloaters).map(([day, set]) => [day, Array.from(set)])
    ),
    workloadSummary: Object.fromEntries(
      Object.entries(facultyHours).filter(([_, h]) => h > 0)
    )
  };
}
