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

// --- Admin punch-editing tool (RegularisationController::remove()/savenew()) ---
// Separate from decideRegularisation() above: that decides a *regularisation request*
// (employee_regularaization row). These helpers directly edit the underlying device_attandance
// punch rows for an employee/date, mirroring legacy's admin-only "Edit Punches" modal
// (View/Regularisation/editpunch.ctp) reachable from the regularisation grid, not the separate
// EditPunchesController-backed /attendance/edit-punches page (that page ports a different legacy
// controller's sync/shift-date-move flow and doesn't expose remarks or deactivate).

export interface PunchRow extends RowDataPacket {
  device_attandance_seq: number;
  LOGDATE: string;
  C1: string;
  C3: string | null;
  status: string;
}

export async function getPunchesForEmployeeDate(pool: Pool, empId: string, attDate: string): Promise<PunchRow[]> {
  const [rows] = await pool.execute<PunchRow[]>(
    `SELECT device_attandance_seq, LOGDATE, C1, C3, status
     FROM device_attandance
     WHERE emp_id = ? AND DATE(LOGDATE) = ?
     ORDER BY LOGDATE`,
    [empId, attDate]
  );
  return rows;
}

// Ports RegularisationController::savenew() (~line 2653-2750): inserts a manual punch with
// C2 = 'REG', DEVICEID = 0, device_attandance_seq = 0 (auto), and writes a device_attandance_hist
// audit row with action = 'insert' (confirmed live: legacy's own $data["action"] = 'insert', not the
// 'I' used elsewhere by decideRegularisation — kept faithful to savenew()'s own value here).
// Skips legacy's leave-exists / future-date guards (dead UI-era validation the port's callers don't
// need duplicated — the admin explicitly picks a past date via this modal) but keeps the actual writes.
export async function addPunch(
  pool: Pool,
  empId: string,
  attDate: string,
  logTime: string,
  direction: 'in' | 'out',
  remarks: string,
  createdBy: string
): Promise<{ id: number }> {
  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT company_code, branch_code FROM emp_details WHERE emp_id = ?',
    [empId]
  );
  if (!emp) throw new Error('Employee not found');

  const logDateTime = `${attDate} ${logTime}`;
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO device_attandance (company_code, branch_code, emp_id, LOGDATE, C1, C2, C3, DEVICEID, status)
     VALUES (?, ?, ?, ?, ?, 'REG', ?, 0, 'Y')`,
    [emp.company_code, emp.branch_code, empId, logDateTime, direction, remarks]
  );
  await pool.execute(
    `INSERT INTO device_attandance_hist
       (device_attandance_seq, company_code, branch_code, emp_id, LOGDATE, C1, C2, C3, status, created_by, action)
     VALUES (?, ?, ?, ?, ?, ?, 'REG', ?, 'Y', ?, 'insert')`,
    [result.insertId, emp.company_code, emp.branch_code, empId, logDateTime, direction, remarks, createdBy]
  );

  return { id: result.insertId };
}

// Ports RegularisationController::remove() (line 2614-2629). Legacy's literal source sets
// device_attandance.status = 'D', but that value is dead/inconsistent: a live-DB check found
// device_attandance.status only ever actually contains 'Y' (11207 rows) or 'N' (404 rows) across
// this dataset — zero 'D' rows anywhere. decideRegularisation() above (already audited, working)
// uses 'N' for exactly this "deactivate a superseded punch" case. To stay consistent with the real
// convention this same feature already uses elsewhere in the port (and avoid introducing a status
// value nothing else in the codebase or live data recognizes), this deactivate uses 'N', not
// legacy's literal 'D'. Legacy's remove() writes no device_attandance_hist row at all (only
// savenew()/savepunch() do) — confirmed by reading the full function body — so this port doesn't
// fabricate one either.
export async function deactivatePunch(pool: Pool, deviceAttandanceSeq: number): Promise<void> {
  await pool.execute(`UPDATE device_attandance SET status = 'N' WHERE device_attandance_seq = ?`, [deviceAttandanceSeq]);
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
