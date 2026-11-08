import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { IScene, IWordTimestamp } from '../types/index.js';
import {
  Scissors,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ZoomIn,
  ZoomOut,
  Magnet,
  Undo2,
  Redo2,
  MousePointer,
  Bookmark,
  Trash2,
  Music,
  Film,
  Sparkles,
  Volume2,
  VolumeX,
  Volume1,
  Check,
  AlertCircle,
  Clock,
  Layers,
  Activity,
  Sliders,
  Split,
} from 'lucide-react';

export type EditingTool = 'select' | 'blade' | 'trim';

export interface TimelineMarker {
  id: string;
  time: number;
  label: string;
  color: string;
}

export type SelectedTrackItem =
  | { type: 'scene'; index: number }
  | { type: 'caption'; index: number }
  | { type: 'broll'; index: number }
  | { type: 'audio' };

export interface ProTimelineProps {
  currentTime: number;
  duration: number;
  scenes: IScene[];
  words: IWordTimestamp[];
  selectedTrackItem: SelectedTrackItem | null;
  isMuted: boolean;
  volume: number;
  isPlaying: boolean;
  toastMessage?: string;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onSelectTrackItem: (item: SelectedTrackItem | null) => void;
  onDeleteSelected: () => void;
  onUpdateScenes: (scenes: IScene[]) => void;
  onUpdateWords: (words: IWordTimestamp[]) => void;
  onToggleMute: () => void;
  onUpdateVolume: (volume: number) => void;
  onShowToast?: (msg: string) => void;
}

