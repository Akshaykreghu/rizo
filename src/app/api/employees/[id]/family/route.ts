import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { selfEditLockedResponse } from '@/lib/employeeEditLock';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { childRowError } from '@/lib/childRowValidation';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  // Employees can only view their own family records (matches GET /api/employees/[id]).
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_family_pkey, name, DOB, gender, blood_group, relation, nationality,
            contact_number, alternate_number, emergency_contact, is_nominee, remarks
     FROM emp_family
     WHERE emp_fkey = ? AND status = 1
     ORDER BY emp_family_pkey DESC`,
    [id]
  );
  return NextResponse.json(rows);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  // Employees can add their own family members (matches GET /api/employees/[id]/family).
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const rowError = childRowError('family', body);
  if (rowError) return NextResponse.json({ error: rowError }, { status: 400 });
  const pool = await getCompanyPool(session.user.companyCode);
  const locked = await selfEditLockedResponse(pool, session, parseInt(id));
  if (locked) return locked;

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_family
       (emp_fkey, name, DOB, gender, blood_group, relation, nationality,
        contact_number, alternate_number, emergency_contact, remarks, is_nominee, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id, body.name, body.DOB || null, body.gender ?? null, body.blood_group ?? null,
      body.relation ?? null, body.nationality ?? '', body.contact_number ?? null,
      body.alternate_number ?? null, body.emergency_contact ?? 'N', body.remarks ?? null,
      body.is_nominee ?? 'N', session.user.loginUserId,
    ]
  );

  return NextResponse.json({ emp_family_pkey: result.insertId }, { status: 201 });
}
