// Real-time synchronization service for academic schedule updates
// Uses Server-Sent Events (SSE) for instantaneous push to connected clients
// with version tracking for polling fallback.

const sseClients = new Set();
let currentVersion = Date.now();
let lastNotificationTime = 0;
let lastNotificationKey = '';

export function registerClient(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const client = {
    id: Date.now() + Math.random(),
    res,
    userId: req.user?.id,
    role: req.user?.role
  };

  sseClients.add(client);

  // Send initial handshake with current timetable version
  res.write(`data: ${JSON.stringify({
    type: 'connected',
    version: currentVersion,
    timestamp: new Date().toISOString()
  })}\n\n`);

  // Keep-alive heartbeat every 20 seconds
  const pingInterval = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch (e) {
      clearInterval(pingInterval);
      sseClients.delete(client);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(pingInterval);
    sseClients.delete(client);
  });
}

/**
 * Broadcast timetable update event to all connected SSE clients
 */
export function broadcastTimetableUpdate({ year, section_id, section_name, action = 'update', message = '' }) {
  currentVersion = Date.now();

  const payload = JSON.stringify({
    type: 'timetable_updated',
    version: currentVersion,
    year,
    section_id,
    section_name,
    action,
    message,
    timestamp: new Date().toISOString()
  });

  for (const client of sseClients) {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch (e) {
      sseClients.delete(client);
    }
  }

  return currentVersion;
}

export function getTimetableVersion() {
  return {
    version: currentVersion,
    lastUpdated: new Date(currentVersion).toISOString()
  };
}

/**
 * Helper to check if a notification for the same section was sent within last 3 seconds
 * (debounces rapid successive cell edits by admin)
 */
export function shouldCreateTimetableNotification(key) {
  const now = Date.now();
  if (lastNotificationKey === key && (now - lastNotificationTime) < 3000) {
    return false;
  }
  lastNotificationKey = key;
  lastNotificationTime = now;
  return true;
}
