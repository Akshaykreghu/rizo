import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Fixed port of RegularisationController::bulkupdate(): legacy's live admin path
// (bulkupdate($adminUpdate=true)) skipped the "approved='P' AND status=1" guard entirely and its
// Reject branch didn't check for already-processed rows, allowing double-processing. This route
// always requires the row to still be pending before transitioning it — closes that bug.
// On approve: soft-deletes the punch device_attandance was pointing at (if any) and inserts the
// regularised punch, with a parameterized device_attandance_hist audit row (legacy's insert_func()
// built this via raw string concatenation — a real SQL-injection surface, not replicated).

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { decision, remarks } = body as { decision: 'approve' | 'reject'; remarks?: string };
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [[reg]] = await pool.execute<RowDataPacket[]>(
    `SELECT id, att_date, C1 AS direction, LOGTIME, empid, approved, status FROM employee_regularaization WHERE id = ?`,
    [id]
  );
  if (!reg) return NextResponse.json({ error: 'Regularisation request not found' }, { status: 404 });
  if (reg.approved !== 'P' || reg.status !== 1) {
    return NextResponse.json({ error: 'This request has already been processed' }, { status: 409 });
  }

  const finalRemarks = remarks ?? (decision === 'approve' ? 'Approved By Admin' : 'Rejected By Admin');

  if (decision === 'reject') {
    await pool.execute(
      `UPDATE employee_regularaization SET approved = 'R', status = 0, remarks = ?, updated_by = ?, updated_date = NOW() WHERE id = ?`,
      [finalRemarks, session.user.loginUserId, id]
    );
    return NextResponse.json({ success: true, decision });
  }

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_pkey, company_code, branch_code FROM emp_details WHERE emp_id = ?',
    [reg.empid]
  );
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const logDateTime = `${reg.att_date} ${reg.LOGTIME}`;
  const orderDir = reg.direction === 'in' ? 'ASC' : 'DESC';

  const [[oldPunch]] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM device_attandance WHERE emp_id = ? AND DATE(LOGDATE) = ? AND C1 = ? AND status = 'Y'
     ORDER BY LOGDATE ${orderDir} LIMIT 1`,
    [reg.empid, reg.att_date, reg.direction]
  );

  if (oldPunch) {
    await pool.execute(`UPDATE device_attandance SET status = 'N' WHERE device_attandance_seq = ?`, [oldPunch.device_attandance_seq]);
    await pool.execute<ResultSetHeader>(
      `INSERT INTO device_attandance_hist
         (device_attandance_seq, company_code, branch_code, DEVICELOGID, DOWNLOADDATE, DEVICEID, device_USERID,
          emp_id, LOGDATE, DIRECTION, ATTDIRECTION, C1, C2, C3, C4, C5, C6, C7, WORKCODE, status, created_by, action)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N', ?, 'U')`,
      [
        oldPunch.device_attandance_seq, oldPunch.company_code, oldPunch.branch_code, oldPunch.DEVICELOGID,
        oldPunch.DOWNLOADDATE, oldPunch.DEVICEID, oldPunch.device_USERID, oldPunch.emp_id, oldPunch.LOGDATE,
        oldPunch.DIRECTION, oldPunch.ATTDIRECTION, oldPunch.C1, oldPunch.C2, oldPunch.C3, oldPunch.C4,
        oldPunch.C5, oldPunch.C6, oldPunch.C7, oldPunch.WORKCODE, session.user.loginUserId,
      ]
    );
  }

  const [insertResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO device_attandance
       (company_code, branch_code, emp_id, LOGDATE, C1, C2, status)
     VALUES (?, ?, ?, ?, ?, 'REG', 'Y')`,
    [emp.company_code, emp.branch_code, reg.empid, logDateTime, reg.direction]
  );
  await pool.execute<ResultSetHeader>(
    `INSERT INTO device_attandance_hist
       (device_attandance_seq, company_code, branch_code, emp_id, LOGDATE, C1, C2, status, created_by, action)
     VALUES (?, ?, ?, ?, ?, ?, 'REG', 'Y', ?, 'I')`,
    [insertResult.insertId, emp.company_code, emp.branch_code, reg.empid, logDateTime, reg.direction, session.user.loginUserId]
  );

  await pool.execute(
    `UPDATE employee_regularaization SET approved = 'A', remarks = ?, updated_by = ?, updated_date = NOW() WHERE id = ?`,
    [finalRemarks, session.user.loginUserId, id]
  );

  try {
    await pool.query('SELECT time_duration_check(?, ?, ?) AS r', [reg.att_date, emp.emp_pkey, emp.branch_code]);
  } catch {
    // best-effort duration recompute; approval itself has already succeeded
  }

  return NextResponse.json({ success: true, decision });
}
