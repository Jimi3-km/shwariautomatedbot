import React, { useEffect, useState } from 'react';

/**
 * The public pages every platform that connects to Instagram, Facebook and
 * WhatsApp must have: a privacy policy, terms of service, and a way to ask
 * for data to be deleted. They are reachable without signing in, and they
 * describe what this product actually does with data, section by section.
 *
 * The operator's legal name and contact address come from the server
 * (LEGAL_OPERATOR_NAME, LEGAL_CONTACT_EMAIL), so they are set once and are
 * the same on every page.
 */

export { legalRoute } from './legalRoute';
export type { LegalKind } from './legalRoute';
import type { LegalKind } from './legalRoute';

interface LegalInfo { operator: string; contact_email: string | null; contact_phone: string | null }

const UPDATED = '22 November 2026';
const PRODUCT = 'Shwari';

function useLegalInfo(): LegalInfo {
  const [info, setInfo] = useState<LegalInfo>({ operator: PRODUCT, contact_email: null, contact_phone: null });
  useEffect(() => {
    let cancelled = false;
    fetch('/api/public-config')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.legal) return;
        setInfo({
          operator: String(j.legal.operator || PRODUCT),
          contact_email: j.legal.contact_email ? String(j.legal.contact_email) : null,
          contact_phone: j.legal.contact_phone ? String(j.legal.contact_phone) : null,
        });
      })
      .catch(() => { /* the page still reads without it */ });
    return () => { cancelled = true; };
  }, []);
  return info;
}

export function LegalPage({ kind }: { kind: LegalKind }) {
  const info = useLegalInfo();
  const title = kind === 'privacy' ? 'Privacy Policy' : kind === 'terms' ? 'Terms of Service' : 'Delete your data';

  useEffect(() => { document.title = `${title} · ${PRODUCT}`; }, [title]);

  return (
    <div className="legal">
      <header className="legal-top">
        <a href="/" className="legal-brand">{PRODUCT}</a>
        <nav aria-label="Legal">
          <a href="/privacy" aria-current={kind === 'privacy' ? 'page' : undefined}>Privacy</a>
          <a href="/terms" aria-current={kind === 'terms' ? 'page' : undefined}>Terms</a>
          <a href="/data-deletion" aria-current={kind === 'data-deletion' ? 'page' : undefined}>Delete your data</a>
        </nav>
      </header>
      <main className="legal-body">
        <h1>{title}</h1>
        {kind !== 'data-deletion' && <p className="legal-meta">Last updated {UPDATED}</p>}
        {kind === 'privacy' && <Privacy info={info} />}
        {kind === 'terms' && <Terms info={info} />}
        {kind === 'data-deletion' && <DataDeletion info={info} />}
      </main>
      <footer className="legal-foot">
        &copy; {new Date().getFullYear()} {info.operator}. <a href="/">Back to {PRODUCT}</a>
      </footer>
    </div>
  );
}

function Contact({ info }: { info: LegalInfo }) {
  if (!info.contact_email && !info.contact_phone) {
    return <>the <a href="/data-deletion">request form</a> on this site</>;
  }
  return (
    <>
      {info.contact_email && <a href={`mailto:${info.contact_email}`}>{info.contact_email}</a>}
      {info.contact_email && info.contact_phone && ' or '}
      {info.contact_phone && <a href={`tel:${info.contact_phone.replace(/[^+\d]/g, '')}`}>{info.contact_phone}</a>}
    </>
  );
}

