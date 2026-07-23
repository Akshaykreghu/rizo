import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAttPeriod } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports AttendanceCheckInOutController's report suite. early-in/early-out/late-in/late-out read
// directly from the confirmed-live emp_early_in/emp_early_out/emp_late_in/emp_late_out tables
// (real, pre-populated report tables — no PK, not written to by this port). `daily` is built from
// emp_detail_timeattandance/device_attandance directly, avoiding get_branch_code_abs_fn (confirmed
// dead in the live DB in an earlier phase) that legacy's hierarchy-branch path depended on.

const TABLES: Record<string, { table: string; timeCol: string; label: string }> = {
  'early-in': { table: 'emp_early_in', timeCol: 'EarlyInTime', label: 'Early In (min)' },
  'early-out': { table: 'emp_early_out', timeCol: 'EarlyOutTime', label: 'Early Out (min)' },
  'late-in': { table: 'emp_late_in', timeCol: 'LateTime', label: 'Late In (min)' },
  'late-out': { table: 'emp_late_out', timeCol: 'LateOutTime', label: 'Late Out (min)' },
};

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') ?? 'daily';
  const month = searchParams.get('month');
  const branch = searchParams.get('branch') ?? '';
  if (!month) return NextResponse.json({ error: 'month is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const period = await getAttPeriod(pool, month);

  if (type === 'daily') {
    const conditions = ['dt.att_date BETWEEN ? AND ?'];
    const values: (string | number)[] = [period.start, period.end];
    if (branch) {
      conditions.push('ed.branch_code = ?');
      values.push(branch);
    }
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT ed.first_name, ed.last_name, ed.emp_id, dt.att_date, dt.att_in_time, dt.att_out_time, dt.duration
       FROM emp_detail_timeattandance dt
       JOIN emp_details ed ON ed.emp_pkey = dt.emp_pkey
       WHERE ${conditions.join(' AND ')}
       ORDER BY dt.att_date DESC, ed.first_name`,
      values
    );
    return NextResponse.json({ type, period, data: rows });
  }

  const spec = TABLES[type];
  if (!spec) return NextResponse.json({ error: 'Invalid report type' }, { status: 400 });

  const conditions = ['t.LogDate BETWEEN ? AND ?'];
  const values: (string | number)[] = [period.start, `${period.end} 23:59:59`];
  if (branch) {
    conditions.push('ed.branch_code = ?');
    values.push(branch);
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT t.emp_pkey, t.EmpName, t.LogDate, t.Location, t.${spec.timeCol} AS minutes
     FROM ${spec.table} t
     LEFT JOIN emp_details ed ON ed.emp_pkey = t.emp_pkey
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.LogDate DESC`,
    values
  );

  return NextResponse.json({ type, label: spec.label, period, data: rows });
}
