import React from 'react';
import { 
  GraduationCap, 
  Calendar, 
  Users, 
  ShieldCheck, 
  LogOut, 
  Sparkles,
  BookOpenCheck
} from 'lucide-react';
import NotificationBox from './NotificationBox';

export default function Header({ 
  user, 
  onLogout, 
  onOpenAuth, 
  currentTab, 
  setCurrentTab 
}) {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          
          {/* Brand & College Details */}
          <div 
            onClick={() => user ? setCurrentTab('dashboard') : null}
            className="flex items-center gap-3.5 cursor-pointer group select-none"
          >
            {/* Official RGMCET Emblem Logo */}
            <img 
              src="/rgmcet_logo.png" 
              alt="RGMCET Official Logo" 
              className="h-14 w-auto object-contain shrink-0"
            />

            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl sm:text-2xl font-black text-navy-900 tracking-tight">
                  RGMCET
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-navy-50 text-navy-800 border border-navy-200">
                  AIML Dept
                </span>
              </div>
              <p className="text-xs sm:text-sm font-semibold text-slate-600 tracking-wide">
                Academic Schedule Management
              </p>
            </div>
          </div>

          {/* Navigation Links & User Actions */}
          <div className="flex items-center gap-2 sm:gap-4">
            {!user ? (
              // Unauthenticated Navigation: Student and Faculty registration links
              <div className="flex items-center gap-2 sm:gap-4">
                <button
                  onClick={() => onOpenAuth('register', 'student')}
                  className="text-xs sm:text-sm font-semibold text-slate-700 hover:text-navy-900 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-slate-100"
                >
                  Student registration
                </button>
                <button
                  onClick={() => onOpenAuth('register', 'faculty')}
                  className="text-xs sm:text-sm font-semibold text-slate-700 hover:text-navy-900 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-slate-100"
                >
                  Faculty registration
                </button>
              </div>
            ) : (
              // Authenticated Navigation & Status
              <div className="flex items-center gap-2 sm:gap-3">
                {/* Navigation pills: Only for student and admin, faculty has self-contained workspace */}
                {user.role !== 'faculty' && (
                  <nav className="hidden md:flex items-center gap-1 mr-2 bg-slate-100/80 p-1 rounded-xl border border-slate-200">
                    <button
                      onClick={() => setCurrentTab('dashboard')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                        currentTab === 'dashboard'
                          ? 'bg-white text-navy-900 shadow-xs'
                          : 'text-slate-600 hover:text-navy-900'
                      }`}
                    >
                      Dashboard
                    </button>
                    {user.role === 'admin' && (
                      <button
                        onClick={() => setCurrentTab('directory')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                          currentTab === 'directory'
                            ? 'bg-white text-navy-900 shadow-xs'
                            : 'text-slate-600 hover:text-navy-900'
                        }`}
                      >
                        Directory
                      </button>
                    )}
                  </nav>
                )}

                {/* User Pill Badge */}
                <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-navy-100 border border-navy-300 text-navy-900 flex items-center justify-center font-bold text-xs">
                    {user.role === 'admin' ? (
                      <ShieldCheck className="w-4 h-4 text-navy-900" />
                    ) : user.role === 'faculty' ? (
                      <BookOpenCheck className="w-4 h-4 text-navy-900" />
                    ) : (
                      <GraduationCap className="w-4 h-4 text-navy-900" />
                    )}
                  </div>
                  <div className="text-left leading-tight hidden sm:block">
                    <div className="text-xs font-bold text-slate-800 truncate max-w-[130px]">
                      {user.name}
                    </div>
                    <div className="text-[10px] font-medium text-navy-700 capitalize flex items-center gap-1">
                      <span>{user.role}</span>
                      {user.role === 'student' && user.year && (
                        <span>• Year {user.year}</span>
                      )}
                      <span>({user.register_id})</span>
                    </div>
                  </div>
                </div>

                {/* Global Notification Box: Faculty Leave Intimations */}
                <NotificationBox user={user} />

                {/* Logout Button */}
                <button
                  onClick={onLogout}
                  title="Log out of system"
                  className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-200 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </header>
  );
}
