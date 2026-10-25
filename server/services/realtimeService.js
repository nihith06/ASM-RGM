import crypto from 'node:crypto';

// Real-time synchronization service for academic schedule updates
// Uses Server-Sent Events (SSE) for instantaneous push to connected clients
// with version tracking for polling fallback.

const MAX_TOTAL_SSE_CLIENTS = 500;
const MAX_SSE_PER_IP = 10;

const sseClients = new Set();
const sseClientsByIp = new Map();
const sseTickets = new Map();
let currentVersion = Date.now();
let lastNotificationTime = 0;
let lastNotificationKey = '';

// Purge expired tickets every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [ticket, data] of sseTickets.entries()) {
    if (now > data.expiresAt) {
      sseTickets.delete(ticket);
    }
  }
}, 60000).unref?.();

/**
 * Creates a short-lived single-use ticket for establishing an SSE connection
 */
export function createSseTicket(user) {
  const ticket = crypto.randomBytes(24).toString('hex');
  sseTickets.set(ticket, {
    user: user ? { id: user.id, role: user.role, name: user.name } : null,
    expiresAt: Date.now() + 30000 // 30 seconds validity
  });
  return ticket;
}

/**
 * Validates and immediately consumes (deletes) an SSE single-use ticket
 */
export function consumeSseTicket(ticket) {
  if (!ticket || typeof ticket !== 'string') return null;
  const data = sseTickets.get(ticket);
  if (!data) return null;
  sseTickets.delete(ticket); // Single-use: consumed immediately
  if (Date.now() > data.expiresAt) return null;
  return data.user;
}

export function registerClient(req, res) {
  const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
  const currentIpCount = sseClientsByIp.get(clientIp) || 0;

  // Enforce global total limit
  if (sseClients.size >= MAX_TOTAL_SSE_CLIENTS) {
    res.status(503).json({ error: 'Server-Sent Events connection limit reached. Please use polling fallback.' });
    return;
  }

  // Enforce per-IP limit
  if (currentIpCount >= MAX_SSE_PER_IP) {
    res.status(429).json({ error: 'Too many SSE connections from your IP. Maximum 10 connections allowed.' });
    return;
  }

  sseClientsByIp.set(clientIp, currentIpCount + 1);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const client = {
    id: Date.now() + Math.random(),
    res,
    clientIp,
    userId: req.user?.id,
    role: req.user?.role
  };

  sseClients.add(client);

  const cleanupClient = () => {
    sseClients.delete(client);
    const count = sseClientsByIp.get(clientIp) || 1;
    if (count <= 1) {
      sseClientsByIp.delete(clientIp);
    } else {
      sseClientsByIp.set(clientIp, count - 1);
    }
  };

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
      cleanupClient();
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(pingInterval);
    cleanupClient();
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
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

/**
 * Broadcast global notification event (e.g. faculty leave intimation) to all connected SSE clients
 */
export function broadcastGlobalNotification({ type, faculty_name, leave_date, message }) {
  // Prevent duplicate broadcasts within 2 seconds
  const key = `${type}_${faculty_name}_${leave_date}`;
  const now = Date.now();
  if (key === lastNotificationKey && (now - lastNotificationTime) < 2000) {
    return;
  }
  lastNotificationKey = key;
  lastNotificationTime = now;

  currentVersion = now;

  const payload = JSON.stringify({
    type: 'notification_created',
    version: currentVersion,
    notification: {
      type,
      faculty_name,
      leave_date,
      message,
      created_at: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  });

  for (const client of sseClients) {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

export function getTimetableVersion() {
  return {
    version: currentVersion,
    timestamp: new Date().toISOString()
  };
}

export function getConnectedClientCount() {
  return sseClients.size;
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
