import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2/promise';

// Shift Allocation tab of the legacy "Bulk Policy Allocation" screen
// (EmployeeConfig/index.ctp tab12 + EmployeeConfigController.php lines 4371-5038).
// Ported per legacy/Bulk_Policy_Shift_Allocation_Migration_Plan.md.
//
//   GET                       -> { employees }               (listemployeesforpolicy)
//   GET  ?emp_fkey=..         -> { allocated, unallocated }  (listshiftsinemployees / listshiftsforemployees)
//   POST { emp_fkey, day_time_seq }   -> addShiftToEmp    (one shift, one employee)
//   DELETE { emp_fkey, day_time_seq } -> removeShiftFromEmp (one shift, one employee)
//
// Shift model: emp_config type='SHIFT' status=1 is the single primary; type='MSHIFT' status=2
// are secondary shifts; status=0 is soft-deleted. emp_proff.day_time_seq tracks the primary
// (0 when none).
//
// CRITICAL — emp_config DB triggers (schema mypayrol_mpm121.sql ~76101):
//   emp_config_bi  BEFORE INSERT: type='SHIFT' -> sets emp_proff.day_time_seq = NEW.policy_id
//   emp_config_au  AFTER  UPDATE: type='SHIFT' -> sets emp_proff.day_time_seq = NULL
// So after every emp_config UPDATE that hits a type='SHIFT' row we must re-set
// emp_proff.day_time_seq explicitly, exactly as the legacy controller does.

