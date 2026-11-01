import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { Settings, Key, Shield, User, Save, Check } from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();

  const [openaiKey, setOpenaiKey] = useState('');
  const [elevenlabsKey, setElevenlabsKey] = useState('');
  const [heygenKey, setHeygenKey] = useState('');
  const [pexelsKey, setPexelsKey] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSaveApiKeys = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
          <Settings className="w-6 h-6 text-brand-400" />
          <span>Account & AI Integration Settings</span>
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage your account credentials, security preferences, and custom AI provider API keys.
        </p>
      </div>

      {/* Account Info */}
      <div className="p-6 rounded-2xl bg-dark-850 border border-white/[0.08] space-y-4">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <User className="w-4 h-4 text-brand-400" />
          <span>User Profile</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="text-slate-400 font-semibold block mb-1">Full Name</label>
            <div className="p-3 rounded-xl bg-dark-900 border border-white/[0.08] text-white font-medium">
              {user?.fullName}
            </div>
          </div>

          <div>
            <label className="text-slate-400 font-semibold block mb-1">Email Address</label>
            <div className="p-3 rounded-xl bg-dark-900 border border-white/[0.08] text-white font-medium">
              {user?.email}
            </div>
          </div>

          <div>
            <label className="text-slate-400 font-semibold block mb-1">Assigned Role</label>
            <div className="p-3 rounded-xl bg-dark-900 border border-white/[0.08] text-brand-300 font-bold capitalize">
              {user?.role.replace('_', ' ')}
            </div>
          </div>

          <div>
            <label className="text-slate-400 font-semibold block mb-1">Tenant Workspace ID</label>
            <div className="p-3 rounded-xl bg-dark-900 border border-white/[0.08] text-slate-400 font-mono">
              {user?.workspaceId}
            </div>
          </div>
        </div>
      </div>

      {/* Optional External AI Provider Keys (BYOK - Bring Your Own Key) */}
      <div className="p-6 rounded-2xl bg-dark-850 border border-white/[0.08] space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Key className="w-4 h-4 text-amber-400" />
            <span>Custom AI Provider Keys (BYOK — Optional)</span>
          </h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
            Managed Cloud Available
          </span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          By default, ShortsInShort manages high-speed GPU rendering and AI calls automatically. If your team has enterprise OpenAI, ElevenLabs, or HeyGen accounts, you can supply your custom credentials here to bypass platform credit limits.
        </p>

        <form onSubmit={handleSaveApiKeys} className="space-y-4 pt-2">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              OpenAI API Key (for GPT-4o Script Analysis & Whisper STT)
            </label>
            <input
              type="password"
              placeholder="sk-..."
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-xs font-mono placeholder-slate-600 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              ElevenLabs API Key (for Ultra-realistic AI Voiceover)
            </label>
            <input
              type="password"
              placeholder="xi-..."
              value={elevenlabsKey}
              onChange={(e) => setElevenlabsKey(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-xs font-mono placeholder-slate-600 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              HeyGen / Sync Labs Key (for Digital Avatar Likeness)
            </label>
            <input
              type="password"
              placeholder="hg-..."
              value={heygenKey}
              onChange={(e) => setHeygenKey(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-xs font-mono placeholder-slate-600 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Pexels API Key (for Automated B-roll Video Search)
            </label>
            <input
              type="password"
              placeholder="pexels-..."
              value={pexelsKey}
              onChange={(e) => setPexelsKey(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-xs font-mono placeholder-slate-600 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md shadow-brand-600/30 transition-all flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>Save AI Keys</span>
            </button>
            {savedSuccess && (
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 animate-in fade-in">
                <Check className="w-4 h-4" />
                <span>API Keys Saved!</span>
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

