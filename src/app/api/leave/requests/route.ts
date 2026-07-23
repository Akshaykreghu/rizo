import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { checkAttendanceConflict, getEmployeeLeaveTypes, runLeaveTransaction } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports LeaveRequestController's core list + saveLeaveEntry() (apply path only — edit/cancel are
// separate routes). Admin-only: admin picks an employee and applies on their behalf, same precedent
// as Regularisation/Resignation (no ESS/hierarchy-manager login exists in this app).

// Day-count for a FROMDATE/TOHALF range: inclusive calendar days minus 0.5 for each half-day end.
// NOTE: unlike insert_update_att_reg (attendance), this raw count does not exclude weekoffs/holidays —
// legacy's own day-count computation for the apply form is client-side JS not fully re-derived from
// source; flagged here as a simplification to revisit if real usage shows a mismatch against legacy.
function calcLeaveDays(fromDate: string, fromHalf: number, toDate: string, toHalf: number): number {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  let total = days;
  if (fromHalf === 2) total -= 0.5;
  if (toHalf === 1) total -= 0.5;
  return Math.max(total, 0.5);
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const employee = searchParams.get('employee') ?? '';
  const status = searchParams.get('status') ?? '';

  const pool = await getCompanyPool(session.user.companyCode);

  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (employee) { conditions.push('le.EMP_fkey = ?'); values.push(Number(employee)); }
  if (status) { conditions.push('le.LEAVESTATUS = ?'); values.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT le.LEAVEENTRYID, le.EMP_fkey, le.salary_head_item_fkey, shi.item AS leave_type,
            le.FROMDATE, le.FROMHALF, le.TODATE, le.TOHALF, le.leave_days, le.LEAVESTATUS,
            le.ISAutherizedby, le.ISAutherized, le.APPROVEDBY, le.ISAPPROVED, le.Reason, le.applied_date,
            ed.first_name, ed.last_name, ed.emp_id
     FROM leaveentries le
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = le.salary_head_item_fkey
     JOIN emp_details ed ON ed.emp_pkey = le.EMP_fkey
     ${where}
     ORDER BY le.LEAVEENTRYID DESC
     LIMIT 200`,
    values
  );

  return NextResponse.json({ data: rows });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    empFkey, salaryHeadItemFkey, fromDate, fromHalf, toDate, toHalf,
    reason, contactNo, contactPerson, authorizerFkey, approverFkey,
  } = body as {
    empFkey: number; salaryHeadItemFkey: number; fromDate: string; fromHalf: number;
    toDate: string; toHalf: number; reason?: string; contactNo?: string; contactPerson?: string;
    authorizerFkey?: number; approverFkey?: number;
  };

  if (!empFkey || !salaryHeadItemFkey || !fromDate || !toDate || !fromHalf || !toHalf) {
    return NextResponse.json(
      { error: 'empFkey, salaryHeadItemFkey, fromDate, fromHalf, toDate and toHalf are required' },
      { status: 400 }
    );
  }
  if (toDate < fromDate) {
    return NextResponse.json({ error: 'toDate cannot be before fromDate' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const types = await getEmployeeLeaveTypes(pool, empFkey);
  const type = types.find((t) => t.salaryHeadItemFkey === Number(salaryHeadItemFkey));
  if (!type) {
    return NextResponse.json({ error: 'This leave type is not part of the employee\'s leave policy' }, { status: 400 });
  }

  const conflict = await checkAttendanceConflict(pool, empFkey, fromDate, toDate);
  if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });

  // ISAutherizedby is NOT NULL with no default (same gotcha Phase 3 hit for attendance-side leave
  // writes) — fall back to 0 for an admin-only session with no employee record, matching that precedent.
  const isAutherizedby = authorizerFkey ?? session.user.empFkey ?? 0;
  const approvedBy = approverFkey ?? null;
  const leaveDays = calcLeaveDays(fromDate, Number(fromHalf), toDate, Number(toHalf));

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO leaveentries
       (salary_head_item_fkey, applied_date, LEAVESTATUS, EMP_fkey, FROMDATE, FROMHALF, TODATE, TOHALF,
        ISAutherizedby, APPROVEDBY, Reason, contact_No, contact_person, leave_days)
     VALUES (?, CURDATE(), 'Applied', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      salaryHeadItemFkey, empFkey, fromDate, fromHalf, toDate, toHalf,
      isAutherizedby, approvedBy, reason ?? null, contactNo ?? null, contactPerson ?? null, leaveDays,
    ]
  );
  const leaveEntryId = result.insertId;

  const { finalStatus, errorMessage } = await runLeaveTransaction(pool, {
    leaveEntryId, empFkey, fromDate, fromHalf: Number(fromHalf), toDate, toHalf: Number(toHalf),
    leaveDays, status: 'Applied',
  });

  return NextResponse.json({ success: true, id: leaveEntryId, leaveDays, status: finalStatus, procMessage: errorMessage });
}