export const ProTimeline: React.FC<ProTimelineProps> = ({
  currentTime,
  duration,
  scenes,
  words,
  selectedTrackItem,
  isMuted,
  volume,
  isPlaying,
  toastMessage,
  onSeek,
  onTogglePlay,
  onSelectTrackItem,
  onDeleteSelected,
  onUpdateScenes,
  onUpdateWords,
  onToggleMute,
  onUpdateVolume,
  onShowToast,
}) => {
  // Editing tool state
  const [activeTool, setActiveTool] = useState<EditingTool>('select');
  const [zoomLevel, setZoomLevel] = useState<number>(1); // 1 = 100%, 0.5 to 3.0
  const [snappingEnabled, setSnappingEnabled] = useState<boolean>(true);

  // Track control states
  const [videoTrackVisible, setVideoTrackVisible] = useState<boolean>(true);
  const [videoTrackLocked, setVideoTrackLocked] = useState<boolean>(false);
  const [brollTrackVisible, setBrollTrackVisible] = useState<boolean>(true);
  const [brollTrackLocked, setBrollTrackLocked] = useState<boolean>(false);
  const [captionTrackVisible, setCaptionTrackVisible] = useState<boolean>(true);
  const [captionTrackLocked, setCaptionTrackLocked] = useState<boolean>(false);
  const [audioTrackMuted, setAudioTrackMuted] = useState<boolean>(false);
  const [audioTrackSolo, setAudioTrackSolo] = useState<boolean>(false);
  const [musicTrackMuted, setMusicTrackMuted] = useState<boolean>(false);
  const [musicTrackSolo, setMusicTrackSolo] = useState<boolean>(false);

  // Markers
  const [markers, setMarkers] = useState<TimelineMarker[]>([
    { id: '1', time: 0, label: 'Intro Hook', color: '#38bdf8' },
    { id: '2', time: Math.min(duration, 5), label: 'Problem Drop', color: '#f59e0b' },
  ]);

  // History stack for Undo/Redo
  const [history, setHistory] = useState<{ scenes: IScene[]; words: IWordTimestamp[] }[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // Container refs for scrubbing & dragging
  const timelineCanvasRef = useRef<HTMLDivElement | null>(null);
  const isScrubbingRef = useRef<boolean>(false);

  // Record initial history state
  useEffect(() => {
    if (history.length === 0 && scenes.length > 0) {
      setHistory([{ scenes: [...scenes], words: [...words] }]);
      setHistoryIndex(0);
    }
  }, [scenes, words, history.length]);

  const pushHistory = useCallback(
    (newScenes: IScene[], newWords: IWordTimestamp[]) => {
      setHistory((prev) => {
        const sliced = prev.slice(0, historyIndex + 1);
        return [...sliced, { scenes: newScenes, words: newWords }];
      });
      setHistoryIndex((prev) => prev + 1);
    },
    [historyIndex]
  );

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex((i) => i - 1);
      onUpdateScenes(prev.scenes);
      onUpdateWords(prev.words);
      onShowToast?.('Undo action applied');
    }
  }, [historyIndex, history, onUpdateScenes, onUpdateWords, onShowToast]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex((i) => i + 1);
      onUpdateScenes(next.scenes);
      onUpdateWords(next.words);
      onShowToast?.('Redo action applied');
    }
  }, [historyIndex, history, onUpdateScenes, onUpdateWords, onShowToast]);

  // Format time as SMPTE timecode (HH:MM:SS:FF at 30 fps)
  const formatSMPTETimecode = (timeInSeconds: number): string => {
    const s = Math.max(0, timeInSeconds);
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = Math.floor(s % 60);
    const frames = Math.floor((s % 1) * 30);
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${frames
      .toString()
      .padStart(2, '0')}`;
  };

  // Convert click/drag on timeline to seconds with optional snapping
  const calculateTimeFromX = useCallback(
    (clientX: number): number => {
      if (!timelineCanvasRef.current) return currentTime;
      const rect = timelineCanvasRef.current.getBoundingClientRect();
      const relativeX = clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, relativeX / rect.width));
      let targetTime = percentage * duration;

      if (snappingEnabled) {
        const snapThreshold = 0.25; // 250ms snap radius
        // Snap to scenes
        for (const s of scenes) {
          const startS = s.startMs / 1000;
          const endS = s.endMs / 1000;
          if (Math.abs(targetTime - startS) < snapThreshold) {
            targetTime = startS;
            break;
          }
          if (Math.abs(targetTime - endS) < snapThreshold) {
            targetTime = endS;
            break;
          }
        }
        // Snap to markers
        for (const m of markers) {
          if (Math.abs(targetTime - m.time) < snapThreshold) {
            targetTime = m.time;
            break;
          }
        }
      }

      return Math.max(0, Math.min(duration, targetTime));
    },
    [currentTime, duration, snappingEnabled, scenes, markers]
  );

  // Mouse scrubbing listeners
  const handleMouseDownScrub = (e: React.MouseEvent) => {
    isScrubbingRef.current = true;
    const newTime = calculateTimeFromX(e.clientX);
    onSeek(newTime);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (isScrubbingRef.current) {
        onSeek(calculateTimeFromX(moveEvent.clientX));
      }
    };

    const handleMouseUp = () => {
      isScrubbingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Split Scene at Current Playhead (Razor Blade Tool action)
  const handleSplitAtPlayhead = useCallback(() => {
    const currentMs = Math.round(currentTime * 1000);
    const sceneIndex = scenes.findIndex(
      (s) => currentMs > s.startMs + 300 && currentMs < s.endMs - 300
    );

    if (sceneIndex === -1) {
      onShowToast?.('Cannot split: playhead is too close to a cut boundary');
      return;
    }

    const targetScene = scenes[sceneIndex];
    const leftScene: IScene = {
      ...targetScene,
      endMs: currentMs,
    };
    const rightScene: IScene = {
      ...targetScene,
      startMs: currentMs,
      brollMediaUrl: undefined, // Clear overlay on right cut to let editor choose
    };

    const newScenes = [
      ...scenes.slice(0, sceneIndex),
      leftScene,
      rightScene,
      ...scenes.slice(sceneIndex + 1),
    ].map((s, idx) => ({ ...s, index: idx }));

    pushHistory(newScenes, words);
    onUpdateScenes(newScenes);
    onShowToast?.(`Split Scene #${sceneIndex + 1} at ${currentTime.toFixed(2)}s`);
  }, [currentTime, scenes, words, pushHistory, onUpdateScenes, onShowToast]);

  // Add Marker at playhead
  const handleAddMarker = () => {
    const colors = ['#38bdf8', '#f59e0b', '#ec4899', '#10b981', '#a855f7'];
    const newMarker: TimelineMarker = {
      id: Date.now().toString(),
      time: Number(currentTime.toFixed(2)),
      label: `Mark ${markers.length + 1} (${currentTime.toFixed(1)}s)`,
      color: colors[markers.length % colors.length],
    };
    setMarkers((prev) => [...prev, newMarker]);
    onShowToast?.(`Added Marker at ${currentTime.toFixed(2)}s`);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (
        targetTag === 'input' ||
        targetTag === 'textarea' ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handleSplitAtPlayhead();
      } else if (e.key.toLowerCase() === 'v') {
        setActiveTool('select');
      } else if (e.key.toLowerCase() === 'c') {
        setActiveTool('blade');
      } else if (e.key.toLowerCase() === 'b') {
        setActiveTool('trim');
      } else if (e.key.toLowerCase() === 's') {
        setSnappingEnabled((prev) => !prev);
      } else if (e.key.toLowerCase() === 'm') {
        handleAddMarker();
      } else if (e.key === 'Home') {
        e.preventDefault();
        onSeek(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        onSeek(duration);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onSeek(Math.max(0, currentTime - (e.shiftKey ? 1 : 1 / 30)));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onSeek(Math.min(duration, currentTime + (e.shiftKey ? 1 : 1 / 30)));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleSplitAtPlayhead, currentTime, duration, onSeek]);

  // Generate ticks for time ruler based on duration and zoom
  const rulerTicks = useMemo(() => {
    const step = zoomLevel >= 2 ? 1 : zoomLevel >= 1 ? 2 : 5;
    const ticks: { time: number; label: string; isMajor: boolean }[] = [];
    for (let t = 0; t <= duration; t += step) {
      const minutes = Math.floor(t / 60);
      const seconds = Math.floor(t % 60);
      ticks.push({
        time: t,
        label: `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
        isMajor: true,
      });
    }
    return ticks;
  }, [duration, zoomLevel]);

  // Playhead percentage position
  const playheadPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="rounded-3xl bg-[#121316] border border-white/[0.08] shadow-2xl p-5 space-y-4 select-none font-sans text-slate-200">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="p-3 rounded-2xl bg-brand-500/15 border border-brand-500/40 text-brand-300 text-xs font-bold flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <span className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </span>
          <span className="text-[10px] text-slate-400 font-mono">NLE Timeline Engine</span>
        </div>
      )}

      {/* Pro NLE Header & Master Transport Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-white/[0.08]">
        {/* Left: Tool Selection & Quick Actions */}
        <div className="flex items-center gap-2">
          {/* Tool switcher segmented group */}
          <div className="flex items-center bg-dark-950 p-1 rounded-xl border border-white/[0.08] shadow-inner">
            <button
              onClick={() => setActiveTool('select')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTool === 'select'
                  ? 'bg-brand-600 text-white shadow-md shadow-brand-600/30 font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
              }`}
              title="Selection Tool (V) — Select, scrub, and delete"
            >
              <MousePointer className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Select [V]</span>
            </button>

            <button
              onClick={() => setActiveTool('blade')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTool === 'blade'
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
              }`}
              title="Razor Blade Tool (C) — Split clips at click point"
            >
              <Scissors className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Razor [C]</span>
            </button>

            <button
              onClick={() => setActiveTool('trim')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTool === 'trim'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30 font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
              }`}
              title="Trim / Ripple Tool (B)"
            >
              <Activity className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Trim [B]</span>
            </button>
          </div>

          {/* Quick Action: Split at Playhead */}
          <button
            onClick={handleSplitAtPlayhead}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-dark-900 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 border border-white/[0.08] hover:border-amber-500/40 text-xs font-bold transition-all"
            title="Split Clip at Playhead (Ctrl+K)"
          >
            <Split className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden md:inline">Split [Ctrl+K]</span>
          </button>

          {/* Snapping Magnet Toggle */}
          <button
            onClick={() => setSnappingEnabled((prev) => !prev)}
            className={`p-2 rounded-xl border text-xs font-bold transition-all ${
              snappingEnabled
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                : 'bg-dark-900 border-white/[0.08] text-slate-500 hover:text-slate-300'
            }`}
            title={`Magnetic Snapping (S): ${snappingEnabled ? 'ON' : 'OFF'}`}
          >
            <Magnet className="w-3.5 h-3.5" />
          </button>

          {/* Add Marker Button */}
          <button
            onClick={handleAddMarker}
            className="p-2 rounded-xl bg-dark-900 hover:bg-white/[0.05] border border-white/[0.08] text-slate-400 hover:text-sky-400 text-xs font-bold transition-all"
            title="Add Timeline Marker (M)"
          >
            <Bookmark className="w-3.5 h-3.5" />
          </button>

          {/* History Undo / Redo */}
          <div className="flex items-center gap-1 border-l border-white/[0.08] pl-2">
            <button
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              className="p-2 rounded-xl bg-dark-900 hover:bg-white/[0.05] disabled:opacity-30 disabled:pointer-events-none border border-white/[0.08] text-slate-300 text-xs transition-all"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              className="p-2 rounded-xl bg-dark-900 hover:bg-white/[0.05] disabled:opacity-30 disabled:pointer-events-none border border-white/[0.08] text-slate-300 text-xs transition-all"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Center: SMPTE Digital Timecode HUD Display */}
        <div className="flex items-center gap-3 bg-dark-950 px-4 py-1.5 rounded-2xl border border-white/[0.1] shadow-inner">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500 font-mono">
              SMPTE
            </span>
          </div>

          <div className="font-mono text-base font-black tracking-widest text-emerald-400">
            {formatSMPTETimecode(currentTime)}
          </div>

          <span className="text-slate-600 font-mono text-xs">/</span>

          <div className="font-mono text-xs font-bold text-slate-400">
            {formatSMPTETimecode(duration)}
          </div>

          <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.06] text-slate-400 font-mono hidden sm:inline">
            30 FPS
          </span>
        </div>

        {/* Right: Zoom Scale & Selection Status */}
        <div className="flex items-center gap-3">
          {selectedTrackItem ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-bold">
              <span>
                Selected: <span className="uppercase">{selectedTrackItem.type}</span>{' '}
                {'index' in selectedTrackItem ? `#${(selectedTrackItem.index ?? 0) + 1}` : ''}
              </span>
              <button
                onClick={onDeleteSelected}
                className="ml-1 px-2 py-0.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-bold flex items-center gap-1 transition-colors"
                title="Delete Selected Clip (Delete key)"
              >
                <Trash2 className="w-3 h-3" />
                <span>Del</span>
              </button>
              <button
                onClick={() => onSelectTrackItem(null)}
                className="text-slate-400 hover:text-white text-xs px-1"
                title="Deselect"
              >
                ✕
              </button>
            </div>
          ) : (
            <span className="text-[11px] text-slate-500 hidden xl:inline">
              [V] Select • [C] Razor • [Ctrl+K] Split • [Del] Delete
            </span>
          )}

          {/* Zoom Slider Controls */}
          <div className="flex items-center gap-1 bg-dark-950 px-2 py-1 rounded-xl border border-white/[0.08]">
            <button
              onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
              className="p-1 text-slate-400 hover:text-white transition-colors"
              title="Zoom Out (-)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>

            <input
              type="range"
              min="0.5"
              max="3"
              step="0.25"
              value={zoomLevel}
              onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
              className="w-16 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-brand-500"
            />

            <button
              onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
              className="p-1 text-slate-400 hover:text-white transition-colors"
              title="Zoom In (+)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setZoomLevel(1)}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-400 hover:text-white ml-1 font-bold"
              title="Fit to Screen"
            >
              Fit
            </button>
          </div>
        </div>
      </div>

      {/* Main Multi-Track Workbench Area (Headers + Tracks Grid) */}
      <div className="flex rounded-2xl bg-dark-950 border border-white/[0.08] overflow-hidden">
        {/* Left: Sticky Track Controls Column */}
        <div className="w-48 sm:w-56 flex-shrink-0 bg-[#0e0f12] border-r border-white/[0.08] flex flex-col z-20">
          {/* Header spacer aligned with Ruler */}
          <div className="h-9 border-b border-white/[0.08] px-3 flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-[#14151a]">
            <span>Tracks & Routing</span>
            <Layers className="w-3.5 h-3.5 text-slate-500" />
          </div>

          {/* Track Header V1: Video */}
          <div className="h-14 border-b border-white/[0.06] p-2 flex items-center justify-between hover:bg-white/[0.02]">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="w-6 h-6 rounded-md bg-blue-500/20 text-blue-400 border border-blue-500/40 text-[10px] font-mono font-bold flex items-center justify-center flex-shrink-0">
                V1
              </span>
              <div className="truncate">
                <div className="text-xs font-bold text-white truncate">Main Video</div>
                <div className="text-[9px] text-slate-500">{scenes.length} Scenes / Cuts</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setVideoTrackVisible((v) => !v)}
                className={`p-1 rounded text-slate-400 hover:text-white ${!videoTrackVisible ? 'text-rose-400' : ''}`}
                title={videoTrackVisible ? 'Hide Video Layer' : 'Show Video Layer'}
              >
                {videoTrackVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setVideoTrackLocked((l) => !l)}
                className={`p-1 rounded text-slate-400 hover:text-white ${videoTrackLocked ? 'text-amber-400' : ''}`}
                title={videoTrackLocked ? 'Unlock Track' : 'Lock Track'}
              >
                {videoTrackLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Track Header V2: B-Roll Media */}
          <div className="h-12 border-b border-white/[0.06] p-2 flex items-center justify-between hover:bg-white/[0.02]">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="w-6 h-6 rounded-md bg-pink-500/20 text-pink-400 border border-pink-500/40 text-[10px] font-mono font-bold flex items-center justify-center flex-shrink-0">
                V2
              </span>
              <div className="truncate">
                <div className="text-xs font-bold text-white truncate">B-Roll Overlay</div>
                <div className="text-[9px] text-slate-500">Stock Media</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setBrollTrackVisible((v) => !v)}
                className={`p-1 rounded text-slate-400 hover:text-white ${!brollTrackVisible ? 'text-rose-400' : ''}`}
                title={brollTrackVisible ? 'Hide B-Roll' : 'Show B-Roll'}
              >
                {brollTrackVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setBrollTrackLocked((l) => !l)}
                className={`p-1 rounded text-slate-400 hover:text-white ${brollTrackLocked ? 'text-amber-400' : ''}`}
                title={brollTrackLocked ? 'Unlock Track' : 'Lock Track'}
              >
                {brollTrackLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Track Header T1: Captions */}
          <div className="h-12 border-b border-white/[0.06] p-2 flex items-center justify-between hover:bg-white/[0.02]">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="w-6 h-6 rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[10px] font-mono font-bold flex items-center justify-center flex-shrink-0">
                T1
              </span>
              <div className="truncate">
                <div className="text-xs font-bold text-white truncate">Captions</div>
                <div className="text-[9px] text-slate-500">{words.length} Karaoke Words</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCaptionTrackVisible((v) => !v)}
                className={`p-1 rounded text-slate-400 hover:text-white ${!captionTrackVisible ? 'text-rose-400' : ''}`}
                title={captionTrackVisible ? 'Hide Captions' : 'Show Captions'}
              >
                {captionTrackVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setCaptionTrackLocked((l) => !l)}
                className={`p-1 rounded text-slate-400 hover:text-white ${captionTrackLocked ? 'text-amber-400' : ''}`}
                title={captionTrackLocked ? 'Unlock Track' : 'Lock Track'}
              >
                {captionTrackLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Track Header A1: Speech / Dialogue Audio */}
          <div className="h-12 border-b border-white/[0.06] p-2 flex items-center justify-between hover:bg-white/[0.02]">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="w-6 h-6 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-mono font-bold flex items-center justify-center flex-shrink-0">
                A1
              </span>
              <div className="truncate">
                <div className="text-xs font-bold text-white truncate">Speech / Vocals</div>
                <div className="text-[9px] text-emerald-500 font-mono">0 dB • Stereo</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setAudioTrackMuted((m) => !m)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  audioTrackMuted
                    ? 'bg-amber-500 text-black'
                    : 'bg-white/[0.05] text-slate-400 hover:text-white'
                }`}
                title="Mute Track (M)"
              >
                M
              </button>
              <button
                onClick={() => setAudioTrackSolo((s) => !s)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  audioTrackSolo
                    ? 'bg-emerald-500 text-black'
                    : 'bg-white/[0.05] text-slate-400 hover:text-white'
                }`}
                title="Solo Track (S)"
              >
                S
              </button>
            </div>
          </div>

          {/* Track Header A2: Background Music & Ducking */}
          <div className="h-12 p-2 flex items-center justify-between hover:bg-white/[0.02]">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="w-6 h-6 rounded-md bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 text-[10px] font-mono font-bold flex items-center justify-center flex-shrink-0">
                A2
              </span>
              <div className="truncate">
                <div className="text-xs font-bold text-white truncate">Background Music</div>
                <div className="text-[9px] text-cyan-400 flex items-center gap-1">
                  <span>Ducking</span>
                  <span className="font-mono text-[8px] bg-cyan-500/20 px-1 rounded">-18dB</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setMusicTrackMuted((m) => !m);
                  onToggleMute();
                }}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  isMuted || musicTrackMuted
                    ? 'bg-amber-500 text-black'
                    : 'bg-white/[0.05] text-slate-400 hover:text-white'
                }`}
                title="Mute Music Track"
              >
                M
              </button>
              <button
                onClick={() => setMusicTrackSolo((s) => !s)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  musicTrackSolo
                    ? 'bg-emerald-500 text-black'
                    : 'bg-white/[0.05] text-slate-400 hover:text-white'
                }`}
                title="Solo Music Track"
              >
                S
              </button>
            </div>
          </div>
        </div>

        {/* Right: Scrollable Timeline Canvas */}
        <div className="flex-1 overflow-x-auto relative scrollbar-thin scrollbar-thumb-white/10 select-none">
          <div
            ref={timelineCanvasRef}
            onClick={() => onSelectTrackItem(null)}
            className="min-w-full relative"
            style={{ width: `${Math.max(100, zoomLevel * 100)}%` }}
          >
            {/* Top Interactive Time Ruler */}
            <div
              onMouseDown={handleMouseDownScrub}
              className="h-9 bg-[#16171d] border-b border-white/[0.08] relative cursor-pointer group"
              title="Click or drag to scrub playhead"
            >
              {/* Ruler ticks and time labels */}
              {rulerTicks.map((tick, i) => {
                const percent = (tick.time / duration) * 100;
                return (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 flex flex-col justify-between pointer-events-none"
                    style={{ left: `${percent}%` }}
                  >
                    <span className="text-[9px] font-mono text-slate-400 pl-1 font-bold">
                      {tick.label}
                    </span>
                    <div className="w-px h-2.5 bg-white/20" />
                  </div>
                );
              })}

              {/* Markers along the ruler */}
              {markers.map((marker) => {
                const percent = (marker.time / duration) * 100;
                return (
                  <div
                    key={marker.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(marker.time);
                    }}
                    className="absolute top-0 z-30 cursor-pointer -translate-x-1/2 group"
                    style={{ left: `${percent}%` }}
                    title={`Marker: ${marker.label} (${marker.time}s) — Click to jump`}
                  >
                    <div
                      className="w-3 h-3 rounded-full border border-black shadow flex items-center justify-center text-[7px] text-white font-bold"
                      style={{ backgroundColor: marker.color }}
                    >
                      ▼
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Red / Neon Playhead Needle (Extends through all tracks) */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-40 pointer-events-none shadow-[0_0_10px_rgba(244,63,94,0.8)]"
              style={{ left: `${playheadPercent}%` }}
            >
              {/* Playhead Grabber Head at the ruler */}
              <div className="absolute -top-1 -translate-x-1/2 flex flex-col items-center pointer-events-auto cursor-grab active:cursor-grabbing">
                <div className="px-1.5 py-0.5 rounded bg-rose-600 text-[8px] font-mono font-bold text-white shadow-lg whitespace-nowrap">
                  {currentTime.toFixed(2)}s
                </div>
                <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[5px] border-t-rose-600" />
              </div>
            </div>

            {/* Track 1 Canvas: Video Scene Cuts (V1) */}
            <div className="h-14 border-b border-white/[0.06] p-1 flex items-center bg-[#131418] relative">
              {scenes.length > 0 ? (
                scenes.map((scene, idx) => {
                  const isSelected =
                    selectedTrackItem?.type === 'scene' && selectedTrackItem.index === idx;
                  const sceneDuration = (scene.endMs - scene.startMs) / 1000;
                  return (
                    <div
                      key={idx}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activeTool === 'blade') {
                          handleSplitAtPlayhead();
                        } else {
                          onSelectTrackItem({ type: 'scene', index: idx });
                          onSeek(scene.startMs / 1000);
                        }
                      }}
                      className={`h-full rounded-md border flex items-center justify-between px-2 text-[10px] font-bold cursor-pointer transition-all relative overflow-hidden group ${
                        isSelected
                          ? 'bg-blue-600/60 border-2 border-blue-400 text-white ring-2 ring-blue-400 z-20 shadow-lg'
                          : 'bg-blue-900/40 hover:bg-blue-800/50 border-blue-700/40 text-blue-200'
                      }`}
                      style={{ flex: Math.max(1, sceneDuration) }}
                      title={`Scene #${idx + 1} (${(scene.startMs / 1000).toFixed(1)}s - ${(
                        scene.endMs / 1000
                      ).toFixed(1)}s) — Click to select, [Del] to delete, [C] to split`}
                    >
                      {/* Left Filmstrip / Trim Handle */}
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-white/20 group-hover:bg-white/40 cursor-ew-resize" />

                      <div className="flex items-center gap-1.5 truncate">
                        <Film className="w-3 h-3 text-blue-300 flex-shrink-0" />
                        <span className="truncate">Scene {idx + 1}</span>
                        <span className="text-[8px] font-mono text-blue-300/70 font-normal">
                          {sceneDuration.toFixed(1)}s
                        </span>
                      </div>

                      {/* Transition Badge Indicator */}
                      <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-black/40 text-blue-300 uppercase">
                        {scene.transition || 'CUT'}
                      </span>

                      {/* Right Trim Handle */}
                      <div className="absolute right-0 top-0 bottom-0 w-1 bg-white/20 group-hover:bg-white/40 cursor-ew-resize" />
                    </div>
                  );
                })
              ) : (
                <div className="w-full h-full rounded bg-slate-800/20 border border-dashed border-white/10 flex items-center justify-center text-xs text-slate-500">
                  Full Video Stream
                </div>
              )}
            </div>

            {/* Track 2 Canvas: B-Roll Media Overlays (V2) */}
            <div className="h-12 border-b border-white/[0.06] p-1 flex items-center bg-[#111216] relative">
              {scenes.map((scene, idx) => {
                const isSelected =
                  selectedTrackItem?.type === 'broll' && selectedTrackItem.index === idx;
                const hasBroll = !!scene.brollQuery || !!scene.brollMediaUrl;
                const sceneDuration = (scene.endMs - scene.startMs) / 1000;

                return (
                  <div
                    key={idx}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (hasBroll) {
                        onSelectTrackItem({ type: 'broll', index: idx });
                        onSeek(scene.startMs / 1000);
                      }
                    }}
                    className={`h-full rounded-md border flex items-center justify-between px-2 text-[9px] font-bold truncate transition-all relative ${
                      hasBroll
                        ? isSelected
                          ? 'bg-pink-600/70 border-2 border-pink-300 text-white ring-2 ring-pink-400 z-20 shadow-lg cursor-pointer'
                          : 'bg-pink-900/30 hover:bg-pink-800/40 border-pink-700/40 text-pink-300 cursor-pointer'
                        : 'bg-slate-900/20 border-dashed border-white/[0.04] text-slate-600'
                    }`}
                    style={{ flex: Math.max(1, sceneDuration) }}
                    title={
                      hasBroll
                        ? `B-Roll Overlay: ${scene.brollQuery || 'Stock Clip'}`
                        : 'No B-Roll'
                    }
                  >
                    <span className="truncate">
                      {hasBroll ? `🎥 ${scene.brollQuery || 'B-Roll'}` : '—'}
                    </span>
                    {hasBroll && (
                      <span className="text-[8px] bg-black/40 px-1 rounded text-pink-300 font-mono">
                        PEXELS
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Track 3 Canvas: Captions / Karaoke Subtitles (T1) */}
            <div className="h-12 border-b border-white/[0.06] p-1 flex items-center bg-[#131418] relative overflow-hidden">
              {words.length > 0 ? (
                words.map((wordObj, idx) => {
                  const isSelected =
                    selectedTrackItem?.type === 'caption' && selectedTrackItem.index === idx;
                  const wordDuration = Math.max(0.1, (wordObj.endMs - wordObj.startMs) / 1000);
                  const isCurrentlySpoken =
                    currentTime * 1000 >= wordObj.startMs && currentTime * 1000 <= wordObj.endMs;

                  return (
                    <div
                      key={idx}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTrackItem({ type: 'caption', index: idx });
                        onSeek(wordObj.startMs / 1000);
                      }}
                      className={`h-full rounded text-[9px] font-bold flex items-center justify-center px-1 cursor-pointer transition-all relative truncate ${
                        isSelected
                          ? 'bg-amber-500/80 border-2 border-amber-300 text-black ring-2 ring-amber-400 z-20 shadow-lg'
                          : isCurrentlySpoken
                          ? 'bg-amber-400 text-black font-extrabold shadow-md shadow-amber-400/50 scale-105 z-10'
                          : wordObj.highlight
                          ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                          : 'bg-white/[0.06] hover:bg-white/[0.15] text-slate-300'
                      }`}
                      style={{ flex: wordDuration }}
                      title={`Caption: "${wordObj.word}" (${(wordObj.startMs / 1000).toFixed(1)}s)`}
                    >
                      <span className="truncate">{wordObj.word}</span>
                      {wordObj.highlight && (
                        <span className="absolute -top-0.5 right-0.5 text-[7px] text-amber-400">
                          ★
                        </span>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="w-full text-center text-[10px] text-slate-600">
                  No captions generated
                </div>
              )}
            </div>

            {/* Track 4 Canvas: Speech / Dialogue Waveform (A1) */}
            <div className="h-12 border-b border-white/[0.06] px-2 flex items-center bg-[#101216] relative overflow-hidden">
              <div className="w-full h-8 flex items-center gap-0.5 opacity-90">
                {Array.from({ length: 64 }).map((_, i) => {
                  const amplitude = (Math.sin(i * 0.4) * 0.5 + 0.5) * 80 + 10;
                  return (
                    <div
                      key={i}
                      className="flex-1 bg-gradient-to-t from-emerald-600 via-teal-400 to-cyan-300 rounded-full"
                      style={{ height: `${amplitude}%` }}
                    />
                  );
                })}
              </div>
            </div>

            {/* Track 5 Canvas: Music & Ducking Curve (A2) */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                onSelectTrackItem({ type: 'audio' });
              }}
              className={`h-12 px-2 flex items-center justify-between cursor-pointer transition-all relative ${
                selectedTrackItem?.type === 'audio'
                  ? 'bg-cyan-900/30 ring-2 ring-cyan-400 z-10'
                  : 'bg-[#0f1115] hover:bg-white/[0.02]'
              }`}
              title="Background Music Track with Real-Time Audio Ducking"
            >
              <div className="w-full h-8 flex items-center gap-0.5 opacity-80">
                {Array.from({ length: 64 }).map((_, i) => {
                  // Simulate ducking dips during spoken speech regions
                  const isDuckingDip = i > 12 && i < 28;
                  const height = isMuted
                    ? 3
                    : isDuckingDip
                    ? 15
                    : (Math.cos(i * 0.3) * 0.4 + 0.5) * 75;

                  return (
                    <div
                      key={i}
                      className={`flex-1 rounded-full transition-all ${
                        isMuted
                          ? 'bg-slate-700'
                          : isDuckingDip
                          ? 'bg-cyan-500/50'
                          : 'bg-gradient-to-t from-cyan-600 to-sky-400'
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
