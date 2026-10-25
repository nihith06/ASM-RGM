// Central API client for RGMCET AIML Academic Schedule System

const API_BASE = '/api';

export function getStoredToken() {
  return sessionStorage.getItem('rgmcet_auth_token') || null;
}

export function getStoredUser() {
  const sessionUser = sessionStorage.getItem('rgmcet_auth_user');
  if (sessionUser) {
    try {
      return JSON.parse(sessionUser);
    } catch (e) {
      return null;
    }
  }
  return null;
}

export function setStoredSession(token, user) {
  if (token) sessionStorage.setItem('rgmcet_auth_token', token);
  if (user) sessionStorage.setItem('rgmcet_auth_user', JSON.stringify(user));

  // Purge any legacy localStorage keys to enforce strict session hygiene
  localStorage.removeItem('rgmcet_auth_token');
  localStorage.removeItem('rgmcet_auth_user');
}

export function clearStoredSession() {
  sessionStorage.removeItem('rgmcet_auth_token');
  sessionStorage.removeItem('rgmcet_auth_user');
  localStorage.removeItem('rgmcet_auth_token');
  localStorage.removeItem('rgmcet_auth_user');
}

export async function apiRequest(endpoint, options = {}) {
  const token = getStoredToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = { message: text };
  }

  if (!response.ok) {
    const errorMsg = data.error || data.message || `Request failed with status ${response.status}`;
    const err = new Error(errorMsg);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

// Authentication endpoints
export const authApi = {
  login: (register_id, password, expected_role) => 
    apiRequest('/auth/login', {
      method: 'POST',
      body: { register_id, password, expected_role }
    }),
  register: (payload) =>
    apiRequest('/auth/register', {
      method: 'POST',
      body: payload
    }),
  registerAdmin: (payload) =>
    apiRequest('/auth/register-admin', {
      method: 'POST',
      body: payload
    }),
  changePassword: (payload) =>
    apiRequest('/auth/change-password', {
      method: 'POST',
      body: payload
    }),
  logout: () => {
    const user = getStoredUser();
    return apiRequest('/auth/logout', {
      method: 'POST',
      body: { session_id: user?.session_id }
    });
  },
  sendHeartbeat: () =>
    apiRequest('/auth/session/heartbeat', {
      method: 'POST'
    }),
  sendUnload: () => {
    const token = getStoredToken();
    const user = getStoredUser();
    if (!token && !user) return;
    try {
      const payload = JSON.stringify({ session_id: user?.session_id });
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(`${API_BASE}/auth/session/unload`, blob);
      } else {
        fetch(`${API_BASE}/auth/session/unload`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: payload,
          keepalive: true
        }).catch(() => {});
      }
    } catch (e) {}
  },
  requestOtp: (phone, role) =>
    apiRequest('/auth/forgot-password/request-otp', {
      method: 'POST',
      body: { phone, role }
    }),
  verifyOtp: (payload) =>
    apiRequest('/auth/forgot-password/verify-otp', {
      method: 'POST',
      body: payload
    }),
  resetPasswordWithToken: (payload) =>
    apiRequest('/auth/forgot-password/reset-password', {
      method: 'POST',
      body: payload
    }),
  getMe: () => apiRequest('/auth/me')
};

// Timetable endpoints (Public read-only)
export const timetableApi = {
  getTimetable: (year, section_id, date) => {
    let url = `/timetables?year=${year}`;
    if (section_id) url += `&section_id=${section_id}`;
    if (date) url += `&date=${encodeURIComponent(date)}`;
    return apiRequest(url);
  },
  getSections: (year) => {
    let url = '/timetables/sections';
    if (year) url += `?year=${year}`;
    return apiRequest(url);
  },
  addSection: (payload) =>
    apiRequest('/timetables/sections', {
      method: 'POST',
      body: payload
    }),
  deleteSection: (id) =>
    apiRequest(`/timetables/sections/${id}`, {
      method: 'DELETE'
    }),
  updateCell: (payload) =>
    apiRequest('/timetables/cell', {
      method: 'POST',
      body: payload
    }),
  importCsv: (year, section_id, csv_data) =>
    apiRequest('/timetables/import-csv', {
      method: 'POST',
      body: { year, section_id, csv_data }
    }),
  generateTimetable: (payload) =>
    apiRequest('/timetables/generate', {
      method: 'POST',
      body: payload
    }),
  validateUpload: (payload) =>
    apiRequest('/timetables/validate-upload', {
      method: 'POST',
      body: payload
    }),
  replaceSectionTimetable: (payload) =>
    apiRequest('/timetables/replace-section-timetable', {
      method: 'POST',
      body: payload
    }),
  getVersion: () => apiRequest('/timetables/version')
};

