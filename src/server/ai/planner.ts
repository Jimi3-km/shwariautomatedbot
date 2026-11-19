import { complete, type ToolDefinition, type ChatMessage } from './llm.js';
import { runTool, TOOLS, type AgentContext } from './tools/index.js';

export interface PlanStep {
  tool: string;
  arguments: Record<string, unknown>;
  description: string;
}

export interface StructuredPlan {
  summary: string;
  steps: PlanStep[];
}

export interface PlanExecutionResult {
  reply: string;
  actions: string[];
  /** Steps that actually succeeded. Zero means the caller should run a normal turn instead. */
  executedSteps: number;
}

const MAX_PLAN_STEPS = 12;

/**
 * Tools a plan may never contain.
 *
 * A plan runs straight through with nobody saying yes in between, so it is
 * limited to additive setup work. Anything that removes something, reaches a
 * customer, or changes how the team behaves has to go through the ordinary
 * conversational turn, where the manager's rule — say what you are about to do
 * and get a yes first — applies. A plan containing one of these is not
 * trimmed; it is abandoned, and the normal loop takes the request instead.
 */
const NEVER_PLANNED = new Set([
  'remove_service', 'remove_product',
  'cancel_appointment', 'reschedule_appointment',
  'message_customer', 'set_conversation_handling',
  'cancel_follow_up', 'schedule_follow_up',
  'update_order_status', 'update_ticket',
  'configure_agent', 'activate_agent', 'update_agent_settings',
  'delegate_to_agent',
  'teach_team', 'forget_lesson', 'hand_to_department',
  'remove_products', 'remove_services',
]);

/**
 * Heuristic to detect whether an owner instruction warrants structured multi-tool planning.
 *
 * Deliberately narrow: a plan skips the conversation, so it is only worth it
 * for a real setup brief or a message that plainly lists several jobs. A long
 * message on its own is not a reason — long messages are usually questions.
 */
export function isComplexCommand(text: string): boolean {
  const lower = text.toLowerCase();
  const setupKeywords = ['set up', 'setup', 'configure', 'create my', 'start my', 'onboard'];
  const multiActionKeywords = [' and ', ' also ', ' then ', ' plus '];

  const hasSetup = setupKeywords.some((k) => lower.includes(k));
  const hasMultipleActions = multiActionKeywords.some((k) => lower.includes(k));
  const hasMultipleSentences = text.split(/[.;\n]/).filter((s) => s.trim().length > 10).length >= 2;
  const isQuestion = /\?\s*$/.test(text.trim());

  if (isQuestion) return false;
  return (hasSetup && text.trim().length >= 30) || (hasMultipleActions && hasMultipleSentences);
}

const PLANNER_SYSTEM_PROMPT = `You are the Shwari Executive Operations Planner.
Your job is to break down complex business setup or multi-step management requests into a clean, ordered execution plan.

Output ONLY valid JSON matching this schema:
{
  "summary": "Short 1-line overview of the plan",
  "steps": [
    {
      "tool": "tool_name",
      "arguments": { "arg1": "val1" },
      "description": "Short human description of what this step does"
    }
  ]
}

Rules:
1. Only select real tools from the provided tool catalogue. If the request needs anything not in the catalogue, output {"summary": "", "steps": []}.
2. Order steps logically: configure business profile first, then services/products, then opening hours, then payment instructions.
3. Use exactly the argument names and types in each tool's "parameters" JSON Schema. Never invent an argument.
4. Only include what the owner actually stated. Never invent a price, an hour or a detail to fill a gap; leave that step out.
5. At most ${MAX_PLAN_STEPS} steps.
6. Output nothing except the JSON object. No markdown backticks, no explanatory prose.`;

export async function createAndExecutePlan(
  text: string,
  orientationBlock: string,
  availableTools: ToolDefinition[],
  ctx: AgentContext,
  deadlineAt?: number
): Promise<PlanExecutionResult | null> {
  const plannable = availableTools.filter((t) => !NEVER_PLANNED.has(t.name));

  // Names, descriptions and the full parameter schema: without the schema the
  // model guesses at argument names and every step fails validation.
  const toolsCatalogue = plannable
    .map((t) => `- ${t.name}: ${t.description}\n  parameters: ${JSON.stringify(t.parameters)}`)
    .join('\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: PLANNER_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Current Business Reference:
${orientationBlock}

Available Tools:
${toolsCatalogue}

Owner Request:
"${text}"

Formulate the execution plan:`,
    },
  ];

  try {
    const completion = await complete({
      messages,
      temperature: 0.1,
      maxTokens: 3000,
      profile: 'primary',
      deadlineAt,
    });

    if (!completion.text) return null;

    let jsonStr = completion.text.trim();
    // Strip markdown code fences if model wrapped response
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    }

    const plan = JSON.parse(jsonStr) as StructuredPlan;
    if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) {
      return null;
    }
    if (plan.steps.length > MAX_PLAN_STEPS) return null;

    // Validate the whole plan before running any of it. One step that is not
    // plannable means this request needs a conversation, not a batch.
    const plannableNames = new Set(plannable.map((t) => t.name));
    for (const step of plan.steps) {
      if (!step || typeof step.tool !== 'string') return null;
      if (!plannableNames.has(step.tool) || !ctx.allowedTools.includes(step.tool)) return null;
      if (step.arguments !== undefined && (typeof step.arguments !== 'object' || step.arguments === null || Array.isArray(step.arguments))) {
        return null;
      }
    }

    const actions: string[] = [];
    const stepOutcomes: string[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const step of plan.steps) {
      if (deadlineAt && deadlineAt - Date.now() < 4_000) {
        stepOutcomes.push(`… ${step.description || step.tool} (not started — ran out of time, ask me again)`);
        failed++;
        continue;
      }

      // runTool applies the agent's allow-list and the signed-in person's own
      // permissions, so there is no second, weaker check here.
      const outcome = await runTool(TOOLS, step.tool, JSON.stringify(step.arguments ?? {}), ctx);
      if (outcome.ok) {
        succeeded++;
        if (TOOLS.get(step.tool)?.mutates) actions.push(step.tool);
        stepOutcomes.push(`✓ ${step.description || step.tool}`);
      } else {
        failed++;
        const errMessage =
          outcome.payload && typeof outcome.payload === 'object' && 'error' in outcome.payload
            ? String((outcome.payload as { error: unknown }).error)
            : 'failed';
        stepOutcomes.push(`✗ ${step.description || step.tool} (${errMessage})`);
      }
    }

    const closing = failed
      ? `${succeeded} of ${plan.steps.length} steps worked. Tell me how you'd like to handle the rest.`
      : actions.length > 0
        ? 'All updates have been saved to your business.'
        : 'That is everything. What would you like to review next?';

    const reply = [
      `**Plan Executed:** ${plan.summary}`,
      '',
      ...stepOutcomes,
      '',
      closing,
    ].join('\n');

    return {
      reply,
      actions,
      // Only steps that worked count. A plan in which nothing succeeded reports
      // zero, and the caller runs an ordinary turn instead of sending a list of
      // failures as the answer.
      executedSteps: succeeded,
    };
  } catch (err) {
    console.warn('[planner] plan-first generation failed, falling back to turn loop:', err instanceof Error ? err.message : err);
    return null;
  }
}
