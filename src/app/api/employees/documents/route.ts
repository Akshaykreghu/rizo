import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports DocumentManagersController::documentUpload()/getDocumentsFromDatabase() — the standalone
// "Document Upload" library (feature_id 78, distinct from the per-employee identity/KYC Documents
// section on the employee profile page). Admin uploads a file once here, then allocates it to one
// or more employees via a separate step (documentAllocate()/save_allocate()). Matching this app's
// established precedent (no separate employee self-service login exists in this port), only the
// admin-facing library + allocate flow is built — not an employee-side "view my allocated docs" page.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT document_upload_pkey, document_name, document_path, type, created_by, creation_date,
            document_allocated_by, document_allocated_date
     FROM document_upload WHERE status = 1 ORDER BY creation_date DESC`
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
