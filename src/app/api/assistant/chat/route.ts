import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { runAssistant } from '@/lib/assistant/gemini';
import { NextRequest, NextResponse } from 'next/server';
import type { Content } from '@google/generative-ai';

const RATE_LIMIT = 30; // messages per hour per user
const RATE_WINDOW_MS = 60 * 60 * 1000;

const globalForRateLimit = global as typeof globalThis & {
  _assistantRateLimit?: Map<string, number[]>;
};
function getRateLimitMap() {
  if (!globalForRateLimit._assistantRateLimit) {
    globalForRateLimit._assistantRateLimit = new Map();
  }
  return globalForRateLimit._assistantRateLimit;
}

function isRateLimited(key: string): boolean {
  const map = getRateLimitMap();
  const now = Date.now();
  const timestamps = (map.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT) {
    map.set(key, timestamps);
    return true;
  }
  timestamps.push(now);
  map.set(key, timestamps);
  return false;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (isRateLimited(session.user.loginUserId)) {
    return NextResponse.json(
      { error: 'Rate limit reached. Please try again later.' },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);
  const messages = body?.messages as ChatMessage[] | undefined;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
  }

  const lastQuestion = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  const pool = await getCompanyPool(session.user.companyCode);

  const history: Content[] = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const result = await runAssistant(history, {
    pool,
    userGroup: session.user.userGroup,
    empFkey: session.user.empFkey,
    loginUserId: session.user.loginUserId,
  });

  try {
    await pool.execute(
      `INSERT INTO ai_assistant_log (login_user_id, question, tools_called, answer) VALUES (?, ?, ?, ?)`,
      [
        session.user.loginUserId,
        lastQuestion,
        JSON.stringify(result.toolsCalled),
        result.answer,
      ]
    );
  } catch {
    // Audit logging is best-effort; never block the user's answer on it.
  }

  return NextResponse.json({
    answer: result.answer,
    toolsCalled: result.toolsCalled.map((t) => t.name),
  });
}
