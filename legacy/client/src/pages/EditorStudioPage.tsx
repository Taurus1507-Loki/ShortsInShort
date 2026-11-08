import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Headphones,
  Speaker,
  Mic,
  Volume1,
  UploadCloud,
  Image as ImageIcon,
  Loader2,
  X,
} from 'lucide-react';
import { formatCredits, formatDuration } from '../utils/cn.js';
import { Player, PlayerRef } from '@remotion/player';
import { EditorVideoComposition } from '../remotion/EditorVideoComposition.js';
import { ProTimeline } from '../components/ProTimeline.js';

// Remotion composition for preview
const RemotionPreview: React.FC<{ 
  projectData: Project; 
  isPlaying: boolean; 
  onSeek: (time: number) => void;
  currentTime: number;
}> = ({ projectData, isPlaying, onSeek, currentTime }) => {
  if (!projectData) return null;
  
  const playerRef = useRef<PlayerRef>(null);

  const aspectRatio = projectData.aspectRatio || '9:16';
  const resolution = projectData.resolution || '1080p';
  
  const getDimensions = () => {
    const resolutions: Record<string, Record<string, [number, number]>> = {
      '720p': { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [720, 720], '4:5': [720, 900] },
      '1080p': { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] },
      '4k': { '9:16': [2160, 3840], '16:9': [3840, 2160], '1:1': [2160, 2160], '4:5': [2160, 2700] },
    };
    return resolutions[resolution]?.[aspectRatio] || [1080, 1920];
  };

  const [width, height] = getDimensions();
  const durationInFrames = Math.max(30, Math.ceil((projectData.duration || 30) * 30));
  const fps = 30;

  useEffect(() => {
    if (isPlaying) {
      playerRef.current?.play();
    } else {
      playerRef.current?.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    if (playerRef.current) {
      const targetFrame = Math.round(currentTime * fps);
      const currentFrame = playerRef.current.getCurrentFrame();
      if (Math.abs(targetFrame - currentFrame) > 2) {
        playerRef.current.seekTo(targetFrame);
      }
    }
  }, [currentTime, fps]);

  return (
    <Player
      ref={playerRef}
      component={EditorVideoComposition}
      inputProps={{ projectData }}
      durationInFrames={durationInFrames}
      fps={fps}
      compositionWidth={width}
      compositionHeight={height}
      style={{ width: '100%', height: '100%' }}
    />
  );
};

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

  // Upload Video / Image state
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [targetSceneIndexForBroll, setTargetSceneIndexForBroll] = useState<number | null>(null);
  const uploadFileInputRef = useRef<HTMLInputElement | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const remotionPlayerRef = useRef<any>(null);

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

  // Handle seek from Remotion player
  const handleSeek = useCallback((newTime: number) => {
    const clamped = Math.max(0, Math.min(duration, newTime));
    setCurrentTime(clamped);
  }, [duration]);

  // Toggle play/pause - controls Remotion player
  const togglePlay = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  // Fallback timer for timeline when player doesn't send position updates during playback
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTime(prev => {
          const next = prev + 0.1;
          if (next >= duration) {
            setIsPlaying(false);
            return 0;
          }
          return next;
        });
      }, 100);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, duration]);

  // Handle skip forward/backward
  const handleSkip = useCallback((delta: number) => {
    handleSeek(currentTime + delta);
  }, [currentTime, handleSeek]);

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

  // Update background music selection
  const handleMusicSelect = (musicCategory: string) => {
    setProject((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        editingPreferences: {
          ...prev.editingPreferences,
          backgroundMusic: musicCategory,
          autoDucking: true,
        },
      };
    });
    setIsMuted(false);
    setVolume(project?.editingPreferences?.musicVolume || 15);
    setToastMessage(`Selected ${musicCategory} as background music`);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // Update music volume
  const handleMusicVolumeChange = (volume: number) => {
    setVolume(volume);
    setProject((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        editingPreferences: {
          ...prev.editingPreferences,
          musicVolume: volume,
        },
      };
    });
  };

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
      // Update project's editing preferences to remove background music
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          editingPreferences: {
            ...prev.editingPreferences,
            backgroundMusic: undefined,
            autoDucking: false,
          },
        };
      });
      setIsMuted(true);
      setVolume(0);
      setToastMessage(`Removed background audio track`);
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
  }, [selectedTrackItem]);

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

  // Upload Video or Image File
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;

    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append('video', file);

      const result = await api.upload<any>('/videos/upload', formData);

      if (targetSceneIndexForBroll !== null) {
        // Assign to specific scene as B-Roll overlay
        setScenes((prev) =>
          prev.map((s, idx) =>
            idx === targetSceneIndexForBroll
              ? { ...s, brollMediaUrl: result.url, brollQuery: file.name }
              : s
          )
        );
        setToastMessage(`Attached ${file.name} to Scene ${targetSceneIndexForBroll + 1}`);
        setTargetSceneIndexForBroll(null);
      } else {
        // Set as main project video or image background
        setProject((prev) => (prev ? { ...prev, rawVideoUrl: result.url } : prev));
        if (result.metadata?.duration) {
          setDuration(result.metadata.duration);
        }
        await api.patch(`/projects/${id}`, {
          rawVideoUrl: result.url,
          duration: result.metadata?.duration || duration,
        });
        setToastMessage(`Loaded ${result.isImage ? 'image' : 'video'} into editor canvas`);
      }

      setIsUploadModalOpen(false);
      setTimeout(() => setToastMessage(''), 3500);
    } catch (err: any) {
      alert(err.message || 'Media upload failed');
    } finally {
      setIsUploading(false);
      if (uploadFileInputRef.current) uploadFileInputRef.current.value = '';
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

  // Prepare project data for Remotion - convert relative URLs to absolute
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const remotionProjectData = {
    ...project,
    transcription: words,
    scenes: scenes.map(s => ({
      ...s,
      brollMediaUrl: s.brollMediaUrl ? `${baseUrl}${s.brollMediaUrl}` : undefined,
    })),
    rawVideoUrl: project.rawVideoUrl ? `${baseUrl}${project.rawVideoUrl}` : undefined,
    outputVideoUrl: project.outputVideoUrl ? `${baseUrl}${project.outputVideoUrl}` : undefined,
    backgroundMusic: project.editingPreferences?.backgroundMusic,
    musicVolume: project.editingPreferences?.musicVolume,
    autoDucking: project.editingPreferences?.autoDucking,
    zoomIntensity: project.editingPreferences?.zoomIntensity,
    highlightKeywords: project.editingPreferences?.highlightKeywords,
  };

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
          <button
            onClick={() => {
              setTargetSceneIndexForBroll(null);
              setIsUploadModalOpen(true);
            }}
            className="px-4 py-2.5 rounded-xl bg-dark-850 hover:bg-white/[0.08] text-slate-200 border border-white/[0.1] text-xs font-bold transition-all flex items-center gap-2 shadow"
            title="Upload raw video footage or background image"
          >
            <UploadCloud className="w-4 h-4 text-brand-400" />
            <span className="hidden sm:inline">Upload Video / Image</span>
          </button>
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
            className={`rounded-3xl bg-black border-2 border-white/[0.1] relative overflow-hidden shadow-2xl ${
              isVertical ? 'w-[320px] h-[568px]' : 'w-full max-w-[640px] h-[360px]'
            }`}
          >
            {/* Remotion Player for Real-time Preview */}
            <RemotionPreview
              projectData={remotionProjectData}
              isPlaying={isPlaying}
              onSeek={handleSeek}
              currentTime={currentTime}
            />

            {/* Top Reel Overlay Header */}
            <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between text-white text-xs pointer-events-none">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md border border-white/[0.1]">
                {project.aspectRatio}
              </span>
              <span className="text-[10px] font-mono bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-md text-slate-300">
                {formatDuration(currentTime)} / {formatDuration(duration)}
              </span>
            </div>

            {/* Active Scene & B-Roll Tag */}
            <div className="absolute bottom-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
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
                        placeholder="Search stock query or upload..."
                        className="flex-1 px-3 py-1.5 rounded-lg bg-dark-850 border border-white/[0.1] text-xs text-white focus:outline-none focus:border-brand-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setTargetSceneIndexForBroll(idx);
                          setIsUploadModalOpen(true);
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-pink-500/15 hover:bg-pink-500/25 border border-pink-500/30 text-pink-300 text-xs font-bold flex items-center gap-1 transition-all flex-shrink-0"
                        title="Upload custom video clip or image for this scene"
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        <span>Upload</span>
                      </button>
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
                    onClick={() => handleMusicSelect(track.cat)}
                    className={`p-3 rounded-xl bg-dark-900 border flex items-center justify-between cursor-pointer transition-colors ${
                      project.editingPreferences?.backgroundMusic === track.cat
                        ? 'border-brand-500 bg-brand-500/10'
                        : 'border-white/[0.08] hover:border-brand-500/40'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold text-white">{track.name}</div>
                      <div className="text-[10px] text-slate-500">{track.vibe}</div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      project.editingPreferences?.backgroundMusic === track.cat
                        ? 'bg-brand-500/20 text-brand-300'
                        : 'bg-white/[0.05] text-slate-500'
                    }`}>
                      {project.editingPreferences?.backgroundMusic === track.cat ? 'Selected' : 'Select'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="p-4 rounded-2xl bg-dark-900 border border-white/[0.08] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-semibold">Music Volume</span>
                  <span className="text-emerald-400 font-bold">{volume}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={volume}
                  onChange={(e) => handleMusicVolumeChange(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none accent-emerald-500"
                />
                <p className="text-[11px] text-slate-500">
                  Adjust background music volume level.
                </p>
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

      {/* Professional Multi-Track Timeline */}
      <ProTimeline
        currentTime={currentTime}
        duration={duration}
        scenes={scenes}
        words={words}
        selectedTrackItem={selectedTrackItem}
        isMuted={isMuted}
        volume={volume}
        isPlaying={isPlaying}
        toastMessage={toastMessage}
        onSeek={handleSeek}
        onTogglePlay={togglePlay}
        onSelectTrackItem={(item) => setSelectedTrackItem(item)}
        onDeleteSelected={deleteSelectedTrackItem}
        onUpdateScenes={setScenes}
        onUpdateWords={setWords}
        onToggleMute={() => setIsMuted((m) => !m)}
        onUpdateVolume={setVolume}
        onShowToast={(msg) => {
          setToastMessage(msg);
          setTimeout(() => setToastMessage(''), 3000);
        }}
      />

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

      {/* Upload Media Modal */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-dark-850 border border-white/[0.1] rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-brand-500/20 border border-brand-500/30 flex items-center justify-center text-brand-400">
                  <UploadCloud className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {targetSceneIndexForBroll !== null
                      ? `Upload B-Roll for Scene ${targetSceneIndexForBroll + 1}`
                      : 'Upload Video or Image Asset'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {targetSceneIndexForBroll !== null
                      ? 'Upload a video clip or image overlay for this scene'
                      : 'Upload media footage to edit in the studio canvas'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsUploadModalOpen(false);
                  setTargetSceneIndexForBroll(null);
                }}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/[0.05]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <input
              type="file"
              ref={uploadFileInputRef}
              onChange={handleFileUpload}
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska,image/jpeg,image/png,image/webp"
              className="hidden"
            />

            <div
              onClick={() => !isUploading && uploadFileInputRef.current?.click()}
              className="border-2 border-dashed border-white/[0.15] hover:border-brand-500/50 bg-dark-900/60 hover:bg-dark-900 p-8 rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-all group"
            >
              <div className="w-14 h-14 rounded-2xl bg-white/[0.04] group-hover:bg-brand-500/20 border border-white/[0.08] group-hover:border-brand-500/30 flex items-center justify-center text-slate-400 group-hover:text-brand-400 mb-3 transition-all">
                {isUploading ? (
                  <Loader2 className="w-7 h-7 animate-spin text-brand-400" />
                ) : (
                  <UploadCloud className="w-7 h-7" />
                )}
              </div>

              <span className="text-xs font-bold text-white group-hover:text-brand-300">
                {isUploading ? 'Uploading & Processing Media...' : 'Click to Browse Video or Image'}
              </span>
              <span className="text-[11px] text-slate-500 mt-1">
                Supports MP4, MOV, WebM, JPG, PNG, WebP (up to 250MB)
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsUploadModalOpen(false);
                  setTargetSceneIndexForBroll(null);
                }}
                disabled={isUploading}
                className="px-4 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

