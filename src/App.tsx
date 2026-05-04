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
  Play,
  Flame,
  UserCheck,
  ArrowLeft,
  Bot
} from 'lucide-react';
import { format } from 'date-fns';

type Phone = {
  id: number;
  "Phone Model": string;
  "Specs": string;
  "Cash Price": number;
  "Deposit"?: number;
  "3 Months Plan"?: number;
  "12 Weeks"?: number;
  "Deposit_1"?: number;
  "6 Months Plan"?: number;
  "24 Weeks"?: number;
  availability: boolean;
  notes: string;
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
  product_model?: string;
  product_storage?: string;
  product_condition?: string;
  upsell_items?: string;
};

type Payment = {
  id: string;
  customer_phone: string;
  customer_email?: string;
  transaction_code: string;
  amount: number;
  payment_method: string;
  delivery_location?: string;
  product_model?: string;
  product_storage?: string;
  product_condition?: string;
  upsell_items?: string;
  payment_status: string;
  created_at: string;
  updated_at?: string;
};

// Helper to format prices safely
const formatPrice = (val: any) => {
  if (!val) return '-';
  const str = String(val).replace(/[^0-9.]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? val : num.toLocaleString();
};

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    const fetchPayments = async () => {
      try {
        const res = await fetch('/api/payments');
        if (!res.ok) throw new Error(await res.text());
        setPayments(await res.json());
      } catch (e) {
        console.error('Fetch payments error:', e);
      }
    };
    fetchPayments();
    const interval = setInterval(fetchPayments, 30000);
    return () => clearInterval(interval);
  }, []);


  return (
    <>
      <div className="mesh-bg"></div>
      <div className="flex h-screen text-slate-200 font-sans relative z-0">
        {/* Sidebar */}
        <aside className="w-64 glass m-4 mr-0 hidden md:flex flex-col">
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 glass flex items-center justify-center border-indigo-500/50">
                <span className="text-xl font-bold text-indigo-400">S</span>
              </div>
              <div>
                <h1 className="text-xl font-medium tracking-tight text-white mb-1">Shwari iPhones</h1>
                <p className="text-[10px] text-zinc-400 font-medium tracking-widest uppercase">Operating System</p>
              </div>
            </div>
          </div>
          <nav className="flex-1 px-4 py-6 space-y-2">
            <NavItem icon={<Activity />} label="Overview" active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} />
            <NavItem icon={<Smartphone />} label="Pricelist" active={activeTab === 'pricelist'} onClick={() => setActiveTab('pricelist')} />
            <NavItem icon={<MessageSquare />} label="Leads Pipeline" active={activeTab === 'leads'} onClick={() => setActiveTab('leads')} />
            <NavItem icon={<Check />} label="Sales Engine" active={activeTab === 'payments'} onClick={() => setActiveTab('payments')} />
            <NavItem icon={<SettingsIcon />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-4 md:p-8">
          {activeTab === 'overview' && <OverviewTab onNavigate={setActiveTab} />}
          {activeTab === 'pricelist' && <PricelistTab />}
          {activeTab === 'leads' && <LeadsTab />}
          {activeTab === 'payments' && <PaymentsTab payments={payments} />}
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
      className={`flex items-center w-full px-4 py-3 rounded-xl transition-colors ${active
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
  const [stats, setStats] = useState<any>({ totalLeads: 0, highValue: 0, inventory: { inStock: 0, outOfStock: 0 }, totalRevenue: 0, totalSales: 0 });

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(data => {
      if (!data.error) setStats(data);
    });
  }, []);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col gap-6">
      <header className="flex items-center justify-between mb-2">
        <h2 className="text-2xl font-light tracking-tight text-white mb-0">System Overview</h2>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            <span className="text-sm font-medium text-slate-300">WhatsApp API: Synced</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard title="Total Revenue" value={stats.totalRevenue || 0} icon={<Activity className="w-6 h-6 text-green-400" />} isCurrency />
        <StatCard title="Total Sales" value={stats.totalSales || 0} icon={<Check className="w-6 h-6 text-indigo-400" />} />
        <StatCard title="Total Leads" value={stats.totalLeads || 0} icon={<MessageSquare className="w-6 h-6 text-indigo-400" />} />
        <StatCard title="Hot Leads" value={stats.highValue || 0} icon={<Flame className="w-6 h-6 text-orange-400" />} />
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

function StatCard({ title, value, icon, isCurrency }: { title: string, value: number, icon: React.ReactNode, isCurrency?: boolean }) {
  return (
    <div className="glass p-5 flex flex-col justify-center">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 bg-white/5 rounded-lg border border-white/10">{icon}</div>
        <span className="text-xs text-slate-400 uppercase tracking-wider">{title}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-white">
          {isCurrency ? `KES ${value.toLocaleString()}` : value.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function PricelistTab() {
  const [phones, setPhones] = useState<Phone[]>([]);
  const [form, setForm] = useState<Partial<Phone>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [activeCategory, setActiveCategory] = useState('general_pricelist');

  useEffect(() => {
    load();
  }, [activeCategory]);

  const load = () => {
    fetch(`/api/pricelist?category=${activeCategory}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok || data.error) throw new Error(data.error || 'Failed to load pricelist');
        setPhones(data);
      })
      .catch(err => {
        console.error('Check your Supabase connection:', err);
      });
  };

  const handleSave = async () => {
    try {
      const url = editingId ? `/api/pricelist/${editingId}?category=${activeCategory}` : `/api/pricelist?category=${activeCategory}`;
      const method = editingId ? 'PUT' : 'POST';

      // Validations & defaults
      const payload = {
        ...form,
        availability: form.availability !== false
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || 'Failed to save phone');

      setEditingId(null);
      setForm({});
      load();
    } catch (err: any) {
      alert(`Error saving phone: ${err.message}`);
      console.error(err);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this item?')) {
      await fetch(`/api/pricelist/${id}?category=${activeCategory}`, { method: 'DELETE' });
      load();
    }
  };

  const isEditing = editingId !== null;

  const categories = [
    { id: 'general_pricelist', name: 'General Pricelist' },
    { id: 'lipa_mdogo_mdogo', name: 'Lipa Mdogo Mdogo' }
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col gap-6">
      <h2 className="text-2xl font-bold tracking-tight text-white mb-2">Pricelist Manager</h2>

      {/* Category Tabs */}
      <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-hide">
        {categories.map(cat => (
          <button
            key={cat.id}
            className={`whitespace-nowrap px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeCategory === cat.id ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-white/10'}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </div>
      {/* Editor Form */}
      <div className="glass p-6">
        <h3 className="text-lg font-bold mb-4 text-white border-b border-white/10 pb-2">{isEditing ? 'Edit Phone' : 'Add New Phone'}</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 text-sm">
          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="Model (e.g. iPhone 14)" value={form["Phone Model"] || ''} onChange={e => setForm({ ...form, "Phone Model": e.target.value })} />
          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="Specs (e.g. 128GB Blue)" value={form["Specs"] || ''} onChange={e => setForm({ ...form, "Specs": e.target.value })} />
          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="Cash Price (KES)" type="number" value={form["Cash Price"] || ''} onChange={e => setForm({ ...form, "Cash Price": Number(e.target.value) })} />

          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="Deposit" type="number" value={form["Deposit"] || ''} onChange={e => setForm({ ...form, "Deposit": Number(e.target.value) })} />
          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="3 Months Plan" type="number" value={form["3 Months Plan"] || ''} onChange={e => setForm({ ...form, "3 Months Plan": Number(e.target.value) })} />
          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="12 Weeks" type="number" value={form["12 Weeks"] || ''} onChange={e => setForm({ ...form, "12 Weeks": Number(e.target.value) })} />
          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="Deposit 1" type="number" value={form["Deposit_1"] || ''} onChange={e => setForm({ ...form, "Deposit_1": Number(e.target.value) })} />
          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="6 Months Plan" type="number" value={form["6 Months Plan"] || ''} onChange={e => setForm({ ...form, "6 Months Plan": Number(e.target.value) })} />
          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="24 Weeks" type="number" value={form["24 Weeks"] || ''} onChange={e => setForm({ ...form, "24 Weeks": Number(e.target.value) })} />

          <input className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-500" placeholder="Notes (e.g. sealed, scratch)" value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
          <label className="flex items-center space-x-2 px-2 text-slate-300">
            <input type="checkbox" className="rounded bg-black/20 border border-white/10 text-indigo-600 focus:ring-indigo-500 w-4 h-4" checked={form.availability !== false} onChange={e => setForm({ ...form, availability: e.target.checked })} />
            <span className="font-medium">In Stock</span>
          </label>
        </div>
        <div className="flex space-x-3 mt-4">
          <button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 justify-center rounded-lg font-bold text-sm transition-colors flex items-center shadow-md shadow-indigo-500/20">
            <Save className="w-4 h-4 mr-2" /> {isEditing ? 'SAVE CHANGES' : 'ADD PHONE'}
          </button>
          {isEditing && (
            <button onClick={() => { setEditingId(null); setForm({}); }} className="bg-white/5 hover:bg-white/10 text-white border border-white/10 px-5 py-2 justify-center rounded-lg font-bold text-sm transition-colors">
              CANCEL
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="glass overflow-hidden flex-1 overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
          <thead>
            <tr className="bg-white/5 border-b border-white/10">
              <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Model</th>
              <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Specs</th>
              <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Cash Price</th>
              {activeCategory === 'lipa_mdogo_mdogo' && (
                <>
                  <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Deposit</th>
                  <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">3 Mo Plan</th>
                  <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">12 Weeks</th>
                  <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Deposit 1</th>
                  <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">6 Mo Plan</th>
                  <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">24 Weeks</th>
                </>
              )}
              <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Status</th>
              <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {phones.map(p => (
              <tr key={p.id} className="hover:bg-white/5 transition-colors">
                <td className="py-4 px-6 font-medium text-white">{p["Phone Model"]}</td>
                <td className="py-4 px-6 text-slate-300">{p["Specs"]}</td>
                <td className="py-4 px-6 text-white font-mono">{formatPrice(p["Cash Price"])}</td>
                {activeCategory === 'lipa_mdogo_mdogo' && (
                  <>
                    <td className="py-4 px-6 text-slate-300 font-mono">{formatPrice(p["Deposit"])}</td>
                    <td className="py-4 px-6 text-slate-300 font-mono">{formatPrice(p["3 Months Plan"])}</td>
                    <td className="py-4 px-6 text-slate-300 font-mono">{formatPrice(p["12 Weeks"])}</td>
                    <td className="py-4 px-6 text-slate-300 font-mono">{formatPrice(p["Deposit_1"])}</td>
                    <td className="py-4 px-6 text-slate-300 font-mono">{formatPrice(p["6 Months Plan"])}</td>
                    <td className="py-4 px-6 text-slate-300 font-mono">{formatPrice(p["24 Weeks"])}</td>
                  </>
                )}
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

function LeadsTab() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [receiptForm, setReceiptForm] = useState({ transactionCode: '', amount: '', storage: '', condition: '' });
  const [sendingReceipt, setSendingReceipt] = useState(false);

  const handleSendReceipt = async () => {
    if (!selectedLead) return;
    if (!selectedLead.email || !selectedLead.email.includes('@')) {
      alert("Cannot send receipt: Customer email is missing or invalid. Please collect it in the chat first.");
      return;
    }
    if (!receiptForm.transactionCode || !receiptForm.amount) {
      alert("Please enter Transaction Code and Amount to process.");
      return;
    }

    setSendingReceipt(true);
    try {
      // 1. Record the sale in the Sales Engine database
      await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_code: receiptForm.transactionCode,
          customer_phone: selectedLead.phone,
          customer_email: selectedLead.email,
          amount: parseFloat(receiptForm.amount),
          payment_status: 'completed',
          payment_method: selectedLead.payment_method || 'M-Pesa',
          delivery_location: selectedLead.delivery_location || 'Store Pickup',
          product_model: selectedLead.product_model || selectedLead.interest || 'Unknown',
          product_storage: receiptForm.storage,
          product_condition: receiptForm.condition,
          upsell_items: selectedLead.upsell_items || ''
        })
      });

      // 2. Send webhook for email receipt
      const res = await fetch("https://builtwithaiautomations.app.n8n.cloud/webhook/send-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: selectedLead.email,
          phone: selectedLead.phone || '',
          product: selectedLead.product_model || selectedLead.interest || 'iPhone',
          location: selectedLead.delivery_location || '',
          paymentMethod: selectedLead.payment_method || '',
          transactionCode: receiptForm.transactionCode,
          amount: receiptForm.amount,
          storage: receiptForm.storage,
          condition: receiptForm.condition,
          product_model: selectedLead.product_model || selectedLead.interest || 'iPhone',
          product_storage: receiptForm.storage,
          product_condition: receiptForm.condition,
          upsell_items: selectedLead.upsell_items || ''
        })
      });

      if (res.ok) {
        alert("Receipt formally sent to Customer!");
        await updateStage(selectedLead.phone, "payment_submitted");
      } else {
        const errText = await res.text();
        console.error("n8n Webhook Error:", errText);
        alert(`Failed to send receipt (n8n Error 500). Please check your n8n execution logs for the "Send a message" node. It might be a Gmail authentication issue.`);
      }
    } catch (e) {
      console.error(e);
      alert("Network Error: Could not connect to n8n. Check if the webhook URL is correct and active.");
    } finally {
      setSendingReceipt(false);
    }
  };

  const handleConfirmPaymentNoReceipt = async () => {
    if (!selectedLead) return;
    if (!receiptForm.transactionCode || !receiptForm.amount) {
      alert("Please enter Transaction Code and Amount to process.");
      return;
    }

    try {
      await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_code: receiptForm.transactionCode,
          customer_phone: selectedLead.phone,
          customer_email: selectedLead.email || '',
          amount: parseFloat(receiptForm.amount),
          payment_status: 'confirmed',
          payment_method: selectedLead.payment_method || 'M-Pesa',
          delivery_location: selectedLead.delivery_location || 'Store Pickup',
          product_model: selectedLead.product_model || selectedLead.interest || 'Unknown',
          product_storage: receiptForm.storage,
          product_condition: receiptForm.condition,
          upsell_items: selectedLead.upsell_items || ''
        })
      });
      await updateStage(selectedLead.phone, "payment_submitted");
      alert("Payment recorded successfully!");
    } catch (e) {
      console.error(e);
      alert("Error saving payment to the database.");
    }
  };

  const fetchLeads = () => {
    setLoading(true);
    fetch('/api/leads')
      .then(r => r.json())
      .then(data => {
        if (!data.error) setLeads(data);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLeads();
    const interval = setInterval(fetchLeads, 30000); // 30 seconds
    return () => clearInterval(interval);
  }, []);

  const handleSelectLead = (lead: Lead) => {
    setSelectedLead(lead);
    setLoadingConversations(true);
    fetch(`/api/leads/${lead.phone}/conversations`)
      .then(r => r.json())
      .then(data => {
        if (!data.error) setConversations(data);
      })
      .finally(() => setLoadingConversations(false));
  };

  const updateStage = async (phone: string, stage: string) => {
    await fetch(`/api/leads/${phone}/stage`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage })
    });
    fetchLeads();
  };

  const getUrgencyColor = (u: string) => {
    switch (u) {
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col gap-6 h-full">
      {!selectedLead ? (
        <>
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-2xl font-bold tracking-tight text-white mb-0">Leads Pipeline</h2>
            <button onClick={fetchLeads} className={`flex items-center text-xs font-bold text-white bg-white/5 border border-white/10 px-4 py-2 rounded-lg hover:bg-white/10 transition-colors uppercase tracking-widest`}>
              <RefreshCw className={`w-3 h-3 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {leads.map(lead => (
              <div key={lead.id} onClick={() => handleSelectLead(lead)} className="glass cursor-pointer overflow-hidden flex flex-col border border-white/10 hover:border-indigo-500/30 hover:bg-white/5 transition-all group">
                <div className="p-6 flex flex-col md:flex-row gap-6 items-center">
                  {/* Contact Info */}
                  <div className="md:w-72 flex flex-col">
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                        <UserCheck size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-white text-lg">{lead.phone}</h4>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {lead.email && <span className="text-[10px] bg-white/5 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/20 font-mono">{lead.email}</span>}
                          {lead.delivery_location && <span className="text-[10px] bg-indigo-500/20 text-white px-2 py-0.5 rounded border border-indigo-500/30 uppercase font-bold">{lead.delivery_location}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      <div className="flex justify-between text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                        <span>Product Interest</span>
                        <span className="text-indigo-300">{lead.product_model ? `${lead.product_model} ${lead.product_storage || ''}` : (lead.interest || 'Unknown')}</span>
                      </div>
                      {lead.upsell_items && lead.upsell_items !== 'None' && (
                        <div className="flex justify-between text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                          <span>Upsells</span>
                          <span className="text-green-400">{lead.upsell_items}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                        <span>Delivery Location</span>
                        <span className="text-slate-300">{lead.delivery_location || 'Not set'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Conversation Snapshot */}
                  <div className="flex-1 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Last Conversation Snippet</span>
                      <span className="text-[10px] text-slate-600 font-mono uppercase">{format(new Date(lead.last_contact), 'MMM dd, HH:mm')}</span>
                    </div>
                    <div className="bg-black/20 p-4 rounded-xl border border-white/5 relative">
                      <p className="text-sm text-slate-300 italic line-clamp-2">“{lead.last_message || "Awaiting first message..."}”</p>
                    </div>
                    {lead.payment_method && (
                      <div className="mt-2 text-[11px] bg-green-500/5 text-green-400 p-2 rounded border border-green-500/10 font-mono">
                        <span className="font-bold mr-2 uppercase">Payment:</span>
                        {lead.payment_method}
                      </div>
                    )}
                  </div>

                  {/* Status & Priority */}
                  <div className="md:w-56 flex flex-col gap-3 items-end justify-between border-t md:border-t-0 md:border-l border-white/10 pt-4 md:pt-0 md:pl-6">
                    <div className="flex flex-col gap-2 items-end w-full">
                      <span className={`text-[10px] font-bold px-3 py-1 rounded-full border shadow-sm ${getUrgencyColor(lead.urgency || 'low')}`}>
                        {lead.urgency?.toUpperCase() || 'LOW'} PRIORITY
                      </span>
                      <span className="text-[10px] font-bold px-3 py-1 rounded-full bg-white/5 text-slate-400 border border-white/10">
                        INTENT: {lead.intent?.toUpperCase() || 'VIEWING'}
                      </span>
                    </div>

                    <div className="w-full space-y-2" onClick={e => e.stopPropagation()}>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block text-right">Update Stage</label>
                      <select
                        value={lead.stage}
                        onChange={(e) => updateStage(lead.phone, e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:ring-2 focus:ring-indigo-500 transition-all font-bold"
                      >
                        <option value="new">New Lead</option>
                        <option value="interested">Interested / Exploring</option>
                        <option value="quoted">Price Quoted</option>
                        <option value="location_collected">Delivery Set</option>
                        <option value="payment_submitted">Payment Received</option>
                        <option value="closed">Sale Completed</option>
                        <option value="lost">Lost / No Response</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {leads.length === 0 && (
              <div className="py-16 text-center glass border border-white/10">
                <MessageSquare className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <p className="text-slate-400">No leads captured yet.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        /* INDIVIDUAL LEAD DETAIL VIEW */
        <div className="flex flex-col h-full gap-4 w-full">
          {/* Header */}
          <div className="flex items-center justify-between glass p-4 border border-indigo-500/30 rounded-2xl">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSelectedLead(null)}
                className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-slate-300 transition-colors border border-white/10"
              >
                <ArrowLeft size={18} />
              </button>
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white mb-0 flex items-center gap-2">
                  {selectedLead.phone}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shadow-sm ${getUrgencyColor(selectedLead.urgency || 'low')}`}>
                    {selectedLead.urgency?.toUpperCase() || 'LOW'} PRIORITY
                  </span>
                </h2>
                <div className="flex items-center gap-4 mt-1">
                  <p className="text-xs text-indigo-400 font-mono italic">{selectedLead.email || 'No email provided'}</p>
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">• INTENT: {selectedLead.intent || 'VIEWING'}</span>
                  {selectedLead.product_model && <span className="text-[10px] text-green-400 uppercase font-bold tracking-widest">• {selectedLead.product_model} {selectedLead.product_storage} ({selectedLead.product_condition})</span>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={selectedLead.stage}
                onChange={(e) => {
                  updateStage(selectedLead.phone, e.target.value);
                  setSelectedLead({ ...selectedLead, stage: e.target.value });
                }}
                className="bg-indigo-900/40 border border-indigo-500/30 rounded-lg px-4 py-2 text-xs text-indigo-100 focus:ring-2 focus:ring-indigo-500 transition-all font-bold uppercase"
              >
                <option value="new">New Lead</option>
                <option value="interested">Interested / Exploring</option>
                <option value="quoted">Price Quoted</option>
                <option value="location_collected">Delivery Set</option>
                <option value="payment_submitted">Payment Received</option>
                <option value="closed">Sale Completed</option>
                <option value="lost">Lost / No Response</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col md:flex-row h-full gap-4 overflow-hidden min-h-[500px]">
            {/* Left Panel: Details */}
            <div className="w-full md:w-80 glass flex flex-col p-6 overflow-y-auto">
              <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-4 border-b border-white/10 pb-2">Lead Information</h3>

              <div className="space-y-4">
                <div className="glass p-3 rounded-xl border border-white/5">
                  <span className="text-[10px] uppercase text-zinc-500 font-bold tracking-wider block mb-1">Product Interest</span>
                  <p className="text-white text-sm font-medium">{selectedLead.product_model ? `${selectedLead.product_model} ${selectedLead.product_storage || ''}` : selectedLead.interest || 'Unknown'}</p>
                </div>

                <div className="glass p-3 rounded-xl border border-white/5">
                  <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">Delivery Location</span>
                  <p className="text-white text-sm font-medium">{selectedLead.delivery_location || 'Not specified'}</p>
                </div>

                <div className="glass p-3 rounded-xl border border-white/5">
                  <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">Payment Method</span>
                  <p className="text-green-400 font-mono text-sm">{selectedLead.payment_method || 'Not determined'}</p>
                </div>

                <div className="glass p-3 rounded-xl border border-white/5">
                  <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">Last Contact</span>
                  <p className="text-slate-300 font-mono text-sm">{format(new Date(selectedLead.last_contact), 'MMM dd, yyyy HH:mm')}</p>
                </div>
              </div>

              {/* Admin Actions */}
              <div className="mt-6 border-t border-white/10 pt-4">
                <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-widest mb-4">Admin Actions & Receipt</h3>

                <div className="space-y-3 mb-4">
                  <input placeholder="Transaction Code (e.g. QHJ82XZ)" className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white" value={receiptForm.transactionCode} onChange={e => setReceiptForm({ ...receiptForm, transactionCode: e.target.value })} />
                  <input placeholder="Amount Paid (KES) (e.g. 50000)" type="number" className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white" value={receiptForm.amount} onChange={e => setReceiptForm({ ...receiptForm, amount: e.target.value })} />
                  <div className="flex gap-2">
                    <input placeholder="Storage (e.g 128GB)" className="w-1/2 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white" value={receiptForm.storage} onChange={e => setReceiptForm({ ...receiptForm, storage: e.target.value })} />
                    <input placeholder="Condition (e.g New)" className="w-1/2 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white" value={receiptForm.condition} onChange={e => setReceiptForm({ ...receiptForm, condition: e.target.value })} />
                  </div>
                </div>

                <div className="flex flex-col gap-2 drop-shadow-lg z-50">
                  <button onClick={handleConfirmPaymentNoReceipt} className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-white font-medium py-2 px-4 rounded-lg text-xs uppercase tracking-wider transition-all shadow-md">Record Payment (Save to OS)</button>
                  <button onClick={handleSendReceipt} disabled={sendingReceipt} className="w-full bg-slate-100 hover:bg-white text-black font-semibold py-2 px-4 rounded-lg text-xs uppercase tracking-wider transition-all flex items-center justify-center shadow-lg disabled:opacity-50">
                    {sendingReceipt ? 'Processing...' : 'Verify & Send Email Receipt'}
                  </button>
                </div>
              </div>

            </div>

            {/* Right Panel: Conversation */}
            <div className="flex-1 glass flex flex-col border border-indigo-500/20 rounded-2xl overflow-hidden relative">
              <div className="p-4 border-b border-white/10 bg-black/20 flex justify-between items-center">
                <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                  <MessageSquare size={16} className="text-indigo-400" /> Conversation Log
                </h3>
                {loadingConversations && <RefreshCw size={14} className="text-slate-400 animate-spin" />}
              </div>

              <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
                {conversations.length === 0 && !loadingConversations && (
                  <div className="m-auto text-center text-slate-500">
                    <MessageSquare size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No recorded conversation yet.</p>
                  </div>
                )}
                {conversations.map((row, i) => (
                  <React.Fragment key={i}>
                    {/* Customer Bubble */}
                    {row.message && (
                      <div className="flex flex-col max-w-[80%] self-start items-start">
                        <div className="flex items-center gap-2 px-1 mb-1">
                          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Customer</span>
                          <span className="text-[9px] text-slate-600 font-mono">{format(new Date(row.created_at), 'HH:mm')}</span>
                        </div>
                        <div className="p-4 rounded-2xl text-sm bg-white/10 text-slate-200 border border-white/10 rounded-tl-sm">
                          <p className="whitespace-pre-wrap">{row.message}</p>
                        </div>
                      </div>
                    )}

                    {/* AI Agent Bubble */}
                    {row.response && (
                      <div className="flex flex-col max-w-[80%] self-end items-end mt-2">
                        <div className="flex items-center gap-2 px-1 mb-1">
                          <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Sales Agent</span>
                          <span className="text-[9px] text-zinc-600 font-mono">{format(new Date(row.created_at), 'HH:mm')}</span>
                        </div>
                        <div className="p-4 rounded-2xl text-sm bg-indigo-600 text-white rounded-tr-sm shadow-md shadow-indigo-500/20">
                          <p className="whitespace-pre-wrap">{row.response}</p>
                          {(row.product_model || row.delivery_location || row.payment_method || row.email) && (
                            <div className="mt-3 pt-3 border-t border-white/20 flex flex-wrap gap-2">
                              {row.product_model && <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded uppercase font-bold">Product: {row.product_model} {row.product_storage}</span>}
                              {row.delivery_location && <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded uppercase font-bold">Loc: {row.delivery_location}</span>}
                              {row.payment_method && <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded uppercase font-bold">Pay: {row.payment_method}</span>}
                              {row.transaction_code && <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded font-mono font-bold">{row.transaction_code}</span>}
                              {row.email && <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded font-mono">{row.email}</span>}
                              {row.upsell_items && <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded">Upsell: {row.upsell_items}</span>}
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
      )}
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    setSaving(false);
    alert('Settings saved successfully!');
  };

  const triggerN8n = async () => {
    setN8nStatus('Triggering...');
    try {
      const res = await fetch('/api/n8n/trigger', { method: 'POST', body: JSON.stringify({ source: 'manual_dashboard_trigger' }), headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (data.error) setN8nStatus('Error: ' + data.error);
      else setN8nStatus('Triggered successfully!');
    } catch (err: any) {
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
          <h3 className="text-lg font-bold text-white mb-4 border-b border-white/10 pb-2">Supabase Settings</h3>
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-slate-400">Database Connection String</label>
              <input type="password" required className="bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 font-mono" value={config.SUPABASE_DATABASE_URL || ''} onChange={e => setConfig({ ...config, SUPABASE_DATABASE_URL: e.target.value })} />
            </div>
          </div>
        </div>

        {/* n8n Section */}
        <div className="glass-accent p-6 flex flex-col gap-4">
          <h3 className="text-lg font-bold text-indigo-100 flex items-center gap-2 mb-2 border-b border-indigo-500/30 pb-2">n8n Automation</h3>
          <div className="space-y-4 mb-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-indigo-300">Webhook URL Template</label>
              <input type="text" placeholder="https://your-n8n-domain/webhook/{id}" className="bg-black/20 border border-indigo-500/30 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-400 font-mono" value={config.N8N_API_URL || ''} onChange={e => setConfig({ ...config, N8N_API_URL: e.target.value })} />
              <p className="text-[10px] text-indigo-300 mt-1">Use {'{id}'} where the workflow ID goes.</p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-indigo-300">Workflow ID</label>
              <input type="text" className="bg-black/20 border border-indigo-500/30 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-400 font-mono" value={config.N8N_WORKFLOW_ID || ''} onChange={e => setConfig({ ...config, N8N_WORKFLOW_ID: e.target.value })} />
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

function PaymentsTab({ payments }: { payments: Payment[] }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Sales Engine</h2>
          <p className="text-slate-400 text-sm">Automated sales tracking and revenue history.</p>
        </div>
      </div>

      <div className="glass overflow-hidden">
        <table className="w-full text-left whitespace-nowrap">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Code</th>
              <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Customer</th>
              <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Product</th>
              <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Amount</th>
              <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Status</th>
              <th className="py-3 px-6 font-medium text-slate-400 uppercase tracking-wider text-xs">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-sm">
            {payments.map(py => (
              <tr key={py.id} className="hover:bg-white/5 transition-colors border-b border-white/5 last:border-0">
                <td className="py-4 px-6 font-mono text-indigo-300 text-xs">{py.transaction_code}</td>
                <td className="py-4 px-6">
                  <div className="flex flex-col">
                    <span className="text-white font-medium">{py.customer_phone}</span>
                    <span className="text-[10px] text-slate-500 font-mono italic">{py.customer_email || 'No email'}</span>
                  </div>
                </td>
                <td className="py-4 px-6">
                  <div className="flex flex-col">
                    <span className="text-white text-xs font-bold">{py.product_model || 'Store Product'}</span>
                    <span className="text-[10px] text-indigo-400 uppercase font-medium">{py.product_storage} {py.product_condition}</span>
                  </div>
                </td>
                <td className="py-4 px-6 text-green-400 font-mono font-bold">KES {formatPrice(py.amount)}</td>
                <td className="py-4 px-6">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-black border tracking-widest ${py.payment_status === 'confirmed' || py.payment_status === 'completed' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'}`}>
                    {py.payment_status === 'confirmed' ? 'SOLD' : py.payment_status.toUpperCase()}
                  </span>
                </td>
                <td className="py-4 px-6 text-slate-500 font-mono text-xs">
                  {format(new Date(py.created_at), 'MMM dd, HH:mm')}
                </td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr><td colSpan={7} className="py-12 text-center text-slate-500 italic">No payments recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

