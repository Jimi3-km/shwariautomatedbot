import React, { useState, useEffect, useRef } from 'react';
import {
  Settings as SettingsIcon, MessageSquare, Smartphone, Activity,
  RefreshCw, Save, Trash2, Edit2, Plus, Check, ArrowLeft,
  DollarSign, Users, Package, TrendingUp, Image, Upload, Play, X,
  CreditCard, Lock, AlertTriangle, ExternalLink, LogOut, UserPlus, Shield,
  Inbox, Send, Receipt, ChevronDown
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';

// =============================================================================
// TYPES — 1:1 with database schema
// =============================================================================
type Phone = {
  id: number;
  'Phone Model': string;
  Specs: string;
  'Cash Price': string | number;
  Deposit?: string | number;
  '12 Weeks'?: string | number;
  Deposit_1?: string | number;
  '24 Weeks'?: string | number;
  availability: boolean;
  notes?: string;
  image_url?: string;
  updated_at?: string;
  created_at?: string;
};

type Accessory = {
  id: string;
  brand: string;
  accessory_name: string;
  price: number;
  currency: string;
  stock: number;
  description?: string;
  image_url?: string;
  is_featured: boolean;
  is_available: boolean;
  created_at: string;
  updated_at: string;
};

type Lead = {
  id: number;
  phone: string;
  email?: string;
  interest?: string;
  intent?: string;
  urgency?: string;
  delivery_location?: string;
  payment_method?: string;
  stage: string;
  last_message?: string;
  last_contact: string;
  created_at: string;
  transaction_code?: string;
  product_model?: string;
  product_storage?: string;
  product_condition?: string;
  upsell_items?: string;
  customer_name?: string;
  bot_status?: 'bot' | 'human';
};

type ConversationLog = {
  id?: number;
  customer_phone: string;
  customer_name?: string;
  message?: string;
  direction?: 'incoming' | 'outgoing';
  channel?: string;
  timestamp?: string;
};

type Payment = {
  id: string;
  customer_phone: string;
  customer_email?: string;
  customer_name?: string;
  transaction_code: string;
  amount: number;
  payment_method?: string;
  delivery_location?: string;
  payment_status: string;
  created_at: string;
  updated_at?: string;
  product_model?: string;
  product_storage?: string;
  product_condition?: string;
  upsell_items?: string;
};

// =============================================================================
// HELPERS
// =============================================================================
const fmt = (val: any): string => {
  if (val === null || val === undefined || val === '') return '—';
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? String(val) : n.toLocaleString();
};

const STAGES: Record<string, string> = {
  new: 'New', interested: 'Interested', quoted: 'Quoted',
  location_collected: 'Delivery Set', payment_submitted: 'Payment In',
  closed: 'Sold', lost: 'Lost',
};

const urgencyBadge = (u?: string) => {
  switch (u) {
    case 'high': return 'badge badge-orange';
    case 'medium': return 'badge badge-yellow';
    default: return 'badge badge-neutral';
  }
};

const statusBadge = (s: string) =>
  (s === 'confirmed' || s === 'completed') ? 'badge badge-green' : 'badge badge-yellow';

// =============================================================================
// NAV
// =============================================================================
const NAV = [
  { id: 'overview', label: 'Overview', icon: <Activity size={15} /> },
  { id: 'inbox', label: 'Inbox', icon: <Inbox size={15} /> },
  { id: 'pricelist', label: 'Inventory', icon: <Smartphone size={15} /> },
  { id: 'leads', label: 'Leads', icon: <Users size={15} /> },
  { id: 'payments', label: 'Sales', icon: <DollarSign size={15} /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={15} /> },
];

import { createClient } from '@supabase/supabase-js';

export let supabase: any = null;

// =============================================================================
// AUTH FETCH — wraps fetch with JWT bearer token
// =============================================================================
async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const headers: any = { ...(opts.headers || {}) };
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  }
  // Don't set Content-Type for FormData (browser sets multipart boundary)
  if (!(opts.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, { ...opts, headers });
}

// =============================================================================
// AUTH
// =============================================================================
function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
    setLoading(false);
  };

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 400, padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, background: '#fff', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Shield size={24} style={{ color: '#000' }} />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>Admin Access</h1>
          <p style={{ fontSize: 14, color: 'var(--text-4)', marginTop: 8 }}>Secure dashboard login</p>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Email Address</label>
            <input className="inp" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@brand.com" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Password</label>
            <input className="inp" type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          {error && <div style={{ fontSize: 13, color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '8px 12px', borderRadius: 8 }}>{error}</div>}
          <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: 8, height: 48, fontSize: 15 }} disabled={loading}>
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// =============================================================================
// APP WRAPPER (Initializes Supabase)
// =============================================================================
export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch('/api/public-env').then(r => r.json()).then(d => {
      if (d.SUPABASE_URL && d.SUPABASE_ANON_KEY && !supabase) {
        supabase = createClient(d.SUPABASE_URL, d.SUPABASE_ANON_KEY);
      }
      setReady(true);
    }).catch(() => setReady(true));
  }, []);

  if (!ready) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#fff' }}>Initializing...</div>;
  if (!supabase) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#fff' }}>Missing Supabase Config. Please check the backend settings.</div>;

  return <Dashboard />;
}

const INBOX_LABELS: Record<string, string> = {
  '1044226772116764': 'Shwari Students',
  '1141388965725319': 'Shwari Accessories',
  'all': 'All Accounts'
};

