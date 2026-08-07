import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { resolveFileUrl } from '@/lib/storage';

// Mirrors TaxController::setupdownload_new()/downloadtaxdocument_modal(): Form-16 documents are
// matched to an employee via PAN (emp_details.pan_no), not a direct FK — same lookup as legacy.
// Files resolve to Spaces (production) or public/uploads/<company>/form16/ (local dev fallback),
// so this just returns the matching rows; no separate download endpoint is needed.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const finYear = request.nextUrl.searchParams.get('finYear');
  const pool = await getCompanyPool(session.user.companyCode);

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT pan_no FROM emp_details WHERE emp_pkey = ?', [id]
  );
  if (!emp?.pan_no) return NextResponse.json({ documents: [] });

  const params_: (string | number)[] = [emp.pan_no];
  let finYearClause = '';
  if (finYear) {
    finYearClause = 'AND fin_year = ?';
    params_.push(finYear);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT form_name, pan, fin_year, created_by, created_date
     FROM tax_form_documents WHERE pan = ? AND status = 1 ${finYearClause}
     ORDER BY created_date DESC`,
    params_
  );

  const documents = rows.map((r) => ({
    ...r,
    path: resolveFileUrl(session.user.companyCode, 'form16', String(r.form_name)),
  }));

  return NextResponse.json({ documents });
}
