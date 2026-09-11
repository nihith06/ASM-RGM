import React, { useState } from 'react';
import { 
  GraduationCap, 
  Calendar, 
  Clock, 
  Sparkles, 
  BookOpen, 
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';
import TimetableGrid from '../components/TimetableGrid';
import FacultyAvailabilityView from '../components/FacultyAvailabilityView';

export default function StudentDashboard({ user }) {
  const studentYear = user?.year || 3;
  const [activeTab, setActiveTab] = useState('my-schedule'); // 'my-schedule' | 'all-timetables' | 'faculty-availability'

  const isLandingDashboard = activeTab === 'my-schedule';

  return (
    <div className={`w-full transition-all duration-300 ${isLandingDashboard ? 'bg-postlogin-green' : 'bg-slate-50'}`}>
      <div className={`w-full min-h-[calc(100vh-80px)] ${isLandingDashboard ? 'bg-slate-50/80 backdrop-blur-[1px]' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {/* Student Welcome Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-academic flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-navy-900 text-white flex items-center justify-center font-bold shadow-md">
            <GraduationCap className="w-8 h-8 text-amber-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-navy-900">
                Welcome, {user.name}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-navy-50 text-navy-900 border border-navy-200">
                {studentYear}{studentYear === 1 ? 'st' : studentYear === 2 ? 'nd' : studentYear === 3 ? 'rd' : 'th'} Year AIML
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Register ID: <span className="font-mono font-bold text-slate-700">{user.register_id}</span> · Department of Artificial Intelligence & Machine Learning
            </p>
          </div>
        </div>

        {/* Privacy Notice Pill */}
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-xl text-xs text-slate-600 max-w-sm">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Directory privacy active: Peer contact details are protected.</span>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
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
          <span>My Class Timetable (Year {studentYear})</span>
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
          <span>Browse All Years (1st–4th)</span>
        </button>

        <button
          onClick={() => setActiveTab('faculty-availability')}
          className={`pb-3 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'faculty-availability'
              ? 'border-navy-900 text-navy-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Faculty Availability & Free Periods</span>
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'my-schedule' && (
        <TimetableGrid user={user} initialYear={studentYear} hideControls={true} />
      )}

      {activeTab === 'all-timetables' && (
        <div className="space-y-4">
          <div className="text-xs text-slate-500">
            Browse full Monday–Saturday academic timetables across all four years of AIML.
          </div>
          <TimetableGrid user={user} initialYear={studentYear} />
        </div>
      )}

      {activeTab === 'faculty-availability' && (
        <FacultyAvailabilityView user={user} />
      )}

        </div>
      </div>
    </div>
  );
}
