import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  Sparkles, Filter, Download, RefreshCw, CheckCircle2, AlertTriangle, Bug,
  Tag, Clock, Cpu, MessageSquare, Terminal, Eye, ShieldAlert,
} from 'lucide-react';
import {
  Button, Card, Field, Input, Modal, Pill, Select, Textarea,
  useToast, LoadingState, EmptyState,
} from '../components/ui';
import { useSession } from '../app/SessionContext';
import {
  getAgentTurns, labelAgentTurn, type AgentTurnItem, type AgentTurnFilters, type AgentTurnLabel,
} from '../lib/api';

const ROLES = [
  { value: '', label: 'All Roles' },
  { value: 'manager', label: 'Manager (Shwari)' },
  { value: 'sales', label: 'Sales Specialist' },
  { value: 'support', label: 'Support Specialist' },
  { value: 'booking', label: 'Booking Specialist' },
  { value: 'orders', label: 'Orders Specialist' },
];

const CHANNELS = [
  { value: '', label: 'All Channels' },
  { value: 'dashboard', label: 'Dashboard (/shwari)' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'webchat', label: 'Webchat' },
  { value: 'email', label: 'Email' },
];

const PROFILES = [
  { value: '', label: 'All Model Profiles' },
  { value: 'primary', label: 'Primary (Kimi/Llama-70B)' },
  { value: 'fast', label: 'Fast (Nemotron-3.5)' },
  { value: 'fallback', label: 'Fallback' },
];

const STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'success', label: 'Success' },
  { value: 'fallback', label: 'Fallback Triggered' },
  { value: 'error', label: 'Error' },
];

const LABELS = [
  { value: '', label: 'All Labels' },
  { value: 'unlabeled', label: 'Unlabeled Turns' },
  { value: 'ok', label: 'OK (Pass)' },
  { value: 'needs_improvement', label: 'Needs Improvement' },
  { value: 'bug', label: 'Bug' },
];

const SUGGESTED_TAGS = [
  'hallucination',
  'swahili_fluency',
  'sheng_attunement',
  'wrong_tool',
  'unnecessary_tool',
  'slow_latency',
  'formatting_issue',
  'unverified_payment_claim',
  'escalation_accuracy',
];

