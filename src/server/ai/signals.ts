import { serviceClient } from '../supabase.js';

/**
 * Reading a customer's behaviour.
 *
 * Every lead gets a score, a temperature and a suggested next step, worked out
 * from what the customer actually said and did. It is deliberately not a model
 * call: it runs on every inbound message, has to be free and instant, and must
 * give the same answer twice. The model's judgement is used where judgement is
 * needed — in the reply — and is handed these signals as a starting point.
 *
 * The vocabulary covers English, Swahili and the Sheng customers really type.
 */

export type Intent =
  | 'buying' | 'booking' | 'pricing' | 'paying' | 'order_status'
  | 'complaint' | 'cancelling' | 'question' | 'greeting';

export type Urgency = 'high' | 'normal' | 'low';
export type Sentiment = 'positive' | 'neutral' | 'frustrated';
export type Temperature = 'hot' | 'warm' | 'cold';

export interface SignalMessage {
  sender: string;
  body: string;
  created_at: string;
}

export interface SignalFacts {
  hasOrder?: boolean;
  hasAppointment?: boolean;
  hasContact?: boolean;
  stage?: string | null;
}

export interface Signals {
  intent: Intent;
  urgency: Urgency;
  sentiment: Sentiment;
  score: number;
  temperature: Temperature;
  objections: string[];
  /** Plain words the agent can act on. */
  next_step: string;
  customer_messages: number;
  hours_since_last_message: number | null;
}

