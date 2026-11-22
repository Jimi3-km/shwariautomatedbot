import React, { useState } from 'react';
import { BellRing, Check, Plus, Send, Trash2, X } from 'lucide-react';
import {
  getAlerts, updateAlerts, addAlertRecipient, setAlertRecipientActive, removeAlertRecipient, sendTestAlert,
  setAlertTelegramBot, removeAlertTelegramBot, startAlertTelegramLink, confirmAlertTelegramLink,
  type AlertDelivery,
} from '../lib/api';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, Checkbox, ErrorState, Field, InlineError, Input, LoadingState, Pill, Select, Switch, useToast,
} from './ui';
import { relativeTime } from '../lib/format';
import { desktopAlertsState, enableDesktopAlerts } from '../lib/desktopAlerts';

const KIND_LABEL: Record<string, { label: string; hint: string }> = {
  payment_claim: { label: 'A payment to check', hint: 'A customer says they have paid.' },
  new_order: { label: 'A new order', hint: 'An order has been placed.' },
  needs_human: { label: 'A customer needs a person', hint: 'An agent handed a conversation over.' },
  payment_verified: { label: 'A payment verified', hint: 'Someone on your team confirmed a payment.' },
  posts_to_approve: { label: 'Posts to approve', hint: "The week's posts are ready for you." },
  post_failed: { label: 'A post failed', hint: 'A scheduled post did not go out.' },
  invoice_paid: { label: 'An invoice paid', hint: 'A customer settled an invoice.' },
  invoice_overdue: { label: 'An invoice overdue', hint: 'An invoice passed its due date unpaid.' },
  post_published: { label: 'A post published', hint: 'A scheduled post went out.' },
};

const TEMPLATE_NOTE: Record<string, { tone: 'success' | 'warning' | 'danger'; text: string }> = {
  approved: { tone: 'success', text: 'Alerts reach these numbers at any time.' },
  pending: {
    tone: 'warning',
    text: 'WhatsApp is reviewing the alert message, which usually takes a few minutes to a day. Until then, an alert only reaches a number that has messaged your business number in the last 24 hours.',
  },
  rejected: {
    tone: 'danger',
    text: 'WhatsApp did not approve the alert message. Alerts only reach a number that has messaged your business number in the last 24 hours.',
  },
  missing: {
    tone: 'warning',
    text: 'The alert message has not been requested from WhatsApp yet. Reload this page in a moment.',
  },
  unknown: { tone: 'warning', text: "We couldn't check the alert message with WhatsApp just now." },
};

/**
 * Where news about the business is sent besides the dashboard bell.
 *
 * The owner chooses the WhatsApp numbers; managers can see them. Sending is
 * done by the server, from the business's own WhatsApp number.
 */
