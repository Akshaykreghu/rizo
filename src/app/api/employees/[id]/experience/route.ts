import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { selfEditLockedResponse } from '@/lib/employeeEditLock';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { childRowError } from '@/lib/childRowValidation';

// Ports legacy EmployeeController::getExperience($emp_pkey) — reads `history` directly by
// emp_fkey. See ../education/route.ts for why this replaces the old work_experience-via-emp_join
// bridge. Confirmed live: history_pkey (not experience_pkey — that name belongs to the different
// pre-onboarding work_experience table) is the real primary key column.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT history_pkey AS experience_pkey, company AS company_name, department, designation,
            from_date, to_date, salary
     FROM history
     WHERE emp_fkey = ? AND status = 1
     ORDER BY history_pkey DESC`,
    [id]
  );
  return NextResponse.json(rows);
}

// Ports legacy EmployeeController::savehistoryjoin() — self-access like emp_family, so the ESS
// "About Me" page (same edit affordance it already has for Family/Documents) can add these too,
// not just admin's Employee Details page.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // Body keys match this route's own GET aliases (company_name), not the raw history column
  // (company) — RepeatableRows uses one fields[] key list for both display and the add-form
  // draft, so the two directions have to speak the same names.
  const body = await request.json();
  const rowError = childRowError('experience', body);
  if (rowError) return NextResponse.json({ error: rowError }, { status: 400 });
  const pool = await getCompanyPool(session.user.companyCode);
  const locked = await selfEditLockedResponse(pool, session, parseInt(id));
  if (locked) return locked;

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO history (emp_fkey, company, designation, department, from_date, to_date, salary, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [id, body.company_name, body.designation, body.department, body.from_date, body.to_date, body.salary]
  );

  return NextResponse.json({ experience_pkey: result.insertId }, { status: 201 });
}
