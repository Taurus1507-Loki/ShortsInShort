import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import {
  FacelessTemplate,
  FacelessAnalysis,
  FacelessScenePlan,
  TTSVoice,
  Project,
  AspectRatio,
  Resolution,
} from '../types/index.js';
import {
  FileVideo,
  FileText,
  Sparkles,
  Wand2,
  Volume2,
  Music,
  Zap,
  Clock,
  Layers,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Play,
  RotateCcw,
  Sliders,
  Flame,
  BookOpen,
  Briefcase,
  Cpu,
  Coins,
  Ghost,
  Eye,
  Film,
} from 'lucide-react';
import { formatCredits } from '../utils/cn.js';

const NICHE_TEMPLATES: FacelessTemplate[] = [
  {
    id: 'stoic_mindset',
    name: 'Stoic Wisdom & Mindset',
    category: 'Motivational',
    description: 'Dark cinematic visuals, dramatic silences, deep baritone voice, and bold neon keywords.',
    suggestedBrollQuery: ['ancient statues', 'stormy ocean', 'walking alone night', 'candle flame'],
    musicTrack: 'Dark Cinematic Ambient',
    captionPreset: 'KaraokeNeon',
  },
  {
    id: 'tech_explainer',
    name: 'AI & Tech Breakthroughs',
    category: 'Technology',
    description: 'Fast-paced cybernetic B-roll, high-energy hook, sound effects, and tech graphics.',
    suggestedBrollQuery: ['data stream', 'quantum computer', 'robot hand', 'server lights'],
    musicTrack: 'Cyberpunk Synthwave',
    captionPreset: 'CyberPulse',
  },
  {
    id: 'money_finance',
    name: 'Wealth & Psychology',
    category: 'Finance',
    description: 'Gold charts, high-end lifestyles, psychological hooks, and crisp financial pacing.',
    suggestedBrollQuery: ['stock chart', 'luxury penthouse', 'counting currency', 'vault opening'],
    musicTrack: 'Minimal Electronic',
    captionPreset: 'GoldGlow',
  },
  {
    id: 'mystery_facts',
    name: 'Unsolved Mysteries & Facts',
    category: 'Facts',
    description: 'Eerie B-roll, suspenseful sound cues, countdown subtitles, and dramatic drops.',
    suggestedBrollQuery: ['foggy forest', 'abandoned castle', 'microscope zoom', 'space nebula'],
    musicTrack: 'Suspense Drone',
    captionPreset: 'GhostWhite',
  },
  {
    id: 'business_hustle',
    name: 'Startup & Entrepreneurship',
    category: 'Business',
    description: 'Action-oriented clips, clear lesson breakdown, high retention transitions.',
    suggestedBrollQuery: ['modern glass office', 'late night coding', 'coffee pour', 'team handshake'],
    musicTrack: 'Inspiring Lo-Fi',
    captionPreset: 'BoldYellow',
  },
];

