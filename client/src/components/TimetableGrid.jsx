import React, { useState, useEffect, useRef } from 'react';
import { 
  Calendar, 
  Clock, 
  Layers, 
  Plus, 
  Edit3, 
  FileSpreadsheet, 
  Printer, 
  Download, 
  Check, 
  X, 
  AlertCircle,
  Sparkles,
  BookOpen,
  User,
  Trash2,
  Wand2,
  Loader2
} from 'lucide-react';
import { timetableApi, directoryApi } from '../api';
import OfficialPdfDocument, { exportToOfficialPdf } from './OfficialPdfDocument';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Timing definition for 1st Year (7 periods, 50 minutes each, classes until 5:00 PM)
const YEAR_1_PERIOD_TIMES = {
  1: '09:00 - 09:50 AM',
  2: '09:50 - 10:40 AM',
  3: '11:00 - 11:50 AM',
  4: '01:00 - 01:50 PM',
  5: '01:50 - 02:40 PM',
  6: '03:00 - 03:50 PM',
  7: '04:00 - 04:50 PM'
};

// Timing definition for 2nd, 3rd, 4th Years (Image 1: Classes until 4:20 PM)
const SENIOR_YEAR_PERIOD_TIMES = {
  1: '09:00 - 09:50 AM',
  2: '09:50 - 10:40 AM',
  3: '11:00 - 11:50 AM',
  4: '11:50 - 12:40 PM',
  5: '01:50 - 02:40 PM',
  6: '02:40 - 03:30 PM',
  7: '03:30 - 04:20 PM'
};

const getPeriodTime = (year, period) => {
  if (year === 1) {
    return YEAR_1_PERIOD_TIMES[period] || '';
  }
  return SENIOR_YEAR_PERIOD_TIMES[period] || '';
};

export const isYear1AimlSubject = (subject) => {
  if (!subject) return false;
  const s = subject.trim().toUpperCase();
  return s === 'IP' || s.startsWith('IP ') || s.includes('CP LAB');
};

export const isYear2AimlSubject = (subject) => {
  if (!subject) return false;
  const s = subject.trim().toUpperCase();
  return s === 'AI' || s === 'ADSA' || s === 'ADSA LAB' || s === 'UHV' || s === 'PYP' || s === 'PYP LAB' || s === 'OOPJ' || s === 'OOPJ LAB';
};