function Privacy({ info }: { info: LegalInfo }) {
  return (
    <>
      <p>
        {PRODUCT} is a service, operated by {info.operator}, that lets a business answer its customers on
        WhatsApp, Instagram, Facebook Messenger, Telegram and a chat box on its own website, with a team
        of AI agents working alongside the business's staff. This policy explains what information the
        service handles, why, who it is shared with, and what you can do about it.
      </p>

      <h2>Who this policy covers</h2>
      <ul>
        <li><strong>Businesses and their staff</strong> who sign up for and use {PRODUCT}.</li>
        <li>
          <strong>Customers of those businesses</strong> who message a business through a channel the
          business has connected. For that information the business decides what is collected and why;
          {' '}{PRODUCT} handles it on the business's behalf and on its instructions.
        </li>
      </ul>

      <h2>Information we handle</h2>
      <h3>From businesses and their staff</h3>
      <ul>
        <li>Account details: email address and a password, which is stored only in hashed form by our sign-in provider.</li>
        <li>Business details you enter: name, description, address, contact details, opening hours, products, services, prices, payment instructions, and a logo or letterhead.</li>
        <li>Team details: the email addresses and roles of people you invite, and, if you provide one, a WhatsApp number to send an invitation or alerts to.</li>
        <li>A record of changes made in your business's account and who made them.</li>
      </ul>
      <h3>From connected channels</h3>
      <p>When a business connects an account, the platform that owns it gives {PRODUCT} access the business has approved:</p>
      <ul>
        <li><strong>Instagram:</strong> the professional account's ID and username, messages sent to and from that account, and, if the business allows it, the ability to publish the business's own posts.</li>
        <li><strong>Facebook Pages:</strong> the Page's ID and name, Messenger conversations with that Page, and the ability to publish posts the business approves.</li>
        <li><strong>WhatsApp Business:</strong> the business phone number and its account ID, and messages sent to and from that number.</li>
        <li><strong>Telegram:</strong> the bot's identity and messages sent to and from the bot.</li>
        <li><strong>Website chat:</strong> messages typed into the chat box and a random visitor code.</li>
      </ul>
      <p>
        Access tokens for these accounts are stored encrypted and are used only to receive and send
        messages and to publish approved posts for the business that connected them.
      </p>
      <h3>About a business's customers</h3>
      <ul>
        <li>The content of messages they exchange with the business, including any photos or files they send.</li>
        <li>What the channel shares about them: a name or username, and a phone number on WhatsApp.</li>
        <li>What they tell the business in conversation: for example a name, phone number, email address or delivery address.</li>
        <li>Records the business keeps as a result: enquiries, orders, bookings, invoices, payment references and receipts.</li>
      </ul>
      <p>We do not ask for or need card numbers, bank passwords or mobile-money PINs, and customers should not send them.</p>
      <h3>Automatically</h3>
      <ul>
        <li>Basic technical logs kept by our hosting provider: time, address requested, and status, used to keep the service working and secure.</li>
        <li>When a business connects a channel, the type of device and browser used, to diagnose failed connections.</li>
      </ul>
      <p>We do not use advertising cookies or sell information to anyone.</p>

      <h2>How the information is used</h2>
      <ul>
        <li>To receive customers' messages and reply to them, by an AI agent or by the business's staff.</li>
        <li>To record orders, bookings, invoices and payments, and to send confirmations, invoices and receipts.</li>
        <li>To notify the business's staff of things that need attention.</li>
        <li>To publish posts the business has approved to its own Instagram account or Facebook Page.</li>
        <li>To show the business figures about its own activity.</li>
        <li>To keep the service secure, find faults and prevent abuse.</li>
      </ul>
      <p>
        <strong>Automated replies.</strong> Customer messages are passed to an AI language model to
        draft a reply. The agents answer from the business's own catalogue and records, and a person
        at the business can take over any conversation. An agent never confirms that a payment has
        been received: a person at the business checks and confirms each one.
      </p>
      <p>
        Messages are not used to train AI models for anyone else. Within a business's own account,
        corrections its staff make are used to improve that business's own agents.
      </p>

      <h2>Who it is shared with</h2>
      <p>Only the companies needed to run the service, each acting on our instructions:</p>
      <ul>
        <li><strong>Supabase</strong> stores the database and uploaded files, in the European Union.</li>
        <li><strong>Vercel</strong> runs the application.</li>
        <li><strong>NVIDIA</strong> runs the AI language model that drafts replies; it receives the conversation text needed for each reply.</li>
        <li><strong>Brevo</strong> delivers emails such as receipts, invoices and booking confirmations.</li>
        <li><strong>Meta</strong> (Instagram, Facebook, WhatsApp) and <strong>Telegram</strong>, to deliver the messages a business sends on those platforms.</li>
      </ul>
      <p>
        Information may also be disclosed where the law requires it. Staff of {info.operator} may
        access a business's account to provide support or fix a fault; each such access that changes
        anything is recorded in that business's activity log.
      </p>

      <h2>How long it is kept</h2>
      <ul>
        <li>A business's information is kept while its account is open.</li>
        <li>When a business disconnects a channel, the access token for it is deleted immediately.</li>
        <li>When a business closes its account, or asks us to, its information is deleted, except records the law requires to be kept.</li>
        <li>Technical logs are kept for a short period by our hosting provider and then discarded.</li>
      </ul>

      <h2>Your choices and rights</h2>
      <ul>
        <li><strong>Businesses</strong> can see and correct their information in the dashboard, disconnect any channel at any time, and ask for their account and data to be deleted.</li>
        <li>
          <strong>Customers of a business</strong> can ask that business for a copy of their
          information, to correct it or to delete it. The business can do this in its dashboard or
          ask us to. You can also ask us directly, and we will pass the request to the business concerned.
        </li>
        <li>
          <strong>Removing {PRODUCT}'s access.</strong> You can remove the app from your Instagram
          account (Settings → Apps and websites) or your Facebook account (Settings → Business
          integrations) at any time. When you do, the connection is switched off and its stored
          access is deleted.
        </li>
      </ul>
      <p>How to ask for deletion is set out on the <a href="/data-deletion">Delete your data</a> page.</p>

      <h2>Security</h2>
      <p>
        Access tokens are encrypted before they are stored. Each business's information is separated
        from every other's by rules enforced in the database. Access by staff is limited by role.
        No system is perfectly secure; if a breach affects your information we will tell you as the
        law requires.
      </p>

      <h2>Children</h2>
      <p>{PRODUCT} is a tool for businesses and is not directed at children. Accounts are for adults acting for a business.</p>

      <h2>Changes to this policy</h2>
      <p>If this policy changes in a way that matters, businesses will be told in the dashboard or by email before the change takes effect. The date at the top shows the latest version.</p>

      <h2>Contact</h2>
      <p>Questions or requests about this policy: <Contact info={info} />.</p>
    </>
  );
}

