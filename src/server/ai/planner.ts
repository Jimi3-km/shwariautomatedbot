import { complete, type ToolDefinition, type ChatMessage } from './llm.js';
import { runTool, TOOLS, type AgentContext } from './tools/index.js';
import { canUserRunTool } from '../security/permissions.js';
import type { Role } from '../auth.js';

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
  executedSteps: number;
}

/**
 * Heuristic to detect whether an owner instruction warrants structured multi-tool planning.
 */
export function isComplexCommand(text: string): boolean {
  const lower = text.toLowerCase();
  const setupKeywords = ['set up', 'setup', 'configure', 'create my', 'start my', 'onboard'];
  const multiActionKeywords = [' and ', ' also ', ' then ', ' plus '];

  const hasSetup = setupKeywords.some((k) => lower.includes(k));
  const hasMultipleActions = multiActionKeywords.some((k) => lower.includes(k));
  const hasMultipleSentences = text.split(/[.;\n]/).filter((s) => s.trim().length > 10).length >= 2;

  return hasSetup || (hasMultipleActions && hasMultipleSentences) || text.length > 200;
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
1. Only select real tools from the provided tool catalogue.
2. Order steps logically: configure business profile first, then services/products, then opening hours, then payment instructions.
3. Validate that arguments conform to tool parameter specifications.
4. Output nothing except the JSON object. No markdown backticks, no explanatory prose.`;

export async function createAndExecutePlan(
  text: string,
  orientationBlock: string,
  availableTools: ToolDefinition[],
  ctx: AgentContext
): Promise<PlanExecutionResult | null> {
  const toolsCatalogueSummary = availableTools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: PLANNER_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Current Business Reference:
${orientationBlock}

Available Tools:
${toolsCatalogueSummary}

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

    const actions: string[] = [];
    const stepOutcomes: string[] = [];

    for (const step of plan.steps) {
      if (!ctx.allowedTools.includes(step.tool)) {
        stepOutcomes.push(`⚠️ Skipped ${step.tool}: Not allowed for this agent.`);
        continue;
      }

      // Check RBAC permission if executed by user
      const userRole: Role = (ctx.userId ? 'owner' : 'admin') as Role;
      if (!canUserRunTool(userRole, step.tool)) {
        stepOutcomes.push(`⚠️ Skipped ${step.tool}: Requires higher privileges.`);
        continue;
      }

      const outcome = await runTool(TOOLS, step.tool, JSON.stringify(step.arguments), ctx);
      if (outcome.ok) {
        if (TOOLS.get(step.tool)?.mutates) actions.push(step.tool);
        stepOutcomes.push(`✓ ${step.description || step.tool}`);
      } else {
        const errMessage =
          outcome.payload && typeof outcome.payload === 'object' && 'error' in outcome.payload
            ? String((outcome.payload as { error: unknown }).error)
            : 'failed';
        stepOutcomes.push(`✗ ${step.description || step.tool} (${errMessage})`);
      }
    }

    const reply = [
      `**Plan Executed:** ${plan.summary}`,
      '',
      ...stepOutcomes,
      '',
      actions.length > 0
        ? 'All updates have been saved to your business.'
        : 'Execution finished. What would you like to review next?',
    ].join('\n');

    return {
      reply,
      actions,
      executedSteps: stepOutcomes.length,
    };
  } catch (err) {
    console.warn('[planner] plan-first generation failed, falling back to turn loop:', err);
    return null;
  }
}
