import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import LandingPage from './pages/LandingPage';
import AuthModal from './components/AuthModal';
import StudentDashboard from './pages/StudentDashboard';
import FacultyDashboard from './pages/FacultyDashboard';
import AdminDashboard from './pages/AdminDashboard';
import TimetableGrid from './components/TimetableGrid';
import DirectoryView from './components/DirectoryView';
import { 
  getStoredToken, 
  getStoredUser, 
  setStoredSession, 
  clearStoredSession, 
  authApi,
  subscribeToTimetableEvents
} from './api';

export default function App() {
  const [user, setUser] = useState(getStoredUser());
  const [token, setToken] = useState(getStoredToken());
  const [currentTab, setCurrentTab] = useState('dashboard'); // 'dashboard' | 'timetables' | 'availability' | 'directory'

  // Auth modal state
  const [authModalState, setAuthModalState] = useState({
    isOpen: false,
    mode: 'login', // 'login' | 'register'
    role: 'student' // 'student' | 'faculty' | 'admin'
  });

  // Verify session on initial load
  useEffect(() => {
    if (token) {
      authApi.getMe()
        .then(res => {
          if (res.user) {
            setUser(res.user);
            setStoredSession(token, res.user);
          }
        })
        .catch(() => {
          // Token invalid or expired
          handleLogout();
        });
    }
  }, [token]);

  // Real-time synchronization: subscribe to timetable SSE events when logged in
  useEffect(() => {
    if (token && user) {
      const unsubscribe = subscribeToTimetableEvents();
      return () => unsubscribe && unsubscribe();
    }
  }, [token, user]);

  const handleAuthSuccess = (newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
    setStoredSession(newToken, newUser);
    setCurrentTab('dashboard');
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch (e) {}
    clearStoredSession();
    setUser(null);
    setToken(null);
    setCurrentTab('dashboard');
  };

  // Active session heartbeat & tab lifecycle for Faculty and Admin
  useEffect(() => {
    if (!token || !user || (user.role !== 'faculty' && user.role !== 'admin')) {
      return;
    }

    // Send an immediate heartbeat on mount (critical for resume after refresh)
    authApi.sendHeartbeat().catch(() => {});

    // Periodic heartbeat every 10 seconds
    const interval = setInterval(() => {
      authApi.sendHeartbeat().catch((err) => {
        if (err.message && (err.message.includes('Session') || err.message.includes('401') || err.message.includes('expired'))) {
          handleLogout();
        }
      });
    }, 10000);

    // Send unload signal when closing or navigating away
    const handleBeforeUnload = () => {
      authApi.sendUnload();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [token, user]);

  const [preservedRole, setPreservedRole] = useState(() => {
    return localStorage.getItem('rgmcet_preserved_role') || 'student';
  });

  const handleOpenAuth = (mode = 'login', role) => {
    const activeRole = role || preservedRole;
    if (role) {
      setPreservedRole(role);
      localStorage.setItem('rgmcet_preserved_role', role);
    }
    setAuthModalState({
      isOpen: true,
      mode,
      role: activeRole
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      
      {/* Header Bar */}
      <Header
        user={user}
        onLogout={handleLogout}
        onOpenAuth={handleOpenAuth}
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
      />

      {/* Main Body */}
      <main className="flex-1 flex flex-col">
        {!user ? (
          // Unauthenticated: Landing Page with Pre-Login Blue Glass Building Background
          <div className="flex-1 bg-prelogin-blue relative">
            <div className="w-full min-h-[calc(100vh-80px)] bg-slate-50/75 backdrop-blur-[1px] flex flex-col justify-between">
              <LandingPage
                onSelectRole={(role, mode = 'login') => handleOpenAuth(mode, role)}
              />
            </div>
          </div>
        ) : user.role === 'faculty' ? (
          // Faculty: Self-contained workspace containing teaching schedule, override manager, availability, directory & timetables
          <FacultyDashboard user={user} />
        ) : (
          // Authenticated Student & Admin: Views based on tab and role
          <div className="flex-1">
            {currentTab !== 'directory' && (
              user.role === 'admin' ? (
                <AdminDashboard user={user} />
              ) : (
                <StudentDashboard user={user} />
              )
            )}

            {currentTab === 'directory' && (
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <DirectoryView user={user} />
              </div>
            )}
          </div>
        )}
      </main>

      {/* Authentication Modal */}
      <AuthModal
        isOpen={authModalState.isOpen}
        initialMode={authModalState.mode}
        initialRole={authModalState.role}
        onClose={() => setAuthModalState(prev => ({ ...prev, isOpen: false }))}
        onAuthSuccess={handleAuthSuccess}
      />

    </div>
  );
}
