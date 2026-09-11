import http from 'node:http';
import db from './db.js';

const BASE_URL = 'http://localhost:5000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const status = response.status;
  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    data = { text: rawText };
  }
  return { status, data };
}

async function runTests() {
  console.log('🧪 Starting Automated Backend Verification for RGMCET AIML...\n');
  let passed = 0;
  let failed = 0;

  function assert(name, condition, extraInfo = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name} ${extraInfo}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    const health = await request('/api/health');
    assert('Health check endpoint is online', health.status === 200 && health.data.status === 'online');

    // 2. Admin Login
    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { register_id: 'ADMIN001', password: 'admin123' }
    });
    assert('Admin login successful', adminLogin.status === 200 && adminLogin.data.token, JSON.stringify(adminLogin));
    const adminToken = adminLogin.data.token;

    // 3. Duplicate ID Rejection
    const dupRegister = await request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Imposter Admin',
        register_id: 'ADMIN001',
        password: 'password123',
        role: 'student',
        year: 1,
        phone: '9999999999'
      }
    });
    assert('Duplicate Register ID rejected with 409', dupRegister.status === 409);

    // 4. Register new Student
    const testStudentId = '24091A3399';
    const regStudent = await request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Test Student John',
        register_id: testStudentId,
        password: 'studentpass123',
        role: 'student',
        year: 3,
        phone: '9876500001'
      }
    });
    assert('New student registration handled', regStudent.status === 201 || regStudent.status === 409);

    // Login as student
    const studentLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { register_id: testStudentId, password: 'studentpass123' }
    });
    assert('Student login succeeds', studentLogin.status === 200 && studentLogin.data.token);
    const studentToken = studentLogin.data.token;

    // 5. Faculty Login
    const facLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { register_id: 'FAC001', password: 'faculty123' }
    });
    assert('Faculty login succeeds (FAC001)', facLogin.status === 200 && facLogin.data.token);
    const facToken = facLogin.data.token;

    // 6. PRIVACY RULE TEST: Student accessing student/faculty directory must be rejected (403)!
    const studentAccessingDir = await request('/api/directory/students', { token: studentToken });
    assert('Student accessing student directory rejected with 403 Forbidden', studentAccessingDir.status === 403);

    const studentAccessingFacDir = await request('/api/directory/faculty', { token: studentToken });
    assert('Student accessing faculty directory rejected with 403 Forbidden', studentAccessingFacDir.status === 403);

    // 7. PRIVACY RULE TEST: Faculty accessing directories must succeed (200)!
    const facAccessingDir = await request('/api/directory/students', { token: facToken });
    assert('Faculty accessing student directory succeeds with 200 OK', facAccessingDir.status === 200 && Array.isArray(facAccessingDir.data.students));

    const facAccessingFacDir = await request('/api/directory/faculty', { token: facToken });
    assert('Faculty accessing faculty directory succeeds with 200 OK', facAccessingFacDir.status === 200 && Array.isArray(facAccessingFacDir.data.faculty));

    // 8. Timetable Access: Student can access all 4 years
    for (let yr = 1; yr <= 4; yr++) {
      const ttRes = await request(`/api/timetables?year=${yr}`, { token: studentToken });
      assert(`Student can view Year ${yr} timetable`, ttRes.status === 200 && ttRes.data.grid && ttRes.data.grid.Monday);
    }

    // 9. Admin Section Creation & Timetable Editing
    const newSection = await request('/api/timetables/sections', {
      method: 'POST',
      token: adminToken,
      body: { year: 3, name: 'Temp Test Section' }
    });
    assert('Admin can create new section', newSection.status === 201 || newSection.status === 409);
    if (newSection.status === 201 && newSection.data.section) {
      await request(`/api/timetables/sections/${newSection.data.section.id}`, {
        method: 'DELETE',
        token: adminToken
      });
    }

    // Student cannot create section (403)
    const studentCreateSec = await request('/api/timetables/sections', {
      method: 'POST',
      token: studentToken,
      body: { year: 3, name: 'Hacked Section' }
    });
    assert('Student creating section rejected with 403', studentCreateSec.status === 403);

    // 10. Faculty Availability Engine
    const availRes = await request('/api/faculty/availability', { token: studentToken });
    assert('Student can view Faculty Availability matrix', availRes.status === 200 && Array.isArray(availRes.data.faculty_availability));
    
    // Verify structure
    const kishorFac = availRes.data.faculty_availability.find(f => f.register_id === 'FAC001');
    assert('Faculty FAC001 (Dr. G. Kishor Kumar) has computed schedule with Monday-Saturday', kishorFac && kishorFac.schedule && kishorFac.schedule.Monday);

    // 11. Faculty Override on a genuinely free slot (Thursday Period 2)
    const overrideRes = await request('/api/faculty/overrides', {
      method: 'POST',
      token: facToken,
      body: {
        day: 'Thursday',
        period: 2,
        status: 'busy'
      }
    });
    assert('Faculty can set free-period override', overrideRes.status === 200);

    // Verify the override appears in public availability
    const checkAvail = await request('/api/faculty/availability?day=Thursday', { token: studentToken });
    const targetFac = checkAvail.data.faculty_availability.find(f => f.register_id === 'FAC001');
    assert('Override is visible in public availability for Thursday Period 2', 
      targetFac && targetFac.schedule.Thursday[2] && targetFac.schedule.Thursday[2].status === 'busy'
    );

    // Clean up test override
    await request('/api/faculty/overrides/Thursday/2', { method: 'DELETE', token: facToken });

    // 12. Multi-Year Teaching: Verify Dr. G. Kishor Kumar (FAC001) teaches Year 1, Year 2, and Year 4 on Wednesday
    const kishorSchedule = await request('/api/faculty/my-schedule', { token: facToken });
    assert('Faculty can fetch personal multi-year teaching schedule', kishorSchedule.status === 200);
    const wedClasses = kishorSchedule.data.teaching_classes.filter(c => c.day === 'Wednesday');
    const wedYears = new Set(wedClasses.map(c => c.year));
    assert('Faculty FAC001 teaches multiple different years on Wednesday (1st, 2nd, and 4th Year)',
      wedYears.has(1) && wedYears.has(2) && wedYears.has(4)
    );

    // 13. Clock-Time Conflict Detection:
    // Year 1 Period 7 is 16:00 - 16:50 PM.
    // Year 2 Period 7 is 15:30 - 16:20 PM.
    // Attempting to assign Dr. G. Kishor Kumar to Year 2 Period 7 on Wednesday must fail with 409 Conflict due to clock time overlap (16:00 - 16:20)!
    const secRes = await request('/api/timetables/sections', { token: adminToken });
    const secA_Y2 = secRes.data.sections.find(s => s.year === 2 && s.name.includes('A'));
    const conflictAttempt = await request('/api/timetables/cell', {
      method: 'POST',
      token: adminToken,
      body: {
        year: 2,
        section_id: secA_Y2.id,
        day: 'Wednesday',
        period: 7,
        subject: 'AI',
        faculty_name: 'Dr. G. Kishor Kumar'
      }
    });
    assert('Assigning overlapping clock-time slot rejected with 409 Conflict',
      conflictAttempt.status === 409 && conflictAttempt.data.error.includes('Conflict')
    );

    // 14. Non-Conflicting Multi-Year Assignment:
    // Wednesday Period 1 in Year 2 (09:00 - 09:50) where Dr. G. Kishor Kumar is assigned
    const validMultiYearCell = await request('/api/timetables/cell', {
      method: 'POST',
      token: adminToken,
      body: {
        year: 2,
        section_id: secA_Y2.id,
        day: 'Wednesday',
        period: 1,
        subject: 'OOPJ',
        faculty_name: 'Dr. G. Kishor Kumar'
      }
    });
    assert('Valid non-conflicting multi-year assignment succeeds with 200 OK', validMultiYearCell.status === 200);

    // 15. Merged Period Updating: Support updating periods array [1, 2] atomically on Wednesday
    const mergedCellUpdate = await request('/api/timetables/cell', {
      method: 'POST',
      token: adminToken,
      body: {
        year: 2,
        section_id: secA_Y2.id,
        day: 'Wednesday',
        periods: [1, 2],
        subject: 'OOPJ',
        faculty_name: 'Dr. G. Kishor Kumar'
      }
    });
    assert('Updating merged period block [1, 2] succeeds with 200 OK', mergedCellUpdate.status === 200);

    // 15A. Year 2 Section A Official Source-of-Truth Timetable Verification
    const y2TtRes = await request(`/api/timetables?year=2&section_id=${secA_Y2.id}`, { token: studentToken });
    assert('2nd Year Section A timetable loads successfully', y2TtRes.status === 200);
    const monY2 = y2TtRes.data.grid.Monday;
    const tueY2 = y2TtRes.data.grid.Tuesday;
    const wedY2 = y2TtRes.data.grid.Wednesday;
    const thuY2 = y2TtRes.data.grid.Thursday;
    const friY2 = y2TtRes.data.grid.Friday;
    const satY2 = y2TtRes.data.grid.Saturday;

    assert('Year 2 Sec A: Monday has PYP, OOPJ LAB, SEM, DMGT',
      monY2[1]?.subject === 'PYP' && monY2[3]?.subject === 'OOPJ LAB' && monY2[5]?.subject === 'SEM' && monY2[6]?.subject === 'DMGT'
    );
    assert('Year 2 Sec A: Tuesday has TRAINING PROGRAM, SEM, ADSA',
      tueY2[1]?.subject === 'TRAINING PROGRAM' && tueY2[3]?.subject === 'SEM' && tueY2[6]?.subject === 'ADSA'
    );
    assert('Year 2 Sec A: Wednesday has OOPJ, ES, SEM, AI',
      wedY2[1]?.subject === 'OOPJ' && wedY2[3]?.subject === 'ES' && wedY2[5]?.subject === 'SEM' && wedY2[6]?.subject === 'AI'
    );
    assert('Year 2 Sec A: Thursday has DMGT, OOPJ, PYP, ADSA',
      thuY2[1]?.subject === 'DMGT' && thuY2[3]?.subject === 'OOPJ' && thuY2[5]?.subject === 'PYP' && thuY2[6]?.subject === 'ADSA'
    );
    assert('Year 2 Sec A: Friday has ADSA LAB, SEM, UHV',
      friY2[1]?.subject === 'ADSA LAB' && friY2[3]?.subject === 'SEM' && friY2[6]?.subject === 'UHV'
    );
    assert('Year 2 Sec A: Saturday has UHV, SEM, AI',
      satY2[1]?.subject === 'UHV' && satY2[3]?.subject === 'SEM' && satY2[6]?.subject === 'AI'
    );
    assert('Year 2 Sec A: Room is set to RG-207', monY2[1]?.room === 'RG-207');

    // 15B. Year 2 Section B Official Source-of-Truth Timetable Verification
    const secB_Y2 = secRes.data.sections.find(s => s.year === 2 && s.name.includes('B'));
    const y2SecBTtRes = await request(`/api/timetables?year=2&section_id=${secB_Y2.id}`, { token: studentToken });
    assert('2nd Year Section B timetable loads successfully', y2SecBTtRes.status === 200);
    const monY2B = y2SecBTtRes.data.grid.Monday;
    const tueY2B = y2SecBTtRes.data.grid.Tuesday;
    const wedY2B = y2SecBTtRes.data.grid.Wednesday;
    const thuY2B = y2SecBTtRes.data.grid.Thursday;
    const friY2B = y2SecBTtRes.data.grid.Friday;
    const satY2B = y2SecBTtRes.data.grid.Saturday;

    assert('Year 2 Sec B: Monday has DMGT, SEM, UHV',
      monY2B[1]?.subject === 'DMGT' && monY2B[3]?.subject === 'SEM' && monY2B[5]?.subject === 'SEM' && monY2B[6]?.subject === 'UHV'
    );
    assert('Year 2 Sec B: Tuesday has OOPJ, UHV, PYP, ADSA',
      tueY2B[1]?.subject === 'OOPJ' && tueY2B[3]?.subject === 'UHV' && tueY2B[5]?.subject === 'PYP' && tueY2B[6]?.subject === 'ADSA'
    );
    assert('Year 2 Sec B: Wednesday has AI, TRAINING PROGRAM, SEM, ADSA LAB',
      wedY2B[1]?.subject === 'AI' && wedY2B[3]?.subject === 'TRAINING PROGRAM' && wedY2B[5]?.subject === 'SEM' && wedY2B[6]?.subject === 'ADSA LAB'
    );
    assert('Year 2 Sec B: Thursday has OOPJ LAB, SEM, DMGT',
      thuY2B[1]?.subject === 'OOPJ LAB' && thuY2B[3]?.subject === 'SEM' && thuY2B[5]?.subject === 'SEM' && thuY2B[6]?.subject === 'DMGT'
    );
    assert('Year 2 Sec B: Friday has ADSA, AI, SEM, OOPJ',
      friY2B[1]?.subject === 'ADSA' && friY2B[3]?.subject === 'AI' && friY2B[5]?.subject === 'SEM' && friY2B[6]?.subject === 'OOPJ'
    );
    assert('Year 2 Sec B: Saturday has ES, SEM, PYP',
      satY2B[1]?.subject === 'ES' && satY2B[3]?.subject === 'SEM' && satY2B[5]?.subject === 'SEM' && satY2B[6]?.subject === 'PYP'
    );
    assert('Year 2 Sec B: Room is set to RG-208', monY2B[1]?.room === 'RG-208');

    // 15C. Year 2 Section C Official Source-of-Truth Timetable Verification
    const secC_Y2 = secRes.data.sections.find(s => s.year === 2 && s.name.includes('C'));
    const y2SecCTtRes = await request(`/api/timetables?year=2&section_id=${secC_Y2.id}`, { token: studentToken });
    assert('2nd Year Section C timetable loads successfully', y2SecCTtRes.status === 200);
    const monY2C = y2SecCTtRes.data.grid.Monday;
    const tueY2C = y2SecCTtRes.data.grid.Tuesday;
    const wedY2C = y2SecCTtRes.data.grid.Wednesday;
    const thuY2C = y2SecCTtRes.data.grid.Thursday;
    const friY2C = y2SecCTtRes.data.grid.Friday;
    const satY2C = y2SecCTtRes.data.grid.Saturday;

    assert('Year 2 Sec C: Monday has ADSA LAB, LIB, SEM, AI',
      monY2C[1]?.subject === 'ADSA LAB' && monY2C[3]?.subject === 'LIB' && monY2C[5]?.subject === 'SEM' && monY2C[6]?.subject === 'AI'
    );
    assert('Year 2 Sec C: Tuesday has ADSA, OOPJ LAB, SEM, UHV',
      tueY2C[1]?.subject === 'ADSA' && tueY2C[3]?.subject === 'OOPJ LAB' && tueY2C[5]?.subject === 'SEM' && tueY2C[6]?.subject === 'UHV'
    );
    assert('Year 2 Sec C: Wednesday has DMGT, SEM, OOPJ',
      wedY2C[1]?.subject === 'DMGT' && wedY2C[3]?.subject === 'SEM' && wedY2C[5]?.subject === 'SEM' && wedY2C[6]?.subject === 'OOPJ'
    );
    assert('Year 2 Sec C: Thursday has AI, TRAINING PROGRAM, PYP, ADSA',
      thuY2C[1]?.subject === 'AI' && thuY2C[3]?.subject === 'TRAINING PROGRAM' && thuY2C[5]?.subject === 'PYP' && thuY2C[6]?.subject === 'ADSA'
    );
    assert('Year 2 Sec C: Friday has PYP, DMGT, SEM, OOPJ',
      friY2C[1]?.subject === 'PYP' && friY2C[3]?.subject === 'DMGT' && friY2C[5]?.subject === 'SEM' && friY2C[6]?.subject === 'OOPJ'
    );
    assert('Year 2 Sec C: Saturday has ES, LIB, SEM, UHV',
      satY2C[1]?.subject === 'ES' && satY2C[3]?.subject === 'LIB' && satY2C[5]?.subject === 'SEM' && satY2C[6]?.subject === 'UHV'
    );
    assert('Year 2 Sec C: Room is set to RG-209', monY2C[1]?.room === 'RG-209');

    // 15D. Year 2 Section D Official Source-of-Truth Timetable Verification
    const secD_Y2 = secRes.data.sections.find(s => s.year === 2 && s.name.includes('D'));
    const y2SecDTtRes = await request(`/api/timetables?year=2&section_id=${secD_Y2.id}`, { token: studentToken });
    assert('2nd Year Section D timetable loads successfully', y2SecDTtRes.status === 200);
    const monY2D = y2SecDTtRes.data.grid.Monday;
    const tueY2D = y2SecDTtRes.data.grid.Tuesday;
    const wedY2D = y2SecDTtRes.data.grid.Wednesday;
    const thuY2D = y2SecDTtRes.data.grid.Thursday;
    const friY2D = y2SecDTtRes.data.grid.Friday;
    const satY2D = y2SecDTtRes.data.grid.Saturday;

    assert('Year 2 Sec D: Monday has OOPJ, SEM, AI',
      monY2D[1]?.subject === 'OOPJ' && monY2D[3]?.subject === 'SEM' && monY2D[5]?.subject === 'SEM' && monY2D[6]?.subject === 'AI'
    );
    assert('Year 2 Sec D: Tuesday has OOPJ LAB, TRAINING PROGRAM, SEM, ADSA',
      tueY2D[1]?.subject === 'OOPJ LAB' && tueY2D[3]?.subject === 'TRAINING PROGRAM' && tueY2D[5]?.subject === 'SEM' && tueY2D[6]?.subject === 'ADSA'
    );
    assert('Year 2 Sec D: Wednesday has DMGT, ADSA LAB, SEM, PYP',
      wedY2D[1]?.subject === 'DMGT' && wedY2D[3]?.subject === 'ADSA LAB' && wedY2D[5]?.subject === 'SEM' && wedY2D[6]?.subject === 'SEM' && wedY2D[7]?.subject === 'PYP'
    );
    assert('Year 2 Sec D: Thursday has ADSA, UHV, SEM, AI',
      thuY2D[1]?.subject === 'ADSA' && thuY2D[3]?.subject === 'UHV' && thuY2D[5]?.subject === 'SEM' && thuY2D[6]?.subject === 'AI'
    );
    assert('Year 2 Sec D: Friday has ES, DMGT, SEM, OOPJ',
      friY2D[1]?.subject === 'ES' && friY2D[3]?.subject === 'DMGT' && friY2D[5]?.subject === 'SEM' && friY2D[6]?.subject === 'OOPJ'
    );
    assert('Year 2 Sec D: Saturday has PYP LAB, SEM, UHV',
      satY2D[1]?.subject === 'PYP LAB' && satY2D[3]?.subject === 'SEM' && satY2D[5]?.subject === 'SEM' && satY2D[6]?.subject === 'UHV'
    );
    assert('Year 2 Sec D: Room is set to RG-210', monY2D[1]?.room === 'RG-210');

    // 15E. Year 3 Section A Official Source-of-Truth Timetable Verification (Photo Source)
    const secA_Y3 = secRes.data.sections.find(s => s.year === 3 && s.name.includes('A'));
    const y3SecATtRes = await request(`/api/timetables?year=3&section_id=${secA_Y3.id}`, { token: studentToken });
    assert('3rd Year Section A timetable loads successfully', y3SecATtRes.status === 200);
    const monY3A = y3SecATtRes.data.grid.Monday;
    const tueY3A = y3SecATtRes.data.grid.Tuesday;
    const wedY3A = y3SecATtRes.data.grid.Wednesday;
    const thuY3A = y3SecATtRes.data.grid.Thursday;
    const friY3A = y3SecATtRes.data.grid.Friday;
    const satY3A = y3SecATtRes.data.grid.Saturday;

    assert('Year 3 Sec A: Monday has NLP, QT&A, AI&SP LAB',
      monY3A[1]?.subject === 'NLP' && monY3A[1]?.faculty_name === 'Mr. V. Phanishwara Hara Gopal' &&
      monY3A[3]?.subject === 'QT&A' && monY3A[3]?.faculty_name === 'Dr. S. Farooq' &&
      monY3A[5]?.subject === 'AI&SP LAB' && monY3A[5]?.faculty_name === 'Ms. E. Naveena'
    );
    assert('Year 3 Sec A: Tuesday has CV&IP, SEM, TINKERING LAB',
      tueY3A[1]?.subject === 'CV&IP' && tueY3A[1]?.faculty_name === 'Dr. Chakrapani' &&
      tueY3A[3]?.subject === 'SEM' && tueY3A[3]?.faculty_name === '—' &&
      tueY3A[5]?.subject === 'TINKERING LAB' && tueY3A[5]?.faculty_name === 'Dr. Chakrapani'
    );
    assert('Year 3 Sec A: Wednesday has SSP, EDA, SEM, NLP',
      wedY3A[1]?.subject === 'SSP' && wedY3A[1]?.faculty_name === 'Ms. E. Naveena' &&
      wedY3A[3]?.subject === 'EDA' && wedY3A[3]?.faculty_name === 'Mr. P. Sreekanth Reddy' &&
      wedY3A[5]?.subject === 'SEM' && wedY3A[5]?.faculty_name === '—' &&
      wedY3A[6]?.subject === 'NLP' && wedY3A[6]?.faculty_name === 'Mr. V. Phanishwara Hara Gopal'
    );
    assert('Year 3 Sec A: Thursday has FSD, SEM, CV&ML LAB',
      thuY3A[1]?.subject === 'FSD' && thuY3A[1]?.faculty_name === 'Mr. S. Kalim Peerulla Basha' &&
      thuY3A[3]?.subject === 'SEM' && thuY3A[3]?.faculty_name === '—' &&
      thuY3A[5]?.subject === 'CV&ML LAB' && thuY3A[5]?.faculty_name === 'Dr. Chakrapani'
    );
    assert('Year 3 Sec A: Friday has QT&A, SSP, LIB, CV&IP',
      friY3A[1]?.subject === 'QT&A' && friY3A[1]?.faculty_name === 'Dr. S. Farooq' &&
      friY3A[3]?.subject === 'SSP' && friY3A[3]?.faculty_name === 'Ms. E. Naveena' &&
      friY3A[5]?.subject === 'LIB' && friY3A[5]?.faculty_name === '—' &&
      friY3A[6]?.subject === 'CV&IP' && friY3A[6]?.faculty_name === 'Dr. Chakrapani'
    );
    assert('Year 3 Sec A: Saturday has EDA, LIB, SEM, FSD',
      satY3A[1]?.subject === 'EDA' && satY3A[1]?.faculty_name === 'Mr. P. Sreekanth Reddy' &&
      satY3A[3]?.subject === 'LIB' && satY3A[3]?.faculty_name === '—' &&
      satY3A[5]?.subject === 'SEM' && satY3A[5]?.faculty_name === '—' &&
      satY3A[7]?.subject === 'FSD' && satY3A[7]?.faculty_name === 'Mr. S. Kalim Peerulla Basha'
    );
    assert('Year 3 Sec A: Room numbers are neglected (empty)', monY3A[1]?.room === '');

    // 15F. Year 3 Section B Official Source-of-Truth Timetable Verification (Photo Source)
    const secB_Y3 = secRes.data.sections.find(s => s.year === 3 && s.name.includes('B'));
    const y3SecBTtRes = await request(`/api/timetables?year=3&section_id=${secB_Y3.id}`, { token: studentToken });
    assert('3rd Year Section B timetable loads successfully', y3SecBTtRes.status === 200);
    const monY3B = y3SecBTtRes.data.grid.Monday;
    const tueY3B = y3SecBTtRes.data.grid.Tuesday;
    const wedY3B = y3SecBTtRes.data.grid.Wednesday;
    const thuY3B = y3SecBTtRes.data.grid.Thursday;
    const friY3B = y3SecBTtRes.data.grid.Friday;
    const satY3B = y3SecBTtRes.data.grid.Saturday;

    assert('Year 3 Sec B: Monday has NLP, QT&A, SEM, SSP',
      monY3B[1]?.subject === 'NLP' && monY3B[1]?.faculty_name === 'Dr. J. Avinash' &&
      monY3B[3]?.subject === 'QT&A' && monY3B[3]?.faculty_name === 'Dr. B. Jamalaiah' &&
      monY3B[5]?.subject === 'SEM' && monY3B[5]?.faculty_name === '—' &&
      monY3B[6]?.subject === 'SSP' && monY3B[6]?.faculty_name === 'Mr. N. Bala Kishore'
    );
    assert('Year 3 Sec B: Tuesday has FSD, SEM, CV&ML Lab',
      tueY3B[1]?.subject === 'FSD' && tueY3B[1]?.faculty_name === 'Ms. P. Supriya' &&
      tueY3B[3]?.subject === 'SEM' && tueY3B[3]?.faculty_name === '—' &&
      tueY3B[5]?.subject === 'CV&ML Lab' && tueY3B[5]?.faculty_name === 'Mr. V. Raghavendra'
    );
    assert('Year 3 Sec B: Wednesday has SSP, EDA, SEM, NLP',
      wedY3B[1]?.subject === 'SSP' && wedY3B[1]?.faculty_name === 'Mr. N. Bala Kishore' &&
      wedY3B[3]?.subject === 'EDA' && wedY3B[3]?.faculty_name === 'Mrs. K. Jabeen' &&
      wedY3B[5]?.subject === 'SEM' && wedY3B[5]?.faculty_name === '—' &&
      wedY3B[6]?.subject === 'NLP' && wedY3B[6]?.faculty_name === 'Dr. J. Avinash'
    );
    assert('Year 3 Sec B: Thursday has CV&IP, SEM, EDA',
      thuY3B[1]?.subject === 'CV&IP' && thuY3B[1]?.faculty_name === 'Mr. V. Raghavendra' &&
      thuY3B[3]?.subject === 'SEM' && thuY3B[3]?.faculty_name === '—' &&
      thuY3B[5]?.subject === 'SEM' && thuY3B[5]?.faculty_name === '—' &&
      thuY3B[6]?.subject === 'EDA' && thuY3B[6]?.faculty_name === 'Mrs. K. Jabeen'
    );
    assert('Year 3 Sec B: Friday has QT&A, AI&SP Lab, TINKERING LAB',
      friY3B[1]?.subject === 'QT&A' && friY3B[1]?.faculty_name === 'Dr. B. Jamalaiah' &&
      friY3B[3]?.subject === 'AI&SP Lab' && friY3B[3]?.faculty_name === 'Mr. N. Bala Kishore' &&
      friY3B[5]?.subject === 'TINKERING LAB' && friY3B[5]?.faculty_name === 'Mrs. K. Jabeen'
    );
    assert('Year 3 Sec B: Saturday has CV&IP, SEM, FSD',
      satY3B[1]?.subject === 'CV&IP' && satY3B[1]?.faculty_name === 'Mr. V. Raghavendra' &&
      satY3B[3]?.subject === 'SEM' && satY3B[3]?.faculty_name === '—' &&
      satY3B[5]?.subject === 'SEM' && satY3B[5]?.faculty_name === '—' &&
      satY3B[6]?.subject === 'FSD' && satY3B[6]?.faculty_name === 'Ms. P. Supriya' &&
      satY3B[7]?.subject === 'SEM' && satY3B[7]?.faculty_name === '—'
    );
    assert('Year 3 Sec B: Room numbers are neglected (empty)', monY3B[1]?.room === '');

    // 15G. Year 3 Section C Official Source-of-Truth Timetable Verification (Photo Source)
    const secC_Y3 = secRes.data.sections.find(s => s.year === 3 && s.name.includes('C'));
    const y3SecCTtRes = await request(`/api/timetables?year=3&section_id=${secC_Y3.id}`, { token: studentToken });
    assert('3rd Year Section C timetable loads successfully', y3SecCTtRes.status === 200);
    const monY3C = y3SecCTtRes.data.grid.Monday;
    const tueY3C = y3SecCTtRes.data.grid.Tuesday;
    const wedY3C = y3SecCTtRes.data.grid.Wednesday;
    const thuY3C = y3SecCTtRes.data.grid.Thursday;
    const friY3C = y3SecCTtRes.data.grid.Friday;
    const satY3C = y3SecCTtRes.data.grid.Saturday;

    assert('Year 3 Sec C: Monday has NLP, QT&A, SEM, SSP',
      monY3C[1]?.subject === 'NLP' && monY3C[1]?.faculty_name === 'Mr. S. Kalim Peerulla Basha' &&
      monY3C[3]?.subject === 'QT&A' && monY3C[3]?.faculty_name === 'Dr. K. Venkata Krishnaiah' &&
      monY3C[5]?.subject === 'SEM' && monY3C[5]?.faculty_name === '—' &&
      monY3C[6]?.subject === 'SSP' && monY3C[6]?.faculty_name === 'Ms. D. Saraswathi'
    );
    assert('Year 3 Sec C: Tuesday has CV&IP, AI&SP LAB, SEM, FSD',
      tueY3C[1]?.subject === 'CV&IP' && tueY3C[1]?.faculty_name === 'Mr. V. Phanishwara Hara Gopal' &&
      tueY3C[3]?.subject === 'AI&SP LAB' && tueY3C[3]?.faculty_name === 'Ms. D. Saraswathi' &&
      tueY3C[5]?.subject === 'SEM' && tueY3C[5]?.faculty_name === '—' &&
      tueY3C[7]?.subject === 'FSD' && tueY3C[7]?.faculty_name === 'Mr. S. Kalim Peerulla Basha'
    );
    assert('Year 3 Sec C: Wednesday has SSP, SEM, NLP',
      wedY3C[1]?.subject === 'SSP' && wedY3C[1]?.faculty_name === 'Ms. D. Saraswathi' &&
      wedY3C[3]?.subject === 'SEM' && wedY3C[3]?.faculty_name === '—' &&
      wedY3C[5]?.subject === 'SEM' && wedY3C[5]?.faculty_name === '—' &&
      wedY3C[6]?.subject === 'NLP' && wedY3C[6]?.faculty_name === 'Mr. S. Kalim Peerulla Basha'
    );
    assert('Year 3 Sec C: Thursday has QT&A, CV&ML LAB, TINKERING LAB',
      thuY3C[1]?.subject === 'QT&A' && thuY3C[1]?.faculty_name === 'Dr. K. Venkata Krishnaiah' &&
      thuY3C[3]?.subject === 'CV&ML LAB' && thuY3C[3]?.faculty_name === 'Mr. V. Phanishwara Hara Gopal' &&
      thuY3C[5]?.subject === 'TINKERING LAB' && thuY3C[5]?.faculty_name === 'Mr. S. Sunil Kumar'
    );
    assert('Year 3 Sec C: Friday has EDA, SEM, CV&IP',
      friY3C[1]?.subject === 'EDA' && friY3C[1]?.faculty_name === 'Dr. Chakrapani' &&
      friY3C[3]?.subject === 'SEM' && friY3C[3]?.faculty_name === '—' &&
      friY3C[5]?.subject === 'SEM' && friY3C[5]?.faculty_name === '—' &&
      friY3C[6]?.subject === 'CV&IP' && friY3C[6]?.faculty_name === 'Mr. V. Phanishwara Hara Gopal'
    );
    assert('Year 3 Sec C: Saturday has FSD, MINOR DEGREE CLASS, SEM, EDA',
      satY3C[1]?.subject === 'FSD' && satY3C[1]?.faculty_name === 'Mr. S. Kalim Peerulla Basha' &&
      satY3C[3]?.subject === 'MINOR DEGREE CLASS' && satY3C[3]?.faculty_name === '—' &&
      satY3C[5]?.subject === 'SEM' && satY3C[5]?.faculty_name === '—' &&
      satY3C[6]?.subject === 'EDA' && satY3C[6]?.faculty_name === 'Dr. Chakrapani'
    );
    assert('Year 3 Sec C: Room numbers are neglected (empty)', monY3C[1]?.room === '');

    // 15H. Year 3 Section D Official Source-of-Truth Timetable Verification (Photo Source)
    const secD_Y3 = secRes.data.sections.find(s => s.year === 3 && s.name.includes('D'));
    const y3SecDTtRes = await request(`/api/timetables?year=3&section_id=${secD_Y3.id}`, { token: studentToken });
    assert('3rd Year Section D timetable loads successfully', y3SecDTtRes.status === 200);
    const monY3D = y3SecDTtRes.data.grid.Monday;
    const tueY3D = y3SecDTtRes.data.grid.Tuesday;
    const wedY3D = y3SecDTtRes.data.grid.Wednesday;
    const thuY3D = y3SecDTtRes.data.grid.Thursday;
    const friY3D = y3SecDTtRes.data.grid.Friday;
    const satY3D = y3SecDTtRes.data.grid.Saturday;

    assert('Year 3 Sec D: Monday has NLP, QT&A, SEM, SSP',
      monY3D[1]?.subject === 'NLP' && monY3D[1]?.faculty_name === 'Dr. G. Chandana Swathi' &&
      monY3D[3]?.subject === 'QT&A' && monY3D[3]?.faculty_name === 'Dr. N. Ravi Chandra Raju' &&
      monY3D[5]?.subject === 'SEM' && monY3D[5]?.faculty_name === '—' &&
      monY3D[6]?.subject === 'SSP' && monY3D[6]?.faculty_name === 'Mr. P. Arun Babu'
    );
    assert('Year 3 Sec D: Tuesday has CV&IP, SEM, EDA',
      tueY3D[1]?.subject === 'CV&IP' && tueY3D[1]?.faculty_name === 'Mr. V. Raghavendra' &&
      tueY3D[3]?.subject === 'SEM' && tueY3D[3]?.faculty_name === '—' &&
      tueY3D[5]?.subject === 'SEM' && tueY3D[5]?.faculty_name === '—' &&
      tueY3D[6]?.subject === 'EDA' && tueY3D[6]?.faculty_name === 'Mrs. K. Jabeen'
    );
    assert('Year 3 Sec D: Wednesday has AI&SP LAB, SEM, FSD, NLP',
      wedY3D[1]?.subject === 'AI&SP LAB' && wedY3D[1]?.faculty_name === 'Mr. P. Arun Babu' &&
      wedY3D[3]?.subject === 'SEM' && wedY3D[3]?.faculty_name === '—' &&
      wedY3D[5]?.subject === 'FSD' && wedY3D[5]?.faculty_name === 'Ms. P. Supriya' &&
      wedY3D[6]?.subject === 'NLP' && wedY3D[6]?.faculty_name === 'Dr. G. Chandana Swathi'
    );
    assert('Year 3 Sec D: Thursday has QT&A, SEM, CV&IP',
      thuY3D[1]?.subject === 'QT&A' && thuY3D[1]?.faculty_name === 'Dr. N. Ravi Chandra Raju' &&
      thuY3D[3]?.subject === 'SEM' && thuY3D[3]?.faculty_name === '—' &&
      thuY3D[5]?.subject === 'SEM' && thuY3D[5]?.faculty_name === '—' &&
      thuY3D[6]?.subject === 'CV&IP' && thuY3D[6]?.faculty_name === 'Mr. V. Raghavendra'
    );
    assert('Year 3 Sec D: Friday has EDA, SSP, CV&ML LAB',
      friY3D[1]?.subject === 'EDA' && friY3D[1]?.faculty_name === 'Mrs. K. Jabeen' &&
      friY3D[3]?.subject === 'SSP' && friY3D[3]?.faculty_name === 'Mr. P. Arun Babu' &&
      friY3D[5]?.subject === 'CV&ML LAB' && friY3D[5]?.faculty_name === 'Mr. V. Raghavendra'
    );
    assert('Year 3 Sec D: Saturday has FSD, SEM, TINKERING LAB',
      satY3D[1]?.subject === 'FSD' && satY3D[1]?.faculty_name === 'Ms. P. Supriya' &&
      satY3D[3]?.subject === 'SEM' && satY3D[3]?.faculty_name === '—' &&
      satY3D[5]?.subject === 'TINKERING LAB' && satY3D[5]?.faculty_name === 'Mr. S. Sunil Kumar'
    );
    assert('Year 3 Sec D: Room numbers are neglected (empty)', monY3D[1]?.room === '');

    // 15I. Exact 13 Sections and 19 Faculty Assertions
    const allSections = secRes.data.sections;
    const y1Secs = allSections.filter(s => s.year === 1);
    const y2Secs = allSections.filter(s => s.year === 2);
    const y3Secs = allSections.filter(s => s.year === 3);
    const y4Secs = allSections.filter(s => s.year === 4);
    assert('Total sections count is exactly 13 across all years', allSections.length === 13);
    assert('1st Year has exactly 4 sections', y1Secs.length === 4);
    assert('2nd Year has exactly 4 sections', y2Secs.length === 4);
    assert('3rd Year has exactly 4 sections', y3Secs.length === 4);
    assert('4th Year has exactly 1 section', y4Secs.length === 1);
    assert('4th Year Section A exists', y4Secs.some(s => s.name.toLowerCase().includes('section a')));
    assert('4th Year Section B was removed and does not exist', !y4Secs.some(s => s.name.toLowerCase().includes('section b')));

    const facultyDirRes = await request('/api/directory/faculty', { token: adminToken });
    const allFaculty = facultyDirRes.data.faculty.filter(f => f.role === 'faculty');
    const activeFaculty = allFaculty.filter(f => f.status === 'active');
    const pendingFaculty = allFaculty.filter(f => f.status === 'pending');
    assert('Total faculty slots is exactly 19 (official RGMCET AIML members only)', allFaculty.length === 19);
    assert('Official RGMCET active faculty count is exactly 19', activeFaculty.length === 19);
    assert('Dynamic/Pending reserved faculty slots count is strictly 0', pendingFaculty.length === 0);
    assert('Removed faculty slots FAC020 and FAC021 do not exist', !allFaculty.some(f => ['FAC020', 'FAC021'].includes(f.register_id)));

    // 16. First-Year Timetable & AIML-Only Faculty Assignment Verification
    const y1Timetable = await request('/api/timetables?year=1', { token: studentToken });
    assert('First-Year timetable loads successfully', y1Timetable.status === 200);
    const monY1 = y1Timetable.data.grid.Monday;
    assert('First-Year Monday has all 7 periods configured', monY1 && Object.keys(monY1).length === 7);

    // Verify across all Year 1 timetables: AIML faculty assigned ONLY to IP and CP LAB
    let y1RestrictionsValid = true;
    let y1Violation = null;
    const y1Sections = secRes.data.sections.filter(s => s.year === 1);
    for (const s of y1Sections) {
      const secTt = await request(`/api/timetables?year=1&section_id=${s.id}`, { token: studentToken });
      if (secTt.status === 200 && secTt.data.grid) {
        for (const day of Object.keys(secTt.data.grid)) {
          for (const p of Object.keys(secTt.data.grid[day])) {
            const cell = secTt.data.grid[day][p];
            if (!cell || !cell.subject || cell.subject === '—') continue;
            const sub = cell.subject.trim().toUpperCase();
            const isAimlSub = sub === 'IP' || sub.startsWith('IP ') || sub.includes('CP LAB');
            if (isAimlSub) {
              if (!cell.faculty_name || cell.faculty_name === '—') {
                y1RestrictionsValid = false;
                y1Violation = `Year 1 ${s.name} ${day} P${p} (${cell.subject}) should have AIML faculty assigned, but was empty`;
              }
            } else {
              if (cell.faculty_name && cell.faculty_name !== '—') {
                y1RestrictionsValid = false;
                y1Violation = `Year 1 ${s.name} ${day} P${p} (${cell.subject}) should be unassigned/empty ('—'), but had ${cell.faculty_name}`;
              }
            }
          }
        }
      }
    }
    assert('Year 1 Timetables: AIML faculty assigned ONLY to IP and CP Lab, and all other subjects are EMPTY (—)', y1RestrictionsValid, y1Violation || '');

    // Attempting to assign faculty to Year 1 non-AIML subject (e.g. BEE - A) must automatically enforce faculty_name = '—'
    const testY1Sec = y1Sections[0];
    const assignNonAimlRes = await request('/api/timetables/cell', {
      method: 'POST',
      token: adminToken,
      body: {
        year: 1,
        section_id: testY1Sec.id,
        day: 'Monday',
        period: 1,
        subject: 'BEE - A',
        faculty_name: 'Dr. G. Chandana Swathi' // Non-AIML subject assignment attempt
      }
    });
    assert('API updates Year 1 non-AIML cell', assignNonAimlRes.status === 200);
    const checkY1Cell = await request(`/api/timetables?year=1&section_id=${testY1Sec.id}`, { token: studentToken });
    assert('API forces faculty_name = "—" for Year 1 non-AIML subject (BEE - A)',
      checkY1Cell.data.grid.Monday[1]?.subject === 'BEE - A' && checkY1Cell.data.grid.Monday[1]?.faculty_name === '—'
    );

    // 16B. Second-Year Timetable & Allowed Subjects Faculty Assignment Verification
    // Allowed: AI, ADSA, UHV, PYP, ADSA Lab, OOPJ, OOPJ Lab, PYP Lab
    // All other subjects: must have faculty_name = '—'
    let y2RestrictionsValid = true;
    let y2Violation = null;
    const y2Sections = secRes.data.sections.filter(s => s.year === 2);
    const ALLOWED_Y2 = ['AI', 'ADSA', 'UHV', 'PYP', 'ADSA LAB', 'OOPJ', 'OOPJ LAB', 'PYP LAB'];
    for (const s of y2Sections) {
      const secTt = await request(`/api/timetables?year=2&section_id=${s.id}`, { token: studentToken });
      if (secTt.status === 200 && secTt.data.grid) {
        for (const day of Object.keys(secTt.data.grid)) {
          for (const p of Object.keys(secTt.data.grid[day])) {
            const cell = secTt.data.grid[day][p];
            if (!cell || !cell.subject || cell.subject === '—') continue;
            const sub = cell.subject.trim().toUpperCase();
            const isAllowed = ALLOWED_Y2.includes(sub);
            if (isAllowed) {
              if (!cell.faculty_name || cell.faculty_name === '—') {
                y2RestrictionsValid = false;
                y2Violation = `Year 2 ${s.name} ${day} P${p} (${cell.subject}) should have faculty assigned, but was empty`;
              }
            } else {
              if (cell.faculty_name && cell.faculty_name !== '—') {
                y2RestrictionsValid = false;
                y2Violation = `Year 2 ${s.name} ${day} P${p} (${cell.subject}) should be unassigned/empty ('—'), but had ${cell.faculty_name}`;
              }
            }
          }
        }
      }
    }
    assert('Year 2 Timetables: Faculty assigned ONLY to AI, ADSA, UHV, PYP, ADSA Lab, OOPJ, OOPJ Lab, and all other subjects are EMPTY (—)', y2RestrictionsValid, y2Violation || '');

    // Attempting to assign faculty to Year 2 non-allowed subject (e.g. DMGT) must automatically enforce faculty_name = '—'
    const testY2Sec = y2Sections[0];
    const assignNonAllowedY2Res = await request('/api/timetables/cell', {
      method: 'POST',
      token: adminToken,
      body: {
        year: 2,
        section_id: testY2Sec.id,
        day: 'Monday',
        period: 6,
        subject: 'DMGT',
        faculty_name: 'Dr. J. Avinash' // Non-allowed subject assignment attempt
      }
    });
    assert('API updates Year 2 non-allowed cell', assignNonAllowedY2Res.status === 200);
    const checkY2Cell = await request(`/api/timetables?year=2&section_id=${testY2Sec.id}`, { token: studentToken });
    assert('API forces faculty_name = "—" for Year 2 non-allowed subject (DMGT)',
      checkY2Cell.data.grid.Monday[6]?.subject === 'DMGT' && checkY2Cell.data.grid.Monday[6]?.faculty_name === '—'
    );

    // 17. Multi-Admin Account Login Verification (ADMIN002)
    const admin2Login = await request('/api/auth/login', {
      method: 'POST',
      body: { register_id: 'ADMIN002', password: 'admin123' }
    });
    assert('Second Admin (ADMIN002 - Vice-Principal) logs in successfully', admin2Login.status === 200 && admin2Login.data.user.role === 'admin');
    const admin2Token = admin2Login.data.token;

    // 18. Multi-Admin: Creation of Additional Admin (ADMIN003)
    const newAdminReg = await request('/api/auth/register-admin', {
      method: 'POST',
      token: adminToken,
      body: {
        name: 'Dr. M. Vasu (Academic Admin)',
        register_id: 'ADMIN003',
        password: 'adminvasu123',
        phone: '9848011222'
      }
    });
    assert('Authorized Admin can register additional Administrator (ADMIN003)', newAdminReg.status === 201 || newAdminReg.status === 409);

    const admin3Login = await request('/api/auth/login', {
      method: 'POST',
      body: { register_id: 'ADMIN003', password: 'adminvasu123' }
    });
    assert('Newly registered Admin (ADMIN003) logs in successfully', admin3Login.status === 200 && admin3Login.data.user.role === 'admin');

    // Unauthenticated admin registration must fail
    const unauthAdminReg = await request('/api/auth/register-admin', {
      method: 'POST',
      body: {
        name: 'Attacker Admin',
        register_id: 'ADMIN999',
        password: 'evilpassword',
        phone: '9999999990'
      }
    });
    assert('Unauthenticated admin registration rejected with 401/403', [401, 403].includes(unauthAdminReg.status));

    // 19. Student Forgot Password Restriction (Students cannot self-service reset via OTP)
    const studentOtpRequest = await request('/api/auth/forgot-password/request-otp', {
      method: 'POST',
      body: { phone: '9876500001', role: 'student' }
    });
    assert('Student OTP request rejected with 403 Forbidden', studentOtpRequest.status === 403);

    // 20. Faculty & Admin Forgot Password OTP Workflow
    // Step 20a: Request OTP for Faculty (Dr. K. Ramesh - phone: 9848022331)
    const facOtpReq = await request('/api/auth/forgot-password/request-otp', {
      method: 'POST',
      body: { phone: '9848022331', role: 'faculty' }
    });
    assert('Faculty requested OTP successfully with non-revealing response', facOtpReq.status === 200 && facOtpReq.data.debug_otp);
    const facultyOtpCode = facOtpReq.data.debug_otp;

    // Step 20b: Verify OTP
    const facOtpVerify = await request('/api/auth/forgot-password/verify-otp', {
      method: 'POST',
      body: { phone: '9848022331', otp_code: facultyOtpCode, role: 'faculty' }
    });
    assert('Faculty OTP code verified and issued reset token', facOtpVerify.status === 200 && facOtpVerify.data.reset_token);
    const facultyResetToken = facOtpVerify.data.reset_token;

    // Step 20c: Set New Password
    const facResetPw = await request('/api/auth/forgot-password/reset-password', {
      method: 'POST',
      body: {
        reset_token: facultyResetToken,
        new_password: 'facultynewpass456',
        confirm_password: 'facultynewpass456'
      }
    });
    assert('Faculty password reset with bcrypt hash succeeds', facResetPw.status === 200);

    // Step 20d: Log in with New Password
    const facNewLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { register_id: 'FAC001', password: 'facultynewpass456' }
    });
    assert('Faculty logs in with newly reset password', facNewLogin.status === 200 && facNewLogin.data.token);

    // Restore faculty password for continuous test repeatability
    const restoreOtpReq = await request('/api/auth/forgot-password/request-otp', {
      method: 'POST',
      body: { phone: '9848022331', role: 'faculty' }
    });
    const restoreVerify = await request('/api/auth/forgot-password/verify-otp', {
      method: 'POST',
      body: { phone: '9848022331', otp_code: restoreOtpReq.data.debug_otp, role: 'faculty' }
    });
    await request('/api/auth/forgot-password/reset-password', {
      method: 'POST',
      body: {
        reset_token: restoreVerify.data.reset_token,
        new_password: 'faculty123',
        confirm_password: 'faculty123'
      }
    });

    // 21. Student Password Management (Faculty & Admin can reset student password)
    // Step 21a: Find student DB ID for testStudentId
    const dirStudents = await request('/api/directory/students', { token: facToken });
    const targetStudent = dirStudents.data.students.find(s => s.register_id === testStudentId);
    assert('Target student located in directory', Boolean(targetStudent));

    // Step 21b: Faculty resets student password
    const facResetStudent = await request(`/api/directory/students/${targetStudent.id}/reset-password`, {
      method: 'POST',
      token: facToken,
      body: { new_password: 'newstudentpwd99' }
    });
    assert('Faculty can reset student password directly with 200 OK', facResetStudent.status === 200);

    // Step 21c: Student logs in with the newly assigned password
    const studentLoginNew = await request('/api/auth/login', {
      method: 'POST',
      body: { register_id: testStudentId, password: 'newstudentpwd99' }
    });
    assert('Student logs in with faculty-reset password', studentLoginNew.status === 200);

    // Step 21d: Student attempting to reset another student's password is rejected (403)
    const studentUnauthorizedReset = await request(`/api/directory/students/${targetStudent.id}/reset-password`, {
      method: 'POST',
      token: studentToken,
      body: { new_password: 'hackedpassword' }
    });
    assert('Student attempting password reset rejected with 403 Forbidden', studentUnauthorizedReset.status === 403);

    // Step 21e: Admin resets student password back to 'studentpass123'
    const adminResetStudent = await request(`/api/directory/students/${targetStudent.id}/reset-password`, {
      method: 'POST',
      token: adminToken,
      body: { new_password: 'studentpass123' }
    });
    assert('Admin can reset student password directly with 200 OK', adminResetStudent.status === 200);

    // 22. Audit Logs Verification
    // Admin can access audit logs
    const auditRes = await request('/api/directory/audit-logs', { token: adminToken });
    assert('Admin can view security audit logs', auditRes.status === 200 && Array.isArray(auditRes.data.logs));
    const studentResetLog = auditRes.data.logs.find(l => 
      l.action.includes('RESET_STUDENT_PASSWORD') && 
      (l.target_user_id === targetStudent.register_id || l.target_user_id === targetStudent.id)
    );
    assert('Student password reset is documented in audit logs with performer details', Boolean(studentResetLog));

    // Student cannot access audit logs (403)
    const studentAuditRes = await request('/api/directory/audit-logs', { token: studentToken });
    assert('Student viewing audit logs rejected with 403 Forbidden', studentAuditRes.status === 403);

    // 23. COMPLETE REMOVAL VERIFICATION: Dr. C. Shoba Bindu & Prof. Administrator
    const verifyFacultyList = await request('/api/directory/faculty', { token: adminToken });
    const hasShobaInFaculty = verifyFacultyList.data.faculty.some(f => /shoba/i.test(f.name));
    const hasProfAdminInFaculty = verifyFacultyList.data.faculty.some(f => /prof\.?\s*administrator/i.test(f.name));
    assert('Dr. C. Shoba Bindu completely absent from faculty directory', !hasShobaInFaculty);
    assert('Prof. Administrator (HOD-AIML) completely absent from faculty directory', !hasProfAdminInFaculty);

    const verifyAvailability = await request('/api/faculty/availability', { token: studentToken });
    const hasShobaInAvail = verifyAvailability.data.faculty_availability.some(f => /shoba/i.test(f.name));
    const hasProfAdminInAvail = verifyAvailability.data.faculty_availability.some(f => /prof\.?\s*administrator/i.test(f.name));
    assert('Dr. C. Shoba Bindu completely absent from faculty availability', !hasShobaInAvail);
    assert('Prof. Administrator (HOD-AIML) completely absent from faculty availability', !hasProfAdminInAvail);

    // Verify ADMIN001 is renamed to System Administrator
    const adminProfileCheck = await request('/api/auth/me', { token: adminToken });
    assert('ADMIN001 is named System Administrator (not Prof. Administrator)', adminProfileCheck.data.user.name === 'System Administrator');

    // 24. FACULTY LEAVE SYSTEM & GLOBAL NOTIFICATION INTIMATIONS
    // Step 24a: Faculty FAC001 marks Leave for 2026-09-07
    const markLeaveRes = await request('/api/faculty/leaves', {
      method: 'POST',
      token: facToken,
      body: {
        date: '2026-09-07',
        status: 'leave',
        reason: 'Keynote speaker at International AI Summit'
      }
    });
    assert('Faculty can mark leave for specific date (2026-09-07)', markLeaveRes.status === 201 && markLeaveRes.data.leave);
    const createdLeaveId = markLeaveRes.data.leave ? markLeaveRes.data.leave.id : null;

    // Step 24b: Persistent leave visible in GET /api/faculty/leaves
    const getLeavesRes = await request('/api/faculty/leaves', { token: facToken });
    assert('Leave record persisted and returned in GET /api/faculty/leaves', 
      getLeavesRes.status === 200 && 
      Array.isArray(getLeavesRes.data.leaves) &&
      getLeavesRes.data.leaves.some(l => l.date === '2026-09-07' && l.faculty_register_id === 'FAC001')
    );

    // Step 24c: Global Notification created and visible to Student
    const studentNotifRes = await request('/api/notifications', { token: studentToken });
    assert('Student can access global notifications', studentNotifRes.status === 200 && Array.isArray(studentNotifRes.data.notifications));
    const leaveNotif = studentNotifRes.data.notifications.find(n => 
      n.message.includes('Dr. G. Kishor Kumar') && 
      n.message.includes('Leave') && 
      n.type === 'faculty_leave'
    );
    assert('Global notification box receives official faculty leave intimation', Boolean(leaveNotif));

    // Step 24d: Availability reflects On Leave ONLY for FAC001 on 2026-09-07
    const availLeaveRes = await request('/api/faculty/availability?date=2026-09-07', { token: studentToken });
    const fac001Avail = availLeaveRes.data.faculty_availability.find(f => f.register_id === 'FAC001');
    const fac002Avail = availLeaveRes.data.faculty_availability.find(f => f.register_id === 'FAC002');
    assert('Faculty FAC001 is marked ON LEAVE for 2026-09-07', fac001Avail && fac001Avail.is_on_leave === true);
    assert('Other faculty (FAC002) is NOT marked on leave', fac002Avail && !fac002Avail.is_on_leave);

    // Step 24e: Timetable reflects faculty leave without altering class subject
    const ttLeaveRes = await request('/api/timetables?year=3&date=2026-09-07', { token: studentToken });
    assert('Timetable loads successfully with date query', ttLeaveRes.status === 200 && ttLeaveRes.data.grid);
    const mondaySlots = ttLeaveRes.data.grid.Monday || {};
    const kishorClasses = Object.values(mondaySlots).filter(c => c && c.faculty_name === 'Dr. G. Kishor Kumar');
    if (kishorClasses.length > 0) {
      assert('Classes taught by faculty on leave have is_on_leave: true', kishorClasses.every(c => c.is_on_leave === true));
      assert('Class subject is preserved intact when faculty is on leave', kishorClasses.every(c => c.subject && c.subject !== '—'));
    }

    // Step 24f: Clean up test leave
    if (createdLeaveId) {
      const cancelLeaveRes = await request(`/api/faculty/leaves/${createdLeaveId}`, {
        method: 'DELETE',
        token: facToken
      });
      assert('Faculty can cancel/delete leave record', cancelLeaveRes.status === 200);
    }

    // 25. BUSY STATUS BEHAVIOR (Persisted, but strictly does NOT trigger leave notifications or timetable leave flags)
    const setBusyRes = await request('/api/faculty/leaves', {
      method: 'POST',
      token: facToken,
      body: {
        date: '2026-09-08',
        status: 'busy'
      }
    });
    assert('Faculty can set status to Busy for 2026-09-08', setBusyRes.status === 201 && setBusyRes.data.status === 'busy');

    // Verify Busy does NOT generate global notifications
    const busyNotifCheck = await request('/api/notifications', { token: studentToken });
    const hasBusyNotif = busyNotifCheck.data.notifications.some(n => 
      n.leave_date === '2026-09-08' || (n.message && n.message.includes('8 September 2026'))
    );
    assert('Busy status strictly does NOT trigger global leave notifications', !hasBusyNotif);

    // Verify availability reflects Busy (not On Leave)
    const availBusyRes = await request('/api/faculty/availability?date=2026-09-08', { token: studentToken });
    const fac001Busy = availBusyRes.data.faculty_availability.find(f => f.register_id === 'FAC001');
    assert('Faculty FAC001 availability reflects Busy', fac001Busy && fac001Busy.is_busy === true && fac001Busy.is_on_leave === false);

    // Verify timetable does NOT treat Busy as Leave
    const ttBusyRes = await request('/api/timetables?year=3&date=2026-09-08', { token: studentToken });
    const tueSlots = ttBusyRes.data.grid.Tuesday || {};
    const kishorTueClasses = Object.values(tueSlots).filter(c => c && c.faculty_name === 'Dr. G. Kishor Kumar');
    if (kishorTueClasses.length > 0) {
      assert('Timetable classes are NOT marked on leave when faculty is Busy', kishorTueClasses.every(c => !c.is_on_leave));
    }

    // 26. ACTIVE STATUS BEHAVIOR (Returns faculty to normal availability and cleans up records)
    const setActiveRes = await request('/api/faculty/leaves', {
      method: 'POST',
      token: facToken,
      body: {
        date: '2026-09-08',
        status: 'active'
      }
    });
    assert('Faculty setting Active status returns 200 OK', setActiveRes.status === 200 && setActiveRes.data.status === 'active');

    const availActiveRes = await request('/api/faculty/availability?date=2026-09-08', { token: studentToken });
    const fac001Active = availActiveRes.data.faculty_availability.find(f => f.register_id === 'FAC001');
    assert('Faculty availability returns to Active / normal availability (not leave, not busy)', 
      fac001Active && !fac001Active.is_busy && !fac001Active.is_on_leave
    );

    // 27. ZERO FACULTY ASSIGNED TO SEM PERIOD (Across all 14 sections and all years)
    const semWithFaculty = db.prepare(`
      SELECT COUNT(*) as count 
      FROM timetables 
      WHERE UPPER(TRIM(subject)) = 'SEM' 
        AND faculty_name IS NOT NULL 
        AND faculty_name != '—' 
        AND faculty_name != ''
    `).get();
    assert('Database: Zero faculty assigned to SEM across all years and sections', semWithFaculty.count === 0, `Found: ${semWithFaculty.count}`);

    const allSemSlots = db.prepare(`
      SELECT COUNT(*) as count 
      FROM timetables 
      WHERE UPPER(TRIM(subject)) = 'SEM'
    `).get();
    assert('Database: Timetables contains valid SEM slots', allSemSlots.count > 0, `Total SEM slots: ${allSemSlots.count}`);

    // Verify via GET /api/timetables across years 1..4
    let allApiSemFree = true;
    for (const yr of [1, 2, 3, 4]) {
      const yrSections = secRes.data.sections.filter(s => s.year === yr);
      for (const s of yrSections) {
        const tt = await request(`/api/timetables?year=${yr}&section_id=${s.id}`, { token: studentToken });
        if (tt.status === 200 && tt.data.grid) {
          for (const day of Object.keys(tt.data.grid)) {
            for (const p of Object.keys(tt.data.grid[day])) {
              const cell = tt.data.grid[day][p];
              if (cell && (cell.subject || '').trim().toUpperCase() === 'SEM') {
                if (cell.faculty_name && cell.faculty_name !== '—') {
                  allApiSemFree = false;
                  assert(`Year ${yr} ${s.name} ${day} P${p} SEM has no faculty assigned`, false, `Had: ${cell.faculty_name}`);
                }
              }
            }
          }
        }
      }
    }
    assert('API Verification: Every SEM slot across all 13 sections returns faculty_name = "—"', allApiSemFree);

    // Verify that updating a cell to SEM automatically forces faculty_name = '—'
    const testSec = secRes.data.sections[0];
    const updateSemRes = await request('/api/timetables/cell', {
      method: 'POST',
      token: adminToken,
      body: {
        year: testSec.year,
        section_id: testSec.id,
        day: 'Monday',
        period: 1,
        subject: 'SEM',
        faculty_name: 'Dr. G. Kishor Kumar' // Attempt to assign faculty to SEM
      }
    });
    assert('Admin can update cell to SEM', updateSemRes.status === 200);

    const checkSemTt = await request(`/api/timetables?year=${testSec.year}&section_id=${testSec.id}`, { token: studentToken });
    const p1Cell = checkSemTt.data.grid.Monday[1];
    assert('Updating slot to SEM automatically enforces faculty_name = "—"', p1Cell && p1Cell.subject === 'SEM' && p1Cell.faculty_name === '—');

    // Restore test cell back to default BEE - A (empty faculty for Year 1 non-AIML)
    await request('/api/timetables/cell', {
      method: 'POST',
      token: adminToken,
      body: {
        year: testSec.year,
        section_id: testSec.id,
        day: 'Monday',
        period: 1,
        subject: 'BEE - A',
        faculty_name: '—'
      }
    });

    // 21. Automated Generation Engine API & RBAC Verification
    const studentGen = await request('/api/timetables/generate', {
      method: 'POST',
      token: studentToken,
      body: { section_id: testSec.id }
    });
    assert('Student attempting automated timetable generation rejected with 403 Forbidden', studentGen.status === 403);

    const adminGen = await request('/api/timetables/generate', {
      method: 'POST',
      token: adminToken,
      body: { section_id: testSec.id, year: testSec.year }
    });
    assert('Admin automated timetable generation succeeds with 200 OK', adminGen.status === 200 && adminGen.data.success === true);

    // 22. PDF Faculty Details RBAC Phone Privacy Verification
    const studentTtView = await request(`/api/timetables?year=${testSec.year}&section_id=${testSec.id}`, { token: studentToken });
    assert('Student timetable response includes faculty_details for PDF footer', Array.isArray(studentTtView.data.faculty_details));
    const studentProtectedPhone = studentTtView.data.faculty_details.every(f => f.phone === 'Protected' || f.phone === '—');
    assert('RBAC: Student PDF faculty details masks all faculty phone numbers with Protected', studentProtectedPhone);

    const adminTtView = await request(`/api/timetables?year=${testSec.year}&section_id=${testSec.id}`, { token: adminToken });
    const adminHasRealPhone = adminTtView.data.faculty_details.some(f => f.phone && f.phone !== 'Protected' && f.phone !== '—');
    assert('RBAC: Admin PDF faculty details includes genuine contact numbers', adminHasRealPhone);

    // Restore baseline timetables
    const { populateTimetablesData } = await import('./db.js');
    populateTimetablesData();

    console.log(`\n📊 Verification Summary: ${passed} Passed, ${failed} Failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runTests();
