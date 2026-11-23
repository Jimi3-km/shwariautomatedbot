import React from 'react';
import { Bot, Check, X, Receipt, ShieldCheck, ShoppingCart, FileText, Pause, Play } from 'lucide-react';
import { useStepper } from './media';

/**
 * "How a sale happens": a customer message to a receipt, in six steps.
 *
 * Built in code because the flow crosses two screens (the customer's chat and
 * the dashboard) and takes minutes in real life. The wording is the product's
 * own: the pop-up titles and bodies, the Payments page buttons, the "Verify
 * this payment?" dialog and the confirmation the customer receives. The
 * business, customer, order and reference are demo values.
 */

const STEPS: Array<{ title: string; detail: string }> = [
  { title: 'A customer writes in', detail: 'On WhatsApp, Instagram, Messenger, Telegram or your web chat.' },
  { title: 'An agent answers from your catalogue', detail: 'Prices come from your own records in the same turn, never from a guess.' },
  { title: 'The order is recorded', detail: 'It is checked against the catalogue and priced from it. You get a pop-up and a numbered dot on Orders.' },
  { title: 'The customer says they have paid', detail: 'Their payment message becomes a claim. The agent never says the money arrived.' },
  { title: 'A person presses Verify', detail: 'You or your staff check the account and confirm. It is recorded against your name.' },
  { title: 'The receipt lands in the chat', detail: 'A confirmation and a PDF receipt on your letterhead, in the chat and by email.' },
];

type Msg = { from: number; who: 'customer' | 'agent'; role?: string; text: string; file?: string };

const CHAT: Msg[] = [
  { from: 0, who: 'customer', text: 'Hi, how much is the oak coffee table?' },
  { from: 1, who: 'agent', role: 'Sales', text: 'The Oak coffee table is KES 18,500 and Linen cushion covers are KES 1,750 each. Would you like to order?' },
  { from: 2, who: 'customer', text: 'Yes, the table and 2 cushion covers. Deliver to Kilimani.' },
  { from: 2, who: 'agent', role: 'Sales', text: 'Your order ORD-00042 is recorded: 1 x Oak coffee table, 2 x Linen cushion cover. Total KES 22,000.' },
  { from: 3, who: 'customer', text: 'QWE12RT45X Confirmed. Ksh22,000.00 paid to AMANI HOME STUDIO.' },
  { from: 3, who: 'agent', role: 'Orders & Payments', text: 'Someone will confirm your payment claim shortly.' },
  {
    from: 5, who: 'agent', role: 'Orders & Payments',
    text: 'Hi Jane, we have received and confirmed your payment of KES 22,000 for order ORD-00042. Your order is now confirmed and we will update you on the next step.',
    file: 'Receipt ORD-00042.pdf',
  },
];

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="lp-notice">
      <span className="lp-notice-title">{title}</span>
      <span className="lp-notice-body">{body}</span>
      <span className="lp-notice-action">View</span>
    </div>
  );
}

function PaymentRow({ verified }: { verified: boolean }) {
  return (
    <div className="lp-row">
      <div className="lp-row-main">
        <strong>KES 22,000</strong>
        <span>Jane Wanjiru</span>
        <code>QWE12RT45X</code>
      </div>
      <div className="lp-row-side">
        <span className={`lp-pill ${verified ? 'lp-pill-ok' : 'lp-pill-warn'}`}>{verified ? 'Verified' : 'Unverified'}</span>
        {verified ? (
          <span className="lp-row-actions">
            <ShieldCheck size={13} className="lp-ok" aria-hidden="true" />
            <span className="lp-btn-mock"><Receipt size={12} aria-hidden="true" /> Receipt</span>
          </span>
        ) : (
          <span className="lp-row-actions">
            <span className="lp-btn-mock lp-btn-ok"><Check size={12} aria-hidden="true" /> Verify</span>
            <span className="lp-btn-mock lp-btn-bad"><X size={12} aria-hidden="true" /> Reject</span>
          </span>
        )}
      </div>
    </div>
  );
}

