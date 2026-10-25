import React, { useState } from 'react';
import { 
  Calendar, 
  Clock, 
  BookOpenCheck, 
  ShieldCheck, 
  GraduationCap,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import TimetableGrid from '../components/TimetableGrid';
import FacultyAvailabilityView from '../components/FacultyAvailabilityView';

export default function LandingPage({ onSelectRole }) {
  const [activeTab, setActiveTab] = useState('timetable'); // 'timetable' | 'availability'

  return (
    <div className="min-h-[calc(100vh-80px)] flex flex-col justify-between">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 w-full">
        
        {/* Official College & Department Banner */}
        <div className="bg-navy-900 text-white rounded-2xl p-6 sm:p-8 shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-amber-400/10 rounded-full blur-3xl pointer-events-none" />
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div className="space-y-2 max-w-3xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-400/20 text-amber-300 text-xs font-bold border border-amber-400/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Autonomous Institution · Affiliated to JNTUA</span>
              </div>
              
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white leading-tight">
                Rajeev Gandhi Memorial College of Engineering and Technology
              </h1>
              
              <div className="text-sm sm:text-base font-bold text-slate-200">
                Department of Computer Science & Engineering and Artificial Intelligence & Machine Learning (AIML)
              </div>
              
              <div className="flex flex-wrap items-center gap-3 pt-1 text-xs sm:text-sm text-slate-300">
                <span className="font-semibold bg-white/10 px-2.5 py-1 rounded-lg border border-white/10">
                  HOD: <strong className="text-white">Dr. G. Kishor Kumar</strong>
                </span>
                <span className="text-slate-400">·</span>
                <span>Academic Session 2026–2027</span>
                <span className="text-slate-400">·</span>
                <span>Open Public Schedule Access</span>
              </div>
            </div>

            {/* Quick Action Staff Login Buttons */}
            <div className="flex flex-col sm:flex-row md:flex-col gap-2.5 shrink-0">
              <button
                onClick={() => onSelectRole('faculty', 'login')}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-navy-900 text-xs sm:text-sm font-bold shadow-sm hover:bg-slate-100 transition-all active:scale-95 cursor-pointer"
              >
                <BookOpenCheck className="w-4 h-4 text-navy-800" />
                <span>Faculty Portal</span>
              </button>
              <button
                onClick={() => onSelectRole('admin', 'login')}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-400 text-navy-950 text-xs sm:text-sm font-black shadow-sm hover:bg-amber-300 transition-all active:scale-95 cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Admin Portal</span>
              </button>
            </div>
          </div>
        </div>

        {/* Public Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-slate-200 gap-4 overflow-x-auto">
          <div className="flex gap-2 sm:gap-4">
            <button
              onClick={() => setActiveTab('timetable')}
              className={`pb-3 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all border-b-2 whitespace-nowrap cursor-pointer ${
                activeTab === 'timetable'
                  ? 'border-navy-900 text-navy-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Academic Timetables (Years 1–4)</span>
            </button>

            <button
              onClick={() => setActiveTab('availability')}
              className={`pb-3 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all border-b-2 whitespace-nowrap cursor-pointer ${
                activeTab === 'availability'
                  ? 'border-navy-900 text-navy-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>Faculty Availability Matrix</span>
            </button>
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 pb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Real-time Schedule Synchronized</span>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="transition-all duration-200">
          {activeTab === 'timetable' ? (
            <TimetableGrid user={null} initialYear={1} />
          ) : (
            <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-academic">
              <FacultyAvailabilityView user={null} />
            </div>
          )}
        </div>

      </div>

      {/* College Footer */}
      <footer className="mt-12 border-t border-slate-200/80 bg-white/90 backdrop-blur-sm py-6 text-center text-xs sm:text-sm text-slate-600">
        <div className="max-w-7xl mx-auto px-4 space-y-2">
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-semibold text-slate-700">
            <span>Rajeev Gandhi Memorial College of Engineering and Technology (Autonomous)</span>
            <span>·</span>
            <span>Nandyal - 518501, Andhra Pradesh</span>
            <span>·</span>
            <button
              onClick={() => onSelectRole('faculty', 'login')}
              className="text-navy-900 hover:underline font-bold"
            >
              Faculty Portal
            </button>
            <span>·</span>
            <button
              onClick={() => onSelectRole('admin', 'login')}
              className="text-navy-900 hover:underline font-bold"
            >
              Admin Portal
            </button>
          </div>
          <p className="text-[11px] text-slate-500 font-medium">
            Academic Schedule Management System · Department of Computer Science & Engineering and AIML
          </p>
        </div>
      </footer>
    </div>
  );
}
