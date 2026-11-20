import { ToolInputError, str, oneOf, type Tool } from './types.js';
import { TEAM_ROLES, AGENT_BLUEPRINTS, type AgentRole } from '../roles.js';

/**
 * Handing work to a department.
 *
 * This actually runs the other agent. It is not a note to a queue and not a
 * description of what would happen: the department takes its own turn, with its
 * own rules and its own tools, and whatever it did comes back to Shwari to
 * report. Its tool calls are audited under its own role, so the trail shows
 * which department did the work rather than crediting it all to the manager.
 *
 * The circular import is deliberate and unavoidable — the runtime owns the loop
 * and this tool needs it — so the import is deferred to call time rather than
 * pulled in at module load.
 */

/**
 * Everyone Shwari directs, which is wider than the departments a customer can
 * be routed to: marketing takes jobs here and nowhere else.
 */
const DELEGATABLE = TEAM_ROLES as readonly AgentRole[];

export const delegateToAgent: Tool = {
  name: 'delegate_to_agent',
  description:
    'Hand a job to one of the team and get back what they did. Use it when the work sits squarely with one of them — a diary question for bookings, an order or payment for orders, a complaint for support, a pricing or product question for sales, planning the week\'s posts or checking and fixing captions for marketing. Marketing cannot approve posts: that stays with you, on the owner\'s word. For a single quick action you can already do yourself, just do it.',
  parameters: {
    type: 'object',
    properties: {
      department: {
        type: 'string',
        enum: [...DELEGATABLE],
        description: 'Who should handle this.',
      },
      task: {
        type: 'string',
        description:
          'What you want done, written as you would say it to a colleague. Include everything they need — they cannot see your conversation with the owner.',
      },
    },
    required: ['department', 'task'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    if (ctx.agentRole !== 'manager') {
      // Departments answer customers; they do not run each other. Without this
      // an agent could reach capabilities it was deliberately not given.
      throw new ToolInputError('Only Shwari hands work to a department.');
    }

    const department = oneOf(args, 'department', DELEGATABLE, null);
    const task = str(args, 'task', { required: true, max: 2000 });

    const { runAgentTurn, AgentUnavailableError } = await import('../agent.js');

    try {
      const turn = await runAgentTurn({
        tenantId: ctx.tenantId,
        role: department,
        userId: ctx.userId,
        // The department acts in the same conversation the manager is in, which
        // for the dashboard is none — so anything needing a customer must be
        // told which one, exactly as the manager would have to be.
        conversationId: ctx.conversationId,
        text: task,
        // A fresh thread. The department is doing a job, not joining a
        // conversation it was not part of.
        history: [],
      });

      return {
        department,
        reported: turn.reply,
        did: turn.actions,
      };
    } catch (e) {
      if (e instanceof AgentUnavailableError) {
        // Off, or - for a role newer than the database - not set up yet. Either
        // way the job was not done, and the manager has to say so or do it.
        throw new ToolInputError(
          `${AGENT_BLUEPRINTS[department].defaultName} is not available: it is switched off on the AI team page, or not set up on this workspace yet. Nothing was done. Tell the owner, or do the job yourself if you hold the tools for it.`
        );
      }
      throw e;
    }
  },
};
