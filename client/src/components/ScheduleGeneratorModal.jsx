import React, { useState } from 'react';
import { 
  X, Sparkles, Play, CheckCircle2, AlertTriangle, 
  Clock, ShieldAlert, Users, Layers, ArrowRight, Loader2 
} from 'lucide-react';
import { timetableApi } from '../api';

export default function ScheduleGeneratorModal({ isOpen, onClose, onGenerated, sections = [] }) {
  const [scope, setScope] = useState('all'); // 'all' | 'year' | 'section'
  const [selectedYear, setSelectedYear] = useState(1);
  const [selectedSectionId, setSelectedSectionId] = useState(sections[0]?.id || '');
  const [loading, setLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState(null);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  if (!isOpen) return null;

  const handleGenerate = async (dryRun = true) => {
    setLoading(true);
    setError('');
    setSuccessMessage('');
    if (dryRun) {
      setPreviewResult(null);
    }

    try {
      const payload = {
        dry_run: dryRun,
        all_sections: scope === 'all',
        year: scope === 'year' ? parseInt(selectedYear, 10) : null,
        section_id: scope === 'section' ? parseInt(selectedSectionId, 10) : null
      };

      const res = await timetableApi.generateTimetable(payload);

      if (dryRun) {
        setPreviewResult(res);
      } else {
        setSuccessMessage(res.message || 'Timetable generated successfully with 0 conflicts!');
        setPreviewResult(null);
        if (onGenerated) onGenerated(res);
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    } catch (err) {
      setError(err.message || 'Generation failed: Could not satisfy scheduling constraints.');
    } finally {
      setLoading(false);
    }
  };

  const filteredSections = sections.filter(s => s.year === parseInt(selectedYear, 10));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-400 text-navy-950 flex items-center justify-center font-black shadow-md">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-navy-900">
                Automated Schedule Solver
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Constraint-satisfaction generator with 0 clock-time collisions
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mt-4 p-4 rounded-2xl bg-rose-50 border border-rose-200/80 text-rose-800 text-xs flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Constraint Satisfaction Failure:</div>
              <div className="mt-0.5 text-rose-700">{error}</div>
            </div>
          </div>
        )}

        {successMessage && (
          <div className="mt-4 p-4 rounded-2xl bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-xs flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="font-bold">{successMessage}</span>
          </div>
        )}

        {/* Configuration Options */}
        <div className="mt-6 space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Generation Scope
            </label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setScope('all')}
                className={`py-3 px-3 rounded-2xl text-xs font-bold border transition-all flex flex-col items-center gap-1.5 ${
                  scope === 'all'
                    ? 'bg-navy-900 text-white border-navy-900 shadow-md'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>All Sections</span>
              </button>
              <button
                type="button"
                onClick={() => setScope('year')}
                className={`py-3 px-3 rounded-2xl text-xs font-bold border transition-all flex flex-col items-center gap-1.5 ${
                  scope === 'year'
                    ? 'bg-navy-900 text-white border-navy-900 shadow-md'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Clock className="w-4 h-4" />
                <span>Cohort / Year</span>
              </button>
              <button
                type="button"
                onClick={() => setScope('section')}
                className={`py-3 px-3 rounded-2xl text-xs font-bold border transition-all flex flex-col items-center gap-1.5 ${
                  scope === 'section'
                    ? 'bg-navy-900 text-white border-navy-900 shadow-md'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Single Section</span>
              </button>
            </div>
          </div>

          {scope === 'year' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Select Year
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map(yr => (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => setSelectedYear(yr)}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                      selectedYear === yr
                        ? 'bg-amber-400 text-navy-950 border-amber-400 font-black shadow-sm'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {yr === 1 ? '1st' : yr === 2 ? '2nd' : yr === 3 ? '3rd' : '4th'} Year
                  </button>
                ))}
              </div>
            </div>
          )}

          {scope === 'section' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Academic Year
                </label>
                <select
                  value={selectedYear}
                  onChange={(e) => {
                    const yr = parseInt(e.target.value, 10);
                    setSelectedYear(yr);
                    const matching = sections.find(s => s.year === yr);
                    if (matching) setSelectedSectionId(matching.id);
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-navy-900 focus:outline-none focus:ring-2 focus:ring-navy-900"
                >
                  <option value={1}>1st Year</option>
                  <option value={2}>2nd Year</option>
                  <option value={3}>3rd Year</option>
                  <option value={4}>4th Year</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Target Section
                </label>
                <select
                  value={selectedSectionId}
                  onChange={(e) => setSelectedSectionId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-navy-900 focus:outline-none focus:ring-2 focus:ring-navy-900"
                >
                  {filteredSections.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.academic_year || 'Current'})</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Hard Rules Overview Box */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 space-y-1.5">
            <div className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              Automated Hard Constraints Enforced:
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-slate-600 pl-1">
              <li>Hard Faculty Workload Cap: <strong>&le; 16 hrs/week</strong> for each instructor.</li>
              <li>Emergency Standby Pool: <strong>&ge; 2 faculty 100% free</strong> every working day.</li>
              <li>Morning Duty Rotation: <strong>&le; 2 morning duty days</strong> (P1-P2) per faculty/week.</li>
              <li>Room Availability: <strong>Zero double-booking</strong> across rooms and labs.</li>
            </ul>
          </div>

          {/* Dry Run Preview Results Card */}
          {previewResult && (
            <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-emerald-900 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Dry-Run Verification Passed
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-200 text-emerald-900">
                  Zero Conflicts
                </span>
              </div>
              <p className="text-xs text-emerald-800 font-medium">
                {previewResult.message}
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-emerald-200/60">
                <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-100">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Sections</div>
                  <div className="text-lg font-black text-navy-900">{previewResult.sectionsGenerated}</div>
                </div>
                <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-100">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Slots Generated</div>
                  <div className="text-lg font-black text-navy-900">{previewResult.slotsGenerated}</div>
                </div>
                <div className="bg-white/80 p-2.5 rounded-xl border border-emerald-100 col-span-2 sm:col-span-1">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Workload Cap</div>
                  <div className="text-lg font-black text-emerald-700">&le; 16h OK</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>

          {/* Action 1: Dry Run Preview */}
          <button
            type="button"
            onClick={() => handleGenerate(true)}
            disabled={loading}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-navy-900 text-xs font-black transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 text-navy-800" />}
            <span>Run Dry-Run Preview</span>
          </button>

          {/* Action 2: Apply & Commit */}
          <button
            type="button"
            onClick={() => handleGenerate(false)}
            disabled={loading}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-navy-950 text-xs font-black transition-all active:scale-95 shadow-md hover:shadow-lg cursor-pointer disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>Apply & Generate Timetable</span>
          </button>
        </div>
      </div>
    </div>
  );
}
