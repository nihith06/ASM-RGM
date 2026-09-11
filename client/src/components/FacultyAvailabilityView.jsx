import React, { useState, useEffect } from 'react';
import { 
  Clock, 
  Search, 
  Filter, 
  User, 
  CheckCircle, 
  BookOpen, 
  Calendar, 
  HelpCircle, 
  Sparkles, 
  Edit2, 
  ChevronRight,
  X,
  AlertCircle,
  Check
} from 'lucide-react';
import { facultyApi } from '../api';

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


export default function FacultyAvailabilityView({ user, onNavigateToFacultyEditor }) {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedDay, setSelectedDay] = useState('Monday');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'free' | 'busy' | 'teaching' | 'on_leave'
  const [availabilityList, setAvailabilityList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('matrix'); // 'matrix' | 'cards'

  // Set Slot Availability modal state (strictly busy or leave)
  const [overrideModal, setOverrideModal] = useState(null); // { day, period, status, date, isExisting }

  // Remove Slot Availability confirmation dialog state
  const [removeConfirm, setRemoveConfirm] = useState(null); // { day, period, date }

  const [actionSuccess, setActionSuccess] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    loadAvailability();
    const handleSync = () => loadAvailability(true);
    window.addEventListener('rgmcet_notifications_updated', handleSync);
    window.addEventListener('rgmcet_timetable_updated', handleSync);
    return () => {
      window.removeEventListener('rgmcet_notifications_updated', handleSync);
      window.removeEventListener('rgmcet_timetable_updated', handleSync);
    };
  }, [selectedDay, searchTerm, selectedDate]);

  const handleSaveOverride = async (e) => {
    e.preventDefault();
    if (!overrideModal) return;
    try {
      await facultyApi.setOverride(
        overrideModal.day,
        overrideModal.period,
        overrideModal.status,
        overrideModal.date || selectedDate
      );
      setActionSuccess(`Availability set to ${overrideModal.status === 'busy' ? 'Busy' : 'Leave'} for ${overrideModal.day} Period ${overrideModal.period}!`);
      setOverrideModal(null);
      loadAvailability();
      window.dispatchEvent(new CustomEvent('rgmcet_notifications_updated'));
      setTimeout(() => setActionSuccess(''), 3000);
    } catch (err) {
      setActionError(err.message || 'Failed to update availability.');
    }
  };

  const handleInitiateRemoveOverride = (day, period, date) => {
    setRemoveConfirm({
      day,
      period,
      date: date || selectedDate
    });
  };

  const handleExecuteRemove = async () => {
    if (!removeConfirm) return;
    try {
      await facultyApi.deleteOverride(removeConfirm.day, removeConfirm.period, removeConfirm.date);
      setActionSuccess(`Removed availability for ${removeConfirm.day} Period ${removeConfirm.period}.`);
      setRemoveConfirm(null);
      loadAvailability();
      window.dispatchEvent(new CustomEvent('rgmcet_notifications_updated'));
      setTimeout(() => setActionSuccess(''), 3000);
    } catch (err) {
      setActionError(err.message || 'Failed to remove availability.');
    }
  };

  const loadAvailability = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await facultyApi.getAvailability(selectedDay, searchTerm, selectedDate);
      setAvailabilityList(data.faculty_availability || []);
    } catch (err) {
      console.error('Failed to load faculty availability:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleDateChange = (newDate) => {
    setSelectedDate(newDate);
    if (newDate) {
      const parsed = new Date(newDate + 'T00:00:00');
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = dayNames[parsed.getDay()];
      if (DAYS.includes(dayName)) {
        setSelectedDay(dayName);
      }
    }
  };

  // Filter list based on status
  const filteredFaculty = availabilityList.filter(f => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'on_leave') return f.is_on_leave;
    if (statusFilter === 'busy') return f.is_busy;
    const daySchedule = (f.schedule && f.schedule[selectedDay]) || {};
    return Object.values(daySchedule).some(slot => slot.status === statusFilter);
  });

  return (
    <div className="space-y-6">
      
      {/* Header Banner */}
      <div className="bg-navy-900 text-white rounded-2xl p-6 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-navy-800 text-amber-300 text-xs font-bold mb-2 border border-navy-700">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Real-Time Academic Availability</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight">
              Department Faculty Availability & Free Periods
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
              Faculty availability and schedules continue until 5:00 PM daily (2nd–4th year classes finish at 4:20 PM; 1st year runs until 5:00 PM). Faculty can teach across multiple academic years on the same day without clock-time conflicts.
            </p>
          </div>

          {user && user.role === 'faculty' && (
            <button
              onClick={onNavigateToFacultyEditor}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-navy-950 font-black text-xs transition-all shadow-sm active:scale-95 shrink-0"
            >
              <Edit2 className="w-4 h-4" />
              <span>Manage My Free Periods</span>
            </button>
          )}
        </div>

        {/* Legend */}
        <div className="mt-6 pt-4 border-t border-navy-800 flex flex-wrap items-center gap-4 text-xs">
          <span className="font-bold text-slate-400 uppercase text-[10px] tracking-wider">
            Status Legend:
          </span>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
            <span className="text-slate-200 font-medium">Free / Available</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-400"></span>
            <span className="text-slate-200 font-medium">Teaching Class</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-yellow-400"></span>
            <span className="text-slate-200 font-medium">Busy</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-rose-600"></span>
            <span className="text-slate-200 font-medium">On Leave</span>
          </div>
        </div>
      </div>

      {/* Controls Bar: Day Selector, Search, Filter */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-academic flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        
        {/* Date & Day Selectors */}
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
              Target Date
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-200 bg-slate-50 focus:outline-hidden focus:border-navy-900"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
              Weekday
            </label>
            <div className="inline-flex flex-wrap rounded-xl p-1 bg-slate-100 border border-slate-200 gap-1">
              {DAYS.map(day => (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    selectedDay === day
                      ? 'bg-navy-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-navy-900 hover:bg-slate-200/50'
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Search & Status Filter */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Box */}
          <div className="relative min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search faculty name / ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs font-medium rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900 bg-slate-50/50"
            />
          </div>

          {/* Status Dropdown */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl px-3 py-1.5 focus:outline-hidden focus:border-navy-900"
          >
            <option value="all">All Statuses</option>
            <option value="on_leave">⚠️ On Leave Only</option>
            <option value="busy">⏳ Busy Only</option>
            <option value="free">Available / Free Only</option>
            <option value="teaching">Teaching Class Only</option>
          </select>

          {/* View Mode Toggle */}
          <div className="inline-flex rounded-xl p-1 bg-slate-100 border border-slate-200">
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg ${
                viewMode === 'matrix' ? 'bg-white text-navy-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg ${
                viewMode === 'cards' ? 'bg-white text-navy-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Cards
            </button>
          </div>
        </div>

      </div>

      {/* Main View */}
      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 text-slate-400">
          <Clock className="w-8 h-8 mx-auto mb-2 animate-spin text-navy-800" />
          <p className="text-sm font-semibold">Computing real-time faculty availability matrix...</p>
        </div>
      ) : filteredFaculty.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 text-slate-400">
          <User className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm font-semibold">No faculty found matching the criteria.</p>
        </div>
      ) : viewMode === 'matrix' ? (
        /* Matrix Grid View: Faculty Rows x Periods 1-7 Columns */
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-academic overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="bg-slate-100/90 border-b border-slate-200 text-[11px] font-bold text-navy-900 uppercase tracking-wider">
                  <th className="py-3.5 px-4 w-60 border-r border-slate-200">Faculty Member</th>
                  <th className="py-3.5 px-2 text-center w-28 border-r border-slate-200">
                    <div>P1</div>
                    <div className="text-[9px] font-medium text-slate-500 normal-case">{PERIOD_TIMES[1]}</div>
                  </th>
                  <th className="py-3.5 px-2 text-center w-28 border-r border-slate-200">
                    <div>P2</div>
                    <div className="text-[9px] font-medium text-slate-500 normal-case">{PERIOD_TIMES[2]}</div>
                  </th>
                  <th className="py-3.5 px-2 text-center w-28 border-r border-slate-200">
                    <div>P3</div>
                    <div className="text-[9px] font-medium text-slate-500 normal-case">{PERIOD_TIMES[3]}</div>
                  </th>
                  <th className="py-3.5 px-2 text-center w-28 border-r border-slate-200">
                    <div>P4</div>
                    <div className="text-[9px] font-medium text-slate-500 normal-case">{PERIOD_TIMES[4]}</div>
                  </th>
                  <th className="py-3.5 px-2 text-center w-28 border-r border-slate-200">
                    <div>P5</div>
                    <div className="text-[9px] font-medium text-slate-500 normal-case">{PERIOD_TIMES[5]}</div>
                  </th>
                  <th className="py-3.5 px-2 text-center w-28 border-r border-slate-200">
                    <div>P6</div>
                    <div className="text-[9px] font-medium text-slate-500 normal-case">{PERIOD_TIMES[6]}</div>
                  </th>
                  <th className="py-3.5 px-2 text-center w-28">
                    <div className="flex items-center justify-center gap-1">
                      <span>P7</span>
                      <span className="text-[8px] bg-amber-400 text-navy-950 font-black px-1 rounded">to 5 PM</span>
                    </div>
                    <div className="text-[9px] font-medium text-slate-500 normal-case">{PERIOD_TIMES[7]}</div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredFaculty.map(fac => {
                  const daySlots = (fac.schedule && fac.schedule[selectedDay]) || {};

                  return (
                    <tr key={fac.id} className="hover:bg-slate-50/50 transition-colors">
                      {/* Faculty Info */}
                      <td className="py-3 px-4 border-r border-slate-200 bg-slate-50/30">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-navy-900">{fac.name}</span>
                          {fac.is_on_leave ? (
                            <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 font-extrabold text-[9px] uppercase tracking-wider">
                              On Leave
                            </span>
                          ) : fac.is_busy ? (
                            <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-900 border border-yellow-300 font-extrabold text-[9px] uppercase tracking-wider">
                              Busy
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-slate-500">{fac.designation || 'Faculty'}</div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">ID: {fac.register_id}</div>
                      </td>

                      {/* Periods 1 to 7 */}
                      {[1, 2, 3, 4, 5, 6, 7].map(p => {
                        const slot = daySlots[p] || { status: 'free', label: 'Free' };
                        const isOwnRow = user && user.role === 'faculty' && fac.id === user.id;
                        const isInteractive = isOwnRow && slot.status !== 'teaching';

                        return (
                          <td 
                            key={p} 
                            onClick={() => {
                              if (isInteractive) {
                                setOverrideModal({
                                  day: selectedDay,
                                  period: p,
                                  status: (slot.status === 'leave' || slot.is_on_leave) ? 'leave' : 'busy',
                                  date: selectedDate,
                                  isExisting: Boolean(slot.override_id || slot.status === 'busy' || slot.status === 'leave')
                                });
                              }
                            }}
                            className={`p-2 border-r border-slate-200 align-middle text-center ${
                              isInteractive ? 'cursor-pointer hover:bg-slate-100/90 transition-all active:scale-98' : ''
                            }`}
                            title={isInteractive ? 'Click to Set Slot Availability' : undefined}
                          >
                            <SlotBadge slot={slot} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Cards View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredFaculty.map(fac => {
            const daySlots = (fac.schedule && fac.schedule[selectedDay]) || {};
            const freeSlots = Object.entries(daySlots).filter(([_, s]) => s.status === 'free');
            const teachingSlots = Object.entries(daySlots).filter(([_, s]) => s.status === 'teaching');
            const busySlots = Object.entries(daySlots).filter(([_, s]) => s.status === 'busy');

            return (
              <div 
                key={fac.id}
                className="bg-white rounded-2xl p-5 border border-slate-200 shadow-academic hover:shadow-academic-hover transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-navy-900">{fac.name}</h3>
                      {fac.is_on_leave ? (
                        <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 font-extrabold text-[10px] uppercase tracking-wide">
                          On Leave
                        </span>
                      ) : fac.is_busy ? (
                        <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-900 border border-yellow-300 font-extrabold text-[10px] uppercase tracking-wide">
                          Busy
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-500">{fac.designation}</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-navy-50 text-navy-900 border border-navy-200">
                    {fac.register_id}
                  </span>
                </div>

                {fac.is_on_leave && (
                  <div className="mb-3 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
                    ⚠️ On Leave on {selectedDate}
                  </div>
                )}
                {fac.is_busy && (
                  <div className="mb-3 px-3 py-2 rounded-xl bg-yellow-50 border border-yellow-200 text-yellow-900 text-xs font-bold">
                    ⏳ Busy / Unavailable on {selectedDate}
                  </div>
                )}

                <div className="space-y-2 mt-4 pt-3 border-t border-slate-100 text-xs">
                  <div>
                    <div className="text-[11px] font-bold text-emerald-700 flex items-center gap-1 mb-1">
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>Available Free Periods on {selectedDay}:</span>
                    </div>
                    {freeSlots.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {freeSlots.map(([p]) => (
                          <span key={p} className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-[10px]">
                            {p === '7' ? 'Period 7 (to 5:00 PM)' : `Period ${p} (${PERIOD_TIMES[p].split(' - ')[0]})`}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-400 italic text-[11px]">No free periods on {selectedDay}</span>
                    )}
                  </div>

                  {teachingSlots.length > 0 && (
                    <div className="pt-2">
                      <div className="text-[11px] font-bold text-red-700 mb-1">
                        📚 Teaching Classes ({selectedDay}):
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {teachingSlots.map(([p, s]) => (
                          <span key={p} title={s.note} className="px-2 py-0.5 rounded bg-red-50 text-red-900 border border-red-200 font-bold text-[10px]">
                            P{p}: {s.classes?.[0]?.subject || 'Class'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {busySlots.length > 0 && (
                    <div className="pt-2">
                      <div className="text-[11px] font-bold text-yellow-800 mb-1">
                        ⏳ Busy Periods ({selectedDay}):
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {busySlots.map(([p]) => (
                          <span key={p} className="px-2 py-0.5 rounded bg-yellow-50 text-yellow-900 border border-yellow-200 font-bold text-[10px]">
                            Period {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Toast Feedback */}
      {actionSuccess && (
        <div className="fixed bottom-6 right-6 z-50 p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold shadow-lg flex items-center gap-2 animate-scale-up">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}
      {actionError && (
        <div className="fixed bottom-6 right-6 z-50 p-3.5 rounded-xl bg-red-50 border border-red-300 text-red-800 text-xs font-bold shadow-lg flex items-center gap-2 animate-scale-up">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Set Slot Availability Modal */}
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
                      handleInitiateRemoveOverride(target.day, target.period, target.date);
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
  );
}

// Helper to render color-coded slot pill in matrix view
function SlotBadge({ slot }) {
  if (slot.status === 'on_leave' || slot.is_on_leave || slot.status === 'leave') {
    return (
      <div 
        title="Faculty is On Leave"
        className="w-full py-2 px-1 rounded-lg bg-red-50 text-red-950 border border-red-200/90 flex flex-col items-center justify-center font-bold text-[10px]"
      >
        <span className="text-red-950 font-black">ON LEAVE</span>
        <span className="text-[9px] font-medium text-red-700 truncate max-w-[85px]">
          Absent
        </span>
      </div>
    );
  }

  if (slot.status === 'busy' || slot.is_busy) {
    return (
      <div 
        title="Faculty is Busy / Unavailable"
        className="w-full py-2 px-1 rounded-lg bg-yellow-50 text-yellow-950 border border-yellow-200/90 flex flex-col items-center justify-center font-bold text-[10px]"
      >
        <span className="text-yellow-950 font-black">BUSY</span>
        <span className="text-[9px] font-medium text-yellow-800 truncate max-w-[85px]">
          Unavailable
        </span>
      </div>
    );
  }

  if (slot.status === 'free') {
    return (
      <div 
        title={slot.period === 7 ? "Available until 5:00 PM" : "Available for student queries & consultations"}
        className="w-full py-2 px-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200/80 flex flex-col items-center justify-center font-bold text-[10px]"
      >
        <span>Available</span>
        <span className="text-[9px] font-medium text-emerald-600">
          {slot.period === 7 ? 'Avail to 5 PM' : 'Free Period'}
        </span>
      </div>
    );
  }

  if (slot.status === 'unavailable') {
    return (
      <div 
        title={slot.note || 'Marked as Unavailable'}
        className="w-full py-2 px-1 rounded-lg bg-yellow-50 text-yellow-950 border border-yellow-200/90 flex flex-col items-center justify-center font-bold text-[10px]"
      >
        <span className="text-yellow-950 font-black">BUSY</span>
        <span className="text-[9px] font-medium text-yellow-800 truncate max-w-[85px]">
          Unavailable
        </span>
      </div>
    );
  }

  // Teaching class - Light Red styling
  const firstClass = slot.classes && slot.classes[0];
  return (
    <div 
      title={slot.note}
      className="w-full py-2 px-1 rounded-lg bg-red-50 text-red-950 border border-red-200/90 flex flex-col items-center justify-center text-[10px]"
    >
      <span className="font-bold text-red-950">Teaching</span>
      <span className="text-[9px] text-red-800 font-semibold truncate max-w-[85px]">
        {firstClass ? `${firstClass.subject} (Yr ${firstClass.year})` : 'Class'}
      </span>
      {firstClass?.time_label && (
        <span className="text-[8px] text-red-600 font-mono font-medium">
          {firstClass.time_label.split(' - ')[0]}
        </span>
      )}
    </div>
  );
}
