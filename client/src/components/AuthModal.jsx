import React, { useState, useEffect } from 'react';
import { 
  X, 
  GraduationCap, 
  BookOpenCheck, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  Lock, 
  User, 
  Phone, 
  Hash, 
  Eye, 
  EyeOff,
  ArrowLeft,
  ShieldAlert,
  Key,
  MessageSquare,
  RefreshCw
} from 'lucide-react';
import { authApi } from '../api';

export default function AuthModal({ 
  isOpen, 
  onClose, 
  initialMode = 'login', // 'login' | 'register' | 'forgot-password'
  initialRole = 'student', // 'student' | 'faculty' | 'admin'
  onAuthSuccess 
}) {
  const [mode, setMode] = useState(initialMode);
  const [role, setRole] = useState(initialRole);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Forgot Password State (Faculty & Admin)
  const [forgotStep, setForgotStep] = useState(1); // 1: Phone, 2: OTP, 3: New Password, 4: Success
  const [forgotPhone, setForgotPhone] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotResetToken, setForgotResetToken] = useState('');
  const [debugOtp, setDebugOtp] = useState('');
  const [resendTimer, setResendTimer] = useState(0);
  const [showForgotPw, setShowForgotPw] = useState(false);

  // Sync role and mode whenever modal opens or props change
  useEffect(() => {
    if (isOpen) {
      if (initialRole) setRole(initialRole);
      if (initialMode) setMode(initialMode);
      setError('');
      setSuccessMsg('');
      setForgotStep(1);
      setForgotPhone('');
      setForgotOtp('');
      setForgotNewPassword('');
      setForgotConfirmPassword('');
      setDebugOtp('');
    }
  }, [isOpen, initialRole, initialMode]);

  // Resend Timer Countdown
  useEffect(() => {
    let timer;
    if (resendTimer > 0) {
      timer = setInterval(() => {
        setResendTimer(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resendTimer]);

  // Form Fields
  const [formData, setFormData] = useState({
    name: '',
    register_id: '',
    password: '',
    phone: '',
    year: '3' // 1, 2, 3, 4
  });

  if (!isOpen) return null;

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (error) setError('');
  };



  const handleRequestOtp = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      const res = await authApi.requestOtp(forgotPhone, role);
      setSuccessMsg(res.message);
      if (res.debug_otp) {
        setDebugOtp(res.debug_otp);
      }
      setForgotStep(2);
      setResendTimer(60);
    } catch (err) {
      setError(err.message || 'Failed to send OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      const res = await authApi.verifyOtp(forgotPhone, forgotOtp, role);
      setForgotResetToken(res.reset_token);
      setForgotStep(3);
    } catch (err) {
      setError(err.message || 'Invalid or expired OTP code.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (forgotNewPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      const res = await authApi.resetPasswordWithOtp(forgotResetToken, forgotNewPassword, forgotConfirmPassword);
      if (res.register_id) {
        setFormData(prev => ({ ...prev, register_id: res.register_id, password: '' }));
      }
      setForgotStep(4);
    } catch (err) {
      setError(err.message || 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const res = await authApi.login(formData.register_id, formData.password, role);
        onAuthSuccess(res.token, res.user);
        onClose();
      } else {
        // Registration
        if (!formData.name.trim()) throw new Error('Please enter your full name.');
        if (!formData.register_id.trim()) throw new Error('Please enter your Register ID or Employee ID.');
        if (formData.password.length < 6) throw new Error('Password must be at least 6 characters.');
        
        const payload = {
          name: formData.name.trim(),
          register_id: formData.register_id.trim().toUpperCase(),
          password: formData.password,
          role: role,
          phone: formData.phone.trim(),
          year: role === 'student' ? parseInt(formData.year, 10) : null
        };

        const res = await authApi.register(payload);
        setSuccessMsg('Registration successful! Logging you in...');
        setTimeout(() => {
          onAuthSuccess(res.token, res.user);
          onClose();
        }, 1000);
      }
    } catch (err) {
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const roleTitle = role === 'admin' 
    ? 'Administrator' 
    : role === 'faculty' 
      ? 'Faculty' 
      : 'Student';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/60 backdrop-blur-xs animate-fade-in">
      <div 
        className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden relative animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Ribbon */}
        <div className="bg-navy-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-navy-800 border border-navy-700 flex items-center justify-center font-bold text-amber-300 text-xs">
              RGM
            </div>
            <div>
              <h3 className="font-bold text-base leading-tight">
                {mode === 'forgot-password' 
                  ? `${roleTitle} Password Recovery` 
                  : `${roleTitle} ${mode === 'login' ? 'Portal Login' : 'Registration'}`}
              </h3>
              <p className="text-xs text-slate-300">
                Department of Artificial Intelligence & Machine Learning
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-navy-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher or Back button */}
        {mode === 'forgot-password' ? (
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-2 text-xs">
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); setSuccessMsg(''); setForgotStep(1); }}
              className="inline-flex items-center gap-1.5 font-bold text-navy-900 hover:text-navy-700 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Sign In</span>
            </button>
            <span className="font-semibold text-slate-500 text-[11px]">
              Step {forgotStep} of 3
            </span>
          </div>
        ) : role !== 'admin' ? (
          <div className="flex border-b border-slate-200 bg-slate-50/70 p-1.5 gap-1.5">
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                mode === 'login'
                  ? 'bg-white text-navy-900 shadow-xs border border-slate-200/80'
                  : 'text-slate-600 hover:text-navy-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError(''); }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                mode === 'register'
                  ? 'bg-white text-navy-900 shadow-xs border border-slate-200/80'
                  : 'text-slate-600 hover:text-navy-900'
              }`}
            >
              Create Account
            </button>
          </div>
        ) : (
          <div className="bg-amber-50/70 border-b border-amber-200/80 px-4 py-2 text-[11px] text-amber-900 font-semibold flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
            <span>Multiple admin accounts supported with dedicated credentials.</span>
          </div>
        )}

        {/* Preserved Role Indicator: NO duplicate role selection */}
        <div className="px-6 pt-4 pb-1">
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200/90 px-3.5 py-2.5 rounded-xl">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-navy-100 text-navy-900 border border-navy-200 flex items-center justify-center font-bold">
                {role === 'admin' ? (
                  <ShieldCheck className="w-4 h-4 text-navy-900" />
                ) : role === 'faculty' ? (
                  <BookOpenCheck className="w-4 h-4 text-navy-900" />
                ) : (
                  <GraduationCap className="w-4 h-4 text-navy-900" />
                )}
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block leading-none">
                  Selected Role
                </span>
                <span className="text-xs font-black text-navy-900 capitalize leading-tight">
                  {role === 'admin' ? 'Administrator' : role === 'faculty' ? 'Faculty Member' : 'Student'}
                </span>
              </div>
            </div>
            <span className="text-[10px] font-bold text-navy-900 bg-white border border-slate-200 px-2.5 py-1 rounded-lg shadow-2xs">
              {mode === 'forgot-password' ? 'Password Recovery' : mode === 'login' ? 'Sign In' : 'Register'}
            </span>
          </div>
        </div>

        {/* FORGOT PASSWORD WORKFLOW */}
        {mode === 'forgot-password' ? (
          <div className="p-6 pt-3 space-y-4">
            {/* Error & Success Messages */}
            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && forgotStep !== 4 && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Step 1: Mobile Phone Number */}
            {forgotStep === 1 && (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                <div>
                  <h4 className="text-sm font-bold text-navy-900 mb-1">
                    Mobile OTP Verification
                  </h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Enter the registered mobile phone number associated with your {roleTitle} profile to receive a 6-digit authentication code.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Registered Mobile Number
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="tel"
                      required
                      placeholder="e.g. 9848011220"
                      value={forgotPhone}
                      onChange={(e) => { setForgotPhone(e.target.value); if (error) setError(''); }}
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900 focus:ring-1 focus:ring-navy-900 bg-slate-50/50"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !forgotPhone.trim()}
                  className="w-full py-2.5 px-4 rounded-xl bg-navy-900 hover:bg-navy-800 active:scale-[0.98] text-white font-bold text-sm transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <MessageSquare className="w-4 h-4 text-amber-300" />
                  )}
                  <span>{loading ? 'Sending Code...' : 'Send Verification OTP'}</span>
                </button>

                <div className="pt-2">
                  <p className="text-[11px] text-slate-500 text-center">
                    Quick-fill registered test mobile numbers:
                  </p>
                  <div className="flex flex-wrap gap-1.5 justify-center mt-1.5">
                    <button
                      type="button"
                      onClick={() => { setForgotPhone('9848011220'); setError(''); }}
                      className="text-[10px] font-bold px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-700 transition-colors"
                    >
                      Admin 1 (9848011220)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setForgotPhone('9848011221'); setError(''); }}
                      className="text-[10px] font-bold px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-700 transition-colors"
                    >
                      Admin 2 (9848011221)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setForgotPhone('9848022331'); setError(''); }}
                      className="text-[10px] font-bold px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-700 transition-colors"
                    >
                      Faculty (9848022331)
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Step 2: Verify OTP */}
            {forgotStep === 2 && (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <h4 className="text-sm font-bold text-navy-900 mb-1">
                    Enter Verification Code
                  </h4>
                  <p className="text-xs text-slate-500">
                    A 6-digit verification code was dispatched for mobile <span className="font-bold text-slate-800">***{forgotPhone.slice(-4)}</span>.
                  </p>
                </div>

                {debugOtp && (
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between text-xs text-amber-900">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Key className="w-3.5 h-3.5 text-amber-700" />
                      <span>Simulated OTP: <strong className="font-mono font-bold tracking-wider">{debugOtp}</strong></span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForgotOtp(debugOtp)}
                      className="px-2 py-0.5 rounded bg-amber-200 hover:bg-amber-300 font-bold text-[10px] text-amber-900 transition-colors"
                    >
                      Auto-fill
                    </button>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    6-Digit Security OTP
                  </label>
                  <div className="relative">
                    <Key className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      maxLength={6}
                      required
                      placeholder="••••••"
                      value={forgotOtp}
                      onChange={(e) => { setForgotOtp(e.target.value.replace(/\D/g, '')); if (error) setError(''); }}
                      className="w-full pl-9 pr-3 py-2 text-lg font-mono tracking-widest text-center font-black rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900 focus:ring-1 focus:ring-navy-900 bg-slate-50/50"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => setForgotStep(1)}
                    className="text-slate-500 hover:text-navy-900 font-medium"
                  >
                    Change Number
                  </button>
                  <button
                    type="button"
                    disabled={resendTimer > 0 || loading}
                    onClick={handleRequestOtp}
                    className={`font-bold ${
                      resendTimer > 0 ? 'text-slate-400 cursor-not-allowed' : 'text-navy-900 hover:underline'
                    }`}
                  >
                    {resendTimer > 0 ? `Resend code in ${resendTimer}s` : 'Resend Code'}
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading || forgotOtp.length !== 6}
                  className="w-full py-2.5 px-4 rounded-xl bg-navy-900 hover:bg-navy-800 active:scale-[0.98] text-white font-bold text-sm transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  )}
                  <span>{loading ? 'Verifying Code...' : 'Verify Code & Continue'}</span>
                </button>
              </form>
            )}

            {/* Step 3: Create New Password */}
            {forgotStep === 3 && (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <h4 className="text-sm font-bold text-navy-900 mb-1">
                    Set New Password
                  </h4>
                  <p className="text-xs text-slate-500">
                    Create a secure password with at least 6 characters.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    New Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type={showForgotPw ? 'text' : 'password'}
                      required
                      placeholder="Enter new password"
                      value={forgotNewPassword}
                      onChange={(e) => setForgotNewPassword(e.target.value)}
                      className="w-full pl-9 pr-10 py-2 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900 focus:ring-1 focus:ring-navy-900 bg-slate-50/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowForgotPw(!showForgotPw)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showForgotPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type={showForgotPw ? 'text' : 'password'}
                      required
                      placeholder="Confirm new password"
                      value={forgotConfirmPassword}
                      onChange={(e) => setForgotConfirmPassword(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900 focus:ring-1 focus:ring-navy-900 bg-slate-50/50"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !forgotNewPassword || !forgotConfirmPassword}
                  className="w-full py-2.5 px-4 rounded-xl bg-navy-900 hover:bg-navy-800 active:scale-[0.98] text-white font-bold text-sm transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-amber-300" />
                  )}
                  <span>{loading ? 'Updating Password...' : 'Save & Update Password'}</span>
                </button>
              </form>
            )}

            {/* Step 4: Success Message */}
            {forgotStep === 4 && (
              <div className="text-center py-4 space-y-4">
                <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-xs">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-navy-900">
                    Password Reset Complete!
                  </h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                    Your password has been securely updated and encrypted. You can now sign in with your updated credentials.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setForgotStep(1);
                    setError('');
                    setSuccessMsg('Password reset successful. Please sign in.');
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-navy-900 hover:bg-navy-800 text-white font-bold text-sm transition-all shadow-md"
                >
                  Sign In Now
                </button>
              </div>
            )}

          </div>
        ) : (
          /* LOGIN & REGISTRATION FORM */
          <form onSubmit={handleSubmit} className="p-6 pt-3 space-y-4">
            
            {/* Error & Success Messages */}
            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Registration Extra Fields */}
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Full Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    placeholder={role === 'student' ? 'e.g. Ramesh Kumar' : 'e.g. Dr. K. Ramesh'}
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900 focus:ring-1 focus:ring-navy-900 bg-slate-50/50"
                  />
                </div>
              </div>
            )}

            {/* Register ID / Employee ID */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700">
                  {role === 'student' ? 'Student Register ID' : role === 'faculty' ? 'Faculty Employee ID' : 'Admin Username / ID'}
                </label>
                {mode === 'register' && (
                  <span className="text-[10px] text-slate-400">Must be unique</span>
                )}
              </div>
              <div className="relative">
                <Hash className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  placeholder={
                    role === 'student' ? 'Enter Student Register ID' : 
                    role === 'faculty' ? 'Enter Faculty Employee ID' : 'Enter Admin Username / ID'
                  }
                  value={formData.register_id}
                  onChange={(e) => handleInputChange('register_id', e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900 focus:ring-1 focus:ring-navy-900 bg-slate-50/50 font-mono"
                />
              </div>
            </div>

            {/* Student Year Selector (Only for student registration) */}
            {mode === 'register' && role === 'student' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Academic Year (AIML)
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map(yr => (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => handleInputChange('year', yr.toString())}
                      className={`py-1.5 rounded-lg text-xs font-bold border transition-all ${
                        formData.year === yr.toString()
                          ? 'bg-navy-900 text-white border-navy-900'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {yr}{yr === 1 ? 'st' : yr === 2 ? 'nd' : yr === 3 ? 'rd' : 'th'} Yr
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Phone Number (Registration) */}
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Phone Number
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="tel"
                    placeholder="e.g. 9848012345"
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900 focus:ring-1 focus:ring-navy-900 bg-slate-50/50"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1 font-medium">
                  🔒 Privacy Rule: Phone numbers are visible only to faculty and admin.
                </p>
              </div>
            )}

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700">
                  Password
                </label>
                {(role === 'faculty' || role === 'admin') && mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot-password');
                      setForgotStep(1);
                      setError('');
                      setSuccessMsg('');
                    }}
                    className="text-[11px] font-semibold text-navy-800 hover:text-navy-950 hover:underline"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Enter your password"
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  className="w-full pl-9 pr-10 py-2 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:border-navy-900 focus:ring-1 focus:ring-navy-900 bg-slate-50/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Student Password Assistance Notice */}
              {mode === 'login' && role === 'student' && (
                <div className="mt-2 p-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-500 flex items-start gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                  <span>
                    Forgot your password? For security, students must contact an AIML Faculty member or Department Administrator to reset their credentials.
                  </span>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl bg-navy-900 hover:bg-navy-800 active:scale-[0.98] text-white font-bold text-sm transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <span>Processing...</span>
              ) : mode === 'login' ? (
                <span>Sign In as {roleTitle}</span>
              ) : (
                <span>Complete {roleTitle} Registration</span>
              )}
            </button>



          </form>
        )}
      </div>
    </div>
  );
}