const INTENTS: Array<[Intent, RegExp]> = [
  ['complaint', /\b(complain|complaint|terrible|awful|worst|useless|scam|fraud|disappointed|unacceptable|rude|never again|refund|rudisha pesa|mbaya sana|mmenidanganya|umenidanganya|wezi)\b/i],
  ['cancelling', /\b(cancel|cancellation|call it off|sitaki tena|ghairi|ondoa booking|won'?t make it|can'?t make it)\b/i],
  ['paying', /\b(paid|i have sent|nimetuma|nimelipa|sent the money|payment (made|done|sent)|mpesa code|m-pesa code|transaction code|till|paybill|how (do|can) i pay|nilipe (aje|vipi)|lipa (aje|vipi)|malipo)\b/i],
  ['order_status', /\b(where is my (order|parcel|package|delivery)|track(ing)?|order status|has it (shipped|been sent)|imefika|itafika lini|delivery (time|status)|when will (it|my order) (arrive|come|be delivered))\b/i],
  ['buying', /\b(i('?ll| will) take|i want to (buy|order)|i('?d| would) like to (buy|order)|place an order|order (one|two|\d+)|add to (cart|order)|nataka kununua|nitachukua|nipe (moja|mbili)|niwekee|buy (it|this|one|now)|ready to (buy|order)|let'?s do it|deal)\b/i],
  ['booking', /\b(book|booking|appointment|reserve|reservation|schedule|slot|available (on|at|tomorrow|today)|consultation|nataka (kuja|appointment|booking)|niwekee appointment|naweza kuja|nafasi (iko|ipo)|reschedul\w*|move my)\b/i],
  ['pricing', /\b(how much|price|pricing|cost|rate|rates|charges?|fee|quote|quotation|discount|offer|bei|ngapi|pesa ngapi|ni how much|bei gani|punguza)\b/i],
  ['greeting', /^\s*(hi|hello|hey|habari|jambo|sasa|niaje|mambo|vipi|good (morning|afternoon|evening)|salaam|hujambo|uko)\b[\s!.,?]*$/i],
];

const URGENT = /\b(urgent|asap|right now|immediately|today|tonight|now now|haraka|saa hii|leo|emergency|as soon as possible|sasa hivi)\b/i;
const SOON = /\b(tomorrow|kesho|this week|wiki hii|weekend)\b/i;
const NOT_SOON = /\b(next month|next year|later|someday|just (looking|checking|asking|browsing)|naangalia tu|nauliza tu|baadaye|mwezi ujao|not sure yet|thinking about it|nitafikiria)\b/i;

const POSITIVE = /\b(thanks|thank you|asante|shukran|great|perfect|awesome|nice|poa|sawa|safi|fiti|love it|sounds good|wonderful|excellent)\b/i;
const FRUSTRATED = /\b(still waiting|no one (is )?(replying|answering)|ignored|ignoring|frustrat\w*|annoy\w*|angry|upset|waste of time|third time|again\?|hamjibu|mnachelewa|nimechoka|what is taking|why (is|are) (it|you) (so )?(slow|late))\b|\?{3,}/i;
/** Shouting: a run of capitals followed by ! or ?. Case matters, so it is separate. */
const SHOUTING = /[A-Z]{6,}.*[!?]/;

const OBJECTIONS: Array<[string, RegExp]> = [
  ['price', /\b(too expensive|too much|too high|expensive|can'?t afford|ghali|bei (iko )?juu|punguza|discount|cheaper|nafuu|budget)\b/i],
  ['timing', /\b(not now|later|next month|busy|no time|baadaye|sina time|another time|will get back)\b/i],
  ['trust', /\b(is (this|it) (legit|real|genuine|safe)|scam|how do i know|proof|reviews?|guarantee|warranty|uhakika|ni ukweli)\b/i],
  ['needs_approval', /\b(ask my (wife|husband|boss|partner|parents)|need to (check|confirm|consult)|niulize|nitaongea na)\b/i],
  ['comparing', /\b(other (shops?|places?|options?)|comparing|competitor|elsewhere|kwingine|shop around)\b/i],
];

const CONTACT = /(\+?\d[\d\s-]{8,}\d)|([\w.+-]+@[\w-]+\.[\w.]+)/;

export function detectIntent(text: string): Intent {
  for (const [intent, pattern] of INTENTS) if (pattern.test(text)) return intent;
  return 'question';
}

/**
 * Work out the signals from a transcript.
 *
 * `messages` is oldest first. Only the customer's own words count towards
 * intent and sentiment; the agent's replies only matter for who spoke last.
 */
export function readSignals(messages: SignalMessage[], facts: SignalFacts = {}, now = Date.now()): Signals {
  const theirs = messages.filter((m) => m.sender === 'customer' && typeof m.body === 'string' && m.body.trim());
  const recent = theirs.slice(-6);
  const latest = recent[recent.length - 1]?.body ?? '';
  const joined = recent.map((m) => m.body).join('\n');

  // The latest message decides the intent unless it is a bare greeting or a
  // one-word reply, in which case what they were talking about still stands.
  let intent = detectIntent(latest);
  if ((intent === 'greeting' || intent === 'question') && recent.length > 1) {
    for (let i = recent.length - 2; i >= 0; i--) {
      const earlier = detectIntent(recent[i].body);
      if (earlier !== 'greeting' && earlier !== 'question') { intent = earlier; break; }
    }
  }

  const sentiment: Sentiment =
    FRUSTRATED.test(latest) || SHOUTING.test(latest) || detectIntent(latest) === 'complaint' ? 'frustrated'
      : POSITIVE.test(latest) ? 'positive' : 'neutral';

  const urgency: Urgency = URGENT.test(joined) ? 'high' : NOT_SOON.test(latest) ? 'low' : 'normal';

  const objections = OBJECTIONS.filter(([, p]) => p.test(joined)).map(([name]) => name);

  const lastAt = theirs.length ? Date.parse(theirs[theirs.length - 1].created_at) : NaN;
  const hoursSince = Number.isFinite(lastAt) ? Math.max(0, (now - lastAt) / 3_600_000) : null;

  // --- score ---------------------------------------------------------------
  let score = 10;
  const intentWeight: Record<Intent, number> = {
    buying: 40, paying: 45, booking: 35, pricing: 22, order_status: 15,
    question: 10, greeting: 4, cancelling: -10, complaint: -5,
  };
  score += intentWeight[intent];
  score += Math.min(theirs.length, 8) * 3;                 // engagement
  if (urgency === 'high') score += 12;
  else if (SOON.test(joined)) score += 6;
  if (urgency === 'low') score -= 10;
  if (facts.hasContact || CONTACT.test(joined)) score += 8; // gave us a way to reach them
  if (facts.hasAppointment) score += 15;
  if (facts.hasOrder) score += 20;
  if (sentiment === 'positive') score += 4;
  if (sentiment === 'frustrated') score -= 8;
  score -= objections.length * 5;
  if (hoursSince !== null) {
    if (hoursSince > 24 * 14) score -= 30;
    else if (hoursSince > 24 * 3) score -= 18;
    else if (hoursSince > 24) score -= 8;
  }
  if (facts.stage === 'lost') score = Math.min(score, 15);
  score = Math.max(0, Math.min(100, Math.round(score)));

  const temperature: Temperature = score >= 60 ? 'hot' : score >= 30 ? 'warm' : 'cold';

  return {
    intent, urgency, sentiment, score, temperature, objections,
    next_step: nextStep(intent, sentiment, objections, facts),
    customer_messages: theirs.length,
    hours_since_last_message: hoursSince === null ? null : Math.round(hoursSince * 10) / 10,
  };
}

function nextStep(intent: Intent, sentiment: Sentiment, objections: string[], facts: SignalFacts): string {
  if (sentiment === 'frustrated' || intent === 'complaint') {
    return 'Acknowledge the frustration first, fix what you can, and bring a person in if it is not solved in this message.';
  }
  if (intent === 'cancelling') return 'Confirm exactly what they want cancelled, do it if it is theirs, and leave the door open without pushing.';
  if (intent === 'paying') return 'Give the payment steps exactly, or take down what they say they paid so a colleague can verify it.';
  if (intent === 'order_status') return 'Look up their order and tell them precisely where it is.';
  if (intent === 'buying') return 'They are ready. Confirm the item and details, then record the order now rather than asking more questions.';
  if (intent === 'booking') {
    return facts.hasAppointment
      ? 'They already have a booking. Check whether this is a change to it or a new one.'
      : 'Offer two specific free times and book the one they pick.';
  }
  if (objections.includes('price')) return 'Do not argue the price. Say what is included, mention a cheaper option only if one exists, and offer a next step.';
  if (objections.includes('trust')) return 'Reassure with real facts you can look up - location, hours, how payment is verified - never with invented claims.';
  if (objections.includes('needs_approval') || objections.includes('timing')) {
    return 'Do not push. Offer to check back at a time that suits them, and queue one follow-up if they agree.';
  }
  if (intent === 'pricing') return 'Give the price you looked up, then ask one question that moves them forward - when they need it, or which option suits.';
  if (intent === 'greeting') return 'Greet them back briefly and find out what they need.';
  return 'Answer the question, then offer one natural next step.';
}

/** The lines an agent is shown about the person it is talking to. */
export function signalsBlock(s: Signals): string {
  const parts = [
    `Lead reading: ${s.temperature} (${s.score}/100). They seem to be ${describeIntent(s.intent)}`,
    s.urgency === 'high' ? 'and it is urgent for them' : s.urgency === 'low' ? 'and are in no hurry' : '',
    s.sentiment === 'frustrated' ? '- they sound frustrated' : '',
  ].filter(Boolean).join(' ') + '.';
  const lines = [parts];
  if (s.objections.length) lines.push(`Hesitations so far: ${s.objections.join(', ').replace(/_/g, ' ')}.`);
  lines.push(`Suggested next step: ${s.next_step}`);
  lines.push('This reading is a guide worked out from their messages. If what they just said contradicts it, trust what they said.');
  return lines.join('\n');
}

function describeIntent(intent: Intent): string {
  switch (intent) {
    case 'buying': return 'ready to buy';
    case 'booking': return 'trying to book';
    case 'pricing': return 'comparing prices';
    case 'paying': return 'sorting out payment';
    case 'order_status': return 'chasing an order';
    case 'complaint': return 'unhappy about something';
    case 'cancelling': return 'looking to cancel';
    case 'greeting': return 'just saying hello';
    default: return 'asking a question';
  }
}

/** Stages an agent's reading may move a lead through on its own. */
const AUTO_STAGES = new Set(['new', 'contacted', 'interested']);

/** Has the migration that adds score/temperature/behaviour been applied? */
let scoreColumns = true;

/**
 * Read a conversation's signals and write them onto its lead.
 *
 * Never throws: scoring is a by-product of answering a customer and must not
 * be able to break the answer.
 */
export async function recordSignals(tenantId: string, conversationId: string): Promise<Signals | null> {
  try {
    const { data: conv } = await serviceClient
      .from('conversations')
      .select('lead_id')
      .eq('tenant_id', tenantId)
      .eq('id', conversationId)
      .maybeSingle();

    const { data: msgs } = await serviceClient
      .from('conversation_messages')
      .select('sender, body, created_at')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(30);

    const messages = (Array.isArray(msgs) ? msgs : []).slice().reverse() as SignalMessage[];
    if (!messages.length) return null;

    const leadId = (conv as { lead_id?: number | null } | null)?.lead_id ?? null;
    let facts: SignalFacts = {};
    let lead: { stage?: string | null; phone?: string | null; email?: string | null } | null = null;

    if (leadId !== null) {
      const [{ data: leadRow }, { data: orders }, { data: appts }] = await Promise.all([
        serviceClient.from('leads').select('stage, phone, email').eq('tenant_id', tenantId).eq('id', leadId).maybeSingle(),
        serviceClient.from('orders').select('id').eq('tenant_id', tenantId).eq('lead_id', leadId).limit(1),
        serviceClient.from('appointments').select('id').eq('tenant_id', tenantId).eq('lead_id', leadId).neq('status', 'cancelled').limit(1),
      ]);
      lead = leadRow as typeof lead;
      facts = {
        stage: lead?.stage ?? null,
        hasContact: Boolean(lead?.phone || lead?.email),
        hasOrder: Array.isArray(orders) && orders.length > 0,
        hasAppointment: Array.isArray(appts) && appts.length > 0,
      };
    }

    const signals = readSignals(messages, facts);
    if (leadId === null) return signals;

    const patch: Record<string, unknown> = {
      intent: signals.intent,
      urgency: signals.urgency,
      updated_at: new Date().toISOString(),
    };
    // A lead that has shown real interest stops being "new" without anyone
    // having to remember to move it. Never backwards, and never into a stage
    // that means money changed hands.
    const stage = lead?.stage ?? 'new';
    if (AUTO_STAGES.has(stage)) {
      const earned =
        signals.intent === 'buying' || signals.intent === 'booking' || signals.intent === 'pricing' || signals.intent === 'paying'
          ? 'interested'
          : stage === 'new' && signals.customer_messages > 0 ? 'contacted' : stage;
      const order = ['new', 'contacted', 'interested'];
      if (order.indexOf(earned) > order.indexOf(stage)) patch.stage = earned;
    }

    const full = {
      ...patch,
      score: signals.score,
      temperature: signals.temperature,
      behaviour: {
        sentiment: signals.sentiment,
        objections: signals.objections,
        next_step: signals.next_step,
        customer_messages: signals.customer_messages,
        read_at: new Date().toISOString(),
      },
    };

    const write = (body: Record<string, unknown>) =>
      serviceClient.from('leads').update(body).eq('tenant_id', tenantId).eq('id', leadId);

    if (scoreColumns) {
      const { error } = await write(full);
      if (!error) return signals;
      // PGRST204 / 42703: the columns are not there yet (migration 0020).
      if (error.code !== 'PGRST204' && error.code !== '42703') {
        console.warn('[signals] could not save the lead reading:', error.message);
        return signals;
      }
      scoreColumns = false;
      console.warn('[signals] leads.score is not available yet (migration 0020); saving intent and urgency only');
    }
    const { error } = await write(patch);
    if (error) console.warn('[signals] could not save the lead reading:', error.message);
    return signals;
  } catch (e) {
    console.warn('[signals] reading failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Payment proof
// ---------------------------------------------------------------------------

export interface PaymentProof {
  code: string;
  amount: number | null;
  method: string | null;
}

const PAID_WORDS = /\b(confirmed|sent to|paid|payment|nimetuma|nimelipa|nimeshalipa|imetumwa|transaction|m-?pesa|receipt|ref(?:erence)?)\b/i;

/**
 * Read a payment confirmation out of a customer's message.
 *
 * A forwarded M-Pesa text looks like "UJJ66AH7ZZ Confirmed. Ksh6,500.00 sent
 * to ...". The code is a run of capitals and digits containing both; the
 * amount follows Ksh/KES. Returns null unless the message really looks like
 * proof of payment, so an order reference or a product code is not mistaken
 * for one.
 */
export function readPaymentProof(text: string): PaymentProof | null {
  const t = (text ?? '').trim();
  if (!t || !PAID_WORDS.test(t)) return null;

  const codes = t.match(/\b[A-Z0-9]{8,12}\b/g) ?? [];
  const code = codes.find((c) => /[A-Z]/.test(c) && /\d/.test(c) && !/^(?:KES|KSH)\d+$/.test(c));
  if (!code) return null;
  // An order reference such as KRY-MWOK26TP is not a payment code.
  if (new RegExp(`[A-Z]{2,5}-${code}\\b`).test(t)) return null;

  const money = t.match(/\b(?:ksh|kes|kshs|sh)\.?\s?([\d,]+(?:\.\d{1,2})?)/i);
  const amount = money ? Number(money[1].replace(/,/g, '')) : NaN;

  return {
    code,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    method: /m-?pesa|confirmed\.|sent to/i.test(t) ? 'M-Pesa' : null,
  };
}
