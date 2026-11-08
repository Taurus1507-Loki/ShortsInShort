import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import { AvatarConsent, Project, AspectRatio, Resolution } from '../types/index.js';
import {
  UserCheck,
  Sparkles,
  UploadCloud,
  Mic,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Video,
  Clock,
  Play,
  RotateCcw,
  Zap,
  Globe,
  FileText,
  Trash2,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { formatCredits } from '../utils/cn.js';

export const AvatarStudioPage: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'generate' | 'avatars' | 'create_avatar'>('generate');
  const [avatars, setAvatars] = useState<AvatarConsent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');

  // Video Generation Form State
  const [selectedAvatarId, setSelectedAvatarId] = useState<string>('');
  const [projectTitle, setProjectTitle] = useState<string>('');
  const [script, setScript] = useState<string>(
    'Hey guys! Welcome to this quick tutorial on how to 10x your content creation speed using AI digital twins. No cameras, no studio lights—just pure automation.'
  );
  const [language, setLanguage] = useState<string>('en');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [resolution, setResolution] = useState<Resolution>('1080p');

  // New Avatar Consent & Upload State
  const [newAvatarName, setNewAvatarName] = useState<string>('');
  const [provider, setProvider] = useState<'heygen' | 'd_id'>('heygen');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voiceFileName, setVoiceFileName] = useState<string>('');
  const [explicitConsentGiven, setExplicitConsentGiven] = useState<boolean>(false);
  const [legalDeclarationSigned, setLegalDeclarationSigned] = useState<boolean>(false);

  // Fetch user avatars
  const fetchAvatars = async () => {
    try {
      setIsLoading(true);
      const data = await api.get<AvatarConsent[]>('/avatars');
      setAvatars(data);
      if (data.length > 0 && !selectedAvatarId) {
        setSelectedAvatarId(data[0]._id);
      }
    } catch (err) {
      console.error('Failed to load avatars:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAvatars();
  }, []);

  // Handle Photo selection
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  // Handle Voice selection
  const handleVoiceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setVoiceFile(file);
      setVoiceFileName(file.name);
    }
  };

  // Submit New Avatar with Consent
  const handleCreateAvatar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAvatarName.trim()) {
      setErrorMessage('Please provide a name for this digital avatar');
      return;
    }
    if (!imageFile) {
      setErrorMessage('Please upload a clear portrait photo for avatar synthesis');
      return;
    }
    if (!explicitConsentGiven || !legalDeclarationSigned) {
      setErrorMessage('You must review and agree to the biometric likeness consent agreements');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage('');
      setSuccessMessage('');

      // 1. Upload profile image
      const imgFormData = new FormData();
      imgFormData.append('image', imageFile);
      const imgUploadRes = await fetch('/api/avatars/upload/image', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: imgFormData,
      });
      const imgUploadData = await imgUploadRes.json();
      if (!imgUploadRes.ok || !imgUploadData.success) {
        throw new Error(imgUploadData.message || 'Image upload failed');
      }
      const profileImageUrl = imgUploadData.data.url;

      // 2. Upload voice sample if provided
      let voiceSampleUrl = undefined;
      if (voiceFile) {
        const voiceFormData = new FormData();
        voiceFormData.append('voice', voiceFile);
        const voiceRes = await fetch('/api/avatars/upload/voice', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          body: voiceFormData,
        });
        const voiceData = await voiceRes.json();
        if (voiceRes.ok && voiceData.success) {
          voiceSampleUrl = voiceData.data.url;
        }
      }

      // 3. Register Consent record in MongoDB
      const consentRes = await api.post<AvatarConsent>('/avatars/consent', {
        avatarName: newAvatarName,
        provider,
        profileImageUrl,
        voiceSampleUrl,
        explicitConsentGiven: true,
        legalDeclarationSigned: true,
      });

      // 4. Trigger provider synthesis
      await api.post(`/avatars/${consentRes._id}/create`);

      setSuccessMessage(`Digital Avatar "${newAvatarName}" registered successfully!`);
      await fetchAvatars();
      setActiveTab('generate');
      setSelectedAvatarId(consentRes._id);

      // Reset form
      setNewAvatarName('');
      setImageFile(null);
      setImagePreview('');
      setVoiceFile(null);
      setVoiceFileName('');
      setExplicitConsentGiven(false);
      setLegalDeclarationSigned(false);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create avatar');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Revoke avatar consent
  const handleRevokeConsent = async (avatarId: string) => {
    if (!confirm('Are you sure you want to revoke consent for this avatar? It will be deactivated.')) {
      return;
    }
    try {
      await api.patch(`/avatars/${avatarId}/consent`, {
        status: 'revoked',
        notes: 'Consent revoked by user',
      });
      await fetchAvatars();
    } catch (err: any) {
      alert(err.message || 'Failed to revoke avatar consent');
    }
  };

  // Generate Video with Selected Avatar
  const handleGenerateAvatarVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAvatarId) {
      setErrorMessage('Please select an authorized avatar');
      return;
    }
    if (!script.trim()) {
      setErrorMessage('Please enter a speech script for your avatar');
      return;
    }
    if ((user?.creditBalance || 0) < 3) {
      setErrorMessage('Insufficient video credits. You need at least 3 credits to generate an avatar video.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage('');

      const title = projectTitle.trim() || `Avatar Reel — ${new Date().toLocaleDateString()}`;

      // 1. Create project
      const newProject = await api.post<Project>('/projects', {
        title,
        creationMode: 'ai_avatar',
        aspectRatio,
        resolution,
        script,
      });

      // 2. Trigger Avatar video generation
      await api.post(`/avatars/projects/${newProject._id}/avatar/${selectedAvatarId}/generate`, {
        script,
        voiceId: 'default_voice',
        language,
        aspectRatio,
        resolution,
      });

      await refreshUser();
      // Redirect to the video studio to view/edit
      navigate(`/projects/${newProject._id}/editor`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to generate avatar video');
    } finally {
      setIsSubmitting(false);
    }
  };

  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = Math.max(5, Math.round(wordCount / 2.5));

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2 text-pink-400 text-xs font-bold uppercase tracking-wider mb-1">
            <UserCheck className="w-4 h-4" />
            <span>Module B • AI Digital Avatar Generator</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            AI Avatar Video Studio
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Produce high-converting talking head videos without recording yourself every time. Powered by ethical likeness consent and hyper-realistic lip synchronization.
          </p>
        </div>

        {/* Action Tabs & Credits */}
        <div className="flex items-center gap-3">
          <div className="px-3.5 py-1.5 rounded-xl bg-pink-500/10 border border-pink-500/30 text-pink-300 text-xs font-semibold flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-pink-400 fill-pink-400" />
            <span>3 Credits / Short</span>
          </div>
          <div className="text-xs text-slate-400">
            Balance: <strong className="text-white">{user ? formatCredits(user.creditBalance) : 0}</strong>
          </div>
        </div>
      </div>

      {/* Navigation Pill Tabs */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] pb-3">
        <button
          onClick={() => setActiveTab('generate')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            activeTab === 'generate'
              ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/30'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <Video className="w-4 h-4" />
          <span>Generate Avatar Video</span>
        </button>

        <button
          onClick={() => setActiveTab('avatars')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            activeTab === 'avatars'
              ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/30'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>Authorized Avatars ({avatars.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('create_avatar')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            activeTab === 'create_avatar'
              ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/30'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>+ Create New Avatar (Consent)</span>
        </button>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* TAB 1: GENERATE AVATAR VIDEO */}
      {activeTab === 'generate' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Form & Script */}
          <div className="lg:col-span-2 space-y-6">
            {/* Step 1: Avatar Selection */}
            <div className="p-6 rounded-2xl bg-dark-850 border border-white/[0.08] space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center text-xs">1</span>
                  <span>Select Authorized Digital Avatar</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveTab('create_avatar')}
                  className="text-xs text-pink-400 hover:text-pink-300 font-semibold"
                >
                  + Add New
                </button>
              </div>

              {avatars.length === 0 ? (
                <div className="p-6 rounded-xl border border-dashed border-white/[0.1] text-center space-y-3">
                  <UserCheck className="w-8 h-8 text-slate-500 mx-auto" />
                  <p className="text-xs text-slate-400">
                    You do not have any authorized digital avatars yet. Upload your likeness with verified consent to start creating.
                  </p>
                  <button
                    onClick={() => setActiveTab('create_avatar')}
                    className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-xs font-bold transition-all"
                  >
                    Authorize My First Avatar
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {avatars.map((av) => {
                    const isSelected = selectedAvatarId === av._id;
                    return (
                      <div
                        key={av._id}
                        onClick={() => setSelectedAvatarId(av._id)}
                        className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col items-center text-center relative group ${
                          isSelected
                            ? 'bg-pink-500/15 border-pink-500 ring-2 ring-pink-500/40'
                            : 'bg-dark-900 border-white/[0.06] hover:border-white/[0.2]'
                        }`}
                      >
                        <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-white/[0.1] mb-2 bg-slate-800">
                          <img
                            src={av.profileImageUrl}
                            alt={av.avatarName}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // Fallback placeholder
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        </div>
                        <span className="text-xs font-bold text-white truncate max-w-full">
                          {av.avatarName}
                        </span>
                        <span className="text-[10px] text-pink-400 font-semibold uppercase mt-0.5">
                          {av.provider}
                        </span>
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-pink-500 text-white flex items-center justify-center text-[10px]">
                            ✓
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Step 2: Script Input */}
            <div className="p-6 rounded-2xl bg-dark-850 border border-white/[0.08] space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center text-xs">2</span>
                  <span>Speech Script & Narration</span>
                </h3>
                <span className="text-xs text-slate-400 font-mono">
                  {wordCount} words (~{estimatedSeconds}s)
                </span>
              </div>

              <div>
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  rows={6}
                  placeholder="Enter or paste the script your avatar will speak with natural lip sync..."
                  className="w-full bg-dark-900 border border-white/[0.1] rounded-xl p-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-pink-500 transition-colors resize-none leading-relaxed"
                />
              </div>

              {/* Language Selector */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Globe className="w-4 h-4 text-pink-400" />
                  <span>Narration Language:</span>
                </div>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="bg-dark-900 border border-white/[0.1] text-xs text-white rounded-xl px-3 py-2 focus:outline-none focus:border-pink-500"
                >
                  <option value="en">English (US / UK / Global)</option>
                  <option value="es">Spanish (Español)</option>
                  <option value="hi">Hindi (हिन्दी)</option>
                  <option value="fr">French (Français)</option>
                  <option value="de">German (Deutsch)</option>
                  <option value="pt">Portuguese (Português)</option>
                  <option value="ja">Japanese (日本語)</option>
                </select>
              </div>
            </div>

            {/* Step 3: Format & Export Settings */}
            <div className="p-6 rounded-2xl bg-dark-850 border border-white/[0.08] space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center text-xs">3</span>
                <span>Output Format & Video Settings</span>
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Reels / Shorts', ratio: '9:16' as AspectRatio, desc: '9:16 Vertical' },
                  { label: 'YouTube Standard', ratio: '16:9' as AspectRatio, desc: '16:9 Landscape' },
                  { label: 'Instagram Square', ratio: '1:1' as AspectRatio, desc: '1:1 Square' },
                  { label: 'Instagram Feed', ratio: '4:5' as AspectRatio, desc: '4:5 Portrait' },
                ].map((item) => (
                  <button
                    key={item.ratio}
                    type="button"
                    onClick={() => setAspectRatio(item.ratio)}
                    className={`p-3 rounded-xl border text-center transition-all ${
                      aspectRatio === item.ratio
                        ? 'bg-pink-500/15 border-pink-500 text-white'
                        : 'bg-dark-900 border-white/[0.06] text-slate-400 hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-bold">{item.label}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Summary Card & Action */}
          <div className="space-y-6">
            <div className="p-6 rounded-3xl bg-dark-850 border border-white/[0.08] space-y-6 sticky top-24">
              <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Generation Summary
                </h3>
                <span className="text-xs font-bold text-pink-400 px-2 py-0.5 rounded-full bg-pink-500/15">
                  Ready
                </span>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between text-slate-400">
                  <span>Selected Avatar:</span>
                  <span className="font-bold text-white">
                    {avatars.find((a) => a._id === selectedAvatarId)?.avatarName || 'None selected'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Aspect Ratio:</span>
                  <span className="font-bold text-white font-mono">{aspectRatio}</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Estimated Duration:</span>
                  <span className="font-bold text-white font-mono">~{estimatedSeconds}s</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Subtitles & Captions:</span>
                  <span className="font-bold text-emerald-400">Auto Neon Karaoke</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Credit Cost:</span>
                  <span className="font-bold text-amber-400 flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5 fill-amber-400" />
                    3 Credits
                  </span>
                </div>
              </div>

              <div className="pt-4 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={handleGenerateAvatarVideo}
                  disabled={isSubmitting || avatars.length === 0}
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white font-bold text-sm shadow-xl shadow-pink-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Synthesizing Avatar...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Generate Avatar Video</span>
                    </>
                  )}
                </button>
                <p className="text-[11px] text-slate-500 text-center mt-2">
                  Once synthesized, you can edit captions, add B-roll, and polish in the Video Studio.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MY DIGITAL AVATARS */}
      {activeTab === 'avatars' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Your Authorized Digital Twins</h2>
              <p className="text-xs text-slate-400">
                Verified avatars associated with your tenant workspace.
              </p>
            </div>
            <button
              onClick={() => setActiveTab('create_avatar')}
              className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-xs font-bold flex items-center gap-2 transition-all shadow-md shadow-pink-600/20"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Add New Avatar</span>
            </button>
          </div>

          {avatars.length === 0 ? (
            <div className="p-12 rounded-3xl bg-dark-850 border border-white/[0.08] text-center space-y-4">
              <UserCheck className="w-12 h-12 text-slate-600 mx-auto" />
              <h3 className="text-sm font-bold text-white">No Authorized Likenesses Found</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                To create videos with your digital twin, upload a clear photo and sign the likeness authorization declaration.
              </p>
              <button
                onClick={() => setActiveTab('create_avatar')}
                className="px-5 py-2.5 rounded-xl bg-pink-600 text-white text-xs font-bold"
              >
                Register Avatar Likeness
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {avatars.map((av) => (
                <div
                  key={av._id}
                  className="p-5 rounded-2xl bg-dark-850 border border-white/[0.08] space-y-4 relative overflow-hidden"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl overflow-hidden bg-slate-800 border border-white/[0.1] flex-shrink-0">
                      <img
                        src={av.profileImageUrl}
                        alt={av.avatarName}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-bold text-white truncate">{av.avatarName}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          {av.status || 'Active'}
                        </span>
                        <span className="text-[10px] text-slate-400 uppercase font-mono">
                          {av.provider}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 block mt-1">
                        Created {new Date(av.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs">
                    <button
                      onClick={() => {
                        setSelectedAvatarId(av._id);
                        setActiveTab('generate');
                      }}
                      className="text-pink-400 hover:text-pink-300 font-bold flex items-center gap-1"
                    >
                      <span>Create Video</span>
                      <span>&rarr;</span>
                    </button>

                    <button
                      onClick={() => handleRevokeConsent(av._id)}
                      className="text-slate-500 hover:text-rose-400 text-[11px] font-semibold transition-colors"
                      title="Revoke Likeness Consent"
                    >
                      Revoke Consent
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CREATE NEW AVATAR & CONSENT */}
      {activeTab === 'create_avatar' && (
        <form onSubmit={handleCreateAvatar} className="max-w-2xl mx-auto space-y-8">
          <div className="p-8 rounded-3xl bg-dark-850 border border-white/[0.08] space-y-6">
            <div className="border-b border-white/[0.08] pb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-pink-400" />
                <span>Authorized Digital Likeness Registration</span>
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                ShortsInShort strictly adheres to ethical AI and deepfake prevention standards. Every digital twin requires verified consent.
              </p>
            </div>

            {/* Avatar Name */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">
                Avatar Name / Nickname
              </label>
              <input
                type="text"
                value={newAvatarName}
                onChange={(e) => setNewAvatarName(e.target.value)}
                placeholder="e.g. My Studio Twin, CEO Alex, Sarah Podcast Twin"
                className="w-full bg-dark-900 border border-white/[0.1] rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-pink-500"
              />
            </div>

            {/* Photo Upload */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">
                Clear Portrait Photograph (JPEG / PNG / WebP)
              </label>
              <div className="border-2 border-dashed border-white/[0.1] hover:border-pink-500/50 rounded-2xl p-6 text-center transition-all bg-dark-900/50 relative">
                {imagePreview ? (
                  <div className="flex flex-col items-center gap-3">
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="w-24 h-24 rounded-2xl object-cover border-2 border-pink-500 shadow-lg"
                    />
                    <span className="text-xs text-emerald-400 font-bold">Photo Selected</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <UploadCloud className="w-8 h-8 text-pink-400 mx-auto" />
                    <div className="text-xs font-bold text-white">Click or drag photo here</div>
                    <div className="text-[11px] text-slate-500">
                      High resolution front-facing photo with even lighting works best.
                    </div>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageChange}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
            </div>

            {/* Optional Voice Sample */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">
                Voice Recording Sample (Optional, 30s MP3/WAV)
              </label>
              <div className="border border-white/[0.08] rounded-xl p-4 bg-dark-900/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Mic className="w-5 h-5 text-pink-400" />
                  <span className="text-xs text-slate-300 truncate max-w-xs">
                    {voiceFileName || 'No voice sample selected (default synthesis will be used)'}
                  </span>
                </div>
                <label className="px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs font-bold text-slate-200 cursor-pointer transition-colors">
                  Browse Audio
                  <input
                    type="file"
                    accept="audio/mpeg,audio/wav,audio/mp3,audio/mp4"
                    onChange={handleVoiceChange}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* AI Avatar Provider */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">
                AI Synthesis Engine
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setProvider('heygen')}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    provider === 'heygen'
                      ? 'bg-pink-500/15 border-pink-500 text-white font-bold'
                      : 'bg-dark-900 border-white/[0.06] text-slate-400'
                  }`}
                >
                  <div className="text-xs">HeyGen Engine</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">High definition lip sync</div>
                </button>
                <button
                  type="button"
                  onClick={() => setProvider('d_id')}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    provider === 'd_id'
                      ? 'bg-pink-500/15 border-pink-500 text-white font-bold'
                      : 'bg-dark-900 border-white/[0.06] text-slate-400'
                  }`}
                >
                  <div className="text-xs">D-ID Studio</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Natural voice animation</div>
                </button>
              </div>
            </div>

            {/* Legal Consent Checkboxes */}
            <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="consent1"
                  checked={explicitConsentGiven}
                  onChange={(e) => setExplicitConsentGiven(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-amber-400 text-pink-600 focus:ring-pink-500"
                />
                <label htmlFor="consent1" className="text-xs text-amber-200 leading-relaxed cursor-pointer">
                  <strong>Explicit Likeness Authorization:</strong> I certify and declare under penalty of perjury that I am the individual depicted in the submitted media, or that I hold explicit written legal power of attorney to synthesize this digital twin.
                </label>
              </div>

              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="consent2"
                  checked={legalDeclarationSigned}
                  onChange={(e) => setLegalDeclarationSigned(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-amber-400 text-pink-600 focus:ring-pink-500"
                />
                <label htmlFor="consent2" className="text-xs text-amber-200 leading-relaxed cursor-pointer">
                  <strong>Anti-Impersonation & Audit Compliance:</strong> I understand that unauthorized voice cloning, non-consensual impersonation, and fraudulent content creation will result in immediate termination, forfeiture of credits, and referral to relevant cyber authorities.
                </label>
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting || !explicitConsentGiven || !legalDeclarationSigned}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white font-bold text-sm shadow-xl shadow-pink-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Verifying Consent & Registering Avatar...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Authorize & Create Digital Avatar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
};

export default AvatarStudioPage;

