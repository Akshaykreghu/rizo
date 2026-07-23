import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO family
       (emp_join_fkey, name, DOB, gender, blood_group, relation, nationality,
        contact_number, alternate_number, emergency_contact, remarks, is_nominee, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Y')`,
    [
      id, body.name, body.DOB || null, body.gender ?? null, body.blood_group ?? null,
      body.relation ?? null, body.nationality, body.contact_number ?? null,
      body.alternate_number ?? null, body.emergency_contact ?? 'N', body.remarks ?? null,
      body.is_nominee ?? 'N', session.user.loginUserId,
    ]
  );

  return NextResponse.json({ emp_family_pkey: result.insertId }, { status: 201 });
}