export function AlertsPanel() {
  const { isOwner, supportMode } = useSession();
  const canEdit = isOwner && !supportMode;
  const toast = useToast();
  const state = useAsync(() => getAlerts(), []);

  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  const [results, setResults] = useState<AlertDelivery[] | null>(null);
  const [desktop, setDesktop] = useState(desktopAlertsState());

  const add = useMutation(async () => {
    await addAlertRecipient(phone.trim(), label.trim());
    setPhone(''); setLabel('');
    state.reload();
  });
  const remove = useMutation(async (id: string) => { await removeAlertRecipient(id); state.reload(); });
  const toggle = useMutation(async (id: string, active: boolean) => { await setAlertRecipientActive(id, active); state.reload(); });
  const save = useMutation(async (patch: { kinds?: string[]; telegram_enabled?: boolean }) => {
    await updateAlerts(patch);
    state.reload();
  });
  // Telegram: the notification bot and who has joined it.
  const [botToken, setBotToken] = useState('');
  const [joinLink, setJoinLink] = useState<string | null>(null);
  const [joinNote, setJoinNote] = useState<string | null>(null);
  const [testKind, setTestKind] = useState('payment_claim');

  const setBot = useMutation(async () => {
    await setAlertTelegramBot(botToken.trim());
    setBotToken(''); setJoinLink(null); setJoinNote(null);
    toast.push('success', 'Notification bot saved.');
    state.reload();
  });
  const removeBot = useMutation(async () => {
    await removeAlertTelegramBot();
    setJoinLink(null); setJoinNote(null);
    state.reload();
  });
  const makeLink = useMutation(async () => {
    const r = await startAlertTelegramLink();
    setJoinLink(r.url); setJoinNote(null);
  });
  const confirmJoin = useMutation(async () => {
    const r = await confirmAlertTelegramLink();
    setJoinNote(r.added.length
      ? `Added ${r.added.join(', ')}.`
      : "Nobody new yet. Open the link in Telegram, press Start, then check again.");
    if (r.added.length) state.reload();
  });

  const test = useMutation(async () => {
    const r = await sendTestAlert(testKind);
    setResults(r.results);
    if (r.results.length && r.results.every((x) => x.ok)) toast.push('success', 'Test alert sent.');
    state.reload();
  });

  if (state.loading && !state.data) return <LoadingState rows={3} />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  const data = state.data!;
  const note = data.whatsapp.template ? TEMPLATE_NOTE[data.whatsapp.template] : null;
  const numbers = data.recipients.filter((r) => r.channel === 'whatsapp');
  const chats = data.recipients.filter((r) => r.channel === 'telegram');
  const bot = data.telegram.bot;

  const toggleKind = (kind: string, on: boolean) =>
    save.run({ kinds: on ? [...data.kinds, kind] : data.kinds.filter((k) => k !== kind) });

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <InlineError message={
        add.error ?? remove.error ?? toggle.error ?? save.error ?? test.error ??
        setBot.error ?? removeBot.error ?? makeLink.error ?? confirmJoin.error
      } />

      <Card>
        <div className="section-label" style={{ marginBottom: 4 }}>In the dashboard</div>
        <p className="field-hint" style={{ marginBottom: 11 }}>
          Everything appears in the bell, and pops up on screen while the dashboard is open.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <BellRing size={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
          <span style={{ flex: '1 1 200px', fontSize: 13, minWidth: 0 }}>
            {desktop === 'on' ? 'Pop-ups also appear on your computer or phone when this tab is in the background.'
              : desktop === 'blocked' ? 'Pop-ups outside the tab are blocked in your browser settings for this site.'
              : desktop === 'unsupported' ? 'This browser cannot show pop-ups outside the tab.'
              : 'Show pop-ups on your computer or phone even when this tab is in the background.'}
          </span>
          {desktop === 'off' && (
            <Button size="sm" variant="outline" onClick={async () => setDesktop(await enableDesktopAlerts())}>
              Turn on
            </Button>
          )}
          {desktop === 'on' && <Pill tone="success" dot>On for this browser</Pill>}
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <div className="section-label" style={{ flex: 1 }}>WhatsApp numbers to alert</div>
          {data.whatsapp.connected
            ? <Pill tone="success" dot>Sent from {data.whatsapp.number ?? 'your WhatsApp number'}</Pill>
            : <Pill tone="warning" dot>WhatsApp not connected</Pill>}
        </div>
        <p className="field-hint" style={{ marginBottom: 11 }}>
          {data.whatsapp.connected
            ? 'These numbers get a WhatsApp message from your business number when something needs attention.'
            : 'Connect WhatsApp under Integrations first. Numbers you add now will start receiving alerts once it is connected.'}
        </p>

        <div style={{ display: 'grid', gap: 8 }}>
          {numbers.length === 0 && (
            <p className="field-hint">No numbers yet.</p>
          )}
          {numbers.map((r) => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', flexWrap: 'wrap',
              background: 'var(--surface-2)', borderRadius: 'var(--radius)',
            }}>
              <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                <div style={{ fontSize: 13 }}>
                  +{r.address}{r.label && <span style={{ color: 'var(--text-3)' }}> · {r.label}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: r.last_error ? 'var(--danger)' : 'var(--text-3)', lineHeight: 1.5 }}>
                  {r.last_error ?? (r.last_sent_at ? `Last alert sent ${relativeTime(r.last_sent_at)}` : 'No alert sent yet')}
                </div>
              </div>
              {canEdit ? (
                <>
                  <Switch
                    checked={r.active} disabled={toggle.busy}
                    onChange={(on: boolean) => toggle.run(r.id, on)}
                    label={r.active ? 'On' : 'Off'}
                  />
                  <Button size="sm" variant="subtle" icon={<Trash2 size={13} />} loading={remove.busy}
                    aria-label={`Remove +${r.address}`} onClick={() => remove.run(r.id)}>
                    Remove
                  </Button>
                </>
              ) : (
                <Pill tone={r.active ? 'success' : 'neutral'}>{r.active ? 'On' : 'Off'}</Pill>
              )}
            </div>
          ))}
        </div>

        {note && numbers.length > 0 && (
          <p style={{
            marginTop: 10, fontSize: 12.5, lineHeight: 1.55,
            color: note.tone === 'success' ? 'var(--success)' : note.tone === 'danger' ? 'var(--danger)' : 'var(--text-2)',
          }}>
            {note.text}
          </p>
        )}

        {canEdit && (
          <form
            onSubmit={(e) => { e.preventDefault(); if (phone.trim()) add.run(); }}
            style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 14 }}
          >
            <div style={{ flex: '2 1 190px', minWidth: 0 }}>
              <Field label="WhatsApp number" hint="With the country code." htmlFor="alert-phone">
                <Input id="alert-phone" type="tel" inputMode="tel" placeholder="+254712345678"
                  value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </div>
            <div style={{ flex: '1 1 140px', minWidth: 0 }}>
              <Field label="Whose is it" hint="Optional." htmlFor="alert-label">
                <Input id="alert-label" placeholder="Owner, shop phone…" maxLength={60}
                  value={label} onChange={(e) => setLabel(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" variant="solid" icon={<Plus size={14} />} loading={add.busy} disabled={!phone.trim()}>
              Add number
            </Button>
          </form>
        )}
        {!isOwner && <p className="field-hint" style={{ marginTop: 10 }}>Only the owner can change who is alerted.</p>}
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <div className="section-label" style={{ flex: 1 }}>Telegram notification bot</div>
          {bot
            ? <Pill tone="success" dot>@{bot.username ?? 'your bot'}</Pill>
            : <Pill tone="neutral" dot>Not set up</Pill>}
        </div>
        <p className="field-hint" style={{ marginBottom: 11 }}>
          A Telegram bot of your own that sends alerts to you and your team. It is separate from the bot your customers talk to.
        </p>

        {!bot && canEdit && (
          <>
            <ol style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: 'var(--text-2)' }}>
              <li>In Telegram, open <strong>@BotFather</strong> and send <code>/newbot</code>.</li>
              <li>Give it a name, for example "My shop alerts".</li>
              <li>Copy the token BotFather gives you and paste it here.</li>
            </ol>
            <form
              onSubmit={(e) => { e.preventDefault(); if (botToken.trim()) setBot.run(); }}
              style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
            >
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <Field label="Bot token" hint="Stored encrypted. It is never shown again." htmlFor="alert-bot-token">
                  <Input id="alert-bot-token" type="password" autoComplete="off" spellCheck={false}
                    placeholder="123456789:AA…" value={botToken} onChange={(e) => setBotToken(e.target.value)} />
                </Field>
              </div>
              <Button type="submit" variant="solid" loading={setBot.busy} disabled={!botToken.trim()}>Save bot</Button>
            </form>
          </>
        )}
        {!bot && !canEdit && <p className="field-hint">Only the owner can set this up.</p>}

        {bot && (
          <>
            <div style={{ display: 'grid', gap: 8 }}>
              {chats.length === 0 && <p className="field-hint">Nobody has joined yet.</p>}
              {chats.map((r) => (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', flexWrap: 'wrap',
                  background: 'var(--surface-2)', borderRadius: 'var(--radius)',
                }}>
                  <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                    <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{r.label ?? 'Telegram chat'}</div>
                    <div style={{ fontSize: 11.5, color: r.last_error ? 'var(--danger)' : 'var(--text-3)', lineHeight: 1.5 }}>
                      {r.last_error ?? (r.last_sent_at ? `Last alert sent ${relativeTime(r.last_sent_at)}` : 'No alert sent yet')}
                    </div>
                  </div>
                  {canEdit ? (
                    <>
                      <Switch checked={r.active} disabled={toggle.busy}
                        onChange={(on: boolean) => toggle.run(r.id, on)} label={r.active ? 'On' : 'Off'} />
                      <Button size="sm" variant="subtle" icon={<Trash2 size={13} />} loading={remove.busy}
                        aria-label={`Remove ${r.label ?? 'chat'}`} onClick={() => remove.run(r.id)}>
                        Remove
                      </Button>
                    </>
                  ) : (
                    <Pill tone={r.active ? 'success' : 'neutral'}>{r.active ? 'On' : 'Off'}</Pill>
                  )}
                </div>
              ))}
            </div>

            {canEdit && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button variant="outline" icon={<Plus size={14} />} loading={makeLink.busy} onClick={() => makeLink.run()}>
                    Add a person
                  </Button>
                  <Button variant="subtle" loading={removeBot.busy} onClick={() => removeBot.run()}>
                    Remove this bot
                  </Button>
                </div>
                {joinLink && (
                  <div style={{
                    marginTop: 12, padding: '10px 12px', borderRadius: 'var(--radius)',
                    background: 'var(--info-bg)', fontSize: 12.5, lineHeight: 1.6,
                  }}>
                    <div>
                      1. Open this link on the phone that should get alerts and press <strong>Start</strong>. Send the same link to anyone else on your team. It works for 30 minutes.
                    </div>
                    <a href={joinLink} target="_blank" rel="noreferrer"
                      style={{ display: 'inline-block', margin: '6px 0', overflowWrap: 'anywhere', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                      {joinLink}
                    </a>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span>2. Then:</span>
                      <Button size="sm" variant="solid" loading={confirmJoin.busy} onClick={() => confirmJoin.run()}>
                        I've pressed Start
                      </Button>
                    </div>
                    {joinNote && <div style={{ marginTop: 6, color: 'var(--text-2)' }}>{joinNote}</div>}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <div className="section-label">Chats linked to Shwari</div>
            <p className="field-hint" style={{ marginTop: 3 }}>
              {!data.telegram.connected
                ? 'Once your customer Telegram bot is connected, anyone who has linked their chat to Shwari can get alerts there too.'
                : data.telegram.linked_chats === 0
                  ? 'Nobody has linked a Telegram chat to Shwari yet (see the Shwari page).'
                  : `Alerts also go to the ${data.telegram.linked_chats} Telegram chat${data.telegram.linked_chats === 1 ? '' : 's'} linked to Shwari, through your customer bot.`}
            </p>
          </div>
          <Switch
            checked={data.telegram_enabled} disabled={!canEdit || save.busy}
            onChange={(on: boolean) => save.run({ telegram_enabled: on })}
            label={data.telegram_enabled ? 'On' : 'Off'}
          />
        </div>
      </Card>

      <Card>
        <div className="section-label" style={{ marginBottom: 4 }}>What to alert about</div>
        <p className="field-hint" style={{ marginBottom: 10 }}>
          Everything is on. Untick anything you do not want on WhatsApp and Telegram; the dashboard bell always shows everything.
        </p>
        <div style={{ display: 'grid', gap: 9 }}>
          {data.all_kinds.map((kind) => (
            <div key={kind}>
              <Checkbox
                checked={data.kinds.includes(kind)}
                disabled={!canEdit || save.busy}
                onChange={(e) => toggleKind(kind, e.target.checked)}
                label={KIND_LABEL[kind]?.label ?? kind}
              />
              {KIND_LABEL[kind]?.hint && (
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginLeft: 23, marginTop: 1 }}>
                  {KIND_LABEL[kind].hint}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {canEdit && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div className="section-label">Try it</div>
              <p className="field-hint" style={{ marginTop: 3 }}>
                Sends a sample of the alert you choose to every number and chat above, worded as the real one will be.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Select
                aria-label="Which alert to test" value={testKind} onChange={(e) => setTestKind(e.target.value)}
                options={data.all_kinds.map((k) => ({ value: k, label: KIND_LABEL[k]?.label ?? k }))}
                style={{ height: 34, minWidth: 190, fontSize: 12.5 }}
              />
              <Button variant="outline" icon={<Send size={13} />} loading={test.busy} onClick={() => test.run()}>
                Send a test alert
              </Button>
            </div>
          </div>
          {results && (
            <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
              {results.length === 0 && (
                <p className="field-hint">There is nobody to alert yet. Add a WhatsApp number or set up the Telegram bot.</p>
              )}
              {results.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.5 }}>
                  {r.ok
                    ? <Check size={14} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} />
                    : <X size={14} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />}
                  <span>
                    {r.channel === 'whatsapp' ? `WhatsApp ${r.to}` : `Telegram, ${r.to}`}: {r.ok ? 'sent' : r.reason ?? 'not sent'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
