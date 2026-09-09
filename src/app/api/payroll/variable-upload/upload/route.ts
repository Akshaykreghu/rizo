import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { bulkImportVariableUploads } from '@/lib/variableUpload';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// Mirrors VariableController::uploadandsaveempvar(). The file carries one row per employee; the
// target salary head + month come as form fields (as in legacy). Appends a new emp_variables_upload
// row per sheet line — payroll SUM()s multiple rows for the same head/month.

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file');
  const salaryHeadItemFkey = Number(formData.get('salaryHeadItemFkey'));
  const month = String(formData.get('month') ?? ''); // 'YYYY-MM'

  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  if (!salaryHeadItemFkey || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'salaryHeadItemFkey and month are required' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const pool = await getCompanyPool(session.user.companyCode);
  const result = await bulkImportVariableUploads(
    pool,
    sheetRows,
    salaryHeadItemFkey,
    month,
    session.user.loginUserId
  );
  return NextResponse.json({ success: true, ...result });
}
