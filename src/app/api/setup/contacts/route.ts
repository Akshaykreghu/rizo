import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const FIELDS = [
  'company_name', 'reg', 'address', 'city', 'state', 'pincode', 'email', 'relationship',
  'phone', 'tin', 'pan_no', 'gst', 'bank_name', 'bank_branch', 'ifsc_code', 'account_no',
  'first_name', 'last_name', 'c_designation',
] as const;

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') ?? '';
  const relationship = searchParams.get('relationship') ?? '';

  const conditions: string[] = ['status = 1'];
  const params: string[] = [];
  if (search) {
    conditions.push('(first_name LIKE ? OR company_name LIKE ? OR email LIKE ? OR phone LIKE ? OR city LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  if (relationship) {
    conditions.push('relationship = ?');
    params.push(relationship);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT contact_id, company_name, first_name, relationship, email, phone, city, state
     FROM contacts WHERE ${conditions.join(' AND ')} ORDER BY company_name`,
    params
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  // phone/account_no are NOT NULL bigint columns — default to 0 rather than an empty string
  const values = FIELDS.map((f) =>
    f === 'phone' || f === 'account_no' ? Number(body[f]) || 0 : body[f] ?? ''
  );
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO contacts (${FIELDS.join(', ')}, status) VALUES (${FIELDS.map(() => '?').join(', ')}, 1)`,
    values
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
