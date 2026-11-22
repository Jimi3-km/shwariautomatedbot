import React, { useEffect, useRef } from 'react';
import {
  ArrowRight, Bot, Menu, X, Check,
  Send, MessageCircle, Instagram, Facebook, Globe,
  Sparkles, ShoppingBag, LifeBuoy, CalendarDays, Receipt, Megaphone,
} from 'lucide-react';
import { AuthScreen, hasAuthCallback } from './AuthScreen';
import { BrowserFrame, PhoneFrame, Shot, DemoVideo } from '../components/landing/media';
import { SaleExplainer } from '../components/landing/SaleExplainer';
import { AlertsExplainer, MarketingExplainer } from '../components/landing/Explainers';

/**
 * The public landing page.
 *
 * Every claim here is something the product does today; the rules for what
 * may be said, and how each image and video was made, are in
 * `.claude/skills/shwari-marketing/SKILL.md`. Styles are the `lp-*` rules at
 * the end of `src/index.css`; imagery lives in `public/landing/`.
 */

/* Scroll-reveal: fade up on first intersection. */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { el.classList.add('lp-visible'); return; }
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { el.classList.add('lp-visible'); io.unobserve(el); } },
      { threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useReveal();
  return <div ref={ref} className={`lp-reveal ${className}`}>{children}</div>;
}

/* Override body/root scroll lock while the landing page is mounted. */
function useScrollUnlock() {
  useEffect(() => {
    const body = document.body;
    const root = document.getElementById('root');
    body.style.overflow = 'auto';
    body.style.height = 'auto';
    if (root) { root.style.height = 'auto'; }
    return () => {
      body.style.overflow = '';
      body.style.height = '';
      if (root) { root.style.height = ''; }
    };
  }, []);
}

interface LandingPageProps { onSignedIn: () => void; }

/** Arrived on a staff invitation: skip the marketing page. */
function hasPendingInvite(): boolean {
  try { return Boolean(localStorage.getItem('shwari.pending_invite')); } catch { return false; }
}

const NAV = [
  { href: '#how', label: 'How a sale happens' },
  { href: '#paid', label: 'Getting paid' },
  { href: '#team', label: 'The team' },
  { href: '#marketing', label: 'Marketing' },
];

const CHANNELS = [
  { icon: MessageCircle, name: 'WhatsApp Business', how: 'Approve access with Meta and your number is set up for you.' },
  { icon: Instagram, name: 'Instagram', how: 'Approve access with Instagram and your direct messages are handled.' },
  { icon: Facebook, name: 'Facebook Messenger', how: 'Sign in with Facebook and choose your Page.' },
  { icon: Send, name: 'Telegram', how: 'Connect your own bot.' },
  { icon: Globe, name: 'Web chat', how: 'Paste one snippet into your website.' },
];

const TEAM = [
  { icon: Sparkles, name: 'Shwari', who: 'Works with you', does: 'Your executive assistant. Runs the business with you, and directs the rest of the team.' },
  { icon: ShoppingBag, name: 'Sales', who: 'Works with your customers', does: 'Answers product and price questions, qualifies interest and closes orders.' },
  { icon: LifeBuoy, name: 'Support', who: 'Works with your customers', does: 'Handles problems (complaints, faults, cancellations) and gets a person involved when needed.' },
  { icon: CalendarDays, name: 'Bookings', who: 'Works with your customers', does: 'Owns the diary: availability, booking, moving and confirming appointments.' },
  { icon: Receipt, name: 'Orders & Payments', who: 'Works with your customers', does: 'Tracks orders through to delivery, and records payment claims for a person to verify.' },
  { icon: Megaphone, name: 'Marketing', who: 'Works on your posts', does: 'Plans the week’s posts from your content library and publishes the ones you approve, on schedule.' },
];

const ROLES = [
  ['Owner', 'Everything, including staff.'],
  ['Manager', 'Channels, agents, catalogue, payment details and posts. Cannot add or remove staff.'],
  ['Staff', 'Answers customers, handles leads, orders and bookings, verifies payments.'],
  ['Viewer', 'Can read everything, change nothing.'],
];

function Ticks({ items }: { items: string[] }) {
  return (
    <ul className="lp-ticks">
      {items.map((t) => (
        <li key={t}><span className="lp-tick" aria-hidden="true"><Check size={12} strokeWidth={3} /></span><span>{t}</span></li>
      ))}
    </ul>
  );
}