export function AgentQA() {
  const { isAdmin } = useSession();
  const toast = useToast();

  const [turns, setTurns] = useState<AgentTurnItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [role, setRole] = useState('');
  const [channelType, setChannelType] = useState('');
  const [modelProfile, setModelProfile] = useState('');
  const [status, setStatus] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  const [toolSearch, setToolSearch] = useState('');

  // Selected turn for review & labeling
  const [selectedTurn, setSelectedTurn] = useState<AgentTurnItem | null>(null);
  const [reviewLabel, setReviewLabel] = useState<'ok' | 'needs_improvement' | 'bug'>('ok');
  const [reviewTags, setReviewTags] = useState<string[]>([]);
  const [reviewNotes, setReviewNotes] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [savingLabel, setSavingLabel] = useState(false);

  const fetchTurns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: AgentTurnFilters = {
        role: role || undefined,
        channel_type: channelType || undefined,
        model_profile: modelProfile || undefined,
        status: status || undefined,
        label: labelFilter || undefined,
        tool: toolSearch.trim() || undefined,
        limit: 100,
      };
      const res = await getAgentTurns(filters);
      setTurns(res.turns);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fetch agent turns');
    } finally {
      setLoading(false);
    }
  }, [role, channelType, modelProfile, status, labelFilter, toolSearch]);

  useEffect(() => {
    if (isAdmin) {
      fetchTurns();
    }
  }, [fetchTurns, isAdmin]);

  // Aggregate metrics
  const metrics = useMemo(() => {
    let ok = 0;
    let needsImprovement = 0;
    let bug = 0;
    let labeled = 0;

    for (const t of turns) {
      if (t.label) {
        labeled++;
        if (t.label.label === 'ok') ok++;
        else if (t.label.label === 'needs_improvement') needsImprovement++;
        else if (t.label.label === 'bug') bug++;
      }
    }

    return { total: turns.length, labeled, ok, needsImprovement, bug };
  }, [turns]);

  const openReviewModal = (turn: AgentTurnItem) => {
    setSelectedTurn(turn);
    if (turn.label) {
      setReviewLabel(turn.label.label);
      setReviewTags([...turn.label.tags]);
      setReviewNotes(turn.label.notes || '');
    } else {
      setReviewLabel('ok');
      setReviewTags([]);
      setReviewNotes('');
    }
    setTagInput('');
  };

  const handleSaveLabel = async () => {
    if (!selectedTurn) return;
    setSavingLabel(true);
    try {
      const res = await labelAgentTurn(selectedTurn.id, {
        label: reviewLabel,
        tags: reviewTags,
        notes: reviewNotes,
      });

      // Update in-memory state
      setTurns((prev) =>
        prev.map((t) => (t.id === selectedTurn.id ? { ...t, label: res.label } : t))
      );
      setSelectedTurn((prev) => (prev ? { ...prev, label: res.label } : null));

      toast.push('success', `Turn labeled as "${reviewLabel}" successfully`);
      setSelectedTurn(null);
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Failed to save label');
    } finally {
      setSavingLabel(false);
    }
  };

  const toggleTag = (tag: string) => {
    setReviewTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const addCustomTag = () => {
    const clean = tagInput.trim().toLowerCase().replace(/\s+/g, '_');
    if (clean && !reviewTags.includes(clean)) {
      setReviewTags((prev) => [...prev, clean]);
      setTagInput('');
    }
  };

  const handleExportJsonl = () => {
    const params = new URLSearchParams();
    if (role) params.set('role', role);
    if (labelFilter && labelFilter !== 'unlabeled') params.set('label', labelFilter);
    params.set('labeled_only', 'false');

    window.open(`/api/admin/agent-turns/export?${params.toString()}`, '_blank');
  };

  if (!isAdmin) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center">
        <ShieldAlert size={40} style={{ color: 'var(--danger)', marginBottom: 16 }} />
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>Access Restricted</h2>
        <p style={{ color: 'var(--text-3)', marginTop: 8, maxWidth: 400 }}>
          The Agent QA & Evaluation suite is restricted to workspace Administrators and Owners.
        </p>
      </div>
    );
  }

  return (
    <div className="scroll-y" style={{ flex: 1, padding: '24px 28px' }}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4" style={{ marginBottom: 20 }}>
        <div>
          <div className="flex items-center gap-2">
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>Agent QA & Evaluation</h1>
            <span className="pill pill-accent" style={{ fontSize: 11 }}>NVIDIA NIM Telemetry</span>
          </div>
          <p style={{ color: 'var(--text-3)', fontSize: 13.5, marginTop: 4 }}>
            Monitor live LLM agent turns, inspect prompt & tool traces, label quality benchmarks, and export regression datasets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={<Download size={14} />} onClick={handleExportJsonl}>
            Export Dataset (JSONL)
          </Button>
          <Button variant="solid" size="sm" icon={<RefreshCw size={14} />} loading={loading} onClick={fetchTurns}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Metrics Summary Strip */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginBottom: 20 }}>
        <Card padded style={{ padding: '12px 16px' }}>
          <div style={{ color: 'var(--text-3)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Turns Retrieved</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{metrics.total}</div>
        </Card>
        <Card padded style={{ padding: '12px 16px' }}>
          <div style={{ color: 'var(--text-3)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Labeled Turns</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: 'var(--accent)' }}>
            {metrics.labeled} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-3)' }}>({metrics.total ? Math.round((metrics.labeled / metrics.total) * 100) : 0}%)</span>
          </div>
        </Card>
        <Card padded style={{ padding: '12px 16px' }}>
          <div style={{ color: 'var(--success)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Pass (OK)</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: 'var(--success)' }}>{metrics.ok}</div>
        </Card>
        <Card padded style={{ padding: '12px 16px' }}>
          <div style={{ color: 'var(--warning)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Needs Improvement</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: 'var(--warning)' }}>{metrics.needsImprovement}</div>
        </Card>
        <Card padded style={{ padding: '12px 16px' }}>
          <div style={{ color: 'var(--danger)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Bugs / Failures</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: 'var(--danger)' }}>{metrics.bug}</div>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card padded style={{ padding: '14px 18px', marginBottom: 20 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 12, color: 'var(--text-2)', fontSize: 13, fontWeight: 600 }}>
          <Filter size={15} />
          <span>Filters & Search</span>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Select value={role} onChange={(e) => setRole(e.target.value)} options={ROLES} />
          <Select value={channelType} onChange={(e) => setChannelType(e.target.value)} options={CHANNELS} />
          <Select value={modelProfile} onChange={(e) => setModelProfile(e.target.value)} options={PROFILES} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={STATUSES} />
          <Select value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} options={LABELS} />
          <Input
            placeholder="Filter by tool (e.g. list_services)..."
            value={toolSearch}
            onChange={(e) => setToolSearch(e.target.value)}
          />
        </div>
      </Card>

      {/* Turns Table */}
      {loading ? (
        <LoadingState label="Loading agent turn telemetry..." rows={6} />
      ) : error ? (
        <Card padded>
          <div style={{ color: 'var(--danger)', padding: 16 }}>{error}</div>
        </Card>
      ) : turns.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={36} />}
          title="No Agent Turns Found"
          body="No agent turns match your filter criteria. When customer or internal turns occur, their telemetry will stream here."
        />
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', color: 'var(--text-3)', fontSize: 11.5 }}>
                  <th style={{ padding: '10px 14px' }}>Time</th>
                  <th style={{ padding: '10px 14px' }}>Role</th>
                  <th style={{ padding: '10px 14px' }}>Channel</th>
                  <th style={{ padding: '10px 14px' }}>Profile / Latency</th>
                  <th style={{ padding: '10px 14px' }}>Tools Called</th>
                  <th style={{ padding: '10px 14px', maxWidth: 220 }}>Input Preview</th>
                  <th style={{ padding: '10px 14px', maxWidth: 220 }}>Reply Preview</th>
                  <th style={{ padding: '10px 14px' }}>QA Label</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {turns.map((turn) => {
                  const label = turn.label;
                  const tools = turn.details?.tools_invoked || [];
                  const duration = turn.details?.duration_ms;
                  const channel = turn.details?.channel_type || 'dashboard';

                  return (
                    <tr
                      key={turn.id}
                      style={{ borderBottom: '1px solid var(--border)', verticalAlign: 'middle' }}
                      className="hover:bg-slate-50/5"
                    >
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', color: 'var(--text-3)', fontSize: 12 }}>
                        {new Date(turn.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        <Pill tone={turn.agent_role === 'manager' ? 'accent' : 'neutral'}>
                          {turn.agent_role}
                        </Pill>
                      </td>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', color: 'var(--text-2)' }}>
                        {channel}
                      </td>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        <div className="flex items-center gap-1.5">
                          <span style={{ fontSize: 11.5, fontWeight: 600 }}>{turn.details?.model_profile || 'primary'}</span>
                          {duration ? (
                            <span style={{ color: 'var(--text-4)', fontSize: 11 }}>({duration}ms)</span>
                          ) : null}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px', maxWidth: 160 }}>
                        {tools.length === 0 ? (
                          <span style={{ color: 'var(--text-4)', fontSize: 11.5 }}>None (Conversational)</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {tools.map((t, idx) => (
                              <span
                                key={idx}
                                style={{
                                  padding: '2px 6px', borderRadius: 4, background: 'var(--surface-3)',
                                  fontSize: 10.5, fontFamily: 'monospace',
                                }}
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                        {turn.details?.input_preview || '—'}
                      </td>
                      <td style={{ padding: '12px 14px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-2)' }}>
                        {turn.details?.reply_preview || (turn.details?.status === 'error' ? '⚠️ Execution Error' : '—')}
                      </td>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        {label ? (
                          <Pill
                            tone={
                              label.label === 'ok' ? 'success' : label.label === 'needs_improvement' ? 'warning' : 'danger'
                            }
                          >
                            {label.label === 'ok' ? 'Pass' : label.label === 'needs_improvement' ? 'Needs Work' : 'Bug'}
                          </Pill>
                        ) : (
                          <span style={{ color: 'var(--text-4)', fontSize: 11.5 }}>Unlabeled</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Button
                          variant="subtle"
                          size="sm"
                          icon={<Eye size={13} />}
                          onClick={() => openReviewModal(turn)}
                        >
                          Review
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Turn Review & QA Labeling Modal */}
      {selectedTurn && (
        <Modal
          open={Boolean(selectedTurn)}
          onClose={() => setSelectedTurn(null)}
          title={`Agent Turn Evaluation (#${selectedTurn.id})`}
          width={680}
          footer={
            <>
              <Button variant="subtle" onClick={() => setSelectedTurn(null)}>
                Close
              </Button>
              <Button variant="accent" loading={savingLabel} onClick={handleSaveLabel}>
                Save QA Label
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {/* Meta Tags Row */}
            <div className="flex flex-wrap items-center gap-2 p-3" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)' }}>
              <div className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
                <Clock size={13} style={{ color: 'var(--text-3)' }} />
                <span>{new Date(selectedTurn.created_at).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
                <Cpu size={13} style={{ color: 'var(--text-3)' }} />
                <span>Model Profile: <strong>{selectedTurn.details?.model_profile || 'primary'}</strong></span>
              </div>
              {selectedTurn.details?.duration_ms && (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  Latency: <strong>{selectedTurn.details.duration_ms}ms</strong>
                </div>
              )}
              <Pill tone={selectedTurn.details?.status === 'success' ? 'success' : 'danger'}>
                {selectedTurn.details?.status || 'unknown'}
              </Pill>
            </div>

            {/* Conversation Flow */}
            <div className="space-y-3">
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase' }}>
                  User / Customer Input:
                </label>
                <div
                  style={{
                    background: 'var(--surface-3)', padding: '10px 14px', borderRadius: 'var(--radius)',
                    fontSize: 13.5, marginTop: 4, lineHeight: 1.5,
                  }}
                >
                  {selectedTurn.details?.input_preview || '(No text input recorded)'}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase' }}>
                  Agent Reply:
                </label>
                <div
                  style={{
                    background: 'var(--surface-2)', padding: '10px 14px', borderRadius: 'var(--radius)',
                    fontSize: 13.5, marginTop: 4, lineHeight: 1.5, borderLeft: '3px solid var(--accent)',
                  }}
                >
                  {selectedTurn.details?.reply_preview || '(No reply text)'}
                </div>
              </div>

              {/* Tools Invoked */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase' }}>
                  Tools Invoked:
                </label>
                <div className="flex flex-wrap gap-1.5" style={{ marginTop: 4 }}>
                  {(selectedTurn.details?.tools_invoked || []).length === 0 ? (
                    <span style={{ color: 'var(--text-4)', fontSize: 12.5 }}>None (Standard conversational reply)</span>
                  ) : (
                    selectedTurn.details.tools_invoked.map((tool, idx) => (
                      <span
                        key={idx}
                        className="pill pill-accent"
                        style={{ fontFamily: 'monospace', fontSize: 12 }}
                      >
                        <Terminal size={11} style={{ marginRight: 4 }} />
                        {tool}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>

            <hr style={{ borderColor: 'var(--border)', margin: '16px 0' }} />

            {/* Labeling Form */}
            <div className="space-y-3">
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                QA Quality Label:
              </label>

              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <label
                  style={{
                    padding: '10px 12px', borderRadius: 'var(--radius)', border: '1px solid',
                    borderColor: reviewLabel === 'ok' ? 'var(--success)' : 'var(--border)',
                    background: reviewLabel === 'ok' ? 'var(--success-bg)' : 'transparent',
                    cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="qa_label"
                      value="ok"
                      checked={reviewLabel === 'ok'}
                      onChange={() => setReviewLabel('ok')}
                    />
                    <CheckCircle2 size={16} style={{ color: 'var(--success)' }} />
                    <span style={{ fontWeight: 600, fontSize: 13 }}>Pass (OK)</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Accurate & helpful</span>
                </label>

                <label
                  style={{
                    padding: '10px 12px', borderRadius: 'var(--radius)', border: '1px solid',
                    borderColor: reviewLabel === 'needs_improvement' ? 'var(--warning)' : 'var(--border)',
                    background: reviewLabel === 'needs_improvement' ? 'var(--warning-bg)' : 'transparent',
                    cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="qa_label"
                      value="needs_improvement"
                      checked={reviewLabel === 'needs_improvement'}
                      onChange={() => setReviewLabel('needs_improvement')}
                    />
                    <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />
                    <span style={{ fontWeight: 600, fontSize: 13 }}>Needs Work</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Minor tone or fact gap</span>
                </label>

                <label
                  style={{
                    padding: '10px 12px', borderRadius: 'var(--radius)', border: '1px solid',
                    borderColor: reviewLabel === 'bug' ? 'var(--danger)' : 'var(--border)',
                    background: reviewLabel === 'bug' ? 'var(--danger-bg)' : 'transparent',
                    cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="qa_label"
                      value="bug"
                      checked={reviewLabel === 'bug'}
                      onChange={() => setReviewLabel('bug')}
                    />
                    <Bug size={16} style={{ color: 'var(--danger)' }} />
                    <span style={{ fontWeight: 600, fontSize: 13 }}>Bug</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Severe hallucination or error</span>
                </label>
              </div>

              {/* Tags */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>
                  Tags:
                </label>
                <div className="flex flex-wrap gap-1.5" style={{ margin: '6px 0' }}>
                  {SUGGESTED_TAGS.map((tag) => {
                    const active = reviewTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        style={{
                          padding: '3px 8px', borderRadius: 12, fontSize: 11.5,
                          background: active ? 'var(--accent)' : 'var(--surface-2)',
                          color: active ? '#fff' : 'var(--text-2)',
                          border: '1px solid',
                          borderColor: active ? 'var(--accent)' : 'var(--border)',
                          cursor: 'pointer',
                        }}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
                  <Input
                    placeholder="Add custom tag..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomTag();
                      }
                    }}
                    style={{ flex: 1 }}
                  />
                  <Button variant="outline" size="sm" onClick={addCustomTag}>
                    Add Tag
                  </Button>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>
                  Evaluation Notes / Bug Details:
                </label>
                <Textarea
                  placeholder="Explain why this turn succeeded or failed, or what prompt/tool adjustment is required..."
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={3}
                  style={{ marginTop: 4 }}
                />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
