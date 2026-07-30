import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports CompanyController's ComplianceInfo section (CIN/PAN/TAN/Service Tax/PF/ESI/Prof Tax
// numbers) — a single row per company, same single-row-settings pattern as attendance-config.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM compliance LIMIT 1');
  return NextResponse.json(rows[0] ?? null);
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  const [existing] = await pool.execute<RowDataPacket[]>('SELECT id FROM compliance LIMIT 1');
  const values = [
    body.cin_no ?? '', body.pan_no ?? '', body.service_tax ?? '', body.tan_no ?? '',
    body.pf_no ?? '', body.emp_state_ins_no ?? '', body.pt_no_co ?? '', body.pt_no_dir ?? '',
    body.pt_no_emp ?? '',
  ];

  if (existing.length) {
    await pool.execute(
      `UPDATE compliance SET
         cin_no = ?, pan_no = ?, service_tax = ?, tan_no = ?, pf_no = ?,
         emp_state_ins_no = ?, pt_no_co = ?, pt_no_dir = ?, pt_no_emp = ?
       WHERE id = ?`,
      [...values, existing[0].id]
    );
  } else {
    await pool.execute(
      `INSERT INTO compliance
         (cin_no, pan_no, service_tax, tan_no, pf_no, emp_state_ins_no, pt_no_co, pt_no_dir, pt_no_emp, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      values
    );
  }
  return NextResponse.json({ success: true });
}
