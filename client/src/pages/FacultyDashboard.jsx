import React, { useState, useEffect } from 'react';
import { 
  BookOpenCheck, 
  Calendar, 
  Clock, 
  Users, 
  Edit3, 
  Sparkles, 
  Check, 
  X, 
  AlertCircle,
  Plus,
  Trash2,
  BookOpen,
} from 'lucide-react';
import { facultyApi, leaveApi } from '../api';
import TimetableGrid from '../components/TimetableGrid';
import FacultyAvailabilityView from '../components/FacultyAvailabilityView';
import DirectoryView from '../components/DirectoryView';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PERIOD_TIMES = {
  1: '09:00 - 09:50 AM',
  2: '09:50 - 10:40 AM',
  3: '11:00 - 11:50 AM',
  4: '11:50 - 12:40 PM',
  5: '01:50 - 02:40 PM',
  6: '02:40 - 03:30 PM',
  7: '03:30 - 05:00 PM'
};

export default function FacultyDashboard({ user }) {
  const [activeTab, setActiveTab] = useState('my-schedule'); // 'my-schedule' | 'override-editor' | 'availability' | 'directory' | 'all-timetables'
  const [myScheduleData, setMyScheduleData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Faculty Leave & Absence State
  const [myLeaves, setMyLeaves] = useState([]);
  const [selectedLeaveDate, setSelectedLeaveDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [leaveStatus, setLeaveStatus] = useState('active'); // 'leave' | 'busy' | 'active'
  const [leaveSaving, setLeaveSaving] = useState(false);

  // Set Slot Availability Modal State: status is strictly 'busy' or 'leave'
  const [overrideModal, setOverrideModal] = useState(null); // { day, period, status, date, isExisting }

  // Remove Slot Availability Confirmation Modal State
  const [removeConfirm, setRemoveConfirm] = useState(null); // { day, period, date, slotTime, target }

  // Quick Add Override State: strictly busy or leave, no note
  const [quickOverride, setQuickOverride] = useState({
    day: 'Monday',
    period: 1,
    status: 'busy'
  });

  useEffect(() => {
    loadMySchedule();
    loadLeaves();

    const handleTimetableUpdate = () => {
      loadMySchedule(true);
    };
    window.addEventListener('rgmcet_timetable_updated', handleTimetableUpdate);
    return () => {
      window.removeEventListener('rgmcet_timetable_updated', handleTimetableUpdate);
    };
  }, []);

  const loadLeaves = async () => {
    try {
      const res = await leaveApi.getLeaves(null, user.id);
      if (res && Array.isArray(res.leaves)) {
        setMyLeaves(res.leaves);
        const existing = res.leaves.find(l => (l.leave_date === selectedLeaveDate || l.date === selectedLeaveDate));
        setLeaveStatus(existing ? (existing.status || 'leave') : 'active');
      }
    } catch (e) {
      console.error('Failed to load leaves:', e);
    }
  };

  const handleDateChange = (newDate) => {
    setSelectedLeaveDate(newDate);
    const existing = myLeaves.find(l => (l.leave_date === newDate || l.date === newDate));
    if (existing) {
      setLeaveStatus(existing.status || 'leave');
    } else {
      setLeaveStatus('active');
    }
  };

  const handleSaveLeave = async (e) => {
    e.preventDefault();
    if (!selectedLeaveDate) return;
    setLeaveSaving(true);
    try {
      const res = await leaveApi.markLeave(selectedLeaveDate, leaveStatus);
      setSuccess(res.message || `Status updated for ${selectedLeaveDate}!`);
      loadLeaves();
      loadMySchedule();
      // Broadcast real-time notification update to header bell
      window.dispatchEvent(new CustomEvent('rgmcet_notifications_updated'));
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.message || 'Failed to save status.');
    } finally {
      setLeaveSaving(false);
    }
  };

  const handleCancelLeave = async (id) => {
    try {
      await leaveApi.cancelLeave(id);
      setSuccess('Status record removed.');
      loadLeaves();
      loadMySchedule();
      window.dispatchEvent(new CustomEvent('rgmcet_notifications_updated'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to remove status record.');
    }
  };

  const loadMySchedule = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await facultyApi.getMySchedule();
      setMyScheduleData(data);
    } catch (err) {
      if (!silent) setError('Failed to load teaching schedule: ' + err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleQuickAddOverride = async (e) => {
    e.preventDefault();
    try {
      await facultyApi.setOverride(
        quickOverride.day,
        parseInt(quickOverride.period, 10),
        quickOverride.status,
        selectedLeaveDate
      );
      setSuccess(`Availability updated for ${quickOverride.day} Period ${quickOverride.period}!`);
      loadMySchedule();
      window.dispatchEvent(new CustomEvent('rgmcet_notifications_updated'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to update availability.');
    }
  };

  const handleSaveOverride = async (e) => {
    e.preventDefault();
    if (!overrideModal) return;

    try {
      await facultyApi.setOverride(
        overrideModal.day,
        overrideModal.period,
        overrideModal.status,
        overrideModal.date || selectedLeaveDate
      );
      setSuccess(`Availability set to ${overrideModal.status === 'busy' ? 'Busy' : 'Leave'} for ${overrideModal.day} Period ${overrideModal.period}!`);
      setOverrideModal(null);
      loadMySchedule();
      window.dispatchEvent(new CustomEvent('rgmcet_notifications_updated'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to update availability.');
    }
  };

  // Triggers the confirmation modal when user clicks Remove on any availability
  const handleInitiateRemoveOverride = (day, period, targetObj = null) => {
    setRemoveConfirm({
      day,
      period,
      date: (targetObj && targetObj.override_date) || selectedLeaveDate,
      target: targetObj
    });
  };

  // Executes removal ONLY when user clicks Confirm Remove in the dialog
  const handleExecuteRemove = async () => {
    if (!removeConfirm) return;
    try {
      await facultyApi.deleteOverride(removeConfirm.day, removeConfirm.period, removeConfirm.date);
      setSuccess(`Removed availability for ${removeConfirm.day} Period ${removeConfirm.period}.`);
      setRemoveConfirm(null);
      loadMySchedule();
      window.dispatchEvent(new CustomEvent('rgmcet_notifications_updated'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to remove availability.');
    }
  };

  const weeklySchedule = myScheduleData?.weekly_schedule || {};
  const teachingClasses = myScheduleData?.teaching_classes || [];
  const overrides = myScheduleData?.overrides || [];

  const isLandingDashboard = activeTab === 'my-schedule';

  return (
    <div className={`w-full transition-all duration-300 ${isLandingDashboard ? 'bg-postlogin-green' : 'bg-slate-50'}`}>
      <div className={`w-full min-h-[calc(100vh-80px)] ${isLandingDashboard ? 'bg-slate-50/80 backdrop-blur-[1px]' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {/* Faculty Profile Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-academic flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-navy-900 text-white flex items-center justify-center font-bold shadow-md">
            <BookOpenCheck className="w-8 h-8 text-amber-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-navy-900">
                {user.name}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-navy-50 text-navy-900 border border-navy-200">
                {user.designation || 'Faculty Member'}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Employee ID: <span className="font-mono font-bold text-slate-700">{user.register_id}</span> · AIML Department
            </p>
          </div>
        </div>

        {/* Quick Stats Pill */}
        <div className="flex items-center gap-4 bg-slate-50 border border-slate-200 px-4 py-2.5 rounded-xl text-xs">
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400">Total Teaching Load</div>
            <div className="text-sm font-black text-navy-900">{teachingClasses.length} Periods / week</div>
          </div>
          <div className="h-6 w-px bg-slate-200"></div>
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400">Custom Overrides</div>
            <div className="text-sm font-black text-purple-700">{overrides.length} Slots</div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-2 sm:gap-4 overflow-x-auto">
        <button
          onClick={() => setActiveTab('my-schedule')}
          className={`pb-3 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'my-schedule'
              ? 'border-navy-900 text-navy-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>My Teaching Schedule</span>
        </button>

        <button
          onClick={() => setActiveTab('override-editor')}
          className={`pb-3 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'override-editor'
              ? 'border-navy-900 text-navy-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Edit3 className="w-4 h-4 text-purple-600" />
          <span>Free Period & Leave Manager</span>
        </button>

        <button
          onClick={() => setActiveTab('availability')}
          className={`pb-3 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'availability'
              ? 'border-navy-900 text-navy-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Department Faculty Availability</span>
        </button>

        <button
          onClick={() => setActiveTab('directory')}
          className={`pb-3 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'directory'
              ? 'border-navy-900 text-navy-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Users className="w-4 h-4 text-emerald-600" />
          <span>Student & Faculty Directory</span>
        </button>

        <button
          onClick={() => setActiveTab('all-timetables')}
          className={`pb-3 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'all-timetables'
              ? 'border-navy-900 text-navy-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>All 4 Years Timetables</span>
        </button>
      </div>

      {/* Feedback Alerts */}
      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {success && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{success}</span>
          </div>
          <button onClick={() => setSuccess('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tab 1: My Teaching Schedule */}
      {activeTab === 'my-schedule' && (
        <div className="space-y-6">
          <div className="bg-navy-900 text-white rounded-2xl p-5 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">
                Your Weekly Consolidated Teaching Schedule
              </h2>
              <p className="text-xs text-slate-300">
                Aggregated across all classes, years (1st–4th), and sections where you are assigned. Faculty schedules continue until 5:00 PM daily.
              </p>
            </div>
            <span className="text-xs font-bold px-3 py-1 rounded-lg bg-navy-800 border border-navy-700 text-amber-300 self-start sm:self-auto">
              {teachingClasses.length} Scheduled Lectures & Labs
            </span>
          </div>

          {/* Active Leave Banner */}
          {myLeaves.filter(l => l.status === 'leave').length > 0 && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 text-rose-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-start sm:items-center gap-2.5">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5 sm:mt-0" />
                <div>
                  <div className="font-extrabold text-rose-950">
                    Active Faculty Leave Intimation:
                  </div>
                  <div className="text-[11px] text-rose-800 mt-0.5">
                    You have marked leave for <strong>{myLeaves.filter(l => l.status === 'leave').map(l => l.leave_date).join(', ')}</strong>. Students, faculty, and administrators have been notified, and your scheduled classes on those dates are tagged as affected.
                  </div>
                </div>
              </div>
              <button
                onClick={() => setActiveTab('override-editor')}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-200/80 hover:bg-rose-300/80 text-rose-950 self-start sm:self-auto cursor-pointer transition-colors"
              >
                Manage Leaves
              </button>
            </div>
          )}

          {/* Schedule Table */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-academic overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead>
                  <tr className="bg-slate-100/90 border-b border-slate-200 text-[11px] font-bold text-navy-900 uppercase tracking-wider">
                    <th className="py-3 px-4 w-36 border-r border-slate-200 text-center">Day / Hour & Timing</th>
                    {[1, 2, 3, 4, 5, 6, 7].map(p => (
                      <th key={p} className="py-3 px-2 text-center border-r border-slate-200">
                        <div className="flex items-center justify-center gap-1">
                          <span>Hour {p}</span>
                          {p === 7 && (
                            <span className="text-[8px] bg-amber-400 text-navy-950 font-black px-1 rounded">to 5 PM</span>
                          )}
                        </div>
                        <div className="text-[9px] font-medium text-slate-500 normal-case">{PERIOD_TIMES[p]}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {DAYS.map(day => (
                    <tr key={day} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 font-bold text-navy-900 bg-slate-50/80 border-r border-slate-200 text-center">
                        {day}
                      </td>
                      {[1, 2, 3, 4, 5, 6, 7].map(p => {
                        const slot = weeklySchedule[day] && weeklySchedule[day][p];
                        const isTeaching = slot && slot.status === 'teaching';
                        const isOverride = slot && slot.override;

                        return (
                          <td key={p} className="p-2 border-r border-slate-200 align-top">
                            {isTeaching ? (
                              <div className="h-20 p-2 rounded-xl bg-navy-50 border border-navy-200 text-navy-950 flex flex-col justify-between">
                                <div className="font-bold text-[11px] leading-tight line-clamp-2">
                                  {slot.detail?.subject}
                                </div>
                                <div className="flex items-center justify-between text-[9px] text-navy-800 font-semibold mt-1">
                                  <span>Yr {slot.detail?.year} ({slot.detail?.section})</span>
                                  {slot.detail?.time_label && (
                                    <span className="text-[8px] bg-navy-100 text-navy-900 px-1 py-0.5 rounded font-mono">
                                      {slot.detail.time_label.split(' - ')[0]}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : isOverride ? (
                              <div className={`h-20 p-2 rounded-xl border flex flex-col justify-between ${
                                slot.override.status === 'leave'
                                  ? 'bg-red-50 border-red-200/90 text-red-950'
                                  : 'bg-yellow-50 border-yellow-200/90 text-yellow-950'
                              }`}>
                                <div>
                                  <div className="font-bold text-[11px] uppercase tracking-wide">
                                    {slot.override.status === 'leave' ? 'LEAVE' : 'BUSY'}
                                  </div>
                                  <div className={`text-[10px] font-semibold mt-0.5 ${
                                    slot.override.status === 'leave' ? 'text-red-800' : 'text-yellow-800'
                                  }`}>
                                    {slot.override.status === 'leave' ? 'On Leave' : 'Unavailable'}
                                  </div>
                                </div>
                                <div className="flex items-center justify-between gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setOverrideModal({
                                      day,
                                      period: p,
                                      status: slot.override.status === 'leave' ? 'leave' : 'busy',
                                      date: slot.override.override_date || selectedLeaveDate,
                                      isExisting: true
                                    })}
                                    className="text-[9px] text-slate-500 hover:text-navy-900 font-bold hover:underline cursor-pointer"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleInitiateRemoveOverride(day, p, slot.override)}
                                    className="text-[9px] text-rose-600 hover:text-rose-800 font-bold hover:underline cursor-pointer"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div 
                                onClick={() => setOverrideModal({ day, period: p, status: 'busy', date: selectedLeaveDate, isExisting: false })}
                                className="h-20 flex flex-col items-center justify-center p-2 rounded-xl border border-dashed border-slate-200 text-slate-400 hover:border-navy-400 hover:text-navy-900 hover:bg-navy-50/30 cursor-pointer transition-all group"
                              >
                                <span className="text-[10px] font-bold text-emerald-600">
                                  {p === 7 ? 'Avail to 5 PM' : 'Free Slot'}
                                </span>
                                <span className="text-[9px] text-slate-400 group-hover:text-navy-700 mt-1 flex items-center gap-0.5">
                                  <Plus className="w-2.5 h-2.5" /> Set Availability
                                </span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Free Period & Leave Manager */}
      {activeTab === 'override-editor' && (
        <div className="space-y-6">

          {/* SECTION 1: OFFICIAL FACULTY LEAVE & ABSENCE MANAGER */}
          <div className="bg-white rounded-2xl p-6 border-2 border-slate-200 shadow-academic">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-navy-100 text-navy-900 border border-navy-200 flex items-center justify-center font-bold shrink-0">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-black text-navy-900 leading-tight">
                    Official Faculty Leave & Absence Manager
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Select a date and set your academic status (Leave, Busy, or Active). Marking Leave broadcasts an official notice to the notification box and flags scheduled classes. Marking Busy updates your availability without dispatching leave notifications. Active is normal availability.
                  </p>
                </div>
              </div>
              {myLeaves.length > 0 && (
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-navy-50 text-navy-900 border border-navy-200 self-start sm:self-auto shrink-0">
                  {myLeaves.length} Logged Record{myLeaves.length > 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Status Form */}
            <form onSubmit={handleSaveLeave} className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Select Target Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={selectedLeaveDate}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className="w-full text-xs font-bold p-2.5 rounded-lg border border-slate-300 bg-white focus:border-navy-900 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Status
                  </label>
                  <select
                    value={leaveStatus}
                    onChange={(e) => setLeaveStatus(e.target.value)}
                    className="w-full text-xs font-bold p-2.5 rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:border-navy-900"
                  >
                    <option value="leave">Leave</option>
                    <option value="busy">Busy</option>
                    <option value="active">Active</option>
                  </select>
                </div>

                <div>
                  <button
                    type="submit"
                    disabled={leaveSaving}
                    className="w-full py-2.5 px-4 text-xs font-bold bg-navy-900 hover:bg-navy-800 text-white rounded-lg transition-all shadow-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <Calendar className="w-4 h-4" />
                    <span>{leaveSaving ? 'Saving...' : 'Save Status'}</span>
                  </button>
                </div>
              </div>
            </form>

            {/* Active Status Records Table */}
            {myLeaves.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100/80 text-[11px] font-bold text-slate-800 uppercase border-b border-slate-200">
                      <th className="py-2.5 px-4">Date</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4">Logged On</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {myLeaves.map(lv => {
                      const isLv = lv.status === 'leave';
                      const isBs = lv.status === 'busy';
                      return (
                        <tr key={lv.id} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-4 font-bold text-navy-900">{lv.leave_date || lv.date}</td>
                          <td className="py-2.5 px-4">
                            {isLv ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-800 border border-rose-300 uppercase">
                                LEAVE
                              </span>
                            ) : isBs ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300 uppercase">
                                BUSY
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300 uppercase">
                                ACTIVE
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-slate-400 text-[11px]">
                            {lv.created_at ? new Date(lv.created_at).toLocaleDateString() : '—'}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleCancelLeave(lv.id)}
                              className="text-xs font-bold text-slate-500 hover:text-rose-700 hover:underline cursor-pointer"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* SECTION 2: FREE PERIOD OVERRIDE MANAGER */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-academic">
            <h2 className="text-lg font-black text-navy-900 mb-1">
              Free Period Availability Manager
            </h2>
            <p className="text-xs text-slate-500 mb-6">
              During your non-teaching periods, you can set custom availability statuses (Busy or Leave) 
              which will immediately reflect on the public Faculty Availability dashboard.
            </p>

            {/* Active Overrides Table */}
            <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-[11px] font-bold text-navy-900 uppercase">
                    <th className="py-2.5 px-4">Day</th>
                    <th className="py-2.5 px-4">Period / Time</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {overrides.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="py-6 text-center text-slate-400 italic">
                        You currently have no manual slot availabilities. All non-teaching slots are shown as "Available (Free)".
                      </td>
                    </tr>
                  ) : (
                    overrides.map(ov => (
                      <tr key={ov.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-bold text-navy-900">{ov.day}</td>
                        <td className="py-3 px-4 font-medium text-slate-700">
                          Period {ov.period} ({PERIOD_TIMES[ov.period]})
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded font-bold text-[10px] uppercase ${
                            ov.status === 'leave'
                              ? 'bg-red-100 text-red-900 border border-red-300'
                              : 'bg-yellow-100 text-yellow-900 border border-yellow-300'
                          }`}>
                            {ov.status === 'leave' ? 'LEAVE' : 'BUSY'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleInitiateRemoveOverride(ov.day, ov.period, ov)}
                            className="text-xs font-bold text-rose-600 hover:text-rose-800 hover:underline cursor-pointer"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Quick Add Override Card */}
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
              <h3 className="text-sm font-bold text-navy-900 mb-3">
                Set a New Slot Availability
              </h3>
              <form onSubmit={handleQuickAddOverride} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">Day</label>
                  <select
                    value={quickOverride.day}
                    onChange={(e) => setQuickOverride(prev => ({ ...prev, day: e.target.value }))}
                    className="w-full text-xs font-semibold p-2 rounded-lg border border-slate-300 bg-white"
                  >
                    {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">Period (1-7)</label>
                  <select
                    value={quickOverride.period}
                    onChange={(e) => setQuickOverride(prev => ({ ...prev, period: parseInt(e.target.value, 10) }))}
                    className="w-full text-xs font-semibold p-2 rounded-lg border border-slate-300 bg-white"
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map(p => (
                      <option key={p} value={p}>Period {p} ({p === 7 ? 'to 5:00 PM' : PERIOD_TIMES[p].split(' - ')[0]})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">Availability Status</label>
                  <select
                    value={quickOverride.status}
                    onChange={(e) => setQuickOverride(prev => ({ ...prev, status: e.target.value }))}
                    className="w-full text-xs font-semibold p-2 rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="busy">Busy</option>
                    <option value="leave">Leave</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    type="submit"
                    className="w-full py-2 px-3 text-xs font-bold bg-navy-900 text-white rounded-lg hover:bg-navy-800 transition-colors shadow-xs cursor-pointer"
                  >
                    Save Availability
                  </button>
                </div>
              </form>
            </div>

          </div>
        </div>
      )}

      {/* Tab 3: Department Availability */}
      {activeTab === 'availability' && (
        <FacultyAvailabilityView 
          user={user} 
          onNavigateToFacultyEditor={() => setActiveTab('override-editor')} 
        />
      )}

      {/* Tab 4: Student & Faculty Directory */}
      {activeTab === 'directory' && (
        <DirectoryView user={user} />
      )}

      {/* Tab 5: All 4 Years Timetables */}
      {activeTab === 'all-timetables' && (
        <TimetableGrid user={user} initialYear={3} />
      )}

      {/* Inline Set Slot Availability Modal */}
      {overrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold text-navy-900">
                Set Slot Availability
              </h3>
              <button 
                type="button" 
                onClick={() => setOverrideModal(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              {overrideModal.day} · Period {overrideModal.period} ({PERIOD_TIMES[overrideModal.period]})
            </p>

            <form onSubmit={handleSaveOverride} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Availability Status
                </label>
                <select
                  value={overrideModal.status}
                  onChange={(e) => setOverrideModal({ ...overrideModal, status: e.target.value })}
                  className="w-full text-xs font-bold p-2.5 rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-navy-900"
                >
                  <option value="busy">Busy</option>
                  <option value="leave">Leave</option>
                </select>
              </div>

              {/* Note / Consultation Details is COMPLETELY REMOVED */}

              <div className="flex items-center justify-between pt-2">
                {overrideModal.isExisting ? (
                  <button
                    type="button"
                    onClick={() => {
                      const target = { ...overrideModal };
                      setOverrideModal(null);
                      handleInitiateRemoveOverride(target.day, target.period, target);
                    }}
                    className="px-3 py-1.5 text-xs font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                  >
                    Remove
                  </button>
                ) : (
                  <div></div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOverrideModal(null)}
                    className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-xs font-bold bg-navy-900 text-white rounded-lg hover:bg-navy-800 cursor-pointer shadow-xs"
                  >
                    Save Availability
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Remove Slot Availability Confirmation Modal */}
      {removeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="w-6 h-6" />
            </div>
            
            <h3 className="text-base font-bold text-navy-900 mb-1">
              Are you sure you want to remove this availability?
            </h3>
            <p className="text-xs text-slate-500 mb-5">
              {removeConfirm.day} · Period {removeConfirm.period} ({PERIOD_TIMES[removeConfirm.period]})
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRemoveConfirm(null)}
                className="w-full py-2.5 px-3 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteRemove}
                className="w-full py-2.5 px-3 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors cursor-pointer shadow-xs"
              >
                Confirm Remove
              </button>
            </div>
          </div>
        </div>
      )}

        </div>
      </div>
    </div>
  );
}
