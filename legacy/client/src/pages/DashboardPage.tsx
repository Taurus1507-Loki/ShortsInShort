import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import { Project, CreationMode } from '../types/index.js';
import {
  Video,
  UserCheck,
  FileVideo,
  Sparkles,
  Zap,
  HardDrive,
  Film,
  CheckCircle2,
  Clock,
  AlertCircle,
  Play,
  Trash2,
  Plus,
} from 'lucide-react';
import { formatCredits, formatDuration } from '../utils/cn.js';

export const DashboardPage: React.FC = () => {
  const { user, refreshUser } = useAuth();

  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);
      const [summaryData, projectsData] = await Promise.all([
        api.get<any>('/users/dashboard-summary'),
        api.get<Project[]>('/projects'),
      ]);
      setStats(summaryData.stats);
      setProjects(projectsData);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this project?')) return;
    try {
      await api.delete(`/projects/${id}`);
      setProjects((prev) => prev.filter((p) => p._id !== id));
      await refreshUser();
    } catch (err: any) {
      alert(err.message || 'Failed to delete project');
    }
  };

  const filteredProjects = projects.filter((p) => {
    if (filterStatus === 'all') return true;
    return p.status === filterStatus;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Welcome Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-white/[0.06]">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            Welcome back, {user?.fullName}! 👋
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Produce, render, and manage your viral short-form videos with automated AI editing.
          </p>
        </div>

        {/* Quick Plan Badge */}
        <div className="flex items-center gap-3">
          <div className="px-3.5 py-1.5 rounded-xl bg-brand-500/10 border border-brand-500/30 text-brand-300 text-xs font-semibold flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            <span>{user ? formatCredits(user.creditBalance) : 0} Credits Available</span>
          </div>
          <span className="text-xs uppercase font-extrabold px-3 py-1.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-slate-300">
            {user?.planTier || 'free'} Tier
          </span>
        </div>
      </div>

      {/* Top 4 Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="p-5 rounded-2xl bg-dark-850 border border-white/[0.08] relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Total Videos</span>
            <div className="p-2 rounded-xl bg-brand-500/10 text-brand-400">
              <Film className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white mt-3">
            {stats ? stats.totalVideos : projects.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Generated & in-progress</div>
        </div>

        <div className="p-5 rounded-2xl bg-dark-850 border border-white/[0.08] relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Available Credits</span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <Zap className="w-4 h-4 fill-amber-400" />
            </div>
          </div>
          <div className="text-2xl font-black text-white mt-3">
            {user ? formatCredits(user.creditBalance) : 0}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Never expires during active billing</div>
        </div>

        <div className="p-5 rounded-2xl bg-dark-850 border border-white/[0.08] relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Ready to Publish</span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white mt-3">
            {stats ? stats.completedVideos : projects.filter((p) => p.status === 'ready').length}
          </div>
          <div className="text-[11px] text-emerald-400 mt-1">1080p / 4K MP4 available</div>
        </div>

        <div className="p-5 rounded-2xl bg-dark-850 border border-white/[0.08] relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Cloud Storage</span>
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <HardDrive className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white mt-3">
            {stats ? `${stats.storageUsedMb} MB` : '0 MB'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">R2 presigned media buffer</div>
        </div>
      </div>

      {/* 3 Quick Creation Modules Launchers */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-white uppercase tracking-wider text-xs">
            Start Video Generation
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Module 1: AI Video Editor */}
          <Link
            to="/projects"
            className="p-6 rounded-2xl bg-dark-850 border border-white/[0.08] hover:border-brand-500/50 transition-all group flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 rounded-xl bg-brand-500/15 text-brand-400 group-hover:scale-110 transition-transform">
                  <Video className="w-6 h-6" />
                </div>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-brand-500/20 text-brand-300">
                  1 Credit / Short
                </span>
              </div>
              <h3 className="text-lg font-bold text-white group-hover:text-brand-300 transition-colors">
                AI Video Editor
              </h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Upload raw talking-head footage. Automatically remove awkward silences, generate neon captions, overlay B-roll, and apply auto-ducked music.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center justify-between text-xs font-bold text-brand-400">
              <span>Launch Footage Studio</span>
              <span>&rarr;</span>
            </div>
          </Link>

          {/* Module 2: AI Avatar Studio */}
          <Link
            to="/avatars"
            className="p-6 rounded-2xl bg-dark-850 border border-white/[0.08] hover:border-pink-500/50 transition-all group flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 rounded-xl bg-pink-500/15 text-pink-400 group-hover:scale-110 transition-transform">
                  <UserCheck className="w-6 h-6" />
                </div>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-pink-500/20 text-pink-300">
                  3 Credits / Short
                </span>
              </div>
              <h3 className="text-lg font-bold text-white group-hover:text-pink-300 transition-colors">
                AI Avatar Generator
              </h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Generate professional videos using authorized digital twin avatars. Enter your script and produce natural talking videos in 28+ languages.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center justify-between text-xs font-bold text-pink-400">
              <span>Launch Avatar Studio</span>
              <span>&rarr;</span>
            </div>
          </Link>

          {/* Module 3: Faceless Video Generator */}
          <Link
            to="/faceless"
            className="p-6 rounded-2xl bg-dark-850 border border-white/[0.08] hover:border-amber-500/50 transition-all group flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 rounded-xl bg-amber-500/15 text-amber-400 group-hover:scale-110 transition-transform">
                  <FileVideo className="w-6 h-6" />
                </div>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                  2 Credits / Short
                </span>
              </div>
              <h3 className="text-lg font-bold text-white group-hover:text-amber-300 transition-colors">
                Faceless Video Creator
              </h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Transform any topic, stoic quote, or business lesson into a full video with AI voice narration, synced B-roll scenes, and animated captions.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center justify-between text-xs font-bold text-amber-400">
              <span>Launch Faceless Studio</span>
              <span>&rarr;</span>
            </div>
          </Link>
        </div>
      </div>

      {/* Projects Section */}
      <div className="space-y-4 pt-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">Recent Video Projects</h2>
            <p className="text-xs text-slate-400">Manage and preview your created videos</p>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-dark-850 border border-white/[0.08] text-xs">
            {['all', 'ready', 'rendering', 'draft'].map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`px-3 py-1.5 rounded-lg capitalize font-medium transition-colors ${
                  filterStatus === status
                    ? 'bg-brand-500/20 text-brand-300 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Projects List / Grid */}
        {isLoading ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            Loading projects...
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="p-12 rounded-2xl bg-dark-850 border border-white/[0.08] text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.05] border border-white/[0.1] flex items-center justify-center mx-auto text-slate-400">
              <Film className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">No video projects found</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                You haven't generated any videos yet. Click "Create New Video" to begin your first project!
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredProjects.map((project) => (
              <div
                key={project._id}
                className="rounded-2xl bg-dark-850 border border-white/[0.08] overflow-hidden hover:border-brand-500/40 transition-all group"
              >
                {/* Thumbnail Header */}
                <div className="h-44 bg-dark-900 relative flex items-center justify-center overflow-hidden">
                  {project.thumbnailUrl ? (
                    <img
                      src={project.thumbnailUrl}
                      alt={project.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-tr from-slate-900 via-dark-850 to-slate-900 flex flex-col items-center justify-center p-4 text-center">
                      <Film className="w-8 h-8 text-slate-600 mb-2" />
                      <span className="text-xs text-slate-500 font-medium">{project.aspectRatio} Aspect Ratio</span>
                    </div>
                  )}

                  {/* Badges on Thumbnail */}
                  <div className="absolute top-3 left-3 flex items-center gap-1.5">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-white border border-white/[0.1]">
                      {project.aspectRatio}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-brand-500/80 backdrop-blur-md text-white uppercase">
                      {project.creationMode.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="absolute top-3 right-3">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md capitalize ${
                        project.status === 'ready'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : project.status === 'rendering'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-slate-700/50 text-slate-300'
                      }`}
                    >
                      {project.status}
                    </span>
                  </div>

                  {project.duration > 0 && (
                    <div className="absolute bottom-3 right-3 bg-black/80 px-2 py-0.5 rounded text-[10px] font-mono text-white">
                      {formatDuration(project.duration)}
                    </div>
                  )}
                </div>

                {/* Project Details */}
                <div className="p-4 space-y-3">
                  <Link
                    to={`/projects/${project._id}/editor`}
                    className="font-bold text-white text-sm line-clamp-1 hover:text-brand-300 transition-colors block"
                  >
                    {project.title}
                  </Link>

                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Quality: {project.resolution}</span>
                    <span>Cost: {project.creditsCost} Credits</span>
                  </div>

                  <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => handleDeleteProject(project._id, e)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                        title="Delete project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>

                      <Link
                        to={`/projects/${project._id}/editor`}
                        className="px-3 py-1 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      >
                        <Play className="w-3 h-3 fill-white" />
                        <span>Open Studio</span>
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

