import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ported from LeaveRequestController::saveDocument() (controller.php:1543-1647) — appends a
// document to an existing leave entry. Legacy stores the uploaded file's path in file_name and the
// admin-typed display name in file_type (a confusing but real column-name swap in the source,
// confirmed against the controller) as comma-joined lists, letting a leave entry carry several
// documents over time; new uploads are appended, not replaced. Actual file storage is delegated to
// the existing generic /api/upload route rather than legacy's own hand-rolled MIME/size validation
// and local-disk path, since that endpoint already exists and is used elsewhere in this app.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { fileName, displayName } = body as { fileName?: string; displayName?: string };
  if (!fileName) {
    return NextResponse.json({ error: 'fileName is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    'SELECT EMP_fkey, file_name, file_type FROM leaveentries WHERE LEAVEENTRYID = ?',
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
  if (session.user.userGroup !== 1 && session.user.empFkey !== entry.EMP_fkey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const newFileName = entry.file_name ? `${entry.file_name},${fileName}` : fileName;
  const newFileType = entry.file_type ? `${entry.file_type},${displayName ?? ''}` : (displayName ?? '');

  await pool.execute(
    'UPDATE leaveentries SET file_name = ?, file_type = ? WHERE LEAVEENTRYID = ?',
    [newFileName, newFileType, id]
  );

  return NextResponse.json({ success: true });
}
