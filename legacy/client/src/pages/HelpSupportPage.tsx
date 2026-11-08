import React, { useState } from 'react';
import {
  HelpCircle,
  Keyboard,
  FileQuestion,
  MessageSquare,
  Sparkles,
  Zap,
  Film,
  UserCheck,
  FileVideo,
  Check,
  Send,
} from 'lucide-react';

const KEYBOARD_SHORTCUTS = [
  { key: 'Delete / Backspace', action: 'Delete selected scene, caption word, B-roll overlay, or audio track' },
  { key: 'Escape', action: 'Deselect the active track item and return focus to main studio' },
  { key: 'Space', action: 'Toggle video playback (Play / Pause)' },
  { key: 'Enter / Space', action: 'Select focused timeline track block' },
  { key: 'Arrow Left / Right', action: 'Frame scrub / seek 1 second backward or forward' },
  { key: 'M', action: 'Toggle background audio mute' },
];

const FAQS = [
  {
    q: 'How are video generation credits deducted?',
    a: 'Each video creation module has transparent pricing: AI Video Editor (1 Credit / short), Faceless Video Generator (2 Credits / short), and AI Avatar Digital Twin (3 Credits / short). Credits are deducted atomically, and if any render or AI API call fails, your credits are refunded automatically.',
  },
  {
    q: 'How does multi-track timeline deletion work?',
    a: 'Simply click on any scene cut, subtitle word block, B-roll media overlay, or the audio track. The item will highlight in amber or rose. Press the [Delete] or [Backspace] key on your keyboard (or click the "Delete Selected" button) to instantly remove it from the project.',
  },
  {
    q: 'What are the legal requirements for creating an AI Avatar?',
    a: 'ShortsInShort strictly prohibits non-consensual deepfakes and impersonation. When creating an avatar, you must upload your own photograph, provide a clear voice sample, and certify legal authorization. An immutable audit trail with IP address and timestamp is recorded for compliance.',
  },
  {
    q: 'What video aspect ratios are supported?',
    a: 'We support all major social platforms: 9:16 Vertical (Instagram Reels, YouTube Shorts, TikTok), 16:9 Widescreen (YouTube long-form, LinkedIn), 1:1 Square (Instagram Feed), and 4:5 Portrait (Facebook / Instagram Feed). Resolution options include 720p, 1080p Full HD, and 4K.',
  },
  {
    q: 'How does intelligent audio ducking work?',
    a: 'Our audio mixing engine dynamically analyzes the speech transcription timeline. Whenever the speaker is talking, background music is automatically attenuated by -18dB. During natural pauses, music volume smoothly swells back to normal.',
  },
];

export const HelpSupportPage: React.FC = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [supportName, setSupportName] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [ticketSubmitted, setTicketSubmitted] = useState(false);

  const handleSupportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supportMessage.trim()) return;
    setTicketSubmitted(true);
    setTimeout(() => {
      setSupportMessage('');
      setTicketSubmitted(false);
    }, 4000);
  };

  return (
    <div className="space-y-10 max-w-5xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2 text-brand-400 text-xs font-bold uppercase tracking-wider mb-1">
            <HelpCircle className="w-4 h-4" />
            <span>Knowledge Base & Support</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            Help Center & Video Studio Guide
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Everything you need to master ShortsInShort: timeline shortcuts, editing workflows, and priority customer assistance.
          </p>
        </div>
      </div>

      {/* Keyboard Shortcuts Section */}
      <div className="p-6 rounded-3xl bg-dark-850 border border-white/[0.08] space-y-4">
        <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
          <Keyboard className="w-4 h-4" />
          <span>Multi-Track Timeline Shortcuts</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
          {KEYBOARD_SHORTCUTS.map((item, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-2xl bg-dark-900 border border-white/[0.06] flex items-center justify-between gap-4"
            >
              <span className="text-xs text-slate-300 font-medium">{item.action}</span>
              <kbd className="px-2.5 py-1 rounded-lg bg-white/[0.08] border border-white/[0.15] text-[11px] font-mono font-bold text-amber-300 whitespace-nowrap shadow">
                {item.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>

      {/* Frequently Asked Questions */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          <FileQuestion className="w-4 h-4 text-brand-400" />
          <span>Frequently Asked Questions</span>
        </div>

        <div className="space-y-3">
          {FAQS.map((faq, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div
                key={idx}
                className="p-5 rounded-2xl bg-dark-850 border border-white/[0.08] transition-all"
              >
                <button
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  className="w-full flex items-center justify-between text-left text-sm font-bold text-white hover:text-brand-300 transition-colors"
                >
                  <span>{faq.q}</span>
                  <span className="text-brand-400 ml-4">{isOpen ? '−' : '+'}</span>
                </button>
                {isOpen && (
                  <p className="text-xs text-slate-400 mt-3 leading-relaxed border-t border-white/[0.06] pt-3">
                    {faq.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Contact Support Form */}
      <div className="p-8 rounded-3xl bg-dark-850 border border-white/[0.08] space-y-6">
        <div className="flex items-center gap-2 text-pink-400 text-xs font-bold uppercase tracking-wider">
          <MessageSquare className="w-4 h-4" />
          <span>Need Additional Help? Open a Support Ticket</span>
        </div>

        {ticketSubmitted ? (
          <div className="p-6 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-3">
            <Check className="w-5 h-5 text-emerald-400" />
            <span>Thank you! Your ticket has been received. Our video engineering team will reply within 4 hours.</span>
          </div>
        ) : (
          <form onSubmit={handleSupportSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">Your Name</label>
                <input
                  type="text"
                  value={supportName}
                  onChange={(e) => setSupportName(e.target.value)}
                  placeholder="e.g. Vikram Sharma"
                  className="w-full bg-dark-900 border border-white/[0.1] rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">Email Address</label>
                <input
                  type="email"
                  value={supportEmail}
                  onChange={(e) => setSupportEmail(e.target.value)}
                  placeholder="e.g. vikram@creator.com"
                  className="w-full bg-dark-900 border border-white/[0.1] rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-brand-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">Describe your issue or feature request</label>
              <textarea
                value={supportMessage}
                onChange={(e) => setSupportMessage(e.target.value)}
                rows={4}
                placeholder="Let us know how we can help you with your video generation or export..."
                className="w-full bg-dark-900 border border-white/[0.1] rounded-xl p-3 text-xs text-white focus:outline-none focus:border-brand-500 resize-none leading-relaxed"
              />
            </div>

            <button
              type="submit"
              className="py-2.5 px-6 rounded-xl bg-gradient-to-r from-brand-600 to-pink-600 hover:from-brand-500 hover:to-pink-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-brand-600/20 transition-all"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit Support Request</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default HelpSupportPage;

