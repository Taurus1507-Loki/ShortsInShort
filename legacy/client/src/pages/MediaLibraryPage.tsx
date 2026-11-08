import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import { Project } from '../types/index.js';
import {
  HardDrive,
  UploadCloud,
  Film,
  Music,
  UserCheck,
  FileVideo,
  Trash2,
  ExternalLink,
  Copy,
  Check,
  Search,
  Filter,
  Play,
  Clock,
  Sparkles,
} from 'lucide-react';
import { formatDuration } from '../utils/cn.js';

interface MediaAsset {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  url: string;
  sizeBytes?: number;
  durationSec?: number;
  createdAt: string;
  source: 'upload' | 'export' | 'avatar';
}

export const MediaLibraryPage: React.FC = () => {
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<'all' | 'video' | 'audio' | 'exports'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewMediaUrl, setPreviewMediaUrl] = useState<string | null>(null);

  // Default assets collected from projects & uploads
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAssets = async () => {
      try {
        setIsLoading(true);
        const projects = await api.get<Project[]>('/projects');

        const collected: MediaAsset[] = [];
        projects.forEach((p) => {
          if (p.rawVideoUrl) {
            collected.push({
              id: `raw-${p._id}`,
              name: `${p.title} (Raw Footage)`,
              type: 'video',
              url: p.rawVideoUrl,
              durationSec: p.duration,
              createdAt: p.createdAt,
              source: 'upload',
            });
          }
          if (p.outputVideoUrl) {
            collected.push({
              id: `export-${p._id}`,
              name: `${p.title} (Finished Short)`,
              type: 'video',
              url: p.outputVideoUrl,
              durationSec: p.duration,
              createdAt: p.updatedAt,
              source: 'export',
            });
          }
        });

        // Add default sample audio assets for creators
        collected.push(
          {
            id: 'audio-cinematic',
            name: 'Cinematic Ambient Vibe',
            type: 'audio',
            url: '/uploads/music/cinematic.mp3',
            durationSec: 60,
            createdAt: new Date().toISOString(),
            source: 'upload',
          },
          {
            id: 'audio-lofi',
            name: 'Inspiring Lo-Fi Chill',
            type: 'audio',
            url: '/uploads/music/lofi.mp3',
            durationSec: 45,
            createdAt: new Date().toISOString(),
            source: 'upload',
          }
        );

        setAssets(collected);
      } catch (err) {
        console.error('Failed to load media assets:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAssets();
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];

    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append('video', file);

      const res = await fetch('/api/videos/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Upload failed');
      }

      const newAsset: MediaAsset = {
        id: `upload-${Date.now()}`,
        name: file.name,
        type: file.type.startsWith('audio/') ? 'audio' : 'video',
        url: data.data.url,
        sizeBytes: file.size,
        durationSec: data.data.metadata?.duration || 30,
        createdAt: new Date().toISOString(),
        source: 'upload',
      };

      setAssets((prev) => [newAsset, ...prev]);
    } catch (err: any) {
      alert(err.message || 'Failed to upload media');
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopyUrl = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredAssets = assets.filter((asset) => {
    const matchesSearch = asset.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (activeTab === 'all') return true;
    if (activeTab === 'video') return asset.type === 'video' && asset.source === 'upload';
    if (activeTab === 'audio') return asset.type === 'audio';
    if (activeTab === 'exports') return asset.source === 'export';
    return true;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-wider mb-1">
            <HardDrive className="w-4 h-4" />
            <span>Asset Storage & Cloud Media Hub</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            Media Library
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Store raw videos, stock footage, voice recordings, and completed viral shorts. Seamlessly reuse assets across projects.
          </p>
        </div>

        {/* Upload Action */}
        <div className="flex items-center gap-3">
          <label className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-cyan-600/20 cursor-pointer transition-all">
            {isUploading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Uploading...</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-4 h-4" />
                <span>Upload Media Asset</span>
              </>
            )}
            <input
              type="file"
              accept="video/mp4,video/quicktime,audio/mpeg,audio/wav"
              onChange={handleFileUpload}
              disabled={isUploading}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Category Pills */}
        <div className="flex items-center gap-2">
          {[
            { id: 'all', label: 'All Assets' },
            { id: 'video', label: 'Raw Footage' },
            { id: 'audio', label: 'Audio & Music' },
            { id: 'exports', label: 'Rendered Shorts' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === tab.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search media files..."
            className="w-full bg-dark-850 border border-white/[0.08] rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* Asset Grid */}
      {filteredAssets.length === 0 ? (
        <div className="p-16 rounded-3xl bg-dark-850 border border-white/[0.08] text-center space-y-4">
          <HardDrive className="w-12 h-12 text-slate-600 mx-auto" />
          <h3 className="text-sm font-bold text-white">No Media Assets Found</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Upload raw video footage, voice notes, or background music to use across your AI editing projects.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {filteredAssets.map((asset) => (
            <div
              key={asset.id}
              className="p-4 rounded-2xl bg-dark-850 border border-white/[0.08] hover:border-white/[0.2] transition-all flex flex-col justify-between group space-y-3"
            >
              <div>
                {/* Visual Thumbnail Area */}
                <div
                  onClick={() => setPreviewMediaUrl(asset.url)}
                  className="w-full h-36 rounded-xl bg-dark-900 border border-white/[0.06] flex items-center justify-center relative overflow-hidden cursor-pointer group-hover:scale-[1.02] transition-transform"
                >
                  {asset.type === 'video' ? (
                    <div className="flex flex-col items-center gap-2 text-cyan-400">
                      <Film className="w-8 h-8 opacity-80" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                        <Play className="w-8 h-8 fill-white" />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-emerald-400">
                      <Music className="w-8 h-8 opacity-80" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                        <Play className="w-8 h-8 fill-white" />
                      </div>
                    </div>
                  )}

                  {asset.durationSec && (
                    <span className="absolute bottom-2 right-2 text-[10px] font-mono font-bold bg-black/70 px-1.5 py-0.5 rounded text-white">
                      {formatDuration(asset.durationSec)}
                    </span>
                  )}
                </div>

                {/* Details */}
                <div className="mt-3">
                  <h4 className="text-xs font-bold text-white truncate" title={asset.name}>
                    {asset.name}
                  </h4>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
                    <span className="uppercase font-semibold text-cyan-400">{asset.source}</span>
                    <span>•</span>
                    <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs">
                <button
                  onClick={() => handleCopyUrl(asset.id, asset.url)}
                  className="text-slate-400 hover:text-white flex items-center gap-1 text-[11px] font-semibold transition-colors"
                  title="Copy media URL"
                >
                  {copiedId === asset.id ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy URL</span>
                    </>
                  )}
                </button>

                <a
                  href={asset.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1 text-[11px]"
                >
                  <span>Open</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Media Preview Modal */}
      {previewMediaUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-dark-850 border border-white/[0.1] rounded-3xl w-full max-w-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <h3 className="text-sm font-bold text-white">Media Preview</h3>
              <button
                onClick={() => setPreviewMediaUrl(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>
            <div className="rounded-2xl overflow-hidden bg-black flex items-center justify-center max-h-96">
              <video
                src={previewMediaUrl}
                controls
                autoPlay
                className="max-h-96 w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MediaLibraryPage;