function Dashboard({ step }: { step: number }) {
  switch (step) {
    case 0:
      return (
        <>
          <p className="lp-scene-label">Inbox</p>
          <div className="lp-row">
            <div className="lp-row-main">
              <strong>Jane Wanjiru</strong>
              <span>Hi, how much is the oak coffee table?</span>
            </div>
            <div className="lp-row-side">
              <span className="lp-pill lp-pill-accent">AI handling</span>
              <span className="lp-chip">whatsapp</span>
            </div>
          </div>
        </>
      );
    case 1:
      return (
        <>
          <p className="lp-scene-label">Products</p>
          <div className="lp-table">
            <div className="lp-table-row lp-table-hit"><span>Oak coffee table</span><span>KES 18,500</span></div>
            <div className="lp-table-row lp-table-hit"><span>Linen cushion cover</span><span>KES 1,750</span></div>
            <div className="lp-table-row"><span>Floor lamp, brass</span><span>KES 9,200</span></div>
          </div>
          <p className="lp-scene-note">The agent reads these before it answers. It offers and quotes only what is in your catalogue.</p>
        </>
      );
    case 2:
      return (
        <>
          <Notice
            title="New order ORD-00042"
            body="Jane Wanjiru ordered Oak coffee table, 2 x Linen cushion cover - KES 22,000. Unpaid."
          />
          <div className="lp-navmock">
            <span className="lp-navmock-item"><ShoppingCart size={14} aria-hidden="true" /> Orders <b className="lp-dot">1</b></span>
            <span className="lp-navmock-item"><FileText size={14} aria-hidden="true" /> Invoices</span>
          </div>
        </>
      );
    case 3:
      return (
        <>
          <Notice
            title="Payment to verify"
            body="Jane Wanjiru says they paid KES 22,000 for ORD-00042 (ref QWE12RT45X)."
          />
          <p className="lp-scene-label">Payments · Awaiting check</p>
          <PaymentRow verified={false} />
        </>
      );
    case 4:
      return (
        <>
          <p className="lp-scene-label">Payments · Awaiting check</p>
          <div className="lp-dialog">
            <strong>Verify this payment?</strong>
            <p>
              Confirm you have checked your account and received KES 22,000 under QWE12RT45X.
              This is recorded against your name.
            </p>
            <div className="lp-dialog-actions">
              <span className="lp-btn-mock">Cancel</span>
              <span className="lp-btn-mock lp-btn-primary lp-pressed">Yes, I received it</span>
            </div>
          </div>
        </>
      );
    default:
      return (
        <>
          <Notice
            title="Payment verified - ORD-00042"
            body="KES 22,000 from Jane Wanjiru was verified. The receipt was sent in the chat and by email."
          />
          <p className="lp-scene-label">Payments · Verified</p>
          <PaymentRow verified />
        </>
      );
  }
}

export function SaleExplainer() {
  const { ref, step, reduced, playing, go, toggle } = useStepper(STEPS.length, 3200);
  const visible = CHAT.filter((m) => m.from <= step);

  return (
    <div className="lp-sale" ref={ref}>
      <div className="lp-sale-stage" role="img" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step].title}. ${STEPS[step].detail}`}>
        {/* The customer's side */}
        <div className="lp-sale-pane">
          <p className="lp-pane-title">The customer&rsquo;s chat</p>
          <div className="lp-chat">
            <div className="lp-chat-inner">
              {visible.map((m, i) => (
                <div key={i} className={`lp-msg lp-msg-${m.who}`}>
                  {m.who === 'agent' && (
                    <span className="lp-msg-meta"><Bot size={11} aria-hidden="true" /> {m.role} agent</span>
                  )}
                  <span className="lp-msg-bubble">{m.text}</span>
                  {m.file && (
                    <span className="lp-msg-file">
                      <img src="/landing/receipt.webp" alt="" width={720} height={748} loading="lazy" decoding="async" />
                      <span>PDF · {m.file}</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* The business's side */}
        <div className="lp-sale-pane">
          <p className="lp-pane-title">Your dashboard</p>
          <div className="lp-scene" key={step}>
            <Dashboard step={step} />
          </div>
        </div>
      </div>

      <ol className="lp-steps">
        {STEPS.map((s, i) => (
          <li key={i} className={i === step ? 'lp-step lp-step-on' : i < step ? 'lp-step lp-step-done' : 'lp-step'}>
            <button type="button" onClick={() => go(i)} aria-current={i === step ? 'step' : undefined}>
              <span className="lp-step-n">{i + 1}</span>
              <span className="lp-step-text">
                <strong>{s.title}</strong>
                <span>{s.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="lp-sale-foot">
        <p>An illustration of the real flow, using the product&rsquo;s own wording and a demo business.</p>
        {!reduced && (
          <button type="button" className="lp-ctl" onClick={toggle}>
            {playing ? <><Pause size={13} aria-hidden="true" /> Pause</> : <><Play size={13} aria-hidden="true" /> Play</>}
          </button>
        )}
      </div>
    </div>
  );
}
