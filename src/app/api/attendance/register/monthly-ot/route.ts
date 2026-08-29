import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports OtAttendanceNewController::Setvalue()/remarks(): edits emp_ot_master.set_duration/remarks
// without touching is_verified — the manual monthly-OT override, same override pattern as the
// day-level OT set_duration. Refuses to edit a row already verified (matches legacy protecting a
// verified monthly OT from being silently changed underneath an approved payroll run) — un-verify
// it first via the Overtime page or the dedicated verify flow.

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const empFkey: number = body.empFkey;
  const month: string = body.month; // YYYY-MM
  const setDurationMin: number | null = body.setDurationMin ?? null;
  const remarks: string | undefined = body.remarks;
  if (!empFkey || !month) {
    return NextResponse.json({ error: 'empFkey and month are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const monthDate = `${month}-01`;

  const [[existing]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_ot_master_pkey, is_verified FROM emp_ot_master WHERE emp_fkey = ? AND month = ?',
    [empFkey, monthDate]
  );

  if (existing?.is_verified === 'Y') {
    return NextResponse.json({ error: 'Monthly OT is already verified for this employee/month' }, { status: 409 });
  }

  if (existing) {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (body.setDurationMin !== undefined) { sets.push('set_duration = ?'); params.push(setDurationMin); }
    if (remarks !== undefined) { sets.push('remarks = ?'); params.push(remarks); }
    if (sets.length > 0) {
      params.push(existing.emp_ot_master_pkey);
      await pool.execute(`UPDATE emp_ot_master SET ${sets.join(', ')} WHERE emp_ot_master_pkey = ?`, params);
    }
  } else {
    const [[emp]] = await pool.execute<RowDataPacket[]>(
      "SELECT CONCAT(first_name, ' ', IFNULL(last_name, '')) AS name FROM emp_details WHERE emp_pkey = ?",
      [empFkey]
    );
    await pool.execute(
      `INSERT INTO emp_ot_master (emp_fkey, emp_name, month, total_duration, set_duration, remarks) VALUES (?, ?, ?, 0, ?, ?)`,
      [empFkey, emp?.name ?? '', monthDate, setDurationMin, remarks ?? null]
    );
  }

  return NextResponse.json({ success: true });
}
