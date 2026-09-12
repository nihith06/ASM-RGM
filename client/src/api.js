// Central API client for RGMCET AIML Academic Schedule System

const API_BASE = '/api';

export function getStoredToken() {
  // 1. Check tab-scoped sessionStorage first (used by Faculty and Admin)
  const sessionToken = sessionStorage.getItem('rgmcet_auth_token');
  if (sessionToken) return sessionToken;

  // 2. Check localStorage (permitted ONLY for student accounts)
  const localUserStr = localStorage.getItem('rgmcet_auth_user');
  if (localUserStr) {
    try {
      const localUser = JSON.parse(localUserStr);
      if (localUser && localUser.role === 'student') {
        return localStorage.getItem('rgmcet_auth_token');
      }
    } catch (e) {}
    // If a legacy faculty or admin token was stored in localStorage, purge it
    localStorage.removeItem('rgmcet_auth_token');
    localStorage.removeItem('rgmcet_auth_user');
  }

  return null;
}

export function getStoredUser() {
  // 1. Check tab-scoped sessionStorage first (used by Faculty and Admin)
  const sessionUser = sessionStorage.getItem('rgmcet_auth_user');
  if (sessionUser) {
    try {
      return JSON.parse(sessionUser);
    } catch (e) {
      return null;
    }
  }

  // 2. Check localStorage (permitted ONLY for student accounts)
  const localUserStr = localStorage.getItem('rgmcet_auth_user');
  if (localUserStr) {
    try {
      const localUser = JSON.parse(localUserStr);
      if (localUser && localUser.role === 'student') {
        return localUser;
      }
    } catch (e) {}
    // Purge any lingering faculty or admin account from localStorage
    localStorage.removeItem('rgmcet_auth_token');
    localStorage.removeItem('rgmcet_auth_user');
  }

  return null;
}

export function setStoredSession(token, user) {
  if (user?.role === 'faculty' || user?.role === 'admin') {
    // Tab-scoped storage: sessionStorage only
    if (token) sessionStorage.setItem('rgmcet_auth_token', token);
    if (user) sessionStorage.setItem('rgmcet_auth_user', JSON.stringify(user));
    // Ensure not persisted in localStorage
    localStorage.removeItem('rgmcet_auth_token');
    localStorage.removeItem('rgmcet_auth_user');
  } else {
    // Students retain persistent localStorage
    if (token) localStorage.setItem('rgmcet_auth_token', token);
    if (user) localStorage.setItem('rgmcet_auth_user', JSON.stringify(user));
    sessionStorage.removeItem('rgmcet_auth_token');
    sessionStorage.removeItem('rgmcet_auth_user');
  }
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
    throw new Error(data.error || data.message || `HTTP ${response.status} error`);
  }

  return data;
}

// Auth endpoints
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
  requestOtp: (phone, role) =>
    apiRequest('/auth/forgot-password/request-otp', {
      method: 'POST',
      body: { phone, role }
    }),
  verifyOtp: (phone, otp, role) =>
    apiRequest('/auth/forgot-password/verify-otp', {
      method: 'POST',
      body: { phone, otp, role }
    }),
  resetPasswordWithOtp: (reset_token, new_password, confirm_password) =>
    apiRequest('/auth/forgot-password/reset-password', {
      method: 'POST',
      body: { reset_token, new_password, confirm_password }
    }),
  getMe: () => apiRequest('/auth/me'),
  logout: () => {
    const user = getStoredUser();
    return apiRequest('/auth/logout', {
      method: 'POST',
      body: { session_id: user?.session_id }
    }).catch(() => {});
  },
  sendHeartbeat: () =>
    apiRequest('/auth/session/heartbeat', {
      method: 'POST'
    }),
  sendUnload: () => {
    const user = getStoredUser();
    const token = getStoredToken();
    if (!user || (user.role !== 'faculty' && user.role !== 'admin')) return;
    const payload = JSON.stringify({ session_id: user.session_id });
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
  }
};

// Timetable endpoints
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
  addSection: (year, name) =>
    apiRequest('/timetables/sections', {
      method: 'POST',
      body: { year, name }
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
  getVersion: () => apiRequest('/timetables/version')
};

// Real-time EventSource subscriber for timetable updates
export function subscribeToTimetableEvents(onEvent, onError) {
  const token = getStoredToken();
  if (!token) return () => {};

  const url = `${API_BASE}/timetables/events?token=${encodeURIComponent(token)}`;
  let eventSource = null;
  let isClosed = false;

  function connect() {
    if (isClosed) return;
    try {
      eventSource = new EventSource(url);

      eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.type === 'timetable_updated') {
            window.dispatchEvent(new CustomEvent('rgmcet_timetable_updated', { detail: data }));
            window.dispatchEvent(new CustomEvent('rgmcet_notifications_updated'));
            if (onEvent) onEvent(data);
          }
        } catch (err) {
          // ignore
        }
      };

      eventSource.onerror = (err) => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        if (onError) onError(err);
        if (!isClosed) {
          setTimeout(connect, 3000);
        }
      };
    } catch (err) {
      if (onError) onError(err);
      if (!isClosed) setTimeout(connect, 3000);
    }
  }

  connect();

  return () => {
    isClosed = true;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}

// Faculty endpoints
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

// Faculty Leave endpoints
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

// Global Notifications (Faculty Leave Intimations)
export const notificationApi = {
  getNotifications: () => apiRequest('/notifications'),
  clearNotifications: () => apiRequest('/notifications/clear', { method: 'POST' }),
  dismissNotification: (id) => apiRequest(`/notifications/${id}`, { method: 'DELETE' })
};

// Directory endpoints (Protected: Faculty & Admin only)
export const directoryApi = {
  getStudents: (year, search) => {
    let url = '/directory/students';
    const params = [];
    if (year) params.push(`year=${year}`);
    if (search) params.push(`search=${encodeURIComponent(search)}`);
    if (params.length) url += `?${params.join('&')}`;
    return apiRequest(url);
  },
  getFaculty: (search) => {
    let url = '/directory/faculty';
    if (search) url += `?search=${encodeURIComponent(search)}`;
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
  resetStudentPassword: (studentId, newPassword) =>
    apiRequest(`/directory/students/${studentId}/reset-password`, {
      method: 'POST',
      body: { new_password: newPassword }
    }),
  getAuditLogs: () => apiRequest('/directory/audit-logs')
};
