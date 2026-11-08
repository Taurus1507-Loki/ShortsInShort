import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import { CreditTransaction } from '../types/index.js';
import {
  CreditCard,
  Zap,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  ShieldCheck,
  Receipt,
} from 'lucide-react';
import { formatCredits, formatCurrencyINR } from '../utils/cn.js';

export const BillingPage: React.FC = () => {
  const { user, refreshUser } = useAuth();

  const [history, setHistory] = useState<CreditTransaction[]>([]);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const txs = await api.get<CreditTransaction[]>('/credits/history');
        setHistory(txs);
      } catch (err) {
        console.error('Failed to load credit history:', err);
      }
    };
    fetchHistory();
  }, []);

  const handleSimulateUpgrade = async (planTier: string, amountInr: number) => {
    try {
      setIsProcessing(true);
      // In production, Razorpay Checkout SDK script is invoked here
      alert(
        `Razorpay Checkout Initialized:\nPlan: ${planTier.toUpperCase()}\nAmount: ₹${amountInr}\nCurrency: INR\n\n(Live checkout webhook connects on production Razorpay API keys)`
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      <div>
        <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
          <CreditCard className="w-6 h-6 text-brand-400" />
          <span>Subscription & Video Credits</span>
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage your subscription tier, buy top-up credit packs, and review your credit usage audit ledger.
        </p>
      </div>

      {/* Current Plan Overview Card */}
      <div className="p-6 rounded-3xl bg-gradient-to-r from-brand-950/60 via-dark-850 to-dark-850 border border-brand-500/30 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-brand-500/20 text-brand-300">
              Active Tier
            </span>
            <span className="text-xl font-black text-white capitalize">{user?.planTier || 'Free'} Plan</span>
          </div>
          <p className="text-xs text-slate-400 max-w-md">
            Credits never expire while your account is in good standing. Failed renders automatically refund to your ledger.
          </p>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-xs text-slate-400">Available Credits</div>
            <div className="text-3xl font-black text-white flex items-center gap-1.5 justify-end">
              <Zap className="w-5 h-5 text-amber-400 fill-amber-400" />
              <span>{user ? formatCredits(user.creditBalance) : 0}</span>
            </div>
          </div>
          <button
            onClick={() => handleSimulateUpgrade('creator', 999)}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-brand-600 to-pink-600 hover:from-brand-500 hover:to-pink-500 text-white font-bold text-sm shadow-lg shadow-brand-600/30 transition-all"
          >
            Upgrade Plan
          </button>
        </div>
      </div>

      {/* Plan Selection Cards */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Available Plans in Indian Rupees (INR)</h2>
          <div className="flex items-center gap-3 text-xs font-semibold">
            <span className={billingCycle === 'monthly' ? 'text-white' : 'text-slate-500'}>Monthly</span>
            <button
              onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'annual' : 'monthly')}
              className="w-10 h-5 rounded-full bg-brand-600/30 border border-brand-500/50 p-0.5 flex items-center"
            >
              <div
                className={`w-3.5 h-3.5 rounded-full bg-brand-400 transition-all ${
                  billingCycle === 'annual' ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
            <span className={billingCycle === 'annual' ? 'text-white' : 'text-slate-500'}>
              Annual (-20%)
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          {/* Starter */}
          <div className="p-5 rounded-2xl bg-dark-850 border border-white/[0.08] flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-white text-base">Starter</h3>
              <div className="text-2xl font-black text-white mt-2 mb-4">
                {billingCycle === 'monthly' ? '₹499' : '₹399'}
                <span className="text-xs text-slate-500 font-normal"> /mo</span>
              </div>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                  <span>20 Video Credits</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                  <span>1080p Export Quality</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                  <span>No Watermark</span>
                </li>
              </ul>
            </div>
            <button
              onClick={() => handleSimulateUpgrade('starter', 499)}
              className="mt-6 w-full py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white text-xs font-bold transition-colors"
            >
              Switch to Starter
            </button>
          </div>

          {/* Creator */}
          <div className="p-5 rounded-2xl bg-gradient-to-b from-brand-900/30 via-dark-850 to-dark-850 border-2 border-brand-500 flex flex-col justify-between relative shadow-lg shadow-brand-500/20">
            <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-brand-500 text-white uppercase tracking-wider absolute -top-2.5 right-4">
              Recommended
            </span>
            <div>
              <h3 className="font-bold text-white text-base">Creator</h3>
              <div className="text-2xl font-black text-brand-400 mt-2 mb-4">
                {billingCycle === 'monthly' ? '₹999' : '₹799'}
                <span className="text-xs text-slate-500 font-normal"> /mo</span>
              </div>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                  <span className="font-bold text-white">50 Video Credits</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                  <span>AI Avatar Studio</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                  <span>Submagic Neon Captions</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                  <span>Custom Brand Kit</span>
                </li>
              </ul>
            </div>
            <button
              onClick={() => handleSimulateUpgrade('creator', 999)}
              className="mt-6 w-full py-2 rounded-xl bg-gradient-to-r from-brand-600 to-pink-600 hover:from-brand-500 text-white text-xs font-bold transition-all"
            >
              Get Creator Plan
            </button>
          </div>

          {/* Pro */}
          <div className="p-5 rounded-2xl bg-dark-850 border border-white/[0.08] flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-white text-base">Pro Studio</h3>
              <div className="text-2xl font-black text-white mt-2 mb-4">
                {billingCycle === 'monthly' ? '₹1,999' : '₹1,599'}
                <span className="text-xs text-slate-500 font-normal"> /mo</span>
              </div>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                  <span>120 Video Credits</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                  <span>4K Ultra-HD Output</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                  <span>Priority GPU Queue</span>
                </li>
              </ul>
            </div>
            <button
              onClick={() => handleSimulateUpgrade('pro', 1999)}
              className="mt-6 w-full py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white text-xs font-bold transition-colors"
            >
              Switch to Pro
            </button>
          </div>

          {/* Agency */}
          <div className="p-5 rounded-2xl bg-dark-850 border border-white/[0.08] flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-white text-base">Agency</h3>
              <div className="text-2xl font-black text-white mt-2 mb-4">
                {billingCycle === 'monthly' ? '₹4,999' : '₹3,999'}
                <span className="text-xs text-slate-500 font-normal"> /mo</span>
              </div>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                  <span>350 Video Credits</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                  <span>15 Team Members</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" />
                  <span>Dedicated Render Node</span>
                </li>
              </ul>
            </div>
            <button
              onClick={() => handleSimulateUpgrade('agency', 4999)}
              className="mt-6 w-full py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white text-xs font-bold transition-colors"
            >
              Switch to Agency
            </button>
          </div>
        </div>
      </div>

      {/* Credit Ledger Audit History */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Receipt className="w-5 h-5 text-slate-400" />
          <span>Credit Ledger & Transaction Audit</span>
        </h2>

        {history.length === 0 ? (
          <div className="p-8 rounded-2xl bg-dark-850 border border-white/[0.08] text-center text-xs text-slate-500">
            No credit transactions recorded yet.
          </div>
        ) : (
          <div className="rounded-2xl bg-dark-850 border border-white/[0.08] overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-dark-900 border-b border-white/[0.06] text-slate-400 font-semibold uppercase">
                <tr>
                  <th className="p-4">Operation</th>
                  <th className="p-4">Description</th>
                  <th className="p-4 text-right">Amount</th>
                  <th className="p-4 text-right">Balance After</th>
                  <th className="p-4 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {history.map((tx) => (
                  <tr key={tx._id} className="hover:bg-white/[0.02]">
                    <td className="p-4 font-mono capitalize text-slate-300">
                      {tx.operation.replace('_', ' ')}
                    </td>
                    <td className="p-4 text-slate-300">{tx.description}</td>
                    <td className="p-4 text-right font-bold">
                      <span className={tx.amount > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                      </span>
                    </td>
                    <td className="p-4 text-right font-semibold text-white">
                      {formatCredits(tx.balanceAfter)}
                    </td>
                    <td className="p-4 text-right text-slate-500">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

