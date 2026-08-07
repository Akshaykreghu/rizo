import { GoogleGenerativeAI, SchemaType, type Content, type FunctionDeclaration, type Schema } from '@google/generative-ai';
import { tools, getToolByName, type AssistantContext } from './tools';

const MODEL_NAME = 'gemini-2.0-flash';
const MAX_TOOL_HOPS = 4;

const SYSTEM_PROMPT = `You are the RIZO HR Assistant, embedded in a payroll/HR system.

Rules:
- You may only answer questions about employee/HR data available through your tools (headcount, employee profile, leave balance, pending leave approvals, attendance, new joiners, headcount breakdown, birthdays/anniversaries).
- You must call a tool to get any factual number or record — never invent or guess data.
- You have no access to payroll amounts, salary figures, or statutory data. If asked, say that isn't available yet.
- If a tool returns an error (e.g. permission denied) or "found: false", tell the user plainly rather than guessing.
- Keep answers short and direct, formatted for a chat window.`;

function toGeminiSchema(def: (typeof tools)[number]): FunctionDeclaration {
  const properties: Record<string, Schema> = {};
  for (const [key, val] of Object.entries(def.parameters.properties)) {
    properties[key] =
      val.type === 'number'
        ? { type: SchemaType.NUMBER, description: val.description }
        : { type: SchemaType.STRING, description: val.description };
  }
  return {
    name: def.name,
    description: def.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties,
      required: def.parameters.required ?? [],
    },
  };
}

export interface ChatTurnResult {
  answer: string;
  toolsCalled: { name: string; args: Record<string, unknown> }[];
}

export async function runAssistant(
  history: Content[],
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

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: tools.map(toGeminiSchema) }],
  });

  const contents: Content[] = [...history];
  const toolsCalled: { name: string; args: Record<string, unknown> }[] = [];

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    const result = await model.generateContent({ contents });
    const candidate = result.response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const functionCalls = parts.filter((p) => !!p.functionCall).map((p) => p.functionCall!);

    if (functionCalls.length === 0) {
      const text = result.response.text().trim();
      return { answer: text || "I couldn't find an answer to that.", toolsCalled };
    }

    contents.push({ role: 'model', parts });

    const responseParts = [];
    for (const call of functionCalls) {
      const tool = getToolByName(call.name);
      const args = (call.args ?? {}) as Record<string, unknown>;
      toolsCalled.push({ name: call.name, args });

      let response: unknown;
      try {
        response = tool ? await tool.execute(args, ctx) : { error: `Unknown tool: ${call.name}` };
      } catch (err) {
        response = { error: err instanceof Error ? err.message : 'Tool execution failed' };
      }

      responseParts.push({
        functionResponse: { name: call.name, response: response as object },
      });
    }
    contents.push({ role: 'function', parts: responseParts });
  }

  return {
    answer: "I wasn't able to finish answering that within the allowed steps — try rephrasing.",
    toolsCalled,
  };
}
