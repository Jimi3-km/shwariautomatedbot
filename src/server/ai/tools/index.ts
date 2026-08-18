import type { Tool } from './types.js';
import {
  getBusinessProfile, updateBusinessProfile,
  listServices, saveService, removeService,
  getOpeningHours, setOpeningHours,
  searchBusinessKnowledge, saveBusinessFact,
  recordKnowledgeGap, listKnowledgeGaps,
} from './business.js';
import { listTeam, configureAgent, activateAgent, setupStatus } from './team.js';
import { delegateToAgent } from './delegate.js';
import {
  listAppointments, bookAppointment, rescheduleAppointment, cancelAppointment,
  recordOrder, listOrders, updateOrderStatus, recordPaymentClaim,
  openTicket, listTickets, updateTicket, escalateToHuman,
  scheduleFollowUp, listFollowUps, cancelFollowUp,
} from './operations.js';
import {
  listProducts, saveProduct, findCustomers, updateCustomer,
  businessMetrics, attentionNeeded,
} from './insight.js';

/**
 * The tool catalogue.
 *
 * Every tool the platform has, in one map. What an individual agent may call is
 * a separate question, answered by its `tools` column and enforced in runTool —
 * so adding a tool here does not silently hand it to anyone.
 */

const ALL: Tool[] = [
  getBusinessProfile, updateBusinessProfile,
  listServices, saveService, removeService,
  getOpeningHours, setOpeningHours,
  searchBusinessKnowledge, saveBusinessFact,
  recordKnowledgeGap, listKnowledgeGaps,
  listTeam, configureAgent, activateAgent, setupStatus, delegateToAgent,
  listAppointments, bookAppointment, rescheduleAppointment, cancelAppointment,
  recordOrder, listOrders, updateOrderStatus, recordPaymentClaim,
  openTicket, listTickets, updateTicket, escalateToHuman,
  scheduleFollowUp, listFollowUps, cancelFollowUp,
  listProducts, saveProduct, findCustomers, updateCustomer,
  businessMetrics, attentionNeeded,
];

export const TOOLS: Map<string, Tool> = new Map(ALL.map((t) => [t.name, t]));

/**
 * The tools an agent actually gets, as the intersection of what it is
 * configured for and what exists. A stale name in the database is inert rather
 * than an error, which is what makes it safe to remove a tool from the code.
 */
export function toolsFor(allowed: string[]): Tool[] {
  return allowed.map((name) => TOOLS.get(name)).filter((t): t is Tool => Boolean(t));
}

export * from './types.js';
