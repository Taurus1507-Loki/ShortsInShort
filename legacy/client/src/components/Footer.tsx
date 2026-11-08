import React from 'react';
import { Link } from 'react-router-dom';
import { Video, ShieldCheck, Heart, Sparkles } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-dark-900 border-t border-white/[0.08] pt-16 pb-12 text-slate-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-10 pb-12 border-b border-white/[0.06]">
          {/* Col 1: Brand & Bio */}
          <div className="md:col-span-2 space-y-4">
            <Link to="/" className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-brand-600 to-pink-500 flex items-center justify-center">
                <Video className="w-4 h-4 text-white" />
              </div>
              <span className="font-extrabold text-xl tracking-tight text-white">
                Shorts<span className="text-brand-400">InShort</span>
              </span>
            </Link>
            <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
              Your Script. Your AI Editor. Your Video. Done. Transform raw footage, scripts, or authorized digital avatars into high-converting viral videos 10x faster.
            </p>
            <div className="flex items-center gap-2 text-xs text-slate-500 pt-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Razorpay Verified · Indian Rupee (INR) Pricing · Commercial License</span>
            </div>
          </div>

          {/* Col 2: Products */}
          <div>
            <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Core Modules</h4>
            <ul className="space-y-2.5 text-sm">
              <li><a href="#features" className="hover:text-brand-400 transition-colors">AI Video Editor</a></li>
              <li><a href="#features" className="hover:text-brand-400 transition-colors">AI Digital Avatar</a></li>
              <li><a href="#features" className="hover:text-brand-400 transition-colors">Faceless Video Maker</a></li>
              <li><a href="#features" className="hover:text-brand-400 transition-colors">Silence & Pause Trimmer</a></li>
              <li><a href="#features" className="hover:text-brand-400 transition-colors">Karaoke Subtitles</a></li>
            </ul>
          </div>

          {/* Col 3: Resources */}
          <div>
            <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Platforms</h4>
            <ul className="space-y-2.5 text-sm">
              <li><span className="text-slate-400">Instagram Reels (9:16)</span></li>
              <li><span className="text-slate-400">YouTube Shorts (9:16)</span></li>
              <li><span className="text-slate-400">TikTok Shorts (9:16)</span></li>
              <li><span className="text-slate-400">YouTube Landscape (16:9)</span></li>
              <li><span className="text-slate-400">Instagram Square & Feed (1:1)</span></li>
            </ul>
          </div>

          {/* Col 4: Legal & Ethics */}
          <div>
            <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Legal & Ethics</h4>
            <ul className="space-y-2.5 text-sm">
              <li><a href="#terms" className="hover:text-brand-400 transition-colors">Terms of Service</a></li>
              <li><a href="#privacy" className="hover:text-brand-400 transition-colors">Privacy Policy</a></li>
              <li><a href="#refund" className="hover:text-brand-400 transition-colors">Refund & Credit Policy</a></li>
              <li><a href="#consent" className="hover:text-brand-400 transition-colors">AI Likeness & Consent</a></li>
              <li><a href="#disclosures" className="hover:text-brand-400 transition-colors">Commercial Licensing</a></li>
            </ul>
          </div>
        </div>

        {/* Bottom row */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-4">
          <p>© {new Date().getFullYear()} ShortsInShort Technologies Pvt. Ltd. All rights reserved.</p>
          <p className="flex items-center gap-1.5">
            Engineered with <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" /> for digital creators and growth agencies.
          </p>
        </div>
      </div>
    </footer>
  );
};

