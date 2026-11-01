import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import { Project, IWordTimestamp, IScene, AspectRatio } from '../types/index.js';
import {
  Video,
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Sparkles,
  Zap,
  Scissors,
  Wand2,
  Layers,
  Music,
  Download,
  ArrowLeft,
  Save,
  Check,
  AlertCircle,
  Clock,
  Maximize2,
  Film,
  Plus,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { formatCredits, formatDuration } from '../utils/cn.js';

export const EditorStudioPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'captions' | 'silences' | 'broll' | 'audio'>('captions');

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(30);
  const [volume, setVolume] = useState<number>(80);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Inspector & Editing state
  const [words, setWords] = useState<IWordTimestamp[]>([]);
  const [scenes, setScenes] = useState<IScene[]>([]);
  const [selectedWordIdx, setSelectedWordIdx] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>('');

  // Selected timeline item for keyboard deletion
  const [selectedTrackItem, setSelectedTrackItem] = useState<
    | { type: 'scene'; index: number }
    | { type: 'caption'; index: number }
    | { type: 'broll'; index: number }
    | { type: 'audio' }
    | null
  >(null);

  // Rendering modal & progress
  const [isRenderModalOpen, setIsRenderModalOpen] = useState<boolean>(false);
  const [renderProgress, setRenderProgress] = useState<number>(0);
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [renderError, setRenderError] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Fetch project
  const fetchProject = async () => {
    try {
      setIsLoading(true);
      const data = await api.get<Project>(`/projects/${id}`);
      setProject(data);
      setDuration(data.duration || 30);
      setWords(data.transcription || []);
      setScenes(data.scenes || []);

      if (data.status === 'rendering') {
        setIsRendering(true);
        setIsRenderModalOpen(true);
        setRenderProgress(data.progress || 20);
      }
    } catch (err) {
      console.error('Failed to load project:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchProject();
  }, [id]);

  // Simulated or native playback timer
  useEffect(() => {
    let interval: any;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= duration) {
            setIsPlaying(false);
            return 0;
          }
          return Math.min(duration, prev + 0.1);
        });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, duration]);

  // Poll render status when rendering is active
  useEffect(() => {
    let pollInterval: any;
    if (isRendering && id) {
      pollInterval = setInterval(async () => {
        try {
          const statusData = await api.get<{ status: string; progress: number; outputVideoUrl?: string; renderError?: string }>(
            `/videos/${id}/status`
          );
          setRenderProgress(statusData.progress || 0);

          if (statusData.status === 'ready') {
            setIsRendering(false);
            setRenderProgress(100);
            await fetchProject();
            await refreshUser();
          } else if (statusData.status === 'failed') {
            setIsRendering(false);
            setRenderError(statusData.renderError || 'Rendering failed.');
            await fetchProject();
            await refreshUser();
          }
        } catch {
          // Ignored
        }
      }, 2000);
    }
    return () => clearInterval(pollInterval);
  }, [isRendering, id]);

  // Delete selected item from timeline (scene, caption/word, broll, or audio)
  const deleteSelectedTrackItem = () => {
    if (!selectedTrackItem) return;

    if (selectedTrackItem.type === 'scene') {
      const deletedIdx = selectedTrackItem.index;
      setScenes((prev) =>
        prev.filter((_, i) => i !== deletedIdx).map((s, idx) => ({ ...s, index: idx }))
      );
      setToastMessage(`Deleted Scene ${deletedIdx + 1}`);
    } else if (selectedTrackItem.type === 'caption') {
      const deletedIdx = selectedTrackItem.index;
      const deletedWord = words[deletedIdx]?.word || '';
      setWords((prev) => prev.filter((_, i) => i !== deletedIdx));
      setToastMessage(`Deleted caption word "${deletedWord}"`);
    } else if (selectedTrackItem.type === 'broll') {
      const targetIdx = selectedTrackItem.index;
      setScenes((prev) =>
        prev.map((s, i) => (i === targetIdx ? { ...s, brollMediaUrl: undefined, brollQuery: '' } : s))
      );
      setToastMessage(`Deleted B-roll overlay for Scene ${targetIdx + 1}`);
    } else if (selectedTrackItem.type === 'audio') {
      setIsMuted(true);
      setVolume(0);
      setToastMessage(`Removed / muted background audio track`);
    }

    setSelectedTrackItem(null);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // Keyboard Delete / Backspace listener for multi-track timeline
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in an input or textarea
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (
        targetTag === 'input' ||
        targetTag === 'textarea' ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedTrackItem) {
          e.preventDefault();
          deleteSelectedTrackItem();
        }
      } else if (e.key === 'Escape') {
        setSelectedTrackItem(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTrackItem, words, scenes]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (newTime: number) => {
    const clamped = Math.max(0, Math.min(duration, newTime));
    setCurrentTime(clamped);
    if (videoRef.current) {
      videoRef.current.currentTime = clamped;
    }
  };

  // Run AI Analysis & Transcription
  const handleAnalyze = async () => {
    if (!id) return;
    try {
      setIsAnalyzing(true);
      const updated = await api.post<Project>(`/videos/${id}/analyze`);
      setProject(updated);
      setWords(updated.transcription || []);
      setScenes(updated.scenes || []);
      setDuration(updated.duration || 30);
    } catch (err: any) {
      alert(err.message || 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Save changes to words and scenes
  const handleSaveSubtitles = async () => {
    if (!id) return;
    try {
      setIsSaving(true);
      await api.put(`/videos/${id}/subtitles`, {
        transcription: words,
        scenes,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      alert(err.message || 'Failed to save edits');
    } finally {
      setIsSaving(false);
    }
  };

  // Launch FFmpeg Render
  const handleStartRender = async () => {
    if (!id) return;
    try {
      setRenderError('');
      setIsRendering(true);
      setIsRenderModalOpen(true);
      setRenderProgress(10);
      await api.post(`/videos/${id}/render`);
    } catch (err: any) {
      setIsRendering(false);
      setRenderError(err.message || 'Failed to trigger video rendering');
    }
  };

  // Find currently active word based on currentTime in ms
  const currentTimeMs = currentTime * 1000;
  const activeWord = words.find((w) => currentTimeMs >= w.startMs && currentTimeMs <= w.endMs);
  const activeScene = scenes.find((s) => currentTimeMs >= s.startMs && currentTimeMs <= s.endMs);

  // Toggle word highlight
  const toggleWordHighlight = (index: number) => {
    setWords((prev) =>
      prev.map((w, idx) => (idx === index ? { ...w, highlight: !w.highlight } : w))
    );
  };

  // Update word text
  const updateWordText = (index: number, newText: string) => {
    setWords((prev) =>
      prev.map((w, idx) => (idx === index ? { ...w, word: newText } : w))
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-semibold">Loading Video Studio...</span>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8 text-center text-slate-400">
        <p>Project not found.</p>
        <Link to="/dashboard" className="text-brand-400 font-bold mt-2 inline-block">
          &larr; Back to Dashboard
        </Link>
      </div>
    );
  }

  const isVertical = project.aspectRatio === '9:16';

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 pb-12">
      {/* Top Studio Action Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-white">{project.title}</h1>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                  project.status === 'ready'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : project.status === 'rendering'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-brand-500/10 text-brand-300 border border-brand-500/20'
                }`}
              >
                {project.status}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
              <span className="capitalize">{project.creationMode.replace('_', ' ')}</span>
              <span>•</span>
              <span>{project.aspectRatio}</span>
              <span>•</span>
              <span>{project.resolution}</span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {words.length === 0 ? (
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-pink-600 hover:from-brand-500 text-white font-bold text-xs shadow-md shadow-brand-600/30 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>{isAnalyzing ? 'Transcribing with AI...' : 'Transcribe & Generate Captions'}</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveSubtitles}
                disabled={isSaving}
                className="px-4 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-xs font-semibold transition-all flex items-center gap-1.5"
              >
                {saveSuccess ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Save className="w-3.5 h-3.5" />}
                <span>{saveSuccess ? 'Saved!' : 'Save Draft'}</span>
              </button>

              <button
                onClick={handleStartRender}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 via-pink-600 to-brand-500 hover:from-brand-500 text-white font-bold text-xs shadow-lg shadow-brand-600/30 transition-all flex items-center gap-2"
              >
                <Film className="w-4 h-4" />
                <span>Render & Export MP4</span>
                <span className="text-[10px] bg-black/40 px-1.5 py-0.5 rounded font-mono">
                  {project.creditsCost} Credit
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Studio Grid: Video Player (Left) + Inspector Tabs (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Video Player Canvas */}
        <div className="lg:col-span-7 flex flex-col items-center">
          <div
            className={`rounded-3xl bg-black border-2 border-white/[0.1] relative overflow-hidden shadow-2xl flex flex-col justify-between p-4 ${
              isVertical ? 'w-[320px] h-[568px]' : 'w-full max-w-[640px] h-[360px]'
            }`}
          >
            {/* Background Video Element (if uploaded) or styled preview canvas */}
            {project.outputVideoUrl ? (
              <video
                ref={videoRef}
                src={project.outputVideoUrl}
                className="absolute inset-0 w-full h-full object-cover"
                onTimeUpdate={(e) => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
                onEnded={() => setIsPlaying(false)}
              />
            ) : project.rawVideoUrl ? (
              <video
                ref={videoRef}
                src={project.rawVideoUrl}
                className="absolute inset-0 w-full h-full object-cover"
                onTimeUpdate={(e) => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
                onEnded={() => setIsPlaying(false)}
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-b from-dark-850 via-dark-900 to-black flex items-center justify-center">
                {activeScene?.brollMediaUrl ? (
                  <img
                    src="https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop&q=80"
                    alt="Active B-roll"
                    className="w-full h-full object-cover opacity-60"
                  />
                ) : (
                  <div className="flex flex-col items-center text-center p-6 text-slate-500">
                    <Video className="w-12 h-12 mb-2 text-slate-700" />
                    <span className="text-xs font-bold text-slate-400">Preview Studio Canvas</span>
                    <span className="text-[10px] text-slate-600 mt-1">
                      {isVertical ? '9:16 Vertical Reel' : '16:9 Landscape Video'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Top Reel Overlay Header */}
            <div className="relative z-20 flex items-center justify-between text-white text-xs">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md border border-white/[0.1]">
                {project.aspectRatio}
              </span>
              <span className="text-[10px] font-mono bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-md text-slate-300">
                {formatDuration(currentTime)} / {formatDuration(duration)}
              </span>
            </div>

            {/* Live Subtitle Overlay on Video Canvas (Submagic Karaoke Style) */}
            <div className="relative z-20 text-center my-auto px-4">
              {words.length > 0 ? (
                <div className="inline-block p-3 rounded-2xl bg-black/75 backdrop-blur-md border border-white/[0.1] shadow-2xl max-w-full">
                  <p className="text-base sm:text-lg font-black uppercase tracking-tight leading-snug">
                    {/* Render words near active cursor */}
                    {words
                      .filter((w) => Math.abs(w.startMs - currentTimeMs) < 2500)
                      .slice(0, 5)
                      .map((w, idx) => {
                        const isCurrentlySpeaking =
                          currentTimeMs >= w.startMs && currentTimeMs <= w.endMs;
                        return (
                          <span
                            key={idx}
                            className={`mx-1 transition-all ${
                              isCurrentlySpeaking
                                ? 'text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-200 underline decoration-yellow-400 decoration-2 scale-110 font-black'
                                : w.highlight
                                ? 'text-brand-400 font-extrabold'
                                : 'text-white'
                            }`}
                          >
                            {w.word}
                          </span>
                        );
                      })}
                  </p>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-black/60 backdrop-blur-md text-xs text-slate-400">
                  Click "Transcribe & Generate Captions" to generate animated subtitles
                </div>
              )}
            </div>

            {/* Active Scene & B-Roll Tag */}
            <div className="relative z-20 flex items-center justify-between">
              {activeScene && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 backdrop-blur-md border border-brand-500/30 flex items-center gap-1">
                  <Layers className="w-3 h-3" />
                  <span>B-Roll: {activeScene.brollQuery || 'Visual Cut'}</span>
                </span>
              )}
            </div>
          </div>

          {/* Video Player Transport Controls */}
          <div className="w-full max-w-md mt-4 p-3 rounded-2xl bg-dark-850 border border-white/[0.08] flex items-center justify-between gap-4">
            <button
              onClick={() => handleSeek(currentTime - 5)}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/[0.05]"
              title="Rewind 5s"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-xl bg-brand-600 hover:bg-brand-500 text-white flex items-center justify-center shadow-md shadow-brand-600/30 transition-transform active:scale-95"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-white" />}
            </button>

            <button
              onClick={() => handleSeek(currentTime + 5)}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/[0.05]"
              title="Forward 5s"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <div className="flex-1 flex items-center gap-2">
              <input
                type="range"
                min="0"
                max={duration}
                step="0.1"
                value={currentTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-brand-500"
              />
              <span className="text-[10px] font-mono text-slate-400 w-12 text-right">
                {formatDuration(currentTime)}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Studio Inspector Tabs */}
        <div className="lg:col-span-5 rounded-3xl bg-dark-850 border border-white/[0.08] p-6 space-y-6">
          {/* Tab Selector */}
          <div className="grid grid-cols-4 gap-1 p-1 bg-dark-900 rounded-2xl border border-white/[0.06] text-xs font-semibold">
            <button
              onClick={() => setActiveTab('captions')}
              className={`py-2 rounded-xl transition-colors ${
                activeTab === 'captions'
                  ? 'bg-brand-500/20 text-brand-300 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Captions
            </button>
            <button
              onClick={() => setActiveTab('silences')}
              className={`py-2 rounded-xl transition-colors ${
                activeTab === 'silences'
                  ? 'bg-brand-500/20 text-brand-300 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Silences
            </button>
            <button
              onClick={() => setActiveTab('broll')}
              className={`py-2 rounded-xl transition-colors ${
                activeTab === 'broll'
                  ? 'bg-brand-500/20 text-brand-300 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              B-Roll
            </button>
            <button
              onClick={() => setActiveTab('audio')}
              className={`py-2 rounded-xl transition-colors ${
                activeTab === 'audio'
                  ? 'bg-brand-500/20 text-brand-300 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Audio
            </button>
          </div>

          {/* TAB 1: Captions & Words Inspector */}
          {activeTab === 'captions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">Transcribed Words ({words.length})</h3>
                  <p className="text-[11px] text-slate-400">Click word to edit or zap to highlight</p>
                </div>
                <button
                  onClick={handleSaveSubtitles}
                  className="text-xs text-brand-400 font-semibold hover:text-brand-300 flex items-center gap-1"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Edits</span>
                </button>
              </div>

              {/* Scrollable Word Badges */}
              <div className="max-h-[360px] overflow-y-auto space-y-2 p-1">
                {words.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    No transcription available yet. Click "Transcribe & Generate Captions" above.
                  </div>
                ) : (
                  words.map((w, idx) => {
                    const isSpoken = currentTimeMs >= w.startMs && currentTimeMs <= w.endMs;
                    return (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-xl border flex items-center justify-between transition-all ${
                          isSpoken
                            ? 'bg-brand-500/15 border-brand-500/50'
                            : 'bg-dark-900 border-white/[0.06] hover:border-white/[0.15]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-slate-500 w-10">
                            {(w.startMs / 1000).toFixed(1)}s
                          </span>
                          <input
                            type="text"
                            value={w.word}
                            onChange={(e) => updateWordText(idx, e.target.value)}
                            className="bg-transparent text-sm font-semibold text-white focus:outline-none focus:border-b focus:border-brand-400 w-32"
                          />
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleWordHighlight(idx)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              w.highlight
                                ? 'bg-amber-400/20 text-amber-300'
                                : 'text-slate-500 hover:text-white'
                            }`}
                            title="Toggle Neon Highlight"
                          >
                            <Zap className="w-3.5 h-3.5 fill-current" />
                          </button>
                          <button
                            onClick={() => handleSeek(w.startMs / 1000)}
                            className="p-1.5 text-slate-500 hover:text-white rounded-lg"
                            title="Jump playhead to word"
                          >
                            <Play className="w-3 h-3 fill-current" />
                          </button>
                          <button
                            onClick={() => {
                              const deletedWord = w.word;
                              setWords((prev) => prev.filter((_, i) => i !== idx));
                              setToastMessage(`Deleted caption word "${deletedWord}"`);
                              setTimeout(() => setToastMessage(''), 3000);
                            }}
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                            title="Delete word"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Silences Inspector */}
          {activeTab === 'silences' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white">Automated Silence Trimmer</h3>
                <p className="text-[11px] text-slate-400">
                  Detects pauses longer than 400ms and cuts them out to create high-retention pacing.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-dark-900 border border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-semibold">Silence Detection Sensitivity</span>
                  <span className="font-mono text-brand-400">-30 dB</span>
                </div>
                <input
                  type="range"
                  min="-45"
                  max="-20"
                  defaultValue="-30"
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none accent-brand-500"
                />
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>Aggressive (-20dB)</span>
                  <span>Natural (-35dB)</span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-emerald-300 font-semibold">
                  <Scissors className="w-4 h-4" />
                  <span>Auto Silence Removal Enabled</span>
                </div>
                <span className="text-xs font-bold text-emerald-400">Active</span>
              </div>
            </div>
          )}

          {/* TAB 3: B-Roll Inspector */}
          {activeTab === 'broll' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white">Semantic B-Roll Cutaways</h3>
                <p className="text-[11px] text-slate-400">
                  Auto-matched video clips overlaid during key speaking points.
                </p>
              </div>

              <div className="space-y-2.5 max-h-[360px] overflow-y-auto">
                {scenes.map((scene, idx) => (
                  <div key={idx} className="p-3 rounded-2xl bg-dark-900 border border-white/[0.06] space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-white">Scene {idx + 1}</span>
                      <span className="text-slate-500 font-mono">
                        {(scene.startMs / 1000).toFixed(1)}s - {(scene.endMs / 1000).toFixed(1)}s
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 line-clamp-1 italic">
                      "{scene.scriptChunk}"
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={scene.brollQuery || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setScenes((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, brollQuery: val } : s))
                          );
                        }}
                        placeholder="Search stock query..."
                        className="flex-1 px-3 py-1.5 rounded-lg bg-dark-850 border border-white/[0.1] text-xs text-white focus:outline-none focus:border-brand-500"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: Audio & Ducking Inspector */}
          {activeTab === 'audio' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white">Background Music & Sound Design</h3>
                <p className="text-[11px] text-slate-400">
                  Royalty-free background tracks with automated voice ducking.
                </p>
              </div>

              <div className="space-y-2">
                {[
                  { name: 'Energetic Trap Beat', cat: 'energetic_trap', vibe: 'High BPM / Viral Hooks' },
                  { name: 'Lofi Chill Aesthetic', cat: 'lofi_ambient', vibe: 'Subtle / Podcast / Story' },
                  { name: 'Corporate Tech Innovation', cat: 'corporate_tech', vibe: 'Clean / Business' },
                  { name: 'Epic Cinematic Orchestra', cat: 'epic_orchestral', vibe: 'Dramatic / Stoic' },
                ].map((track) => (
                  <div
                    key={track.cat}
                    className="p-3 rounded-xl bg-dark-900 border border-white/[0.08] flex items-center justify-between hover:border-brand-500/40 cursor-pointer transition-colors"
                  >
                    <div>
                      <div className="text-xs font-bold text-white">{track.name}</div>
                      <div className="text-[10px] text-slate-500">{track.vibe}</div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-brand-500/20 text-brand-300">
                      Selected
                    </span>
                  </div>
                ))}
              </div>

              <div className="p-4 rounded-2xl bg-dark-900 border border-white/[0.08] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-semibold">Voice Auto-Ducking</span>
                  <span className="text-emerald-400 font-bold">-18 dB</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Dynamically drops background music volume whenever voice narration is active.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Multi-Track Timeline */}
      <div className="rounded-3xl bg-dark-850 border border-white/[0.08] p-6 space-y-4">
        {/* Toast Notification Banner */}
        {toastMessage && (
          <div className="p-3 rounded-2xl bg-brand-500/15 border border-brand-500/40 text-brand-300 text-xs font-bold flex items-center justify-between animate-in fade-in slide-in-from-top-2">
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>{toastMessage}</span>
            </span>
            <span className="text-[10px] text-slate-400">Timeline updated</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span>Multi-Track Timeline</span>
            </h3>

            {/* Selected item status badge or hint */}
            {selectedTrackItem ? (
              <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-bold animate-in fade-in">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  Selected:{' '}
                  <span className="uppercase">{selectedTrackItem.type}</span>{' '}
                  {'index' in selectedTrackItem ? `#${selectedTrackItem.index + 1}` : ''}
                </span>
                <button
                  onClick={deleteSelectedTrackItem}
                  className="ml-2 px-2 py-0.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-bold flex items-center gap-1 transition-colors shadow"
                  title="Delete (or press Delete/Backspace key)"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Delete [Del]</span>
                </button>
                <button
                  onClick={() => setSelectedTrackItem(null)}
                  className="text-slate-400 hover:text-white text-xs px-1"
                  title="Deselect (Escape key)"
                >
                  ✕
                </button>
              </div>
            ) : (
              <span className="text-[11px] text-slate-500 hidden sm:inline">
                Click any scene, caption, B-roll, or audio block to select & delete with <strong>[Delete]</strong> key
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {selectedTrackItem && (
              <button
                onClick={deleteSelectedTrackItem}
                className="px-3 py-1 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Selected Item</span>
              </button>
            )}

            <span className="text-xs font-mono text-brand-400 font-bold">
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>
          </div>
        </div>

        {/* Timeline Tracks Box */}
        <div
          onClick={() => setSelectedTrackItem(null)}
          className="p-4 rounded-2xl bg-dark-900 border border-white/[0.06] space-y-3 relative overflow-hidden select-none"
        >
          {/* Draggable Playhead Bar */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-brand-400 z-30 pointer-events-none transition-all shadow-md shadow-brand-400"
            style={{ left: `${Math.min(100, (currentTime / duration) * 100)}%` }}
          >
            <div className="w-2.5 h-2.5 bg-brand-400 -translate-x-1 rounded-full shadow-md" />
          </div>

          {/* Track 1: Video Scene Cuts */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-slate-500 w-16">Video</span>
            <div className="flex-1 h-8 bg-slate-800 rounded-lg flex gap-1 p-0.5 overflow-hidden">
              {scenes.length > 0 ? (
                scenes.map((s, idx) => {
                  const isSelected =
                    selectedTrackItem?.type === 'scene' && selectedTrackItem.index === idx;
                  return (
                    <div
                      key={idx}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTrackItem({ type: 'scene', index: idx });
                        handleSeek(s.startMs / 1000);
                      }}
                      className={`h-full rounded flex items-center justify-between text-[9px] font-bold cursor-pointer transition-all px-2 truncate relative group ${
                        isSelected
                          ? 'bg-amber-500/50 border-2 border-amber-300 text-white ring-2 ring-amber-400 z-20 shadow-lg'
                          : 'bg-brand-600/40 hover:bg-brand-600/70 border border-brand-500/30 text-white'
                      }`}
                      style={{ flex: Math.max(1, (s.endMs - s.startMs) / 1000) }}
                      title={`Scene ${idx + 1} (${(s.startMs / 1000).toFixed(1)}s - ${(s.endMs / 1000).toFixed(1)}s) — Click to select, press Delete to remove`}
                    >
                      <span className="truncate">Scene {idx + 1}</span>
                      {isSelected && (
                        <span className="text-[8px] bg-black/60 px-1 rounded text-amber-300 uppercase ml-1">
                          DEL
                        </span>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="w-full h-full bg-slate-700/40 rounded flex items-center justify-center text-[10px] text-slate-400">
                  Full Video Stream
                </div>
              )}
            </div>
          </div>

          {/* Track 2: Subtitle Words */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-slate-500 w-16">Captions</span>
            <div className="flex-1 h-7 bg-slate-800 rounded-lg flex gap-0.5 p-0.5 overflow-hidden">
              {words.map((w, idx) => {
                const isSelected =
                  selectedTrackItem?.type === 'caption' && selectedTrackItem.index === idx;
                return (
                  <div
                    key={idx}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTrackItem({ type: 'caption', index: idx });
                      handleSeek(w.startMs / 1000);
                    }}
                    className={`h-full rounded text-[8px] font-bold flex items-center justify-center px-1 cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-amber-500/70 border-2 border-amber-300 text-white ring-2 ring-amber-400 z-20 shadow-lg scale-105'
                        : w.highlight
                        ? 'bg-amber-400/30 text-amber-300 border border-amber-400/40 hover:bg-amber-400/50'
                        : 'bg-white/[0.08] hover:bg-white/[0.2] text-slate-300'
                    }`}
                    style={{ flex: Math.max(1, (w.endMs - w.startMs) / 100) }}
                    title={`"${w.word}" (${(w.startMs / 1000).toFixed(1)}s) — Click to select, press Delete to remove`}
                  >
                    <span className="truncate">{w.word}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Track 3: B-Roll Media Overlays */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-slate-500 w-16">B-Roll</span>
            <div className="flex-1 h-7 bg-slate-800 rounded-lg flex gap-1 p-0.5 overflow-hidden">
              {scenes.map((s, idx) => {
                const isSelected =
                  selectedTrackItem?.type === 'broll' && selectedTrackItem.index === idx;
                const hasBroll = !!s.brollQuery || !!s.brollMediaUrl;
                return (
                  <div
                    key={idx}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (hasBroll) {
                        setSelectedTrackItem({ type: 'broll', index: idx });
                        handleSeek(s.startMs / 1000);
                      }
                    }}
                    className={`h-full rounded flex items-center justify-between text-[9px] font-bold truncate px-2 transition-all ${
                      hasBroll
                        ? isSelected
                          ? 'bg-rose-500/60 border-2 border-rose-300 text-white ring-2 ring-rose-400 z-20 shadow-lg'
                          : 'bg-pink-500/20 hover:bg-pink-500/40 border border-pink-500/30 text-pink-300 cursor-pointer'
                        : 'bg-slate-800/40 border border-dashed border-white/[0.06] text-slate-600'
                    }`}
                    style={{ flex: Math.max(1, (s.endMs - s.startMs) / 1000) }}
                    title={
                      hasBroll
                        ? `B-Roll: ${s.brollQuery} — Click to select, press Delete to remove`
                        : 'No B-roll assigned'
                    }
                  >
                    <span className="truncate">{hasBroll ? s.brollQuery || 'B-Roll' : 'None'}</span>
                    {hasBroll && isSelected && (
                      <span className="text-[8px] bg-black/60 px-1 rounded text-rose-300 uppercase ml-1">
                        DEL
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Track 4: Audio Waveform with Ducking */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-slate-500 w-16">Audio</span>
            <div
              onClick={(e) => {
                e.stopPropagation();
                setSelectedTrackItem({ type: 'audio' });
              }}
              className={`flex-1 h-8 rounded-lg flex items-center justify-between px-3 overflow-hidden gap-1 cursor-pointer transition-all ${
                selectedTrackItem?.type === 'audio'
                  ? 'bg-emerald-500/30 border-2 border-emerald-300 ring-2 ring-emerald-400 z-20 shadow-lg'
                  : 'bg-slate-800 hover:bg-slate-750 border border-emerald-500/20'
              }`}
              title="Background Audio Track — Click to select, press Delete to remove/mute"
            >
              <div className="flex items-center gap-2 z-10">
                <Music className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[10px] font-bold text-white">
                  {isMuted ? 'Muted (Audio Removed)' : 'Background Music + Ducking (-18dB)'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {Array.from({ length: 42 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-1 rounded-full transition-all ${
                      isMuted
                        ? 'bg-slate-700 h-1'
                        : 'bg-gradient-to-t from-emerald-500 to-cyan-400'
                    }`}
                    style={{
                      height: isMuted
                        ? '4px'
                        : `${Math.max(15, (Math.sin(i * 0.5) * 0.5 + 0.5) * 85)}%`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Render Progress Modal */}
      {isRenderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-dark-850 border border-white/[0.1] rounded-3xl w-full max-w-lg p-8 shadow-2xl space-y-6 text-center animate-in fade-in zoom-in-95">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-brand-600 to-pink-500 flex items-center justify-center mx-auto text-white shadow-xl shadow-brand-500/20">
              {isRendering ? (
                <Film className="w-8 h-8 animate-pulse" />
              ) : renderError ? (
                <AlertCircle className="w-8 h-8 text-rose-300" />
              ) : (
                <Check className="w-8 h-8" />
              )}
            </div>

            <div>
              <h3 className="text-xl font-bold text-white">
                {isRendering
                  ? 'Rendering Your AI Video...'
                  : renderError
                  ? 'Rendering Encountered an Error'
                  : 'Video Export Ready!'}
              </h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                {isRendering
                  ? 'FFmpeg is trimming silences, compositing animated captions, overlaying B-roll, and mastering audio.'
                  : renderError
                  ? renderError
                  : 'Your high-converting MP4 has been generated and optimized for social platforms.'}
              </p>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                <span>Rendering Engine</span>
                <span className="font-mono text-brand-400">{renderProgress}%</span>
              </div>
              <div className="w-full bg-dark-900 h-2.5 rounded-full overflow-hidden border border-white/[0.08]">
                <div
                  className="h-full bg-gradient-to-r from-brand-500 via-pink-500 to-brand-400 transition-all duration-300"
                  style={{ width: `${renderProgress}%` }}
                />
              </div>
            </div>

            {/* Actions once completed */}
            {!isRendering && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setIsRenderModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-xs font-semibold transition-colors"
                >
                  Close
                </button>

                {project.outputVideoUrl && (
                  <a
                    href={project.outputVideoUrl}
                    download
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 transition-all flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download 1080p MP4</span>
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

