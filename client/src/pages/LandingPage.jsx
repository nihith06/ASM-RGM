import React from 'react';
import { 
  GraduationCap, 
  BookOpenCheck, 
  ShieldCheck, 
  ArrowRight, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  Sparkles,
  FileSpreadsheet,
  Users
} from 'lucide-react';

export default function LandingPage({ onSelectRole }) {
  return (
    <div className="min-h-[calc(100vh-80px)] flex flex-col justify-between">
      {/* Hero Section */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-16 text-center">
        
        {/* Pill Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-navy-50 border border-navy-200/80 text-navy-900 text-xs sm:text-sm font-bold shadow-2xs mb-6 animate-fade-in">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Monday to Saturday · 7 periods a day</span>
        </div>

        {/* Hero Heading */}
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-navy-900 tracking-tight leading-tight max-w-4xl mx-auto mb-4">
          WELCOME
        </h1>

        {/* Subheading: Full College Name & Dept */}
        <p className="text-lg sm:text-xl font-bold text-slate-800 max-w-3xl mx-auto mb-3">
          Rajeev Gandhi Memorial College of Engineering and Technology (Autonomous)
        </p>
        <p className="text-sm sm:text-base font-semibold text-navy-800 tracking-wide uppercase max-w-2xl mx-auto mb-2">
          Department of Artificial Intelligence & Machine Learning (AIML)
        </p>
        <p className="text-sm sm:text-base font-bold text-navy-950 max-w-2xl mx-auto mb-6">
          HOD - Dr. G. Kishor Kumar
        </p>

        {/* Choose your role section */}
        <div className="mt-8">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="h-px w-12 bg-slate-300"></div>
            <h2 className="text-base sm:text-lg font-bold text-slate-800 tracking-tight uppercase">
              Choose your role to continue
            </h2>
            <div className="h-px w-12 bg-slate-300"></div>
          </div>

          {/* 3 Role Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 max-w-5xl mx-auto text-left">
            
            {/* Student Card */}
            <div 
              onClick={() => onSelectRole('student')}
              className="bg-white rounded-2xl p-7 border border-slate-200/90 shadow-academic hover:shadow-academic-hover hover:border-navy-400 transition-all duration-300 flex flex-col justify-between cursor-pointer group relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-navy-800 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div>
                <div className="w-14 h-14 rounded-xl bg-navy-50 border border-navy-200 text-navy-900 flex items-center justify-center mb-5 group-hover:bg-navy-900 group-hover:text-white transition-colors duration-300">
                  <GraduationCap className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-navy-900 mb-2 group-hover:text-navy-700 transition-colors">
                  Student
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed mb-6">
                  View your year's timetable, inspect all 4 years of AIML schedules, and find available faculty free periods for academic consultations.
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-sm font-bold text-navy-900 group-hover:translate-x-1 transition-transform inline-flex items-center gap-1.5">
                  Student login <ArrowRight className="w-4 h-4 text-navy-700" />
                </span>
                <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                  1st–4th Year
                </span>
              </div>
            </div>

            {/* Faculty Card */}
            <div 
              onClick={() => onSelectRole('faculty')}
              className="bg-white rounded-2xl p-7 border border-slate-200/90 shadow-academic hover:shadow-academic-hover hover:border-navy-400 transition-all duration-300 flex flex-col justify-between cursor-pointer group relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-navy-800 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div>
                <div className="w-14 h-14 rounded-xl bg-navy-50 border border-navy-200 text-navy-900 flex items-center justify-center mb-5 group-hover:bg-navy-900 group-hover:text-white transition-colors duration-300">
                  <BookOpenCheck className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-navy-900 mb-2 group-hover:text-navy-700 transition-colors">
                  Faculty
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed mb-6">
                  Access your teaching schedule across all classes, manage free period availability, and browse the student & faculty directory.
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-sm font-bold text-navy-900 group-hover:translate-x-1 transition-transform inline-flex items-center gap-1.5">
                  Faculty login <ArrowRight className="w-4 h-4 text-navy-700" />
                </span>
                <span className="text-[11px] font-semibold text-navy-800 bg-navy-50 px-2 py-0.5 rounded border border-navy-200">
                  Directory Access
                </span>
              </div>
            </div>

            {/* Admin Card */}
            <div 
              onClick={() => onSelectRole('admin')}
              className="bg-white rounded-2xl p-7 border border-slate-200/90 shadow-academic hover:shadow-academic-hover hover:border-navy-400 transition-all duration-300 flex flex-col justify-between cursor-pointer group relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-navy-800 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div>
                <div className="w-14 h-14 rounded-xl bg-navy-50 border border-navy-200 text-navy-900 flex items-center justify-center mb-5 group-hover:bg-navy-900 group-hover:text-white transition-colors duration-300">
                  <ShieldCheck className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-navy-900 mb-2 group-hover:text-navy-700 transition-colors">
                  Admin
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed mb-6">
                  Manage sections, upload and edit 6-day timetables via grid or CSV, manage user accounts, and oversee departmental scheduling.
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-sm font-bold text-navy-900 group-hover:translate-x-1 transition-transform inline-flex items-center gap-1.5">
                  Admin login <ArrowRight className="w-4 h-4 text-navy-700" />
                </span>
                <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  Full Control
                </span>
              </div>
            </div>

          </div>
        </div>



      </div>

      {/* Footer Line */}
      <footer className="border-t border-slate-200/80 bg-white/85 backdrop-blur-sm py-6 text-center text-xs sm:text-sm text-slate-600">
        <div className="max-w-7xl mx-auto px-4">
          <p className="font-medium text-slate-700">
            New here?{' '}
            <button 
              onClick={() => onSelectRole('student', 'register')}
              className="text-navy-900 font-bold hover:underline"
            >
              Register as a student
            </button>
            {' '}or{' '}
            <button 
              onClick={() => onSelectRole('faculty', 'register')}
              className="text-navy-900 font-bold hover:underline"
            >
              register as faculty
            </button>.
          </p>
          <p className="text-[11px] text-slate-600 mt-2 font-medium">
            Rajeev Gandhi Memorial College of Engineering and Technology (RGMCET) · Department of Artificial Intelligence & Machine Learning
          </p>
        </div>
      </footer>
    </div>
  );
}
