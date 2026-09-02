import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { dobError, mobileError, aadhaarError } from '@/lib/validation';

const JOIN_FIELDS = [
  'first_name', 'last_name', 'date_of_birth', 'email', 'mobile_no', 'address',
  'id_card', 'pincode', 'district', 'state', 'blood', 'maritual_status',
  'guradian', 'relation_guardian', 'classification', 'nationality_id', 'country_origin',
  'bank', 'bank_branch', 'ifsc_code', 'account_no', 'pf', 'company_pf', 'previous_member_id',
  'esi_dispensary', 'esi', 'eps', 'pan_no', 'international_worker', 'locomotive', 'hearing',
  'visual', 'physical_handicap', 'wps_code', 'lwf_code', 'profile_image_url',
] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[joinRows], [documents], [education], [experience], [family]] = await Promise.all([
    pool.execute<RowDataPacket[]>('SELECT * FROM emp_join WHERE emp_join_pkey = ?', [id]),
    pool.execute<RowDataPacket[]>('SELECT * FROM emp_documents WHERE emp_join_fkey = ? AND status = 1', [id]),
    pool.execute<RowDataPacket[]>('SELECT * FROM Education WHERE emp_join_fkey = ? AND status = 1', [id]),
    pool.execute<RowDataPacket[]>('SELECT * FROM work_experience WHERE emp_join_fkey = ? AND status = 1', [id]),
    pool.execute<RowDataPacket[]>("SELECT * FROM family WHERE emp_join_fkey = ? AND status = 'Y'", [id]),
  ]);

  if (!joinRows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    join: joinRows[0],
    documents,
    education,
    experience,
    family,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const validationError =
    (body.date_of_birth !== undefined ? dobError(body.date_of_birth ?? '') : null) ||
    (body.mobile_no !== undefined ? mobileError(body.mobile_no ?? '') : null) ||
    (body.id_card !== undefined ? aadhaarError(body.id_card ?? '') : null) ||
    // Legacy requires Gender on the Personal Info tab — enforce it whenever the field is submitted.
    (body.classification !== undefined && !body.classification ? 'Gender is required' : null);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const columns = JOIN_FIELDS.filter((k) => body[k] !== undefined);
  if (!columns.length) return NextResponse.json({ success: true });

  const setClause = columns.map((k) => `${k} = ?`).join(', ');
  const values = columns.map((k) => (body[k] === '' ? null : body[k]));

  await pool.execute(
    `UPDATE emp_join SET ${setClause} WHERE emp_join_pkey = ?`,
    [...values, id]
  );

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  await pool.execute('DELETE FROM emp_join WHERE emp_join_pkey = ?', [id]);

  return NextResponse.json({ success: true });
}
