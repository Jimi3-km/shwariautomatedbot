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
  ChevronRight,
  Sparkles,
  Menu,
  X,
} from 'lucide-react';
import { AuthScreen } from './AuthScreen';

/* ───────────────────────────────────────────────────────────────────────
   Shared animation hook — triggers 'animate-in' when element scrolls
   into view. CSS handles the actual transition.
   ─────────────────────────────────────────────────────────────────────── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { el.classList.add('animate-in'); io.unobserve(el); } },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useReveal();
  return <div ref={ref} className={`reveal ${className}`}>{children}</div>;
}

/* ───────────────────────────────────────────────────────────────────────
   Landing Page
   ─────────────────────────────────────────────────────────────────────── */
interface LandingPageProps { onSignedIn: () => void; }

export function LandingPage({ onSignedIn }: LandingPageProps) {
  const [showAuth, setShowAuth] = React.useState(false);
  const [mobileMenu, setMobileMenu] = React.useState(false);

  if (showAuth) return <AuthScreen onSignedIn={onSignedIn} />;

  const cta = () => setShowAuth(true);

  return (
    <div className="landing-root">
      <style>{landingCSS}</style>

      {/* ── Navbar ─────────────────────────────────────────────────── */}
      <nav className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <a href="#" className="lp-logo">
            <Bot size={28} strokeWidth={2.2} />
            <span>Shwari</span>
          </a>

          {/* Desktop links */}
          <div className="lp-nav-links">
            <a href="#features">Features</a>
            <a href="#commerce">Commerce</a>
            <a href="#integrations">Integrations</a>
          </div>

          <div className="lp-nav-actions">
            <button onClick={cta} className="lp-btn-ghost">Sign In</button>
            <button onClick={cta} className="lp-btn-primary lp-btn-sm">
              Get Started <ArrowRight size={16} />
            </button>
          </div>

          {/* Mobile hamburger */}
          <button className="lp-hamburger" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Menu">
            {mobileMenu ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile dropdown */}
        {mobileMenu && (
          <div className="lp-mobile-menu">
            <a href="#features" onClick={() => setMobileMenu(false)}>Features</a>
            <a href="#commerce" onClick={() => setMobileMenu(false)}>Commerce</a>
            <a href="#integrations" onClick={() => setMobileMenu(false)}>Integrations</a>
            <button onClick={() => { setMobileMenu(false); cta(); }} className="lp-btn-primary" style={{ width: '100%', marginTop: 8 }}>
              Get Started Free
            </button>
          </div>
        )}
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-glow" />
        <div className="lp-container lp-hero-content">
          <Reveal>
            <div className="lp-badge">
              <Sparkles size={14} /> Now with AI-powered team collaboration
            </div>
          </Reveal>
          <Reveal>
            <h1 className="lp-hero-title">
              Your entire business,<br />
              <span className="lp-gradient-text">run by AI.</span>
            </h1>
          </Reveal>
          <Reveal>
            <p className="lp-hero-sub">
              Deploy a dedicated AI team that handles customer conversations, processes orders,
              manages bookings, and collects payments — across every messaging channel — while you focus on growth.
            </p>
          </Reveal>
          <Reveal>
            <div className="lp-hero-ctas">
              <button onClick={cta} className="lp-btn-primary lp-btn-lg">
                Start Free <ArrowRight size={18} />
              </button>
              <a href="#features" className="lp-btn-outline lp-btn-lg">
                See How It Works
              </a>
            </div>
          </Reveal>
          <Reveal>
            <div className="lp-hero-stats">
              <div className="lp-stat">
                <span className="lp-stat-num">100%</span>
                <span className="lp-stat-label">AI Handling Rate</span>
              </div>
              <div className="lp-stat-divider" />
              <div className="lp-stat">
                <span className="lp-stat-num">5</span>
                <span className="lp-stat-label">Specialized Agents</span>
              </div>
              <div className="lp-stat-divider" />
              <div className="lp-stat">
                <span className="lp-stat-num">24/7</span>
                <span className="lp-stat-label">Always Online</span>
              </div>
            </div>
          </Reveal>
          <Reveal className="lp-hero-img-wrap">
            <div className="lp-hero-img-frame">
              <img src="/screenshots/overview-page.png" alt="Shwari Dashboard Overview" loading="eager" />
              <div className="lp-hero-img-fade" />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Logos / Trust ──────────────────────────────────────────── */}
      <section className="lp-trust">
        <div className="lp-container">
          <Reveal>
            <p className="lp-trust-label">Built on trusted infrastructure</p>
            <div className="lp-trust-logos">
              {['Meta Business API', 'Telegram Bot API', 'M-Pesa', 'NVIDIA NIM'].map((t) => (
                <span key={t} className="lp-trust-item">{t}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Feature 1: AI Team ────────────────────────────────────── */}
      <section id="features" className="lp-section">
        <div className="lp-container">
          <Reveal>
            <div className="lp-section-header">
              <div className="lp-badge-purple"><Users size={14} /> AI Workforce</div>
              <h2 className="lp-section-title">
                Five specialized agents.<br />
                <span className="lp-gradient-text">Zero configuration.</span>
              </h2>
              <p className="lp-section-desc">
                Your AI team — Shwari, Sales, Support, Bookings, and Orders & Payments —
                comes pre-trained and ready to work. Just tell Shwari about your business
                and the entire team adapts.
              </p>
            </div>
          </Reveal>

          <div className="lp-feature-grid">
            <Reveal className="lp-feature-visual">
              <div className="lp-screenshot-card">
                <img src="/screenshots/AI-Team-page.png" alt="AI Team Configuration" />
              </div>
            </Reveal>
            <Reveal className="lp-feature-details">
              <ul className="lp-check-list">
                {[
                  ['Executive assistant', 'Shwari manages your entire business setup, directs the team, and reports back to you.'],
                  ['Sales agent', 'Answers product and pricing questions, qualifies interest, and closes orders automatically.'],
                  ['Support agent', 'Handles customer issues with your policies and knowledge base — no scripts needed.'],
                  ['Bookings agent', 'Schedules appointments, reschedules, and sends reminders without human intervention.'],
                  ['Orders & Payments', 'Processes orders, generates secure payment links, and tracks fulfilment.'],
                ].map(([title, desc], i) => (
                  <li key={i}>
                    <div className="lp-check-icon"><Check size={14} strokeWidth={3} /></div>
                    <div>
                      <strong>{title}</strong>
                      <span>{desc}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          {/* Agent chat screenshot */}
          <Reveal>
            <div className="lp-wide-screenshot">
              <div className="lp-screenshot-card">
                <img src="/screenshots/shwari-agent-page.png" alt="Shwari Agent Chat Interface" />
              </div>
              <p className="lp-screenshot-caption">
                Talk to Shwari like a colleague. It remembers everything, learns your preferences, and acts on your behalf.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Feature 2: Integrations ───────────────────────────────── */}
      <section id="integrations" className="lp-section lp-section-alt">
        <div className="lp-container">
          <Reveal>
            <div className="lp-section-header">
              <div className="lp-badge-blue"><MessageSquare size={14} /> Omnichannel</div>
              <h2 className="lp-section-title">
                Every channel.<br />
                <span className="lp-gradient-text">One inbox.</span>
              </h2>
              <p className="lp-section-desc">
                WhatsApp, Instagram, Telegram, and Webchat — unified into a single stream.
                Your AI team handles conversations across all channels simultaneously,
                with seamless human handoff when needed.
              </p>
            </div>
          </Reveal>

          <div className="lp-feature-grid lp-feature-grid-reverse">
            <Reveal className="lp-feature-details">
              <div className="lp-icon-features">
                {[
                  { icon: Globe, title: 'Multi-channel messaging', desc: 'Reach customers wherever they are — one platform, every channel.' },
                  { icon: Zap, title: 'One-click WhatsApp setup', desc: 'Embedded Signup connects your number in seconds — no API keys to paste.' },
                  { icon: Shield, title: 'Official Meta integration', desc: 'Built on the official Meta Business API with end-to-end encryption.' },
                  { icon: Users, title: 'Human handoff', desc: 'AI handles the volume. Your team steps in for high-value moments.' },
                ].map(({ icon: Icon, title, desc }, i) => (
                  <div key={i} className="lp-icon-feature">
                    <div className="lp-icon-wrap"><Icon size={20} /></div>
                    <div>
                      <strong>{title}</strong>
                      <span>{desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>
            <Reveal className="lp-feature-visual">
              <div className="lp-screenshot-card">
                <img src="/screenshots/inbox-page.png" alt="Unified Inbox" />
              </div>
              <div className="lp-screenshot-card" style={{ marginTop: 24 }}>
                <img src="/screenshots/Integrations-page.png" alt="Channel Integrations" />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Feature 3: Commerce ────────────────────────────────────── */}
      <section id="commerce" className="lp-section">
        <div className="lp-container">
          <Reveal>
            <div className="lp-section-header">
              <div className="lp-badge-green"><ShoppingBag size={14} /> Commerce</div>
              <h2 className="lp-section-title">
                Products. Services. Payments.<br />
                <span className="lp-gradient-text">All in one place.</span>
              </h2>
              <p className="lp-section-desc">
                Turn every conversation into revenue. Your AI agents showcase products,
                schedule services, and generate secure payment links — automatically.
              </p>
            </div>
          </Reveal>

          <div className="lp-commerce-grid">
            {[
              { img: '/screenshots/products-page.png', icon: ShoppingBag, title: 'Product Catalog', desc: 'Manage inventory with images, pricing, and variants. Agents recommend the right products to each customer.' },
              { img: '/screenshots/services-page.png', icon: Sparkles, title: 'Service Bookings', desc: 'Define packages, availability, and pricing. Your booking agent handles scheduling end-to-end.' },
              { img: '/screenshots/payments-page.png', icon: CreditCard, title: 'Payment Tracking', desc: 'Generate payment links, track invoices, and reconcile revenue — all from a single dashboard.' },
            ].map(({ img, icon: Icon, title, desc }, i) => (
              <Reveal key={i}>
                <div className="lp-commerce-card">
                  <div className="lp-commerce-card-img">
                    <img src={img} alt={title} />
                  </div>
                  <div className="lp-commerce-card-body">
                    <div className="lp-commerce-card-icon"><Icon size={20} /></div>
                    <h3>{title}</h3>
                    <p>{desc}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────── */}
      <section className="lp-cta-section">
        <div className="lp-cta-glow" />
        <div className="lp-container">
          <Reveal>
            <div className="lp-cta-card">
              <h2>Ready to put your business on autopilot?</h2>
              <p>Set up takes five minutes. Your AI team starts working immediately.</p>
              <button onClick={cta} className="lp-btn-primary lp-btn-lg">
                Create Your Free Account <ChevronRight size={18} />
              </button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <Bot size={22} strokeWidth={2.2} />
            <span>Shwari</span>
          </div>
          <p>&copy; {new Date().getFullYear()} Shwari. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Scoped CSS — injected via <style> so it's self-contained and doesn't
   leak into the authenticated app.
   ═══════════════════════════════════════════════════════════════════════ */
const landingCSS = `
/* ── Reset for landing only ────────────────────────────────────────── */
.landing-root {
  --lp-bg: #050505;
  --lp-surface: #0a0a0f;
  --lp-surface-2: #111118;
  --lp-border: rgba(255,255,255,0.06);
  --lp-border-2: rgba(255,255,255,0.1);
  --lp-text: #e8e8ec;
  --lp-text-2: #9a9ab0;
  --lp-text-3: #5e5e72;
  --lp-accent: #7c5cff;
  --lp-accent-2: #a78bfa;
  --lp-accent-glow: rgba(124,92,255,0.15);
  --lp-green: #34d399;
  --lp-blue: #60a5fa;
  --lp-radius: 16px;
  --lp-max: 1200px;

  min-height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--lp-bg);
  color: var(--lp-text);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  line-height: 1.6;
}

.landing-root *, .landing-root *::before, .landing-root *::after { box-sizing: border-box; }

.lp-container { max-width: var(--lp-max); margin: 0 auto; padding: 0 24px; }

/* ── Reveal animation ──────────────────────────────────────────────── */
.reveal {
  opacity: 0;
  transform: translateY(32px);
  transition: opacity 0.7s cubic-bezier(0.16,1,0.3,1), transform 0.7s cubic-bezier(0.16,1,0.3,1);
}
.reveal.animate-in {
  opacity: 1;
  transform: translateY(0);
}

/* ── Nav ────────────────────────────────────────────────────────────── */
.lp-nav {
  position: sticky; top: 0; z-index: 100;
  background: rgba(5,5,5,0.7);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  border-bottom: 1px solid var(--lp-border);
}
.lp-nav-inner {
  display: flex; align-items: center; justify-content: space-between;
  height: 64px;
}
.lp-logo {
  display: flex; align-items: center; gap: 10px;
  text-decoration: none; color: var(--lp-text);
  font-weight: 700; font-size: 20px; letter-spacing: -0.02em;
}
.lp-logo svg { color: var(--lp-accent); }
.lp-nav-links { display: flex; gap: 32px; }
.lp-nav-links a {
  color: var(--lp-text-2); text-decoration: none; font-size: 14px; font-weight: 500;
  transition: color 0.2s;
}
.lp-nav-links a:hover { color: var(--lp-text); }
.lp-nav-actions { display: flex; align-items: center; gap: 12px; }
.lp-hamburger {
  display: none; background: none; border: none; color: var(--lp-text);
  cursor: pointer; padding: 4px;
}
.lp-mobile-menu {
  display: none;
  flex-direction: column; gap: 8px;
  padding: 16px 24px 24px;
  border-top: 1px solid var(--lp-border);
}
.lp-mobile-menu a {
  color: var(--lp-text-2); text-decoration: none; font-size: 15px;
  padding: 8px 0; font-weight: 500;
}

@media (max-width: 768px) {
  .lp-nav-links, .lp-nav-actions { display: none; }
  .lp-hamburger { display: block; }
  .lp-mobile-menu { display: flex; }
}

/* ── Buttons ────────────────────────────────────────────────────────── */
.lp-btn-primary {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--lp-accent);
  color: #fff; border: none; border-radius: 12px;
  font-weight: 600; font-size: 15px; cursor: pointer;
  padding: 12px 24px;
  transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
  box-shadow: 0 0 24px var(--lp-accent-glow);
}
.lp-btn-primary:hover {
  background: #6a48e8;
  transform: translateY(-1px);
  box-shadow: 0 0 40px rgba(124,92,255,0.25);
}
.lp-btn-sm { padding: 8px 18px; font-size: 14px; border-radius: 10px; }
.lp-btn-lg { padding: 16px 32px; font-size: 16px; border-radius: 14px; }
.lp-btn-outline {
  display: inline-flex; align-items: center; gap: 8px;
  background: transparent; color: var(--lp-text);
  border: 1px solid var(--lp-border-2); border-radius: 12px;
  font-weight: 600; font-size: 15px; cursor: pointer;
  padding: 12px 24px; text-decoration: none;
  transition: border-color 0.2s, background 0.2s;
}
.lp-btn-outline:hover { border-color: var(--lp-text-3); background: rgba(255,255,255,0.03); }
.lp-btn-ghost {
  background: none; border: none; color: var(--lp-text-2);
  font-weight: 500; font-size: 14px; cursor: pointer;
  padding: 8px 12px; transition: color 0.2s;
}
.lp-btn-ghost:hover { color: var(--lp-text); }

/* ── Badges ─────────────────────────────────────────────────────────── */
.lp-badge, .lp-badge-purple, .lp-badge-blue, .lp-badge-green {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600; border-radius: 100px;
  padding: 6px 14px;
}
.lp-badge { background: rgba(124,92,255,0.1); color: var(--lp-accent-2); border: 1px solid rgba(124,92,255,0.15); }
.lp-badge-purple { background: rgba(124,92,255,0.1); color: var(--lp-accent-2); border: 1px solid rgba(124,92,255,0.15); }
.lp-badge-blue { background: rgba(96,165,250,0.1); color: var(--lp-blue); border: 1px solid rgba(96,165,250,0.15); }
.lp-badge-green { background: rgba(52,211,153,0.1); color: var(--lp-green); border: 1px solid rgba(52,211,153,0.15); }

/* ── Hero ───────────────────────────────────────────────────────────── */
.lp-hero {
  position: relative;
  padding: 80px 0 0;
  overflow: hidden;
}
.lp-hero-glow {
  position: absolute;
  top: -200px; left: 50%; transform: translateX(-50%);
  width: 800px; height: 600px;
  background: radial-gradient(ellipse, rgba(124,92,255,0.12) 0%, transparent 70%);
  pointer-events: none;
}
.lp-hero-content { text-align: center; position: relative; z-index: 1; }
.lp-hero-title {
  font-size: clamp(36px, 6vw, 72px);
  font-weight: 800; letter-spacing: -0.03em;
  line-height: 1.08; margin: 24px 0;
  color: #fff;
}
.lp-gradient-text {
  background: linear-gradient(135deg, var(--lp-accent) 0%, #c084fc 50%, var(--lp-blue) 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}
.lp-hero-sub {
  max-width: 640px; margin: 0 auto 40px;
  font-size: clamp(16px, 2vw, 19px);
  color: var(--lp-text-2); line-height: 1.7;
}
.lp-hero-ctas {
  display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;
  margin-bottom: 48px;
}

/* Stats */
.lp-hero-stats {
  display: flex; gap: 32px; justify-content: center; align-items: center;
  margin-bottom: 64px; flex-wrap: wrap;
}
.lp-stat { text-align: center; }
.lp-stat-num { display: block; font-size: 28px; font-weight: 800; color: #fff; letter-spacing: -0.02em; }
.lp-stat-label { font-size: 13px; color: var(--lp-text-3); font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; }
.lp-stat-divider { width: 1px; height: 40px; background: var(--lp-border-2); }

/* Hero image */
.lp-hero-img-wrap { width: 100%; }
.lp-hero-img-frame {
  position: relative;
  max-width: 1000px; margin: 0 auto;
  border-radius: 20px; overflow: hidden;
  border: 1px solid var(--lp-border-2);
  box-shadow: 0 40px 100px rgba(0,0,0,0.5), 0 0 60px var(--lp-accent-glow);
}
.lp-hero-img-frame img {
  width: 100%; display: block;
}
.lp-hero-img-fade {
  position: absolute; bottom: 0; left: 0; right: 0; height: 120px;
  background: linear-gradient(to top, var(--lp-bg), transparent);
  pointer-events: none;
}

/* ── Trust ──────────────────────────────────────────────────────────── */
.lp-trust {
  padding: 64px 0;
  border-top: 1px solid var(--lp-border);
  border-bottom: 1px solid var(--lp-border);
}
.lp-trust-label {
  text-align: center; font-size: 12px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--lp-text-3); margin-bottom: 24px;
}
.lp-trust-logos {
  display: flex; justify-content: center; gap: 40px; flex-wrap: wrap;
  align-items: center;
}
.lp-trust-item {
  font-size: 15px; font-weight: 600; color: var(--lp-text-3);
  letter-spacing: 0.02em;
  transition: color 0.2s;
}
.lp-trust-item:hover { color: var(--lp-text-2); }

/* ── Sections ──────────────────────────────────────────────────────── */
.lp-section { padding: 100px 0; }
.lp-section-alt { background: var(--lp-surface); }
.lp-section-header { text-align: center; max-width: 700px; margin: 0 auto 64px; }
.lp-section-title {
  font-size: clamp(28px, 4vw, 48px);
  font-weight: 800; letter-spacing: -0.03em;
  line-height: 1.15; color: #fff; margin: 20px 0 16px;
}
.lp-section-desc {
  font-size: 17px; color: var(--lp-text-2); line-height: 1.7;
  max-width: 560px; margin: 0 auto;
}

/* Feature grid */
.lp-feature-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 64px;
  align-items: start;
}
.lp-feature-grid-reverse .lp-feature-visual { order: 2; }
.lp-feature-grid-reverse .lp-feature-details { order: 1; }
@media (max-width: 768px) {
  .lp-feature-grid { grid-template-columns: 1fr; gap: 40px; }
  .lp-feature-grid-reverse .lp-feature-visual { order: 0; }
  .lp-feature-grid-reverse .lp-feature-details { order: 0; }
}

/* Screenshot cards */
.lp-screenshot-card {
  border-radius: var(--lp-radius); overflow: hidden;
  border: 1px solid var(--lp-border-2);
  background: var(--lp-surface-2);
  box-shadow: 0 8px 40px rgba(0,0,0,0.3);
  transition: transform 0.4s cubic-bezier(0.16,1,0.3,1), box-shadow 0.4s;
}
.lp-screenshot-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 20px 60px rgba(0,0,0,0.4), 0 0 40px var(--lp-accent-glow);
}
.lp-screenshot-card img { width: 100%; display: block; }

.lp-wide-screenshot { text-align: center; margin-top: 64px; }
.lp-wide-screenshot .lp-screenshot-card { max-width: 900px; margin: 0 auto; }
.lp-screenshot-caption {
  margin-top: 20px; font-size: 15px; color: var(--lp-text-3);
  font-style: italic;
}

/* Check list */
.lp-check-list {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 20px;
}
.lp-check-list li {
  display: flex; gap: 14px; align-items: flex-start;
}
.lp-check-icon {
  flex-shrink: 0;
  width: 24px; height: 24px;
  border-radius: 8px;
  background: rgba(52,211,153,0.12);
  color: var(--lp-green);
  display: flex; align-items: center; justify-content: center;
  margin-top: 2px;
}
.lp-check-list li strong {
  display: block; color: #fff; font-weight: 600;
  font-size: 15px; margin-bottom: 2px;
}
.lp-check-list li span {
  font-size: 14px; color: var(--lp-text-2); line-height: 1.5;
}

/* Icon features */
.lp-icon-features {
  display: flex; flex-direction: column; gap: 28px;
}
.lp-icon-feature {
  display: flex; gap: 16px; align-items: flex-start;
}
.lp-icon-wrap {
  flex-shrink: 0;
  width: 44px; height: 44px;
  border-radius: 12px;
  background: rgba(124,92,255,0.1);
  border: 1px solid rgba(124,92,255,0.15);
  color: var(--lp-accent-2);
  display: flex; align-items: center; justify-content: center;
}
.lp-icon-feature strong {
  display: block; color: #fff; font-weight: 600;
  font-size: 15px; margin-bottom: 4px;
}
.lp-icon-feature span {
  font-size: 14px; color: var(--lp-text-2); line-height: 1.5;
}

/* Commerce grid */
.lp-commerce-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
}
@media (max-width: 768px) {
  .lp-commerce-grid { grid-template-columns: 1fr; }
}
.lp-commerce-card {
  border-radius: var(--lp-radius);
  border: 1px solid var(--lp-border-2);
  background: var(--lp-surface);
  overflow: hidden;
  transition: transform 0.3s, border-color 0.3s, box-shadow 0.3s;
}
.lp-commerce-card:hover {
  transform: translateY(-4px);
  border-color: rgba(124,92,255,0.2);
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
.lp-commerce-card-img { padding: 16px 16px 0; }
.lp-commerce-card-img img {
  width: 100%; display: block; border-radius: 12px;
  border: 1px solid var(--lp-border);
}
.lp-commerce-card-body { padding: 20px 24px 28px; }
.lp-commerce-card-icon {
  width: 40px; height: 40px; border-radius: 10px;
  background: rgba(124,92,255,0.1);
  border: 1px solid rgba(124,92,255,0.15);
  color: var(--lp-accent-2);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 16px;
}
.lp-commerce-card h3 {
  font-size: 18px; font-weight: 700; color: #fff; margin-bottom: 8px;
}
.lp-commerce-card p {
  font-size: 14px; color: var(--lp-text-2); line-height: 1.6;
}

/* ── CTA ────────────────────────────────────────────────────────────── */
.lp-cta-section {
  position: relative;
  padding: 120px 0;
  overflow: hidden;
}
.lp-cta-glow {
  position: absolute;
  top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 600px; height: 400px;
  background: radial-gradient(ellipse, rgba(124,92,255,0.1) 0%, transparent 70%);
  pointer-events: none;
}
.lp-cta-card {
  text-align: center;
  padding: 80px 40px;
  border-radius: 24px;
  border: 1px solid var(--lp-border-2);
  background: linear-gradient(180deg, var(--lp-surface-2) 0%, var(--lp-surface) 100%);
  position: relative;
}
.lp-cta-card h2 {
  font-size: clamp(24px, 4vw, 40px);
  font-weight: 800; color: #fff;
  letter-spacing: -0.02em; margin-bottom: 16px;
}
.lp-cta-card p {
  font-size: 17px; color: var(--lp-text-2);
  margin-bottom: 32px;
}

/* ── Footer ─────────────────────────────────────────────────────────── */
.lp-footer {
  padding: 40px 0;
  border-top: 1px solid var(--lp-border);
}
.lp-footer-inner {
  display: flex; justify-content: space-between; align-items: center;
  flex-wrap: wrap; gap: 16px;
}
.lp-footer-brand {
  display: flex; align-items: center; gap: 8px;
  color: var(--lp-text-2); font-weight: 700; font-size: 16px;
}
.lp-footer-brand svg { color: var(--lp-accent); }
.lp-footer p { font-size: 13px; color: var(--lp-text-3); }

/* ── Mobile polish ──────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .lp-hero { padding-top: 48px; }
  .lp-hero-title { margin: 16px 0; }
  .lp-hero-sub { font-size: 16px; margin-bottom: 28px; }
  .lp-hero-ctas { flex-direction: column; align-items: center; }
  .lp-hero-ctas .lp-btn-lg { width: 100%; justify-content: center; }
  .lp-hero-stats { gap: 20px; }
  .lp-stat-num { font-size: 22px; }
  .lp-stat-divider { height: 28px; }
  .lp-section { padding: 64px 0; }
  .lp-section-header { margin-bottom: 40px; }
  .lp-cta-section { padding: 64px 0; }
  .lp-cta-card { padding: 48px 24px; border-radius: 16px; }
  .lp-hero-img-frame { border-radius: 12px; }
  .lp-footer-inner { flex-direction: column; text-align: center; }
  .lp-trust-logos { gap: 24px; }
}
`;
