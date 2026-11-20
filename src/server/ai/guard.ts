/**
 * The behaviour check.
 *
 * A reply is read before it is sent, by code rather than by another model, for
 * the handful of things that must never reach a customer:
 *
 *   - saying something was booked, ordered, changed or cancelled when no tool
 *     did it this turn
 *   - telling a customer their payment has arrived
 *   - internal names leaking out ("save them with save_customer_details")
 *   - raw data instead of a sentence
 *
 * When a draft fails, the agent is told why and gets one chance to do the work
 * or correct itself. If the second draft still fails, the claim is replaced
 * with an honest holding line rather than sent.
 *
 * `humanizeReply` is the gentler half: it fits a reply to the channel it is
 * going out on, because markdown that renders in the dashboard arrives on
 * WhatsApp as asterisks.
 */

export type ReplyIssue =
  | 'unbacked_action' | 'confirms_payment' | 'leaks_internals' | 'raw_data'
  | 'no_work_done' | 'unverified_state' | 'stalling' | 'ungrounded';

export interface ReplyCheckInput {
  reply: string;
  /** Every tool that succeeded this turn, reads included. */
  okTools: string[];
  /** Every tool name the platform has, for spotting leaks. */
  toolNames: string[];
  customerFacing: boolean;
  /** What the person asked for, so "asked for work, did none" can be caught. */
  request?: string;
  /**
   * Tools the agent itself chose to call. A claim such as "I've booked you in"
   * has to rest on these: records read for it before the turn started prove
   * nothing about what it did. Defaults to okTools.
   */
  actedTools?: string[];
}

export interface ReplyCheck {
  ok: boolean;
  issues: ReplyIssue[];
  /** What to tell the agent, in its own terms. */
  feedback: string;
}

