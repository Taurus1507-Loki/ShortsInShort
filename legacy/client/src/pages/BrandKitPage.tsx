import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import { Palette, Check, Save, Sparkles, Image as ImageIcon } from 'lucide-react';

export const BrandKitPage: React.FC = () => {
  const { user, refreshUser } = useAuth();

  const [primaryColor, setPrimaryColor] = useState('#d946ef');
  const [secondaryColor, setSecondaryColor] = useState('#3b82f6');
  const [fontFamily, setFontFamily] = useState('Plus Jakarta Sans');
  const [captionStyle, setCaptionStyle] = useState('karaoke_neon');
  const [watermarkUrl, setWatermarkUrl] = useState('');
  const [watermarkPosition, setWatermarkPosition] = useState<'top_left' | 'top_right' | 'bottom_left' | 'bottom_right'>('top_right');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (user?.brandKit) {
      if (user.brandKit.primaryColor) setPrimaryColor(user.brandKit.primaryColor);
      if (user.brandKit.secondaryColor) setSecondaryColor(user.brandKit.secondaryColor);
      if (user.brandKit.fontFamily) setFontFamily(user.brandKit.fontFamily);
      if (user.brandKit.captionStyle) setCaptionStyle(user.brandKit.captionStyle);
      if (user.brandKit.watermarkUrl) setWatermarkUrl(user.brandKit.watermarkUrl);
      if (user.brandKit.watermarkPosition) setWatermarkPosition(user.brandKit.watermarkPosition);
    }
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      await api.put('/users/brand-kit', {
        primaryColor,
        secondaryColor,
        fontFamily,
        captionStyle,
        watermarkUrl: watermarkUrl || undefined,
        watermarkPosition,
      });
      await refreshUser();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to update brand kit');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
          <Palette className="w-6 h-6 text-brand-400" />
          <span>Brand Kit & Identity</span>
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Customize your default brand colors, font typography, watermark, and caption styles to automatically apply across all AI video exports.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Form */}
        <form onSubmit={handleSave} className="lg:col-span-7 space-y-6">
          <div className="p-6 rounded-2xl bg-dark-850 border border-white/[0.08] space-y-5">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Brand Colors & Typography
            </h2>

            {/* Colors */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Primary Accent Color
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-10 h-10 rounded-xl bg-transparent border border-white/[0.1] cursor-pointer"
                  />
                  <input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-28 px-3 py-2 rounded-xl bg-dark-900 border border-white/[0.1] text-xs font-mono text-white focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Secondary Highlight Color
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    className="w-10 h-10 rounded-xl bg-transparent border border-white/[0.1] cursor-pointer"
                  />
                  <input
                    type="text"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    className="w-28 px-3 py-2 rounded-xl bg-dark-900 border border-white/[0.1] text-xs font-mono text-white focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>
            </div>

            {/* Font family */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Font Typography
              </label>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-sm focus:outline-none focus:border-brand-500"
              >
                <option value="Plus Jakarta Sans">Plus Jakarta Sans (Modern Geometric)</option>
                <option value="Cabinet Grotesk">Cabinet Grotesk (Punchy Viral Headline)</option>
                <option value="Montserrat">Montserrat (Classic Bold)</option>
                <option value="Inter">Inter (Ultra-clean Tech)</option>
              </select>
            </div>

            {/* Default Caption Style */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Default Caption Animation Style
              </label>
              <select
                value={captionStyle}
                onChange={(e) => setCaptionStyle(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-sm focus:outline-none focus:border-brand-500"
              >
                <option value="karaoke_neon">Submagic Neon Karaoke (Active Word Highlight)</option>
                <option value="clean_minimal">Clean Minimalist Subtitles</option>
                <option value="corporate_bold">Corporate Bold Badge</option>
                <option value="tech_hud">Tech HUD Glassmorphic</option>
                <option value="cinematic_headline">Dramatic Cinematic Headline</option>
              </select>
            </div>
          </div>

          {/* Watermark Section */}
          <div className="p-6 rounded-2xl bg-dark-850 border border-white/[0.08] space-y-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Custom Watermark & Logo
            </h2>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Watermark Image URL (PNG with transparent background)
              </label>
              <input
                type="url"
                placeholder="https://assets.yourdomain.com/brand-watermark.png"
                value={watermarkUrl}
                onChange={(e) => setWatermarkUrl(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Watermark Position
              </label>
              <select
                value={watermarkPosition}
                onChange={(e) => setWatermarkPosition(e.target.value as any)}
                className="w-full px-4 py-2.5 rounded-xl bg-dark-900 border border-white/[0.1] text-white text-sm focus:outline-none focus:border-brand-500"
              >
                <option value="top_right">Top Right (Recommended for Shorts)</option>
                <option value="top_left">Top Left</option>
                <option value="bottom_right">Bottom Right</option>
                <option value="bottom_left">Bottom Left</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-sm shadow-lg shadow-brand-600/30 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Saving...' : 'Save Brand Preferences'}</span>
            </button>
            {saveSuccess && (
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 animate-in fade-in">
                <Check className="w-4 h-4" />
                <span>Saved successfully!</span>
              </span>
            )}
          </div>
        </form>

        {/* Right Live Preview Canvas */}
        <div className="lg:col-span-5 space-y-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Real-Time Brand Preview
          </span>
          <div className="w-[300px] h-[533px] mx-auto rounded-3xl bg-slate-950 border-2 border-white/[0.12] shadow-2xl relative overflow-hidden flex flex-col justify-between p-5">
            {/* Watermark preview */}
            <div className="flex justify-between items-start z-10">
              <span className="text-[10px] font-mono text-slate-400">00:12</span>
              {watermarkUrl ? (
                <img src={watermarkUrl} alt="Watermark" className="h-6 w-auto opacity-80" />
              ) : (
                <span
                  className="text-[11px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded bg-black/60 border border-white/[0.1]"
                  style={{ color: primaryColor }}
                >
                  YOUR LOGO
                </span>
              )}
            </div>

            {/* Subtitle with active brand styles */}
            <div className="text-center z-10 px-2 py-3 rounded-2xl bg-black/80 backdrop-blur-md border border-white/[0.1] shadow-xl">
              <p className="text-sm font-black uppercase tracking-tight leading-snug">
                <span className="text-white">THIS IS YOUR </span>
                <span
                  className="underline decoration-2"
                  style={{ color: primaryColor, textDecorationColor: primaryColor }}
                >
                  BRAND IDENTITY
                </span>
                <span className="text-white"> IN EVERY </span>
                <span style={{ color: secondaryColor }} className="font-extrabold">
                  SHORT!
                </span>
              </p>
            </div>

            {/* Bottom sound status */}
            <div className="text-center z-10 text-[10px] text-slate-500">
              Font: <strong className="text-slate-300">{fontFamily}</strong> · Style: <strong className="text-slate-300">{captionStyle}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