interface EmpConfigRow extends RowDataPacket {
  id: number;
  status: number;
  type: string;
  policy_id: number;
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) return null;
  return session;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const empFkey = Number(new URL(request.url).searchParams.get('emp_fkey'));
  const pool = await getCompanyPool(session.user.companyCode);

  // --- employee list (listemployeesforpolicy) ---
  if (!empFkey) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT e.emp_pkey, e.first_name, e.middile_name, e.last_name, b.branch_name
         FROM emp_details e
         LEFT JOIN branches b ON b.branch_code = e.branch_code
        WHERE e.status = 1
        ORDER BY e.first_name, e.last_name`
    );
    const employees = rows.map((r) => ({
      emp_pkey: r.emp_pkey,
      name: [r.first_name, r.middile_name, r.last_name].filter(Boolean).join(' ').trim(),
      branch_name: r.branch_name ?? '',
    }));
    return NextResponse.json({ employees });
  }

  // --- allocated shifts (listshiftsinemployees) ---
  const [allocatedRows] = await pool.execute<RowDataPacket[]>(
    `SELECT wdtp.day_time_seq, wdtp.day_time_desc, MAX(ec.status = 1) AS is_primary
       FROM working_day_time_procedures wdtp
       JOIN emp_config ec ON ec.policy_id = wdtp.day_time_seq
      WHERE ec.emp_fkey = ? AND ec.status IN (1, 2) AND wdtp.active = 1
        AND ec.type IN ('SHIFT', 'MSHIFT')
      GROUP BY wdtp.day_time_seq, wdtp.day_time_desc
      ORDER BY wdtp.day_time_seq`,
    [empFkey]
  );
  const allocated = allocatedRows.map((r) => ({
    day_time_seq: r.day_time_seq,
    day_time_desc: r.day_time_desc,
    primary: Number(r.is_primary) === 1,
  }));

  // --- unallocated shifts (listshiftsforemployees) ---
  // If the employee has any SHIFT/MSHIFT row, exclude those shifts; otherwise show all active.
  const [unallocatedRows] = await pool.execute<RowDataPacket[]>(
    `SELECT day_time_seq, day_time_desc
       FROM working_day_time_procedures
      WHERE active = 1
        AND day_time_seq NOT IN (
          SELECT policy_id FROM emp_config
           WHERE emp_fkey = ? AND policy_id IS NOT NULL
             AND status IN (1, 2) AND type IN ('SHIFT', 'MSHIFT')
        )
      ORDER BY day_time_seq`,
    [empFkey]
  );
  const unallocated = unallocatedRows.map((r) => ({
    day_time_seq: r.day_time_seq,
    day_time_desc: r.day_time_desc,
  }));

  return NextResponse.json({ allocated, unallocated });
}

// ---------------------------------------------------------------------------
// POST — addShiftToEmp
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as { emp_fkey?: number; day_time_seq?: number };
  const empFkey = Number(body.emp_fkey);
  const shift = Number(body.day_time_seq);
  if (!empFkey || !shift) {
    return NextResponse.json({ error: 'emp_fkey and day_time_seq are required' }, { status: 400 });
  }

  const userId = session.user.loginUserId;
  const companyCode = session.user.companyCode;
  const pool = await getCompanyPool(companyCode);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Is any OTHER shift already the primary for this employee?
    const [[otherPrimary]] = await conn.execute<EmpConfigRow[]>(
      `SELECT id FROM emp_config
        WHERE emp_fkey = ? AND type = 'SHIFT' AND status = 1 AND policy_id <> ?
        LIMIT 1`,
      [empFkey, shift]
    );
    const hasOtherPrimary = !!otherPrimary;
    const status = hasOtherPrimary ? 2 : 1;
    const type = hasOtherPrimary ? 'MSHIFT' : 'SHIFT';

    // 2. Existing row for this (emp, shift) regardless of type/status?
    const [[existing]] = await conn.execute<EmpConfigRow[]>(
      `SELECT id, status, type FROM emp_config
        WHERE emp_fkey = ? AND policy_id = ? LIMIT 1`,
      [empFkey, shift]
    );

    if (existing) {
      // Flip type only when the status actually changes (legacy behaviour).
      const setType = Number(existing.status) !== status;
      if (setType) {
        await conn.execute(
          `UPDATE emp_config
              SET status = ?, type = ?, modified_by = ?, modification_date = NOW()
            WHERE id = ?`,
          [status, type, userId, existing.id]
        );
      } else {
        await conn.execute(
          `UPDATE emp_config
              SET status = ?, modified_by = ?, modification_date = NOW()
            WHERE id = ?`,
          [status, userId, existing.id]
        );
      }
      // emp_config_au nulled emp_proff.day_time_seq if the row is type='SHIFT'; re-set it.
      if (status === 1) {
        await conn.execute(
          `UPDATE emp_proff SET day_time_seq = ?, modified_by = ?, modified_date = NOW()
            WHERE emp_fkey = ?`,
          [shift, userId, empFkey]
        );
      }
    } else {
      const [[emp]] = await conn.execute<RowDataPacket[]>(
        'SELECT branch_code FROM emp_details WHERE emp_pkey = ?',
        [empFkey]
      );
      await conn.execute(
        `INSERT INTO emp_config (type, company_code, branch_code, emp_fkey, policy_id,
                                 created_by, creation_date, status)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [type, companyCode, emp?.branch_code ?? null, empFkey, shift, userId, status]
      );
      // emp_config_bi already set emp_proff.day_time_seq for type='SHIFT'; mirror legacy's
      // explicit write so modified_by/modified_date are stamped too.
      if (status === 1) {
        await conn.execute(
          `UPDATE emp_proff SET day_time_seq = ?, modified_by = ?, modified_date = NOW()
            WHERE emp_fkey = ?`,
          [shift, userId, empFkey]
        );
      }
    }

    await conn.commit();
    return NextResponse.json({ success: true, action: 'assigned', primary: status === 1 });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// DELETE — removeShiftFromEmp
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as { emp_fkey?: number; day_time_seq?: number };
  const empFkey = Number(body.emp_fkey);
  const shift = Number(body.day_time_seq);
  if (!empFkey || !shift) {
    return NextResponse.json({ error: 'emp_fkey and day_time_seq are required' }, { status: 400 });
  }

  const userId = session.user.loginUserId;
  const pool = await getCompanyPool(session.user.companyCode);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [[current]] = await conn.execute<EmpConfigRow[]>(
      `SELECT id, status, type FROM emp_config
        WHERE emp_fkey = ? AND policy_id = ? AND type IN ('SHIFT', 'MSHIFT')
        LIMIT 1`,
      [empFkey, shift]
    );
    if (!current) {
      await conn.commit();
      return NextResponse.json({ success: true, removed: 0, promoted: null });
    }

    const isPrimary = Number(current.status) === 1 && current.type === 'SHIFT';

    // Soft-delete every SHIFT/MSHIFT row for this (emp, shift).
    await conn.execute(
      `UPDATE emp_config
          SET status = 0, modified_by = ?, modification_date = NOW()
        WHERE emp_fkey = ? AND policy_id = ? AND type IN ('SHIFT', 'MSHIFT')`,
      [userId, empFkey, shift]
    );
    // emp_config_au has now nulled emp_proff.day_time_seq (the removed row was type='SHIFT').

    let promoted: number | null = null;
    if (isPrimary) {
      const [[another]] = await conn.execute<EmpConfigRow[]>(
        `SELECT id, policy_id FROM emp_config
          WHERE emp_fkey = ? AND status = 2 AND type = 'MSHIFT'
          ORDER BY modification_date DESC
          LIMIT 1`,
        [empFkey]
      );
      if (another) {
        await conn.execute(
          `UPDATE emp_config
              SET status = 1, type = 'SHIFT', modified_by = ?, modification_date = NOW()
            WHERE id = ?`,
          [userId, another.id]
        );
        // emp_config_au nulled day_time_seq again; point it at the promoted shift.
        await conn.execute(
          `UPDATE emp_proff SET day_time_seq = ?, modified_by = ?, modified_date = NOW()
            WHERE emp_fkey = ?`,
          [another.policy_id, userId, empFkey]
        );
        promoted = another.policy_id;
      } else {
        // No secondary to promote — clear the primary (legacy writes '0', column is int).
        await conn.execute(
          `UPDATE emp_proff SET day_time_seq = 0, modified_by = ?, modified_date = NOW()
            WHERE emp_fkey = ?`,
          [userId, empFkey]
        );
      }
    }

    await conn.commit();
    return NextResponse.json({ success: true, removed: 1, promoted });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
