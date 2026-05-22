import React, { useState, useEffect, useRef } from 'react';
import {
  Settings as SettingsIcon, MessageSquare, Smartphone, Activity,
  RefreshCw, Save, Trash2, Edit2, Plus, Check, ArrowLeft,
  DollarSign, Users, Package, TrendingUp, Image, Upload, Play, X,
  CreditCard, Lock, AlertTriangle, ExternalLink, LogOut, UserPlus, Shield
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
  product_price?: string;
  upsell_items?: string;
  customer_name?: string;
};

type ConversationLog = {
  id?: number;
  customer_phone: string;
  message?: string;
  response?: string;
  created_at: string;
  email?: string;
  delivery_location?: string;
  payment_method?: string;
  transaction_code?: string;
  product_model?: string;
  product_storage?: string;
  product_condition?: string;
  product_price?: string;
  upsell_items?: string;
  customer_name?: string;
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
  { id: 'pricelist', label: 'Inventory', icon: <Smartphone size={15} /> },
  { id: 'leads', label: 'Pipeline', icon: <Users size={15} /> },
  { id: 'payments', label: 'Sales', icon: <DollarSign size={15} /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={15} /> },
];

import { createClient } from '@supabase/supabase-js';

export let supabase: any = null;

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
      if (d.SUPABASE_URL && d.SUPABASE_ANON_KEY) {
        supabase = createClient(d.SUPABASE_URL, d.SUPABASE_ANON_KEY);
      }
      setReady(true);
    }).catch(() => setReady(true));
  }, []);

  if (!ready) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#fff' }}>Initializing...</div>;
  if (!supabase) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#fff' }}>Missing Supabase Config. Please check the backend settings.</div>;

  return <Dashboard />;
}