export default function TimetableGrid({ user, initialYear = 3, hideControls = false, initialDate = null }) {
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [selectedDate, setSelectedDate] = useState(() => initialDate || new Date().toISOString().split('T')[0]);
  const [sections, setSections] = useState([]);
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [gridData, setGridData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (initialYear) {
      setSelectedYear(initialYear);
      setSelectedSectionId(null);
    }
  }, [initialYear]);

  // Admin Modals & Edit States
  const [editingCell, setEditingCell] = useState(null); // { day, period, subject, faculty_name, room }
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [csvContent, setCsvContent] = useState('');
  const [isAddSectionOpen, setIsAddSectionOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');

  // Automated Generator & PDF Export States
  const [facultyDetails, setFacultyDetails] = useState([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [generateScope, setGenerateScope] = useState('section'); // 'section' | 'all'
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateResult, setGenerateResult] = useState(null);

  // Faculty list for dropdown suggestions (if admin)
  const [facultySuggestions, setFacultySuggestions] = useState([]);

  const isAdmin = user && user.role === 'admin';
  const isStudent = user && user.role === 'student';

  useEffect(() => {
    loadTimetable(selectedYear, selectedSectionId, selectedDate);
  }, [selectedYear, selectedSectionId, selectedDate]);

  useEffect(() => {
    if (isAdmin) {
      loadFacultyList();
    }
  }, [isAdmin]);

  const loadFacultyList = async () => {
    try {
      const res = await directoryApi.getFaculty();
      if (res.faculty) setFacultySuggestions(res.faculty);
    } catch (e) {
      // ignore
    }
  };

  const loadTimetable = async (year, secId, date = selectedDate, silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await timetableApi.getTimetable(year, secId, date);
      setSections(data.sections || []);
      if (data.section) {
        setSelectedSectionId(data.section.id);
      } else if (data.sections && data.sections.length > 0 && !secId) {
        setSelectedSectionId(data.sections[0].id);
      }
      setGridData(data.grid || {});
      setFacultyDetails(data.faculty_details || []);
    } catch (err) {
      if (!silent) setError(err.message || 'Failed to load timetable data.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Real-time synchronization listener & version polling
  const lastKnownVersion = useRef(0);
  const editingCellRef = useRef(editingCell);
  editingCellRef.current = editingCell;

  useEffect(() => {
    const handleRemoteUpdate = (event) => {
      // Preserve user's unsaved in-progress changes in modal
      if (editingCellRef.current) return;
      loadTimetable(selectedYear, selectedSectionId, selectedDate, true);
    };

    window.addEventListener('rgmcet_timetable_updated', handleRemoteUpdate);

    // Version polling fallback every 2.5 seconds
    const pollInterval = setInterval(async () => {
      if (editingCellRef.current) return;
      try {
        const verData = await timetableApi.getVersion();
        if (verData && verData.version) {
          if (lastKnownVersion.current && verData.version > lastKnownVersion.current) {
            loadTimetable(selectedYear, selectedSectionId, selectedDate, true);
          }
          lastKnownVersion.current = verData.version;
        }
      } catch (e) {}
    }, 2500);

    return () => {
      window.removeEventListener('rgmcet_timetable_updated', handleRemoteUpdate);
      clearInterval(pollInterval);
    };
  }, [selectedYear, selectedSectionId, selectedDate]);

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    setError('');
    try {
      const activeSec = sections.find(s => s.id === selectedSectionId) || { name: 'Section_A' };
      const filename = `RGMCET_AIML_Year${selectedYear}_${(activeSec.name || 'Section').replace(/\s+/g, '_')}_Timetable.pdf`;
      await exportToOfficialPdf('official-pdf-export-container', filename);
      setSuccess(`Official timetable PDF downloaded for Year ${selectedYear} ${activeSec.name}!`);
      setTimeout(() => setSuccess(''), 3500);
    } catch (err) {
      setError(err.message || 'Failed to generate and download PDF.');
    } finally {
      setPdfLoading(false);
    }
  };

  const handleRunGenerator = async () => {
    setGenerateLoading(true);
    setError('');
    setGenerateResult(null);
    try {
      const payload = generateScope === 'all'
        ? { all_sections: true }
        : { section_id: selectedSectionId, year: selectedYear };
      const res = await timetableApi.generateTimetable(payload);
      setGenerateResult(res);
      setSuccess(res.message || 'Timetable generated successfully with zero conflicts!');
      loadTimetable(selectedYear, selectedSectionId);
      setTimeout(() => setSuccess(''), 4500);
    } catch (err) {
      setError(err.message || 'Constraint satisfaction generator failed.');
    } finally {
      setGenerateLoading(false);
    }
  };

  const handleCellSave = async (e) => {
    e.preventDefault();
    if (!isAdmin || !editingCell) return;

    try {
      const periodsToUpdate = editingCell.periods || [editingCell.period];
      const isSem = (editingCell.subject || '').trim().toUpperCase() === 'SEM';
      const isYear1NonAiml = selectedYear === 1 && !isYear1AimlSubject(editingCell.subject);
      const isYear2NonAiml = selectedYear === 2 && !isYear2AimlSubject(editingCell.subject);
      const effectiveFaculty = (isSem || isYear1NonAiml || isYear2NonAiml) ? '—' : (editingCell.faculty_name || '—');

      await timetableApi.updateCell({
        year: selectedYear,
        section_id: selectedSectionId,
        day: editingCell.day,
        period: editingCell.period,
        periods: periodsToUpdate,
        subject: editingCell.subject,
        faculty_name: effectiveFaculty,
        room: ''
      });

      // Update local state instantly
      setGridData(prev => {
        const dayCopy = { ...(prev[editingCell.day] || {}) };
        for (const p of periodsToUpdate) {
          dayCopy[p] = {
            subject: editingCell.subject || '—',
            faculty_name: effectiveFaculty,
            room: ''
          };
        }
        return {
          ...prev,
          [editingCell.day]: dayCopy
        };
      });

      setEditingCell(null);
      setSuccess(
        periodsToUpdate.length > 1
          ? `Updated ${editingCell.day} Periods ${periodsToUpdate.join(', ')}!`
          : `Updated ${editingCell.day} Period ${editingCell.period}!`
      );
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to update slot.');
    }
  };


  const handleAddSection = async (e) => {
    e.preventDefault();
    if (!newSectionName.trim()) return;

    try {
      const res = await timetableApi.addSection(selectedYear, newSectionName.trim());
      setSuccess(`Section "${newSectionName.trim()}" added to Year ${selectedYear}!`);
      setNewSectionName('');
      setIsAddSectionOpen(false);
      // Reload timetable
      loadTimetable(selectedYear, res.section.id);
    } catch (err) {
      setError(err.message || 'Failed to add section.');
    }
  };

  const handleDeleteSection = async (sectionId) => {
    if (!confirm('Are you sure you want to delete this section and all its timetable entries?')) return;
    try {
      await timetableApi.deleteSection(sectionId);
      setSuccess('Section deleted successfully.');
      loadTimetable(selectedYear, null);
    } catch (err) {
      setError(err.message || 'Failed to delete section.');
    }
  };

  const handleImportCsv = async (e) => {
    e.preventDefault();
    if (!csvContent.trim()) return;

    try {
      const res = await timetableApi.importCsv(selectedYear, selectedSectionId, csvContent);
      setSuccess(res.message || 'CSV imported successfully!');
      setIsCsvModalOpen(false);
      setCsvContent('');
      loadTimetable(selectedYear, selectedSectionId);
    } catch (err) {
      setError(err.message || 'CSV import failed.');
    }
  };

  const handleDownloadTemplate = () => {
    const header = 'Day,Period,Subject,Faculty\n';
    let sampleRows;
    if (selectedYear === 1) {
      sampleRows = [
        'Monday,1,BEE - A,—',
        'Monday,2,BEE - A,—',
        'Monday,3,IP,Dr. Chakrapani',
        'Monday,4,EP,—',
        'Monday,5,ITWS,—',
        'Tuesday,1,IP,Dr. Chakrapani',
        'Tuesday,2,IP,Dr. Chakrapani'
      ].join('\n');
    } else if (selectedYear === 2) {
      sampleRows = [
        'Monday,1,PYP,Mr. N. Bala Kishore',
        'Monday,2,PYP,Mr. N. Bala Kishore',
        'Monday,3,OOPJ LAB,Mrs. B.V.S.N. Lakshmi',
        'Monday,4,OOPJ LAB,Mrs. B.V.S.N. Lakshmi',
        'Monday,5,SEM,—',
        'Monday,6,DMGT,—',
        'Monday,7,DMGT,—',
        'Tuesday,1,TRAINING PROGRAM,—',
        'Tuesday,6,ADSA,Dr. J. Avinash'
      ].join('\n');
    } else {
      sampleRows = [
        'Monday,1,NLP,Prof. M. Suresh',
        'Monday,2,NLP,Prof. M. Suresh',
        'Monday,3,QT&A,Prof. T. Rajesh',
        'Monday,4,QT&A,Prof. T. Rajesh',
        'Monday,5,SEM,—',
        'Monday,6,SSP,Dr. S. Priya',
        'Monday,7,SSP,Dr. S. Priya',
        'Tuesday,1,CV&IP,Dr. S. Priya',
        'Tuesday,2,CV&IP,Dr. S. Priya'
      ].join('\n');
    }

    const blob = new Blob([header + sampleRows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `RGMCET_AIML_Year${selectedYear}_Timetable_Template.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const activeSection = sections.find(s => s.id === selectedSectionId);

  // Helper to render consecutive period cells, merging adjacent periods with identical subjects
  // CRITICAL: Merging is strictly confined within periodList so it never merges across breaks!
  const renderPeriodGroup = (periodList, dayCells, day) => {
    const elements = [];
    let i = 0;
    while (i < periodList.length) {
      const p = periodList[i];
      const cell = dayCells[p] || { subject: '—', faculty_name: '—', room: '' };
      const hasSubject = cell.subject && cell.subject !== '—';

      let span = 1;
      const mergedPeriods = [p];

      if (hasSubject) {
        // Look ahead within this contiguous period group only
        while (i + span < periodList.length) {
          const nextP = periodList[i + span];
          const nextCell = dayCells[nextP];
          if (
            nextCell &&
            nextCell.subject &&
            nextCell.subject !== '—' &&
            nextCell.subject.trim().toLowerCase() === cell.subject.trim().toLowerCase()
          ) {
            span++;
            mergedPeriods.push(nextP);
          } else {
            break;
          }
        }
      }

      elements.push(
        <td
          key={`${day}-${p}`}
          colSpan={span}
          onClick={() => {
            if (isAdmin) {
              setEditingCell({
                day,
                period: p,
                periods: mergedPeriods,
                subject: cell.subject === '—' ? '' : cell.subject,
                faculty_name: cell.faculty_name === '—' ? '' : cell.faculty_name,
                room: cell.room || ''
              });
            }
          }}
          className={`p-2.5 border-r border-slate-200 align-top transition-colors ${
            isAdmin ? 'cursor-pointer hover:bg-navy-50/50' : ''
          }`}
        >
          <CellContent cell={cell} span={span} periods={mergedPeriods} year={selectedYear} isStudent={isStudent} />
        </td>
      );

      i += span;
    }
    return elements;
  };

  return (
    <div className="space-y-6">
      
      {/* Top Controls Bar (Hidden when hideControls is true) */}
      {!hideControls && (
        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-academic flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          {/* Year Selector Tabs */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
              Select Academic Year (AIML)
            </label>
            <div className="inline-flex rounded-xl p-1 bg-slate-100 border border-slate-200">
              {[1, 2, 3, 4].map(yr => (
                <button
                  key={yr}
                  onClick={() => { setSelectedYear(yr); setSelectedSectionId(null); }}
                  className={`px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-bold rounded-lg transition-all ${
                    selectedYear === yr
                      ? 'bg-navy-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-navy-900'
                  }`}
                >
                  {yr}{yr === 1 ? 'st' : yr === 2 ? 'nd' : yr === 3 ? 'rd' : 'th'} Year
                </button>
              ))}
            </div>
          </div>

          {/* Section Selector & Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Section Dropdown */}
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                Section
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={selectedSectionId || ''}
                  onChange={(e) => setSelectedSectionId(parseInt(e.target.value, 10))}
                  className="text-xs sm:text-sm font-bold text-navy-900 bg-white border border-slate-200 rounded-xl px-3 py-1.5 focus:outline-hidden focus:border-navy-900 shadow-2xs"
                >
                  {sections.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>

                {/* Admin: Delete Section */}
                {isAdmin && sections.length > 1 && (
                  <button
                    onClick={() => handleDeleteSection(selectedSectionId)}
                    title="Delete this section"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 border border-slate-200"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Admin Controls */}
            {isAdmin && (
              <div className="flex items-end gap-2 pt-5 sm:pt-0">
                <button
                  onClick={() => { setIsGenerateModalOpen(true); setGenerateResult(null); }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-amber-950 bg-amber-400 hover:bg-amber-300 border border-amber-500/40 rounded-xl transition-all shadow-xs"
                  title="Run automated constraint-satisfaction generator"
                >
                  <Wand2 className="w-3.5 h-3.5 text-navy-950" />
                  <span>Generate Schedule</span>
                </button>
                <button
                  onClick={() => setIsAddSectionOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-navy-900 bg-navy-50 hover:bg-navy-100 border border-navy-200 rounded-xl transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Section</span>
                </button>
                <button
                  onClick={() => setIsCsvModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-colors"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Upload CSV</span>
                </button>
              </div>
            )}

            {/* Export Actions: Pixel-Accurate PDF Download + Native Print */}
            <div className="flex items-end gap-2 pt-5 sm:pt-0">
              <button
                onClick={handleDownloadPdf}
                disabled={pdfLoading}
                title="Download pixel-accurate official PDF (replicates reference 1000131124.png)"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-navy-900 hover:bg-navy-800 disabled:opacity-50 rounded-xl transition-all shadow-xs no-print"
              >
                {pdfLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-300" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-amber-300" />
                )}
                <span>{pdfLoading ? 'Generating PDF...' : 'Download PDF'}</span>
              </button>

              <button
                onClick={() => window.print()}
                title="Print this timetable"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors no-print"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print</span>
              </button>
            </div>

          </div>

        </div>
      )}

      {/* Feedback alerts */}
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

      {/* Timetable Header Card */}
      <div className="bg-navy-900 text-white p-4 sm:p-5 rounded-2xl shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-400 text-navy-950 uppercase tracking-wider">
              {selectedYear}{selectedYear === 1 ? 'st' : selectedYear === 2 ? 'nd' : selectedYear === 3 ? 'rd' : 'th'} Year AIML
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-navy-800 text-amber-300 border border-navy-700">
              {selectedYear === 1 ? 'Classes until 5:00 PM' : 'Classes until 4:20 PM'}
            </span>
            <span className="text-sm font-semibold text-slate-300">
              {activeSection ? activeSection.name : 'All Sections'}
            </span>
          </div>
          <h2 className="text-lg sm:text-xl font-black mt-1">
            Weekly Academic Class Schedule
          </h2>
          <p className="text-xs text-slate-300">
            RGMCET · Department of Artificial Intelligence & Machine Learning
          </p>
        </div>

        {isAdmin && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-navy-800 text-slate-300 text-xs border border-navy-700">
            <Edit3 className="w-3.5 h-3.5 text-amber-300" />
            <span>Click any cell to edit subject & faculty</span>
          </div>
        )}
      </div>

      {/* Date Filter & Real-Time Leave Status Indicator (Hidden for Students) */}
      {!isStudent && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <Calendar className="w-4 h-4 text-navy-900" />
            <span className="font-bold text-xs text-navy-900 uppercase tracking-wider">Schedule Date:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-200 bg-slate-50 focus:outline-hidden focus:border-navy-900"
            />
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              (Cross-references active faculty leaves for this date)
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse"></span>
              <span className="font-extrabold text-rose-800 text-[11px]">⚠️ Faculty on Leave</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-600 text-[11px]">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
              <span>Lab</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-600 text-[11px]">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
              <span>Theory</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Weekly Grid Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-academic overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            {/* Table Header: Year 1 vs Senior Years (2, 3, 4) */}
            <thead>
              {selectedYear === 1 ? (
                /* Year 1 Table Header: 7 Periods of 50 minutes each (classes until 5:00 PM) */
                <tr className="bg-slate-100/90 border-b border-slate-200 text-[11px] font-bold text-navy-900 uppercase tracking-wider">
                  <th className="py-3.5 px-4 w-32 border-r border-slate-200 text-center">Day / Timing</th>
                  
                  {/* Period 1 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Period 1</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{YEAR_1_PERIOD_TIMES[1]}</div>
                  </th>

                  {/* Period 2 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Period 2</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{YEAR_1_PERIOD_TIMES[2]}</div>
                  </th>

                  {/* Morning Break Column (10:40 - 11:00 AM) */}
                  <th className="py-2 px-1 text-center bg-amber-50 text-amber-900 text-[9px] border-r border-slate-200 w-16 font-extrabold uppercase">
                    <div>Break</div>
                    <div className="text-[8px] font-semibold text-amber-700 normal-case">10:40-11:00</div>
                  </th>

                  {/* Period 3 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Period 3</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{YEAR_1_PERIOD_TIMES[3]}</div>
                  </th>

                  {/* Lunch Break Column (11:50 AM - 1:00 PM) */}
                  <th className="py-2 px-1 text-center bg-amber-100/80 text-amber-950 text-[9px] border-r border-slate-200 w-20 font-extrabold uppercase">
                    <div>Lunch Break</div>
                    <div className="text-[8px] font-semibold text-amber-800 normal-case">11:50-1:00</div>
                  </th>

                  {/* Period 4 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Period 4</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{YEAR_1_PERIOD_TIMES[4]}</div>
                  </th>

                  {/* Period 5 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Period 5</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{YEAR_1_PERIOD_TIMES[5]}</div>
                  </th>

                  {/* Afternoon Break Column (2:40 - 3:00 PM) */}
                  <th className="py-2 px-1 text-center bg-amber-50 text-amber-900 text-[9px] border-r border-slate-200 w-16 font-extrabold uppercase">
                    <div>Break</div>
                    <div className="text-[8px] font-semibold text-amber-700 normal-case">2:40-3:00</div>
                  </th>

                  {/* Period 6 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Period 6</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{YEAR_1_PERIOD_TIMES[6]}</div>
                  </th>

                  {/* Period 7 */}
                  <th className="py-3 px-3 text-center">
                    <div>Period 7</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{YEAR_1_PERIOD_TIMES[7]}</div>
                  </th>
                </tr>
              ) : (
                /* Years 2, 3, 4 Table Header: Classes until 4:20 PM */
                <tr className="bg-slate-100/90 border-b border-slate-200 text-[11px] font-bold text-navy-900 uppercase tracking-wider">
                  <th className="py-3.5 px-4 w-28 border-r border-slate-200 text-center">Day / Timing</th>
                  
                  {/* Periods 1 & 2 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Period 1</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{SENIOR_YEAR_PERIOD_TIMES[1]}</div>
                  </th>
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Period 2</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{SENIOR_YEAR_PERIOD_TIMES[2]}</div>
                  </th>

                  {/* Morning Break Column (10:40 - 11:00 AM) */}
                  <th className="py-2 px-1 text-center bg-amber-50 text-amber-900 text-[9px] border-r border-slate-200 w-16 font-extrabold uppercase">
                    <div>Break</div>
                    <div className="text-[8px] font-semibold text-amber-700 normal-case">10:40-11:00</div>
                  </th>

                  {/* Periods 3 & 4 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Period 3</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{SENIOR_YEAR_PERIOD_TIMES[3]}</div>
                  </th>
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Period 4</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{SENIOR_YEAR_PERIOD_TIMES[4]}</div>
                  </th>

                  {/* Lunch Break Column (12:40 - 1:50 PM) */}
                  <th className="py-2 px-1 text-center bg-amber-100/80 text-amber-950 text-[9px] border-r border-slate-200 w-20 font-extrabold uppercase">
                    <div>Lunch Break</div>
                    <div className="text-[8px] font-semibold text-amber-800 normal-case">12:40-1:50</div>
                  </th>

                  {/* Periods 5, 6, 7 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Period 5</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{SENIOR_YEAR_PERIOD_TIMES[5]}</div>
                  </th>
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Period 6</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{SENIOR_YEAR_PERIOD_TIMES[6]}</div>
                  </th>
                  <th className="py-3 px-3 text-center">
                    <div>Period 7</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{SENIOR_YEAR_PERIOD_TIMES[7]}</div>
                  </th>
                </tr>
              )}
            </thead>

            {/* Table Body: 6 Days with Automatic Merging of Consecutive Identical Subjects */}
            <tbody className="divide-y divide-slate-200 text-xs">
              {DAYS.map((day) => {
                const dayCells = (gridData && gridData[day]) || {};

                if (selectedYear === 1) {
                  /* Year 1 Row: 7 Periods (50 min each) + 3 Breaks (Classes until 5:00 PM) */
                  return (
                    <tr key={day} className="hover:bg-slate-50/50 transition-colors">
                      {/* Day Column */}
                      <td className="py-3 px-4 font-bold text-navy-900 bg-slate-50/80 border-r border-slate-200 text-center">
                        {day}
                      </td>

                      {/* Group 1: Periods 1 & 2 (09:00 - 10:40 AM) */}
                      {renderPeriodGroup([1, 2], dayCells, day)}

                      {/* Morning Break Divider (10:40 - 11:00 AM) */}
                      <td className="bg-amber-50/70 border-r border-slate-200 text-center text-[10px] text-amber-800 font-bold select-none p-1">
                        <div className="flex flex-col items-center justify-center h-full min-h-[5rem] gap-1">
                          <span className="text-sm">☕</span>
                          <span className="text-[9px] tracking-wider uppercase font-black text-amber-900">Break</span>
                        </div>
                      </td>

                      {/* Group 2: Period 3 (11:00 - 11:50 AM) */}
                      {renderPeriodGroup([3], dayCells, day)}

                      {/* Lunch Break Divider (11:50 AM - 1:00 PM) */}
                      <td className="bg-amber-100/60 border-r border-slate-200 text-center text-[10px] text-amber-950 font-bold select-none p-1">
                        <div className="flex flex-col items-center justify-center h-full min-h-[5rem] gap-1">
                          <span className="text-sm">🍱</span>
                          <span className="text-[9px] tracking-wider uppercase font-black text-amber-950">Lunch</span>
                        </div>
                      </td>

                      {/* Group 3: Periods 4 & 5 (01:00 - 02:40 PM) */}
                      {renderPeriodGroup([4, 5], dayCells, day)}

                      {/* Afternoon Break Divider (2:40 - 3:00 PM) */}
                      <td className="bg-amber-50/70 border-r border-slate-200 text-center text-[10px] text-amber-800 font-bold select-none p-1">
                        <div className="flex flex-col items-center justify-center h-full min-h-[5rem] gap-1">
                          <span className="text-sm">☕</span>
                          <span className="text-[9px] tracking-wider uppercase font-black text-amber-900">Break</span>
                        </div>
                      </td>

                      {/* Group 4: Periods 6 & 7 (03:00 - 04:50 PM, classes close at 5:00 PM) */}
                      {renderPeriodGroup([6, 7], dayCells, day)}
                    </tr>
                  );
                }

                /* Years 2, 3, 4 Row: 7 Periods + 2 Breaks (Classes until 4:20 PM) */
                return (
                  <tr key={day} className="hover:bg-slate-50/50 transition-colors">
                    {/* Day Column */}
                    <td className="py-3 px-4 font-bold text-navy-900 bg-slate-50/80 border-r border-slate-200 text-center">
                      {day}
                    </td>

                    {/* Group 1: Periods 1 & 2 (09:00 - 10:40 AM) */}
                    {renderPeriodGroup([1, 2], dayCells, day)}

                    {/* Morning Break Divider (10:40 - 11:00 AM) */}
                    <td className="bg-amber-50/70 border-r border-slate-200 text-center text-[10px] text-amber-800 font-bold select-none p-1">
                      <div className="flex flex-col items-center justify-center h-full min-h-[5rem] gap-1">
                        <span className="text-sm">☕</span>
                        <span className="text-[9px] tracking-wider uppercase font-black text-amber-900">Break</span>
                      </div>
                    </td>

                    {/* Group 2: Periods 3 & 4 (11:00 - 12:40 PM) */}
                    {renderPeriodGroup([3, 4], dayCells, day)}

                    {/* Lunch Break Divider (12:40 - 1:50 PM) */}
                    <td className="bg-amber-100/60 border-r border-slate-200 text-center text-[10px] text-amber-950 font-bold select-none p-1">
                      <div className="flex flex-col items-center justify-center h-full min-h-[5rem] gap-1">
                        <span className="text-sm">🍱</span>
                        <span className="text-[9px] tracking-wider uppercase font-black text-amber-950">Lunch</span>
                      </div>
                    </td>

                    {/* Group 3: Periods 5, 6, 7 (01:50 - 04:20 PM) */}
                    {renderPeriodGroup([5, 6, 7], dayCells, day)}
                  </tr>
                );
              })}
            </tbody>

          </table>
        </div>
      </div>

      {/* Admin Cell Edit Modal */}
      {editingCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <h3 className="text-base font-bold text-navy-900">
                  {editingCell.periods && editingCell.periods.length > 1
                    ? `Edit Merged Slot (${editingCell.periods.length} Consecutive Periods)`
                    : 'Edit Timetable Slot'}
                </h3>
                <p className="text-xs text-slate-500">
                  {editingCell.day} · {editingCell.periods && editingCell.periods.length > 1
                    ? `Periods ${editingCell.periods.join(', ')} (${getPeriodTime(selectedYear, editingCell.periods[0]).split(' - ')[0]} - ${(getPeriodTime(selectedYear, editingCell.periods[editingCell.periods.length - 1]).split(' - ')[1] || '')})`
                    : `Period ${editingCell.period} (${getPeriodTime(selectedYear, editingCell.period)})`}
                </p>
              </div>
              <button 
                onClick={() => setEditingCell(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCellSave} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Subject / Course Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. NLP, SEM, BEE - A, IP, AI&SP LAB"
                  value={editingCell.subject || ''}
                  onChange={(e) => {
                    const nextSub = e.target.value;
                    const isSem = nextSub.trim().toUpperCase() === 'SEM';
                    const isYear1NonAiml = selectedYear === 1 && !isYear1AimlSubject(nextSub);
                    const isYear2NonAiml = selectedYear === 2 && !isYear2AimlSubject(nextSub);
                    setEditingCell({
                      ...editingCell,
                      subject: nextSub,
                      faculty_name: (isSem || isYear1NonAiml || isYear2NonAiml) ? '' : editingCell.faculty_name
                    });
                  }}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">
                    Faculty Name
                  </label>
                  {editingCell.subject?.trim().toUpperCase() === 'SEM' && (
                    <span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-bold border border-amber-200">
                      SEM period: Free from faculty allocation
                    </span>
                  )}
                  {selectedYear === 1 && editingCell.subject && !isYear1AimlSubject(editingCell.subject) && editingCell.subject.trim().toUpperCase() !== 'SEM' && (
                    <span className="text-[10px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded font-bold border border-blue-200">
                      1st Year: Handled by other faculty (Unassigned)
                    </span>
                  )}
                  {selectedYear === 2 && editingCell.subject && !isYear2AimlSubject(editingCell.subject) && editingCell.subject.trim().toUpperCase() !== 'SEM' && (
                    <span className="text-[10px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded font-bold border border-blue-200">
                      2nd Year: Handled by other faculty (Unassigned)
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  disabled={editingCell.subject?.trim().toUpperCase() === 'SEM' || (selectedYear === 1 && !isYear1AimlSubject(editingCell.subject)) || (selectedYear === 2 && !isYear2AimlSubject(editingCell.subject))}
                  required={editingCell.subject?.trim().toUpperCase() !== 'SEM' && !(selectedYear === 1 && !isYear1AimlSubject(editingCell.subject)) && !(selectedYear === 2 && !isYear2AimlSubject(editingCell.subject))}
                  list="faculty-list"
                  placeholder={
                    editingCell.subject?.trim().toUpperCase() === 'SEM' 
                      ? 'No faculty assigned (SEM Period)' 
                      : ((selectedYear === 1 && !isYear1AimlSubject(editingCell.subject)) || (selectedYear === 2 && !isYear2AimlSubject(editingCell.subject))
                        ? 'Unassigned / Handled by other faculty'
                        : 'e.g. Dr. G. Kishor Kumar, Dr. J. Avinash')
                  }
                  value={
                    editingCell.subject?.trim().toUpperCase() === 'SEM' || (selectedYear === 1 && !isYear1AimlSubject(editingCell.subject)) || (selectedYear === 2 && !isYear2AimlSubject(editingCell.subject))
                      ? '' 
                      : (editingCell.faculty_name || '')
                  }
                  onChange={(e) => setEditingCell({ ...editingCell, faculty_name: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                />
                <datalist id="faculty-list">
                  {facultySuggestions.map(f => (
                    <option key={f.id} value={f.name}>
                      {f.designation ? `${f.designation} (${f.register_id})${f.status === 'pending' ? ' [Pending Details]' : ''}` : (f.status === 'pending' ? 'Pending Faculty Slot' : f.register_id)}
                    </option>
                  ))}
                </datalist>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingCell(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold bg-navy-900 text-white rounded-xl hover:bg-navy-800 shadow-xs"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Add Section Modal */}
      {isAddSectionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <h3 className="text-base font-bold text-navy-900 mb-1">
              Add New Section
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Create a new section for Year {selectedYear} AIML.
            </p>

            <form onSubmit={handleAddSection} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Section Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Section C or AIML-C"
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddSectionOpen(false)}
                  className="px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-navy-900 text-white rounded-xl hover:bg-navy-800"
                >
                  Create Section
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin CSV Upload / Template Modal */}
      {isCsvModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-xl rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <h3 className="text-base font-bold text-navy-900">
                  Bulk Timetable CSV Upload
                </h3>
                <p className="text-xs text-slate-500">
                  Target: Year {selectedYear} AIML · {activeSection ? activeSection.name : 'Section'}
                </p>
              </div>
              <button 
                onClick={() => setIsCsvModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4 flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
              <span className="text-xs text-slate-600">
                Format: <code className="text-navy-900 font-bold font-mono">Day,Period,Subject,Faculty</code>
              </span>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-navy-900 hover:underline"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Sample CSV</span>
              </button>
            </div>

            <form onSubmit={handleImportCsv} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Paste CSV Text or Upload File
                </label>
                <textarea
                  rows={8}
                  required
                  placeholder={`Day,Period,Subject,Faculty\nMonday,1,BEE - A,Dr. B. Anitha\nMonday,2,IP,Dr. K. Ramesh`}
                  value={csvContent}
                  onChange={(e) => setCsvContent(e.target.value)}
                  className="w-full p-3 font-mono text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900"
                />
              </div>

              {/* File upload input as alternative */}
              <div>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (evt) => setCsvContent(evt.target.result);
                      reader.readAsText(file);
                    }
                  }}
                  className="text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-navy-50 file:text-navy-900 hover:file:bg-navy-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCsvModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold bg-navy-900 text-white rounded-xl hover:bg-navy-800 shadow-xs"
                >
                  Import Timetable
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Automated Generation Modal */}
      {isGenerateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-lg rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center text-amber-900 font-bold">
                  <Wand2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-navy-900">
                    Automated Timetable Generation Engine
                  </h3>
                  <p className="text-xs text-slate-500">
                    Constraint Satisfaction Solver · Department of CSE (AI & ML)
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsGenerateModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Enforced Rules Banner */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
                <div className="font-extrabold text-navy-950 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  <span>Simultaneously Enforced Operational Constraints:</span>
                </div>
                <ul className="list-disc list-inside text-slate-600 text-[11px] space-y-1">
                  <li><strong>Hard Workload Cap:</strong> Maximum 16 hrs/week per faculty member</li>
                  <li><strong>Emergency Standby:</strong> ≥ 2 rotating faculty members 100% free daily</li>
                  <li><strong>Morning Rotation:</strong> Max 2 morning duty days (9:00–10:40 AM) per week</li>
                  <li><strong>Parallel Redundancy:</strong> ≥ 1 qualified substitute free during multi-section slots</li>
                  <li><strong>Block Structure:</strong> 2-hour theory blocks & 3-hour continuous lab blocks</li>
                </ul>
              </div>

              {/* Scope Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2 uppercase tracking-wider">
                  Generation Scope:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${
                    generateScope === 'section'
                      ? 'border-navy-900 bg-navy-50/50 text-navy-950 font-bold'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}>
                    <input
                      type="radio"
                      name="scope"
                      value="section"
                      checked={generateScope === 'section'}
                      onChange={() => setGenerateScope('section')}
                      className="text-navy-900"
                    />
                    <span className="text-xs">
                      {activeSection ? `${selectedYear}${selectedYear === 1 ? 'st' : selectedYear === 2 ? 'nd' : selectedYear === 3 ? 'rd' : 'th'} Yr - ${activeSection.name}` : 'Current Section'}
                    </span>
                  </label>

                  <label className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${
                    generateScope === 'all'
                      ? 'border-navy-900 bg-navy-50/50 text-navy-950 font-bold'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}>
                    <input
                      type="radio"
                      name="scope"
                      value="all"
                      checked={generateScope === 'all'}
                      onChange={() => setGenerateScope('all')}
                      className="text-navy-900"
                    />
                    <span className="text-xs">
                      All 16 Sections (1st to 4th Yr)
                    </span>
                  </label>
                </div>
              </div>

              {/* Generation Result Stats */}
              {generateResult && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-2">
                  <div className="flex items-center gap-1.5 text-emerald-900 font-bold">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{generateResult.message}</span>
                  </div>
                  {generateResult.standbyFloaters && (
                    <div className="text-[11px] text-emerald-800 space-y-0.5">
                      <div className="font-semibold">Rotating Emergency Floaters:</div>
                      {Object.entries(generateResult.standbyFloaters).map(([d, floaters]) => (
                        <div key={d} className="flex items-center justify-between border-b border-emerald-100/80 py-0.5">
                          <span className="font-medium text-emerald-900">{d}:</span>
                          <span>{floaters.join(', ')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsGenerateModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleRunGenerator}
                  disabled={generateLoading}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-navy-950 rounded-xl shadow-xs disabled:opacity-50 transition-all font-black"
                >
                  {generateLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-navy-950" />
                  ) : (
                    <Wand2 className="w-4 h-4 text-navy-950" />
                  )}
                  <span>{generateLoading ? 'Running Solver...' : 'Run Constraint Solver'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Official PDF Export Component (A4 Landscape Layout replicating 1000131124.png) */}
      <OfficialPdfDocument
        section={activeSection}
        year={selectedYear}
        gridData={gridData}
        facultyDetails={facultyDetails}
        user={user}
      />

    </div>
  );
}

// Subcomponent for rendering individual cell with elegant card look and merged period badge (strictly no room codes)
function CellContent({ cell, span = 1, periods = [], year = 3, isStudent = false }) {
  if (!cell || !cell.subject || cell.subject === '—') {
    return (
      <div className="h-20 flex items-center justify-center text-slate-300 select-none">
        <span className="text-xs font-medium">Free / Off</span>
      </div>
    );
  }

  const isSem = cell.subject?.trim().toUpperCase() === 'SEM';
  const isLab = cell.subject.toLowerCase().includes('lab');
  const isOnLeave = !isStudent && Boolean(cell.is_on_leave);

  return (
    <div className={`min-h-[5rem] h-full flex flex-col justify-between p-2.5 rounded-xl border transition-all ${
      isOnLeave
        ? 'bg-rose-50/90 border-rose-300 text-rose-950 shadow-2xs'
        : isLab 
        ? 'bg-indigo-50/60 border-indigo-200/90 text-indigo-950 shadow-2xs' 
        : 'bg-slate-50/80 border-slate-200/90 text-slate-900 shadow-2xs'
    }`}>
      <div className="flex items-start justify-between gap-1">
        <div className="font-bold text-xs sm:text-[13px] leading-tight line-clamp-2 text-navy-950">
          {cell.subject}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isOnLeave && (
            <span 
              title="Faculty On Leave"
              className="px-1.5 py-0.5 bg-rose-600 text-white rounded font-extrabold text-[8px] tracking-wider uppercase animate-pulse"
            >
              ⚠️ On Leave
            </span>
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between gap-1 flex-wrap">
        {!isSem && cell.faculty_name && cell.faculty_name !== '—' ? (
          <div className="flex items-center gap-1 text-[10px] text-slate-600 font-medium truncate">
            <User className={`w-2.5 h-2.5 shrink-0 ${isOnLeave ? 'text-rose-500' : 'text-slate-400'}`} />
            <span className={`truncate ${isOnLeave ? 'text-rose-800 font-bold line-through' : ''}`}>{cell.faculty_name}</span>
          </div>
        ) : <span />}
        <div className="flex items-center gap-1">
          {isOnLeave && (
            <span className="text-[8px] font-bold text-rose-700 uppercase">
              Away
            </span>
          )}
          {isLab && (
            <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-800 rounded font-extrabold uppercase text-[8px] tracking-wider shrink-0">
              Lab
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

