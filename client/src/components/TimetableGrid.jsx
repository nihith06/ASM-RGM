import React, { useState, useEffect, useRef } from 'react';
import { 
  Calendar, 
  Clock, 
  Layers, 
  Plus, 
  Edit3, 
  Printer, 
  Download, 
  Check, 
  X, 
  AlertCircle,
  BookOpen,
  User,
  Trash2,
  Loader2,
  Upload,
  FileText
} from 'lucide-react';
import { timetableApi, directoryApi } from '../api';
import OfficialPdfDocument, { exportToOfficialPdf } from './OfficialPdfDocument';
import { parseTimetableContent } from '../timetableParser';

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
import { getNextSectionName } from '../sectionUtils';
export { getNextSectionName };

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
  const [isAddSectionOpen, setIsAddSectionOpen] = useState(false);
  const [proposedSectionName, setProposedSectionName] = useState('');
  const [deleteConfirmState, setDeleteConfirmState] = useState(null); // null | { sectionId, sectionName, step: 1 | 2 }
  
  // Upload Timetable States
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadedCells, setUploadedCells] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [isConfirmReplaceOpen, setIsConfirmReplaceOpen] = useState(false);
  const [replaceLoading, setReplaceLoading] = useState(false);
  const fileInputRef = useRef(null);

  // PDF Export States
  const [facultyDetails, setFacultyDetails] = useState([]);
  const [pdfLoading, setPdfLoading] = useState(false);

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
      if (res.faculty) {
        // Exclude HOD (Dr. G. Kishor Kumar) from faculty suggestions for subject assignment
        const teachingFaculty = res.faculty.filter(f => {
          const name = (f.name || '').toLowerCase();
          const reg = (f.register_id || '').toLowerCase();
          if (name.includes('bala kishore') || reg.includes('fac016')) return true;
          return !name.includes('kishor kumar') && !name.includes('dr. g. kishor') && reg !== 'fac001' && (!name.includes('kishor') || name.includes('bala'));
        });
        setFacultySuggestions(teachingFaculty);
      }
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

  const handleCellSave = async (e) => {
    e.preventDefault();
    if (!isAdmin || !editingCell) return;

    try {
      const periodsToUpdate = editingCell.periods || [editingCell.period];
      const isSem = (editingCell.subject || '').trim().toUpperCase() === 'SEM';
      const isYear1NonAiml = selectedYear === 1 && !isYear1AimlSubject(editingCell.subject);
      const isYear2NonAiml = selectedYear === 2 && !isYear2AimlSubject(editingCell.subject);
      const effectiveFaculty = (isSem || isYear1NonAiml || isYear2NonAiml) ? '—' : (editingCell.faculty_name || '—');

      const isHod = (name) => {
        if (!name) return false;
        const s = name.toLowerCase().trim();
        if (s.includes('bala kishore') || s.includes('fac016')) return false;
        return s.includes('kishor kumar') || s.includes('dr. g. kishor') || s === 'fac001' || (s.includes('kishor') && !s.includes('bala'));
      };

      if (effectiveFaculty !== '—' && isHod(effectiveFaculty)) {
        setError('This faculty member cannot be assigned any teaching subjects.');
        return;
      }

      const effectiveRoom = (editingCell.room || '').trim();

      await timetableApi.updateCell({
        year: selectedYear,
        section_id: selectedSectionId,
        day: editingCell.day,
        period: editingCell.period,
        periods: periodsToUpdate,
        subject: editingCell.subject,
        faculty_name: effectiveFaculty,
        room: effectiveRoom
      });

      // Update local state instantly
      setGridData(prev => {
        const dayCopy = { ...(prev[editingCell.day] || {}) };
        for (const p of periodsToUpdate) {
          dayCopy[p] = {
            subject: editingCell.subject || '—',
            faculty_name: effectiveFaculty,
            room: effectiveRoom
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
          ? `Updated ${editingCell.day} Hours ${periodsToUpdate.join(', ')}!`
          : `Updated ${editingCell.day} Hour ${editingCell.period}!`
      );
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to update slot.');
    }
  };


  const handleOpenAddSection = () => {
    const nextName = getNextSectionName(sections);
    setProposedSectionName(nextName);
    setIsAddSectionOpen(true);
  };

  const handleConfirmAddSection = async () => {
    if (!proposedSectionName) return;

    try {
      const res = await timetableApi.addSection(selectedYear, proposedSectionName);
      setSuccess(`Section "${proposedSectionName}" added to Year ${selectedYear}!`);
      setIsAddSectionOpen(false);
      setProposedSectionName('');
      // Reload timetable
      loadTimetable(selectedYear, res.section.id);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to add section.');
    }
  };

  const handleDeleteSectionClick = () => {
    const sec = sections.find(s => s.id === selectedSectionId);
    if (!sec) return;
    setDeleteConfirmState({
      sectionId: sec.id,
      sectionName: sec.name,
      step: 1
    });
  };

  const handleContinueDelete = () => {
    setDeleteConfirmState(prev => (prev ? { ...prev, step: 2 } : null));
  };

  const handleCancelDelete = () => {
    setDeleteConfirmState(null);
  };

  const handleFinalConfirmDelete = async () => {
    if (!deleteConfirmState) return;
    const { sectionId, sectionName } = deleteConfirmState;
    try {
      await timetableApi.deleteSection(sectionId);
      setDeleteConfirmState(null);
      setSuccess(`Section "${sectionName}" deleted successfully.`);
      loadTimetable(selectedYear, null);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to delete section.');
      setDeleteConfirmState(null);
    }
  };

  const activeSection = sections.find(s => s.id === selectedSectionId);

  // Upload Timetable Handlers
  const handleOpenUploadModal = () => {
    setUploadFile(null);
    setUploadedCells(null);
    setValidationResult(null);
    setUploadError('');
    setIsConfirmReplaceOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setIsUploadModalOpen(true);
  };

  const handleCancelUpload = () => {
    setIsUploadModalOpen(false);
    setUploadFile(null);
    setUploadedCells(null);
    setValidationResult(null);
    setUploadError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadFile(file);
    setUploadLoading(true);
    setUploadError('');
    setValidationResult(null);

    try {
      const text = await file.text();
      const parsed = parseTimetableContent(text, file.name);

      if (!activeSection) {
        throw new Error('Please select a section before uploading a timetable.');
      }

      // Validate against backend without modifying anything in database
      const res = await timetableApi.validateUpload({
        year: selectedYear,
        section_id: activeSection.id,
        cells: parsed
      });

      if (res.valid) {
        setUploadedCells(res.cells || parsed);
        setValidationResult(res);
        setUploadError('');
      } else {
        setValidationResult({ valid: false });
        setUploadError(res.error || 'Timetable validation failed.');
      }
    } catch (err) {
      setValidationResult({ valid: false });
      setUploadError(err.message || 'Failed to read or validate timetable file.');
    } finally {
      setUploadLoading(false);
    }
  };

  const handleProceedToConfirm = () => {
    if (!validationResult || !validationResult.valid || !uploadedCells) return;
    setIsUploadModalOpen(false);
    setIsConfirmReplaceOpen(true);
  };

  const handleCancelConfirm = () => {
    setIsConfirmReplaceOpen(false);
    setUploadFile(null);
    setUploadedCells(null);
    setValidationResult(null);
    setUploadError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExecuteReplace = async () => {
    if (!activeSection || !uploadedCells) return;

    setReplaceLoading(true);
    try {
      const res = await timetableApi.replaceSectionTimetable({
        year: selectedYear,
        section_id: activeSection.id,
        cells: uploadedCells
      });

      const yearSuffix = selectedYear === 1 ? '1st' : selectedYear === 2 ? '2nd' : selectedYear === 3 ? '3rd' : '4th';
      setSuccess(res.message || `Timetable for ${yearSuffix} Year - ${activeSection.name} successfully updated!`);
      setIsConfirmReplaceOpen(false);
      setUploadFile(null);
      setUploadedCells(null);
      setValidationResult(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      // Reload timetable for current section
      await loadTimetable(selectedYear, activeSection.id);
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.message || 'Failed to replace timetable.');
    } finally {
      setReplaceLoading(false);
    }
  };

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
                    onClick={handleDeleteSectionClick}
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
                  onClick={handleOpenAddSection}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-navy-900 bg-navy-50 hover:bg-navy-100 border border-navy-200 rounded-xl transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Section</span>
                </button>
                <button
                  onClick={handleOpenUploadModal}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-navy-900 bg-navy-50 hover:bg-navy-100 border border-navy-200 rounded-xl transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Timetable</span>
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
                  <th className="py-3.5 px-4 w-32 border-r border-slate-200 text-center">Day / Hour & Timing</th>
                  
                  {/* Hour 1 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Hour 1</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{YEAR_1_PERIOD_TIMES[1]}</div>
                  </th>

                  {/* Hour 2 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Hour 2</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{YEAR_1_PERIOD_TIMES[2]}</div>
                  </th>

                  {/* Morning Break Column (10:40 - 11:00 AM) */}
                  <th className="py-2 px-1 text-center bg-amber-50 text-amber-900 text-[9px] border-r border-slate-200 w-16 font-extrabold uppercase">
                    <div>Break</div>
                    <div className="text-[8px] font-semibold text-amber-700 normal-case">10:40-11:00</div>
                  </th>

                  {/* Hour 3 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Hour 3</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{YEAR_1_PERIOD_TIMES[3]}</div>
                  </th>

                  {/* Lunch Break Column (11:50 AM - 1:00 PM) */}
                  <th className="py-2 px-1 text-center bg-amber-100/80 text-amber-950 text-[9px] border-r border-slate-200 w-20 font-extrabold uppercase">
                    <div>Lunch Break</div>
                    <div className="text-[8px] font-semibold text-amber-800 normal-case">11:50-1:00</div>
                  </th>

                  {/* Hour 4 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Hour 4</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{YEAR_1_PERIOD_TIMES[4]}</div>
                  </th>

                  {/* Hour 5 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Hour 5</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{YEAR_1_PERIOD_TIMES[5]}</div>
                  </th>

                  {/* Afternoon Break Column (2:40 - 3:00 PM) */}
                  <th className="py-2 px-1 text-center bg-amber-50 text-amber-900 text-[9px] border-r border-slate-200 w-16 font-extrabold uppercase">
                    <div>Break</div>
                    <div className="text-[8px] font-semibold text-amber-700 normal-case">2:40-3:00</div>
                  </th>

                  {/* Hour 6 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Hour 6</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{YEAR_1_PERIOD_TIMES[6]}</div>
                  </th>

                  {/* Hour 7 */}
                  <th className="py-3 px-3 text-center">
                    <div>Hour 7</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{YEAR_1_PERIOD_TIMES[7]}</div>
                  </th>
                </tr>
              ) : (
                /* Years 2, 3, 4 Table Header: Classes until 4:20 PM */
                <tr className="bg-slate-100/90 border-b border-slate-200 text-[11px] font-bold text-navy-900 uppercase tracking-wider">
                  <th className="py-3.5 px-4 w-28 border-r border-slate-200 text-center">Day / Hour & Timing</th>
                  
                  {/* Hours 1 & 2 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Hour 1</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{SENIOR_YEAR_PERIOD_TIMES[1]}</div>
                  </th>
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Hour 2</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{SENIOR_YEAR_PERIOD_TIMES[2]}</div>
                  </th>

                  {/* Morning Break Column (10:40 - 11:00 AM) */}
                  <th className="py-2 px-1 text-center bg-amber-50 text-amber-900 text-[9px] border-r border-slate-200 w-16 font-extrabold uppercase">
                    <div>Break</div>
                    <div className="text-[8px] font-semibold text-amber-700 normal-case">10:40-11:00</div>
                  </th>

                  {/* Hours 3 & 4 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Hour 3</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{SENIOR_YEAR_PERIOD_TIMES[3]}</div>
                  </th>
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Hour 4</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{SENIOR_YEAR_PERIOD_TIMES[4]}</div>
                  </th>

                  {/* Lunch Break Column (12:40 - 1:50 PM) */}
                  <th className="py-2 px-1 text-center bg-amber-100/80 text-amber-950 text-[9px] border-r border-slate-200 w-20 font-extrabold uppercase">
                    <div>Lunch Break</div>
                    <div className="text-[8px] font-semibold text-amber-800 normal-case">12:40-1:50</div>
                  </th>

                  {/* Hours 5, 6, 7 */}
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Hour 5</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{SENIOR_YEAR_PERIOD_TIMES[5]}</div>
                  </th>
                  <th className="py-3 px-3 text-center border-r border-slate-200">
                    <div>Hour 6</div>
                    <div className="text-[10px] font-semibold text-slate-600 normal-case">{SENIOR_YEAR_PERIOD_TIMES[6]}</div>
                  </th>
                  <th className="py-3 px-3 text-center">
                    <div>Hour 7</div>
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
                    ? `Edit Merged Slot (${editingCell.periods.length} Consecutive Hours)`
                    : 'Edit Timetable Slot'}
                </h3>
                <p className="text-xs text-slate-500">
                  {editingCell.day} · {editingCell.periods && editingCell.periods.length > 1
                    ? `Hours ${editingCell.periods.join(', ')} (${getPeriodTime(selectedYear, editingCell.periods[0]).split(' - ')[0]} - ${(getPeriodTime(selectedYear, editingCell.periods[editingCell.periods.length - 1]).split(' - ')[1] || '')})`
                    : `Hour ${editingCell.period} (${getPeriodTime(selectedYear, editingCell.period)})`}
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
                        : 'e.g. Dr. Chakrapani, Dr. J. Avinash')
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

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Room Number / Hall
                </label>
                <input
                  type="text"
                  placeholder="e.g. ET-3080, ET-3050, RG-207, AI&SP LAB"
                  value={editingCell.room || ''}
                  onChange={(e) => setEditingCell({ ...editingCell, room: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Leave blank or set &lsquo;—&rsquo; for default / placeholder
                </p>
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

      {/* Admin Add Section Confirmation Modal (Single Confirmation) */}
      {isAddSectionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-navy-50 flex items-center justify-center text-navy-900 font-bold">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-navy-900">
                    Add Section
                  </h3>
                  <p className="text-xs text-slate-500">
                    Year {selectedYear} AIML
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsAddSectionOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">Generated Section:</span>
                <span className="text-sm font-black text-navy-950 px-3 py-1 bg-white border border-slate-200 rounded-lg shadow-2xs font-mono">
                  {proposedSectionName}
                </span>
              </div>

              <p className="text-sm font-bold text-navy-900 text-center py-1">
                Create {proposedSectionName}?
              </p>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddSectionOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAddSection}
                  className="px-4 py-2 text-xs font-bold bg-navy-900 text-white rounded-xl hover:bg-navy-800 shadow-xs transition-colors"
                >
                  Confirm Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Section Two-Step Confirmation Modals */}
      {deleteConfirmState && deleteConfirmState.step === 1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center text-red-600 font-bold">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-navy-900">
                    Delete Section
                  </h3>
                  <p className="text-xs text-slate-500">
                    Confirmation 1 of 2
                  </p>
                </div>
              </div>
              <button 
                onClick={handleCancelDelete}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm font-bold text-navy-900 text-center py-2">
                Are you sure you want to delete {deleteConfirmState.sectionName}?
              </p>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleCancelDelete}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleContinueDelete}
                  className="px-4 py-2 text-xs font-bold bg-navy-900 text-white rounded-xl hover:bg-navy-800 shadow-xs transition-colors"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmState && deleteConfirmState.step === 2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-red-100 flex items-center justify-center text-red-700 font-bold">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-red-900">
                    Confirm Permanent Deletion
                  </h3>
                  <p className="text-xs text-red-600">
                    Confirmation 2 of 2
                  </p>
                </div>
              </div>
              <button 
                onClick={handleCancelDelete}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-xs font-medium text-red-800 leading-relaxed">
                  This will permanently delete {deleteConfirmState.sectionName} and its associated timetable/section data. Do you want to continue?
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleCancelDelete}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleFinalConfirmDelete}
                  className="px-4 py-2 text-xs font-bold bg-red-600 text-white rounded-xl hover:bg-red-700 shadow-xs transition-colors"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Timetable Modal */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-lg rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-navy-50 flex items-center justify-center text-navy-900 font-bold">
                  <Upload className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-navy-900">
                    Upload Timetable
                  </h3>
                  <p className="text-xs text-slate-500">
                    Target: {selectedYear}{selectedYear === 1 ? 'st' : selectedYear === 2 ? 'nd' : selectedYear === 3 ? 'rd' : 'th'} Year - {activeSection?.name || 'Section'}
                  </p>
                </div>
              </div>
              <button 
                onClick={handleCancelUpload}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Required Upload Format Instructions */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
                <div className="text-slate-700 font-semibold">
                  Format: <span className="font-mono text-navy-900 font-bold">Day,Hour,Subject,Faculty,Room</span>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 font-medium mb-1">Example:</div>
                  <pre className="font-mono text-[11px] bg-white border border-slate-200 rounded-lg p-2.5 text-slate-800 leading-relaxed overflow-x-auto whitespace-pre">
{`Monday,1,Deep Learning,Dr. G. Kishor Kumar,ET-4015
Monday,2,Computer Vision,Ms. D. Saraswathi,ET-4022
Monday,3,Cloud Computing,,ET-4034`}
                  </pre>
                </div>
              </div>

              {/* File upload drag/picker */}
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".csv,.json,.txt"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="timetable-file-input"
                />
                <label
                  htmlFor="timetable-file-input"
                  className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-300 hover:border-navy-900 rounded-2xl cursor-pointer bg-slate-50/50 hover:bg-navy-50/20 transition-all text-center"
                >
                  <Upload className="w-8 h-8 text-navy-900 mb-2" />
                  <span className="text-xs font-bold text-navy-900">
                    {uploadFile ? uploadFile.name : 'Click or drop timetable file here'}
                  </span>
                  <span className="text-[11px] text-slate-500 mt-1">
                    Supports .csv, .txt, or .json
                  </span>
                </label>
              </div>

              {/* Parsing / Validating Loader */}
              {uploadLoading && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2.5 text-xs text-slate-700">
                  <Loader2 className="w-4 h-4 animate-spin text-navy-900 shrink-0" />
                  <span>Validating timetable rules...</span>
                </div>
              )}

              {/* Conflict / Error Message */}
              {uploadError && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs space-y-1.5">
                  <div className="flex items-start gap-2 text-red-900 font-bold">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span>{uploadError}</span>
                  </div>
                  <p className="text-[11px] text-red-700 pl-6">
                    Existing timetable data remains completely untouched. Please correct the conflict in your file and try uploading again.
                  </p>
                </div>
              )}

              {/* Validation Success */}
              {validationResult && validationResult.valid && !uploadLoading && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-1">
                  <div className="flex items-center gap-2 text-emerald-900 font-bold">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Timetable validated successfully!</span>
                  </div>
                  <p className="text-[11px] text-emerald-800 pl-6">
                    Ready to replace timetable for {selectedYear}{selectedYear === 1 ? 'st' : selectedYear === 2 ? 'nd' : selectedYear === 3 ? 'rd' : 'th'} Year - {activeSection?.name}. All validation rules passed.
                  </p>
                </div>
              )}

              {/* Action Buttons: Cancel and Create */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleCancelUpload}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                {validationResult && validationResult.valid && !uploadLoading && (
                  <button
                    type="button"
                    onClick={handleProceedToConfirm}
                    className="px-4 py-2 text-xs font-bold bg-navy-900 text-white rounded-xl hover:bg-navy-800 shadow-xs transition-colors"
                  >
                    Create
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Final Create Confirmation Modal */}
      {isConfirmReplaceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center text-amber-700 font-bold">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-navy-900">
                    Confirm Timetable Replacement
                  </h3>
                  <p className="text-xs text-slate-500">
                    Final Confirmation
                  </p>
                </div>
              </div>
              <button 
                onClick={handleCancelConfirm}
                disabled={replaceLoading}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl">
                <p className="text-xs font-semibold text-slate-800 leading-relaxed">
                  Creating this timetable will delete the present timetable for {selectedYear}{selectedYear === 1 ? 'st' : selectedYear === 2 ? 'nd' : selectedYear === 3 ? 'rd' : 'th'} Year - {activeSection?.name} and replace it with the uploaded timetable. Do you want to continue?
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleCancelConfirm}
                  disabled={replaceLoading}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteReplace}
                  disabled={replaceLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-navy-900 text-white rounded-xl hover:bg-navy-800 shadow-xs transition-colors disabled:opacity-50"
                >
                  {replaceLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                      <span>Replacing...</span>
                    </>
                  ) : (
                    <span>Confirm Create</span>
                  )}
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

// Subcomponent for rendering individual cell with elegant card look and room number header (matching reference Image 2)
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
  const roomDisplay = (cell.room && cell.room.trim() && cell.room.trim() !== '—') ? cell.room.trim() : '—';

  return (
    <div className={`min-h-[5.5rem] h-full flex flex-col justify-between p-2 rounded-xl border transition-all ${
      isOnLeave
        ? 'bg-rose-50/90 border-rose-300 text-rose-950 shadow-2xs'
        : isLab 
        ? 'bg-indigo-50/60 border-indigo-200/90 text-indigo-950 shadow-2xs' 
        : 'bg-slate-50/80 border-slate-200/90 text-slate-900 shadow-2xs'
    }`}>
      {/* Room Number section immediately at top of card, replicating Image 2 reference */}
      <div className="bg-slate-200/90 text-slate-800 text-[10px] sm:text-[10.5px] font-black py-0.5 px-2 rounded-md border border-slate-300/80 text-center tracking-wide uppercase mb-1.5 shadow-2xs">
        {roomDisplay}
      </div>

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

