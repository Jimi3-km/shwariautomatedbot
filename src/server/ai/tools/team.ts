import { serviceClient } from '../../supabase.js';
import { ToolInputError, str, oneOf, type Tool } from './types.js';
import { AGENT_BLUEPRINTS, DEPARTMENTS, type AgentRole } from '../roles.js';

/**
 * Tools for shaping the AI team.
 *
 * The hard line in this file: Shwari may configure the *other* agents, and may
 * take its own name and tone from the owner, but it can never edit its own
 * tools, permissions or status. A manager that could grant itself a capability
 * is not a manager, it is an escalation path — so the guard lives in the tool
 * rather than in a prompt the model could be talked out of.
 */

/**
 * Departments the owner may re-word or switch off. The manager is absent on
 * purpose: it directs the others, and something that could reconfigure itself
 * would not be a manager.
 */
const CONFIGURABLE_ROLES: AgentRole[] = [...DEPARTMENTS];

export const listTeam: Tool = {
  name: 'list_team',
  description:
    'List this business\'s five agents, what each is for, and whether it is live. Call this before changing anything or before answering a question about the team.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  mutates: false,

  async run(_args, ctx) {
    const { data, error } = await serviceClient
      .from('agents')
      .select('role, name, objective, instructions, status, tools, permissions, escalation')
      .eq('tenant_id', ctx.tenantId)
      .order('role');
    if (error) throw new Error(error.message);

    return {
      agents: (data ?? []).map((a) => ({
        ...a,
        what_it_does: AGENT_BLUEPRINTS[a.role as AgentRole]?.summary ?? '',
      })),
      note: 'Every business has these five. You cannot add or remove a department, only rename one, adjust how it works, or switch it off.',
    };
  },
};

export const configureAgent: Tool = {
  name: 'configure_agent',
  description:
    'Change how an agent behaves: its name, its objective, or extra instructions such as "never quote implant prices" or "be more proactive about offering a consultation". Instructions are added to the agent\'s built-in rules, they do not replace them.',
  parameters: {
    type: 'object',
    properties: {
      role: { type: 'string', enum: CONFIGURABLE_ROLES },
      name: { type: 'string' },
      objective: { type: 'string', description: 'One sentence on what this agent is for.' },
      instructions: {
        type: 'string',
        description: 'The full replacement text for the owner\'s custom guidance. Read the current value first and preserve anything still true.',
      },
      escalation: { type: 'string', description: 'When this agent should hand over to a person.' },
    },
    required: ['role'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    // 'manager' is deliberately absent from the enum, but a model can still
    // send it, so the refusal is enforced here rather than assumed.
    const role = str(args, 'role', { required: true, lower: true });
    if (role === 'manager') {
      throw new ToolInputError(
        'You cannot reconfigure yourself. If the owner wants to change how you work, that is a change they make in the dashboard.'
      );
    }
    if (!CONFIGURABLE_ROLES.includes(role as AgentRole)) {
      throw new ToolInputError(`There is no ${role} agent. Use list_team to see what exists.`);
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const name = str(args, 'name', { max: 60 });
    const objective = str(args, 'objective', { max: 500 });
    const instructions = str(args, 'instructions', { max: 4000 });
    const escalation = str(args, 'escalation', { max: 1000 });

    if (name) patch.name = name;
    if (objective) patch.objective = objective;
    if (args.instructions !== undefined) patch.instructions = instructions;
    if (escalation) patch.escalation = escalation;

    if (Object.keys(patch).length === 1) throw new ToolInputError('Nothing to change. Send at least one field.');

    const { data, error } = await serviceClient
      .from('agents')
      .update(patch)
      .eq('tenant_id', ctx.tenantId)
      .eq('role', role)
      // tools, permissions and status are not in the patch and cannot be:
      // capability is not something an agent negotiates for another agent.
      .select('role, name, objective, instructions, escalation, status')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new ToolInputError(`This business has no ${role} agent yet. Add it first.`);

    return { updated: data };
  },
};

export const activateAgent: Tool = {
  name: 'activate_agent',
  description:
    'Turn an agent on or off. Only do this when the owner explicitly asks. An agent that is off does not answer customers.',
  parameters: {
    type: 'object',
    properties: {
      role: { type: 'string', enum: CONFIGURABLE_ROLES },
      active: { type: 'boolean' },
    },
    required: ['role', 'active'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const role = str(args, 'role', { required: true, lower: true });
    if (role === 'manager') {
      throw new ToolInputError('You cannot switch yourself off.');
    }
    if (!CONFIGURABLE_ROLES.includes(role as AgentRole)) {
      throw new ToolInputError(`There is no ${role} agent.`);
    }
    if (typeof args.active !== 'boolean') throw new ToolInputError('active must be true or false.');

    const { data, error } = await serviceClient
      .from('agents')
      .update({ status: args.active ? 'active' : 'disabled', updated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .eq('role', role)
      .select('role, status')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new ToolInputError(`This business has no ${role} agent yet.`);

    return { updated: data };
  },
};

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export const setupStatus: Tool = {
  name: 'setup_status',
  description:
    'Check what is still missing before this business can go live. Call this when the owner asks "what else do you need" or when you are deciding what to ask next.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  mutates: false,

  async run(_args, ctx) {
    const [{ data: tenant }, { count: services }, { count: hours }, { data: agents }, { data: channels }] =
      await Promise.all([
        serviceClient.from('tenants')
          .select('business_name, business_category, business_description, timezone, onboarding_completed_at')
          .eq('id', ctx.tenantId).single(),
        serviceClient.from('services').select('id', { count: 'exact', head: true })
          .eq('tenant_id', ctx.tenantId).eq('active', true),
        serviceClient.from('business_hours').select('id', { count: 'exact', head: true })
          .eq('tenant_id', ctx.tenantId),
        serviceClient.from('agents').select('role, status').eq('tenant_id', ctx.tenantId),
        serviceClient.from('channels').select('channel_type').eq('tenant_id', ctx.tenantId).eq('status', 'active'),
      ]);

    const missing: string[] = [];
    if (!tenant?.business_description) missing.push('a description of what the business does');
    if (!tenant?.business_category) missing.push('what kind of business this is');
    if (!tenant?.timezone) missing.push('which city or timezone the business is in');
    if (!services) missing.push('the services or products on offer');
    if (!hours) missing.push('the opening hours');
    if (!(agents ?? []).some((a) => a.role !== 'manager' && a.status === 'active')) {
      missing.push('at least one customer-facing agent, switched on');
    }
    if (!(channels ?? []).length) missing.push('a channel customers can reach you on');

    return {
      ready: missing.length === 0,
      still_needed: missing,
      live: Boolean(tenant?.onboarding_completed_at),
    };
  },
};
