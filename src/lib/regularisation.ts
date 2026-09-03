import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

// Shared core of RegularisationController::bulkupdate()'s live admin approve/reject, extracted so
// both the single-row decide route and the bulk-decide route (admin "select many, approve/reject
// at once" — legacy's actual bulk flow) run the exact same logic instead of two copies drifting.
// See decide/route.ts's original comment for the bug-fix note (legacy skipped the pending-only
// guard and double-processed rows) — still true here, unchanged.

export interface DecideResult {
  ok: boolean;
  error?: string;
}

export async function decideRegularisation(
  pool: Pool,
  id: number,
  decision: 'approve' | 'reject',
  remarks: string | undefined,
  loginUserId: string
): Promise<DecideResult> {
  const [[reg]] = await pool.execute<RowDataPacket[]>(
    `SELECT id, att_date, C1 AS direction, LOGTIME, empid, approved, status FROM employee_regularaization WHERE id = ?`,
    [id]
  );
  if (!reg) return { ok: false, error: 'Regularisation request not found' };
  if (reg.approved !== 'P' || reg.status !== 1) {
    return { ok: false, error: 'This request has already been processed' };
  }

  const finalRemarks = remarks ?? (decision === 'approve' ? 'Approved By Admin' : 'Rejected By Admin');

  if (decision === 'reject') {
    await pool.execute(
      `UPDATE employee_regularaization SET approved = 'R', status = 0, remarks = ?, updated_by = ?, updated_date = NOW() WHERE id = ?`,
      [finalRemarks, loginUserId, id]
    );
    return { ok: true };
  }

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_pkey, company_code, branch_code FROM emp_details WHERE emp_id = ?',
    [reg.empid]
  );
  if (!emp) return { ok: false, error: 'Employee not found' };

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
        oldPunch.C5, oldPunch.C6, oldPunch.C7, oldPunch.WORKCODE, loginUserId,
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
    [insertResult.insertId, emp.company_code, emp.branch_code, reg.empid, logDateTime, reg.direction, loginUserId]
  );

  await pool.execute(
    `UPDATE employee_regularaization SET approved = 'A', remarks = ?, updated_by = ?, updated_date = NOW() WHERE id = ?`,
    [finalRemarks, loginUserId, id]
  );

  try {
    await pool.query('SELECT time_duration_check(?, ?, ?) AS r', [reg.att_date, emp.emp_pkey, emp.branch_code]);
  } catch {
    // best-effort duration recompute; approval itself has already succeeded
  }

  return { ok: true };
}
