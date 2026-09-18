import { GoogleGenAI, ApiError } from '@google/genai';
import { tools, getToolByName, type AssistantContext, type ChatMessage, type ChatTurnResult } from './tools';

const MODEL_NAME = 'gemini-3.6-flash';
const MAX_TOOL_HOPS = 4;

const SYSTEM_PROMPT = `You are the RIZO HR Assistant, embedded in a payroll/HR system.

Rules:
- You may only answer questions about employee/HR data available through your tools (headcount, employee profile, leave balance, pending leave approvals, attendance, new joiners, headcount breakdown, birthdays/anniversaries).
- You must call a tool to get any factual number or record — never invent or guess data.
- You have no access to payroll amounts, salary figures, or statutory data. If asked, say that isn't available yet.
- If a tool returns an error (e.g. permission denied) or "found: false", tell the user plainly rather than guessing.
- Keep answers short and direct, formatted for a chat window.`;

function toGenAiTool(def: (typeof tools)[number]) {
  return {
    type: 'function' as const,
    name: def.name,
    description: def.description,
    parameters: {
      type: 'object',
      properties: def.parameters.properties,
      required: def.parameters.required ?? [],
    },
  };
}

interface FunctionCallStep {
  type: 'function_call';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

function isFunctionCallStep(step: { type: string }): step is FunctionCallStep {
  return step.type === 'function_call';
}

// `client.interactions.create` is overloaded across streaming/non-streaming and model/agent
// param shapes, so TS's ReturnType/Awaited on it (and even the SDK's own declared response
// alias) resolve through a self-referential type graph — `next build`'s standalone type-check
// pass rejects that as an implicit-any cycle even though `tsc --noEmit` on this file alone does
// not. Sidestep the SDK's response type entirely with a local shape covering only what's used
// here, cast at the two call sites below.
interface AssistantInteraction {
  id: string;
  steps?: { type: string; id?: string; name?: string; arguments?: Record<string, unknown> }[];
  output_text?: string;
}

export async function runAssistant(
  messages: ChatMessage[],
  ctx: AssistantContext
): Promise<ChatTurnResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      answer:
        'The AI Assistant is not configured yet — ask an administrator to set GEMINI_API_KEY.',
      toolsCalled: [],
    };
  }

  const client = new GoogleGenAI({ apiKey });
  const genAiTools = tools.map(toGenAiTool);
  const toolsCalled: { name: string; args: Record<string, unknown> }[] = [];

  let interaction: AssistantInteraction;
  try {
    interaction = (await client.interactions.create({
      model: MODEL_NAME,
      system_instruction: SYSTEM_PROMPT,
      tools: genAiTools,
      input: messages.map((m) => ({
        type: m.role === 'assistant' ? ('model_output' as const) : ('user_input' as const),
        content: [{ type: 'text' as const, text: m.content }],
      })),
    })) as unknown as AssistantInteraction;
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'The AI Assistant is temporarily unavailable.';
    return { answer: message, toolsCalled };
  }

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    const functionCallSteps = (interaction.steps ?? []).filter(isFunctionCallStep);

    if (functionCallSteps.length === 0) {
      const text = (interaction.output_text ?? '').trim();
      return { answer: text || "I couldn't find an answer to that.", toolsCalled };
    }

    const resultSteps = [];
    for (const step of functionCallSteps) {
      toolsCalled.push({ name: step.name, args: step.arguments });
      const tool = getToolByName(step.name);

      let result: unknown;
      try {
        result = tool ? await tool.execute(step.arguments, ctx) : { error: `Unknown tool: ${step.name}` };
      } catch (err) {
        result = { error: err instanceof Error ? err.message : 'Tool execution failed' };
      }

      resultSteps.push({
        type: 'function_result' as const,
        call_id: step.id,
        name: step.name,
        result: JSON.stringify(result),
      });
    }

    try {
      interaction = (await client.interactions.create({
        model: MODEL_NAME,
        previous_interaction_id: interaction.id,
        tools: genAiTools,
        input: resultSteps,
      })) as unknown as AssistantInteraction;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The AI Assistant is temporarily unavailable.';
      return { answer: message, toolsCalled };
    }
  }

  return {
    answer: "I wasn't able to finish answering that within the allowed steps — try rephrasing.",
    toolsCalled,
  };
}
