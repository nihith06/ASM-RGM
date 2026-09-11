import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Users, 
  Calendar, 
  Layers, 
  FileSpreadsheet, 
  Trash2, 
  Edit3, 
  Plus, 
  Check, 
  X, 
  AlertCircle,
  GraduationCap,
  BookOpenCheck,
  Search,
  Phone,
  BarChart3,
  Clock,
  Key,
  ShieldAlert,
  FileText,
  Lock,
  Eye,
  EyeOff
} from 'lucide-react';
import { timetableApi, directoryApi, authApi } from '../api';
import TimetableGrid from '../components/TimetableGrid';
import FacultyAvailabilityView from '../components/FacultyAvailabilityView';

export default function AdminDashboard({ user }) {
  const [activeTab, setActiveTab] = useState('timetables'); // 'timetables' | 'students' | 'faculty' | 'sections' | 'availability' | 'audit-logs'
  const [stats, setStats] = useState(null);
  const [students, setStudents] = useState([]);
  const [faculty, setFaculty] = useState([]);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modals & Forms
  const [studentYearFilter, setStudentYearFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingUser, setEditingUser] = useState(null); // for editing phone/name/year
  const [newSectionYear, setNewSectionYear] = useState(1);
  const [newSectionName, setNewSectionName] = useState('');
  const [isAddUserModal, setIsAddUserModal] = useState(false);
  const [newUserRole, setNewUserRole] = useState('student');
  const [newUserData, setNewUserData] = useState({
    name: '',
    register_id: '',
    password: '',
    phone: '',
    year: '1'
  });

  // Student Password Reset (Admin override)
  const [resettingStudent, setResettingStudent] = useState(null);
  const [newStudentPassword, setNewStudentPassword] = useState('student123');
  const [showStudentPw, setShowStudentPw] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    loadStats();
    loadSections();
  }, []);

  useEffect(() => {
    if (activeTab === 'students') loadStudents();
    if (activeTab === 'faculty') loadFaculty();
    if (activeTab === 'sections') loadSections();
    if (activeTab === 'stats') loadStats();
    if (activeTab === 'audit-logs') loadAuditLogs();
  }, [activeTab, studentYearFilter, searchTerm]);

  const loadStats = async () => {
    try {
      const data = await directoryApi.getStats();
      setStats(data);
    } catch (e) {
      console.error(e);
    }
  };

  const loadSections = async () => {
    try {
      const data = await timetableApi.getSections();
      setSections(data.sections || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadStudents = async () => {
    setLoading(true);
    try {
      const data = await directoryApi.getStudents(studentYearFilter, searchTerm);
      setStudents(data.students || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadFaculty = async () => {
    setLoading(true);
    try {
      const data = await directoryApi.getFaculty(searchTerm);
      setFaculty(data.faculty || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const data = await directoryApi.getAuditLogs();
      setAuditLogs(data.logs || []);
    } catch (e) {
      console.error(e);
    } finally {
      setAuditLoading(false);
    }
  };

  const handleResetStudentPassword = async (e) => {
    e.preventDefault();
    if (!resettingStudent || !newStudentPassword) return;
    if (newStudentPassword.length < 6) {
      setResetError('Password must be at least 6 characters.');
      return;
    }
    setResetLoading(true);
    setResetError('');
    try {
      await directoryApi.resetStudentPassword(resettingStudent.id, newStudentPassword);
      setResetSuccess(`Password for ${resettingStudent.name} (${resettingStudent.register_id}) has been updated!`);
      loadAuditLogs();
      setTimeout(() => {
        setResettingStudent(null);
        setResetSuccess('');
      }, 1500);
    } catch (err) {
      setResetError(err.message || 'Failed to reset student password.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await directoryApi.updateUser(editingUser.id, {
        name: editingUser.name,
        phone: editingUser.phone,
        year: editingUser.year ? parseInt(editingUser.year, 10) : null,
        designation: editingUser.designation,
        qualification: editingUser.qualification,
        status: editingUser.status
      });
      setSuccess(`User "${editingUser.name}" updated successfully!`);
      setEditingUser(null);
      if (activeTab === 'students') loadStudents();
      if (activeTab === 'faculty') loadFaculty();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to update user.');
    }
  };

  const handleDeleteUser = async (userId, userName) => {
    if (!confirm(`Are you sure you want to delete user "${userName}"? This cannot be undone.`)) return;
    try {
      await directoryApi.deleteUser(userId);
      setSuccess(`User "${userName}" deleted.`);
      if (activeTab === 'students') loadStudents();
      if (activeTab === 'faculty') loadFaculty();
      loadStats();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to delete user.');
    }
  };

  const handleAddSection = async (e) => {
    e.preventDefault();
    if (!newSectionName.trim()) return;
    try {
      await timetableApi.addSection(newSectionYear, newSectionName.trim());
      setSuccess(`Section "${newSectionName.trim()}" added for Year ${newSectionYear}!`);
      setNewSectionName('');
      loadSections();
      loadStats();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to add section.');
    }
  };

  const handleDeleteSection = async (sectionId, sectionName, sectionYear) => {
    if (!confirm(`Delete Section "${sectionName}" (Year ${sectionYear}) and all associated timetables?`)) return;
    try {
      await timetableApi.deleteSection(sectionId);
      setSuccess(`Section "${sectionName}" deleted.`);
      loadSections();
      loadStats();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to delete section.');
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      await authApi.register({
        name: newUserData.name.trim(),
        register_id: newUserData.register_id.trim().toUpperCase(),
        password: newUserData.password,
        role: newUserRole,
        phone: newUserData.phone.trim(),
        year: newUserRole === 'student' ? parseInt(newUserData.year, 10) : null
      });
      setSuccess(`New ${newUserRole} created successfully!`);
      setIsAddUserModal(false);
      setNewUserData({ name: '', register_id: '', password: '', phone: '', year: '1' });
      if (activeTab === 'students') loadStudents();
      if (activeTab === 'faculty') loadFaculty();
      loadStats();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to create user.');
    }
  };

  const isLandingDashboard = activeTab === 'timetables';

  return (
    <div className={`w-full transition-all duration-300 ${isLandingDashboard ? 'bg-postlogin-green' : 'bg-slate-50'}`}>
      <div className={`w-full min-h-[calc(100vh-80px)] ${isLandingDashboard ? 'bg-slate-50/80 backdrop-blur-[1px]' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {/* Admin Header */}
      <div className="bg-navy-900 text-white rounded-2xl p-6 shadow-md flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-400 text-navy-950 flex items-center justify-center font-black shadow-md">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black">
                Administrator Control Center
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-400 text-navy-950">
                Full Privileges
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 mt-0.5">
              Logged in as <span className="font-bold text-white">{user.name}</span> ({user.register_id}) · AIML Department
            </p>
          </div>
        </div>

        {/* Action Button: Create New User */}
        <button
          onClick={() => setIsAddUserModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/20 transition-all active:scale-95 cursor-pointer"
        >
          <Plus className="w-4 h-4 text-amber-300" />
          <span>Register Account / Admin</span>
        </button>
      </div>

      {/* Stats Summary Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-academic">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">Total Students</span>
              <GraduationCap className="w-5 h-5 text-navy-800" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-navy-900">{stats.students}</div>
            <div className="text-[11px] text-slate-500 mt-1 font-medium">Enrolled across 1st–4th Year</div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-academic">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">Faculty Members</span>
              <BookOpenCheck className="w-5 h-5 text-navy-800" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-navy-900">{stats.faculty}</div>
            <div className="text-[11px] text-slate-500 mt-1 font-medium">AIML Teaching Staff</div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-academic">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">Active Sections</span>
              <Layers className="w-5 h-5 text-navy-800" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-navy-900">{stats.sections}</div>
            <div className="text-[11px] text-slate-500 mt-1 font-medium">Across all 4 cohorts</div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-academic">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">Timetable Slots</span>
              <Clock className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-navy-900">{stats.timetable_slots}</div>
            <div className="text-[11px] text-slate-500 mt-1 font-medium">Configured periods</div>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-2 sm:gap-4 overflow-x-auto">
        <button
          onClick={() => setActiveTab('timetables')}
          className={`pb-3 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'timetables'
              ? 'border-navy-900 text-navy-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Timetable Editor & Importer</span>
        </button>

        <button
          onClick={() => setActiveTab('sections')}
          className={`pb-3 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'sections'
              ? 'border-navy-900 text-navy-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Manage Sections</span>
        </button>

        <button
          onClick={() => setActiveTab('students')}
          className={`pb-3 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'students'
              ? 'border-navy-900 text-navy-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <GraduationCap className="w-4 h-4" />
          <span>Manage Students</span>
        </button>

        <button
          onClick={() => setActiveTab('faculty')}
          className={`pb-3 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'faculty'
              ? 'border-navy-900 text-navy-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BookOpenCheck className="w-4 h-4" />
          <span>Manage Faculty</span>
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
          <span>Faculty Availability Matrix</span>
        </button>

        <button
          onClick={() => setActiveTab('audit-logs')}
          className={`pb-3 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'audit-logs'
              ? 'border-navy-900 text-navy-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          <span>Security Audit Trail</span>
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

      {/* TAB 1: Timetable Editor */}
      {activeTab === 'timetables' && (
        <TimetableGrid user={user} initialYear={1} />
      )}

      {/* TAB 2: Manage Sections */}
      {activeTab === 'sections' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-academic">
            <h2 className="text-lg font-black text-navy-900 mb-1">
              Add & Configure Department Sections
            </h2>
            <p className="text-xs text-slate-500 mb-6">
              Sections organize classes within each year of the AIML curriculum (e.g. Section A, Section B).
            </p>

            {/* Add Section Form */}
            <form onSubmit={handleAddSection} className="flex flex-col sm:flex-row items-end gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 mb-8">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Year</label>
                <select
                  value={newSectionYear}
                  onChange={(e) => setNewSectionYear(parseInt(e.target.value, 10))}
                  className="text-xs font-bold bg-white border border-slate-300 rounded-xl px-3 py-2"
                >
                  <option value={1}>1st Year AIML</option>
                  <option value={2}>2nd Year AIML</option>
                  <option value={3}>3rd Year AIML</option>
                  <option value={4}>4th Year AIML</option>
                </select>
              </div>

              <div className="flex-1">
                <label className="block text-xs font-bold text-slate-700 mb-1">Section Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Section C or AIML-C"
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  className="w-full text-xs font-medium bg-white border border-slate-300 rounded-xl px-3 py-2"
                />
              </div>

              <button
                type="submit"
                className="px-4 py-2 text-xs font-bold bg-navy-900 text-white rounded-xl hover:bg-navy-800 shadow-xs flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Section</span>
              </button>
            </form>

            {/* List of Sections by Year */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(yr => {
                const yearSections = sections.filter(s => s.year === yr);
                return (
                  <div key={yr} className="border border-slate-200 rounded-xl p-4 bg-white">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-3">
                      <h3 className="font-bold text-xs text-navy-900">
                        {yr}{yr === 1 ? 'st' : yr === 2 ? 'nd' : yr === 3 ? 'rd' : 'th'} Year AIML
                      </h3>
                      <span className="text-[10px] font-bold text-slate-400">
                        {yearSections.length} Section{yearSections.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {yearSections.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No sections created yet.</p>
                      ) : (
                        yearSections.map(s => (
                          <div 
                            key={s.id} 
                            className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200/80 text-xs font-medium"
                          >
                            <span className="font-bold text-slate-800">{s.name}</span>
                            <button
                              onClick={() => handleDeleteSection(s.id, s.name, s.year)}
                              className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Delete section"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      )}

      {/* TAB 3: Manage Students */}
      {activeTab === 'students' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-academic">
            
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-black text-navy-900">
                  Manage Students Registry
                </h2>
                <p className="text-xs text-slate-500">
                  Update records, verify unique register IDs, or remove student accounts.
                </p>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search students..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50"
                  />
                </div>

                <select
                  value={studentYearFilter}
                  onChange={(e) => setStudentYearFilter(e.target.value)}
                  className="text-xs font-bold border border-slate-200 rounded-xl px-3 py-1.5 bg-white"
                >
                  <option value="">All Years</option>
                  <option value="1">1st Year</option>
                  <option value="2">2nd Year</option>
                  <option value="3">3rd Year</option>
                  <option value="4">4th Year</option>
                </select>
              </div>
            </div>

            {/* Students Table */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-[11px] font-bold text-navy-900 uppercase">
                    <th className="py-2.5 px-4">Register ID</th>
                    <th className="py-2.5 px-4">Student Name</th>
                    <th className="py-2.5 px-4">Year</th>
                    <th className="py-2.5 px-4">Phone</th>
                    <th className="py-2.5 px-4">Registered</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {students.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="py-8 text-center text-slate-400">
                        No students matching the criteria.
                      </td>
                    </tr>
                  ) : (
                    students.map(s => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-mono font-bold text-navy-900">{s.register_id}</td>
                        <td className="py-3 px-4 font-bold text-slate-800">{s.name}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-navy-50 text-navy-900 border border-navy-200">
                            Year {s.year}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-700">{s.phone || '—'}</td>
                        <td className="py-3 px-4 text-slate-400 text-[11px]">
                          {s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-3 px-4 text-right space-x-2">
                          <button
                            onClick={() => {
                              setResettingStudent(s);
                              setNewStudentPassword('student123');
                              setResetError('');
                              setResetSuccess('');
                              setShowStudentPw(false);
                            }}
                            className="text-xs font-bold text-amber-600 hover:text-amber-800 transition-colors"
                          >
                            Reset Pwd
                          </button>
                          <button
                            onClick={() => setEditingUser(s)}
                            className="text-xs font-bold text-navy-900 hover:text-navy-700"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteUser(s.id, s.name)}
                            className="text-xs font-bold text-red-600 hover:text-red-800"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      )}

      {/* TAB 4: Manage Faculty */}
      {activeTab === 'faculty' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-academic">
            
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-black text-navy-900">
                  Manage Faculty Registry
                </h2>
                <p className="text-xs text-slate-500">
                  View staff profiles, edit designations and contact info, or add new staff.
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search faculty name or ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50"
                />
              </div>
            </div>

            {/* Faculty Table */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-[11px] font-bold text-navy-900 uppercase">
                    <th className="py-2.5 px-4">Employee ID</th>
                    <th className="py-2.5 px-4">Faculty Name</th>
                    <th className="py-2.5 px-4">Designation</th>
                    <th className="py-2.5 px-4">Qualification</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Phone</th>
                    <th className="py-2.5 px-4">Role</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {faculty.map(f => {
                    const isPending = f.status === 'pending';
                    return (
                      <tr key={f.id} className={isPending ? 'bg-amber-50/50 hover:bg-amber-100/50' : 'hover:bg-slate-50'}>
                        <td className="py-3 px-4 font-mono font-bold text-navy-900">{f.register_id}</td>
                        <td className="py-3 px-4 font-bold text-slate-800">
                          {f.name}
                          {isPending && (
                            <span className="ml-2 text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                              Slot Reserved
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-600">{f.designation || 'Faculty Member'}</td>
                        <td className="py-3 px-4 font-medium text-slate-700">{f.qualification || '—'}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] inline-flex items-center gap-1 ${
                            isPending ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${isPending ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                            {isPending ? 'Pending Details' : 'Active'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-700">{f.phone || '—'}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                            f.role === 'admin' ? 'bg-amber-100 text-amber-900' : 'bg-navy-50 text-navy-900'
                          }`}>
                            {f.role.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right space-x-2">
                          <button
                            onClick={() => setEditingUser(f)}
                            className={`text-xs font-bold ${
                              isPending
                                ? 'text-amber-700 hover:text-amber-900 underline'
                                : 'text-navy-900 hover:text-navy-700'
                            }`}
                          >
                            {isPending ? 'Complete Profile' : 'Edit'}
                          </button>
                          {f.id !== user.id && (
                            <button
                              onClick={() => handleDeleteUser(f.id, f.name)}
                              className="text-xs font-bold text-red-600 hover:text-red-800"
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      )}

      {/* TAB 5: Availability Matrix */}
      {activeTab === 'availability' && (
        <FacultyAvailabilityView user={user} />
      )}

      {/* TAB 6: Security Audit Trail */}
      {activeTab === 'audit-logs' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-academic">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-black text-navy-900 flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-navy-800" />
                  <span>Security Audit Trail</span>
                </h2>
                <p className="text-xs text-slate-500">
                  Chronological security event logs for password changes, student resets, and system credentials.
                </p>
              </div>
              <button
                onClick={loadAuditLogs}
                className="px-3 py-1.5 text-xs font-bold text-navy-900 border border-slate-200 hover:bg-slate-50 rounded-xl flex items-center gap-1.5 transition-colors self-start sm:self-auto"
              >
                <span>Refresh Logs</span>
              </button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-[11px] font-bold text-navy-900 uppercase">
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">Action</th>
                    <th className="py-2.5 px-4">Performed By</th>
                    <th className="py-2.5 px-4">Target User</th>
                    <th className="py-2.5 px-4">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {auditLoading ? (
                    <tr>
                      <td colSpan="5" className="py-8 text-center text-slate-400">
                        Loading security audit logs...
                      </td>
                    </tr>
                  ) : auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="py-8 text-center text-slate-400">
                        No security audit logs recorded yet.
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map(log => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-slate-100 text-slate-800 border border-slate-200">
                            {log.action}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-navy-900">
                          {log.performed_by_id || 'System'}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-slate-700">
                          {log.target_user_id || '—'}
                        </td>
                        <td className="py-3 px-4 text-slate-600 max-w-sm truncate">
                          {log.details || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <h3 className="text-base font-bold text-navy-900 mb-1">
              Edit User Profile
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              ID: {editingUser.register_id} ({editingUser.role})
            </p>

            <form onSubmit={handleUpdateUser} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editingUser.name}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={editingUser.phone || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300"
                />
              </div>

              {editingUser.role === 'student' ? (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Academic Year</label>
                  <select
                    value={editingUser.year || 1}
                    onChange={(e) => setEditingUser({ ...editingUser, year: parseInt(e.target.value, 10) })}
                    className="w-full text-xs p-2 rounded-lg border border-slate-300"
                  >
                    <option value={1}>1st Year</option>
                    <option value={2}>2nd Year</option>
                    <option value={3}>3rd Year</option>
                    <option value={4}>4th Year</option>
                  </select>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Designation</label>
                    <input
                      type="text"
                      value={editingUser.designation || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, designation: e.target.value })}
                      className="w-full text-xs p-2 rounded-lg border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Qualification</label>
                    <input
                      type="text"
                      placeholder="e.g. M.Tech, Ph.D"
                      value={editingUser.qualification || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, qualification: e.target.value })}
                      className="w-full text-xs p-2 rounded-lg border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Status</label>
                    <select
                      value={editingUser.status || 'active'}
                      onChange={(e) => setEditingUser({ ...editingUser, status: e.target.value })}
                      className="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white"
                    >
                      <option value="active">Active (Fully Configured)</option>
                      <option value="pending">Pending Details (Reserved Slot)</option>
                    </select>
                  </div>
                </>
              )}

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold bg-navy-900 text-white rounded-lg hover:bg-navy-800"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add User Modal (Student, Faculty, or Admin) */}
      {isAddUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <h3 className="text-base font-bold text-navy-900 mb-1">
              Register New Academic Account
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Create a new student, faculty, or administrator account for RGMCET AIML.
            </p>

            <form onSubmit={handleCreateUser} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Role</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewUserRole('student')}
                    className={`py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      newUserRole === 'student' ? 'bg-navy-900 text-white border-navy-900' : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    Student
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewUserRole('faculty')}
                    className={`py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      newUserRole === 'faculty' ? 'bg-navy-900 text-white border-navy-900' : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    Faculty
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewUserRole('admin')}
                    className={`py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      newUserRole === 'admin' ? 'bg-navy-900 text-white border-navy-900' : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    Admin
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder={
                    newUserRole === 'student' ? 'e.g. Ramesh Kumar' : 
                    newUserRole === 'faculty' ? 'e.g. Dr. K. Ramesh' : 'e.g. Prof. Administrator'
                  }
                  value={newUserData.name}
                  onChange={(e) => setNewUserData({ ...newUserData, name: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {newUserRole === 'student' 
                    ? 'Register ID' 
                    : newUserRole === 'faculty' 
                      ? 'Employee ID' 
                      : 'Admin Username / ID'} (Unique)
                </label>
                <input
                  type="text"
                  required
                  placeholder={
                    newUserRole === 'student' ? 'e.g. 24091A3355' : 
                    newUserRole === 'faculty' ? 'e.g. FAC010' : 'e.g. ADMIN003'
                  }
                  value={newUserData.register_id}
                  onChange={(e) => setNewUserData({ ...newUserData, register_id: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300 font-mono uppercase"
                />
              </div>

              {newUserRole === 'student' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Year</label>
                  <select
                    value={newUserData.year}
                    onChange={(e) => setNewUserData({ ...newUserData, year: e.target.value })}
                    className="w-full text-xs p-2 rounded-lg border border-slate-300"
                  >
                    <option value="1">1st Year</option>
                    <option value="2">2nd Year</option>
                    <option value="3">3rd Year</option>
                    <option value="4">4th Year</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Phone</label>
                <input
                  type="tel"
                  placeholder="Phone number"
                  value={newUserData.phone}
                  onChange={(e) => setNewUserData({ ...newUserData, phone: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Initial Password</label>
                <input
                  type="password"
                  required
                  placeholder="Temporary password"
                  value={newUserData.password}
                  onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddUserModal(false)}
                  className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold bg-navy-900 text-white rounded-lg hover:bg-navy-800"
                >
                  Create {newUserRole.toUpperCase()} Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Student Password Reset Modal (Admin Override) */}
      {resettingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-navy-900 leading-tight">
                    Reset Student Password
                  </h3>
                  <p className="text-xs text-slate-500">
                    {resettingStudent.name} ({resettingStudent.register_id})
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setResettingStudent(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {resetError && (
              <div className="p-3 mb-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{resetError}</span>
              </div>
            )}

            {resetSuccess && (
              <div className="p-3 mb-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                <span>{resetSuccess}</span>
              </div>
            )}

            <form onSubmit={handleResetStudentPassword} className="space-y-3 mt-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">
                    New Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setNewStudentPassword('student123')}
                    className="text-[10px] font-bold text-navy-900 hover:underline cursor-pointer"
                  >
                    Set Default (student123)
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type={showStudentPw ? 'text' : 'password'}
                    required
                    value={newStudentPassword}
                    onChange={(e) => setNewStudentPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="w-full pl-9 pr-9 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900 focus:ring-1 focus:ring-navy-900 bg-slate-50/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowStudentPw(!showStudentPw)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showStudentPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-500 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span>
                  This override will immediately update the student's credentials and will be logged in the security audit trail.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResettingStudent(null)}
                  className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetLoading || !newStudentPassword}
                  className="px-4 py-1.5 text-xs font-bold bg-navy-900 text-white rounded-lg hover:bg-navy-800 disabled:opacity-50 cursor-pointer"
                >
                  {resetLoading ? 'Resetting...' : 'Save New Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

        </div>
      </div>
    </div>
  );
}
