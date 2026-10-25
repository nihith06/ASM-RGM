import React, { useState, useEffect } from 'react';
import { 
  UserCheck, 
  Search, 
  Phone, 
  Lock,
  AlertCircle,
  X,
  Edit3,
  UserPlus
} from 'lucide-react';
import { directoryApi } from '../api';

export default function DirectoryView({ user }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [faculty, setFaculty] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Faculty Profile Edit / Activation Modal State
  const [editingFaculty, setEditingFaculty] = useState(null);
  const [facultyFormData, setFacultyFormData] = useState({
    register_id: '',
    name: '',
    designation: '',
    qualification: '',
    phone: '',
    status: 'active'
  });
  const [facultyEditLoading, setFacultyEditLoading] = useState(false);
  const [facultyEditError, setFacultyEditError] = useState('');
  const [facultyEditSuccess, setFacultyEditSuccess] = useState('');

  const canAccess = user && (user.role === 'faculty' || user.role === 'admin');

  useEffect(() => {
    if (canAccess) {
      loadFaculty();
    }
  }, [searchTerm, canAccess]);

  const loadFaculty = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await directoryApi.getFaculty(searchTerm);
      const rawFaculty = res.faculty || [];
      setFaculty(rawFaculty.filter(f => f.register_id !== 'FAC001' && !f.name?.toLowerCase().includes('kishor kumar') && (!f.name?.toLowerCase().includes('kishor') || f.name?.toLowerCase().includes('bala'))));
    } catch (err) {
      setError(err.message || 'Failed to load faculty directory.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenEditFaculty = (f) => {
    setEditingFaculty(f);
    setFacultyFormData({
      register_id: f.register_id || '',
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
        register_id: facultyFormData.register_id ? facultyFormData.register_id.trim().toUpperCase() : '',
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

  // If user is not authorized, enforce privacy boundary
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
          According to the RGMCET privacy policy, faculty personal contact details are 
          strictly restricted to logged-in faculty members and administrators.
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold">
          <span>Access Level:</span>
          <span className="capitalize text-navy-900 font-black">{user?.role || 'Guest (Public)'}</span>
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
              Faculty Directory & Personal Contacts
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1">
              Official faculty registry, designations, and department contacts in the AIML department.
            </p>
          </div>

          <div className="inline-flex rounded-xl p-1 bg-navy-800 border border-navy-700">
            <span className="px-4 py-2 text-xs font-bold rounded-lg bg-amber-400 text-navy-950 shadow-xs">
              Faculty Directory ({faculty.length})
            </span>
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
            placeholder="Search faculty by name or employee ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs font-medium rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900 bg-slate-50/50"
          />
        </div>
      </div>

      {/* Content Table */}
      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 text-slate-400">
          <p className="text-sm font-semibold">Loading faculty records...</p>
        </div>
      ) : (
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
                          <div className="text-[10px] text-amber-700 font-semibold">Pending Approval</div>
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

      {/* Faculty Profile Edit / Approval Modal */}
      {editingFaculty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-2xl p-6 shadow-2xl border border-slate-200 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-navy-100 text-navy-900 flex items-center justify-center font-bold">
                  <Edit3 className="w-4 h-4 text-navy-900" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-navy-900">
                    {editingFaculty.status === 'pending' ? 'Activate Faculty Account' : 'Edit Faculty Profile'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {editingFaculty.register_id} · AIML Department
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditingFaculty(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {facultyEditError && (
              <div className="p-3 mb-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{facultyEditError}</span>
              </div>
            )}
            {facultyEditSuccess && (
              <div className="p-3 mb-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
                <span>{facultyEditSuccess}</span>
              </div>
            )}

            <form onSubmit={handleFacultyProfileSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Employee ID</label>
                <input
                  type="text"
                  required
                  value={facultyFormData.register_id}
                  onChange={(e) => setFacultyFormData({ ...facultyFormData, register_id: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Faculty Full Name</label>
                <input
                  type="text"
                  required
                  value={facultyFormData.name}
                  onChange={(e) => setFacultyFormData({ ...facultyFormData, name: e.target.value })}
                  placeholder="e.g. Dr. K. Ramesh"
                  className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Designation</label>
                <input
                  type="text"
                  value={facultyFormData.designation}
                  onChange={(e) => setFacultyFormData({ ...facultyFormData, designation: e.target.value })}
                  placeholder="e.g. Assistant Professor"
                  className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Qualification</label>
                <input
                  type="text"
                  value={facultyFormData.qualification}
                  onChange={(e) => setFacultyFormData({ ...facultyFormData, qualification: e.target.value })}
                  placeholder="e.g. M.Tech, Ph.D"
                  className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Contact Phone</label>
                <input
                  type="tel"
                  value={facultyFormData.phone}
                  onChange={(e) => setFacultyFormData({ ...facultyFormData, phone: e.target.value })}
                  placeholder="e.g. 9848012345"
                  className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50"
                />
              </div>

              {user?.role === 'admin' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Account Status</label>
                  <select
                    value={facultyFormData.status}
                    onChange={(e) => setFacultyFormData({ ...facultyFormData, status: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/50"
                  >
                    <option value="active">Active</option>
                    <option value="pending">Pending Approval</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
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
                  className="px-4 py-1.5 text-xs font-bold bg-navy-900 text-white rounded-lg hover:bg-navy-800 disabled:opacity-50 cursor-pointer"
                >
                  {facultyEditLoading ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
