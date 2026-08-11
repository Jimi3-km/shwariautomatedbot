import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, MessageSquare, Sparkles, Rocket, Check, ArrowRight, ArrowLeft,
  RefreshCw, AlertCircle, Send,
} from 'lucide-react';
import {
  createOnboardingBusiness, getOnboardingChannels, getOnboardingState,
  saveOnboardingAgent, completeOnboarding, sendOnboardingTestMessage,
  startChannelConnect, submitChannelCredentials, disconnectChannel,
} from '../lib/api';
import { useMutation } from '../hooks';
import {
  Button, Card, Field, Input, Textarea, Select, Pill, InlineError, LoadingState,
} from '../components/ui';
import type {
  AgentTone, ChannelProviderInfo, ConnectedChannel, CredentialField,
  LaunchResult, OnboardingStepId, ProviderId,
} from '../types';

/**
 * The setup wizard.
 *
 * Four steps, one question at a time, no technical vocabulary anywhere on
 * screen. It resumes from the server's view of what is done rather than from
 * local state, so a refresh, a sign-out or an OAuth round trip all land the
 * user back in the right place.
 *
 * Built entirely from the existing design system — same Card, Button, Field
 * and colour tokens as the dashboard — so it reads as part of the product.
 */

type Step = Exclude<OnboardingStepId, 'done'>;

const STEPS: Array<{ id: Step; label: string; icon: React.ReactNode }> = [
  { id: 'business', label: 'Business', icon: <Building2 size={14} /> },
  { id: 'channels', label: 'Channels', icon: <MessageSquare size={14} /> },
  { id: 'agent', label: 'Assistant', icon: <Sparkles size={14} /> },
  { id: 'launch', label: 'Launch', icon: <Rocket size={14} /> },
];

const CATEGORIES = [
  'Retail & shopping', 'Electronics & phones', 'Fashion & beauty', 'Food & drink',
  'Health & wellness', 'Home & furniture', 'Professional services', 'Education',
  'Travel & events', 'Other',
].map((c) => ({ value: c, label: c }));

const TONES: Array<{ value: AgentTone; label: string; blurb: string }> = [
  { value: 'friendly', label: 'Friendly', blurb: 'Warm and conversational.' },
  { value: 'professional', label: 'Professional', blurb: 'Polite and business-like.' },
  { value: 'concise', label: 'Concise', blurb: 'Short, direct answers.' },
  { value: 'enthusiastic', label: 'Enthusiastic', blurb: 'Upbeat and energetic.' },
];

const PROVIDER_BLURB: Record<ProviderId, string> = {
  whatsapp: "You'll approve access with Meta, and we'll set up your WhatsApp number for you.",
  instagram: "You'll approve access with Instagram, and we'll start handling your DMs.",
  telegram: 'Create a bot in Telegram and paste the code it gives you.',
};

export function Onboarding({ onFinished, onSignOut }: {
  onFinished: () => void;
  onSignOut: () => void;
}) {
  const [step, setStep] = useState<Step>('business');
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  // Step 1
  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState('');
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

  // Step 3
  const [sells, setSells] = useState('');
  const [description, setDescription] = useState('');
  const [tone, setTone] = useState<AgentTone>('friendly');

  /**
   * Resume from the server. Also runs after the OAuth callback bounces back,
   * which is why the connected-channel list is never held only in memory.
   */
  const refreshState = useCallback(async () => {
    try {
      const state = await getOnboardingState();
      if (state.complete) { onFinished(); return; }
      if (state.business) {
        setBusinessName((v) => v || state.business!.business_name);
        setCategory((v) => v || state.business!.business_category || '');
        setDescription((v) => v || state.business!.business_description || '');
      }
      setStep(state.step === 'done' ? 'launch' : state.step);
      setBootError(null);
    } catch {
      setBootError("We couldn't load your setup. Please try again.");
    } finally {
      setBooting(false);
    }
  }, [onFinished]);

  useEffect(() => { void refreshState(); }, [refreshState]);

  const index = STEPS.findIndex((s) => s.id === step);

  if (booting) {
    return <Shell><LoadingState label="Getting things ready…" /></Shell>;
  }

  return (
    <Shell wide>
      <ProgressBar current={index} />

      {bootError && (
        <div style={{ marginBottom: 14 }}>
          <InlineError message={bootError} onDismiss={() => setBootError(null)} />
        </div>
      )}

      {step === 'business' && (
        <BusinessStep
          businessName={businessName} setBusinessName={setBusinessName}
          category={category} setCategory={setCategory}
          timezone={timezone}
          onDone={() => setStep('channels')}
        />
      )}

      {step === 'channels' && (
        <ChannelsStep onBack={() => setStep('business')} onNext={() => setStep('agent')} />
      )}

      {step === 'agent' && (
        <AgentStep
          sells={sells} setSells={setSells}
          description={description} setDescription={setDescription}
          tone={tone} setTone={setTone}
          onBack={() => setStep('channels')}
          onDone={() => setStep('launch')}
        />
      )}

      {step === 'launch' && (
        <LaunchStep businessName={businessName} onBack={() => setStep('agent')} onFinished={onFinished} />
      )}

      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <button onClick={onSignOut} style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Sign out</button>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className="scroll-y"
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        background: 'var(--bg)', padding: '32px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: wide ? 560 : 420, margin: 'auto' }}>{children}</div>
    </div>
  );
}

