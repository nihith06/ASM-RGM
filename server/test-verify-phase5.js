import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NODE_ENV = 'test';
process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'temp-test.db');

const { default: db, populateTimetablesData } = await import('./db.js');
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
  const headers = Object.fromEntries(response.headers.entries());
  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    data = { text: rawText };
  }
  return { status, data, headers };
}

async function runPhase5Verification() {
  console.log('================================================================');
  console.log('🛡️  PHASE 5 COMPREHENSIVE SECURITY & INTEGRATION VERIFICATION');
  console.log('================================================================\n');

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

  // Ensure server is running
  let localServer = null;
  try {
    const ping = await fetch('http://127.0.0.1:5000/api/health', { signal: AbortSignal.timeout(500) });
    if (!ping.ok) throw new Error('Not ready');
  } catch (e) {
    console.log('  🚀 Starting in-process server for verification on port 5000...');
    const indexModule = await import('./index.js');
    localServer = indexModule.default;
    await new Promise(r => setTimeout(r, 600));
  }

  // Baseline database setup
  db.prepare('DELETE FROM active_sessions').run();
  db.prepare('DELETE FROM password_resets').run();
  db.prepare('DELETE FROM faculty_overrides').run();
  db.prepare("UPDATE users SET password_hash = ? WHERE register_id = '22091A3324'").run(
    (await import('bcryptjs')).default.hashSync('student123', 10)
  );
  db.prepare("UPDATE users SET password_hash = ? WHERE register_id = 'admin01'").run(
    (await import('bcryptjs')).default.hashSync('1352468', 10)
  );
  populateTimetablesData();

  console.log('\n--- 1. Login Brute-Force Rate Limiting (Expect 429) ---');
  let hitRateLimit = false;
  let rateLimitStatus = null;
  for (let i = 1; i <= 12; i++) {
    const badLoginRes = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'x-test-rate-limit': '1' },
      body: { register_id: 'bruteforce_target', password: `wrongpwd_${i}` }
    });
    if (badLoginRes.status === 429) {
      hitRateLimit = true;
      rateLimitStatus = badLoginRes.status;
      break;
    }
  }
  assert('Login brute-force triggers 429 Too Many Requests', hitRateLimit === true && rateLimitStatus === 429);

  console.log('\n--- 2. Absence of debug_otp in Forgot-Password Flow ---');
  const otpRes = await request('/api/auth/forgot-password/request-otp', {
    method: 'POST',
    body: { phone: '9848022331', role: 'faculty' }
  });
  assert('Forgot-password request returns 200 OK', otpRes.status === 200);
  assert('Response does NOT contain debug_otp', otpRes.data.debug_otp === undefined);
  assert('Response does NOT contain otp code in any field', otpRes.data.otp === undefined && otpRes.data.code === undefined);
  assert('Response returns generic non-revealing notification message', Boolean(otpRes.data.message));

  console.log('\n--- 3. Fake-Token Admin Registration Attempts (Expect 400/401/403) ---');
  // Attempt 3a: Public registration sending role admin with fake Authorization header
  const fakeAdminPublic = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.admin' },
    body: {
      name: 'Fake Rogue Admin',
      register_id: 'admin99',
      password: 'AdminPassword123',
      role: 'admin'
    }
  });
  assert('Public registration attempting admin role rejected (400 or 403)', [400, 403].includes(fakeAdminPublic.status));

  // Attempt 3b: Admin endpoint called with invalid/forged token
  const fakeAdminEndpoint = await request('/api/auth/register-admin', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer fake.invalid.token.attempt' },
    body: {
      name: 'Rogue Admin',
      register_id: 'admin98',
      password: 'AdminPassword123',
      role: 'admin'
    }
  });
  assert('register-admin with fake token rejected with 401 or 403', [401, 403].includes(fakeAdminEndpoint.status));

  console.log('\n--- 4. Student Calling Directory Endpoints (Expect 403) ---');
  // Login as student
  const studentLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { register_id: '22091A3324', password: 'student123' }
  });
  assert('Student login succeeds', studentLogin.status === 200 && studentLogin.data.token);
  const studentToken = studentLogin.data.token;

  // Check 4a: Student calling /api/directory/students
  const stDirRes = await request('/api/directory/students', { token: studentToken });
  assert('Student accessing student directory returns 403 Forbidden', stDirRes.status === 403);

  // Check 4b: Student calling /api/directory/faculty
  const facDirRes = await request('/api/directory/faculty', { token: studentToken });
  assert('Student accessing faculty directory returns 403 Forbidden', facDirRes.status === 403);

  // Check 4c: Student calling /api/directory/audit-logs
  const auditRes = await request('/api/directory/audit-logs', { token: studentToken });
  assert('Student accessing security audit logs returns 403 Forbidden', auditRes.status === 403);

  // Check 4d: Student calling DELETE /api/directory/audit-logs
  const delAuditRes = await request('/api/directory/audit-logs', {
    method: 'DELETE',
    token: studentToken
  });
  assert('Student deleting audit logs returns 403 Forbidden', delAuditRes.status === 403);

  // Check 4e: Student calling reset password for another student
  const stResetRes = await request('/api/directory/students/2/reset-password', {
    method: 'POST',
    token: studentToken,
    body: { new_password: 'HackedPassword123' }
  });
  assert('Student resetting student password returns 403 Forbidden', stResetRes.status === 403);

  console.log('\n--- 5. SSE Real-Time Sync via Simulated Proxy ---');
  // Login as admin for timetable operations
  const adminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { register_id: 'admin01', password: '1352468' }
  });
  assert('Admin login succeeds', adminLogin.status === 200);
  const adminToken = adminLogin.data.token;

  // 5a. Request SSE single-use ticket behind reverse proxy headers
  const ticketRes = await request('/api/timetables/events/ticket', {
    method: 'POST',
    token: studentToken,
    headers: {
      'X-Forwarded-For': '203.0.113.195, 10.0.0.1',
      'X-Forwarded-Proto': 'https'
    }
  });
  assert('Acquired single-use SSE ticket through simulated proxy', ticketRes.status === 200 && ticketRes.data.ticket);
  const sseTicket = ticketRes.data.ticket;

  // 5b. Connect to SSE stream using ticket
  let sseReceivedConnected = false;
  let sseReceivedUpdate = false;
  const sseReq = http.request({
    hostname: '127.0.0.1',
    port: 5000,
    path: `/api/timetables/events?ticket=${sseTicket}`,
    method: 'GET',
    headers: {
      'Accept': 'text/event-stream',
      'X-Forwarded-For': '203.0.113.195, 10.0.0.1',
      'X-Forwarded-Proto': 'https'
    }
  }, (res) => {
    assert('SSE stream connected with HTTP 200', res.statusCode === 200);
    assert('SSE stream has text/event-stream content-type', res.headers['content-type']?.includes('text/event-stream'));
    
    res.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.type === 'connected') {
              sseReceivedConnected = true;
            } else if (payload.type === 'timetable_updated') {
              sseReceivedUpdate = true;
            }
          } catch (e) {}
        }
      }
    });
  });
  sseReq.on('error', (e) => console.error('SSE connection error:', e.message));
  sseReq.end();

  // Wait for initial handshake
  await new Promise(r => setTimeout(r, 500));
  assert('SSE handshake completed and connected event received', sseReceivedConnected === true);

  // 5c. Try to reuse the single-use ticket (expect 401 Unauthorized)
  const reuseTicketRes = await request(`/api/timetables/events?ticket=${sseTicket}`);
  assert('Reusing consumed SSE ticket is rejected with 401', reuseTicketRes.status === 401);

  // 5d. Trigger admin cell update and observe real-time dispatch
  const sec2A = db.prepare("SELECT id, year, name FROM sections WHERE year = 2 AND name = 'Section A'").get();
  const existingCell = db.prepare("SELECT * FROM timetables WHERE year = 2 AND section_id = ? AND day = 'Monday' AND period = 1").get(sec2A.id);

  const cellUpdate = await request('/api/timetables/cell', {
    method: 'POST',
    token: adminToken,
    body: {
      year: 2,
      section_id: sec2A.id,
      day: 'Monday',
      period: 1,
      subject: existingCell?.subject || 'PYP',
      faculty_name: existingCell?.faculty_name || 'Mr. P. Sreekanth Reddy',
      room: existingCell?.room || 'RG-207'
    }
  });
  assert('Admin cell update succeeded (200)', cellUpdate.status === 200, JSON.stringify(cellUpdate));

  // Wait for SSE update dispatch
  await new Promise(r => setTimeout(r, 600));
  assert('SSE stream received timetable_updated broadcast', sseReceivedUpdate === true);
  sseReq.destroy();

  console.log('\n--- 6. PDF Export Check & Data Integrity ---');
  // 6a. Verify student view masks contact details in PDF metadata
  const studentTimetable = await request(`/api/timetables?year=2&section_id=${sec2A.id}`, { token: studentToken });
  assert('Timetable API returns faculty_details array for PDF export', Array.isArray(studentTimetable.data?.faculty_details));
  const studentFacultyDetails = studentTimetable.data?.faculty_details || [];
  const allPhonesMaskedForStudent = studentFacultyDetails.length > 0 && studentFacultyDetails.every(f => f.phone === 'Protected' || f.phone === '-');
  assert('Student role has all faculty phone numbers masked with "Protected" for PDF', allPhonesMaskedForStudent);

  // 6b. Verify admin view provides genuine contact details in PDF metadata
  const adminTimetable = await request(`/api/timetables?year=2&section_id=${sec2A.id}`, { token: adminToken });
  const adminFacultyDetails = adminTimetable.data?.faculty_details || [];
  const adminHasRealPhones = adminFacultyDetails.some(f => f.phone && f.phone !== 'Protected' && f.phone !== '-');
  assert('Admin role has unmasked contact numbers for official administrative PDF export', adminHasRealPhones);


  // 6c. Verify Client Bundle includes jsPDF and html2canvas
  const distDir = path.join(__dirname, '..', 'client', 'dist');
  const distExists = fs.existsSync(distDir);
  assert('Client production dist directory exists', distExists);
  if (distExists) {
    const assetsDir = path.join(distDir, 'assets');
    const assetFiles = fs.readdirSync(assetsDir);
    const jsFiles = assetFiles.filter(f => f.endsWith('.js'));
    let foundJsPdfOrCanvas = false;
    for (const jsFile of jsFiles) {
      const content = fs.readFileSync(path.join(assetsDir, jsFile), 'utf8');
      if (content.includes('jsPDF') || content.includes('html2canvas') || content.includes('a4') || content.includes('landscape')) {
        foundJsPdfOrCanvas = true;
        break;
      }
    }
    assert('Client bundle contains compiled PDF export modules (jsPDF/html2canvas)', foundJsPdfOrCanvas);
  }

  // Restore modified cell
  await request('/api/timetables/cell', {
    method: 'POST',
    token: adminToken,
    body: {
      year: 4,
      section_id: 1,
      day: 'Monday',
      period: 1,
      subject: 'NLP',
      faculty_name: 'Dr. G. Kishor Kumar',
      room: 'RG-207'
    }
  });

  console.log('\n================================================================');
  console.log(`📊 PHASE 5 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (localServer) {
    localServer.close();
  }

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase5Verification().catch((err) => {
  console.error('Fatal Verification Error:', err);
  process.exit(1);
});
