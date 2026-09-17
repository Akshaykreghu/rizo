import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

// Shared helpers for the Leave Encashment HR bulk grid (LeaveEncashmentRequestController port).
// Companies below are excluded from the leave_encash_limit/already-encashed cap check — ported
// verbatim from listallempsforencash()'s 29-09-2025 edit (restricted_companies), which skips the
// eligibility computation entirely for these codes.
export const RESTRICTED_ENCASHMENT_CAP_COMPANY_CODES = [
  'KWMT', 'ABSG', 'MBCT', 'MRBS', 'STCL',
  'AGNG', 'ESNP', 'VGNN', 'AYRK', 'VGFS', 'VSFS',
];

export interface EncashmentEligibility {
  leaveLimit: number | null;
  alreadyEncashed: number;
  canEncash: boolean;
}

// Ports listallempsforencash()'s per-row eligibility subqueries: the employee's leavepolicy limit
// for this head, and how much has already been approved-and-encashed within that policy's cycle
// window (leave_cycle_start_date..leave_cycle_end_date).
export async function getEncashmentEligibility(
  pool: Pool,
  empFkey: number,
  salaryHeadItemFkey: number
): Promise<EncashmentEligibility> {
  const [[policy]] = await pool.execute<RowDataPacket[]>(
    `SELECT lp.leave_encash_limit, lp.leave_cycle_start_date, lp.leave_cycle_end_date
     FROM leavepolicy lp
     WHERE lp.salary_head_item_fkey = ? AND lp.status = 1
       AND lp.LEAVEPOLICY_GROUP_ID IN (SELECT LEAVEPOLICY_GROUP_ID FROM emp_proff WHERE emp_fkey = ?)
     LIMIT 1`,
    [salaryHeadItemFkey, empFkey]
  );
  const leaveLimit = policy?.leave_encash_limit != null ? Number(policy.leave_encash_limit) : null;
  if (leaveLimit == null || !policy?.leave_cycle_start_date || !policy?.leave_cycle_end_date) {
    return { leaveLimit, alreadyEncashed: 0, canEncash: true };
  }

  const [[sum]] = await pool.execute<RowDataPacket[]>(
    `SELECT SUM(approved_days) AS total FROM leave_encashment_master
     WHERE emp_fkey = ? AND salary_head_item_fkey = ? AND is_approved = 'Y'
       AND approved_date >= ? AND approved_date <= ?`,
    [empFkey, salaryHeadItemFkey, policy.leave_cycle_start_date, policy.leave_cycle_end_date]
  );
  const alreadyEncashed = Number(sum?.total ?? 0);

  return { leaveLimit, alreadyEncashed, canEncash: alreadyEncashed < leaveLimit };
}

// Extracted from [id]/approve/route.ts so the single-row and bulk-approve routes share one
// implementation of the update + leave_encash_prc call.
export async function approveEncashmentEntry(
  pool: Pool | PoolConnection,
  id: number,
  approvedDays: number | null,
  userId: string
): Promise<{ ok: true; procMessage: string | null } | { ok: false; error: string; status: number }> {
  const [[entry]] = await pool.execute<RowDataPacket[]>(
    `SELECT lem.leave_encashment_master_pkey, lem.emp_fkey, lem.is_approved, lem.requested_days, ed.branch_code
     FROM leave_encashment_master lem JOIN emp_details ed ON ed.emp_pkey = lem.emp_fkey
     WHERE lem.leave_encashment_master_pkey = ?`,
    [id]
  );
  if (!entry) return { ok: false, error: 'Encashment request not found', status: 404 };
  if (entry.is_approved === 'Y') {
    return { ok: false, error: 'This request has already been approved', status: 409 };
  }

  await pool.execute(
    `UPDATE leave_encashment_master
     SET is_approved = 'Y', approved_by = '0', approved_date = CURDATE(), branch_code = ?,
         modified_by = ?, modified_date = NOW(), approved_days = COALESCE(?, requested_days)
     WHERE leave_encashment_master_pkey = ?`,
    [entry.branch_code, userId, approvedDays ?? null, id]
  );

  await pool.query('CALL leave_encash_prc(?, ?, ?, ?, @msg)', [
    entry.branch_code, entry.emp_fkey, id, '0',
  ]);
  const [[msgRow]] = await pool.query<RowDataPacket[]>('SELECT @msg AS msg');

  return { ok: true, procMessage: msgRow?.msg ?? null };
}
