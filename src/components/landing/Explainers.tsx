import React from 'react';
import { Bell, Check, ShoppingCart, Users, Calendar, LifeBuoy, Image as ImageIcon } from 'lucide-react';
import { useStepper } from './media';

/**
 * Two smaller explainers built in code, for things the demo business had no
 * live data to show when the page was made: an alert arriving in three places,
 * and a week of posts being approved. Labels and sentences are the product's
 * own (the pop-up text, "Needs approval", "Approve week (3)", the toast).
 */

/* ── One event, three places ────────────────────────────────────────── */

const ALERT_TITLE = 'Payment to verify';
const ALERT_BODY = 'Jane Wanjiru says they paid KES 22,000 for ORD-00042 (ref QWE12RT45X).';

export function AlertsExplainer() {
  const { ref, step } = useStepper(3, 2200);
  const on = (n: number) => (step >= n ? 'lp-in' : 'lp-out');

  return (
    <div
      className="lp-alerts" ref={ref} role="img"
      aria-label="One payment claim shown three ways: a pop-up in the dashboard, numbered dots in the menu, and the same alert on WhatsApp and Telegram."
    >
      <div className={`lp-alerts-card ${on(0)}`}>
        <p className="lp-pane-title"><Bell size={12} aria-hidden="true" /> In the dashboard</p>
        <div className="lp-notice">
          <span className="lp-notice-title">{ALERT_TITLE}</span>
          <span className="lp-notice-body">{ALERT_BODY}</span>
          <span className="lp-notice-action">View</span>
        </div>
      </div>

      <div className={`lp-alerts-card ${on(1)}`}>
        <p className="lp-pane-title">In the menu</p>
        <div className="lp-navmock lp-navmock-col">
          <span className="lp-navmock-item"><Users size={14} aria-hidden="true" /> Leads <b className="lp-dot">2</b></span>
          <span className="lp-navmock-item"><Calendar size={14} aria-hidden="true" /> Appointments <b className="lp-dot">1</b></span>
          <span className="lp-navmock-item"><LifeBuoy size={14} aria-hidden="true" /> Support</span>
          <span className="lp-navmock-item"><ShoppingCart size={14} aria-hidden="true" /> Orders <b className="lp-dot">1</b></span>
        </div>
      </div>

      <div className={`lp-alerts-card ${on(2)}`}>
        <p className="lp-pane-title">On your phone</p>
        <div className="lp-alert-msg">
          <span className="lp-chip">WhatsApp</span>
          <strong>{ALERT_TITLE}</strong>
          <span>{ALERT_BODY}</span>
        </div>
        <div className="lp-alert-msg">
          <span className="lp-chip">Telegram</span>
          <strong>{ALERT_TITLE}</strong>
          <span>{ALERT_BODY}</span>
        </div>
      </div>
    </div>
  );
}

/* ── A week of posts, approved together ─────────────────────────────── */

const POSTS = [
  { day: 'Mon 23 Nov', about: 'Oak coffee table', where: 'Instagram' },
  { day: 'Wed 25 Nov', about: 'Linen cushion covers', where: 'Instagram' },
  { day: 'Fri 27 Nov', about: 'Living room styling', where: 'Facebook' },
];

export function MarketingExplainer() {
  // 0: the week laid out, waiting. 1: the button pressed. 2: approved.
  const { ref, step } = useStepper(3, 2400);
  const approved = step >= 2;

  return (
    <div
      className="lp-week" ref={ref} role="img"
      aria-label="A week of three proposed posts, each marked Needs approval. Approve week is pressed and all three become Approved."
    >
      <div className="lp-week-head">
        <span className="lp-week-range">Sun 22 Nov – Sat 28 Nov</span>
        {approved ? (
          <span className="lp-toast"><Check size={13} aria-hidden="true" /> 3 posts approved. They go out at their times.</span>
        ) : (
          <span className={`lp-btn-mock lp-btn-primary ${step === 1 ? 'lp-pressed' : ''}`}>
            <Check size={13} aria-hidden="true" /> Approve week (3)
          </span>
        )}
      </div>
      <div className="lp-week-days">
        {POSTS.map((p) => (
          <div key={p.day} className="lp-post">
            <span className="lp-post-day">{p.day} · 06:00 PM</span>
            <span className="lp-post-media"><ImageIcon size={18} aria-hidden="true" /> Your photo</span>
            <strong>{p.about}</strong>
            <span className="lp-post-foot">
              <span className="lp-chip">{p.where}</span>
              <span className={`lp-pill ${approved ? 'lp-pill-info' : 'lp-pill-warn'}`}>{approved ? 'Approved' : 'Needs approval'}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="lp-scene-note">Nothing is published until you approve.</p>
    </div>
  );
}
