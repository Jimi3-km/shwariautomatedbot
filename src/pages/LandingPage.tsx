import React, { useEffect, useRef } from 'react';
import {
  ArrowRight,
  Bot,
  MessageSquare,
  ShoppingBag,
  CreditCard,
  Users,
  Check,
  Zap,
  Shield,
  Globe,
  Menu,
  X,
} from 'lucide-react';
import { AuthScreen } from './AuthScreen';

/* ───────────────────────────────────────────────────────────────────────
   Scroll-reveal: fade up on first intersection.
   ─────────────────────────────────────────────────────────────────────── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { el.classList.add('lp-visible'); io.unobserve(el); } },
      { threshold: 0.1 },
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

/* ───────────────────────────────────────────────────────────────────────
   Override body/root scroll lock while the landing page is mounted.
   ─────────────────────────────────────────────────────────────────────── */
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

/* ═══════════════════════════════════════════════════════════════════════ */

interface LandingPageProps { onSignedIn: () => void; }

export function LandingPage({ onSignedIn }: LandingPageProps) {
  const [showAuth, setShowAuth] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  useScrollUnlock();

  if (showAuth) return <AuthScreen onSignedIn={onSignedIn} />;

  const go = () => setShowAuth(true);

  return (
    <div className="lp">
      <style>{css}</style>

      {/* ── Nav ──────────────────────────────────────────────────── */}
      <nav className="lp-nav">
        <div className="lp-w lp-nav-row">
          <a href="#" className="lp-brand"><Bot size={24} /><span>Shwari</span></a>
          <div className="lp-nav-links">
            <a href="#features">Features</a>
            <a href="#channels">Channels</a>
            <a href="#commerce">Commerce</a>
          </div>
          <div className="lp-nav-right">
            <button onClick={go} className="lp-link-btn">Sign in</button>
            <button onClick={go} className="lp-primary-btn lp-sm">Get Started</button>
          </div>
          <button className="lp-menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
        {menuOpen && (
          <div className="lp-dropdown">
            <a href="#features" onClick={() => setMenuOpen(false)}>Features</a>
            <a href="#channels" onClick={() => setMenuOpen(false)}>Channels</a>
            <a href="#commerce" onClick={() => setMenuOpen(false)}>Commerce</a>
            <hr />
            <button onClick={() => { setMenuOpen(false); go(); }} className="lp-primary-btn" style={{ width: '100%' }}>Get Started</button>
          </div>
        )}
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-w">
          <Reveal><p className="lp-kicker">AI-powered business operations</p></Reveal>
          <Reveal>
            <h1 className="lp-h1">
              Your entire business,<br />run by AI.
            </h1>
          </Reveal>
          <Reveal>
            <p className="lp-sub">
              Deploy a team of specialized AI agents that handle customer conversations,
              process orders, manage bookings, and collect payments — across every
              messaging channel — while you focus on growth.
            </p>
          </Reveal>
          <Reveal>
            <div className="lp-hero-actions">
              <button onClick={go} className="lp-primary-btn lp-lg">Start Free <ArrowRight size={16} /></button>
              <a href="#features" className="lp-outline-btn lp-lg">How it works</a>
            </div>
          </Reveal>
          <Reveal>
            <div className="lp-metrics">
              <div><strong>100%</strong><span>AI handling rate</span></div>
              <div><strong>5</strong><span>Specialized agents</span></div>
              <div><strong>24/7</strong><span>Always online</span></div>
            </div>
          </Reveal>
          <Reveal>
            <div className="lp-hero-img">
              <img src="/screenshots/overview-page.png" alt="Shwari Dashboard" />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Partners ─────────────────────────────────────────────── */}
      <div className="lp-partners">
        <div className="lp-w">
          <Reveal>
            <p className="lp-partners-label">Built on</p>
            <div className="lp-partners-row">
              {['Meta Business API', 'Telegram Bot API', 'M-Pesa', 'NVIDIA NIM'].map(t => (
                <span key={t}>{t}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </div>

      {/* ── AI Team ──────────────────────────────────────────────── */}
      <section id="features" className="lp-section">
        <div className="lp-w">
          <Reveal>
            <p className="lp-label">AI Workforce</p>
            <h2 className="lp-h2">Five agents. Zero configuration.</h2>
            <p className="lp-desc">
              Your AI team — Shwari, Sales, Support, Bookings, and Orders & Payments —
              comes pre-trained. Tell Shwari about your business and they all adapt.
            </p>
          </Reveal>

          <div className="lp-split">
            <Reveal className="lp-split-media">
              <div className="lp-img-card">
                <img src="/screenshots/AI-Team-page.png" alt="AI Team" />
              </div>
            </Reveal>
            <Reveal className="lp-split-text">
              <ul className="lp-checks">
                {[
                  ['Executive assistant', 'Manages your business setup, directs the team, and reports back.'],
                  ['Sales agent', 'Answers pricing questions, qualifies leads, closes orders.'],
                  ['Support agent', 'Resolves customer issues using your knowledge base.'],
                  ['Bookings agent', 'Schedules, reschedules, and sends reminders.'],
                  ['Orders & Payments', 'Processes orders and generates payment links.'],
                ].map(([t, d], i) => (
                  <li key={i}>
                    <span className="lp-check"><Check size={12} strokeWidth={3} /></span>
                    <div><strong>{t}</strong><span>{d}</span></div>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal>
            <div className="lp-wide-img">
              <div className="lp-img-card"><img src="/screenshots/shwari-agent-page.png" alt="Agent Chat" /></div>
              <p className="lp-caption">Talk to Shwari like a colleague. It learns your preferences and acts on your behalf.</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Channels ─────────────────────────────────────────────── */}
      <section id="channels" className="lp-section lp-section-alt">
        <div className="lp-w">
          <Reveal>
            <p className="lp-label">Omnichannel</p>
            <h2 className="lp-h2">Every channel. One inbox.</h2>
            <p className="lp-desc">
              WhatsApp, Instagram, Telegram, and Webchat in a single stream.
              Your AI team handles all of them simultaneously.
            </p>
          </Reveal>

          <div className="lp-split lp-split-reverse">
            <Reveal className="lp-split-text">
              <div className="lp-features-list">
                {[
                  { icon: Globe, t: 'Multi-channel messaging', d: 'Reach customers wherever they are.' },
                  { icon: Zap, t: 'One-click WhatsApp setup', d: 'Embedded Signup — no API keys to paste.' },
                  { icon: Shield, t: 'Official Meta integration', d: 'Built on the official Business API.' },
                  { icon: Users, t: 'Human handoff', d: 'AI handles volume. You handle high-value moments.' },
                ].map(({ icon: I, t, d }, i) => (
                  <div key={i} className="lp-feat-item">
                    <div className="lp-feat-icon"><I size={18} /></div>
                    <div><strong>{t}</strong><span>{d}</span></div>
                  </div>
                ))}
              </div>
            </Reveal>
            <Reveal className="lp-split-media">
              <div className="lp-img-card"><img src="/screenshots/inbox-page.png" alt="Inbox" /></div>
              <div className="lp-img-card" style={{ marginTop: 16 }}><img src="/screenshots/Integrations-page.png" alt="Integrations" /></div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Commerce ─────────────────────────────────────────────── */}
      <section id="commerce" className="lp-section">
        <div className="lp-w">
          <Reveal>
            <p className="lp-label">Commerce</p>
            <h2 className="lp-h2">Products. Services. Payments.</h2>
            <p className="lp-desc">
              Turn conversations into revenue. Agents showcase products,
              book services, and collect payments automatically.
            </p>
          </Reveal>

          <div className="lp-cards-3">
            {[
              { img: '/screenshots/products-page.png', icon: ShoppingBag, t: 'Product Catalog', d: 'Manage inventory with images, pricing, and variants.' },
              { img: '/screenshots/services-page.png', icon: CreditCard, t: 'Service Bookings', d: 'Define packages and availability. AI handles scheduling.' },
              { img: '/screenshots/payments-page.png', icon: CreditCard, t: 'Payment Tracking', d: 'Generate links, track invoices, reconcile revenue.' },
            ].map(({ img, icon: I, t, d }, i) => (
              <Reveal key={i}>
                <div className="lp-card">
                  <div className="lp-card-img"><img src={img} alt={t} /></div>
                  <div className="lp-card-body">
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <section className="lp-cta">
        <div className="lp-w">
          <Reveal>
            <div className="lp-cta-box">
              <h2>Ready to put your business on autopilot?</h2>
              <p>Set up takes five minutes. Your AI team starts working immediately.</p>
              <button onClick={go} className="lp-primary-btn lp-lg">Create Your Free Account</button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-w lp-footer-row">
          <div className="lp-brand"><Bot size={20} /><span>Shwari</span></div>
          <p>&copy; {new Date().getFullYear()} Shwari. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Scoped styles — clean, no glows, no gradients, no sparkles.
   ═══════════════════════════════════════════════════════════════════════ */
const css = `
.lp {
  --c-bg: #050505;
  --c-s1: #0c0c0c;
  --c-s2: #131313;
  --c-border: rgba(255,255,255,0.07);
  --c-t1: #ededed;
  --c-t2: #888;
  --c-t3: #555;
  --c-accent: #7c5cff;
  --c-green: #3dd68c;
  --radius: 12px;
  --max-w: 1120px;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  background: var(--c-bg);
  color: var(--c-t1);
  line-height: 1.6;
}
.lp *, .lp *::before, .lp *::after { box-sizing: border-box; margin: 0; padding: 0; }
.lp img { max-width: 100%; display: block; }
.lp a { color: inherit; text-decoration: none; }
.lp ul { list-style: none; }

.lp-w { max-width: var(--max-w); margin: 0 auto; padding: 0 20px; }

/* reveal */
.lp-reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.6s ease, transform 0.6s ease; }
.lp-reveal.lp-visible { opacity: 1; transform: none; }

/* ── Nav ──────────────────────────────────────────────────────────── */
.lp-nav {
  position: sticky; top: 0; z-index: 100;
  background: rgba(5,5,5,0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--c-border);
}
.lp-nav-row { display: flex; align-items: center; height: 56px; }
.lp-brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 17px; }
.lp-brand svg { color: var(--c-accent); }
.lp-nav-links { display: flex; gap: 28px; margin-left: 40px; }
.lp-nav-links a { font-size: 13px; color: var(--c-t2); font-weight: 500; transition: color .15s; }
.lp-nav-links a:hover { color: var(--c-t1); }
.lp-nav-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.lp-menu-btn { display: none; background: none; border: none; color: var(--c-t1); cursor: pointer; margin-left: auto; }
.lp-dropdown { display: none; flex-direction: column; padding: 12px 20px 20px; gap: 4px; }
.lp-dropdown a { padding: 10px 0; font-size: 14px; color: var(--c-t2); font-weight: 500; }
.lp-dropdown hr { border: none; border-top: 1px solid var(--c-border); margin: 8px 0; }
@media (max-width: 768px) {
  .lp-nav-links, .lp-nav-right { display: none; }
  .lp-menu-btn { display: block; }
  .lp-dropdown { display: flex; }
}

/* buttons */
.lp-primary-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--c-accent); color: #fff; border: none; border-radius: 8px;
  font-size: 14px; font-weight: 600; padding: 10px 20px; cursor: pointer;
  transition: opacity .15s;
}
.lp-primary-btn:hover { opacity: 0.88; }
.lp-sm { padding: 7px 14px; font-size: 13px; }
.lp-lg { padding: 14px 28px; font-size: 15px; border-radius: 10px; }
.lp-outline-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent; color: var(--c-t1); border: 1px solid var(--c-border);
  border-radius: 8px; font-size: 14px; font-weight: 600; padding: 10px 20px;
  cursor: pointer; transition: border-color .15s;
}
.lp-outline-btn:hover { border-color: var(--c-t3); }
.lp-link-btn { background: none; border: none; color: var(--c-t2); font-size: 13px; font-weight: 500; cursor: pointer; padding: 6px 10px; }
.lp-link-btn:hover { color: var(--c-t1); }

/* ── Hero ─────────────────────────────────────────────────────────── */
.lp-hero { padding: 72px 0 0; text-align: center; }
.lp-kicker {
  font-size: 13px; font-weight: 600; color: var(--c-accent);
  text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 16px;
}
.lp-h1 {
  font-size: clamp(32px, 5.5vw, 64px); font-weight: 800;
  letter-spacing: -0.03em; line-height: 1.1; color: #fff; margin-bottom: 20px;
}
.lp-sub {
  max-width: 580px; margin: 0 auto 36px; font-size: 16px;
  color: var(--c-t2); line-height: 1.7;
}
.lp-hero-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-bottom: 48px; }
.lp-metrics {
  display: flex; justify-content: center; gap: 48px; margin-bottom: 56px; flex-wrap: wrap;
}
.lp-metrics > div { text-align: center; }
.lp-metrics strong { display: block; font-size: 24px; font-weight: 800; color: #fff; }
.lp-metrics span { font-size: 12px; color: var(--c-t3); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500; }
.lp-hero-img {
  max-width: 960px; margin: 0 auto;
  border-radius: var(--radius); overflow: hidden;
  border: 1px solid var(--c-border);
}
.lp-hero-img img { width: 100%; }

/* ── Partners ─────────────────────────────────────────────────────── */
.lp-partners { padding: 48px 0; border-top: 1px solid var(--c-border); border-bottom: 1px solid var(--c-border); }
.lp-partners-label {
  text-align: center; font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.1em; color: var(--c-t3); margin-bottom: 16px;
}
.lp-partners-row { display: flex; justify-content: center; gap: 36px; flex-wrap: wrap; }
.lp-partners-row span { font-size: 13px; font-weight: 600; color: var(--c-t3); }

/* ── Sections ─────────────────────────────────────────────────────── */
.lp-section { padding: 96px 0; }
.lp-section-alt { background: var(--c-s1); }
.lp-label {
  font-size: 12px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.1em; color: var(--c-accent); margin-bottom: 12px; text-align: center;
}
.lp-h2 {
  font-size: clamp(24px, 3.5vw, 40px); font-weight: 800;
  letter-spacing: -0.025em; line-height: 1.15; color: #fff;
  text-align: center; margin-bottom: 12px;
}
.lp-desc { font-size: 15px; color: var(--c-t2); text-align: center; max-width: 520px; margin: 0 auto 56px; line-height: 1.7; }

/* split layout */
.lp-split { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: start; margin-bottom: 56px; }
.lp-split-reverse .lp-split-media { order: 2; }
.lp-split-reverse .lp-split-text { order: 1; }
@media (max-width: 768px) {
  .lp-split { grid-template-columns: 1fr; gap: 32px; }
  .lp-split-reverse .lp-split-media, .lp-split-reverse .lp-split-text { order: unset; }
}

/* image cards */
.lp-img-card {
  border-radius: var(--radius); overflow: hidden;
  border: 1px solid var(--c-border); background: var(--c-s2);
}
.lp-img-card img { width: 100%; }

.lp-wide-img { text-align: center; }
.lp-wide-img .lp-img-card { max-width: 880px; margin: 0 auto; }
.lp-caption { margin-top: 16px; font-size: 14px; color: var(--c-t3); }

/* check list */
.lp-checks { display: flex; flex-direction: column; gap: 16px; }
.lp-checks li { display: flex; gap: 12px; align-items: flex-start; }
.lp-check {
  flex-shrink: 0; width: 20px; height: 20px; border-radius: 6px;
  background: rgba(61,214,140,0.1); color: var(--c-green);
  display: flex; align-items: center; justify-content: center; margin-top: 2px;
}
.lp-checks strong { display: block; font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 1px; }
.lp-checks span { font-size: 13px; color: var(--c-t2); line-height: 1.5; }

/* features list */
.lp-features-list { display: flex; flex-direction: column; gap: 24px; }
.lp-feat-item { display: flex; gap: 14px; align-items: flex-start; }
.lp-feat-icon {
  flex-shrink: 0; width: 36px; height: 36px; border-radius: 9px;
  background: var(--c-s2); border: 1px solid var(--c-border);
  color: var(--c-t2); display: flex; align-items: center; justify-content: center;
}
.lp-feat-item strong { display: block; font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 2px; }
.lp-feat-item span { font-size: 13px; color: var(--c-t2); line-height: 1.5; }

/* commerce cards */
.lp-cards-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
@media (max-width: 768px) { .lp-cards-3 { grid-template-columns: 1fr; } }
.lp-card {
  border-radius: var(--radius); border: 1px solid var(--c-border);
  background: var(--c-s1); overflow: hidden;
  transition: border-color .2s;
}
.lp-card:hover { border-color: rgba(255,255,255,0.12); }
.lp-card-img { padding: 12px 12px 0; }
.lp-card-img img { border-radius: 8px; border: 1px solid var(--c-border); }
.lp-card-body { padding: 16px 20px 24px; }
.lp-card h3 { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 6px; }
.lp-card p { font-size: 13px; color: var(--c-t2); line-height: 1.5; }

/* ── CTA ──────────────────────────────────────────────────────────── */
.lp-cta { padding: 96px 0; }
.lp-cta-box {
  text-align: center; padding: 64px 32px;
  border-radius: 16px; border: 1px solid var(--c-border); background: var(--c-s1);
}
.lp-cta-box h2 { font-size: clamp(22px, 3vw, 32px); font-weight: 800; color: #fff; margin-bottom: 12px; }
.lp-cta-box p { font-size: 15px; color: var(--c-t2); margin-bottom: 28px; }

/* ── Footer ───────────────────────────────────────────────────────── */
.lp-footer { padding: 32px 0; border-top: 1px solid var(--c-border); }
.lp-footer-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.lp-footer p { font-size: 12px; color: var(--c-t3); }

/* ── Mobile ───────────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .lp-hero { padding-top: 48px; }
  .lp-hero-actions { flex-direction: column; align-items: stretch; }
  .lp-hero-actions .lp-primary-btn, .lp-hero-actions .lp-outline-btn { justify-content: center; }
  .lp-metrics { gap: 28px; }
  .lp-metrics strong { font-size: 20px; }
  .lp-section { padding: 64px 0; }
  .lp-cta { padding: 48px 0; }
  .lp-cta-box { padding: 40px 20px; border-radius: 12px; }
  .lp-footer-row { flex-direction: column; text-align: center; }
}
`;