// =============================================================================
// DASHBOARD
// =============================================================================
function Dashboard() {
  const [tab, setTab] = useState('overview');
  const [globalInbox, setGlobalInbox] = useState('1044226772116764');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [brandName, setBrandName] = useState('');
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    // 1. Load Paystack
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    document.body.appendChild(script);

    // 2. Auth Listener
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }: any) => {
        setUser(session?.user ?? null);
        if (session?.user) syncProfile(session.user);
      });

      const { data: { subscription: authListener } } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
        setUser(session?.user ?? null);
        if (session?.user) syncProfile(session.user);
      });
      return () => authListener.unsubscribe();
    }
  }, []);

  const fetchPayments = async () => {
    try {
      const r = await authFetch(`/api/payments?inbox=${globalInbox}`);
      if (r.ok) setPayments(await r.json());
    } catch { }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const res = await authFetch('/api/subscription');
        if (res.ok) setSubscription(await res.json());
      } catch (e) { console.error(e); }

      await fetchPayments();

      // Load brand settings
      try {
        const br = await authFetch('/api/app-settings');
        if (br.ok) {
          const data = await br.json();
          const name = data.brand_name || '';
          setBrandName(name);
          if (!name || name === 'Shwari Agent' || !data.brand_phone) setShowOnboarding(true);
        }
      } catch { }

      setLoading(false);
    };
    if (user) {
      load();
      const id = setInterval(fetchPayments, 60000); // Refresh sales every minute
      return () => clearInterval(id);
    }
    else setLoading(false);
  }, [user]);

  const syncProfile = async (u: any) => {
    try {
      await authFetch('/api/profiles/sync', {
        method: 'POST',
        body: JSON.stringify({ id: u.id, email: u.email, full_name: u.user_metadata?.full_name || u.email.split('@')[0] })
      });
    } catch (e) { console.error(e); }
  };

  const completeOnboarding = async (data: { name: string, phone: string, address: string }) => {
    await authFetch('/api/app-settings', {
      method: 'POST',
      body: JSON.stringify({ key: 'brand_name', value: data.name })
    });
    await authFetch('/api/app-settings', {
      method: 'POST',
      body: JSON.stringify({ key: 'brand_phone', value: data.phone })
    });
    await authFetch('/api/app-settings', {
      method: 'POST',
      body: JSON.stringify({ key: 'brand_address', value: data.address })
    });
    setBrandName(data.name);
    setShowOnboarding(false);
  };

  if (loading) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#fff' }}>Loading Dashboard...</div>;
  if (!user) return <LoginScreen />;
  if (showOnboarding) return <OnboardingScreen onComplete={completeOnboarding} defaultName={brandName} userEmail={user.email} />;

  const isGodmode = user?.email === 'jameskoikai04@gmail.com';
  const isExpired = !isGodmode && subscription?.status === 'expired';
  const daysLeft = isGodmode ? 9999 : (subscription?.expiry_date ? differenceInDays(new Date(subscription.expiry_date), new Date()) : 30);
  const showReminder = !isGodmode && !isExpired && daysLeft <= 3 && daysLeft >= 0;

  const handlePaymentSuccess = async (ref: string) => {
    try {
      const res = await authFetch('/api/subscription/verify', {
        method: 'POST',
        body: JSON.stringify({ reference: ref })
      });
      if (res.ok) window.location.reload();
      else alert('Payment verification failed. Please contact support.');
    } catch { alert('Network error during verification.'); }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#000', overflow: 'hidden' }}>
      {/* SIDEBAR */}
      <aside className="sidebar hidden md:flex" style={{ width: 216, flexShrink: 0, flexDirection: 'column' }}>
        {/* Brand */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, background: '#fff', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontWeight: 800, fontSize: 13, color: '#000', lineHeight: 1 }}>{(brandName || 'S').charAt(0).toUpperCase()}</span>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', letterSpacing: '-0.02em' }}>{brandName || 'Dashboard'}</div>
                {isGodmode && <span style={{ fontSize: 9, background: '#fff', color: '#000', padding: '1px 5px', borderRadius: 4, fontWeight: 800, textTransform: 'uppercase' }}>Unlimited</span>}
              </div>
              <div className="section-label" style={{ marginTop: 1, fontSize: 9 }}>Operations Hub</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(n => (
            <button key={n.id} className={`nav-item${tab === n.id ? ' active' : ''}`} onClick={() => setTab(n.id)}>
              <span style={{ opacity: tab === n.id ? 1 : 0.5 }}>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>

        {/* Global Inbox Selector */}
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-4)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>View Data For:</div>
          <select
            value={globalInbox}
            onChange={e => setGlobalInbox(e.target.value)}
            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', color: '#fff', padding: '8px 12px', borderRadius: 8, fontSize: 13, outline: 'none' }}
          >
            {Object.entries(INBOX_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {/* Status */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 6, height: 6, background: '#4ade80', borderRadius: '50%', flexShrink: 0, boxShadow: '0 0 5px #4ade8066' }} />
            <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>WhatsApp connected</span>
          </div>
        </div>

        {/* Logout */}
        <div style={{ padding: '8px 16px 16px' }}>
          <button className="btn-ghost" style={{ width: '100%', fontSize: 12, justifyContent: 'center' }} onClick={async () => { await supabase.auth.signOut(); setUser(null); }}>
            <LogOut size={13} /> Sign Out
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{ flex: 1, overflow: 'auto', padding: isExpired ? 0 : '28px 32px', paddingBottom: 80, position: 'relative' }} className="md:pb-8">
        {showReminder && (
          <div style={{ background: '#f59e0b', color: '#000', padding: '10px 20px', borderRadius: 8, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12, fontWeight: 600, fontSize: 13 }}>
            <AlertTriangle size={16} />
            Your subscription expires in {daysLeft} {daysLeft === 1 ? 'day' : 'days'}. Please renew soon to avoid dashboard lockout.
          </div>
        )}

        {isExpired ? (
          <Paywall subscription={subscription} onPaymentSuccess={handlePaymentSuccess} />
        ) : (
          <>
            {tab === 'overview' && <OverviewTab onNavigate={setTab} payments={payments} globalInbox={globalInbox} />}
            {tab === 'inbox' && <InboxTab globalInbox={globalInbox} />}
            {tab === 'pricelist' && <PricelistTab />}
            {tab === 'leads' && <LeadsTab globalInbox={globalInbox} />}
            {tab === 'payments' && <PaymentsTab payments={payments} />}
            {tab === 'settings' && <SettingsTab />}
          </>
        )}
      </main>

      {/* MOBILE NAV */}
      <nav className="md:hidden" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#050505', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-around', padding: '8px 0', zIndex: 50 }}>
        {NAV.slice(0, 4).map(n => (
          <button key={n.id} onClick={() => setTab(n.id)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 12px', color: tab === n.id ? '#fff' : '#444' }}>
            {n.icon}
            <span style={{ fontSize: 9, letterSpacing: '0.05em', fontWeight: 600, textTransform: 'uppercase' }}>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// =============================================================================
// ONBOARDING SCREEN
// =============================================================================
function OnboardingScreen({ onComplete, defaultName, userEmail }: { onComplete: (data: { name: string, phone: string, address: string }) => void, defaultName: string, userEmail: string }) {
  const [name, setName] = useState(defaultName || '');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    await onComplete({ name, phone, address });
    setLoading(false);
  };

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 500, padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, background: '#fff', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Smartphone size={24} style={{ color: '#000' }} />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>Welcome to Shwari</h1>
          <p style={{ fontSize: 14, color: 'var(--text-4)', marginTop: 8 }}>Let's set up your business profile</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Business Name</label>
            <input className="inp" required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Shwari iPhones" style={{ fontSize: 16 }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Contact Phone</label>
              <input className="inp" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+254..." />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Business City</label>
              <input className="inp" required value={address} onChange={e => setAddress(e.target.value)} placeholder="Nairobi" />
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 12, border: '1px solid var(--border)' }}>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>Account Email</p>
            <p style={{ fontSize: 14, color: '#fff', fontWeight: 500 }}>{userEmail}</p>
          </div>

          <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: 8, height: 48, fontSize: 15 }} disabled={loading}>
            {loading ? 'Setting up...' : 'Complete Setup'}
          </button>
        </form>
      </div>
    </div>
  );
}

