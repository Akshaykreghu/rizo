import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports DocumentManagersController::documentUpload()/getDocumentsFromDatabase() — the standalone
// "Document Upload" library (feature_id 78, distinct from the per-employee identity/KYC Documents
// section on the employee profile page). Admin uploads a file once here, then allocates it to one
// or more employees via a separate step (documentAllocate()/save_allocate()). Matches legacy's
// document_master.ctp: admins see/manage the full library, regular employees get a read-only view
// scoped to documents allocated to them (via document_allocation).
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const search = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  const pool = await getCompanyPool(session.user.companyCode);

  if (session.user.userGroup === 1) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT du.document_upload_pkey, du.document_name, du.document_path, du.type, du.created_by, du.creation_date,
              du.document_allocated_by, du.document_allocated_date,
              EXISTS(
                SELECT 1 FROM document_allocation da
                WHERE da.document_upload_fkey = du.document_upload_pkey AND da.status = 1
              ) AS is_allocated
       FROM document_upload du
       WHERE du.status = 1 ${search ? 'AND du.document_name LIKE ?' : ''}
       ORDER BY du.creation_date DESC`,
      search ? [`%${search}%`] : []
    );
    return NextResponse.json(rows);
  }

  if (!session.user.empFkey) {
    return NextResponse.json([]);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT du.document_upload_pkey, du.document_name, du.document_path, du.type, du.created_by, du.creation_date,
            du.document_allocated_by, du.document_allocated_date
     FROM document_upload du
     WHERE du.status = 1
       AND du.document_upload_pkey IN (
         SELECT DISTINCT document_upload_fkey FROM document_allocation WHERE emp_fkey = ? AND status = 1
       )
       ${search ? 'AND du.document_name LIKE ?' : ''}
     ORDER BY du.creation_date DESC`,
    search ? [session.user.empFkey, `%${search}%`] : [session.user.empFkey]
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  if (!body.document_name || !body.document_path) {
    return NextResponse.json({ error: 'document_name and document_path are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO document_upload (document_name, document_path, type, created_by, creation_date, status)
     VALUES (?, ?, ?, ?, NOW(), 1)`,
    [body.document_name, body.document_path, body.type ?? null, session.user.loginUserId]
  );
  return NextResponse.json({ document_upload_pkey: result.insertId }, { status: 201 });
}