/** A claim, and the tools any one of which makes it true. */
const ACTION_CLAIMS: Array<{ pattern: RegExp; backedBy: string[]; what: string }> = [
  {
    what: 'a booking',
    pattern: /\b(?:i(?:'ve| have)|we(?:'ve| have)|i just|i|we)\s+(?:now\s+|just\s+|successfully\s+|gone ahead and\s+)?(?:booked|scheduled|reserved|pencilled|rescheduled|moved your (?:appointment|booking))\b|\b(?:your|the|an?|this) (?:appointment|booking|consultation|slot|session)\b[^.!?\n]{0,40}?\b(?:is|has been|was|have been) (?:now\s+|successfully\s+)?(?:booked|confirmed|scheduled|reserved|set|moved|rescheduled)\b|\byou(?:'re| are) (?:all\s+)?(?:booked|booked in|confirmed|set) for\b|\bnimeku(?:wekea|book)\w*/i,
    backedBy: ['book_appointment', 'reschedule_appointment', 'list_appointments', 'get_customer_history', 'delegate_to_agent'],
  },
  {
    what: 'a cancellation',
    pattern: /\b(?:i(?:'ve| have)|we(?:'ve| have)|i just|i|we)\s+(?:now\s+|just\s+|successfully\s+|gone ahead and\s+)?cancell?ed\b|\byour (?:appointment|booking|order) (?:is|has been|was) (?:now\s+)?cancell?ed\b/i,
    backedBy: ['cancel_appointment', 'update_order_status', 'list_appointments', 'list_orders', 'get_customer_history', 'delegate_to_agent'],
  },
  {
    what: 'an order',
    pattern: /\b(?:i(?:'ve| have)|we(?:'ve| have)|i just|i|we)\s+(?:now\s+|just\s+|successfully\s+|gone ahead and\s+)?(?:placed|recorded|created|put through|logged) (?:your|the|an) order\b|\byour order (?:is|has been|was) (?:now\s+)?(?:placed|recorded|confirmed|created)\b/i,
    backedBy: ['record_order', 'list_orders', 'update_order_status', 'get_customer_history', 'delegate_to_agent'],
  },
  {
    what: 'a payment being noted for verification',
    pattern: /\b(?:i(?:'ve| have)|we(?:'ve| have)|i just|i|we)\s+(?:now\s+|just\s+|successfully\s+|also\s+)?(?:recorded|noted|logged|saved|passed (?:on|along)|forwarded|submitted|added)\b[^.!?\n]{0,60}\b(?:payment|transaction|code|reference|ref|mpesa|m-pesa|it for (?:order|our team|verification))\b|\b(?:payment|transaction code|code|reference)\b[^.!?\n]{0,40}\b(?:has been|is|was) (?:now\s+)?(?:recorded|noted|logged|submitted|added)\b|\bnime(?:rekodi|andika|pokea)\w*/i,
    backedBy: ['record_payment_claim', 'delegate_to_agent'],
  },
  {
    what: 'handing over to a person',
    pattern: /\b(?:i(?:'ve| have)|i just|i)\s+(?:now\s+|just\s+)?(?:escalated|handed (?:this|you|it) over|passed (?:this|you|it) (?:on|over) to|opened a ticket|raised a ticket|flagged (?:this|it) (?:to|for))\b/i,
    backedBy: ['escalate_to_human', 'open_ticket', 'list_tickets', 'update_ticket', 'delegate_to_agent'],
  },
  {
    what: 'a follow-up',
    pattern: /\b(?:i(?:'ve| have)|i just|i)\s+(?:now\s+|just\s+)?(?:set|scheduled|queued) (?:a|your) (?:reminder|follow[- ]?up)\b/i,
    backedBy: ['schedule_follow_up', 'list_follow_ups', 'delegate_to_agent'],
  },
];

const PAYMENT_CONFIRMED =
  /\b(?:payment|deposit|transfer|money|m-?pesa|funds|pesa|malipo)\b[^.!?\n]{0,60}\b(?:received|confirmed|verified|cleared|gone through|came through|reflected|imefika|imeingia)\b|\b(?:received|confirmed|verified) your (?:payment|deposit|transfer)\b|\byour order is (?:now\s+)?(?:paid|fully paid)\b/i;

/** A sentence that only promises a check is not a confirmation. */
const NOT_A_CONFIRMATION =
  /\b(?:will|once|after|when|until|not yet|hasn'?t|haven'?t|isn'?t|aren'?t|cannot|can'?t|n't|shortly|soon|a colleague|someone|our team|the team|accounts|verify|verifies|to be|if)\b|\?/i;

const INTERNAL_WORDS = /\b(?:(?:reschedul\w*|booking|calendar|order|lookup|search|cancel\w*) tool|use (?:a|the|my) tool|lead_id|customer_id|tenant_id|conversation_id|tool call|tool_call|function call|JSON|system prompt|my instructions|database (?:table|row|column)|schema)\b/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Announcing work instead of doing it: "Let me check the calendar", "I'll
 * reschedule that now", "I need to use the reschedule tool". The turn ends
 * there, nothing happens, and the customer waits for a message that never
 * comes.
 */
const ANNOUNCES =
  /\b(?:let me|lemme|i'?ll|i will|i'?m going to|i am going to|i need to|i have to|allow me to|i'?m (?:just )?(?:checking|looking|going)|i am (?:just )?(?:checking|looking)|nita|wacha ni|ngoja ni)\s*(?:just\s+|quickly\s+|now\s+|go ahead and\s+|first\s+)?(?:check|look|see|verify|confirm|find out|pull up|search|review|reschedul\w*|book|move|cancel|update|record|place|process|do that|do it|use|get (?:that|this|it)|sort|arrange|angalia|cheki)\b|\b(?:one moment|just a (?:moment|sec|second|minute)|give me a (?:moment|sec|second|minute)|hold on|bear with me|please wait|subiri kidogo|ngoja kidogo)\b/i;

/** A promise that properly waits on the customer is not a stall. */
const WAITS_ON_THEM = /\b(?:once|after|when|if|as soon as|unless)\s+(?:you|we|i (?:have|get|receive)|that|it|your)\b|\bwould you like\b|\bshall i\b|\bdo you want\b/i;

/** Facts that can only come from the business's records. */
const STATES_BUSINESS_FACTS =
  /\b(?:kes|ksh|kshs|sh|shillings?|usd|\$)\s?\d|\b\d{1,3}(?:,\d{3})+\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b(?:available|availability|free slot|in stock|out of stock)\b|\bwe (?:have|sell|offer|stock|do|provide)\b|\bwe (?:don'?t|do not) (?:have|sell|offer|stock|do|provide)\b|\b(?:is|are) (?:not )?(?:listed|offered)\b|\bwe(?:'re| are) open\b|\b(?:tuna|tuko na|hatuna)\b/i;

/** An instruction to change or look something up, as opposed to chat. */
const ASKS_FOR_WORK =
  /^\s*(?:please\s+|can you\s+|could you\s+|kindly\s+|i want you to\s+|go ahead and\s+)?(?:add|create|make|set|setup|set up|save|update|change|edit|rename|delete|remove|clear|archive|rebuild|replace|build|configure|book|cancel|reschedule|move|record|send|queue|schedule|turn|switch|enable|disable|activate|fix|list|show|check|find|look up|what(?:'s| is| are)|how many|which|who)\b/i;

/** Saying how things stand - counts, or that something is not there. */
const STATES_FACTS =
  /\b(?:\d+|ten|nine|eight|seven|six|five|four|three|two|twenty|a dozen)\s+(?:new\s+)?(?:products?|services?|items?|appointments?|orders?|customers?|leads?)\b|\b(?:do(?:es)?n'?t|do(?:es)? not|no longer|aren'?t|isn'?t|are not|is not) (?:exist|there|listed|in the (?:catalog|catalogue|system|list))\b|\b(?:fully|completely|all) (?:rebuilt|set up|updated|deleted|removed|done)\b|\b(?:has been|have been|is now|are now|was|were) (?:successfully\s+)?(?:saved|added|deleted|removed|updated|set|created)\b/i;

const WRITES = /^(?:save|remove|set|update|book|cancel|reschedule|record|open|schedule|message|configure|activate|teach|forget|delegate|escalate)/;

export function checkReply(input: ReplyCheckInput): ReplyCheck {
  const { reply, okTools, toolNames, customerFacing } = input;
  const issues: ReplyIssue[] = [];
  const notes: string[] = [];
  const did = new Set(input.actedTools ?? okTools);

  // Announcing instead of acting. A read does not excuse it: with the diary
  // already in hand, "let me check the diary" is still a customer left waiting.
  const wrote = okTools.some((t) => WRITES.test(t) || t === 'hand_to_department');
  const stalled = sentences(reply).some((s) => ANNOUNCES.test(s) && !WAITS_ON_THEM.test(s));
  if (stalled && !wrote) {
    issues.push('stalling');
    notes.push(
      'Your draft tells them you are about to check or do something, and then stops. They cannot see you working and nothing will happen after this message. ' +
      'Do it NOW with a tool call, in this turn, and reply with the result. If the information is already in the results above, use it and answer. ' +
      'If you truly cannot act without something from them, ask for that one thing instead. Never write "let me", "I\'ll check" or "one moment".'
    );
  }

  // A price, a time, or what is and is not offered, stated to a customer with
  // nothing read from the business's records in this turn.
  if (customerFacing && !okTools.length && STATES_BUSINESS_FACTS.test(reply)) {
    issues.push('ungrounded');
    notes.push(
      'Your draft states prices, times, availability or what the business offers, but you read nothing from its records in this turn - so it comes from memory or from earlier messages and may be wrong. ' +
      'Read it now with the right tool (the products, the services, the diary, the opening hours) and answer from what comes back.'
    );
  }

  // The owner asked for something and the reply talks as if it happened, yet
  // nothing was looked up or changed in this turn.
  if (!customerFacing && input.request !== undefined) {
    const request = input.request.trim();
    if (!okTools.length && ASKS_FOR_WORK.test(request) && request.split(/\s+/).length >= 2) {
      issues.push('no_work_done');
      notes.push(
        'You were asked to do or look up something and you used no tool in this turn, so anything you say about the business is a guess. ' +
        'Use the right tool now: read first if you need to, then make the change, then report what the result says.'
      );
    } else if (STATES_FACTS.test(reply)) {
      const changed = okTools.some((t) => WRITES.test(t));
      const claimsChange = /\b(?:has been|have been|is now|are now|was|were) (?:successfully\s+)?(?:saved|added|deleted|removed|updated|set|created)\b|\b(?:fully|completely|all) (?:rebuilt|set up|updated|deleted|removed|done)\b/i.test(reply);
      if (!okTools.length || (claimsChange && !changed)) {
        issues.push('unverified_state');
        notes.push(
          'Your draft states how things stand - counts, that something exists or does not, or that a change was made - without anything in this turn to support it. ' +
          'Check with a tool (list the products or services, read the setting), make any change that is still outstanding, and report only what the results show.'
        );
      }
    }
  }

  for (const claim of ACTION_CLAIMS) {
    if (!claim.pattern.test(reply)) continue;
    if (claim.backedBy.some((t) => did.has(t))) continue;
    issues.push('unbacked_action');
    notes.push(
      `Your draft says ${claim.what} was done, but nothing you did in this turn did it. ` +
      'Either do it now with the right tool and then say so, or say honestly what still has to happen.'
    );
    break;
  }

  if (customerFacing) {
    const confirming = sentences(reply).some((s) => PAYMENT_CONFIRMED.test(s) && !NOT_A_CONFIRMATION.test(s));
    if (confirming) {
      issues.push('confirms_payment');
      notes.push(
        'Your draft tells the customer their payment has arrived. You cannot know that: a person verifies every payment. ' +
        'Say you have noted it and a colleague will confirm.'
      );
    }
  }

  const leakedTool = toolNames.find((name) => name.includes('_') && reply.includes(name));
  if (leakedTool || INTERNAL_WORDS.test(reply)) {
    issues.push('leaks_internals');
    notes.push(
      'Your draft mentions internal names or system details. The person you are talking to should only ever read plain language ' +
      '- say what you need or what you did, never how it works behind the scenes.'
    );
  }

  const trimmed = reply.trim();
  if (/^[\[{]/.test(trimmed) || /"\w+"\s*:\s*["{\[\d]/.test(trimmed) || /<\/?tool_call>|<function=|<parameter=/i.test(trimmed)) {
    issues.push('raw_data');
    notes.push('Your draft is raw data. Write it as a short, natural message instead.');
  }

  return {
    ok: issues.length === 0,
    issues,
    feedback: notes.join('\n'),
  };
}

/** The note the agent is shown when its draft was held back. */
export function correctionMessage(check: ReplyCheck): string {
  return [
    '[Internal quality check - this is not from the customer and they have not seen your draft.]',
    'Your draft was not sent because:',
    check.feedback,
    'Now either use the right tool to actually do it, or write a corrected message. Reply with only the message to send.',
  ].join('\n');
}

/** Sent when a claim still cannot be backed after a second attempt. */
export function honestHoldingReply(issues: ReplyIssue[], customerFacing: boolean): string {
  if (issues.includes('confirms_payment')) {
    return "Thanks - I've noted that. A colleague checks every payment and will confirm it with you shortly.";
  }
  if (customerFacing && (issues.includes('stalling') || issues.includes('ungrounded'))) {
    return "Sorry, I couldn't get that done on my side just now. Could you send that once more? I'll sort it out straight away.";
  }
  if (issues.includes('no_work_done') || issues.includes('unverified_state') || issues.includes('stalling')) {
    return "I haven't been able to confirm that yet, so I won't tell you it's done. Ask me once more and I'll check what is actually saved and finish whatever is left.";
  }
  return customerFacing
    ? "I want to get this exactly right, and I haven't been able to complete it just yet. Could you confirm the details once more, and I'll sort it out straight away?"
    : "I haven't actually completed that yet - something stopped it. Tell me once more what you'd like done and I'll do it now.";
}

// ---------------------------------------------------------------------------
// Fitting the reply to the channel
// ---------------------------------------------------------------------------

/** Channels that render markdown. Everything else shows the symbols. */
const RENDERS_MARKDOWN = new Set(['dashboard']);

const STOCK_OPENERS = [
  /^(?:certainly|absolutely|of course|sure thing|great question|i(?:'d| would) be (?:happy|glad|delighted) to (?:help|assist)(?: you)?(?: with that)?)[!.,]\s*/i,
  /^as an? (?:ai|artificial intelligence|language model|virtual assistant)[^.!?\n]*[.!?,]\s*/i,
  /^i hope this (?:message|email) finds you well[.!,]\s*/i,
];

const STOCK_CLOSERS = [
  /\s*(?:please )?(?:do not|don'?t) hesitate to (?:reach out|contact us|ask)[^.!?\n]*[.!?]?\s*$/i,
  /\s*is there anything else (?:i can|i may|we can) (?:help|assist) you with(?: today)?\??\s*$/i,
  /\s*(?:i hope|hope) (?:this|that) helps[.!]?\s*$/i,
  /\s*let me know if you (?:have|need) any(?: other| further| more)? (?:questions|help|assistance|information)[^.!?\n]*[.!?]?\s*$/i,
];

export interface HumanizeOptions {
  channelType?: string | null;
  toolNames?: string[];
}

/**
 * Tidy a reply for sending. Never changes what it says: only removes the
 * formatting a chat app would show literally, the stock phrases that make a
 * message read like a form letter, and any internal name that survived the
 * behaviour check.
 */
export function humanizeReply(text: string, opts: HumanizeOptions = {}): string {
  let out = (text ?? '').trim();
  if (!out) return out;

  // Internal names never go out, whatever else happened.
  for (const name of opts.toolNames ?? []) {
    if (!name.includes('_') || !out.includes(name)) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`\\s*(?:with|using|via|through|by (?:calling|using|running))\\s+(?:the\\s+)?\`?${escaped}\`?(?:\\s+tool)?`, 'gi'), '')
      .replace(new RegExp(`\`?${escaped}\`?`, 'g'), name.replace(/_/g, ' '));
  }

  const chat = !RENDERS_MARKDOWN.has(String(opts.channelType ?? ''));
  if (chat) {
    out = out
      .replace(/```[a-z]*\n?([\s\S]*?)```/g, '$1')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1$2')
      .replace(/^\s*[*•]\s+/gm, '- ')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2')
      .replace(/^\s*\|?[-: |]{5,}\|?\s*$/gm, '');
  }

  for (const opener of STOCK_OPENERS) {
    const next = out.replace(opener, '');
    if (next !== out && next.trim().length > 12) {
      out = next.charAt(0).toUpperCase() + next.slice(1);
    }
  }
  for (const closer of STOCK_CLOSERS) {
    const next = out.replace(closer, '');
    if (next.trim().length > 12) out = next;
  }

  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim();
}
