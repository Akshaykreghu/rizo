import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

const FIELDS = [
  'company_name', 'reg', 'address', 'city', 'state', 'pincode', 'email', 'relationship',
  'phone', 'tin', 'pan_no', 'gst', 'bank_name', 'bank_branch', 'ifsc_code', 'account_no',
  'first_name', 'last_name', 'c_designation',
] as const;

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
  const pool = await getCompanyPool(session.user.companyCode);

  const values = FIELDS.map((f) =>
    f === 'phone' || f === 'account_no' ? Number(body[f]) || 0 : body[f] ?? ''
  );
  await pool.execute(
    `UPDATE contacts SET ${FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE contact_id = ?`,
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

  await pool.execute('UPDATE contacts SET status = 0 WHERE contact_id = ?', [id]);
  return NextResponse.json({ success: true });
}