function Terms({ info }: { info: LegalInfo }) {
  return (
    <>
      <p>
        These terms are the agreement between {info.operator} ("we") and the business that signs up
        to use {PRODUCT} ("you"). By creating an account you agree to them on behalf of your business.
      </p>

      <h2>The service</h2>
      <p>
        {PRODUCT} connects to the messaging channels you choose and answers your customers with AI
        agents working alongside your staff. It records enquiries, orders, bookings, invoices and
        payment claims, sends confirmations and receipts, notifies your team, and can publish posts
        you approve.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must give accurate details and keep your sign-in secure. You are responsible for what is done under your account and by the people you invite.</li>
        <li>You decide who on your team has which role, and can remove anyone at any time.</li>
        <li>A new business may need approval before its agents begin answering customers.</li>
      </ul>

      <h2>Your responsibilities</h2>
      <ul>
        <li><strong>Your channels.</strong> You may connect only accounts, Pages, numbers and bots that you own or are authorised to manage, and you must follow the rules of each platform, including Meta's and Telegram's terms and messaging policies.</li>
        <li><strong>Your customers' information.</strong> You are responsible for having a lawful basis to handle it, for telling your customers how it is used (including that replies may be automated), and for answering their requests about it.</li>
        <li><strong>Your content.</strong> The prices, products, policies and posts in your account are yours and must be accurate and lawful. You may publish only media you have the right to use.</li>
        <li><strong>Payments.</strong> {PRODUCT} does not process, hold or move money. Customers pay you directly. A payment is only confirmed when a person on your team checks that the money arrived and verifies it; you are responsible for that check.</li>
        <li><strong>Supervision.</strong> AI agents can be wrong. You are responsible for reviewing what they do in your name, for the settings you give them, and for stepping in where a person is needed.</li>
      </ul>

      <h2>What you must not do</h2>
      <ul>
        <li>Send unsolicited or bulk messages, or anything deceptive, unlawful, abusive or infringing.</li>
        <li>Use the service to collect information you are not entitled to, or to impersonate anyone.</li>
        <li>Try to access another business's information, disrupt the service, or get around its limits.</li>
        <li>Resell the service without our written agreement.</li>
      </ul>

      <h2>Our commitments</h2>
      <ul>
        <li>We handle your information and your customers' as set out in the <a href="/privacy">Privacy Policy</a>, and your customers' information only on your instructions.</li>
        <li>We work to keep the service available and secure, and tell you about problems that affect you.</li>
        <li>We may change or improve features. Where a change removes something you rely on, we will give notice where we reasonably can.</li>
      </ul>

      <h2>Third-party platforms</h2>
      <p>
        The service depends on platforms we do not control, including Meta, Telegram, our hosting
        providers and the AI model provider. They may change, limit or withdraw access, and messages
        may be delayed or refused by them. We are not responsible for their decisions or outages.
      </p>

      <h2>Fees</h2>
      <p>If fees apply to your plan they will be shown to you before you are charged. Charges already incurred are not refunded unless the law requires or we agree otherwise.</p>

      <h2>Suspension and ending</h2>
      <ul>
        <li>You can stop using the service and ask for your account to be closed at any time.</li>
        <li>We may suspend or close an account that breaks these terms, puts others at risk, or is required to be closed by law or by a platform. Where we can, we will tell you first and give you a chance to put it right.</li>
        <li>After an account is closed its information is deleted as described in the Privacy Policy.</li>
      </ul>

      <h2>Warranties and liability</h2>
      <p>
        The service is provided as it is. To the extent the law allows, we give no warranty that it
        will be uninterrupted or error-free, or that an AI agent's replies will be accurate or
        suitable for a particular purpose. To the extent the law allows, we are not liable for
        indirect or consequential loss, lost profit or lost business, and our total liability is
        limited to the fees you paid us in the three months before the claim arose. Nothing in these
        terms limits liability that cannot be limited by law.
      </p>

      <h2>Changes to these terms</h2>
      <p>We may update these terms. If a change matters, we will tell you in the dashboard or by email before it takes effect. Continuing to use the service after that means you accept the change.</p>

      <h2>Contact</h2>
      <p>Questions about these terms: <Contact info={info} />.</p>
    </>
  );
}

