import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { Video, ArrowRight, Sparkles, Lock, Mail } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login, loginDemoUser } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);

    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      setErrorMsg(err.message || 'Login failed. Please check credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setIsLoading(true);
    try {
      await loginDemoUser();
      navigate('/dashboard');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initialize demo account');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-900 flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[400px] bg-brand-600/15 rounded-full blur-[120px] pointer-events-none" />

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
        <p className="text-sm text-slate-400">Sign in to your AI video creation studio</p>
      </div>

      {/* Login Card */}
      <div className="w-full max-w-md p-8 rounded-3xl bg-dark-850/90 border border-white/[0.1] shadow-2xl backdrop-blur-xl relative z-10">
        {errorMsg && (
          <div className="mb-6 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        {/* Demo Quick-login Button */}
        <button
          type="button"
          onClick={handleDemoLogin}
          className="w-full mb-6 py-2.5 px-4 rounded-xl bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/30 text-brand-300 text-xs font-bold transition-all flex items-center justify-center gap-2"
        >
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>Quick Login as Demo Creator (50 Credits)</span>
        </button>

        <div className="relative flex items-center justify-center mb-6">
          <div className="border-t border-white/[0.08] w-full" />
          <span className="bg-dark-850 px-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            or with email
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <input
                type="email"
                placeholder="creator@yourbrand.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 pl-10 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500"
                required
              />
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Password
              </label>
              <a href="#forgot" className="text-xs text-brand-400 hover:text-brand-300">
                Forgot?
              </a>
            </div>
            <div className="relative">
              <input
                type="password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 pl-10 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500"
                required
              />
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-4 py-3 rounded-xl bg-gradient-to-r from-brand-600 to-pink-600 hover:from-brand-500 hover:to-pink-500 text-white font-bold text-sm shadow-lg shadow-brand-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? <span>Signing in...</span> : <span>Sign In to Dashboard</span>}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <p className="text-center text-xs text-slate-400 mt-6">
          Don't have an account?{' '}
          <Link to="/register" className="text-brand-400 font-bold hover:underline">
            Register for Free
          </Link>
        </p>
      </div>
    </div>
  );
};

