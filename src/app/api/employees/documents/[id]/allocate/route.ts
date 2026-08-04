import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

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
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT da.document_allocation_pkey, da.emp_fkey, da.allocated_by, da.allocated_date,
            ed.first_name, ed.last_name, ep.emp_company_id
     FROM document_allocation da
     JOIN emp_details ed ON ed.emp_pkey = da.emp_fkey
     LEFT JOIN emp_proff ep ON ep.emp_fkey = da.emp_fkey
     WHERE da.document_upload_fkey = ? AND da.status = 1
     ORDER BY ed.first_name`,
    [id]
  );
  return NextResponse.json(rows);
}

// Ports DocumentManagersController::save_allocate() — single-employee path only (the 'all
// employees' bulk path is a lower-value convenience wrapper, not built here).
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
  const empFkey = Number(body.emp_fkey);
  if (!empFkey) {
    return NextResponse.json({ error: 'emp_fkey is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [existing] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM document_allocation WHERE document_upload_fkey = ? AND emp_fkey = ? AND status = 1',
    [id, empFkey]
  );
  if (existing.length) {
    return NextResponse.json({ error: 'Employee already has this document allocated' }, { status: 409 });
  }

  await pool.execute(
    'INSERT INTO document_allocation (document_upload_fkey, emp_fkey, allocated_by, allocated_date, status) VALUES (?, ?, ?, NOW(), 1)',
    [id, empFkey, session.user.loginUserId]
  );
  await pool.execute(
    'UPDATE document_upload SET document_allocated_date = NOW(), document_allocated_by = ? WHERE document_upload_pkey = ?',
    [session.user.loginUserId, id]
  );

  return NextResponse.json({ success: true }, { status: 201 });
}
