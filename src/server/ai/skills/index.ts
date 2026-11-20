import type { AgentRole } from '../roles.js';
import { MANAGER_SKILL } from './manager.js';
import { SALES_SKILL } from './sales.js';
import { SUPPORT_SKILL } from './support.js';
import { BOOKING_SKILL } from './booking.js';
import { ORDERS_SKILL } from './orders.js';

/**
 * One skill file per agent.
 *
 * A skill is the agent's playbook: for each situation it meets, the exact
 * steps, in order, with the tool for each step and the sentence that ends it.
 * The rules in roles.ts say what must never happen; a skill says how the job
 * is actually done. It is what a new hire is handed on day one.
 *
 * Editing a skill changes how that agent works for every business, so keep
 * each one concrete: a situation, numbered steps, and a worked example of the
 * right and the wrong reply. Things one business wants done differently belong
 * in lessons (teach_team), not here.
 */
export interface Skill {
  /** What this agent is expert at, in one line. */
  expertise: string;
  /** Situation -> ordered steps. */
  procedures: Array<{ when: string; steps: string[] }>;
  /** Right and wrong, side by side. The fastest way to teach tone and action. */
  examples: Array<{ customer: string; wrong: string; right: string }>;
}

export const SKILLS: Record<AgentRole, Skill> = {
  manager: MANAGER_SKILL,
  sales: SALES_SKILL,
  support: SUPPORT_SKILL,
  booking: BOOKING_SKILL,
  orders: ORDERS_SKILL,
};

/** The rule every skill starts from. It is the failure seen most in production. */
export const ACT_DO_NOT_ANNOUNCE = [
  'ACT, DO NOT ANNOUNCE. A reply never says what you are about to do. "Let me check", "I\'ll look at the calendar", "I need to reschedule that, one moment" are forbidden: the customer cannot see you working and will wait for a message that never comes.',
  'If you need to look something up or do something, make the tool call NOW, in this same turn, before you write a single word. Then write the reply, which contains the result.',
  'Every reply ends in one of two states: the thing is done (and you say what happened), or you need one specific thing from them (and you ask for it). Never a promise.',
];

export function skillBlock(role: AgentRole): string {
  const skill = SKILLS[role];
  const lines: string[] = [
    `--- YOUR PLAYBOOK (${skill.expertise}) ---`,
    ...ACT_DO_NOT_ANNOUNCE.map((l) => `- ${l}`),
    '',
  ];
  for (const p of skill.procedures) {
    lines.push(`When ${p.when}:`);
    p.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  }
  lines.push('', 'Examples of the difference:');
  for (const e of skill.examples) {
    lines.push(`  They say: "${e.customer}"`, `    Wrong: "${e.wrong}"`, `    Right: ${e.right}`);
  }
  lines.push('--- end of playbook ---');
  return lines.join('\n');
}
