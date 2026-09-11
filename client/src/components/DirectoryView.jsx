import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserCheck, 
  GraduationCap, 
  Search, 
  Phone, 
  ShieldAlert, 
  BookOpen, 
  Calendar, 
  Mail,
  Lock,
  Download,
  Key,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  X,
  Edit3,
  UserPlus
} from 'lucide-react';
import { directoryApi } from '../api';

export default function DirectoryView({ user }) {
  const [activeTab, setActiveTab] = useState('students'); // 'students' | 'faculty'
  const [yearFilter, setYearFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [students, setStudents] = useState([]);
  const [faculty, setFaculty] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Student Password Reset Modal State
  const [passwordResetStudent, setPasswordResetStudent] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');

  // Faculty Profile Edit / Activation Modal State
  const [editingFaculty, setEditingFaculty] = useState(null);
  const [facultyFormData, setFacultyFormData] = useState({
    name: '',
    designation: '',
    qualification: '',
    phone: '',
    status: 'active'
  });
  const [facultyEditLoading, setFacultyEditLoading] = useState(false);
  const [facultyEditError, setFacultyEditError] = useState('');
  const [facultyEditSuccess, setFacultyEditSuccess] = useState('');

  const handleOpenEditFaculty = (f) => {
    setEditingFaculty(f);
    setFacultyFormData({
      name: f.name.includes('(Pending)') ? '' : f.name,
      designation: f.designation && !f.designation.includes('Pending Details') ? f.designation : 'Assistant Professor',
      qualification: f.qualification && !f.qualification.includes('Pending') ? f.qualification : '',
      phone: f.phone || '',
      status: f.status === 'pending' ? 'active' : (f.status || 'active')
    });
    setFacultyEditError('');
    setFacultyEditSuccess('');
  };

  const handleFacultyProfileSubmit = async (e) => {
    e.preventDefault();
    if (!editingFaculty) return;
    if (!facultyFormData.name.trim()) {
      setFacultyEditError('Faculty full name is required.');
      return;
    }

    setFacultyEditLoading(true);
    setFacultyEditError('');
    setFacultyEditSuccess('');

    try {
      await directoryApi.updateUser(editingFaculty.id, {
        name: facultyFormData.name.trim(),
        designation: facultyFormData.designation.trim(),
        qualification: facultyFormData.qualification.trim(),
        phone: facultyFormData.phone.trim(),
        status: facultyFormData.status
      });

      setFacultyEditSuccess('Faculty profile updated successfully!');
      loadFaculty();
      setTimeout(() => {
        setEditingFaculty(null);
        setFacultyEditSuccess('');
      }, 1200);
    } catch (err) {
      setFacultyEditError(err.message || 'Failed to update faculty profile.');
    } finally {
      setFacultyEditLoading(false);
    }
  };

  const canAccess = user && (user.role === 'faculty' || user.role === 'admin');

  useEffect(() => {
    if (canAccess) {
      if (activeTab === 'students') {
        loadStudents();
      } else {
        loadFaculty();
      }
    }
  }, [activeTab, yearFilter, searchTerm, canAccess]);

  const loadStudents = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await directoryApi.getStudents(yearFilter, searchTerm);
      setStudents(res.students || []);
    } catch (err) {
      setError(err.message || 'Failed to load students directory.');
    } finally {
      setLoading(false);
    }
  };

  const loadFaculty = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await directoryApi.getFaculty(searchTerm);
      setFaculty(res.faculty || []);
    } catch (err) {
      setError(err.message || 'Failed to load faculty directory.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPasswordSubmit = async (e) => {
    e.preventDefault();
    if (!passwordResetStudent) return;
    if (!newPassword || newPassword.length < 6) {
      setResetError('Password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match.');
      return;
    }

    setResetLoading(true);
    setResetError('');
    setResetSuccess('');

    try {
      const res = await directoryApi.resetStudentPassword(passwordResetStudent.id, newPassword);
      setResetSuccess(res.message || 'Password updated successfully!');
      setTimeout(() => {
        setPasswordResetStudent(null);
        setResetSuccess('');
      }, 1500);
    } catch (err) {
      setResetError(err.message || 'Failed to update student password.');
    } finally {
      setResetLoading(false);
    }
  };

  // If user is a student, enforce privacy boundary visually & explicitly
  if (!canAccess) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 shadow-academic max-w-2xl mx-auto my-8">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-navy-900 mb-2">
          Directory Access Restricted
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed mb-6">
          According to the RGMCET privacy policy, student and faculty personal contact details are 
          strictly restricted to logged-in faculty members and administrators.
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold">
          <span>Your account role:</span>
          <span className="capitalize text-navy-900 font-black">{user?.role || 'Guest'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Banner */}
      <div className="bg-navy-900 text-white rounded-2xl p-6 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-navy-800 text-emerald-300 text-xs font-bold mb-2 border border-navy-700">
              <UserCheck className="w-3.5 h-3.5" />
              <span>Authorized Personnel Only ({user.role.toUpperCase()})</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight">
              Academic Directory & Personal Contacts
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1">
              Secure contact registry for students and faculty members in the AIML department.
            </p>
          </div>

          <div className="inline-flex rounded-xl p-1 bg-navy-800 border border-navy-700">
            <button
              onClick={() => setActiveTab('students')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                activeTab === 'students' ? 'bg-amber-400 text-navy-950 shadow-xs' : 'text-slate-300 hover:text-white'
              }`}
            >
              Student Directory
            </button>
            <button
              onClick={() => setActiveTab('faculty')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                activeTab === 'faculty' ? 'bg-amber-400 text-navy-950 shadow-xs' : 'text-slate-300 hover:text-white'
              }`}
            >
              Faculty Directory
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-academic flex flex-col sm:flex-row items-center justify-between gap-4">
        
        {/* Search */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder={activeTab === 'students' ? 'Search by name, ID, or phone...' : 'Search faculty name or ID...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs font-medium rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900 bg-slate-50/50"
          />
        </div>

        {/* Year Filter for students */}
        {activeTab === 'students' && (
          <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1 text-[10px]">Year:</span>
            <button
              onClick={() => setYearFilter('')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                yearFilter === '' ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              All
            </button>
            {[1, 2, 3, 4].map(yr => (
              <button
                key={yr}
                onClick={() => setYearFilter(yr.toString())}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                  yearFilter === yr.toString() ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {yr}Yr
              </button>
            ))}
          </div>
        )}

      </div>

      {/* Content Table */}
      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 text-slate-400">
          <p className="text-sm font-semibold">Loading directory records...</p>
        </div>
      ) : activeTab === 'students' ? (
        /* Students Directory Table */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-academic overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/90 border-b border-slate-200 text-[11px] font-bold text-navy-900 uppercase">
                  <th className="py-3 px-4">Register ID</th>
                  <th className="py-3 px-4">Student Name</th>
                  <th className="py-3 px-4">Academic Year</th>
                  <th className="py-3 px-4">Contact Phone</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {students.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-8 text-center text-slate-400 font-medium">
                      No student records found.
                    </td>
                  </tr>
                ) : (
                  students.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-navy-900">
                        {s.register_id}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-800">
                        {s.name}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-navy-50 text-navy-900 border border-navy-200">
                          {s.year}{s.year === 1 ? 'st' : s.year === 2 ? 'nd' : s.year === 3 ? 'rd' : 'th'} Year AIML
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-700 flex items-center gap-1.5 pt-4">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span>{s.phone || '—'}</span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => {
                            setPasswordResetStudent(s);
                            setNewPassword('');
                            setConfirmPassword('');
                            setResetError('');
                            setResetSuccess('');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-navy-50 hover:bg-navy-100 text-navy-900 border border-navy-200 text-xs font-bold transition-all active:scale-95"
                          title="Reset student password"
                        >
                          <Key className="w-3 h-3 text-navy-800" />
                          <span>Reset Password</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Faculty Directory Table */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-academic overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/90 border-b border-slate-200 text-[11px] font-bold text-navy-900 uppercase">
                  <th className="py-3 px-4">Employee ID</th>
                  <th className="py-3 px-4">Faculty Name</th>
                  <th className="py-3 px-4">Qualification</th>
                  <th className="py-3 px-4">Contact Phone</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {faculty.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-8 text-center text-slate-400 font-medium">
                      No faculty records found.
                    </td>
                  </tr>
                ) : (
                  faculty.map(f => (
                    <tr key={f.id} className={`hover:bg-slate-50/70 transition-colors ${f.status === 'pending' ? 'bg-amber-50/40' : ''}`}>
                      <td className="py-3 px-4 font-mono font-bold text-navy-900">
                        {f.register_id}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-800">{f.name}</div>
                        {f.status === 'pending' && (
                          <div className="text-[10px] text-amber-700 font-semibold">Reserved Slot</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-medium">
                        <span className="font-semibold text-navy-900">{f.qualification || '—'}</span>
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          <span>{f.phone || '—'}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {f.status === 'pending' ? (
                          <button
                            onClick={() => handleOpenEditFaculty(f)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-navy-950 text-xs font-black shadow-xs transition-all active:scale-95 cursor-pointer"
                            title="Complete and activate this faculty profile"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>Complete Profile</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleOpenEditFaculty(f)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-bold transition-all active:scale-95 cursor-pointer"
                            title="Edit faculty profile"
                          >
                            <Edit3 className="w-3 h-3 text-slate-500" />
                            <span>Edit</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Student Password Reset Modal (Admin & Faculty) */}
      {passwordResetStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-navy-100 text-navy-900 flex items-center justify-center font-bold">
                  <Key className="w-4 h-4 text-navy-900" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-navy-900">
                    Reset Student Password
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Set a new secure password for this student
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPasswordResetStudent(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target Student Details */}
            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 mb-4 flex items-center justify-between text-xs">
              <div>
                <div className="font-bold text-navy-900">{passwordResetStudent.name}</div>
                <div className="text-[11px] font-mono text-slate-500">ID: {passwordResetStudent.register_id}</div>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-navy-50 text-navy-900 border border-navy-200">
                Year {passwordResetStudent.year}
              </span>
            </div>

            {/* Feedback Alerts */}
            {resetError && (
              <div className="p-3 mb-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{resetError}</span>
              </div>
            )}
            {resetSuccess && (
              <div className="p-3 mb-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{resetSuccess}</span>
              </div>
            )}

            <form onSubmit={handleResetPasswordSubmit} className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">New Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setNewPassword('student123');
                      setConfirmPassword('student123');
                    }}
                    className="text-[10px] font-bold text-navy-800 hover:underline"
                  >
                    Set Default ("student123")
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Enter at least 6 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pl-9 pr-10 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Confirm New Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Re-enter new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-9 pr-10 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50"
                  />
                </div>
              </div>

              <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200 text-[10px] text-amber-900 leading-snug">
                🔒 <strong>Security Audit:</strong> This password reset will be recorded in departmental audit logs under your account (<span className="font-semibold">{user.name}</span>, <span className="font-semibold uppercase">{user.role}</span>).
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPasswordResetStudent(null)}
                  className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="px-4 py-1.5 text-xs font-bold bg-navy-900 text-white rounded-lg hover:bg-navy-800 disabled:opacity-50"
                >
                  {resetLoading ? 'Updating...' : 'Save New Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Faculty Profile Edit / Activation Modal */}
      {editingFaculty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white w-full max-w-lg rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold ${
                  editingFaculty.status === 'pending' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-navy-100 text-navy-900'
                }`}>
                  {editingFaculty.status === 'pending' ? <UserPlus className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-navy-900">
                    {editingFaculty.status === 'pending' ? 'Activate Faculty Profile' : 'Edit Faculty Details'}
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    Employee ID: <span className="font-bold text-slate-700">{editingFaculty.register_id}</span> · AIML Department
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditingFaculty(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editingFaculty.status === 'pending' && (
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 text-xs text-amber-900 leading-snug mb-4">
                ℹ️ <strong>Pending Slot:</strong> This profile is reserved for new faculty. Enter their details below to activate their profile across timetables and the department directory.
              </div>
            )}

            {facultyEditError && (
              <div className="p-3 mb-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{facultyEditError}</span>
              </div>
            )}
            {facultyEditSuccess && (
              <div className="p-3 mb-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{facultyEditSuccess}</span>
              </div>
            )}

            <form onSubmit={handleFacultyProfileSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. A. Sharma / Prof. B. Reddy"
                  value={facultyFormData.name}
                  onChange={(e) => setFacultyFormData({ ...facultyFormData, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-slate-50/50 focus:bg-white focus:border-navy-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Designation</label>
                  <select
                    value={facultyFormData.designation}
                    onChange={(e) => setFacultyFormData({ ...facultyFormData, designation: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-slate-50/50"
                  >
                    <option value="Assistant Professor">Assistant Professor</option>
                    <option value="Associate Professor">Associate Professor</option>
                    <option value="Professor">Professor</option>
                    <option value="Professor & HOD">Professor & HOD</option>
                    <option value="Professor & Dean">Professor & Dean</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Qualification</label>
                  <input
                    type="text"
                    placeholder="e.g. M.Tech & Ph.D / M.Tech"
                    value={facultyFormData.qualification}
                    onChange={(e) => setFacultyFormData({ ...facultyFormData, qualification: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-slate-50/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Contact Phone</label>
                  <input
                    type="tel"
                    placeholder="e.g. 9848012345"
                    value={facultyFormData.phone}
                    onChange={(e) => setFacultyFormData({ ...facultyFormData, phone: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-slate-50/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Profile Status</label>
                  <select
                    value={facultyFormData.status}
                    onChange={(e) => setFacultyFormData({ ...facultyFormData, status: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-slate-50/50 font-bold"
                  >
                    <option value="active">Active (Available)</option>
                    <option value="pending">Pending Details</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingFaculty(null)}
                  className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={facultyEditLoading}
                  className="px-4 py-1.5 text-xs font-bold bg-navy-900 text-white rounded-lg hover:bg-navy-800 disabled:opacity-50 shadow-sm cursor-pointer"
                >
                  {facultyEditLoading ? 'Saving...' : 'Save Profile Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