export const FacelessCreatorPage: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  // Wizard Step
  const [step, setStep] = useState<1 | 2 | 3>(1); // 1: Niche & Topic, 2: Script & Scenes, 3: Voice & Style

  // Step 1: Template & Topic
  const [selectedTemplate, setSelectedTemplate] = useState<FacelessTemplate>(NICHE_TEMPLATES[0]);
  const [topicPrompt, setTopicPrompt] = useState<string>('5 brutal truths about life that nobody tells you until your 30s');
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [resolution, setResolution] = useState<Resolution>('1080p');

  // Step 2: Script & AI Scene Breakdown
  const [script, setScript] = useState<string>(
    'Stop waiting for the perfect moment. In 2026, the biggest risk is taking no risks at all. While you overthink, someone else is taking action on your idea. Lesson one: your comfort zone is where dreams go to die. Lesson two: consistency beats talent every single day. Start now, learn on the way, and build your future.'
  );
  const [isAnalyzingScript, setIsAnalyzingScript] = useState<boolean>(false);
  const [scenePlan, setScenePlan] = useState<FacelessScenePlan[]>([]);

  // Step 3: Voice & Audio
  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('adam_deep_male');
  const [backgroundMusic, setBackgroundMusic] = useState<string>('Cinematic Ambient');
  const [autoDucking, setAutoDucking] = useState<boolean>(true);

  // Submission state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Fetch TTS Voices on mount
  useEffect(() => {
    const fetchVoices = async () => {
      try {
        const data = await api.get<TTSVoice[]>('/faceless/tts/voices');
        if (data && data.length > 0) {
          setVoices(data);
          setSelectedVoiceId(data[0].id);
        }
      } catch {
        // Fallback default voice list
        setVoices([
          { id: 'adam_deep_male', name: 'Adam (Deep Baritone)', language: 'en', gender: 'male', provider: 'ElevenLabs' },
          { id: 'rachel_calm_female', name: 'Rachel (Calm & Professional)', language: 'en', gender: 'female', provider: 'ElevenLabs' },
          { id: 'josh_energetic_male', name: 'Josh (High Energy Viral)', language: 'en', gender: 'male', provider: 'OpenAI TTS' },
          { id: 'nova_neutral', name: 'Nova (Neutral & Crisp)', language: 'en', gender: 'neutral', provider: 'OpenAI TTS' },
        ]);
      }
    };
    fetchVoices();
  }, []);

  // AI Script & Scene Analysis
  const handleAnalyzeScript = async () => {
    if (!script.trim()) {
      setErrorMessage('Please provide a script or topic description');
      return;
    }

    try {
      setIsAnalyzingScript(true);
      setErrorMessage('');
      const data = await api.post<FacelessAnalysis>('/faceless/analyze', {
        script,
        templateId: selectedTemplate.id,
      });

      if (data && data.scenes) {
        setScenePlan(data.scenes);
        if (data.suggestedTitle && !videoTitle) {
          setVideoTitle(data.suggestedTitle);
        }
      }
      setStep(2);
    } catch {
      // Fallback local scene breakdown if backend LLM is pending API key
      const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);
      const fallbackScenes: FacelessScenePlan[] = sentences.map((sentence, idx) => ({
        sceneNumber: idx + 1,
        text: sentence,
        visualDescription: `Cinematic footage representing: ${sentence.slice(0, 40)}...`,
        brollKeywords: selectedTemplate.suggestedBrollQuery,
        estimatedDurationSec: Math.max(3, Math.round(sentence.split(/\s+/).length / 2.5)),
      }));
      setScenePlan(fallbackScenes);
      setStep(2);
    } finally {
      setIsAnalyzingScript(false);
    }
  };

  // Launch Generation
  const handleGenerateVideo = async () => {
    if ((user?.creditBalance || 0) < 2) {
      setErrorMessage('Insufficient credits. You need at least 2 credits to generate a faceless video.');
      return;
    }

    try {
      setIsGenerating(true);
      setErrorMessage('');

      const title = videoTitle.trim() || `Faceless Short: ${selectedTemplate.name}`;

      // 1. Create project
      const project = await api.post<Project>('/projects', {
        title,
        creationMode: 'faceless',
        aspectRatio,
        resolution,
        script,
      });

      // 2. Trigger faceless pipeline (TTS + B-roll fetch + captions)
      await api.post(`/faceless/projects/${project._id}/generate`, {
        script,
        templateId: selectedTemplate.id,
        voiceId: selectedVoiceId,
        language: 'en',
        aspectRatio,
        resolution,
        backgroundMusic,
        musicVolume: 15,
        autoDucking,
      });

      await refreshUser();
      // Navigate to the video studio to view/edit multi-track timeline
      navigate(`/projects/${project._id}/editor`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to generate faceless video');
    } finally {
      setIsGenerating(false);
    }
  };

  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const totalEstimatedSec = Math.max(8, Math.round(wordCount / 2.5));

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
            <FileVideo className="w-4 h-4" />
            <span>Module C • Automated Faceless Creator</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            AI Faceless Video Creator
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Transform ideas and viral topics into complete ready-to-post videos. The AI automatically handles scene planning, voiceover narration, stock B-roll matching, and animated karaoke captions.
          </p>
        </div>

        {/* Cost & Balance Badge */}
        <div className="flex items-center gap-3">
          <div className="px-3.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            <span>2 Credits / Short</span>
          </div>
          <div className="text-xs text-slate-400">
            Balance: <strong className="text-white">{user ? formatCredits(user.creditBalance) : 0}</strong>
          </div>
        </div>
      </div>

      {/* Stepper Header */}
      <div className="flex items-center justify-between max-w-xl mx-auto border-b border-white/[0.06] pb-4">
        {[
          { num: 1, title: 'Niche & Topic' },
          { num: 2, title: 'Script & Scenes' },
          { num: 3, title: 'Voice & Generate' },
        ].map((item) => (
          <button
            key={item.num}
            onClick={() => setStep(item.num as any)}
            className={`flex items-center gap-2 text-xs font-bold transition-colors ${
              step === item.num
                ? 'text-amber-400'
                : step > item.num
                ? 'text-emerald-400'
                : 'text-slate-500'
            }`}
          >
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                step === item.num
                  ? 'bg-amber-500 text-black'
                  : step > item.num
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-white/[0.05] text-slate-400'
              }`}
            >
              {step > item.num ? '✓' : item.num}
            </div>
            <span>{item.title}</span>
          </button>
        ))}
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* STEP 1: NICHE TEMPLATES & TOPIC PROMPT */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Step 1 • Choose Viral Niche Template
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {NICHE_TEMPLATES.map((tmpl) => {
                const isSelected = selectedTemplate.id === tmpl.id;
                return (
                  <div
                    key={tmpl.id}
                    onClick={() => {
                      setSelectedTemplate(tmpl);
                      setBackgroundMusic(tmpl.musicTrack);
                    }}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'bg-amber-500/15 border-amber-500 ring-2 ring-amber-500/40'
                        : 'bg-dark-850 border-white/[0.08] hover:border-white/[0.2]'
                    }`}
                  >
                    <div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/[0.05] text-amber-400">
                        {tmpl.category}
                      </span>
                      <h3 className="text-sm font-bold text-white mt-2">{tmpl.name}</h3>
                      <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                        {tmpl.description}
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-white/[0.06] text-[10px] text-slate-500 flex items-center justify-between">
                      <span>Music: {tmpl.musicTrack}</span>
                      {isSelected && <span className="text-amber-400 font-bold">Selected</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Topic & Format Input */}
          <div className="p-6 rounded-3xl bg-dark-850 border border-white/[0.08] space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">
                  Video Topic or Concept Prompt
                </label>
                <input
                  type="text"
                  value={topicPrompt}
                  onChange={(e) => setTopicPrompt(e.target.value)}
                  placeholder="e.g. 5 psychological hacks to win any negotiation"
                  className="w-full bg-dark-900 border border-white/[0.1] rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">
                  Target Platform Aspect Ratio
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Shorts / Reels', ratio: '9:16' as AspectRatio, sub: '9:16 Vertical' },
                    { label: 'YouTube Standard', ratio: '16:9' as AspectRatio, sub: '16:9 Landscape' },
                    { label: 'Square Feed', ratio: '1:1' as AspectRatio, sub: '1:1 Square' },
                  ].map((r) => (
                    <button
                      key={r.ratio}
                      type="button"
                      onClick={() => setAspectRatio(r.ratio)}
                      className={`p-2.5 rounded-xl border text-center transition-all ${
                        aspectRatio === r.ratio
                          ? 'bg-amber-500/15 border-amber-500 text-white font-bold'
                          : 'bg-dark-900 border-white/[0.06] text-slate-400'
                      }`}
                    >
                      <div className="text-xs">{r.label}</div>
                      <div className="text-[10px] text-slate-500">{r.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={handleAnalyzeScript}
                disabled={isAnalyzingScript || !topicPrompt.trim()}
                className="py-3 px-6 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50"
              >
                {isAnalyzingScript ? (
                  <>
                    <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    <span>Analyzing & Outlining Scenes...</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    <span>Structure Script & Scenes &rarr;</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: SCRIPT & SCENE BREAKDOWN */}
      {step === 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="p-6 rounded-3xl bg-dark-850 border border-white/[0.08] space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-amber-400" />
                  <span>Narration Script</span>
                </h3>
                <span className="text-xs text-slate-400 font-mono">
                  {wordCount} words (~{totalEstimatedSec}s)
                </span>
              </div>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={6}
                className="w-full bg-dark-900 border border-white/[0.1] rounded-xl p-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors leading-relaxed"
              />
            </div>

            {/* Generated Scenes List */}
            <div className="p-6 rounded-3xl bg-dark-850 border border-white/[0.08] space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-400" />
                  <span>Structured Scene & Visual Plan ({scenePlan.length} Scenes)</span>
                </h3>
              </div>

              <div className="space-y-3">
                {scenePlan.map((scene, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-2xl bg-dark-900 border border-white/[0.06] space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-amber-400">
                        Scene #{scene.sceneNumber} • ~{scene.estimatedDurationSec}s
                      </span>
                      <span className="text-[10px] text-slate-500">Auto Stock Match</span>
                    </div>
                    <p className="text-xs text-slate-200 italic font-serif">
                      "{scene.text}"
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[10px] text-slate-400 font-semibold">B-Roll Tags:</span>
                      {scene.brollKeywords.map((kw, i) => (
                        <span
                          key={i}
                          className="text-[9px] font-bold px-2 py-0.5 rounded bg-white/[0.05] text-amber-300"
                        >
                          #{kw}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column Action */}
          <div className="space-y-6">
            <div className="p-6 rounded-3xl bg-dark-850 border border-white/[0.08] space-y-6 sticky top-24">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider pb-3 border-b border-white/[0.08]">
                Next: Voice Selection
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Your scene breakdown is ready with {scenePlan.length} synced cuts. Next, choose an AI voiceover actor and background soundtrack.
              </p>
              <button
                onClick={() => setStep(3)}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20"
              >
                <span>Continue to Voice & Audio</span>
                <span>&rarr;</span>
              </button>
              <button
                onClick={() => setStep(1)}
                className="w-full text-center text-xs text-slate-500 hover:text-white"
              >
                &larr; Back to Niche & Topic
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: VOICE & GENERATE */}
      {step === 3 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* Voice Actor Selector */}
            <div className="p-6 rounded-3xl bg-dark-850 border border-white/[0.08] space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-amber-400" />
                <span>Select AI Voice Actor (ElevenLabs / OpenAI TTS)</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {voices.map((v) => {
                  const isSelected = selectedVoiceId === v.id;
                  return (
                    <div
                      key={v.id}
                      onClick={() => setSelectedVoiceId(v.id)}
                      className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-500 ring-2 ring-amber-500/40 text-white'
                          : 'bg-dark-900 border-white/[0.06] text-slate-300 hover:border-white/[0.2]'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-bold">{v.name}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {v.provider} • {v.gender || 'neutral'}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-amber-500 text-black flex items-center justify-center text-xs font-bold">
                          ✓
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Audio & Ducking Controls */}
            <div className="p-6 rounded-3xl bg-dark-850 border border-white/[0.08] space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Music className="w-4 h-4 text-amber-400" />
                <span>Background Soundtrack & Mixing</span>
              </h3>

              <div className="grid grid-cols-2 gap-3">
                {[
                  'Cinematic Ambient',
                  'Dark Synthwave',
                  'Inspiring Lo-Fi',
                  'Epic Orchestral',
                ].map((track) => (
                  <button
                    key={track}
                    type="button"
                    onClick={() => setBackgroundMusic(track)}
                    className={`p-3 rounded-xl border text-center transition-all ${
                      backgroundMusic === track
                        ? 'bg-amber-500/15 border-amber-500 text-white font-bold'
                        : 'bg-dark-900 border-white/[0.06] text-slate-400'
                    }`}
                  >
                    <div className="text-xs">{track}</div>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-white/[0.06] text-xs text-slate-300">
                <div>
                  <span className="font-bold">Intelligent Audio Ducking</span>
                  <p className="text-[10px] text-slate-500">
                    Automatically lower music volume by -18dB whenever speech is present.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={autoDucking}
                  onChange={(e) => setAutoDucking(e.target.checked)}
                  className="w-4 h-4 rounded border-amber-400 text-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Right Column: Final Launch Summary */}
          <div className="space-y-6">
            <div className="p-6 rounded-3xl bg-dark-850 border border-white/[0.08] space-y-6 sticky top-24">
              <div className="pb-3 border-b border-white/[0.08] flex items-center justify-between">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Ready to Render
                </h3>
                <span className="text-xs font-bold text-amber-400 px-2 py-0.5 rounded-full bg-amber-500/15">
                  Faceless
                </span>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between text-slate-400">
                  <span>Template:</span>
                  <span className="font-bold text-white">{selectedTemplate.name}</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Aspect Ratio:</span>
                  <span className="font-bold text-white font-mono">{aspectRatio}</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Scenes:</span>
                  <span className="font-bold text-white">{scenePlan.length || 4} Scenes</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Captions:</span>
                  <span className="font-bold text-emerald-400">Animated Karaoke</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Credit Cost:</span>
                  <span className="font-bold text-amber-400 flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5 fill-amber-400" />
                    2 Credits
                  </span>
                </div>
              </div>

              <div className="pt-4 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={handleGenerateVideo}
                  disabled={isGenerating}
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-extrabold text-sm shadow-xl shadow-amber-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  {isGenerating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                      <span>Synthesizing Voice & B-Roll...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Generate Faceless Video</span>
                    </>
                  )}
                </button>
                <p className="text-[11px] text-slate-500 text-center mt-2">
                  Rendered in ~25s. You can fine-tune every frame in the Video Studio.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FacelessCreatorPage;