// Real-time EventSource subscriber for timetable updates (Public, with polling fallback)
export function subscribeToTimetableEvents(onEvent, onError) {
  let eventSource = null;
  let isClosed = false;
  let reconnectTimeout = null;
  let pollingInterval = null;
  let lastKnownVersion = null;

  function startPollingFallback() {
    if (pollingInterval || isClosed) return;
    pollingInterval = setInterval(async () => {
      try {
        const data = await timetableApi.getVersion();
        if (data?.version) {
          if (lastKnownVersion && data.version !== lastKnownVersion) {
            window.dispatchEvent(new CustomEvent('rgmcet_timetable_updated', { detail: data }));
            window.dispatchEvent(new CustomEvent('rgmcet_notifications_updated'));
            if (onEvent) onEvent(data);
          }
          lastKnownVersion = data.version;
        }
      } catch (err) {}
    }, 15000);
  }

  function stopPollingFallback() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  function connect() {
    if (isClosed) return;
    try {
      const url = `${API_BASE}/timetables/events`;
      eventSource = new EventSource(url);

      eventSource.onopen = () => {
        stopPollingFallback();
      };

      eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.version) {
            lastKnownVersion = data.version;
          }
          if (data && (data.type === 'timetable_updated' || data.type === 'notification_created')) {
            window.dispatchEvent(new CustomEvent('rgmcet_timetable_updated', { detail: data }));
            window.dispatchEvent(new CustomEvent('rgmcet_notifications_updated'));
            if (onEvent) onEvent(data);
          }
        } catch (err) {}
      };

      eventSource.onerror = (err) => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        startPollingFallback();
        if (onError) onError(err);
        if (!isClosed) {
          reconnectTimeout = setTimeout(connect, 5000);
        }
      };
    } catch (err) {
      startPollingFallback();
      if (onError) onError(err);
      if (!isClosed) {
        reconnectTimeout = setTimeout(connect, 5000);
      }
    }
  }

  connect();

  return () => {
    isClosed = true;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    stopPollingFallback();
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}

// Faculty endpoints (Public read-only availability, protected mutations)
export const facultyApi = {
  getAvailability: (day, search, date) => {
    let url = '/faculty/availability';
    const params = [];
    if (day) params.push(`day=${encodeURIComponent(day)}`);
    if (search) params.push(`search=${encodeURIComponent(search)}`);
    if (date) params.push(`date=${encodeURIComponent(date)}`);
    if (params.length) url += `?${params.join('&')}`;
    return apiRequest(url);
  },
  getMySchedule: () => apiRequest('/faculty/my-schedule'),
  setOverride: (day, period, status, date) =>
    apiRequest('/faculty/overrides', {
      method: 'POST',
      body: { day, period, status, date }
    }),
  deleteOverride: (day, period, date) => {
    let url = `/faculty/overrides/${encodeURIComponent(day)}/${period}`;
    if (date) url += `?date=${encodeURIComponent(date)}`;
    return apiRequest(url, {
      method: 'DELETE'
    });
  }
};

// Faculty Leave endpoints (Public read-only leaves, protected mutations)
export const leaveApi = {
  getLeaves: (date, faculty_id) => {
    let url = '/faculty/leaves';
    const params = [];
    if (date) params.push(`date=${encodeURIComponent(date)}`);
    if (faculty_id) params.push(`faculty_id=${encodeURIComponent(faculty_id)}`);
    if (params.length) url += `?${params.join('&')}`;
    return apiRequest(url);
  },
  markLeave: (date, status = 'leave', faculty_id) =>
    apiRequest('/faculty/leaves', {
      method: 'POST',
      body: { date, status, faculty_id }
    }),
  cancelLeave: (id) =>
    apiRequest(`/faculty/leaves/${id}`, {
      method: 'DELETE'
    })
};

// Global Notifications (Faculty Leave Intimations - Public read-only, admin delete)
export const notificationApi = {
  getNotifications: (date) => {
    let url = '/notifications';
    if (date) url += `?date=${encodeURIComponent(date)}`;
    return apiRequest(url);
  },
  clearNotifications: () => apiRequest('/notifications/clear', { method: 'POST' }),
  dismissNotification: (id) => apiRequest(`/notifications/${id}`, { method: 'DELETE' })
};

// Directory endpoints (Protected: Faculty & Admin only)
export const directoryApi = {
  getFaculty: (search, date) => {
    let url = '/directory/faculty';
    const params = [];
    if (search) params.push(`search=${encodeURIComponent(search)}`);
    if (date) params.push(`date=${encodeURIComponent(date)}`);
    if (params.length) url += `?${params.join('&')}`;
    return apiRequest(url);
  },
  getStats: () => apiRequest('/directory/stats'),
  updateUser: (id, payload) =>
    apiRequest(`/directory/users/${id}`, {
      method: 'PUT',
      body: payload
    }),
  deleteUser: (id) =>
    apiRequest(`/directory/users/${id}`, {
      method: 'DELETE'
    }),
  getAuditLogs: () => apiRequest('/directory/audit-logs')
};
