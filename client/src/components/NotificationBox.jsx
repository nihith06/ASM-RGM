import React, { useState, useEffect, useRef } from 'react';
import { Bell, Calendar, User, Clock, Check, AlertCircle, ShieldAlert, X } from 'lucide-react';
import { notificationApi } from '../api';

export default function NotificationBox({ user }) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [readIds, setReadIds] = useState(() => {
    try {
      const stored = localStorage.getItem('rgmcet_read_notifications');
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  });

  const popoverRef = useRef(null);
  const isAdmin = Boolean(user && user.role === 'admin');
  const isStudent = Boolean(user && user.role === 'student');

  useEffect(() => {
    loadNotifications();
    const handleSync = () => loadNotifications();
    window.addEventListener('rgmcet_notifications_updated', handleSync);
    window.addEventListener('rgmcet_timetable_updated', handleSync);
    window.addEventListener('storage', handleSync);
    // Poll every 3 seconds for real-time leave and timetable intimations across all users
    const interval = setInterval(loadNotifications, 3000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('rgmcet_notifications_updated', handleSync);
      window.removeEventListener('rgmcet_timetable_updated', handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }, []);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const loadNotifications = async () => {
    try {
      const res = await notificationApi.getNotifications();
      if (res && Array.isArray(res.notifications)) {
        setNotifications(res.notifications);
      }
    } catch (err) {
      // silent background fail
    }
  };

  const handleDismiss = async (e, id) => {
    e.stopPropagation();
    if (!isAdmin) return;
    try {
      setDeletingId(id);
      // Optimistically remove from state
      setNotifications(prev => prev.filter(n => n.id !== id));
      await notificationApi.dismissNotification(id);
      window.dispatchEvent(new CustomEvent('rgmcet_notifications_updated'));
    } catch (err) {
      console.error('Failed to delete notification:', err);
      loadNotifications();
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggle = () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState && notifications.length > 0) {
      // Mark visible as read
      const allIds = notifications.map(n => n.id);
      const updatedRead = Array.from(new Set([...readIds, ...allIds]));
      setReadIds(updatedRead);
      try {
        localStorage.setItem('rgmcet_read_notifications', JSON.stringify(updatedRead));
      } catch (e) {}
    }
  };

  const unreadCount = notifications.filter(n => !readIds.includes(n.id)).length;

  const formatTimestamp = (ts) => {
    if (!ts) return '';
    try {
      const date = new Date(ts);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  };

  const getTodayKey = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const getLocalDateKey = (item) => {
    if (!item) return '';
    if (item.created_date) return item.created_date;
    if (item.created_at) {
      try {
        const d = new Date(item.created_at);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      } catch (e) {}
    }
    return '';
  };

  const formatDayLabel = (dateStr) => {
    if (!dateStr) return 'Previous Intimations';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const [y, m, d] = parts.map(Number);
        const dateObj = new Date(y, m - 1, d);
        const todayStr = getTodayKey();
        
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

        if (dateStr === todayStr) return 'Today';
        if (dateStr === yKey) return `Yesterday (${dateObj.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })})`;
        return dateObj.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
      }
      return dateStr;
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <div className="relative inline-block" ref={popoverRef}>
      {/* Bell Notification Trigger Button */}
      <button
        type="button"
        onClick={handleToggle}
        title="Official Faculty Leave & Availability Intimations"
        className={`relative p-2 rounded-xl border transition-all cursor-pointer flex items-center justify-center ${
          isOpen
            ? 'bg-navy-900 text-amber-300 border-navy-900 shadow-sm'
            : unreadCount > 0
              ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100/80'
              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-navy-900'
        }`}
        aria-expanded={isOpen}
      >
        <Bell className={`w-4 h-4 ${unreadCount > 0 ? 'animate-bounce' : ''}`} />
        
        {/* Unread Badge Indicator */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white font-extrabold text-[9px] flex items-center justify-center ring-2 ring-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Popover (Aligned to right-0 so it stays fully inside the screen on desktop) */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 animate-scale-up overflow-hidden">
          
          {/* Header */}
          <div className="bg-navy-900 text-white p-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-amber-400 text-navy-950 flex items-center justify-center font-bold">
                <Bell className="w-3.5 h-3.5" />
              </div>
              <div>
                <h4 className="text-xs font-black tracking-tight leading-tight">
                  Academic & Schedule Intimations
                </h4>
                <p className="text-[10px] text-slate-300">
                  Real-time timetable, leave & availability alerts
                </p>
              </div>
            </div>
          </div>

          {/* Scope notice banner */}
          <div className="bg-amber-50/80 px-3 py-1.5 border-b border-amber-200/80 text-[10px] text-amber-900 font-medium flex items-center gap-1.5">
            <AlertCircle className="w-3 h-3 text-amber-700 shrink-0" />
            <span>Official intimations broadcast to all students, faculty, and admins.</span>
          </div>

          {/* Notification List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {notifications.length === 0 ? (
              <div className="py-8 px-4 text-center text-slate-400">
                <Bell className="w-8 h-8 mx-auto mb-2 text-slate-300 stroke-1" />
                <p className="text-xs font-bold text-slate-600">No active schedule intimations</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {isStudent
                    ? 'Student notifications reset automatically daily. New intimations appear here immediately.'
                    : 'When the timetable is updated or faculty marks leave, the notification appears here immediately.'}
                </p>
              </div>
            ) : (
              notifications.map((item, idx) => {
                const isTimetableUpdate = item.type === 'timetable_update';
                const isRemoved = item.type === 'availability_removed';

                // Determine date divider for Admin and Faculty
                const itemDate = getLocalDateKey(item);
                const prevDate = idx > 0 ? getLocalDateKey(notifications[idx - 1]) : null;
                const showDivider = !isStudent && prevDate && itemDate && itemDate !== prevDate;

                return (
                  <React.Fragment key={item.id}>
                    {/* Visual horizontal divider line between previous day and new day notifications */}
                    {showDivider && (
                      <div className="py-2 px-3 bg-slate-100/90 border-y border-slate-200 flex items-center gap-2 text-[10px] font-bold text-slate-500">
                        <div className="h-px flex-1 bg-slate-300"></div>
                        <span className="uppercase tracking-wider px-2 py-0.5 rounded-full bg-white border border-slate-300 text-slate-700 font-bold shadow-xs">
                          {formatDayLabel(itemDate)}
                        </span>
                        <div className="h-px flex-1 bg-slate-300"></div>
                      </div>
                    )}

                    <div 
                      className="p-3 hover:bg-slate-50 transition-colors flex items-start gap-2.5 relative group"
                    >
                      <div className={`w-7 h-7 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
                        isTimetableUpdate
                          ? 'bg-navy-100 text-navy-900 border border-navy-300'
                          : isRemoved
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : 'bg-rose-100 text-rose-800 border border-rose-200'
                      }`}>
                        {isTimetableUpdate ? <Calendar className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-slate-800 leading-snug">
                          {item.message || `${item.faculty_name} is on Leave for ${item.leave_date}`}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500 font-medium">
                          <span className={`inline-flex items-center gap-1 font-bold px-1.5 py-0.5 rounded border text-[10px] ${
                            isTimetableUpdate
                              ? 'bg-navy-50 text-navy-900 border-navy-200'
                              : isRemoved
                                ? 'bg-amber-50 text-amber-900 border-amber-200'
                                : 'bg-rose-50 text-rose-800 border border-rose-200'
                          }`}>
                            <Calendar className="w-2.5 h-2.5" />
                            {isTimetableUpdate ? 'Timetable Sync' : item.leave_date}
                          </span>
                          {item.created_at && (
                            <span className="flex items-center gap-1 text-slate-400">
                              <Clock className="w-2.5 h-2.5" />
                              {formatTimestamp(item.created_at)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Admin-only individual clear cross (X) mark */}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={(e) => handleDismiss(e, item.id)}
                          disabled={deletingId === item.id}
                          title="Delete notification globally for everyone (Admin only)"
                          className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0 ml-1 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </React.Fragment>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="p-2.5 bg-slate-50 border-t border-slate-100 text-center text-[10px] text-slate-500 font-medium">
            <span>RGMCET AIML Academic Notification Dispatch</span>
          </div>

        </div>
      )}
    </div>
  );
}
