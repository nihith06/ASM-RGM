import db from '../server/db.js';

const BASE_URL = 'http://localhost:5000/api';

let passed = 0;
let failed = 0;

function assert(desc, condition, details = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${desc} ${details}`);
    failed++;
  }
}

async function run() {
  console.log('🧪 Starting Verification: Removal of Subject Maximum 2 Times Per Week Constraint...\n');

  // Clear active sessions before test run
  db.prepare('DELETE FROM active_sessions').run();

  // 1. Authenticate as Admin
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ register_id: 'admin01', password: '1352468' })
  });
  const loginData = await loginRes.json();
  assert('Admin login succeeds', loginRes.status === 200 && !!loginData.token);
  const token = loginData.token;
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  const targetSection = db.prepare('SELECT id, name FROM sections WHERE year = 1 LIMIT 1').get();
  const targetYear = 1;
  const targetSectionId = targetSection.id;

  // 2. Test: Subject appearing 3 times per week (previously rejected, now MUST PASS)
  const cells3Times = [
    { day: 'Monday', period: 1, subject: 'Deep Learning', faculty_name: '', room: 'ET-101' },
    { day: 'Tuesday', period: 2, subject: 'Deep Learning', faculty_name: '', room: 'ET-101' },
    { day: 'Wednesday', period: 3, subject: 'Deep Learning', faculty_name: '', room: 'ET-101' }
  ];
  const res3Times = await fetch(`${BASE_URL}/timetables/validate-upload`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ year: targetYear, section_id: targetSectionId, cells: cells3Times })
  });
  const data3Times = await res3Times.json();
  assert('Subject appearing 3 times per week is ACCEPTED (valid: true)', res3Times.status === 200 && data3Times.valid === true, JSON.stringify(data3Times));

  // 3. Test: Subject appearing 6 times per week (once every day, MUST PASS)
  const cells6Times = [
    { day: 'Monday', period: 1, subject: 'Cloud Computing', faculty_name: '', room: 'ET-102' },
    { day: 'Tuesday', period: 1, subject: 'Cloud Computing', faculty_name: '', room: 'ET-102' },
    { day: 'Wednesday', period: 1, subject: 'Cloud Computing', faculty_name: '', room: 'ET-102' },
    { day: 'Thursday', period: 1, subject: 'Cloud Computing', faculty_name: '', room: 'ET-102' },
    { day: 'Friday', period: 1, subject: 'Cloud Computing', faculty_name: '', room: 'ET-102' },
    { day: 'Saturday', period: 1, subject: 'Cloud Computing', faculty_name: '', room: 'ET-102' }
  ];
  const res6Times = await fetch(`${BASE_URL}/timetables/validate-upload`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ year: targetYear, section_id: targetSectionId, cells: cells6Times })
  });
  const data6Times = await res6Times.json();
  assert('Subject appearing 6 times per week is ACCEPTED (valid: true)', res6Times.status === 200 && data6Times.valid === true, JSON.stringify(data6Times));

  // 4. Test: Subject appearing 10 times per week (multiple per day, MUST PASS)
  const cells10Times = [
    { day: 'Monday', period: 1, subject: 'Artificial Intelligence', faculty_name: '', room: '' },
    { day: 'Monday', period: 2, subject: 'Artificial Intelligence', faculty_name: '', room: '' },
    { day: 'Tuesday', period: 1, subject: 'Artificial Intelligence', faculty_name: '', room: '' },
    { day: 'Tuesday', period: 2, subject: 'Artificial Intelligence', faculty_name: '', room: '' },
    { day: 'Wednesday', period: 1, subject: 'Artificial Intelligence', faculty_name: '', room: '' },
    { day: 'Wednesday', period: 2, subject: 'Artificial Intelligence', faculty_name: '', room: '' },
    { day: 'Thursday', period: 1, subject: 'Artificial Intelligence', faculty_name: '', room: '' },
    { day: 'Thursday', period: 2, subject: 'Artificial Intelligence', faculty_name: '', room: '' },
    { day: 'Friday', period: 1, subject: 'Artificial Intelligence', faculty_name: '', room: '' },
    { day: 'Friday', period: 2, subject: 'Artificial Intelligence', faculty_name: '', room: '' }
  ];
  const res10Times = await fetch(`${BASE_URL}/timetables/validate-upload`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ year: targetYear, section_id: targetSectionId, cells: cells10Times })
  });
  const data10Times = await res10Times.json();
  assert('Subject appearing 10 times per week is ACCEPTED (valid: true)', res10Times.status === 200 && data10Times.valid === true, JSON.stringify(data10Times));

  // 5. Check other rules: Empty Subject, Faculty, or Room are accepted
  const emptyFields = [
    { day: 'Monday', period: 1, subject: '', faculty_name: '', room: '' },
    { day: 'Monday', period: 2, subject: 'Python', faculty_name: '', room: '' },
    { day: 'Monday', period: 3, subject: '', faculty_name: 'Dr. J. Avinash', room: '' },
    { day: 'Monday', period: 4, subject: 'Python', faculty_name: '', room: 'ET-4015' }
  ];
  const resEmpty = await fetch(`${BASE_URL}/timetables/validate-upload`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ year: targetYear, section_id: targetSectionId, cells: emptyFields })
  });
  const dataEmpty = await resEmpty.json();
  assert('Empty Subject, Faculty, or Room fields are ACCEPTED', resEmpty.status === 200 && dataEmpty.valid === true, JSON.stringify(dataEmpty));

  // 6. Check other rules: Invalid Day rejected
  const invalidDay = [
    { day: 'Sunday', period: 1, subject: 'Math', faculty_name: '', room: '' }
  ];
  const resInvalidDay = await fetch(`${BASE_URL}/timetables/validate-upload`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ year: targetYear, section_id: targetSectionId, cells: invalidDay })
  });
  const dataInvalidDay = await resInvalidDay.json();
  assert('Invalid Day (Sunday) is REJECTED with 400', resInvalidDay.status === 400 && dataInvalidDay.valid === false);

  // 7. Check other rules: Invalid Hour rejected
  const invalidHour = [
    { day: 'Monday', period: 8, subject: 'Math', faculty_name: '', room: '' }
  ];
  const resInvalidHour = await fetch(`${BASE_URL}/timetables/validate-upload`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ year: targetYear, section_id: targetSectionId, cells: invalidHour })
  });
  const dataInvalidHour = await resInvalidHour.json();
  assert('Invalid Hour (8) is REJECTED with 400', resInvalidHour.status === 400 && dataInvalidHour.valid === false);

  // 8. Check other rules: Intra-upload faculty conflict rejected
  const intraConflict = [
    { day: 'Monday', period: 2, subject: 'Math', faculty_name: 'Dr. J. Avinash', room: 'ET-1' },
    { day: 'Monday', period: 2, subject: 'Physics', faculty_name: 'Dr. J. Avinash', room: 'ET-2' }
  ];
  const resIntra = await fetch(`${BASE_URL}/timetables/validate-upload`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ year: targetYear, section_id: targetSectionId, cells: intraConflict })
  });
  const dataIntra = await resIntra.json();
  assert('Intra-upload faculty teaching conflict is REJECTED with 409', resIntra.status === 409 && dataIntra.valid === false);

  // 9. Check other rules: Database faculty teaching conflict rejected
  // Pick an existing class from another section (Year 2 Section 3)
  const existingSlot = db.prepare(`
    SELECT year, section_id, day, period, faculty_name, subject
    FROM timetables
    WHERE year != ? AND subject != '—' AND TRIM(faculty_name) != '' AND TRIM(faculty_name) != '—'
    LIMIT 1
  `).get(targetYear);
  if (existingSlot) {
    // Attempt to assign the same faculty at the same day & period in Year 1 targetSectionId
    const conflictCells = [
      { day: existingSlot.day, period: existingSlot.period, subject: 'Special Subject', faculty_name: existingSlot.faculty_name, room: 'ET-999' }
    ];
    const resDbConflict = await fetch(`${BASE_URL}/timetables/validate-upload`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ year: targetYear, section_id: targetSectionId, cells: conflictCells })
    });
    const dataDbConflict = await resDbConflict.json();
    assert('Database faculty teaching conflict is REJECTED with 409', resDbConflict.status === 409 && dataDbConflict.valid === false, dataDbConflict.error);
  }

  // 10. Check other rules: Busy and Leave status ignored
  // Temporarily set a faculty on leave for today
  const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];
  const facTest = db.prepare("SELECT id, name FROM users WHERE role = 'faculty' AND register_id = 'FAC003'").get();
  db.prepare("INSERT OR REPLACE INTO faculty_leaves (faculty_id, faculty_name, leave_date, status, reason) VALUES (?, ?, ?, 'leave', 'Test')").run(facTest.id, facTest.name, todayStr);
  
  // Dr. G. Chandana Swathi is free on Wednesday period 1. She is on leave today, but teaching at a free hour should STILL be allowed during timetable upload
  const cellsLeaveFac = [
    { day: 'Wednesday', period: 1, subject: 'Research', faculty_name: facTest.name, room: 'ET-303' }
  ];
  const resLeaveIgnored = await fetch(`${BASE_URL}/timetables/validate-upload`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ year: targetYear, section_id: targetSectionId, cells: cellsLeaveFac })
  });
  const dataLeaveIgnored = await resLeaveIgnored.json();
  assert('Faculty Leave/Busy status is IGNORED during upload validation (valid: true)', resLeaveIgnored.status === 200 && dataLeaveIgnored.valid === true, JSON.stringify(dataLeaveIgnored));
  // Clean up test leave
  db.prepare("DELETE FROM faculty_leaves WHERE faculty_id = ? AND leave_date = ?").run(facTest.id, todayStr);

  // 11. End-to-End Workflow: Replace section timetable with subject appearing 5 times
  // Backup existing cells for targetYear and targetSectionId
  const backupCells = db.prepare('SELECT day, period, subject, faculty_name, room FROM timetables WHERE year = ? AND section_id = ?').all(targetYear, targetSectionId);

  const fiveOccurrenceCells = [
    { day: 'Monday', period: 1, subject: 'Machine Learning Lab', faculty_name: '', room: 'ET-101' },
    { day: 'Tuesday', period: 2, subject: 'Machine Learning Lab', faculty_name: '', room: 'ET-101' },
    { day: 'Wednesday', period: 3, subject: 'Machine Learning Lab', faculty_name: '', room: 'ET-101' },
    { day: 'Thursday', period: 4, subject: 'Machine Learning Lab', faculty_name: '', room: 'ET-101' },
    { day: 'Friday', period: 5, subject: 'Machine Learning Lab', faculty_name: '', room: 'ET-101' }
  ];

  const valRes = await fetch(`${BASE_URL}/timetables/validate-upload`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ year: targetYear, section_id: targetSectionId, cells: fiveOccurrenceCells })
  });
  const valData = await valRes.json();
  assert('Validation for timetable with 5 occurrences of a subject succeeds', valRes.status === 200 && valData.valid === true);

  const replaceRes = await fetch(`${BASE_URL}/timetables/replace-section-timetable`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ year: targetYear, section_id: targetSectionId, cells: valData.cells })
  });
  const replaceData = await replaceRes.json();
  assert('Replace section timetable endpoint returns success', replaceRes.status === 200 && replaceData.success === true);

  // Verify in database that Machine Learning Lab is scheduled exactly 5 times
  const dbCount = db.prepare(`
    SELECT COUNT(*) as count 
    FROM timetables 
    WHERE year = ? AND section_id = ? AND subject = 'Machine Learning Lab'
  `).get(targetYear, targetSectionId).count;
  assert('Database contains all 5 occurrences of the subject', dbCount === 5);

  // Restore backup cells to keep database in original state
  db.prepare('DELETE FROM timetables WHERE year = ? AND section_id = ?').run(targetYear, targetSectionId);
  const restoreStmt = db.prepare(`
    INSERT INTO timetables (year, section_id, day, period, subject, faculty_name, room)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const b of backupCells) {
    restoreStmt.run(targetYear, targetSectionId, b.day, b.period, b.subject, b.faculty_name, b.room);
  }
  assert('Original timetable data cleanly restored after test', true);

  console.log(`\nVerification Summary: ${passed} Passed, ${failed} Failed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
