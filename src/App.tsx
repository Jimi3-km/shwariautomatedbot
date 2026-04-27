import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  MessageSquare, 
  Smartphone, 
  Activity, 
  RefreshCw, 
  Save, 
  Trash2, 
  Edit2, 
  Plus, 
  Check, 
  X,
  Play
} from 'lucide-react';
import { format } from 'date-fns';

type Phone = {
  id: number;
  model: string;
  storage: string;
  color: string;
  condition: string;
  price_ksh: number;
  availability: boolean;
  notes: string;
};

type Conversation = {
  id: number;
  sender_phone: string;
  sender_name: string;
  customer_message: string;
  ai_reply: string;
  created_at: string;
};

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  
  return (
    <>
      <div className="mesh-bg"></div>
      <div className="flex h-screen text-slate-200 font-sans relative z-0">
        {/* Sidebar */}
        <aside className="w-64 glass m-4 mr-0 flex flex-col hidden md:flex">
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 glass flex items-center justify-center border-indigo-500/50">
                <span className="text-xl font-bold text-indigo-400">S</span>
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white mb-1">Shwari iPhones</h1>
                <p className="text-[10px] text-indigo-400 font-medium tracking-widest uppercase">AI Dashboard</p>
              </div>
            </div>
          </div>
          <nav className="flex-1 px-4 py-6 space-y-2">
            <NavItem icon={<Activity />} label="Overview" active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} />
            <NavItem icon={<Smartphone />} label="Pricelist" active={activeTab === 'pricelist'} onClick={() => setActiveTab('pricelist')} />
            <NavItem icon={<MessageSquare />} label="Conversations" active={activeTab === 'conversations'} onClick={() => setActiveTab('conversations')} />
            <NavItem icon={<SettingsIcon />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-4 md:p-8">
          {activeTab === 'overview' && <OverviewTab onNavigate={setActiveTab} />}
          {activeTab === 'pricelist' && <PricelistTab />}
          {activeTab === 'conversations' && <ConversationsTab />}
          {activeTab === 'settings' && <SettingsTab />}
        </main>
      </div>
    </>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center w-full px-4 py-3 rounded-xl transition-colors ${
        active 
          ? 'bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30' 
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
      }`}
    >
      <span className="mr-3">{icon}</span>
      {label}
    </button>
  );
}

function OverviewTab({ onNavigate }: { onNavigate: (t: string) => void }) {
  const [stats, setStats] = useState({ conversationsToday: 0, phonesInStock: 0, phonesOutOfStock: 0 });

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(data => {
      if (!data.error) setStats(data);
    });
  }, []);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col gap-6">
      <header className="flex items-center justify-between mb-2">
        <h2 className="text-2xl font-bold tracking-tight text-white mb-0">Dashboard Overview</h2>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            <span className="text-sm font-medium text-slate-300">WhatsApp API: Online</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard title="Conversations Today" value={stats.conversationsToday} icon={<MessageSquare className="w-6 h-6 text-indigo-400" />} />
        <StatCard title="Phones In Stock" value={stats.phonesInStock} icon={<Check className="w-6 h-6 text-green-400" />} />
        <StatCard title="Out of Stock" value={stats.phonesOutOfStock} icon={<X className="w-6 h-6 text-red-400" />} />
      </div>

      <div className="mt-4 glass p-6 border-white/10">
        <h3 className="text-lg font-bold mb-4 text-white">Quick Actions</h3>
        <div className="flex space-x-4">
          <button onClick={() => onNavigate('pricelist')} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-bold transition-colors flex items-center text-sm shadow-md shadow-indigo-500/20">
            <Plus className="w-4 h-4 mr-2" /> ADD NEW PHONE
          </button>
          <button onClick={() => onNavigate('settings')} className="bg-white/5 hover:bg-white/10 text-white border border-white/10 px-6 py-2.5 rounded-lg font-bold transition-colors flex items-center text-sm">
            <SettingsIcon className="w-4 h-4 mr-2" /> CONFIGURE INTEGRATIONS
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string, value: number, icon: React.ReactNode }) {
  return (
    <div className="glass p-5 flex flex-col justify-center">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 bg-white/5 rounded-lg border border-white/10">{icon}</div>
        <span className="text-xs text-slate-400 uppercase tracking-wider">{title}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-white">{value}</span>
      </div>
    </div>
  );
}

function PricelistTab() {
  const [phones, setPhones] = useState<Phone[]>([]);
  const [form, setForm] = useState<Partial<Phone>>({});
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = () => {
    fetch('/api/pricelist').then(r => r.json()).then(data => {
      if (!data.error) setPhones(data);
    });
  };

  const handleSave = async () => {
    const url = editingId ? `/api/pricelist/${editingId}` : '/api/pricelist';
    const method = editingId ? 'PUT' : 'POST';
    
    // Validations & defaults
    const payload = {
        ...form,
        availability: form.availability !== false,
        price_ksh: Number(form.price_ksh) || 0
    };

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    setEditingId(null);
    setForm({});
    load();
  };

  const handleDelete = async (id: number) => {
    if(confirm('Are you sure you want to delete this item?')) {
        await fetch(`/api/pricelist/${id}`, { method: 'DELETE' });
        load();
    }
  };

  const isEditing = editingId !== null;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col gap-6">
      <h2 className="text-2xl font-bold tracking-tight text-white mb-2">Pricelist Manager</h2>
      
      {/* Editor Form */}
      <div className="glass p-6">
        <h3 className="text-lg font-bold mb-4 text-white border-b border-white/10 pb-2">{isEditing ? 'Edit Phone' : 'Add New Phone'}</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 text-sm">
          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="Model (e.g. iPhone 14)" value={form.model || ''} onChange={e => setForm({...form, model: e.target.value})} />
          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="Storage (e.g. 128GB)" value={form.storage || ''} onChange={e => setForm({...form, storage: e.target.value})} />
          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="Color" value={form.color || ''} onChange={e => setForm({...form, color: e.target.value})} />
          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="Condition (New/Used)" value={form.condition || ''} onChange={e => setForm({...form, condition: e.target.value})} />
          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="Price (KES)" type="number" value={form.price_ksh || ''} onChange={e => setForm({...form, price_ksh: Number(e.target.value)})} />
          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="Notes (e.g. sealed, scratch)" value={form.notes || ''} onChange={e => setForm({...form, notes: e.target.value})} />
          <label className="flex items-center space-x-2 px-2 text-slate-300">
            <input type="checkbox" className="rounded bg-black/20 border border-white/10 text-indigo-600 focus:ring-indigo-500 w-4 h-4" checked={form.availability !== false} onChange={e => setForm({...form, availability: e.target.checked})} />
            <span className="font-medium">In Stock</span>
          </label>
        </div>
        <div className="flex space-x-3 mt-4">
            <button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 justify-center rounded-lg font-bold text-sm transition-colors flex items-center shadow-md shadow-indigo-500/20">
                <Save className="w-4 h-4 mr-2"/> {isEditing ? 'SAVE CHANGES' : 'ADD PHONE'}
            </button>
            {isEditing && (
                <button onClick={() => { setEditingId(null); setForm({}); }} className="bg-white/5 hover:bg-white/10 text-white border border-white/10 px-5 py-2 justify-center rounded-lg font-bold text-sm transition-colors">
                    CANCEL
                </button>
            )}
        </div>
      </div>

      {/* Table */}
      <div className="glass overflow-hidden flex-1">
        <table className="w-full text-left border-collapse text-sm">
            <thead>
                <tr className="bg-white/5 border-b border-white/10">
                    <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Model</th>
                    <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Specs</th>
                    <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Price (KES)</th>
                    <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Status</th>
                    <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs text-right">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
                {phones.map(p => (
                    <tr key={p.id} className="hover:bg-white/5 transition-colors">
                        <td className="py-4 px-6 font-medium text-white">{p.model}</td>
                        <td className="py-4 px-6 text-slate-300">{p.storage} • {p.color} • {p.condition}</td>
                        <td className="py-4 px-6 text-white font-mono">{p.price_ksh.toLocaleString()}</td>
                        <td className="py-4 px-6">
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${p.availability ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                                {p.availability ? 'In Stock' : 'Out of Stock'}
                            </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                            <button onClick={() => { setEditingId(p.id); setForm(p); }} className="text-indigo-400 hover:text-indigo-300 hover:bg-white/5 p-2 rounded-lg transition-colors mr-2">
                                <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDelete(p.id)} className="text-red-400 hover:text-red-300 hover:bg-white/5 p-2 rounded-lg transition-colors">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </td>
                    </tr>
                ))}
                {phones.length === 0 && (
                    <tr><td colSpan={5} className="py-8 text-center text-slate-500">No phones in the pricelist yet.</td></tr>
                )}
            </tbody>
        </table>
      </div>
    </div>
  );
}

function ConversationsTab() {
  const [logs, setLogs] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = () => {
    setLoading(true);
    fetch('/api/conversations')
        .then(r => r.json())
        .then(data => {
            if(!data.error) setLogs(data);
        })
        .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 30000); // 30 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col gap-6">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-2xl font-bold tracking-tight text-white mb-0">Conversation Log</h2>
        <button onClick={fetchLogs} className={`flex items-center text-xs font-bold text-white bg-white/5 border border-white/10 px-4 py-2 rounded-lg hover:bg-white/10 transition-colors uppercase tracking-widest`}>
            <RefreshCw className={`w-3 h-3 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
        </button>
      </div>

      <div className="space-y-4">
        {logs.map(log => (
            <div key={log.id} className="glass overflow-hidden flex flex-col md:flex-row border border-white/10 p-4 gap-4">
                <div className="md:w-64 border-b md:border-b-0 md:border-r border-white/10 pr-4 flex flex-col justify-center">
                    <p className="font-bold text-indigo-400 text-sm uppercase">{log.sender_name}</p>
                    <p className="text-xs text-slate-500 font-mono mt-1">{log.sender_phone}</p>
                    <p className="text-[10px] text-slate-400 mt-2">{format(new Date(log.created_at), 'PPpp')}</p>
                </div>
                <div className="flex-1 space-y-4 pt-4 md:pt-0">
                    <div className="bg-white/5 p-3 rounded-lg border border-white/5 relative">
                        <span className="absolute -top-3 left-3 bg-[#0f172a] text-[10px] text-indigo-400 px-1 font-bold rounded">Customer</span>
                        <p className="text-sm italic text-slate-300 mt-1">{log.customer_message}</p>
                    </div>
                    <div className="bg-indigo-500/10 p-3 rounded-lg border border-indigo-500/20 relative mt-4">
                        <span className="absolute -top-3 left-3 bg-[#0f172a] text-[10px] text-indigo-400 px-1 font-bold rounded">AI Assistant</span>
                        <p className="text-sm text-slate-200 whitespace-pre-wrap mt-1">{log.ai_reply}</p>
                    </div>
                </div>
            </div>
        ))}
        {logs.length === 0 && (
            <div className="py-12 text-center glass border border-white/10">
                <MessageSquare className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <p className="text-slate-400">No conversations recorded yet.</p>
            </div>
        )}
      </div>
    </div>
  );
}

