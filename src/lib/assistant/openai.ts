import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { tools, getToolByName, type AssistantContext, type ChatMessage, type ChatTurnResult } from './tools';

const MODEL_NAME = 'gpt-4o-mini';
const MAX_TOOL_HOPS = 4;

const SYSTEM_PROMPT = `You are the RIZO HR Assistant, embedded in a payroll/HR system.

Rules:
- You may only answer questions about employee/HR data available through your tools (headcount, employee profile, leave balance, pending leave approvals, attendance, new joiners, headcount breakdown, birthdays/anniversaries).
- You must call a tool to get any factual number or record — never invent or guess data.
- You have no access to payroll amounts, salary figures, or statutory data. If asked, say that isn't available yet.
- If a tool returns an error (e.g. permission denied) or "found: false", tell the user plainly rather than guessing.
- Keep answers short and direct, formatted for a chat window.`;

function toOpenAITool(def: (typeof tools)[number]): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: {
        type: 'object',
        properties: def.parameters.properties,
        required: def.parameters.required ?? [],
      },
    },
  };
}

export async function runAssistant(
  messages: ChatMessage[],
  ctx: AssistantContext
): Promise<ChatTurnResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      answer: 'The AI Assistant is not configured yet — ask an administrator to set OPENAI_API_KEY.',
      toolsCalled: [],
    };
  }

  const client = new OpenAI({ apiKey });

  const chatMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.map((m): ChatCompletionMessageParam => ({ role: m.role, content: m.content })),
  ];

  const toolsCalled: { name: string; args: Record<string, unknown> }[] = [];

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    let response;
    try {
      response = await client.chat.completions.create({
        model: MODEL_NAME,
        messages: chatMessages,
        tools: tools.map(toOpenAITool),
      });
    } catch (err) {
      const message = err instanceof OpenAI.APIError ? err.message : 'The AI Assistant is temporarily unavailable.';
      return { answer: message, toolsCalled };
    }

    const message = response.choices[0].message;
    const toolCalls = message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const text = (message.content ?? '').trim();
      return { answer: text || "I couldn't find an answer to that.", toolsCalled };
    }

    chatMessages.push({ role: 'assistant', content: message.content, tool_calls: toolCalls });

    for (const call of toolCalls) {
      if (call.type !== 'function') continue;
      const tool = getToolByName(call.function.name);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        // malformed args from the model — fall through with an empty object
      }
      toolsCalled.push({ name: call.function.name, args });

      let result: unknown;
      try {
        result = tool ? await tool.execute(args, ctx) : { error: `Unknown tool: ${call.function.name}` };
      } catch (err) {
        result = { error: err instanceof Error ? err.message : 'Tool execution failed' };
      }

      chatMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    answer: "I wasn't able to finish answering that within the allowed steps — try rephrasing.",
    toolsCalled,
  };
}
