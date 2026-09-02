import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { dobError, mobileError, aadhaarError } from '@/lib/validation';

const JOIN_FIELDS = [
  'first_name', 'last_name', 'date_of_birth', 'email', 'mobile_no', 'address',
  'id_card', 'pincode', 'district', 'state', 'blood', 'maritual_status',
  'guradian', 'relation_guardian', 'classification', 'nationality_id', 'country_origin',
  'bank', 'bank_branch', 'ifsc_code', 'account_no', 'pf', 'company_pf', 'previous_member_id',
  'esi_dispensary', 'esi', 'eps', 'pan_no', 'international_worker', 'locomotive', 'hearing',
  'visual', 'physical_handicap', 'wps_code', 'lwf_code', 'profile_image_url',
] as const;

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? '1';
  const search = searchParams.get('search') ?? '';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1);
  const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') ?? '10') || 10);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = ['status = ?'];
  const params: (string | number)[] = [Number(status) || 1];
  if (search) {
    conditions.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR mobile_no LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const [[countRow], [rows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(`SELECT COUNT(*) as total FROM emp_join ${where}`, params),
    pool.execute<RowDataPacket[]>(
      `SELECT emp_join_pkey, status, emp_fkey, ${JOIN_FIELDS.join(', ')}
       FROM emp_join ${where} ORDER BY emp_join_pkey DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    ),
  ]);

  // Completion % is how many of the New Join form's fields (JOIN_FIELDS) are filled in — a
  // quick readiness signal for the admin before they continue onboarding. Computed here so
  // sensitive fields (bank details, Aadhaar, PAN, etc.) never leave the server.
  const data = rows.map((r) => {
    const filled = JOIN_FIELDS.filter((k) => r[k] !== null && r[k] !== undefined && String(r[k]).trim() !== '').length;
    return {
      emp_join_pkey: r.emp_join_pkey,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      mobile_no: r.mobile_no,
      date_of_birth: r.date_of_birth,
      status: r.status,
      emp_fkey: r.emp_fkey,
      profile_image_url: r.profile_image_url,
      completion_pct: Math.round((filled / JOIN_FIELDS.length) * 100),
    };
  });

  return NextResponse.json({ data, total: countRow[0]?.total ?? 0 });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  const validationError = dobError(body.date_of_birth ?? '') || mobileError(body.mobile_no ?? '') || aadhaarError(body.id_card ?? '');
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  // Legacy's Add Employee (Personal Info tab) requires Gender — mirror that here.
  if (!body.classification) {
    return NextResponse.json({ error: 'Gender is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const columns = JOIN_FIELDS.filter((k) => body[k] !== undefined && body[k] !== '');
  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map((k) => body[k]);

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_join (emp_fkey, status, ${columns.join(', ')}) VALUES (0, 1, ${placeholders})`,
    values
  );

  return NextResponse.json({ emp_join_pkey: result.insertId }, { status: 201 });
}