interface Status { status: string; outcome: string | null; created_at: string; completed_at: string | null }

const STATUS_LABEL: Record<string, string> = {
  received: 'Received',
  completed: 'Completed',
  no_data: 'Nothing was held',
  needs_review: 'Being handled by a person',
};

function DataDeletion({ info }: { info: LegalInfo }) {
  const initial = new URLSearchParams(window.location.search).get('code') ?? '';
  const [code, setCode] = useState(initial);
  const [status, setStatus] = useState<Status | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  const [email, setEmail] = useState('');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  async function lookUp(value: string) {
    const c = value.trim();
    if (!c) return;
    setLooking(true); setLookupError(null); setStatus(null);
    try {
      const r = await fetch(`/api/data-deletion/status?code=${encodeURIComponent(c)}`);
      const j = await r.json();
      if (!r.ok) setLookupError(j?.error ?? 'No request with that code.');
      else setStatus(j as Status);
    } catch {
      setLookupError('The request could not be looked up just now. Try again in a moment.');
    } finally {
      setLooking(false);
    }
  }

  // A link from Meta arrives with the code already in it.
  useEffect(() => { if (initial) void lookUp(initial); /* once */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true); setSendError(null);
    try {
      const r = await fetch('/api/data-deletion/request', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, details }),
      });
      const j = await r.json();
      if (!r.ok) setSendError(j?.error ?? 'Your request could not be sent. Please try again.');
      else { setSent(String(j.code)); setEmail(''); setDetails(''); }
    } catch {
      setSendError('Your request could not be sent just now. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <p>
        You can have the information {PRODUCT} holds about you deleted. Which way to ask depends on
        how you use it.
      </p>

      <h2>If you connected Instagram, Facebook or WhatsApp</h2>
      <ol>
        <li>
          <strong>Disconnect it in the dashboard:</strong> Integrations → the channel → Disconnect.
          The stored access for that account is deleted immediately.
        </li>
        <li>
          <strong>Or remove the app at the source.</strong> On Instagram: Settings → Apps and
          websites → Active → Remove. On Facebook: Settings → Business integrations → Remove.
          {' '}{PRODUCT} is told, switches the connection off and deletes its stored access. If you
          choose "delete data" there, you are given a code and a link back to this page.
        </li>
      </ol>

      <h2>If you run a business on {PRODUCT} and want everything deleted</h2>
      <p>
        Use the form below from the email address you sign in with, or write
        to <Contact info={info} />. We confirm it is you, delete your business's account and the
        information in it, and reply when it is done, normally within 30 days.
      </p>

      <h2>If you are a customer of a business that uses {PRODUCT}</h2>
      <p>
        Your conversation is with that business, and it holds the record. Ask the business to
        delete it, or use the form below and name the business; we will pass your request to it and
        make sure it is dealt with.
      </p>

      <h2>Ask for deletion</h2>
      {sent ? (
        <div className="legal-note legal-ok" role="status">
          Your request is recorded. Your code is <strong>{sent}</strong>. Keep it: enter it below at
          any time to see where the request stands. We will reply to the address you gave.
        </div>
      ) : (
        <form onSubmit={submit} className="legal-form">
          <label>
            <span>Your email address</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} />
          </label>
          <label>
            <span>What should be deleted</span>
            <textarea
              rows={4} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000}
              placeholder="For example: my business account and everything in it. Or: my conversation with (business name) on Instagram as @myusername."
            />
          </label>
          {sendError && <div className="legal-note legal-bad" role="alert">{sendError}</div>}
          <button type="submit" disabled={sending || !email.trim()}>{sending ? 'Sending…' : 'Send request'}</button>
        </form>
      )}

      <h2>Check a request</h2>
      <form onSubmit={(e) => { e.preventDefault(); void lookUp(code); }} className="legal-form legal-inline">
        <label>
          <span>Your code</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} autoComplete="off" spellCheck={false} />
        </label>
        <button type="submit" disabled={looking || !code.trim()}>{looking ? 'Checking…' : 'Check'}</button>
      </form>
      {lookupError && <div className="legal-note legal-bad" role="alert">{lookupError}</div>}
      {status && (
        <div className="legal-note" role="status">
          <strong>{STATUS_LABEL[status.status] ?? status.status}</strong>
          {status.outcome && <div>{status.outcome}</div>}
          <div className="legal-meta">
            Requested {new Date(status.created_at).toLocaleString()}
            {status.completed_at && ` · completed ${new Date(status.completed_at).toLocaleString()}`}
          </div>
        </div>
      )}
    </>
  );
}
