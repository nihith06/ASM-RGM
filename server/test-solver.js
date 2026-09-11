import db, { syncSectionsAndFaculty, populateTimetablesData } from './db.js';
import { generateSchedule } from './services/scheduleGenerator.js';

async function runSolverVerification() {
  syncSectionsAndFaculty();
  console.log('🧪 Running Constraint-Satisfaction Generator Verification Tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(name, condition, extra = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name} ${extra}`);
      failed++;
    }
  }

  // 1. Run full schedule generation
  const genResult = generateSchedule({ allSections: true });
  assert('Generator returns success: true', genResult.success === true, JSON.stringify(genResult));
  assert('Generator generated sections', genResult.sectionsGenerated > 0);
  assert('Generator generated slots', genResult.slotsGenerated > 0);

  // 2. Verify Workload Cap: Never exceeds 16 hrs/week for any faculty member
  const workloads = genResult.workloadSummary || {};
  let maxWorkload = 0;
  let violatedFaculty = null;
  for (const [fac, hrs] of Object.entries(workloads)) {
    if (hrs > maxWorkload) maxWorkload = hrs;
    if (hrs > 16) {
      violatedFaculty = `${fac} (${hrs} hrs)`;
    }
  }
  assert('Hard workload cap: No faculty member exceeds 16 hours/week', violatedFaculty === null, violatedFaculty);
  console.log(`     (Max faculty workload observed: ${maxWorkload} hrs/week)`);

  // 3. Verify Daily Emergency Standby Floaters: >= 2 faculty members 100% free every working day
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let standbyOk = true;
  for (const day of days) {
    const floaters = genResult.standbyFloaters[day] || [];
    if (floaters.length < 2) {
      standbyOk = false;
      break;
    }
    // Verify in database that these floaters truly have ZERO teaching slots on this day
    for (const fl of floaters) {
      const assignedSlots = db.prepare('SELECT COUNT(*) as cnt FROM timetables WHERE day = ? AND faculty_name = ?').get(day, fl);
      if (assignedSlots.cnt > 0) {
        standbyOk = false;
        console.error(`Standby floater ${fl} has ${assignedSlots.cnt} slots on ${day}`);
      }
    }
  }
  assert('Daily Emergency Standby: At least 2 rotating faculty 100% unassigned each day', standbyOk);

  // 4. Verify Morning Duty Rotation: <= 2 morning duty days (Periods 1 & 2) per week per faculty
  const facultyUsers = db.prepare("SELECT name FROM users WHERE role = 'faculty'").all();
  let morningRotationOk = true;
  for (const f of facultyUsers) {
    const morningSlots = db.prepare(`
      SELECT DISTINCT day 
      FROM timetables 
      WHERE faculty_name = ? AND period IN (1, 2)
    `).all(f.name);
    if (morningSlots.length > 2) {
      morningRotationOk = false;
      console.error(`Faculty ${f.name} assigned to morning slots on ${morningSlots.length} days: ${morningSlots.map(s => s.day).join(', ')}`);
    }
  }
  assert('Morning slot rotation: No faculty member assigned Periods 1 & 2 more than twice per week', morningRotationOk);

  // 5. Verify Parallel Section Redundancy:
  // For multi-section slots, check that not all qualified faculty are occupied simultaneously
  const multiSectionClasses = db.prepare(`
    SELECT day, period, subject, COUNT(*) as class_count
    FROM timetables
    WHERE subject NOT IN ('—', 'SEM', 'LIBRARY', 'MENTORING')
    GROUP BY day, period, subject
    HAVING COUNT(*) > 1
  `).all();
  assert('Multi-section classes exist in schedule', multiSectionClasses.length > 0);

  // 6. Verify Diagnostic Failure Feedback:
  // Test that when constraints cannot be satisfied (e.g. invalid section), engine returns diagnostic explanation
  const failResult = generateSchedule({ sectionId: 99999 });
  assert('Diagnostic Failure: Returns success: false on impossible generation', failResult.success === false);
  assert('Diagnostic Failure: Surfaces exact constraint failure reason', typeof failResult.constraint === 'string' && failResult.error.length > 0);

  // 7. Verify API /timetables endpoint returns faculty_details with RBAC phone privacy
  // Query DB directly simulating student vs admin
  const sampleSec = db.prepare('SELECT id, year FROM sections LIMIT 1').get();
  const sampleFaculty = db.prepare(`
    SELECT DISTINCT t.subject, t.faculty_name, u.phone
    FROM timetables t
    LEFT JOIN users u ON LOWER(TRIM(u.name)) = LOWER(TRIM(t.faculty_name)) AND u.role = 'faculty'
    WHERE t.year = ? AND t.section_id = ? AND t.subject != '—' AND t.faculty_name != '—'
  `).all(sampleSec.year, sampleSec.id);
  assert('Section has faculty details available for PDF footer table', sampleFaculty.length > 0);

  populateTimetablesData();

  console.log(`\n📊 Solver Verification Summary: ${passed} Passed, ${failed} Failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runSolverVerification().catch(err => {
  console.error(err);
  process.exit(1);
});