function ProgressBar({ current }: { current: number }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        {STEPS.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <React.Fragment key={s.id}>
              <div
                title={s.label}
                style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: done || active ? 'var(--accent)' : 'var(--surface-2)',
                  color: done || active ? '#fff' : 'var(--text-3)',
                  transition: 'background 150ms ease',
                }}
              >
                {done ? <Check size={13} /> : s.icon}
              </div>
              {i < STEPS.length - 1 && (
                <span style={{
                  flex: 1, height: 2, borderRadius: 2,
                  background: i < current ? 'var(--accent)' : 'var(--border)',
                }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
        Step {current + 1} of {STEPS.length} · {STEPS[current]?.label}
      </p>
    </div>
  );
}

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</h1>
      <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 4 }}>{subtitle}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — business
// ---------------------------------------------------------------------------

function BusinessStep({
  businessName, setBusinessName, category, setCategory, timezone, onDone,
}: {
  businessName: string; setBusinessName: (v: string) => void;
  category: string; setCategory: (v: string) => void;
  timezone: string; onDone: () => void;
}) {
  const save = useMutation(async () => {
    await createOnboardingBusiness({
      business_name: businessName.trim(),
      business_category: category || undefined,
      timezone,
    });
    onDone();
  });

  return (
    <Card>
      <StepHeader
        title="Tell us about your business"
        subtitle="Just the basics — everything here can be changed later."
      />
      <form onSubmit={(e) => { e.preventDefault(); void save.run(); }} style={{ display: 'grid', gap: 13 }}>
        <InlineError message={save.error} onDismiss={save.clearError} />

        <Field label="Business name" required>
          <Input
            required autoFocus value={businessName} placeholder="e.g. Glow Beauty Spa"
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </Field>

        <Field label="What kind of business is it?">
          <Select
            options={CATEGORIES} placeholder="Choose one"
            value={category} onChange={(e) => setCategory(e.target.value)}
          />
        </Field>

        <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
          We've set your time zone to {timezone.replace(/_/g, ' ')}.
        </p>

        <Button
          type="submit" variant="solid" size="lg" style={{ width: '100%' }}
          loading={save.busy} disabled={!businessName.trim()}
        >
          Continue
        </Button>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — channels
// ---------------------------------------------------------------------------

function ChannelsStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [providers, setProviders] = useState<ChannelProviderInfo[]>([]);
  const [connected, setConnected] = useState<ConnectedChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credentialFor, setCredentialFor] = useState<
    { provider: ProviderId; label: string; fields: CredentialField[] } | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getOnboardingChannels();
      setProviders(r.providers);
      setConnected(r.connected.filter((c) => c.status === 'active'));
      setError(null);
    } catch {
      setError("We couldn't load your channels. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The OAuth callback returns to /integrations?connect=…&status=…; when the
  // wizard is still open we land back here instead, so read the same params.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');
    if (!status) return;
    window.history.replaceState({}, '', window.location.pathname);

    if (status === 'connected') setNotice('Connected.');
    else if (status === 'cancelled') setError('That connection was cancelled. You can try again.');
    else if (status === 'expired') setError('That took too long, so we stopped for safety. Please try again.');
    else setError("We couldn't finish connecting. Please try again.");
  }, []);

  const start = useMutation(async (provider: ProviderId, label: string) => {
    const result = await startChannelConnect(provider);
    if (result.mode === 'oauth') {
      window.location.href = result.authorize_url;
      return;
    }
    setCredentialFor({ provider, label, fields: result.fields });
  });

  const remove = useMutation(async (channelId: string) => {
    await disconnectChannel(channelId);
    await load();
  });

  if (loading) return <Card><LoadingState label="Loading channels…" /></Card>;

  return (
    <Card>
      <StepHeader
        title="Connect where your customers message you"
        subtitle="Connect at least one. You can add the others any time."
      />

      <div style={{ display: 'grid', gap: 10 }}>
        <InlineError message={error ?? start.error ?? remove.error} onDismiss={() => {
          setError(null); start.clearError(); remove.clearError();
        }} />

        {notice && (
          <div style={{
            fontSize: 12.5, color: 'var(--success)', background: 'var(--success-bg)',
            padding: '8px 11px', borderRadius: 'var(--radius)',
          }}>
            {notice}
          </div>
        )}

        {providers.map((p) => {
          const live = connected.find((c) => c.provider === p.id);
          return (
            <div
              key={p.id}
              style={{
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                padding: 13, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 190 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 550 }}>{p.label}</span>
                  {live && <Pill tone="success" dot>Connected</Pill>}
                  {!p.available && <Pill tone="neutral">Coming soon</Pill>}
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3 }}>
                  {live ? (live.display_name ?? 'Ready to receive messages.') : PROVIDER_BLURB[p.id]}
                </p>
              </div>

              {live ? (
                <Button
                  size="sm" variant="subtle" loading={remove.busy}
                  onClick={() => void remove.run(live.channel_id)}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  size="sm" variant={p.available ? 'solid' : 'subtle'}
                  disabled={!p.available} loading={start.busy}
                  onClick={() => void start.run(p.id, p.label)}
                >
                  Connect {p.label}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {credentialFor && (
        <CredentialForm
          provider={credentialFor.provider}
          label={credentialFor.label}
          fields={credentialFor.fields}
          onCancel={() => setCredentialFor(null)}
          onConnected={async () => { setCredentialFor(null); setNotice('Connected.'); await load(); }}
        />
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <Button variant="subtle" size="lg" icon={<ArrowLeft size={14} />} onClick={onBack}>Back</Button>
        <Button
          variant="solid" size="lg" style={{ flex: 1 }}
          icon={<ArrowRight size={14} />} disabled={connected.length === 0} onClick={onNext}
        >
          {connected.length === 0 ? 'Connect one to continue' : 'Continue'}
        </Button>
      </div>
    </Card>
  );
}

/** Inline form for providers that need a value from the user (Telegram). */
function CredentialForm({ provider, label, fields, onCancel, onConnected }: {
  provider: ProviderId;
  label: string;
  fields: CredentialField[];
  onCancel: () => void;
  onConnected: () => Promise<void> | void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  const submit = useMutation(async () => {
    await submitChannelCredentials(provider, values);
    await onConnected();
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void submit.run(); }}
      style={{
        marginTop: 14, padding: 13, borderRadius: 'var(--radius)',
        background: 'var(--surface-2)', display: 'grid', gap: 11,
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 550 }}>Connect {label}</p>
      <InlineError message={submit.error} onDismiss={submit.clearError} />

      {fields.map((f) => (
        <Field key={f.name} label={f.label} hint={f.hint} required>
          <Input
            required autoFocus type={f.secret ? 'password' : 'text'}
            placeholder={f.placeholder} value={values[f.name] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          />
        </Field>
      ))}

      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="button" variant="subtle" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="solid" style={{ flex: 1 }} loading={submit.busy}>Connect</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — the assistant
// ---------------------------------------------------------------------------

function AgentStep({
  sells, setSells, description, setDescription, tone, setTone, onBack, onDone,
}: {
  sells: string; setSells: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  tone: AgentTone; setTone: (v: AgentTone) => void;
  onBack: () => void; onDone: () => void;
}) {
  const save = useMutation(async () => {
    await saveOnboardingAgent({
      sells: sells.trim(),
      description: description.trim() || undefined,
      tone,
    });
    onDone();
  });

  return (
    <Card>
      <StepHeader
        title="Teach your assistant the basics"
        subtitle="Two lines is enough to get started. You can refine it later."
      />

      <form onSubmit={(e) => { e.preventDefault(); void save.run(); }} style={{ display: 'grid', gap: 13 }}>
        <InlineError message={save.error} onDismiss={save.clearError} />

        <Field label="What do you sell?" required hint="A short list is fine.">
          <Input
            required autoFocus value={sells}
            placeholder="e.g. Phones, laptops and accessories"
            onChange={(e) => setSells(e.target.value)}
          />
        </Field>

        <Field label="Anything else customers should know?" hint="Optional — opening hours, delivery areas, what makes you different.">
          <Textarea
            rows={3} value={description}
            placeholder="e.g. We deliver across Nairobi within 24 hours."
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <Field label="How should it sound?">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {TONES.map((t) => {
              const active = tone === t.value;
              return (
                <button
                  key={t.value} type="button" onClick={() => setTone(t.value)}
                  style={{
                    textAlign: 'left', padding: '9px 11px', borderRadius: 'var(--radius)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    background: active ? 'var(--accent-bg, var(--surface-2))' : 'transparent',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 550, display: 'block' }}>{t.label}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{t.blurb}</span>
                </button>
              );
            })}
          </div>
        </Field>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <Button type="button" variant="subtle" size="lg" icon={<ArrowLeft size={14} />} onClick={onBack}>
            Back
          </Button>
          <Button
            type="submit" variant="solid" size="lg" style={{ flex: 1 }}
            loading={save.busy} disabled={!sells.trim()}
          >
            Continue
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — launch
// ---------------------------------------------------------------------------

function LaunchStep({ businessName, onBack, onFinished }: {
  businessName: string; onBack: () => void; onFinished: () => void;
}) {
  const [connected, setConnected] = useState<ConnectedChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [testTarget, setTestTarget] = useState('');
  const [testSent, setTestSent] = useState(false);

  const check = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getOnboardingChannels(true);
      setConnected(r.connected.filter((c) => c.status === 'active'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  const launch = useMutation(async () => {
    const r = await completeOnboarding();
    setResult(r);
    // Let the confirmation land before moving on.
    setTimeout(onFinished, 1400);
  });

  const test = useMutation(async () => {
    const channel = connected[0];
    if (!channel) return;
    await sendOnboardingTestMessage(channel.channel_id, testTarget.trim());
    setTestSent(true);
  });

  const allHealthy = useMemo(
    () => connected.length > 0 && connected.every((c) => c.health?.healthy !== false),
    [connected]
  );

  if (result?.launched) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '18px 0' }}>
          <div style={{
            width: 46, height: 46, borderRadius: '50%', background: 'var(--success-bg)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14,
          }}>
            <Check size={22} color="var(--success)" />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>You're ready — your AI agent is live.</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 6 }}>
            Taking you to your dashboard…
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <StepHeader
        title="You're almost there"
        subtitle="Here's what we've set up. Check it over and go live."
      />

      <div style={{ display: 'grid', gap: 10 }}>
        <InlineError message={launch.error ?? test.error} onDismiss={() => {
          launch.clearError(); test.clearError();
        }} />

        <SummaryRow label="Business" value={businessName || '—'} />
        <SummaryRow label="AI assistant" value="Ready to reply" tone="success" />

        <div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6,
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Channels</span>
            <Button size="sm" variant="subtle" icon={<RefreshCw size={12} />} loading={loading} onClick={() => void check()}>
              Check again
            </Button>
          </div>

          {loading && <LoadingState label="Checking your connections…" rows={2} />}

          {!loading && connected.map((c) => (
            <div
              key={c.channel_id}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 7,
              }}
            >
              {c.health?.healthy === false
                ? <AlertCircle size={14} color="var(--warning)" />
                : <Check size={14} color="var(--success)" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 550, textTransform: 'capitalize' }}>{c.provider}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  {c.health?.summary ?? c.display_name ?? 'Connected.'}
                </div>
              </div>
            </div>
          ))}

          {!loading && connected.length === 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              No channels are connected yet. Go back a step to add one.
            </p>
          )}
        </div>

        {connected.length > 0 && (
          <Field
            label="Send yourself a test message"
            hint={`Optional — we'll message this ${connected[0].provider} contact so you can see it working.`}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={testTarget} placeholder="Your chat ID or number"
                onChange={(e) => { setTestTarget(e.target.value); setTestSent(false); }}
              />
              <Button
                type="button" variant="outline" icon={<Send size={13} />}
                loading={test.busy} disabled={!testTarget.trim()}
                onClick={() => void test.run()}
              >
                Send
              </Button>
            </div>
            {testSent && (
              <p style={{ fontSize: 12, color: 'var(--success)', marginTop: 6 }}>Test message sent.</p>
            )}
          </Field>
        )}

        {!allHealthy && !loading && connected.length > 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
            You can still go live — we'll keep trying, and you can fix connections later in Settings.
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <Button variant="subtle" size="lg" icon={<ArrowLeft size={14} />} onClick={onBack}>Back</Button>
          <Button
            variant="solid" size="lg" style={{ flex: 1 }} icon={<Rocket size={14} />}
            loading={launch.busy} disabled={connected.length === 0}
            onClick={() => void launch.run()}
          >
            Launch agent
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{label}</span>
      {tone === 'success'
        ? <Pill tone="success" dot>{value}</Pill>
        : <span style={{ fontSize: 13, fontWeight: 550 }}>{value}</span>}
    </div>
  );
}