export function LandingPage({ onSignedIn }: LandingPageProps) {
  // The Instagram OAuth callback lands signed-out users here. Go straight to
  // the auth screen in that case: it finishes the sign-in or shows the error.
  const [showAuth, setShowAuth] = React.useState(() => hasAuthCallback() || hasPendingInvite());
  const [menuOpen, setMenuOpen] = React.useState(false);
  useScrollUnlock();

  if (showAuth) return <AuthScreen onSignedIn={onSignedIn} />;

  const go = () => setShowAuth(true);

  return (
    <div className="lp">
      <a href="#main" className="lp-skip">Skip to content</a>

      {/* ── Nav ──────────────────────────────────────────────────── */}
      <nav className="lp-nav" aria-label="Main">
        <div className="lp-w lp-nav-row">
          <a href="/" className="lp-brand" aria-label="Shwari home"><Bot size={24} aria-hidden="true" /><span>Shwari</span></a>
          <div className="lp-nav-links">
            {NAV.map((n) => <a key={n.href} href={n.href}>{n.label}</a>)}
          </div>
          <div className="lp-nav-right">
            <button type="button" onClick={go} className="lp-link-btn">Sign in</button>
            <button type="button" onClick={go} className="lp-primary-btn lp-sm">Start Free</button>
          </div>
          <button
            type="button" className="lp-menu-btn" onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </button>
        </div>
        {menuOpen && (
          <div className="lp-dropdown">
            {NAV.map((n) => <a key={n.href} href={n.href} onClick={() => setMenuOpen(false)}>{n.label}</a>)}
            <hr />
            <button type="button" onClick={() => { setMenuOpen(false); go(); }} className="lp-outline-btn lp-full">Sign in</button>
            <button type="button" onClick={() => { setMenuOpen(false); go(); }} className="lp-primary-btn lp-full">Start Free</button>
          </div>
        )}
      </nav>

      <main id="main">
        {/* ── Hero ───────────────────────────────────────────────── */}
        <section className="lp-hero">
          <div className="lp-w lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-kicker">For businesses that sell in chats</p>
              <h1 className="lp-h1">An AI team that answers your customers, takes the order and gets you paid.</h1>
              <p className="lp-sub">
                Shwari is six AI agents working from your own catalogue. They answer on WhatsApp,
                Instagram, Messenger, Telegram and web chat, record orders and bookings, and send
                invoices and receipts. A person on your side confirms every payment.
              </p>
              <div className="lp-hero-actions">
                <button type="button" onClick={go} className="lp-primary-btn lp-lg">Start Free <ArrowRight size={16} aria-hidden="true" /></button>
                <a href="#how" className="lp-outline-btn lp-lg">See how a sale happens</a>
              </div>
            </div>
            <div className="lp-hero-media">
              <BrowserFrame label="The dashboard">
                <DemoVideo
                  name="tour" w={960} h={570}
                  label="A tour of the Shwari dashboard: Overview, Inbox, Leads, Invoices, Payments and the AI team"
                />
              </BrowserFrame>
              <p className="lp-caption">The real dashboard, recorded from a live business. Customer details are replaced with demo values.</p>
            </div>
          </div>
        </section>

        {/* ── How a sale happens ─────────────────────────────────── */}
        <section id="how" className="lp-section lp-section-alt">
          <div className="lp-w">
            <Reveal>
              <p className="lp-label">How a sale happens</p>
              <h2 className="lp-h2">From the first message to a receipt.</h2>
              <p className="lp-desc">
                The agents do the talking and the record-keeping. You do one thing: check that the money arrived.
              </p>
            </Reveal>
            <Reveal><SaleExplainer /></Reveal>
          </div>
        </section>

        {/* ── Channels ───────────────────────────────────────────── */}
        <section id="channels" className="lp-section">
          <div className="lp-w">
            <Reveal>
              <p className="lp-label">Channels</p>
              <h2 className="lp-h2">Five channels, one inbox.</h2>
              <p className="lp-desc">
                Customers write wherever they already are. Every conversation lands in the same inbox,
                marked with its channel and whether an agent or a person is handling it.
              </p>
            </Reveal>
            <div className="lp-split lp-split-lg">
              <Reveal className="lp-split-text">
                <ul className="lp-channels">
                  {CHANNELS.map(({ icon: I, name, how }) => (
                    <li key={name}>
                      <span className="lp-feat-icon" aria-hidden="true"><I size={18} /></span>
                      <div><strong>{name}</strong><span>{how}</span></div>
                    </li>
                  ))}
                </ul>
                <p className="lp-small">
                  WhatsApp, Instagram and Messenger connect through Meta&rsquo;s own sign-in, so they depend on Meta approving the account.
                </p>
              </Reveal>
              <Reveal className="lp-split-media">
                <BrowserFrame label="Inbox">
                  <Shot name="inbox" w={1280} h={760}
                    alt="The Inbox: a list of conversations with channel and lead stage, an open Telegram conversation where the agent sent an invoice as a PDF, and the customer's details and payments beside it" />
                </BrowserFrame>
                <p className="lp-caption">Press <strong>Take over</strong> to answer yourself. The agent steps back on that conversation.</p>
              </Reveal>
            </div>
            <Reveal>
              <div className="lp-wide">
                <BrowserFrame label="Leads">
                  <Shot name="leads" w={1048} h={400}
                    alt="The Leads board: columns for New, Contacted, Interested and Quoted, with each customer on a card showing channel and interest score" />
                </BrowserFrame>
                <p className="lp-caption">Everyone the agents have spoken to is on the Leads board, from New through Payment verified to Won.</p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Getting paid ───────────────────────────────────────── */}
        <section id="paid" className="lp-section lp-section-alt">
          <div className="lp-w">
            <Reveal>
              <p className="lp-label">Getting paid</p>
              <h2 className="lp-h2">Customers claim a payment. You confirm it.</h2>
              <p className="lp-desc">
                An agent never marks a payment verified; only a person does. Once you verify, the customer
                gets a confirmation and a PDF receipt in the chat and by email.
              </p>
            </Reveal>

            <Reveal>
              <div className="lp-wide">
                <BrowserFrame label="Payments">
                  <Shot name="payments" w={1048} h={330}
                    alt="The Payments page with tabs for All, Awaiting check, Verified and Rejected, and one verified payment of KES 22,000 with a Receipt button" />
                </BrowserFrame>
              </div>
            </Reveal>

            <div className="lp-split lp-split-docs">
              <Reveal className="lp-split-text">
                <h3 className="lp-h3">Receipts and invoices on your own letterhead</h3>
                <p className="lp-p">
                  Both are real documents, sent as PDFs. Add a logo or a full letterhead banner, your contact
                  details, a tax number, a closing note and your colour, and watch the preview change as you go.
                </p>
                <Ticks items={[
                  'A receipt goes out when a payment is verified.',
                  'An invoice shows the amount due, the due date and how to pay.',
                  'An optional PAID mark on receipts.',
                ]} />
                <BrowserFrame label="Settings · Invoices & receipts" className="lp-frame-sm">
                  <Shot name="letterhead" w={1048} h={622}
                    alt="Settings, Invoices and receipts: the letterhead form with tagline, phone, email and website beside a live preview of a receipt" />
                </BrowserFrame>
              </Reveal>
              <Reveal className="lp-split-media">
                <div className="lp-docs">
                  <figure className="lp-doc">
                    <Shot name="receipt" w={720} h={748}
                      alt="A sample receipt: letterhead, receipt number, billed to, M-Pesa reference marked verified, two items, a PAID stamp and a total of KES 22,000" />
                    <figcaption>Receipt</figcaption>
                  </figure>
                  <figure className="lp-doc">
                    <Shot name="invoice-doc" w={720} h={900}
                      alt="A sample invoice: the same letterhead, invoice number, amount due of KES 30,500 awaiting payment, two lines, how to pay and terms" />
                    <figcaption>Invoice</figcaption>
                  </figure>
                </div>
                <p className="lp-caption">Drawn by the product&rsquo;s own renderer with demo data.</p>
              </Reveal>
            </div>

            <div className="lp-split lp-split-reverse lp-split-lg">
              <Reveal className="lp-split-media">
                <BrowserFrame label="Invoices">
                  <DemoVideo
                    name="invoice" w={960} h={570}
                    label="Invoices: the list, the New invoice dialog, the row menu with Open PDF, Send again and Cancel invoice, and the invoice arriving in the customer's chat as a PDF"
                  />
                </BrowserFrame>
              </Reveal>
              <Reveal className="lp-split-text">
                <h3 className="lp-h3">Invoices, raised by you or on booking</h3>
                <p className="lp-p">
                  Bill a customer, send the invoice as a PDF, and confirm when it is paid.
                </p>
                <Ticks items={[
                  'Pick someone who has messaged you and the invoice goes to their chat; a new customer gets it by email.',
                  'Switch on “Invoice bookings automatically” and a priced booking raises and sends its own invoice.',
                  'Settle it by verifying the customer’s payment, or press Mark paid.',
                  'See what is awaiting payment and what is overdue at a glance.',
                ]} />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Knowing at once ────────────────────────────────────── */}
        <section id="alerts" className="lp-section">
          <div className="lp-w">
            <Reveal>
              <p className="lp-label">Knowing at once</p>
              <h2 className="lp-h2">The moment something needs you, you hear about it.</h2>
              <p className="lp-desc">
                Everything appears in the bell and pops up on screen while the dashboard is open. The same
                alerts go to the WhatsApp numbers you choose and to a Telegram bot of your own.
              </p>
            </Reveal>
            <Reveal><AlertsExplainer /></Reveal>
            <div className="lp-split">
              <Reveal className="lp-split-text">
                <h3 className="lp-h3">You choose what reaches your phone</h3>
                <Ticks items={[
                  'A payment to check, a new order, a customer who needs a person.',
                  'An invoice paid or overdue; posts to approve, published or failed.',
                  'Numbered dots in the menu for new leads, appointments, support and orders. Opening the page clears its dot.',
                  'Send a test alert to see exactly how the real one is worded.',
                ]} />
              </Reveal>
              <Reveal className="lp-split-media">
                <BrowserFrame label="Settings · Notifications" className="lp-frame-sm">
                  <Shot name="notifications" w={740} h={500}
                    alt="Settings, Notifications: a ticked list of what to alert about, from a payment to check through to an invoice overdue" />
                </BrowserFrame>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── The team ───────────────────────────────────────────── */}
        <section id="team" className="lp-section lp-section-alt">
          <div className="lp-w">
            <Reveal>
              <p className="lp-label">The team</p>
              <h2 className="lp-h2">Six agents, each with one job.</h2>
              <p className="lp-desc">
                Every business gets the same team. Shwari works with you, four departments answer your
                customers, and Marketing keeps you posting.
              </p>
            </Reveal>
            <Reveal>
              <ul className="lp-team">
                {TEAM.map(({ icon: I, name, who, does }) => (
                  <li key={name} className="lp-agent">
                    <span className="lp-agent-icon" aria-hidden="true"><I size={18} /></span>
                    <h3>{name}</h3>
                    <p className="lp-agent-who">{who}</p>
                    <p>{does}</p>
                  </li>
                ))}
              </ul>
            </Reveal>
            <div className="lp-split lp-split-reverse lp-split-lg">
              <Reveal className="lp-split-media">
                <BrowserFrame label="AI team">
                  <Shot name="ai-team" w={900} h={570}
                    alt="The AI team page: Sales, Support, Bookings, Orders and Payments, and Marketing, each with a description and an On switch" />
                </BrowserFrame>
              </Reveal>
              <Reveal className="lp-split-text">
                <h3 className="lp-h3">Rules that do not bend</h3>
                <Ticks items={[
                  'An agent offers, quotes, books and sells only what is in your catalogue.',
                  'It reads your records before it answers, and never says something happened unless it did.',
                  'It records a payment claim; it never says money arrived.',
                  'It brings in a person for a refund or dispute, an upset customer, or anyone who asks for one.',
                ]} />
                <p className="lp-p">
                  Open any agent to see what it handles and the rules it follows, switch it on or off, and add your own instructions.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Shwari ─────────────────────────────────────────────── */}
        <section id="shwari" className="lp-section">
          <div className="lp-w">
            <Reveal>
              <p className="lp-label">Shwari, the manager</p>
              <h2 className="lp-h2">Run the business by saying what you want.</h2>
              <p className="lp-desc">
                Shwari is the agent you talk to. Tell it about your business in plain language and it sets
                things up, keeps them correct and reports back.
              </p>
            </Reveal>
            <Reveal>
              <div className="lp-wide">
                <BrowserFrame label="Shwari">
                  <Shot name="shwari" w={1030} h={196}
                    alt="A conversation with Shwari: the owner asks for a full technology services catalogue and Shwari replies that it has rebuilt the business as a technology services company" />
                </BrowserFrame>
                <p className="lp-caption">A real exchange from the dashboard: one request rebuilt this business&rsquo;s profile, services and products.</p>
              </div>
            </Reveal>
            <Reveal>
              <div className="lp-cols-2">
                <Ticks items={[
                  'Sets up and keeps the business details, services, products, hours and policies correct.',
                  'Answers questions about performance and explains what the numbers mean.',
                  'Flags what needs attention: payments to check, customers gone quiet, unanswered questions.',
                ]} />
                <Ticks items={[
                  'Books, reschedules, chases and updates records on your behalf.',
                  'Passes work to the right department and reports back what was done.',
                  'Also reachable on Telegram, for the owner and managers.',
                ]} />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Marketing ──────────────────────────────────────────── */}
        <section id="marketing" className="lp-section lp-section-alt">
          <div className="lp-w">
            <Reveal>
              <p className="lp-label">Marketing</p>
              <h2 className="lp-h2">Your own photos, a week approved at a time.</h2>
              <p className="lp-desc">
                Upload your photos and videos, say what each is about, and the Marketing agent lays out the
                next seven days for Instagram and your Facebook Page. Nothing is generated, and nothing
                unapproved is published.
              </p>
            </Reveal>
            <Reveal><MarketingExplainer /></Reveal>
            <div className="lp-split">
              <Reveal className="lp-split-text">
                <h3 className="lp-h3">You set the pace</h3>
                <Ticks items={[
                  'Choose the days and times posts go out.',
                  'Approve the week together, approve each post, or let already-approved items go out on autopilot.',
                  'Pause posting to stop everything at once.',
                  'Marketing never talks to a customer; it works only on your posts.',
                ]} />
              </Reveal>
              <Reveal className="lp-split-media">
                <BrowserFrame label="Marketing · Schedule" className="lp-frame-sm">
                  <Shot name="marketing-schedule" w={620} h={520}
                    alt="Marketing, Schedule: posting is on, posts are approved a week at a time, and posts go out on Monday, Wednesday and Friday at 6 PM" />
                </BrowserFrame>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Roles ──────────────────────────────────────────────── */}
        <section id="roles" className="lp-section">
          <div className="lp-w">
            <Reveal>
              <p className="lp-label">Your staff</p>
              <h2 className="lp-h2">Give each person the access their job needs.</h2>
              <p className="lp-desc">
                Invite people by email, with a WhatsApp message too if you add their number. Whoever verifies
                a payment or answers a customer is recorded by name.
              </p>
            </Reveal>
            <div className="lp-split">
              <Reveal className="lp-split-text">
                <dl className="lp-roles">
                  {ROLES.map(([r, d]) => (
                    <div key={r}><dt>{r}</dt><dd>{d}</dd></div>
                  ))}
                </dl>
                <p className="lp-small">Invitations expire, removing a person ends their access at once, and an activity log shows every change.</p>
              </Reveal>
              <Reveal className="lp-split-media">
                <BrowserFrame label="Settings · Team" className="lp-frame-sm">
                  <Shot name="team" w={740} h={480}
                    alt="Settings, Team: a pending invitation, the form to invite someone by email and WhatsApp number with a role, and what each role can do" />
                </BrowserFrame>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── On a phone ─────────────────────────────────────────── */}
        <section id="phone" className="lp-section lp-section-alt">
          <div className="lp-w">
            <Reveal>
              <p className="lp-label">On a phone</p>
              <h2 className="lp-h2">The whole dashboard, in your pocket.</h2>
              <p className="lp-desc">
                Open it in your phone&rsquo;s browser. Read a conversation, check a payment or raise an invoice from wherever you are.
              </p>
            </Reveal>
            <Reveal>
              <div className="lp-phones">
                <PhoneFrame>
                  <DemoVideo
                    name="phone" w={390} h={844}
                    label="The dashboard on a phone: Home, Inbox, a conversation, Invoices and Payments"
                  />
                </PhoneFrame>
                <PhoneFrame className="lp-phone-extra">
                  <Shot name="phone-chat" w={540} h={1170}
                    alt="A conversation on a phone: the agent books a service, tells the customer someone will confirm their payment claim, and later sends an invoice as a PDF" />
                </PhoneFrame>
                <PhoneFrame className="lp-phone-extra">
                  <Shot name="phone-invoices" w={540} h={1170}
                    alt="Invoices on a phone: a New invoice button, totals awaiting payment and overdue, and an invoice with a Mark paid button" />
                </PhoneFrame>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── CTA ────────────────────────────────────────────────── */}
        <section className="lp-cta">
          <div className="lp-w">
            <Reveal>
              <div className="lp-cta-box">
                <h2>Start with your own catalogue.</h2>
                <p>
                  Create an account, tell Shwari about your business and connect a channel.
                  New businesses are reviewed before their agents start answering customers.
                </p>
                <button type="button" onClick={go} className="lp-primary-btn lp-lg">Start Free <ArrowRight size={16} aria-hidden="true" /></button>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-w lp-footer-row">
          <div className="lp-brand"><Bot size={20} aria-hidden="true" /><span>Shwari</span></div>
          <p>&copy; {new Date().getFullYear()} Shwari. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
