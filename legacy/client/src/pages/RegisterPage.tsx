import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { Video, ArrowRight, Sparkles, Lock, Mail, User as UserIcon, Check } from 'lucide-react';

export const RegisterPage: React.FC = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [termsAgreed, setTermsAgreed] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!termsAgreed) {
      setErrorMsg('Please accept the Terms of Service & Commercial Usage Agreement');
      return;
    }

    setErrorMsg('');
    setIsLoading(true);

    try {
      await register(fullName, email, password);
      navigate('/dashboard');
    } catch (err: any) {
      setErrorMsg(err.message || 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-900 flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[450px] bg-brand-600/15 rounded-full blur-[130px] pointer-events-none" />

      {/* Brand Header */}
      <div className="text-center mb-8 relative z-10">
        <Link to="/" className="inline-flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-pink-500 flex items-center justify-center shadow-lg shadow-brand-500/20">
            <Video className="w-5 h-5 text-white" />
          </div>
          <span className="font-extrabold text-2xl tracking-tight text-white">
            Shorts<span className="text-brand-400">InShort</span>
          </span>
        </Link>
        <p className="text-sm text-slate-400">Claim 50 free credits and start editing with AI</p>
      </div>

      {/* Register Card */}
      <div className="w-full max-w-md p-8 rounded-3xl bg-dark-850/90 border border-white/[0.1] shadow-2xl backdrop-blur-xl relative z-10">
        {errorMsg && (
          <div className="mb-6 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        {/* Free Credits Badge */}
        <div className="mb-6 p-3 rounded-xl bg-brand-500/10 border border-brand-500/30 flex items-center gap-2.5 text-xs text-brand-300 font-semibold">
          <Sparkles className="w-4 h-4 text-amber-400 fill-amber-400 flex-shrink-0" />
          <span>Includes 50 Welcome Video Credits on signup</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
              Full Name
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Rohan Verma"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-4 py-2.5 pl-10 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500"
                required
              />
              <UserIcon className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <input
                type="email"
                placeholder="rohan@creator.in"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 pl-10 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500"
                required
              />
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
              Create Password
            </label>
            <div className="relative">
              <input
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 pl-10 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500"
                required
              />
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            </div>
          </div>

          <div className="flex items-start gap-2 pt-2">
            <input
              type="checkbox"
              id="terms"
              checked={termsAgreed}
              onChange={(e) => setTermsAgreed(e.target.checked)}
              className="mt-0.5 rounded border-slate-700 bg-dark-900 text-brand-500 focus:ring-brand-500"
            />
            <label htmlFor="terms" className="text-xs text-slate-400 leading-snug">
              I agree to the Terms of Service, Acceptable Use, and Ethical AI Likeness & Consent policies.
            </label>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-4 py-3 rounded-xl bg-gradient-to-r from-brand-600 to-pink-600 hover:from-brand-500 hover:to-pink-500 text-white font-bold text-sm shadow-lg shadow-brand-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? <span>Creating Account...</span> : <span>Create Account & Claim Credits</span>}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <p className="text-center text-xs text-slate-400 mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-brand-400 font-bold hover:underline">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
};

