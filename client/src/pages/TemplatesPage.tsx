import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { Template } from '../types/index.js';
import { LayoutGrid, Sparkles, Film, ArrowRight, Zap, Volume2 } from 'lucide-react';

export const TemplatesPage: React.FC = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const categories = ['All', 'Viral', 'Podcast', 'Business', 'Motivational', 'Educational'];

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        setIsLoading(true);
        const data = await api.get<Template[]>(`/templates?category=${activeCategory}`);
        setTemplates(data);
      } catch (err) {
        console.error('Failed to load templates:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTemplates();
  }, [activeCategory]);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-white/[0.06]">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
            <LayoutGrid className="w-6 h-6 text-brand-400" />
            <span>Editing Template Marketplace</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Pre-configured post-production styles with synchronized captions, transitions, B-roll density, and music.
          </p>
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-dark-850 border border-white/[0.08] text-xs">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeCategory === cat
                  ? 'bg-brand-500/20 text-brand-300 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-slate-500 text-sm">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          Loading templates...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((tpl) => (
            <div
              key={tpl._id}
              className="rounded-3xl bg-dark-850 border border-white/[0.08] overflow-hidden hover:border-brand-500/40 transition-all group flex flex-col justify-between"
            >
              {/* Card Header & Preview */}
              <div className="p-6 pb-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-brand-500/10 text-brand-400 border border-brand-500/20">
                    {tpl.category}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white/[0.05] text-slate-300">
                    {tpl.aspectRatio}
                  </span>
                </div>

                <h3 className="text-lg font-bold text-white group-hover:text-brand-300 transition-colors">
                  {tpl.title}
                </h3>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  {tpl.description}
                </p>

                {/* Subtitle simulation sample */}
                <div className="mt-4 p-3 rounded-xl bg-dark-900 border border-white/[0.06] text-center">
                  <span className="text-[11px] text-slate-500 block mb-1">Caption Preview</span>
                  <span
                    className="text-xs font-black uppercase tracking-tight"
                    style={{ color: tpl.highlightColor }}
                  >
                    ★ VIRAL KARAOKE PRESET ★
                  </span>
                </div>

                {/* Specs */}
                <div className="mt-4 pt-3 border-t border-white/[0.06] grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                  <div>
                    <span className="text-slate-500">Zoom:</span> <span className="capitalize text-slate-300 font-semibold">{tpl.zoomIntensity}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">B-roll:</span> <span className="capitalize text-slate-300 font-semibold">{tpl.brollIntensity}</span>
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5 text-slate-300">
                    <Volume2 className="w-3.5 h-3.5 text-brand-400" />
                    <span>Music: {tpl.suggestedMusicCategory}</span>
                  </div>
                </div>
              </div>

              {/* Action footer */}
              <div className="p-4 bg-dark-900/60 border-t border-white/[0.06]">
                <button className="w-full py-2.5 rounded-xl bg-brand-600/20 hover:bg-brand-600 border border-brand-500/30 text-brand-300 hover:text-white text-xs font-bold transition-all flex items-center justify-center gap-2">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Use This Template</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

