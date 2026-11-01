import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { Navbar } from '../components/Navbar.js';
import { Footer } from '../components/Footer.js';
import {
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Play,
  Volume2,
  Scissors,
  Wand2,
  UserCheck,
  FileVideo,
  Layers,
  Zap,
  TrendingUp,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export const LandingPage: React.FC = () => {
  const { loginDemoUser, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [activeTab, setActiveTab] = useState<'editor' | 'avatar' | 'faceless'>('editor');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const handleStartFree = async () => {
    if (isAuthenticated) {
      navigate('/dashboard');
    } else {
      await loginDemoUser();
      navigate('/dashboard');
    }
  };

  const faqs = [
    {
      q: 'How does the AI Video Editor remove pauses and silences?',
      a: 'ShortsInShort runs an intelligent decibel & waveform analysis filter using FFmpeg and acoustic energy detection. It detects dead air and non-speech gaps longer than 450ms and applies frame-accurate cuts, condensing your talking-head footage into a fast-paced viral rhythm.',
    },
    {
      q: 'Are the AI Avatars legally compliant and authorized?',
      a: 'Yes, 100%. Unlike unauthorized deepfake software, ShortsInShort requires explicit biometric consent records and ownership verification before any likeness or voice clone is synthesized. We partner exclusively with certified, ethical AI providers.',
    },
    {
      q: 'How does billing work and is payment supported in Indian Rupees (INR)?',
      a: 'Yes, Indian Rupees (INR) is our primary billing currency. We integrate seamlessly with Razorpay to support UPI (Google Pay, PhonePe, Paytm), Net Banking, Credit/Debit cards, and Corporate GST invoices.',
    },
    {
      q: 'Can I export in 1080p and 4K without ShortsInShort watermarks?',
      a: 'Yes! All paid plans (Starter, Creator, Pro, and Agency) include full watermark-free exports in 1080p Full HD, with 4K Ultra-HD available on Pro and Agency plans.',
    },
    {
      q: 'What happens if a video rendering job fails or has an error?',
      a: 'Our background rendering engine is built with automated idempotency and a Dead-Letter Queue. If an AI provider or video transcode job encounters an issue, the exact credit amount is immediately and automatically refunded back to your ledger.',
    },
  ];

  return (
    <div className="min-h-screen bg-dark-900 text-slate-100 flex flex-col">
      <Navbar />

      {/* Hero Section */}
      <section className="relative pt-20 pb-28 overflow-hidden">
        {/* Glow Effects */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-gradient-to-tr from-brand-600/20 via-pink-600/20 to-purple-800/10 rounded-full blur-[140px] pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          {/* Top Pill */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] backdrop-blur-md mb-8 hover:border-brand-500/40 transition-all">
            <span className="flex h-2 w-2 rounded-full bg-brand-400 animate-pulse" />
            <span className="text-xs font-semibold text-slate-300">
              ShortsInShort 2.0 AI Video Engine Released
            </span>
            <span className="text-brand-400 text-xs font-bold">&rarr;</span>
          </div>

          {/* Main Headline */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white max-w-5xl mx-auto leading-[1.1] mb-6">
            Your Script. Your AI Editor.{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 via-pink-400 to-amber-300">
              Your Video. Done.
            </span>
          </h1>

          {/* Subheadline */}
          <p className="text-lg sm:text-xl text-slate-400 max-w-3xl mx-auto mb-10 leading-relaxed font-normal">
            Create professional Instagram Reels, YouTube Shorts, and videos in minutes with AI. No editing skills. No expensive editors. Just upload, generate, and publish.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto mb-16">
            <button
              onClick={handleStartFree}
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-brand-600 via-pink-600 to-brand-500 hover:from-brand-500 hover:to-pink-500 text-white font-bold text-base shadow-xl shadow-brand-600/30 transition-all hover:scale-[1.02] flex items-center justify-center gap-2.5"
            >
              <Sparkles className="w-5 h-5 text-amber-300" />
              <span>Start Creating Free</span>
              <ArrowRight className="w-5 h-5" />
            </button>

            <a
              href="#demo-player"
              className="w-full sm:w-auto px-6 py-4 rounded-2xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] text-white font-semibold text-base transition-all flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4 text-brand-400 fill-brand-400" />
              <span>Live Interactive Demo</span>
            </a>
          </div>

          {/* Trust Badges */}
          <div className="flex flex-wrap items-center justify-center gap-8 text-xs font-semibold text-slate-400 border-t border-white/[0.06] pt-8 max-w-3xl mx-auto">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>50 Free Welcome Credits</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Submagic-Grade Animated Captions</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Automatic Silence Removal</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>UPI & Card Payments via Razorpay</span>
            </div>
          </div>
        </div>

        {/* Interactive Video Editor Showcase Preview */}
        <div id="demo-player" className="max-w-5xl mx-auto px-4 mt-16 relative z-10">
          <div className="p-3 sm:p-5 rounded-3xl bg-dark-850/90 border border-white/[0.12] shadow-2xl backdrop-blur-xl">
            {/* Top window controls */}
            <div className="flex items-center justify-between pb-4 border-b border-white/[0.06] mb-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-rose-500/80" />
                <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                <span className="text-xs font-medium text-slate-400 ml-2">ShortsInShort Studio — Project Preview</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30">
                  9:16 Vertical Reel
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  1080x1920 HD
                </span>
              </div>
            </div>

            {/* Simulated Video Workspace */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              {/* Left: 9:16 Short Preview Canvas */}
              <div className="lg:col-span-5 flex justify-center">
                <div className="w-[280px] h-[497px] rounded-2xl bg-gradient-to-b from-slate-900 via-dark-800 to-black border-2 border-brand-500/40 relative overflow-hidden shadow-2xl flex flex-col justify-between p-4">
                  {/* Subtle video background overlay */}
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-brand-900/30 via-slate-950/70 to-black z-0" />

                  {/* Top Bar inside Reel */}
                  <div className="relative z-10 flex items-center justify-between text-white text-xs">
                    <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2 py-1 rounded-md">
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                      <span className="font-bold text-[10px]">AI ZOOM 1.2x</span>
                    </div>
                    <span className="text-[10px] text-slate-300 font-mono">00:14 / 00:58</span>
                  </div>

                  {/* Center Speaker Graphic Representation */}
                  <div className="relative z-10 flex flex-col items-center justify-center my-auto space-y-4">
                    <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-brand-600 to-pink-500 p-1 shadow-2xl shadow-brand-500/50 animate-bounce-subtle">
                      <div className="w-full h-full rounded-full bg-dark-900 flex items-center justify-center overflow-hidden">
                        <img
                          src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80"
                          alt="Speaker Avatar"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>

                    {/* Animated Karaoke Subtitle Demo (Submagic Style) */}
                    <div className="text-center px-2 py-1.5 rounded-xl bg-black/75 backdrop-blur-md border border-white/[0.1] shadow-2xl">
                      <p className="text-base font-extrabold tracking-tight uppercase leading-snug">
                        <span className="text-white">THIS SIMPLE </span>
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-400 underline decoration-yellow-400 decoration-2">
                          AI WORKFLOW
                        </span>
                        <span className="text-white"> SAVES </span>
                        <span className="text-brand-400 font-black text-lg">10 HOURS</span>
                        <span className="text-white"> A WEEK! 🚀</span>
                      </p>
                    </div>

                    {/* Dynamic B-Roll Overlay badge */}
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/20 border border-brand-500/40 text-[10px] font-bold text-brand-300">
                      <Layers className="w-3 h-3" />
                      <span>B-Roll: SaaS Dashboard Growth Chart</span>
                    </div>
                  </div>

                  {/* Bottom sound wave */}
                  <div className="relative z-10 space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
                      <span className="flex items-center gap-1">
                        <Volume2 className="w-3 h-3 text-brand-400" />
                        <span>Lofi Chill Ducked (-18dB)</span>
                      </span>
                      <span className="text-emerald-400">Silences Removed: 14</span>
                    </div>
                    {/* Simulated sound bar */}
                    <div className="flex items-end gap-0.5 h-6 w-full justify-between overflow-hidden">
                      {Array.from({ length: 32 }).map((_, i) => (
                        <div
                          key={i}
                          className="w-1.5 bg-gradient-to-t from-brand-500 to-pink-400 rounded-full"
                          style={{
                            height: `${Math.max(15, (Math.sin(i * 0.7) * 0.5 + 0.5) * 100)}%`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: AI Editing Timeline & Inspection Controls */}
              <div className="lg:col-span-7 space-y-4 text-left">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-white">Automated Post-Production Pipeline</h3>
                    <p className="text-xs text-slate-400">All applied automatically in under 45 seconds</p>
                  </div>
                  <button
                    onClick={handleStartFree}
                    className="px-4 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold transition-all shadow-md shadow-brand-600/30"
                  >
                    Open Studio
                  </button>
                </div>

                {/* Features Pipeline List */}
                <div className="space-y-2.5">
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-brand-500/10 text-brand-400">
                        <Scissors className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">Smart Silence & Pause Trimmer</div>
                        <div className="text-xs text-slate-400">Eliminated 4.2 seconds of dead pauses automatically</div>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-emerald-400">Applied</span>
                  </div>

                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-pink-500/10 text-pink-400">
                        <Wand2 className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">Submagic-Style Karaoke Captions</div>
                        <div className="text-xs text-slate-400">Word-level timing with neon yellow & fuchsia highlights</div>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-emerald-400">Applied</span>
                  </div>

                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                        <Layers className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">Semantic B-Roll Footage Insertion</div>
                        <div className="text-xs text-slate-400">Auto-matched 3 royalty-free clips from visual cues</div>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-emerald-400">Applied</span>
                  </div>

                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                        <Volume2 className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">Background Music Auto-Ducking</div>
                        <div className="text-xs text-slate-400">Volume dynamically drops when voice narration speaks</div>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-emerald-400">Applied</span>
                  </div>
                </div>

                {/* Performance stat pill */}
                <div className="p-3 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-between text-xs text-brand-300">
                  <span className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400 fill-amber-400" />
                    <strong>Estimated Human Editor Time:</strong> 120 mins
                  </span>
                  <span><strong>ShortsInShort Render:</strong> 38 seconds</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3 Core Creation Modules Tabs */}
      <section id="features" className="py-24 bg-dark-850/60 border-y border-white/[0.08]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">
              Three Powerful AI Video Creation Modes
            </h2>
            <p className="text-base text-slate-400">
              Whether you have raw video footage, just a script, or need a photo-realistic digital twin, ShortsInShort automates the complete production lifecycle.
            </p>
          </div>

          {/* Module Selector Tabs */}
          <div className="flex justify-center mb-12">
            <div className="p-1.5 rounded-2xl bg-dark-900 border border-white/[0.1] inline-flex gap-2">
              <button
                onClick={() => setActiveTab('editor')}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all ${
                  activeTab === 'editor'
                    ? 'bg-gradient-to-r from-brand-600 to-pink-600 text-white shadow-lg shadow-brand-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Scissors className="w-4 h-4" />
                <span>1. AI Video Editor</span>
              </button>

              <button
                onClick={() => setActiveTab('avatar')}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all ${
                  activeTab === 'avatar'
                    ? 'bg-gradient-to-r from-brand-600 to-pink-600 text-white shadow-lg shadow-brand-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <UserCheck className="w-4 h-4" />
                <span>2. AI Avatar Studio</span>
              </button>

              <button
                onClick={() => setActiveTab('faceless')}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all ${
                  activeTab === 'faceless'
                    ? 'bg-gradient-to-r from-brand-600 to-pink-600 text-white shadow-lg shadow-brand-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileVideo className="w-4 h-4" />
                <span>3. Faceless Video Maker</span>
              </button>
            </div>
          </div>

          {/* Tab Content Cards */}
          <div className="max-w-4xl mx-auto">
            {activeTab === 'editor' && (
              <div className="p-8 rounded-3xl bg-dark-900 border border-white/[0.08] shadow-xl grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                <div className="space-y-4">
                  <div className="inline-block px-3 py-1 rounded-full bg-brand-500/10 text-brand-400 text-xs font-bold uppercase tracking-wider">
                    Module A — Raw Footage to Viral Short
                  </div>
                  <h3 className="text-2xl font-bold text-white">
                    Edit Raw Video Like a Professional Studio Editor
                  </h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Upload talking head clips from your phone or camera. ShortsInShort extracts audio, transcribes every word with millisecond precision, trims dead pauses, adds Submagic-grade captions, overlays B-roll footage, and adds energetic background beats.
                  </p>
                  <ul className="space-y-2 text-xs text-slate-300">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-brand-400" />
                      <span>Automatic silence removal (threshold & duration customizable)</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-brand-400" />
                      <span>Dynamic zoom-in / zoom-out transitions for hook retention</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-brand-400" />
                      <span>Auto aspect ratio conversion for 9:16 Reels and 16:9 YouTube</span>
                    </li>
                  </ul>
                </div>
                <div className="rounded-2xl overflow-hidden border border-white/[0.1] bg-dark-850 p-4">
                  <img
                    src="https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=600&auto=format&fit=crop&q=80"
                    alt="Video Editing UI"
                    className="rounded-xl w-full h-64 object-cover"
                  />
                </div>
              </div>
            )}

            {activeTab === 'avatar' && (
              <div className="p-8 rounded-3xl bg-dark-900 border border-white/[0.1] shadow-xl grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                <div className="space-y-4">
                  <div className="inline-block px-3 py-1 rounded-full bg-pink-500/10 text-pink-400 text-xs font-bold uppercase tracking-wider">
                    Module B — Authorized Digital Avatars
                  </div>
                  <h3 className="text-2xl font-bold text-white">
                    Your Digital Clone. Natural Lip-Sync & Multilingual Voice.
                  </h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Never worry about filming setups, lighting, or makeup. Create videos with an authorized photorealistic digital avatar that speaks your script naturally. Fully audited with biometric consent logging.
                  </p>
                  <ul className="space-y-2 text-xs text-slate-300">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-pink-400" />
                      <span>Single photo + 30-sec voice verification for digital likeness</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-pink-400" />
                      <span>Multilingual dubbing in 28+ global languages</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-pink-400" />
                      <span>Portrait 9:16 and Landscape 16:9 avatar rendering</span>
                    </li>
                  </ul>
                </div>
                <div className="rounded-2xl overflow-hidden border border-white/[0.1] bg-dark-850 p-4">
                  <img
                    src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&auto=format&fit=crop&q=80"
                    alt="AI Avatar Studio"
                    className="rounded-xl w-full h-64 object-cover"
                  />
                </div>
              </div>
            )}

            {activeTab === 'faceless' && (
              <div className="p-8 rounded-3xl bg-dark-900 border border-white/[0.1] shadow-xl grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                <div className="space-y-4">
                  <div className="inline-block px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-bold uppercase tracking-wider">
                    Module C — Zero-Face Video Generation
                  </div>
                  <h3 className="text-2xl font-bold text-white">
                    Enter a Topic or Script. Receive a Viral Faceless Video.
                  </h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Ideal for motivational channels, financial explainers, stoic quotes, and TikTok viral accounts. The AI engine writes or splits your script into punchy scenes, generates studio-grade narration, pairs high-res B-roll clips, and adds animated captions.
                  </p>
                  <ul className="space-y-2 text-xs text-slate-300">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-amber-400" />
                      <span>Pre-built viral templates: Motivational, Finance, Tech, Facts</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-amber-400" />
                      <span>Integrated with ElevenLabs & OpenAI TTS voice narrators</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-amber-400" />
                      <span>Commercial CC0 royalty-free footage included</span>
                    </li>
                  </ul>
                </div>
                <div className="rounded-2xl overflow-hidden border border-white/[0.1] bg-dark-850 p-4">
                  <img
                    src="https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop&q=80"
                    alt="Faceless Creator Tech"
                    className="rounded-xl w-full h-64 object-cover"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">
              From Raw Script to Viral Short in 4 Steps
            </h2>
            <p className="text-base text-slate-400">
              No complex timelines. No keyframing. Just upload, tweak preferences, and let the AI render.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="p-6 rounded-2xl bg-dark-850 border border-white/[0.08] relative">
              <span className="text-4xl font-black text-white/10 absolute top-4 right-4">01</span>
              <div className="w-10 h-10 rounded-xl bg-brand-500/20 text-brand-400 flex items-center justify-center font-bold mb-4">
                1
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Select Video Mode</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Choose between AI Video Editor (raw footage), AI Avatar (digital presenter), or Faceless Shorts.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-dark-850 border border-white/[0.08] relative">
              <span className="text-4xl font-black text-white/10 absolute top-4 right-4">02</span>
              <div className="w-10 h-10 rounded-xl bg-pink-500/20 text-pink-400 flex items-center justify-center font-bold mb-4">
                2
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Upload Assets</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Provide your raw phone recording, or enter a text script/topic outline.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-dark-850 border border-white/[0.08] relative">
              <span className="text-4xl font-black text-white/10 absolute top-4 right-4">03</span>
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold mb-4">
                3
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Configure Style</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Pick your caption colors, silence trimming sensitivity, B-roll density, and brand colors.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-dark-850 border border-white/[0.08] relative">
              <span className="text-4xl font-black text-white/10 absolute top-4 right-4">04</span>
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold mb-4">
                4
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Export & Publish</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Download your frame-accurate 1080p/4K MP4 ready for Instagram Reels, YouTube, and TikTok.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section (INR Currency) */}
      <section id="pricing" className="py-24 bg-dark-850/60 border-t border-white/[0.08]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <span className="px-3 py-1 rounded-full bg-brand-500/10 text-brand-400 text-xs font-bold uppercase tracking-wider">
              Transparent Indian Rupee (INR) Pricing
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mt-3 mb-4">
              Simple, Affordable Pricing for Every Creator
            </h2>
            <p className="text-base text-slate-400">
              Save up to 90% compared to hiring professional video editors. Upgrade, downgrade, or cancel anytime.
            </p>

            {/* Billing cycle toggle */}
            <div className="flex items-center justify-center gap-3 mt-8">
              <span className={`text-sm font-semibold ${billingCycle === 'monthly' ? 'text-white' : 'text-slate-500'}`}>
                Monthly Billing
              </span>
              <button
                onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'annual' : 'monthly')}
                className="w-12 h-6 rounded-full bg-brand-600/30 border border-brand-500/50 p-1 flex items-center transition-all"
              >
                <div
                  className={`w-4 h-4 rounded-full bg-brand-400 transition-all ${
                    billingCycle === 'annual' ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className={`text-sm font-semibold flex items-center gap-1.5 ${billingCycle === 'annual' ? 'text-white' : 'text-slate-500'}`}>
                <span>Annual Billing</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                  Save 20%
                </span>
              </span>
            </div>
          </div>

          {/* Pricing Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
            {/* Free Plan */}
            <div className="p-6 rounded-3xl bg-dark-900 border border-white/[0.08] flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Free Starter</h3>
                <p className="text-xs text-slate-400 mt-1 mb-4">Test video engine capabilities</p>
                <div className="text-3xl font-extrabold text-white mb-1">₹0</div>
                <div className="text-xs text-slate-500 mb-6">Forever free</div>
                <ul className="space-y-2.5 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>10 Credits</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>720p Video Exports</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>Basic Caption Styles</span>
                  </li>
                  <li className="flex items-center gap-2 text-slate-500">
                    <span>ShortsInShort Watermark</span>
                  </li>
                </ul>
              </div>
              <button
                onClick={handleStartFree}
                className="mt-8 w-full py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white text-xs font-bold transition-colors"
              >
                Start Free
              </button>
            </div>

            {/* Starter Plan */}
            <div className="p-6 rounded-3xl bg-dark-900 border border-white/[0.08] flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Starter</h3>
                <p className="text-xs text-slate-400 mt-1 mb-4">For solo content creators</p>
                <div className="text-3xl font-extrabold text-white mb-1">
                  {billingCycle === 'monthly' ? '₹499' : '₹399'}
                </div>
                <div className="text-xs text-slate-500 mb-6">per month, billed {billingCycle}</div>
                <ul className="space-y-2.5 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>20 Credits / Month</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>1080p Full HD Exports</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>No Watermark</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>Automatic Silence Trimmer</span>
                  </li>
                </ul>
              </div>
              <Link
                to="/billing"
                className="mt-8 w-full py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white text-xs font-bold transition-colors text-center block"
              >
                Choose Starter
              </Link>
            </div>

            {/* Creator Plan (Most Popular) */}
            <div className="p-6 rounded-3xl bg-gradient-to-b from-brand-900/40 via-dark-900 to-dark-900 border-2 border-brand-500 flex flex-col justify-between relative shadow-xl shadow-brand-500/20">
              <span className="text-[10px] font-extrabold px-3 py-1 rounded-full bg-gradient-to-r from-brand-500 to-pink-500 text-white uppercase tracking-wider absolute -top-3 left-1/2 -translate-x-1/2 shadow-md">
                Most Popular
              </span>
              <div>
                <h3 className="text-base font-bold text-white">Creator</h3>
                <p className="text-xs text-slate-400 mt-1 mb-4">Reels & TikTok power users</p>
                <div className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-pink-400 mb-1">
                  {billingCycle === 'monthly' ? '₹999' : '₹799'}
                </div>
                <div className="text-xs text-slate-500 mb-6">per month, billed {billingCycle}</div>
                <ul className="space-y-2.5 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span className="font-semibold text-white">50 Credits / Month</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>AI Avatar Studio Access</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>Submagic Animated Captions</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>B-Roll & Sound FX Ducking</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>Custom Brand Kit</span>
                  </li>
                </ul>
              </div>
              <Link
                to="/billing"
                className="mt-8 w-full py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-pink-600 hover:from-brand-500 hover:to-pink-500 text-white text-xs font-bold transition-all shadow-md shadow-brand-600/30 text-center block"
              >
                Get Creator Plan
              </Link>
            </div>

            {/* Pro Plan */}
            <div className="p-6 rounded-3xl bg-dark-900 border border-white/[0.08] flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Pro Studio</h3>
                <p className="text-xs text-slate-400 mt-1 mb-4">For studios & active channels</p>
                <div className="text-3xl font-extrabold text-white mb-1">
                  {billingCycle === 'monthly' ? '₹1,999' : '₹1,599'}
                </div>
                <div className="text-xs text-slate-500 mb-6">per month, billed {billingCycle}</div>
                <ul className="space-y-2.5 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>120 Credits / Month</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>4K Ultra-HD Export</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>Priority GPU Rendering Queue</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>3 Brand Kits & 5 Team Seats</span>
                  </li>
                </ul>
              </div>
              <Link
                to="/billing"
                className="mt-8 w-full py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white text-xs font-bold transition-colors text-center block"
              >
                Choose Pro
              </Link>
            </div>

            {/* Agency Plan */}
            <div className="p-6 rounded-3xl bg-dark-900 border border-white/[0.08] flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Agency</h3>
                <p className="text-xs text-slate-400 mt-1 mb-4">Client management & scale</p>
                <div className="text-3xl font-extrabold text-white mb-1">
                  {billingCycle === 'monthly' ? '₹4,999' : '₹3,999'}
                </div>
                <div className="text-xs text-slate-500 mb-6">per month, billed {billingCycle}</div>
                <ul className="space-y-2.5 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>350 Credits / Month</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>Multiple Client Workspaces</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>15 Team Members</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                    <span>Dedicated Render Node</span>
                  </li>
                </ul>
              </div>
              <Link
                to="/billing"
                className="mt-8 w-full py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white text-xs font-bold transition-colors text-center block"
              >
                Choose Agency
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-3">
              Frequently Asked Questions
            </h2>
            <p className="text-slate-400 text-sm">
              Everything you need to know about ShortsInShort AI video creation.
            </p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, idx) => (
              <div
                key={idx}
                className="rounded-2xl bg-dark-850 border border-white/[0.08] overflow-hidden transition-all"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                  className="w-full p-5 text-left flex items-center justify-between text-white font-semibold text-sm hover:text-brand-300 transition-colors"
                >
                  <span>{faq.q}</span>
                  {openFaq === idx ? (
                    <ChevronUp className="w-4 h-4 text-brand-400 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  )}
                </button>
                {openFaq === idx && (
                  <div className="p-5 pt-0 text-xs sm:text-sm text-slate-400 leading-relaxed border-t border-white/[0.04]">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section className="py-20 relative overflow-hidden bg-gradient-to-r from-brand-950 via-dark-850 to-brand-950 border-t border-white/[0.08]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">
            Ready to Create Viral Shorts in Under 60 Seconds?
          </h2>
          <p className="text-slate-300 max-w-2xl mx-auto mb-8 text-sm sm:text-base">
            Join thousands of modern creators, marketers, and agencies saving 10+ hours on video editing every week.
          </p>
          <button
            onClick={handleStartFree}
            className="px-8 py-4 rounded-2xl bg-gradient-to-r from-brand-500 to-pink-500 hover:from-brand-400 hover:to-pink-400 text-white font-bold text-base shadow-xl shadow-brand-500/25 transition-all inline-flex items-center gap-2"
          >
            <Sparkles className="w-5 h-5 text-amber-300" />
            <span>Create Your First Video Now</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </section>

      <Footer />
    </div>
  );
};

