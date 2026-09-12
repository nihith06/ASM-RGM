import http from 'node:http';

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

async function runRealtimeTests() {
  console.log('🧪 Starting Real-Time Timetable Sync Verification...\n');
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
      body: { register_id: 'admin01', password: '1352468' }
    });
    assert('Admin login successful', adminLogin.status === 200 && adminLogin.data.token);
    const adminToken = adminLogin.data.token;

    // 3. Faculty Login
    const facultyLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { register_id: 'FAC001', password: '12345678' }
    });
    assert('Faculty login successful', facultyLogin.status === 200 && facultyLogin.data.token);
    const facultyToken = facultyLogin.data.token;

    // 4. Test Version Endpoint
    const initialVersion = await request('/api/timetables/version', { token: adminToken });
    assert('Version endpoint returns valid timestamp', initialVersion.status === 200 && initialVersion.data.version > 0);
    const startVer = initialVersion.data.version;

    // 5. Connect Faculty to SSE Event Stream
    console.log('  📡 Connecting Faculty client to SSE stream (/api/timetables/events)...');
    let sseConnected = false;
    let receivedSseEvent = null;

    const sseReq = http.request(`http://localhost:5000/api/timetables/events?token=${encodeURIComponent(facultyToken)}`, (res) => {
      res.on('data', (chunk) => {
        const text = chunk.toString();
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6));
              if (payload.type === 'connected') {
                sseConnected = true;
              } else if (payload.type === 'timetable_updated') {
                receivedSseEvent = payload;
              }
            } catch (e) {}
          }
        }
      });
    });
    sseReq.end();

    // Wait 500ms for SSE handshake
    await new Promise(r => setTimeout(r, 500));
    assert('SSE client handshake connected successfully', sseConnected);

    // 6. Fetch existing cell to preserve it
    const timetableRes = await request('/api/timetables?year=4&section_id=1', { token: adminToken });
    assert('Fetched current Year 4 Section A timetable', timetableRes.status === 200);
    const existingSlot = timetableRes.data.grid?.['Monday']?.[1] || { subject: '—', faculty_name: '—', room: '' };

    // 7. Admin modifies a cell
    console.log('  ⚡ Admin updating cell (Year 4, Section A, Monday, Period 1)...');
    const updateRes = await request('/api/timetables/cell', {
      method: 'POST',
      token: adminToken,
      body: {
        year: 4,
        section_id: 1,
        day: 'Monday',
        period: 1,
        subject: 'Deep Learning',
        faculty_name: 'Dr. B. Satish Kumar',
        room: 'Mech-301'
      }
    });
    assert('Admin cell update succeeded', updateRes.status === 200);

    // Wait 400ms for SSE propagation
    await new Promise(r => setTimeout(r, 400));

    // 8. Verify SSE event arrived at Faculty client
    assert('Faculty SSE stream received timetable_updated event immediately', receivedSseEvent !== null);
    if (receivedSseEvent) {
      assert('SSE event matches updated section (Year 4, Section 1)', 
        receivedSseEvent.year === 4 && receivedSseEvent.section_id === 1);
      assert('SSE event contains updated version timestamp', receivedSseEvent.version > startVer);
    }

    // 9. Verify Version Endpoint incremented
    const updatedVersion = await request('/api/timetables/version', { token: adminToken });
    assert('Timetable version endpoint incremented', updatedVersion.data.version > startVer);

    // 10. Verify Global Notifications table
    const notifs = await request('/api/notifications', { token: facultyToken });
    assert('Fetched notifications list', notifs.status === 200 && Array.isArray(notifs.data.notifications));
    const timetableNotif = notifs.data.notifications.find(n => 
      n.type === 'timetable_update' && n.message.includes('4th Year - Section A')
    );
    assert('Global notification created: "Admin updated the timetable for 4th Year - Section A."', 
      timetableNotif !== undefined, 
      JSON.stringify(notifs.data.notifications.slice(0, 3))
    );

    // 11. Restore original cell
    console.log('  🔄 Restoring original cell data...');
    await request('/api/timetables/cell', {
      method: 'POST',
      token: adminToken,
      body: {
        year: 4,
        section_id: 1,
        day: 'Monday',
        period: 1,
        subject: existingSlot.subject,
        faculty_name: existingSlot.faculty_name,
        room: existingSlot.room || ''
      }
    });

    sseReq.destroy();

  } catch (err) {
    console.error('Fatal error during test run:', err);
    failed++;
  }

  console.log(`\n========================================`);
  console.log(`Real-Time Verification Summary: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runRealtimeTests();
