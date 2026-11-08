import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import {
  ShieldCheck,
  Users,
  Film,
  Zap,
  CreditCard,
  Search,
  CheckCircle2,
  AlertCircle,
  Plus,
  Minus,
  TrendingUp,
  Activity,
} from 'lucide-react';
import { formatCredits } from '../utils/cn.js';

interface AdminMetrics {
  totalUsers: number;
  totalProjects: number;
  completedProjects: number;
  failedProjects: number;
  activeSubscriptions: number;
  totalCreditsConsumed: number;
  estimatedRevenueINR: number;
}

interface AdminUserRecord {
  _id: string;
  fullName: string;
  email: string;
  role: string;
  planTier: string;
  creditBalance: number;
  createdAt: string;
}

export const AdminDashboardPage: React.FC = () => {
  const { user } = useAuth();

  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Credit adjustment modal
  const [selectedUser, setSelectedUser] = useState<AdminUserRecord | null>(null);
  const [adjustmentAmount, setAdjustmentAmount] = useState<number>(50);
  const [adjustmentDesc, setAdjustmentDesc] = useState<string>('Support grant credits');
  const [isAdjusting, setIsAdjusting] = useState<boolean>(false);
  const [notification, setNotification] = useState<string>('');

  const fetchAdminData = async () => {
    try {
      setIsLoading(true);
      const [metricsData, usersData] = await Promise.all([
        api.get<AdminMetrics>('/admin/metrics'),
        api.get<{ users: AdminUserRecord[] }>(`/admin/users?search=${encodeURIComponent(search)}`),
      ]);
      setMetrics(metricsData);
      setUsers(usersData.users || []);
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, [search]);

  const handleAdjustCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    try {
      setIsAdjusting(true);
      await api.post('/admin/users/adjust-credits', {
        userId: selectedUser._id,
        amount: adjustmentAmount,
        description: adjustmentDesc,
      });

      setNotification(`Successfully updated credits for ${selectedUser.fullName}`);
      setSelectedUser(null);
      await fetchAdminData();
      setTimeout(() => setNotification(''), 3000);
    } catch (err: any) {
      alert(err.message || 'Credit adjustment failed');
    } finally {
      setIsAdjusting(false);
    }
  };

  const handleRoleOrTierChange = async (userId: string, planTier?: string, role?: string) => {
    try {
      await api.patch('/admin/users/update-plan', {
        userId,
        planTier,
        role,
      });
      await fetchAdminData();
    } catch (err: any) {
      alert(err.message || 'Failed to update user');
    }
  };

  // If user is not super_admin or admin, show unauthorized notice
  if (user && user.role !== 'admin' && user.role !== 'super_admin') {
    return (
      <div className="p-16 rounded-3xl bg-dark-850 border border-white/[0.08] text-center space-y-4 max-w-lg mx-auto">
        <ShieldCheck className="w-12 h-12 text-rose-400 mx-auto" />
        <h2 className="text-lg font-bold text-white">Administrator Access Required</h2>
        <p className="text-xs text-slate-400">
          This portal is reserved for platform administrators and customer support supervisors.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase tracking-wider mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Executive Command Center</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            Platform Administration & Revenue
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Monitor tenant user accounts, subscription MRR, video queue health, and perform credit ledger adjustments.
          </p>
        </div>

        {notification && (
          <div className="px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4" />
            <span>{notification}</span>
          </div>
        )}
      </div>

      {/* Top 4 Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="p-5 rounded-2xl bg-dark-850 border border-white/[0.08]">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
            <span>Total Customers</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-black text-white mt-3">
            {metrics ? metrics.totalUsers : 0}
          </div>
          <div className="text-[11px] text-indigo-400 mt-1">Multi-tenant isolated</div>
        </div>

        <div className="p-5 rounded-2xl bg-dark-850 border border-white/[0.08]">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
            <span>Videos Rendered</span>
            <Film className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-white mt-3">
            {metrics ? metrics.completedProjects : 0}
          </div>
          <div className="text-[11px] text-emerald-400 mt-1">
            {metrics ? metrics.failedProjects : 0} failed / refunded
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-dark-850 border border-white/[0.08]">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
            <span>Credits Consumed</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-white mt-3">
            {metrics ? metrics.totalCreditsConsumed : 0}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">From automated video renders</div>
        </div>

        <div className="p-5 rounded-2xl bg-dark-850 border border-white/[0.08]">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
            <span>Active MRR (INR)</span>
            <TrendingUp className="w-4 h-4 text-brand-400" />
          </div>
          <div className="text-2xl font-black text-white mt-3">
            ₹{metrics ? (metrics.estimatedRevenueINR).toLocaleString('en-IN') : 0}
          </div>
          <div className="text-[11px] text-brand-400 mt-1">
            {metrics ? metrics.activeSubscriptions : 0} paid subscriptions
          </div>
        </div>
      </div>

      {/* User Management Directory */}
      <div className="p-6 rounded-3xl bg-dark-850 border border-white/[0.08] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-400" />
            <span>Customer Accounts & Tenancy</span>
          </h2>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search user by name or email..."
              className="w-full bg-dark-900 border border-white/[0.08] rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] text-slate-400 uppercase text-[10px] tracking-wider">
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Plan Tier</th>
                <th className="py-3 px-4">Credits</th>
                <th className="py-3 px-4">Joined</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {users.map((u) => (
                <tr key={u._id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-bold text-white">{u.fullName}</div>
                    <div className="text-[11px] text-slate-400">{u.email}</div>
                  </td>
                  <td className="py-3 px-4">
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleOrTierChange(u._id, undefined, e.target.value)}
                      className="bg-dark-900 border border-white/[0.1] text-[11px] text-slate-300 rounded-lg px-2 py-1"
                    >
                      <option value="customer">Customer</option>
                      <option value="admin">Admin</option>
                      <option value="super_admin">Super Admin</option>
                      <option value="team_member">Team Member</option>
                    </select>
                  </td>
                  <td className="py-3 px-4">
                    <select
                      value={u.planTier || 'free'}
                      onChange={(e) => handleRoleOrTierChange(u._id, e.target.value, undefined)}
                      className="bg-dark-900 border border-white/[0.1] text-[11px] text-indigo-300 font-semibold rounded-lg px-2 py-1 uppercase"
                    >
                      <option value="free">Free</option>
                      <option value="starter">Starter (₹499)</option>
                      <option value="creator">Creator (₹999)</option>
                      <option value="pro">Pro (₹1,999)</option>
                      <option value="agency">Agency (₹4,999)</option>
                    </select>
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-mono font-bold text-amber-400">
                      {formatCredits(u.creditBalance)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-500 text-[11px]">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => setSelectedUser(u)}
                      className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 font-bold text-[11px] border border-indigo-500/30 transition-colors"
                    >
                      Adjust Credits
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Credit Adjustment Modal */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-dark-850 border border-white/[0.1] rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div>
                <h3 className="text-sm font-bold text-white">Adjust Credits</h3>
                <p className="text-[11px] text-slate-400">{selectedUser.fullName} ({selectedUser.email})</p>
              </div>
              <button onClick={() => setSelectedUser(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleAdjustCredits} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">Credit Amount (+ to grant, - to deduct)</label>
                <input
                  type="number"
                  value={adjustmentAmount}
                  onChange={(e) => setAdjustmentAmount(parseInt(e.target.value) || 0)}
                  className="w-full bg-dark-900 border border-white/[0.1] rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">Audit Reason / Description</label>
                <input
                  type="text"
                  value={adjustmentDesc}
                  onChange={(e) => setAdjustmentDesc(e.target.value)}
                  placeholder="e.g. Compensation for render timeout, Promo bonus"
                  className="w-full bg-dark-900 border border-white/[0.1] rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAdjusting}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
                >
                  {isAdjusting ? 'Updating Ledger...' : 'Confirm Ledger Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboardPage;