// =============================================================================
// OVERVIEW
// =============================================================================
function OverviewTab({ onNavigate, payments, globalInbox }: { onNavigate: (t: string) => void; payments: Payment[], globalInbox: string }) {
  const [stats, setStats] = useState<any>({});
  useEffect(() => { authFetch(`/api/stats?inbox=${globalInbox}`).then(r => r.json()).then(d => { if (!d.error) setStats(d); }).catch(() => { }); }, [globalInbox]);

  const kpis = [
    { label: 'Revenue', value: `KES ${(stats.totalRevenue || 0).toLocaleString()}`, sub: 'Confirmed sales', icon: <TrendingUp size={15} /> },
    { label: 'Sales Closed', value: stats.totalSales || 0, sub: 'All time', icon: <Check size={15} /> },
    { label: 'Active Leads', value: stats.totalLeads || 0, sub: 'In pipeline', icon: <Users size={15} /> },
    { label: 'In Stock', value: stats.inventory?.inStock || 0, sub: 'Listed items', icon: <Package size={15} /> },
  ];

  const recent = payments.slice(0, 6);

  return (
    <div style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div>
        <h1 className="page-title">Overview</h1>
        <p className="body-text" style={{ marginTop: 4 }}>{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        {kpis.map((k, i) => (
          <div className="kpi-card" key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <span className="kpi-label">{k.label}</span>
              <span style={{ color: 'var(--text-4)' }}>{k.icon}</span>
            </div>
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="card" style={{ padding: '20px 24px' }}>
        <p className="section-label" style={{ marginBottom: 14 }}>Quick Actions</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={() => onNavigate('pricelist')}><Plus size={14} /> Add Phone</button>
          <button className="btn-ghost" onClick={() => onNavigate('leads')}><Users size={14} /> View Pipeline</button>
          <button className="btn-ghost" onClick={() => onNavigate('settings')}><SettingsIcon size={14} /> Settings</button>
        </div>
      </div>

      {/* Recent Sales */}
      {recent.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <p className="section-label">Recent Sales</p>
          </div>
          <table className="tbl">
            <thead><tr><th>Customer</th><th>Product</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {recent.map(p => (
                <tr key={p.id}>
                  <td className="primary">{p.customer_name || p.customer_phone}</td>
                  <td>{p.product_model || '—'}{p.product_storage ? ` · ${p.product_storage}` : ''}</td>
                  <td className="primary" style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>KES {fmt(p.amount)}</td>
                  <td><span className={statusBadge(p.payment_status)}>{p.payment_status === 'confirmed' ? 'Sold' : p.payment_status}</span></td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-3)' }}>{format(new Date(p.created_at), 'MMM d, HH:mm')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PRICELIST / INVENTORY
// =============================================================================
function PricelistTab() {
  const [phones, setPhones] = useState<any[]>([]);
  const [form, setForm] = useState<any>({});
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [previewId, setPreviewId] = useState<string | number | null>(null);
  const [category, setCategory] = useState('general_pricelist');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, [category]);

  const load = () =>
    authFetch(`/api/pricelist?category=${category}`).then(r => r.json()).then(d => { if (!d.error) setPhones(d); }).catch(() => { });

  const reset = () => { setForm({}); setEditingId(null); setPreviewId(null); if (fileRef.current) fileRef.current.value = ''; };

  const save = async () => {
    setSaving(true);
    try {
      const url = editingId ? `/api/pricelist/${editingId}?category=${category}` : `/api/pricelist?category=${category}`;
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (k === 'photoFile' && v) fd.append('photo', v as File);
        else if (k !== 'photoFile' && v !== undefined && v !== null) fd.append(k, String(v));
      });
      // Handle boolean availability/stock
      if (category === 'accessories') {
        fd.set('is_available', form.is_available !== false ? 'true' : 'false');
      } else {
        fd.set('availability', form.availability !== false ? 'true' : 'false');
      }
      const r = await authFetch(url, { method: editingId ? 'PUT' : 'POST', body: fd });
      const json = await r.json();
      if (!r.ok || json.error) throw new Error(json.error || 'Save failed');
      reset(); load();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const del = async (id: string | number) => {
    if (!confirm('Delete this item?')) return;
    await authFetch(`/api/pricelist/${id}?category=${category}`, { method: 'DELETE' });
    load();
  };

  const isLipa = category === 'lipa_mdogo_mdogo';
  const isAcc = category === 'accessories';

  const categoryLabels: Record<string, string> = {
    general_pricelist: 'General',
    lipa_mdogo_mdogo: 'Lipa Mdogo',
    accessories: 'Accessories'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="body-text" style={{ marginTop: 4 }}>{phones.length} products in {categoryLabels[category]} pricelist</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {Object.entries(categoryLabels).map(([id, label]) => (
            <button key={id} onClick={() => { setCategory(id); setPreviewId(null); setEditingId(null); setForm({}); }} style={{
              background: category === id ? '#fff' : 'transparent',
              color: category === id ? '#000' : 'var(--text-3)',
              border: `1px solid ${category === id ? '#fff' : 'var(--border-2)'}`,
              borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s'
            }}>{label}</button>
          ))}
        </div>
      </div>

      {previewId ? (() => {
        const p = phones.find(x => x.id === previewId);
        if (!p) return null;
        const title = isAcc ? p.accessory_name : p['Phone Model'];
        const sub = isAcc ? p.brand : p.Specs;

        return (
          <div className="card" style={{ padding: 24, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 300px', maxWidth: 400 }}>
              {p.image_url ? (
                <img src={p.image_url} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 12, border: '1px solid var(--border)' }} alt={title} />
              ) : (
                <div style={{ width: '100%', aspectRatio: '1', background: 'var(--surface-2)', borderRadius: 12, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)' }}>
                  <Image size={48} />
                </div>
              )}
            </div>
            <div style={{ flex: '2 1 300px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--white)', letterSpacing: '-0.03em', lineHeight: 1.2 }}>{title}</h2>
                  <p style={{ color: 'var(--text-3)', fontSize: 14, marginTop: 4 }}>{sub}</p>
                </div>
                <button className="btn-icon" onClick={() => setPreviewId(null)}><X size={15} /></button>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: -4 }}>
                <span className={`badge ${((isAcc ? p.is_available : p.availability) !== false) ? 'badge-green' : 'badge-red'}`}>{((isAcc ? p.is_available : p.availability) !== false) ? 'In Stock' : 'Out of Stock'}</span>
                {isAcc && p.is_featured && <span className="badge badge-purple">Featured</span>}
              </div>

              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 16, border: '1px solid var(--border)', marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Pricing Details</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{isAcc ? 'Price' : 'Cash Price'}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>KES {fmt(isAcc ? p.price : p['Cash Price'])}</div>
                  </div>
                  {isAcc && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-4)' }}>Stock Status</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{p.stock} Units</div>
                    </div>
                  )}
                  {isLipa && (
                    <>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>Deposit</div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{fmt(p.Deposit)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>12 Weeks</div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{fmt(p['12 Weeks'])}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>Deposit 1</div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{fmt(p.Deposit_1)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>24 Weeks</div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{fmt(p['24 Weeks'])}</div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {(p.notes || p.description) && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Notes & Info</div>
                  <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5, background: 'var(--surface-2)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>{p.notes || p.description}</p>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 16 }}>
                <button className="btn-primary" onClick={() => { setForm(p); setEditingId(p.id); setPreviewId(null); }}><Edit2 size={14} /> Edit Product</button>
                <button className="btn-ghost" onClick={() => del(p.id)} style={{ color: '#ef4444', borderColor: '#451a1a' }}><Trash2 size={14} /> Delete</button>
              </div>
            </div>
          </div>
        );
      })() : editingId || Object.keys(form).length > 0 ? (
        /* Form */
        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <p className="section-label">{editingId ? 'Edit Product' : 'Add New Product'}</p>
            <button className="btn-icon" onClick={reset}><X size={13} /></button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginBottom: 12 }}>
            {!isAcc ? (
              <>
                <input className="inp" placeholder="Model (Phone Model)" value={form['Phone Model'] || ''} onChange={e => setForm({ ...form, 'Phone Model': e.target.value })} />
                <input className="inp" placeholder="Specs (Features)" value={form.Specs || ''} onChange={e => setForm({ ...form, Specs: e.target.value })} />
                <input className="inp" placeholder="Cash Price (KES)" type="number" value={form['Cash Price'] || ''} onChange={e => setForm({ ...form, 'Cash Price': e.target.value })} />
              </>
            ) : (
              <>
                <input className="inp" placeholder="Brand (e.g. Apple)" value={form.brand || ''} onChange={e => setForm({ ...form, brand: e.target.value })} />
                <input className="inp" placeholder="Accessory Name" value={form.accessory_name || ''} onChange={e => setForm({ ...form, accessory_name: e.target.value })} />
                <input className="inp" placeholder="Price (KES)" type="number" value={form.price || ''} onChange={e => setForm({ ...form, price: e.target.value })} />
                <input className="inp" placeholder="Stock Quantity" type="number" value={form.stock || ''} onChange={e => setForm({ ...form, stock: e.target.value })} />
              </>
            )}
            {isLipa && <>
              <input className="inp" placeholder="Initial Deposit" type="number" value={form.Deposit || ''} onChange={e => setForm({ ...form, Deposit: e.target.value })} />
              <input className="inp" placeholder="12 Weeks Plan" type="number" value={form['12 Weeks'] || ''} onChange={e => setForm({ ...form, '12 Weeks': e.target.value })} />
              <input className="inp" placeholder="Deposit 1 (Alt)" type="number" value={form.Deposit_1 || ''} onChange={e => setForm({ ...form, Deposit_1: e.target.value })} />
              <input className="inp" placeholder="24 Weeks Plan" type="number" value={form['24 Weeks'] || ''} onChange={e => setForm({ ...form, '24 Weeks': e.target.value })} />
            </>}
            <input className="inp" placeholder={isAcc ? "Description" : "Notes (optional)"} value={isAcc ? (form.description || '') : (form.notes || '')} onChange={e => setForm({ ...form, [isAcc ? 'description' : 'notes']: e.target.value })} />
          </div>

          {/* Photo upload + availability row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/jpg" style={{ display: 'none' }} onChange={e => setForm({ ...form, photoFile: e.target.files?.[0] })} />
            <button className="btn-ghost" type="button" onClick={() => fileRef.current?.click()} style={{ fontSize: 12 }}>
              <Upload size={12} />{form.photoFile ? form.photoFile.name : form.image_url ? 'Replace Photo' : 'Upload Photo (JPG/PNG)'}
            </button>
            {form.image_url && !form.photoFile && (
              <img src={form.image_url} style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border)' }} alt="" />
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
              {isAcc && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={form.is_featured === 'true' || form.is_featured === true} onChange={e => setForm({ ...form, is_featured: e.target.checked })} style={{ accentColor: '#fff', width: 14, height: 14, cursor: 'pointer' }} />
                  Featured
                </label>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={(isAcc ? form.is_available : form.availability) !== false} onChange={e => setForm({ ...form, [isAcc ? 'is_available' : 'availability']: e.target.checked })} style={{ accentColor: '#fff', width: 14, height: 14, cursor: 'pointer' }} />
                In Stock
              </label>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editingId ? <><Save size={13} /> Save Changes</> : <><Plus size={13} /> Add Product</>}
            </button>
          </div>
        </div>
      ) : (
        /* Table */
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p className="section-label">All {categoryLabels[category]} Items</p>
            <button className="btn-primary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => { setForm({}); setEditingId(null); setPreviewId(null); setForm({ [isAcc ? 'is_available' : 'availability']: true }); }}><Plus size={12} /> Add New</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{isAcc ? 'Accessory' : 'Product'}</th>
                  <th>{isAcc ? 'Brand' : 'Specs'}</th>
                  <th>Price</th>
                  {isLipa && <><th>Deposit</th><th>12W Plan</th><th>24W Plan</th></>}
                  {isAcc && <th>Stock</th>}
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {phones.map(p => {
                  const title = isAcc ? p.accessory_name : p['Phone Model'];
                  const subtitle = isAcc ? p.brand : p.Specs;
                  const price = isAcc ? p.price : p['Cash Price'];
                  const available = (isAcc ? p.is_available : p.availability) !== false;

                  return (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setPreviewId(p.id)}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {p.image_url
                            ? <img src={p.image_url} style={{ width: 36, height: 36, borderRadius: 7, objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }} alt={title} />
                            : <div style={{ width: 36, height: 36, background: 'var(--surface-2)', borderRadius: 7, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <Image size={14} style={{ color: 'var(--text-4)' }} />
                            </div>
                          }
                          <span style={{ color: 'var(--text)', fontWeight: 500, fontSize: 13 }}>{title}</span>
                          {isAcc && p.is_featured && <span style={{ fontSize: 8, background: 'var(--success)', color: '#000', padding: '1px 4px', borderRadius: 3, fontWeight: 800 }}>HOT</span>}
                        </div>
                      </td>
                      <td>{subtitle}</td>
                      <td style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontWeight: 600 }}>KES {fmt(price)}</td>
                      {isLipa && <>
                        <td style={{ fontFamily: 'var(--mono)' }}>{fmt(p.Deposit)}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{fmt(p['12 Weeks'])}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{fmt(p['24 Weeks'])}</td>
                      </>}
                      {isAcc && <td>{p.stock}</td>}
                      <td><span className={`badge ${available ? 'badge-green' : 'badge-red'}`}>{available ? 'In Stock' : 'Out of Stock'}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button className="btn-icon" onClick={(e) => { e.stopPropagation(); setEditingId(p.id); setForm(p); setPreviewId(null); }}><Edit2 size={13} /></button>
                          <button className="btn-icon danger" onClick={(e) => { e.stopPropagation(); del(p.id); }}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {phones.length === 0 && (
                  <tr><td colSpan={isLipa ? 8 : (isAcc ? 7 : 6)}>
                    <div className="empty-state"><Package size={28} /><p>No {categoryLabels[category]} items yet.</p></div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// INBOX
// =============================================================================

// Avatar palette — deterministic colour from initials
const AVATAR_PALETTE = [
  '#a3e635', '#34d399', '#38bdf8', '#818cf8', '#f472b6', '#fb923c', '#fbbf24', '#e879f9'
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const BAD_NAMES = ['hello', 'hi', 'hey', 'jambo', 'mambo', 'hujambo', 'karibu', 'sawa', 'okay', 'ok'];

function displayName(lead: Lead): string {
  const n = lead.customer_name?.trim();
  if (n && !BAD_NAMES.includes(n.toLowerCase())) return n;
  return lead.phone;
}

function InboxTab({ globalInbox }: { globalInbox: string }) {
  const [inbox, setInbox] = useState<string>(globalInbox === 'all' ? '1044226772116764' : globalInbox);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [convos, setConvos] = useState<ConversationLog[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(false);
  const [payForm, setPayForm] = useState({ code: '', amount: '', storage: '', condition: '' });
  const [busy, setBusy] = useState(false);
  const [receiptSent, setReceiptSent] = useState(false);
  const [humanReply, setHumanReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');

  // Sync with global inbox selector
  useEffect(() => {
    if (globalInbox !== 'all' && globalInbox !== inbox) {
      setInbox(globalInbox);
    }
  }, [globalInbox]);

  // Auto-fill payment form from selected lead
  useEffect(() => {
    if (selected) {
      setPayForm({
        code: selected.transaction_code || '',
        amount: selected.product_price || '',
        storage: selected.product_storage || '',
        condition: selected.product_condition || '',
      });
    }
  }, [selected]);

  // Scroll to bottom when convos load
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [convos]);

  const fetchLeads = (inboxKey: string) => {
    setLoading(true);
    authFetch(`/api/leads?inbox=${inboxKey}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setLeads(d); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setSelected(null);
    setConvos([]);
    fetchLeads(inbox);
    const id = setInterval(() => fetchLeads(inbox), 30000);
    return () => clearInterval(id);
  }, [inbox]);

  const selectLead = (l: Lead) => {
    setSelected(l);
    setReceiptSent(false);
    setLoadingConvos(true);
    authFetch(`/api/leads/${encodeURIComponent(l.phone)}/conversations`)
      .then(r => r.json())
      .then(d => { if (!d.error) setConvos(d); })
      .finally(() => setLoadingConvos(false));
  };

  const updateStage = async (phone: string, stage: string) => {
    await authFetch(`/api/leads/${encodeURIComponent(phone)}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) });
    fetchLeads(inbox);
  };

  const toggleBotMode = async () => {
    if (!selected) return;
    const newMode = selected.bot_status === 'human' ? 'bot' : 'human';
    await authFetch(`/api/leads/${encodeURIComponent(selected.phone)}/mode`, {
      method: 'PUT',
      body: JSON.stringify({ mode: newMode })
    });
    setSelected({ ...selected, bot_status: newMode });
    fetchLeads(inbox);
  };

  const sendHumanReply = async () => {
    if (!selected || !humanReply.trim()) return;
    setReplying(true);
    try {
      const res = await authFetch(`/api/leads/${encodeURIComponent(selected.phone)}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message: humanReply })
      });
      if (res.ok) {
        const newMessage = {
          direction: 'outgoing-human',
          message: humanReply,
          timestamp: new Date().toISOString(),
          agent_name: 'Admin'
        };
        setConvos([...convos, newMessage]);
        setHumanReply('');
        // Sync with server after a short delay
        setTimeout(() => {
          authFetch(`/api/leads/${encodeURIComponent(selected.phone)}/conversations`)
            .then(r => r.json())
            .then(d => { if (!d.error) setConvos(d); });
        }, 3000);
      }
    } finally {
      setReplying(false);
    }
  };

  const saveLeadName = async () => {
    if (!selected || !newName.trim()) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/leads/${encodeURIComponent(selected.phone)}/name`, {
        method: 'PUT',
        body: JSON.stringify({ name: newName })
      });
      if (res.ok) {
        setSelected({ ...selected, customer_name: newName });
        fetchLeads(inbox);
        setEditingName(false);
      }
    } catch (e) { console.error(e); }
    setBusy(false);
  };

  const sendPhotoReply = async () => {
    if (!selected || !photoFile) return;
    setSendingPhoto(true);
    try {
      const formData = new FormData();
      formData.append('photo', photoFile);
      if (humanReply.trim()) formData.append('caption', humanReply);

      const res = await authFetch(`/api/leads/${encodeURIComponent(selected.phone)}/photo`, {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        const newMessage = {
          direction: 'outgoing-human',
          message: `[PHOTO] ${humanReply}`.trim(),
          timestamp: new Date().toISOString(),
          agent_name: 'Admin'
        };
        setConvos([...convos, newMessage]);
        setPhotoFile(null);
        setHumanReply('');
        setTimeout(() => {
          authFetch(`/api/leads/${encodeURIComponent(selected.phone)}/conversations`)
            .then(r => r.json())
            .then(d => { if (!d.error) setConvos(d); });
        }, 4000);
      } else {
        alert('Failed to send photo');
      }
    } finally {
      setSendingPhoto(false);
    }
  };

  const savePayment = async (sendReceipt: boolean) => {
    if (!selected || !payForm.code || !payForm.amount) {
      alert('Missing info'); return;
    }
    setBusy(true);
    try {
      await authFetch('/api/payments', {
        method: 'POST',
        body: JSON.stringify({
          transaction_code: payForm.code,
          customer_phone: selected.phone,
          customer_name: selected.customer_name || '',
          amount: parseFloat(payForm.amount),
          payment_status: 'confirmed',
          product_model: selected.product_model || selected.interest || '',
          product_storage: payForm.storage,
          product_condition: payForm.condition,
        })
      });

      if (sendReceipt) {
        await authFetch('/api/send-receipt', {
          method: 'POST',
          body: JSON.stringify({ phone: selected.phone, transaction_code: payForm.code })
        });
        setReceiptSent(true);
      }
      alert('Payment saved');
      updateStage(selected.phone, 'payment_submitted');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const productLabel = selected?.product_model ? `${selected.product_model} ${selected.product_storage || ''}`.trim() : selected?.interest || 'N/A';

  return (
    <div className="inbox-layout">
      <div className="inbox-list-pane">
        <div className="inbox-list-header">
          <div className="inbox-tabs">
            {Object.keys(INBOX_LABELS).filter(k => k !== 'all').map(key => (
              <button
                key={key}
                className={`inbox-tab-btn ${inbox === key ? 'active' : ''}`}
                onClick={() => setInbox(key)}
              >
                {INBOX_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        <div className="inbox-list-scroll">
          {loading && (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-4)' }}>
              <RefreshCw size={16} className="spin" />
            </div>
          )}
          {!loading && leads.length === 0 && (
            <div className="empty-state" style={{ padding: '2rem 1rem' }}>
              <MessageSquare size={20} />
              <p style={{ fontSize: 13 }}>No leads in this inbox.</p>
            </div>
          )}
          {leads.map(lead => (
            <div
              key={lead.id}
              className={`inbox-item ${selected?.id === lead.id ? 'active' : ''}`}
              onClick={() => selectLead(lead)}
            >
              <div className="inbox-avatar" style={{ background: avatarColor(displayName(lead)) }}>
                {getInitials(displayName(lead))}
              </div>
              <div className="inbox-item-body">
                <div className="inbox-item-top">
                  <span className="inbox-item-name">{displayName(lead)}</span>
                  <span className="inbox-item-time">{format(new Date(lead.last_contact), 'HH:mm')}</span>
                </div>
                <div className="inbox-item-preview">{lead.last_message || 'No messages'}</div>
              </div>
              {lead.urgency === 'high' && <div className="inbox-item-dot" />}
            </div>
          ))}
        </div>
      </div>

      <div className="inbox-conv-pane">
        {selected ? (
          <div className="inbox-conv-body">
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div className="inbox-conv-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="inbox-avatar" style={{ width: 34, height: 34, fontSize: 12, background: avatarColor(displayName(selected)) }}>
                    {getInitials(displayName(selected))}
                  </div>
                  <div>
                    {editingName ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          autoFocus
                          className="inp"
                          style={{ height: 32, fontSize: 13, padding: '0 8px', width: 150 }}
                          value={newName}
                          onChange={e => setNewName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && saveLeadName()}
                        />
                        <button className="btn-primary" style={{ padding: '0 8px', height: 32 }} onClick={saveLeadName} disabled={busy}>
                          <Check size={14} />
                        </button>
                        <button className="btn-ghost" style={{ padding: '0 8px', height: 32 }} onClick={() => setEditingName(false)}>
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{displayName(selected)}</div>
                        <button
                          className="btn-ghost"
                          style={{ padding: 4, height: 'auto', color: 'var(--text-4)' }}
                          onClick={() => {
                            setNewName(displayName(selected));
                            setEditingName(true);
                          }}
                        >
                          <Edit2 size={12} />
                        </button>
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{selected.phone}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className={selected.bot_status === 'human' ? 'btn-primary' : 'btn-ghost'} style={{ fontSize: 11, padding: '5px 12px' }} onClick={toggleBotMode}>
                    {selected.bot_status === 'human' ? 'Human Mode' : 'AI Active'}
                  </button>
                </div>
              </div>

              <div className="inbox-messages" ref={messagesRef} style={{ flex: 1, overflowY: 'auto' }}>
                {loadingConvos && (
                  <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-4)' }}>
                    <RefreshCw size={14} className="spin" />
                  </div>
                )}
                {!loadingConvos && convos.length === 0 && (
                  <div className="empty-state" style={{ padding: '3rem 2rem' }}>
                    <MessageSquare size={24} />
                    <p>No conversation logs yet.</p>
                  </div>
                )}
                {convos.map((row, i) => {
                  const isAdmin = row.direction === 'outgoing-human' || row.agent_name === 'Admin';
                  const isPhoto = row.message?.startsWith('[PHOTO]') || row.message?.startsWith('http') && (row.message.match(/\.(jpg|jpeg|png|gif|webp)/i));
                  const displayMessage = isPhoto && row.message.startsWith('[PHOTO]') ? row.message.replace('[PHOTO]', '').trim() : row.message;
                  const photoUrl = isPhoto ? (row.message.startsWith('http') ? row.message : null) : null; // In real use, n8n might save the URL

                  return (
                    <React.Fragment key={i}>
                      {row.direction === 'incoming' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                          <span style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 4, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                            {displayName(selected)} · {row.timestamp ? format(new Date(row.timestamp), 'HH:mm') : ''}
                          </span>
                          <div className="bubble-customer">{row.message}</div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', alignSelf: 'flex-end' }}>
                          <span style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 4, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                            {isAdmin ? 'Admin' : 'Agent'} · {row.timestamp ? format(new Date(row.timestamp), 'HH:mm') : ''}
                          </span>
                          <div className="bubble-agent" style={{ background: isAdmin ? '#dcf8c6' : 'var(--white)' }}>
                            {isPhoto && photoUrl && <img src={photoUrl} alt="Sent" style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 8 }} />}
                            {(!isPhoto || displayMessage) && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{displayMessage}</p>}
                            {isPhoto && !photoUrl && <div style={{ fontSize: 11, fontStyle: 'italic', opacity: 0.8 }}>🖼️ Photo Sent</div>}
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Human Chat Input (WhatsApp Style - Bottom aligned) */}
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
                {photoFile && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8 }}>
                    <Image size={14} />
                    <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{photoFile.name}</span>
                    <button className="btn-icon" style={{ padding: 2 }} onClick={() => setPhotoFile(null)}><X size={12} /></button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn-icon" title="Attach photo" onClick={() => photoInputRef.current?.click()}>
                    <Image size={16} />
                  </button>
                  <input ref={photoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setPhotoFile(e.target.files?.[0] || null)} />
                  <input
                    className="inp"
                    style={{ flex: 1 }}
                    placeholder={photoFile ? 'Add a caption (optional)...' : selected.bot_status === 'human' ? 'Type a message...' : 'Type here to take over...'}
                    value={humanReply}
                    onChange={e => setHumanReply(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !photoFile) sendHumanReply(); }}
                  />
                  {photoFile ? (
                    <button className="btn-primary" onClick={sendPhotoReply} disabled={sendingPhoto}>
                      {sendingPhoto ? '...' : <Send size={15} />}
                    </button>
                  ) : (
                    <button className="btn-primary" onClick={sendHumanReply} disabled={!humanReply.trim() || replying}>
                      {replying ? '...' : <Send size={15} />}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Action panel (Lead details & Payment) */}
            <div className="inbox-action-panel">
              {/* Lead info */}
              <div>
                <p className="section-label" style={{ marginBottom: 10 }}>Lead Details</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="inbox-field-row">
                    <span className="inbox-field-label">Product</span>
                    <div className="inbox-field-value">{productLabel}</div>
                  </div>
                  {selected.delivery_location && (
                    <div className="inbox-field-row">
                      <span className="inbox-field-label">Delivery</span>
                      <div className="inbox-field-value">📍 {selected.delivery_location}</div>
                    </div>
                  )}
                  {selected.payment_method && (
                    <div className="inbox-field-row">
                      <span className="inbox-field-label">Payment Method</span>
                      <div className="inbox-field-value">💳 {selected.payment_method}</div>
                    </div>
                  )}
                  {selected.product_price && (
                    <div className="inbox-field-row">
                      <span className="inbox-field-label">Quoted Price</span>
                      <div className="inbox-field-value" style={{ color: 'var(--text)', fontWeight: 600, fontFamily: 'var(--mono)' }}>
                        KES {parseFloat(selected.product_price).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <hr className="divider" />

              {/* Payment form */}
              <div>
                <p className="section-label" style={{ marginBottom: 10 }}>Record Payment</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    className="inp"
                    placeholder="Transaction Code (e.g. QJH7F...)"
                    value={payForm.code}
                    onChange={e => setPayForm({ ...payForm, code: e.target.value })}
                  />
                  <input
                    className="inp"
                    placeholder="Amount (KES)"
                    type="number"
                    value={payForm.amount}
                    onChange={e => setPayForm({ ...payForm, amount: e.target.value })}
                  />
                  {/* Auto-filled read-only fields */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div className="inbox-field-row">
                      <span className="inbox-field-label">Product (auto)</span>
                      <div className="inbox-field-value" style={{ fontSize: 11 }}>{productLabel}</div>
                    </div>
                    <div className="inbox-field-row">
                      <span className="inbox-field-label">Delivery (auto)</span>
                      <div className="inbox-field-value" style={{ fontSize: 11 }}>{selected.delivery_location || '—'}</div>
                    </div>
                  </div>
                  <input
                    className="inp"
                    placeholder="Storage (e.g. 128GB)"
                    value={payForm.storage}
                    onChange={e => setPayForm({ ...payForm, storage: e.target.value })}
                  />
                  <input
                    className="inp"
                    placeholder="Condition (e.g. Grade A)"
                    value={payForm.condition}
                    onChange={e => setPayForm({ ...payForm, condition: e.target.value })}
                  />

                  <button
                    className="btn-primary"
                    style={{ marginTop: 4, width: '100%' }}
                    disabled={busy}
                    onClick={() => savePayment(false)}
                  >
                    {busy ? 'Saving...' : <><Check size={13} /> Save Payment</>}
                  </button>

                  <button
                    className={`btn-ghost${receiptSent ? ' inbox-send-success' : ''}`}
                    style={{ width: '100%', border: receiptSent ? '1px solid #4ade80' : undefined, color: receiptSent ? '#4ade80' : undefined }}
                    disabled={busy}
                    onClick={() => savePayment(true)}
                  >
                    {receiptSent ? <><Check size={13} /> Receipt Sent!</> : <><Send size={13} /> Send Receipt</>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <MessageSquare size={40} />
            <p>Select a conversation to start chatting</p>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// LEADS
// =============================================================================
function LeadsTab({ globalInbox }: { globalInbox: string }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [convos, setConvos] = useState<ConversationLog[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(false);
  const [receiptForm, setReceiptForm] = useState({ code: '', amount: '', storage: '', condition: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selected) setReceiptForm({ code: selected.transaction_code || '', amount: selected.product_price || '', storage: selected.product_storage || '', condition: selected.product_condition || '' });
  }, [selected]);

  const fetchLeads = () => {
    setLoading(true);
    authFetch(`/api/leads?inbox=${globalInbox}`).then(r => r.json()).then(d => { if (!d.error) setLeads(d); }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchLeads(); const id = setInterval(fetchLeads, 30000); return () => clearInterval(id); }, [globalInbox]);

  const selectLead = (l: Lead) => {
    setSelected(l); setLoadingConvos(true);
    authFetch(`/api/leads/${encodeURIComponent(l.phone)}/conversations`)
      .then(r => r.json()).then(d => { if (!d.error) setConvos(d); }).finally(() => setLoadingConvos(false));
  };

  const updateStage = async (phone: string, stage: string) => {
    await authFetch(`/api/leads/${encodeURIComponent(phone)}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) });
    fetchLeads();
  };

  const recordPayment = async (sendEmail: boolean) => {
    if (!selected) return;
    if (!receiptForm.code || !receiptForm.amount) { alert('Enter transaction code and amount.'); return; }
    setBusy(true);
    try {
      await authFetch('/api/payments', {
        method: 'POST',
        body: JSON.stringify({
          transaction_code: receiptForm.code, customer_phone: selected.phone,
          customer_email: selected.email || '', customer_name: selected.customer_name || '',
          amount: parseFloat(receiptForm.amount), payment_status: sendEmail ? 'completed' : 'confirmed',
          payment_method: selected.payment_method || 'M-Pesa',
          delivery_location: selected.delivery_location || 'Store Pickup',
          product_model: selected.product_model || selected.interest || '',
          product_storage: receiptForm.storage, product_condition: receiptForm.condition,
          upsell_items: selected.upsell_items || '',
        }),
      });
      if (sendEmail && selected.email?.includes('@')) {
        const r = await fetch('https://shwariaccessories.app.n8n.cloud/webhook/send-receipt', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: selected.email,
            phone: selected.phone,
            name: selected.customer_name,
            product: selected.product_model,
            transactionCode: receiptForm.code,
            amount: receiptForm.amount,
            storage: receiptForm.storage,
            condition: receiptForm.condition,
            location: selected.delivery_location,
            paymentMethod: selected.payment_method
          }),
        });
        alert(r.ok ? 'Receipt sent!' : 'Payment saved. Receipt email failed — check N8N logs.');
      } else {
        alert('Payment recorded.');
      }
      await updateStage(selected.phone, 'payment_submitted');
    } catch (e: any) { alert('Error: ' + e.message); }
    finally { setBusy(false); }
  };

  // ── DETAIL VIEW ──
  if (selected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)', gap: 16, maxWidth: 1100 }}>
        {/* Header bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="btn-icon" onClick={() => { setSelected(null); setConvos([]); }}><ArrowLeft size={15} /></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>{selected.customer_name || selected.phone}</span>
              <span className={urgencyBadge(selected.urgency)}>{selected.urgency || 'low'}</span>
              <span className="badge badge-neutral">{STAGES[selected.stage] || selected.stage}</span>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 3, flexWrap: 'wrap' }}>
              {selected.customer_name && <span className="mono" style={{ color: 'var(--text-3)', fontSize: 11 }}>{selected.phone}</span>}
              {selected.email && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{selected.email}</span>}
            </div>
          </div>
          <select className="inp" defaultValue={selected.stage} style={{ width: 'auto', fontSize: 12 }}
            onChange={e => { updateStage(selected.phone, e.target.value); setSelected({ ...selected, stage: e.target.value }); }}>
            {Object.entries(STAGES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <div style={{ flex: 1, display: 'flex', gap: 16, overflow: 'hidden', minHeight: 0 }}>
          {/* Left: Details + Payment */}
          <div className="card" style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: 20 }}>
            <p className="section-label" style={{ marginBottom: 14 }}>Lead Details</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Product', v: selected.product_model ? `${selected.product_model} ${selected.product_storage || ''}`.trim() : selected.interest },
                { label: 'Condition', v: selected.product_condition },
                { label: 'Price', v: selected.product_price ? `KES ${parseFloat(selected.product_price).toLocaleString()}` : undefined },
                { label: 'Delivery', v: selected.delivery_location },
                { label: 'Payment', v: selected.payment_method },
                { label: 'Intent', v: selected.intent },
                { label: 'Upsells', v: selected.upsell_items },
                { label: 'Last Contact', v: format(new Date(selected.last_contact), 'MMM d, HH:mm') },
              ].filter(f => f.v).map(f => (
                <div key={f.label}>
                  <div className="section-label" style={{ marginBottom: 2, fontSize: 9 }}>{f.label}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{f.v}</div>
                </div>
              ))}
            </div>

            <hr className="divider" style={{ margin: '18px 0' }} />
            <p className="section-label" style={{ marginBottom: 12 }}>Record Payment</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input className="inp" placeholder="Transaction Code" value={receiptForm.code} onChange={e => setReceiptForm({ ...receiptForm, code: e.target.value })} />
              <input className="inp" placeholder="Amount (KES)" type="number" value={receiptForm.amount} onChange={e => setReceiptForm({ ...receiptForm, amount: e.target.value })} />
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="inp" placeholder="Storage" value={receiptForm.storage} onChange={e => setReceiptForm({ ...receiptForm, storage: e.target.value })} />
                <input className="inp" placeholder="Condition" value={receiptForm.condition} onChange={e => setReceiptForm({ ...receiptForm, condition: e.target.value })} />
              </div>
              <button className="btn-primary" style={{ marginTop: 4 }} disabled={busy} onClick={() => recordPayment(false)}>
                {busy ? 'Saving…' : 'Save Payment'}
              </button>
              <button className="btn-ghost" disabled={busy} onClick={() => recordPayment(true)}>
                Send Email Receipt
              </button>
            </div>
          </div>

          {/* Right: Conversation */}
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p className="section-label">Conversation Log</p>
              {loadingConvos && <RefreshCw size={12} className="spin" style={{ color: 'var(--text-4)' }} />}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {convos.length === 0 && !loadingConvos && (
                <div className="empty-state"><MessageSquare size={24} /><p>No conversation logs yet.</p></div>
              )}
              {convos.map((row, i) => (
                <React.Fragment key={i}>
                  {row.message && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 4, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                        Customer · {row.timestamp ? format(new Date(row.timestamp), 'HH:mm') : ''}
                      </span>
                      <div className="bubble-customer">{row.message}</div>
                    </div>
                  )}
                  {(row.direction === 'outgoing' || row.direction === 'outgoing-human') && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', alignSelf: 'flex-end' }}>
                      <span style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 4, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                        {row.direction === 'outgoing-human' ? 'Staff' : 'Agent'} · {row.timestamp ? format(new Date(row.timestamp), 'HH:mm') : ''}
                      </span>
                      <div className="bubble-agent">
                        <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{row.message}</p>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── LIST VIEW ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 920 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>Leads</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{leads.length} total active leads</span>
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={fetchLeads}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {leads.length === 0 && !loading && (
        <div className="card"><div className="empty-state"><MessageSquare size={28} /><p>No leads yet.</p></div></div>
      )}

      {leads.map(lead => (
        <div key={lead.id} className="lead-card" onClick={() => selectLead(lead)}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 250px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 18, color: '#fff', letterSpacing: '-0.03em' }}>{displayName(lead)}</span>
                <span className={urgencyBadge(lead.urgency)} style={{ fontSize: 10, padding: '2px 8px' }}>{lead.urgency || 'low'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-3)', fontSize: 12, marginBottom: 8 }}>
                <Smartphone size={12} />
                <span className="mono">{lead.phone}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500 }}>
                  {lead.product_model ? `${lead.product_model} ${lead.product_storage || ''}`.trim() : lead.interest || 'No product specified'}
                </div>
              </div>
            </div>

            <div style={{ flex: '2 1 300px', minWidth: 0 }}>
              <div className="section-label" style={{ marginBottom: 6, fontSize: 9 }}>Last Message</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                "{lead.last_message || 'No messages logged'}"
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{format(new Date(lead.last_contact), 'MMM d, HH:mm')}</span>
              <span className="badge badge-neutral">{STAGES[lead.stage] || lead.stage}</span>
              <select className="inp" value={lead.stage} style={{ fontSize: 11, width: 'auto' }}
                onClick={e => e.stopPropagation()}
                onChange={e => { e.stopPropagation(); updateStage(lead.phone, e.target.value); }}>
                {Object.entries(STAGES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// SALES
// =============================================================================
function PaymentsTab({ payments }: { payments: Payment[] }) {
  const confirmed = payments.filter(p => p.payment_status === 'confirmed' || p.payment_status === 'completed');
  const total = confirmed.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100 }}>
      <div>
        <h1 className="page-title">Sales</h1>
        <p className="body-text" style={{ marginTop: 4 }}>{confirmed.length} completed · KES {total.toLocaleString()} total revenue</p>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Code</th><th>Customer</th><th>Product</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id}>
                  <td className="mono" style={{ color: 'var(--text-3)', fontSize: 11 }}>{p.transaction_code}</td>
                  <td>
                    <div style={{ color: 'var(--text)', fontWeight: 500, fontSize: 13 }}>{p.customer_name || p.customer_phone}</div>
                    {p.customer_email && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{p.customer_email}</div>}
                  </td>
                  <td>
                    <div style={{ color: 'var(--text)', fontSize: 13 }}>{p.product_model || '—'}</div>
                    {(p.product_storage || p.product_condition) && (
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{[p.product_storage, p.product_condition].filter(Boolean).join(' · ')}</div>
                    )}
                  </td>
                  <td style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontWeight: 700 }}>KES {fmt(p.amount)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-2)' }}>{p.payment_method || '—'}</td>
                  <td><span className={statusBadge(p.payment_status)}>{p.payment_status === 'confirmed' ? 'Sold' : p.payment_status}</span></td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{format(new Date(p.created_at), 'MMM d, HH:mm')}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr><td colSpan={7}><div className="empty-state"><DollarSign size={28} /><p>No sales recorded yet.</p></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// SETTINGS (CLIENT VIEW)
// =============================================================================
function SettingsTab() {
  const [brand, setBrand] = useState('Shwari Agent');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const bRes = await authFetch('/api/app-settings');
      const bData = await bRes.json();
      if (bData.brand_name) setBrand(bData.brand_name);
      if (bData.brand_phone) setPhone(bData.brand_phone);
      if (bData.brand_address) setAddress(bData.brand_address);

      const uRes = await authFetch('/api/profiles');
      setUsers(await uRes.json());
    } catch { }
  };

  useEffect(() => { load(); }, []);

  const saveSettings = async () => {
    setSaving(true);
    await authFetch('/api/app-settings', {
      method: 'POST',
      body: JSON.stringify({ key: 'brand_name', value: brand })
    });
    await authFetch('/api/app-settings', {
      method: 'POST',
      body: JSON.stringify({ key: 'brand_phone', value: phone })
    });
    await authFetch('/api/app-settings', {
      method: 'POST',
      body: JSON.stringify({ key: 'brand_address', value: address })
    });
    setSaving(false);
  };

  const removeUser = async (id: string) => {
    if (!confirm('Revoke access for this user?')) return;
    await authFetch(`/api/profiles/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 800 }}>
      <section>
        <h1 className="page-title">General Settings</h1>
        <p className="body-text">Manage your brand identity and public profile.</p>

        <div className="card" style={{ marginTop: 24, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Business Name</label>
            <input className="inp" value={brand} onChange={e => setBrand(e.target.value)} style={{ fontSize: 16 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Contact Phone</label>
              <input className="inp" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+254..." />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Business Address</label>
              <input className="inp" value={address} onChange={e => setAddress(e.target.value)} placeholder="Nairobi, Kenya" />
            </div>
          </div>
          <button className="btn-primary" onClick={saveSettings} disabled={saving} style={{ alignSelf: 'flex-start', marginTop: 8 }}>
            {saving ? 'Saving...' : 'Save Business Profile'}
          </button>
        </div>
      </section>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h2 style={{ fontSize: 20, color: '#fff', fontWeight: 600 }}>Team Access</h2>
            <p className="body-text" style={{ marginTop: 4 }}>Manage who has access to this dashboard.</p>
          </div>
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => alert('Refer to Supabase Auth to invite new users.')}><UserPlus size={14} /> Invite User</button>
        </div>

        <div className="card" style={{ marginTop: 20, overflow: 'hidden' }}>
          {users.map((u, i) => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: i < users.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 32, height: 32, background: 'var(--border)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff' }}>
                  {u.full_name?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{u.full_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-4)' }}>{u.email}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{u.role}</span>
                <button className="btn-ghost" style={{ color: '#ef4444', padding: 8 }} onClick={() => removeUser(u.id)}><LogOut size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.1)', padding: 20, borderRadius: 12, display: 'flex', gap: 16 }}>
        <Shield size={20} style={{ color: '#ef4444', flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Security locked</div>
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>Technical configurations (API keys, Webhook URLs) are managed by the system administrator and are hidden for security.</p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// PAYWALL
// =============================================================================
function Paywall({ subscription, onPaymentSuccess }: { subscription: any, onPaymentSuccess: (ref: string) => void }) {
  const payWithPaystack = () => {
    // We expect the script to have loaded from the App useEffect
    if (!(window as any).PaystackPop) {
      alert('Paystack is still loading. Please wait a moment.');
      return;
    }

    const handler = (window as any).PaystackPop.setup({
      key: subscription?.paystack_public_key || (subscription as any).PAYSTACK_PUBLIC_KEY || 'pk_test_xxxxxxxxxxxxxxxxxxxxxxxx',
      email: 'admin@shwaridevices.com',
      amount: 1800000, // 18,000 * 100
      currency: 'KES',
      ref: 'SUB_' + Math.floor((Math.random() * 1000000000) + 1),
      callback: function (response: any) {
        onPaymentSuccess(response.reference);
      },
      onClose: function () {
        alert('Payment window closed.');
      }
    });
    handler.openIframe();
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center', background: 'radial-gradient(circle at center, #111 0%, #000 100%)' }}>
      <div style={{ background: 'rgba(255,255,255,0.03)', padding: 48, borderRadius: 32, border: '1px solid rgba(255,255,255,0.08)', maxWidth: 500 }}>
        <div style={{ width: 64, height: 64, background: 'rgba(239, 68, 68, 0.1)', borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
          <Lock size={32} style={{ color: '#ef4444' }} />
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#fff', marginBottom: 12 }}>Dashboard Locked</h1>
        <p style={{ color: 'var(--text-3)', fontSize: 16, lineHeight: 1.6, marginBottom: 32 }}>
          Your subscription expired on <b>{subscription?.expiry_date ? format(new Date(subscription.expiry_date), 'PPP') : 'Unknown Date'}</b>.
          The Shwari Agent is still processing messages, but you must renew to access your leads and inventory.
        </p>
        <div className="card" style={{ background: 'rgba(255,255,255,0.05)', padding: 20, marginBottom: 32, textAlign: 'left' }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-4)', fontWeight: 700, letterSpacing: '0.1em' }}>Renewal Fee</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', marginTop: 4 }}>18,000 KES <span style={{ fontSize: 14, color: 'var(--text-3)', fontWeight: 400 }}>/ month</span></div>
        </div>
        <button onClick={payWithPaystack} className="btn-primary" style={{ width: '100%', height: 56, fontSize: 16, fontWeight: 700, gap: 10 }}>
          <CreditCard size={18} /> Renew Subscription Now
        </button>
        <p style={{ marginTop: 24, fontSize: 12, color: 'var(--text-4)' }}>Secured by Paystack. Access is restored instantly after payment.</p>
      </div>
    </div>
  );
}
