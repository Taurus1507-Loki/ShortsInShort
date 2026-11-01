import React, { useState } from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { Sidebar } from './Sidebar.js';
import {
  Zap,
  Bell,
  Search,
  LogOut,
  X,
  UploadCloud,
  FileText,
  UserCheck,
  Video,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { formatCredits } from '../utils/cn.js';
import { api } from '../services/api.js';
import { CreationMode, AspectRatio, Resolution } from '../types/index.js';

export const AppLayout: React.FC = () => {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [creationMode, setCreationMode] = useState<CreationMode>('ai_editor');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [resolution, setResolution] = useState<Resolution>('1080p');
  const [script, setScript] = useState('');
  const [rawVideoUrl, setRawVideoUrl] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectTitle.trim()) {
      setErrorMsg('Please specify a title for your project');
      return;
    }

    try {
      setIsCreating(true);
      setErrorMsg('');

      const newProj = await api.post<any>('/projects', {
        title: projectTitle,
        creationMode,
        aspectRatio,
        resolution,
        script: script || undefined,
        rawVideoUrl: rawVideoUrl || undefined,
      });

      await refreshUser();
      setIsModalOpen(false);
      setProjectTitle('');
      setScript('');
      setRawVideoUrl('');

      // Redirect directly to the interactive Video Studio
      navigate(`/projects/${newProj._id}/editor`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create video project');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-dark-900 text-slate-100">
      {/* App Sidebar */}
      <Sidebar onNewProjectClick={() => setIsModalOpen(true)} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="h-16 bg-dark-850/80 backdrop-blur-xl border-b border-white/[0.08] px-8 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-slate-300">
              Workspace / <span className="text-white font-bold">{user?.fullName}'s Team</span>
            </h2>
          </div>

          <div className="flex items-center gap-4">
            {/* Quick Credit Top-up */}
            <Link
              to="/billing"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 text-xs font-semibold hover:bg-brand-500/20 transition-all"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              <span>{user ? formatCredits(user.creditBalance) : 0} Credits</span>
              <span className="text-[10px] text-brand-400/80 underline ml-1">Top-Up</span>
            </Link>

            {/* Notification placeholder */}
            <button className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.05] transition-colors relative">
              <Bell className="w-4 h-4" />
              <span className="w-2 h-2 rounded-full bg-brand-500 absolute top-1.5 right-1.5" />
            </button>

            {/* User Profile Pill */}
            <div className="flex items-center gap-3 pl-2 border-l border-white/[0.08]">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-brand-600 to-pink-500 flex items-center justify-center font-bold text-xs text-white uppercase shadow-md shadow-brand-500/20">
                {user?.fullName?.charAt(0) || 'U'}
              </div>
              <div className="hidden sm:flex flex-col text-left">
                <span className="text-xs font-bold text-white">{user?.fullName}</span>
                <span className="text-[10px] text-slate-400 capitalize">{user?.planTier} Tier</span>
              </div>
              <button
                onClick={logout}
                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors ml-2"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Page View Container */}
        <main className="flex-1 p-8 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {/* New Project Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-dark-850 border border-white/[0.1] rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-brand-500/20 border border-brand-500/30 flex items-center justify-center text-brand-400">
                  <Sparkles className="w-4 h-4" />
                </div>
                <h3 className="text-lg font-bold text-white">Create New AI Video Project</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/[0.05]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreateProject} className="p-6 space-y-5">
              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-medium">
                  {errorMsg}
                </div>
              )}

              {/* Title input */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Project Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. 5 Growth Hacks for B2B SaaS (Instagram Reel)"
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-dark-900 border border-white/[0.1] text-white placeholder-slate-500 text-sm focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  required
                />
              </div>

              {/* Video Creation Mode Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Select Creation Mode
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Mode 1: AI Video Editor */}
                  <div
                    onClick={() => setCreationMode('ai_editor')}
                    className={`cursor-pointer p-3.5 rounded-xl border transition-all text-left ${
                      creationMode === 'ai_editor'
                        ? 'bg-brand-500/15 border-brand-500 shadow-md shadow-brand-500/20'
                        : 'bg-dark-900 border-white/[0.08] hover:border-white/[0.2]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Video className="w-5 h-5 text-brand-400" />
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300">
                        1 Credit
                      </span>
                    </div>
                    <div className="text-sm font-bold text-white">AI Video Editor</div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                      Upload raw footage. Auto-trim silences, add captions, B-roll & zooms.
                    </p>
                  </div>

                  {/* Mode 2: AI Avatar */}
                  <div
                    onClick={() => setCreationMode('ai_avatar')}
                    className={`cursor-pointer p-3.5 rounded-xl border transition-all text-left ${
                      creationMode === 'ai_avatar'
                        ? 'bg-brand-500/15 border-brand-500 shadow-md shadow-brand-500/20'
                        : 'bg-dark-900 border-white/[0.08] hover:border-white/[0.2]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <UserCheck className="w-5 h-5 text-pink-400" />
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300">
                        3 Credits
                      </span>
                    </div>
                    <div className="text-sm font-bold text-white">AI Digital Avatar</div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                      Authorized digital twin speaking your script with natural lip-sync.
                    </p>
                  </div>

                  {/* Mode 3: Faceless */}
                  <div
                    onClick={() => setCreationMode('faceless')}
                    className={`cursor-pointer p-3.5 rounded-xl border transition-all text-left ${
                      creationMode === 'faceless'
                        ? 'bg-brand-500/15 border-brand-500 shadow-md shadow-brand-500/20'
                        : 'bg-dark-900 border-white/[0.08] hover:border-white/[0.2]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <FileText className="w-5 h-5 text-amber-400" />
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                        2 Credits
                      </span>
                    </div>
                    <div className="text-sm font-bold text-white">Faceless Shorts</div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                      Topic or script to full video with AI voice narration & synced B-roll.
                    </p>
                  </div>
                </div>
              </div>

              {/* Aspect Ratio & Resolution */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Target Format
                  </label>
                  <select
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                    className="w-full px-4 py-2.5 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-sm focus:outline-none focus:border-brand-500"
                  >
                    <option value="9:16">9:16 (Instagram Reels, Shorts, TikTok)</option>
                    <option value="16:9">16:9 (YouTube Landscape)</option>
                    <option value="1:1">1:1 (Instagram Square & Feed)</option>
                    <option value="4:5">4:5 (Facebook & Portrait Feed)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Export Quality
                  </label>
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value as Resolution)}
                    className="w-full px-4 py-2.5 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-sm focus:outline-none focus:border-brand-500"
                  >
                    <option value="1080p">1080p Full HD (Recommended)</option>
                    <option value="720p">720p Fast Render</option>
                    <option value="4k">4K Ultra HD (Pro / Agency Tier)</option>
                  </select>
                </div>
              </div>

              {/* Conditional input based on mode */}
              {creationMode === 'ai_editor' ? (
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Raw Video URL or Cloud Presigned Link
                  </label>
                  <div className="relative">
                    <input
                      type="url"
                      placeholder="https://assets.shortsinshort.com/raw/sample-podcast.mp4"
                      value={rawVideoUrl}
                      onChange={(e) => setRawVideoUrl(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500"
                    />
                    <UploadCloud className="w-4 h-4 text-slate-400 absolute right-3.5 top-3" />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Or leave empty to upload video files directly in the studio timeline.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Enter Video Script or Topic Outline
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Write or paste your script here. The AI engine will segment scenes, synthesize voice, match B-roll, and animate subtitles."
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500 resize-none"
                  />
                </div>
              )}

              {/* Footer Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-sm font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-6 py-2 rounded-xl bg-gradient-to-r from-brand-600 to-pink-600 hover:from-brand-500 hover:to-pink-500 text-white text-sm font-semibold shadow-lg shadow-brand-600/30 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {isCreating ? (
                    <span>Initializing Engine...</span>
                  ) : (
                    <>
                      <span>Launch Video Studio</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

