import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { sendMail } from '@/lib/mailer';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Colleague-to-colleague birthday or work-anniversary wish from the ESS home calendar. Unlike
// /api/employees/[id]/birthday-wish (admin-only, mails the company's default image template),
// this sends a short personal note from the signed-in employee to the colleague's registered
// address. Only allowed on the day itself (WISH_WINDOW_DAYS = 0), never for yourself.

const WISH_WINDOW_DAYS = 0;
const MAX_MESSAGE = 1000;

// One wish per sender → recipient per day. In-memory, so it resets on restart — it only guards
// against double-clicks and repeat sends, it is not an audit record.
const sent = new Map<string, number>();

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user.empFkey) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const toEmp = Number(body.empPkey);
  const message = String(body.message ?? '').trim().slice(0, MAX_MESSAGE);
  const kind: 'birthday' | 'anniversary' = body.kind === 'anniversary' ? 'anniversary' : 'birthday';
  if (!Number.isInteger(toEmp) || toEmp <= 0) return NextResponse.json({ error: 'Invalid employee' }, { status: 400 });
  if (toEmp === session.user.empFkey) return NextResponse.json({ error: "You can't wish yourself" }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);

  // The birthday / joining anniversary (month-day) must fall today (or within WISH_WINDOW_DAYS
  // before, if widened); an anniversary also needs at least one full year.
  const dateCol = kind === 'anniversary' ? 'p.joining_date' : 'e.date_of_birth';
  const windowDays = Array.from({ length: WISH_WINDOW_DAYS + 1 }, (_, i) => `DATE_FORMAT(CURDATE() - INTERVAL ${i} DAY, '%m-%d')`).join(', ');
  const [[emp]] = await pool.execute<RowDataPacket[]>(
    `SELECT e.first_name, e.last_name, uc.email,
            DATE_FORMAT(${dateCol}, '%m-%d') IN (${windowDays}) AS in_window,
            YEAR(CURDATE()) - YEAR(${dateCol}) AS years
     FROM emp_details e
     LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
     LEFT JOIN user_credentials uc ON uc.emp_fkey = e.emp_pkey
     WHERE e.emp_pkey = ? AND e.status = 1 AND ${dateCol} IS NOT NULL`,
    [toEmp]
  );
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  const years = Number(emp.years);
  if (!Number(emp.in_window) || (kind === 'anniversary' && years < 1)) {
    return NextResponse.json({ error: `Wishes can only be sent on the ${kind === 'anniversary' ? 'work anniversary' : 'birthday'}` }, { status: 400 });
  }
  if (!emp.email) return NextResponse.json({ error: 'This colleague has no email address on file' }, { status: 422 });

  const today = new Date().toISOString().slice(0, 10);
  const guardKey = `${session.user.companyCode}:${session.user.empFkey}:${toEmp}:${kind}:${today}`;
  if (sent.has(guardKey)) return NextResponse.json({ error: 'You have already sent a wish today' }, { status: 409 });

  const [[me]] = await pool.execute<RowDataPacket[]>(
    `SELECT e.first_name, e.last_name, uc.email
     FROM emp_details e
     LEFT JOIN user_credentials uc ON uc.emp_fkey = e.emp_pkey
     WHERE e.emp_pkey = ?`,
    [session.user.empFkey]
  );
  const fromName = `${me?.first_name ?? ''} ${me?.last_name ?? ''}`.trim() || session.user.name || 'A colleague';
  const toFirst = emp.first_name ?? '';
  const yearsText = `${years} year${years === 1 ? '' : 's'}`;
  const note = message || (kind === 'anniversary'
    ? `Happy work anniversary, ${toFirst}! Congratulations on ${yearsText} with the team.`
    : `Happy birthday, ${toFirst}! Wishing you a wonderful year ahead.`);
  const heading = kind === 'anniversary' ? `Happy ${yearsText} work anniversary, ${toFirst}!` : `Happy Birthday, ${toFirst}!`;

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="background:linear-gradient(135deg,#0d2c40,#1E516E 60%,#2772a0);padding:28px 24px;text-align:center;color:#ffffff">
      <div style="font-size:40px;line-height:1">${kind === 'anniversary' ? '🏅' : '🎂'}</div>
      <div style="font-size:22px;font-weight:bold;margin-top:10px">${escapeHtml(heading)}</div>
    </div>
    <div style="padding:24px;color:#1f2937;font-size:15px;line-height:1.6">
      <p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(note)}</p>
      <p style="margin:0;color:#6b7280;font-size:13px">— ${escapeHtml(fromName)}</p>
    </div>
  </div>
</body></html>`;

  const result = await sendMail({
    to: emp.email,
    subject: `🎉 ${fromName} sent you a ${kind === 'anniversary' ? 'work anniversary' : 'birthday'} wish`,
    html,
    text: `${note}\n\n— ${fromName}`,
    replyTo: me?.email || undefined,
  });
  if (result.status === 'sent') sent.set(guardKey, Date.now());

  return NextResponse.json({ status: result.status });
}