// =============================================================================
// DASHBOARD
// =============================================================================
function Dashboard() {
  const [tab, setTab] = useState('overview');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    // 1. Load Paystack
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    document.body.appendChild(script);

    // 2. Auth Listener
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setUser(session?.user ?? null);
        if (session?.user) syncProfile(session.user);
      });

      const { data: { subscription: authListener } } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) syncProfile(session.user);
      });
      return () => authListener.unsubscribe();
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/subscription');
        if (res.ok) setSubscription(await res.json());
      } catch (e) { console.error(e); }

      try { const r = await fetch('/api/payments'); if (r.ok) setPayments(await r.json()); } catch { }
      setLoading(false);
    };
    if (user) load();
    else setLoading(false);
  }, [user]);

  const syncProfile = (u: any) => {
    fetch('/api/profiles/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, email: u.email, full_name: u.user_metadata?.full_name || u.email.split('@')[0] })
    }).catch(console.error);
  };

  if (loading) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#fff' }}>Loading Shwari...</div>;
  if (!user) return <LoginScreen />;

  const isExpired = subscription?.status === 'expired';
  const daysLeft = subscription?.expiry_date ? differenceInDays(new Date(subscription.expiry_date), new Date()) : 30;
  const showReminder = !isExpired && daysLeft <= 3 && daysLeft >= 0;

  const handlePaymentSuccess = async (ref: string) => {
    try {
      const res = await fetch('/api/subscription/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
              <span style={{ fontWeight: 800, fontSize: 13, color: '#000', lineHeight: 1 }}>S</span>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', letterSpacing: '-0.02em' }}>Shwari iPhones</div>
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

        {/* Status */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 6, height: 6, background: '#4ade80', borderRadius: '50%', flexShrink: 0, boxShadow: '0 0 5px #4ade8066' }} />
            <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>WhatsApp connected</span>
          </div>
        </div>

        <div style={{ padding: '0 12px', marginTop: 'auto', marginBottom: 20 }}>
          <button onClick={() => supabase?.auth.signOut()} className="nav-item" style={{ width: '100%', color: '#ef4444' }}>
            <LogOut size={16} /> <span>Sign Out</span>
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
            {tab === 'overview' && <OverviewTab onNavigate={setTab} payments={payments} />}
            {tab === 'pricelist' && <PricelistTab />}
            {tab === 'leads' && <LeadsTab />}
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
// OVERVIEW
// =============================================================================
function OverviewTab({ onNavigate, payments }: { onNavigate: (t: string) => void; payments: Payment[] }) {
  const [stats, setStats] = useState<any>({});
  useEffect(() => { fetch('/api/stats').then(r => r.json()).then(d => { if (!d.error) setStats(d); }).catch(() => { }); }, []);

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
  const [phones, setPhones] = useState<Phone[]>([]);
  const [form, setForm] = useState<Partial<Phone> & { photoFile?: File }>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [category, setCategory] = useState('general_pricelist');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, [category]);

  const load = () =>
    fetch(`/api/pricelist?category=${category}`).then(r => r.json()).then(d => { if (!d.error) setPhones(d); }).catch(() => { });

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
      fd.set('availability', form.availability !== false ? 'true' : 'false');
      const r = await fetch(url, { method: editingId ? 'PUT' : 'POST', body: fd });
      const json = await r.json();
      if (!r.ok || json.error) throw new Error(json.error || 'Save failed');
      reset(); load();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const del = async (id: number) => {
    if (!confirm('Delete this product?')) return;
    await fetch(`/api/pricelist/${id}?category=${category}`, { method: 'DELETE' });
    load();
  };

  const isLipa = category === 'lipa_mdogo_mdogo';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="body-text" style={{ marginTop: 4 }}>{phones.length} products in {isLipa ? 'Lipa Mdogo Mdogo' : 'General'} pricelist</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['general_pricelist', 'General'], ['lipa_mdogo_mdogo', 'Lipa Mdogo']].map(([id, label]) => (
            <button key={id} onClick={() => { setCategory(id); setPreviewId(null); setEditingId(null); }} style={{
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
        return (
          <div className="card" style={{ padding: 24, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 300px', maxWidth: 400 }}>
              {p.image_url ? (
                <img src={p.image_url} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 12, border: '1px solid var(--border)' }} alt={p['Phone Model']} />
              ) : (
                <div style={{ width: '100%', aspectRatio: '1', background: 'var(--surface-2)', borderRadius: 12, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)' }}>
                  <Image size={48} />
                </div>
              )}
            </div>
            <div style={{ flex: '2 1 300px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--white)', letterSpacing: '-0.03em', lineHeight: 1.2 }}>{p['Phone Model']}</h2>
                  <p style={{ color: 'var(--text-3)', fontSize: 14, marginTop: 4 }}>{p.Specs}</p>
                </div>
                <button className="btn-icon" onClick={() => setPreviewId(null)}><X size={15} /></button>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: -4 }}>
                <span className={`badge ${p.availability ? 'badge-green' : 'badge-red'}`}>{p.availability ? 'In Stock' : 'Out of Stock'}</span>
              </div>

              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 16, border: '1px solid var(--border)', marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Pricing Details</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-4)' }}>Cash Price</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>KES {fmt(p['Cash Price'])}</div>
                  </div>
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

              {p.notes && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Notes</div>
                  <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5, background: 'var(--surface-2)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>{p.notes}</p>
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
            <input className="inp" placeholder="Model (e.g. iPhone 15 Pro)" value={form['Phone Model'] || ''} onChange={e => setForm({ ...form, 'Phone Model': e.target.value })} />
            <input className="inp" placeholder="Specs (e.g. 256GB Black)" value={form.Specs || ''} onChange={e => setForm({ ...form, Specs: e.target.value })} />
            <input className="inp" placeholder="Cash Price (KES)" type="number" value={form['Cash Price'] || ''} onChange={e => setForm({ ...form, 'Cash Price': e.target.value })} />
            {isLipa && <>
              <input className="inp" placeholder="Deposit" type="number" value={form.Deposit || ''} onChange={e => setForm({ ...form, Deposit: e.target.value })} />
              <input className="inp" placeholder="12 Weeks" type="number" value={form['12 Weeks'] || ''} onChange={e => setForm({ ...form, '12 Weeks': e.target.value })} />
              <input className="inp" placeholder="Deposit 1" type="number" value={form.Deposit_1 || ''} onChange={e => setForm({ ...form, Deposit_1: e.target.value })} />
              <input className="inp" placeholder="24 Weeks" type="number" value={form['24 Weeks'] || ''} onChange={e => setForm({ ...form, '24 Weeks': e.target.value })} />
            </>}
            <input className="inp" placeholder="Notes (optional)" value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer', marginLeft: 'auto', userSelect: 'none' }}>
              <input type="checkbox" checked={form.availability !== false} onChange={e => setForm({ ...form, availability: e.target.checked })} style={{ accentColor: '#fff', width: 14, height: 14, cursor: 'pointer' }} />
              In Stock
            </label>
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
            <p className="section-label">All Products</p>
            <button className="btn-primary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => { setForm({}); setEditingId(null); setPreviewId(null); setForm({ availability: true }); }}><Plus size={12} /> Add New</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Specs</th>
                  <th>Cash Price</th>
                  {isLipa && <><th>Deposit</th><th>12W Plan</th><th>24W Plan</th></>}
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {phones.map(p => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setPreviewId(p.id)}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {p.image_url
                          ? <img src={p.image_url} style={{ width: 36, height: 36, borderRadius: 7, objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }} alt={p['Phone Model']} />
                          : <div style={{ width: 36, height: 36, background: 'var(--surface-2)', borderRadius: 7, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Image size={14} style={{ color: 'var(--text-4)' }} />
                          </div>
                        }
                        <span style={{ color: 'var(--text)', fontWeight: 500, fontSize: 13 }}>{p['Phone Model']}</span>
                      </div>
                    </td>
                    <td>{p.Specs}</td>
                    <td style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontWeight: 600 }}>KES {fmt(p['Cash Price'])}</td>
                    {isLipa && <>
                      <td style={{ fontFamily: 'var(--mono)' }}>{fmt(p.Deposit)}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{fmt(p['12 Weeks'])}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{fmt(p['24 Weeks'])}</td>
                    </>}
                    <td><span className={`badge ${p.availability ? 'badge-green' : 'badge-red'}`}>{p.availability ? 'In Stock' : 'Out of Stock'}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn-icon" onClick={(e) => { e.stopPropagation(); setEditingId(p.id); setForm(p); setPreviewId(null); }}><Edit2 size={13} /></button>
                        <button className="btn-icon danger" onClick={(e) => { e.stopPropagation(); del(p.id); }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {phones.length === 0 && (
                  <tr><td colSpan={isLipa ? 8 : 6}>
                    <div className="empty-state"><Package size={28} /><p>No products yet. Add your first product above.</p></div>
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
// LEADS / PIPELINE
// =============================================================================
function LeadsTab() {
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
    fetch('/api/leads').then(r => r.json()).then(d => { if (!d.error) setLeads(d); }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchLeads(); const id = setInterval(fetchLeads, 30000); return () => clearInterval(id); }, []);

  const selectLead = (l: Lead) => {
    setSelected(l); setLoadingConvos(true);
    fetch(`/api/leads/${encodeURIComponent(l.phone)}/conversations`)
      .then(r => r.json()).then(d => { if (!d.error) setConvos(d); }).finally(() => setLoadingConvos(false));
  };

  const updateStage = async (phone: string, stage: string) => {
    await fetch(`/api/leads/${encodeURIComponent(phone)}/stage`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }) });
    fetchLeads();
  };

  const recordPayment = async (sendEmail: boolean) => {
    if (!selected) return;
    if (!receiptForm.code || !receiptForm.amount) { alert('Enter transaction code and amount.'); return; }
    setBusy(true);
    try {
      await fetch('/api/payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
        const r = await fetch('https://builtwithaiautomations.app.n8n.cloud/webhook/send-receipt', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: selected.email, phone: selected.phone, name: selected.customer_name, product: selected.product_model, transactionCode: receiptForm.code, amount: receiptForm.amount }),
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
                        Customer · {format(new Date(row.created_at), 'HH:mm')}
                      </span>
                      <div className="bubble-customer">{row.message}</div>
                    </div>
                  )}
                  {row.response && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', alignSelf: 'flex-end' }}>
                      <span style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 4, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                        Bot · {format(new Date(row.created_at), 'HH:mm')}
                      </span>
                      <div className="bubble-agent">
                        <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{row.response}</p>
                        {(row.product_model || row.delivery_location || row.payment_method) && (
                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e5e5e5', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {row.product_model && <span style={{ fontSize: 10, background: '#f0f0f0', borderRadius: 4, padding: '2px 7px', fontWeight: 500 }}>📱 {row.product_model} {row.product_storage}</span>}
                            {row.delivery_location && <span style={{ fontSize: 10, background: '#f0f0f0', borderRadius: 4, padding: '2px 7px', fontWeight: 500 }}>📍 {row.delivery_location}</span>}
                            {row.payment_method && <span style={{ fontSize: 10, background: '#f0f0f0', borderRadius: 4, padding: '2px 7px', fontWeight: 500 }}>💳 {row.payment_method}</span>}
                          </div>
                        )}
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="page-title">Pipeline</h1>
          <p className="body-text" style={{ marginTop: 4 }}>{leads.length} contacts tracked</p>
        </div>
        <button className="btn-ghost" onClick={fetchLeads} style={{ fontSize: 12 }}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {leads.length === 0 && (
        <div className="card"><div className="empty-state"><MessageSquare size={28} /><p>No leads yet. They will appear here when customers message on WhatsApp.</p></div></div>
      )}

      {leads.map(lead => (
        <div key={lead.id} className="lead-card" onClick={() => selectLead(lead)}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Identity */}
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: '#fff' }}>{lead.customer_name || lead.phone}</span>
                <span className={urgencyBadge(lead.urgency)}>{lead.urgency || 'low'}</span>
              </div>
              {lead.customer_name && <div className="mono" style={{ color: 'var(--text-3)', fontSize: 11, marginBottom: 4 }}>{lead.phone}</div>}
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {lead.product_model ? `${lead.product_model} ${lead.product_storage || ''}`.trim() : lead.interest || 'No product specified'}
              </div>
              {lead.delivery_location && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>📍 {lead.delivery_location}</div>}
            </div>

            {/* Last message */}
            <div style={{ flex: '2 1 300px', minWidth: 0 }}>
              <div className="section-label" style={{ marginBottom: 6, fontSize: 9 }}>Last Message</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.5 }}>
                "{lead.last_message || 'No messages logged'}"
              </p>
            </div>

            {/* Stage + actions */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{format(new Date(lead.last_contact), 'MMM d, HH:mm')}</span>
              <span className="badge badge-neutral">{STAGES[lead.stage] || lead.stage}</span>
              <select className="inp" value={lead.stage} style={{ fontSize: 12, width: 'auto', padding: '5px 28px 5px 8px' }}
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
  const [users, setUsers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const bRes = await fetch('/api/app-settings');
      const bData = await bRes.json();
      if (bData.brand_name) setBrand(bData.brand_name);

      const uRes = await fetch('/api/profiles');
      setUsers(await uRes.json());
    } catch { }
  };

  useEffect(() => { load(); }, []);

  const saveBrand = async () => {
    setSaving(true);
    await fetch('/api/app-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'brand_name', value: brand })
    });
    setSaving(false);
  };

  const removeUser = async (id: string) => {
    if (!confirm('Revoke access for this user?')) return;
    await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 800 }}>
      <section>
        <h1 className="page-title">General Settings</h1>
        <p className="body-text">Manage your brand identity and public profile.</p>

        <div className="card" style={{ marginTop: 24, padding: 24 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Brand Name</label>
          <div style={{ display: 'flex', gap: 12 }}>
            <input className="inp" value={brand} onChange={e => setBrand(e.target.value)} style={{ fontSize: 16 }} />
            <button className="btn-primary" onClick={saveBrand} disabled={saving}>{saving ? '...' : 'Update'}</button>
          </div>
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
