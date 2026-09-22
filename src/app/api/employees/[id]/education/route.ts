import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports legacy EmployeeController::getEducation($emp_pkey) — reads `qualifcations` directly by
// emp_fkey, NOT the pre-onboarding `Education` table (that one's keyed to emp_join and only ever
// exists for employees who went through the join wizard; qualifcations is the permanent,
// post-onboarding record every employee can have, populated at onboarding time — see
// join/[id]/onboard/route.ts — and added-to directly here going forward). Confirmed live: real
// employees have qualifcations rows with no corresponding emp_join row at all.
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
    `SELECT qualification_pkey AS education_pkey, course AS degree, university, duration, mark AS marks
     FROM qualifcations
     WHERE emp_fkey = ? AND status = 1
     ORDER BY qualification_pkey DESC`,
    [id]
  );
  return NextResponse.json(rows);
}

// Ports legacy EmployeeController::savequalifications() — self-access like emp_family, so the
// ESS "About Me" page (same edit affordance it already has for Family/Documents) can add these
// too, not just admin's Employee Details page.
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
  // Body keys match this route's own GET aliases (degree/marks), not the raw qualifcations
  // columns (course/mark) — RepeatableRows uses one fields[] key list for both display and the
  // add-form draft, so the two directions have to speak the same names.
  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO qualifcations (emp_fkey, course, university, duration, mark, status)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [id, body.degree, body.university, body.duration, body.marks]
  );

  return NextResponse.json({ education_pkey: result.insertId }, { status: 201 });
}