function SettingsTab() {
  const [config, setConfig] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [n8nStatus, setN8nStatus] = useState<string>('');

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(data => setConfig(data));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(config)
    });
    setSaving(false);
    alert('Settings saved successfully!');
  };

  const triggerN8n = async () => {
    setN8nStatus('Triggering...');
    try {
        const res = await fetch('/api/n8n/trigger', { method: 'POST', body: JSON.stringify({ source: 'manual_dashboard_trigger' }), headers: {'Content-Type': 'application/json'} });
        const data = await res.json();
        if(data.error) setN8nStatus('Error: ' + data.error);
        else setN8nStatus('Triggered successfully!');
    } catch(err: any) {
        setN8nStatus('Failed: ' + err.message);
    }
    setTimeout(() => setN8nStatus(''), 5000);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl flex flex-col gap-6">
      <h2 className="text-2xl font-bold tracking-tight text-white mb-2">System Settings</h2>
      
      <form onSubmit={handleSave} className="space-y-6">
        
        {/* DB Section */}
        <div className="glass p-6">
            <h3 className="text-lg font-bold text-white mb-4 border-b border-white/10 pb-2">Neon PostgreSQL</h3>
            <div className="space-y-4">
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase tracking-wider text-slate-400">Database URL</label>
                    <input type="password" required className="bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 font-mono" value={config.NEON_DATABASE_URL || ''} onChange={e => setConfig({...config, NEON_DATABASE_URL: e.target.value})} />
                </div>
            </div>
        </div>

        {/* AI Section */}
        <div className="glass p-6">
            <h3 className="text-lg font-bold text-white mb-4 border-b border-white/10 pb-2">Anthropic API</h3>
            <div className="space-y-4">
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase tracking-wider text-slate-400">API Key</label>
                    <input type="password" required className="bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 font-mono" value={config.ANTHROPIC_API_KEY || ''} onChange={e => setConfig({...config, ANTHROPIC_API_KEY: e.target.value})} />
                </div>
            </div>
        </div>

        {/* Meta Section */}
        <div className="glass p-6">
            <h3 className="text-lg font-bold text-white mb-4 border-b border-white/10 pb-2">Meta WhatsApp Cloud API</h3>
            <div className="space-y-4">
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase tracking-wider text-slate-400">Access Token</label>
                    <input type="password" required className="bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 font-mono" value={config.META_ACCESS_TOKEN || ''} onChange={e => setConfig({...config, META_ACCESS_TOKEN: e.target.value})} />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase tracking-wider text-slate-400">Phone Number ID</label>
                    <input type="text" required className="bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 font-mono" value={config.META_PHONE_NUMBER_ID || ''} onChange={e => setConfig({...config, META_PHONE_NUMBER_ID: e.target.value})} />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase tracking-wider text-slate-400">Webhook Verify Token</label>
                    <input type="text" required className="bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 font-mono" value={config.META_VERIFY_TOKEN || ''} onChange={e => setConfig({...config, META_VERIFY_TOKEN: e.target.value})} />
                </div>
            </div>
        </div>

        {/* n8n Section */}
        <div className="glass-accent p-6 flex flex-col gap-4">
            <h3 className="text-lg font-bold text-indigo-100 flex items-center gap-2 mb-2 border-b border-indigo-500/30 pb-2">n8n Automation</h3>
            <div className="space-y-4 mb-2">
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase tracking-wider text-indigo-300">Webhook URL Template</label>
                    <input type="text" placeholder="https://your-n8n-domain/webhook/{id}" className="bg-black/20 border border-indigo-500/30 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-400 font-mono" value={config.N8N_API_URL || ''} onChange={e => setConfig({...config, N8N_API_URL: e.target.value})} />
                    <p className="text-[10px] text-indigo-300 mt-1">Use {'{id}'} where the workflow ID goes.</p>
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase tracking-wider text-indigo-300">Workflow ID</label>
                    <input type="text" className="bg-black/20 border border-indigo-500/30 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-400 font-mono" value={config.N8N_WORKFLOW_ID || ''} onChange={e => setConfig({...config, N8N_WORKFLOW_ID: e.target.value})} />
                </div>
            </div>

            <div className="bg-indigo-900/40 rounded-lg p-4 border border-indigo-500/30 flex items-center justify-between">
                <div>
                    <p className="font-bold text-indigo-100 text-sm">Trigger Workflow</p>
                    <p className="text-[11px] text-indigo-200/70">Manually trigger the connected n8n workflow for testing.</p>
                </div>
                <div className="flex items-center space-x-4">
                    {n8nStatus && <span className="text-[10px] font-bold text-indigo-300 uppercase">{n8nStatus}</span>}
                    <button type="button" onClick={triggerN8n} className="bg-indigo-500 hover:bg-indigo-400 text-white px-4 py-2 rounded text-xs font-bold transition-all uppercase tracking-widest shadow-lg shadow-indigo-500/20 flex items-center">
                        <Play className="w-3 h-3 mr-2" /> Run Now
                    </button>
                </div>
            </div>
        </div>

        <div className="flex justify-end pt-2 pb-8">
            <button type="submit" disabled={saving} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg text-sm font-bold transition-all flex items-center shadow-md shadow-indigo-500/20">
                <Save className="w-4 h-4 mr-2" /> {saving ? 'SAVING...' : 'SAVE ALL SETTINGS'}
            </button>
        </div>

      </form>
    </div>
  );
}
