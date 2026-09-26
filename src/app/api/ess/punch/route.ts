import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { canWebPunch } from '@/lib/webPunch';

// Self-service web check-in/check-out. Content ported from legacy's
// Controller/DashboardController.php checkpunch() — same two writes (device_attandance is what
// every other attendance read in this app, including the admin register, already sources from;
// attendance_punch is an audit trail of who/where/what-browser punched). Legacy also reverse-
// geocodes lat/lng into a human address via a hardcoded Google Maps key; this app has no Maps key
// configured, so the raw "lat,lng" pair is stored in `location` instead rather than embedding a
// new API key just for this.
function parseUserAgent(ua: string) {
  let browser = 'Unknown';
  if (/edg/i.test(ua)) browser = 'Microsoft Edge';
  else if (/chrome/i.test(ua)) browser = 'Google Chrome';
  else if (/firefox/i.test(ua)) browser = 'Mozilla Firefox';
  else if (/safari/i.test(ua)) browser = 'Apple Safari';

  let os = 'Unknown';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac os|macintosh/i.test(ua)) os = 'Mac';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad/i.test(ua)) os = 'iOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  return { browser, os };
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.empFkey) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const direction = body.direction === 'out' ? 'out' : body.direction === 'in' ? 'in' : null;
  if (!direction) return NextResponse.json({ error: 'Invalid direction' }, { status: 400 });

  const empFkey = session.user.empFkey;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_id, company_code, branch_code FROM emp_details WHERE emp_pkey = ?`,
    [empFkey]
  );
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  if (!(await canWebPunch(pool, empFkey))) {
    return NextResponse.json({ error: 'Web punching is not enabled for this employee' }, { status: 403 });
  }

  // Every other attendance read in this app (admin register, presence-summary, last-punch status
  // below) sources from device_attandance, so this write must not fail silently the way the
  // audit-only insert below is allowed to.
  await pool.execute(
    `INSERT INTO device_attandance (company_code, branch_code, DEVICEID, emp_id, LOGDATE, DIRECTION, C1, C2, status)
     VALUES (?, ?, 0, ?, NOW(), ?, ?, 'WEB', 'Y')`,
    [emp.company_code, emp.branch_code, emp.emp_id, direction, direction]
  );

  try {
    const ua = request.headers.get('user-agent') || '';
    const { browser, os } = parseUserAgent(ua);
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const lat = typeof body.lat === 'number' ? body.lat : null;
    const lng = typeof body.lng === 'number' ? body.lng : null;
    const location = lat != null && lng != null ? `${lat},${lng}` : '';
    await pool.execute(
      `INSERT INTO attendance_punch (date_punch, emp_fkey, direction, ip_ad, location, browser, host_name, os)
       VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?)`,
      [empFkey, direction, ip, location, browser, request.headers.get('host') || '', os]
    );
  } catch {
    // Audit-only table; a failure here should not block the punch itself (matches legacy).
  }

  return NextResponse.json({ success: true });
}
