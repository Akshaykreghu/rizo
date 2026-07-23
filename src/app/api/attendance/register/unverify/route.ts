import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports removeAttendance(): un-verify (isdelete 'N' -> 'Y') selected register rows, blocked
// per-employee (not all-or-nothing, matching legacy's real skip-and-continue semantics) if payroll
// for that month is already processed/approved, or if OT for that month is already verified/locked.

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const registerIds: number[] = body.registerIds ?? [];
  if (registerIds.length === 0) {
    return NextResponse.json({ error: 'registerIds is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const placeholders = registerIds.map(() => '?').join(',');
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT registerid, emp_fkey, month_year FROM attendance_register
     WHERE registerid IN (${placeholders}) AND isdelete = 'N'`,
    registerIds
  );

  const removed: number[] = [];
  const skipped: { registerId: number; reason: string }[] = [];

  for (const row of rows) {
    const [[payroll]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM payroll_master
       WHERE emp_fkey = ? AND month_year = ? AND action IN ('processed', 'approved')`,
      [row.emp_fkey, row.month_year]
    );
    if (Number(payroll.cnt) > 0) {
      skipped.push({ registerId: row.registerid, reason: 'Payroll already processed/approved for this month' });
      continue;
    }

    const [[ot]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM emp_ot_master WHERE emp_fkey = ? AND DATE_FORMAT(month, '%Y-%m') = ? AND is_verified = 'Y'`,
      [row.emp_fkey, row.month_year]
    );
    if (Number(ot.cnt) > 0) {
      skipped.push({ registerId: row.registerid, reason: 'Overtime already verified for this month' });
      continue;
    }

    await pool.execute("UPDATE attendance_register SET isdelete = 'Y' WHERE registerid = ?", [row.registerid]);
    removed.push(row.registerid);
  }

  return NextResponse.json({ removed, skipped });
}
