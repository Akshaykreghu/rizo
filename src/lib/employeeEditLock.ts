import { NextResponse } from 'next/server';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Session } from 'next-auth';

export const EDIT_LOCKED_MESSAGE = 'Your profile is locked for editing. Please ask HR to enable editing.';

/**
 * An employee may change their own profile (and its family/education/experience/documents) only
 * while HR has ticked "Editable" on their record (emp_details.editable > 0) — the same lock legacy
 * sets on onboarding. Admins are never blocked. Returns a 403 response to send back, or null.
 */
export async function selfEditLockedResponse(pool: Pool, session: Session, empPkey: number): Promise<NextResponse | null> {
  if (session.user.userGroup === 1) return null;
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT editable FROM emp_details WHERE emp_pkey = ?', [empPkey]);
  // Legacy treats any value > 0 as unlocked (its 1-7 range encodes which sections), not just 1.
  if (Number(rows[0]?.editable) > 0) return null;
  return NextResponse.json({ error: EDIT_LOCKED_MESSAGE }, { status: 403 });
}
