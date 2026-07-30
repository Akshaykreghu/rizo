import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM comp_contact_info LIMIT 1'
  );
  return NextResponse.json(rows[0] ?? null);
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  await pool.execute(
    `UPDATE comp_contact_info SET
       business_name = ?, address = ?, city = ?, state = ?,
       pincode = ?, phone = ?, email = ?, website = ?,
       business_nature = ?, business_type = ?, logo = ?`,
    [body.business_name, body.address ?? null, body.city ?? null, body.state ?? null,
     body.pincode ?? null, body.phone ?? null, body.email ?? null, body.website ?? null,
     body.business_nature ?? null, body.business_type ?? null, body.logo ?? null]
  );
  return NextResponse.json({ success: true });
}
