import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import {
  LayoutDashboard,
  Video,
  UserCheck,
  FileVideo,
  FolderKanban,
  Palette,
  LayoutGrid,
  CreditCard,
  Settings,
  Sparkles,
  Zap,
  HardDrive,
  HelpCircle,
  ShieldCheck,
} from 'lucide-react';
import { formatCredits } from '../utils/cn.js';

interface SidebarProps {
  onNewProjectClick?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onNewProjectClick }) => {
  const { user } = useAuth();

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'My Projects', path: '/projects', icon: FolderKanban },
    { name: 'Templates', path: '/templates', icon: LayoutGrid },
    { name: 'Brand Kit', path: '/brand-kit', icon: Palette },
    { name: 'Media Library', path: '/media', icon: HardDrive },
  ];

  const videoModes = [
    { name: 'AI Video Editor', path: '/dashboard', icon: Video, badge: 'Viral' },
    { name: 'AI Avatar Studio', path: '/avatars', icon: UserCheck, badge: 'Pro' },
    { name: 'Faceless Generator', path: '/faceless', icon: FileVideo, badge: 'AI' },
  ];

  const bottomNavItems = [
    { name: 'Billing & Plans', path: '/billing', icon: CreditCard },
    { name: 'Account Settings', path: '/settings', icon: Settings },
    { name: 'Help & Support', path: '/help', icon: HelpCircle },
    ...(user && (user.role === 'admin' || user.role === 'super_admin')
      ? [{ name: 'Admin Portal', path: '/admin', icon: ShieldCheck }]
      : []),
  ];

  return (
    <aside className="w-64 flex-shrink-0 bg-dark-850 border-r border-white/[0.08] flex flex-col h-screen sticky top-0">
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-white/[0.08]">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-brand-600 to-pink-500 flex items-center justify-center">
            <Video className="w-4 h-4 text-white" />
          </div>
          <span className="font-extrabold text-lg text-white">
            Shorts<span className="text-brand-400">InShort</span>
          </span>
        </Link>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* Quick Create Action Button */}
        <button
          onClick={onNewProjectClick}
          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-pink-600 hover:from-brand-500 hover:to-pink-500 text-white font-semibold text-sm shadow-lg shadow-brand-600/30 flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
        >
          <Sparkles className="w-4 h-4" />
          <span>Create New Video</span>
        </button>

        {/* Video Creation Modes Section */}
        <div>
          <span className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Creation Modules
          </span>
          <nav className="mt-2 space-y-1">
            {videoModes.map((item) => (
              <NavLink
                key={item.name}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  }`
                }
              >
                <div className="flex items-center gap-3">
                  <item.icon className="w-4 h-4" />
                  <span>{item.name}</span>
                </div>
                {item.badge && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Main Workspaces Section */}
        <div>
          <span className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Workspace
          </span>
          <nav className="mt-2 space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.name}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  }`
                }
              >
                <item.icon className="w-4 h-4" />
                <span>{item.name}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Administration & Config */}
        <div>
          <span className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Account & Billing
          </span>
          <nav className="mt-2 space-y-1">
            {bottomNavItems.map((item) => (
              <NavLink
                key={item.name}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  }`
                }
              >
                <item.icon className="w-4 h-4" />
                <span>{item.name}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      {/* Credit Balance & Plan Widget */}
      <div className="p-4 border-t border-white/[0.08] bg-dark-900/60">
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 font-medium">Credits Remaining</span>
            <span className="font-bold text-white flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-400 fill-amber-400" />
              {user ? formatCredits(user.creditBalance) : 0}
            </span>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-gradient-to-r from-brand-500 to-pink-500 h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, Math.max(10, ((user?.creditBalance || 0) / 100) * 100))}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] pt-1">
            <span className="capitalize text-slate-400">{user?.planTier || 'free'} Plan</span>
            <Link
              to="/billing"
              className="text-brand-400 font-semibold hover:text-brand-300 transition-colors"
            >
              Get More &rarr;
            </Link>
          </div>
        </div>
      </div>
    </aside>
  );
};

