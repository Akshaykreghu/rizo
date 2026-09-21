import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { applyLeaveBalanceUpload, RESTRICTED_BALANCE_COMPANIES } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import * as XLSX from 'xlsx';

// Ports uploadandsaveempctcleavebalance() (controller.php:1222-1400). Mandatory column: Employee
// ID only, resolved via emp_details.emp_id — NOT via user_credentials/user_id like the leave-
// *request* bulk upload (route.ts in ../bulk-upload) does; this is a genuinely different lookup,
// confirmed against the legacy source (line 1325-1331: EmployeeDetails->find on emp_id).
//
// Legacy's column-parsing loop is fragile-by-construction: it walks each row's key/value pairs in
// column order, and whenever it hits a column whose header is a plain leave-type name it just
// remembers that type's head_fkey/head_name for whatever key comes *next* in iteration order —
// it only works because the sheet always places "Upload <item>" immediately after "<item>" and
// PHP preserves insertion order. That is reproduced here by its *effect* rather than its literal
// mechanism: for each active leave type we look up both its plain-name header and its
// "Upload <name>" header explicitly by name, and act on the Upload cell's value directly. Same
// outcome (an Upload-column value is attributed to that leave type), immune to column reordering.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const hasMissingMandatory = rows.some((row) => !String(row['Employee ID'] ?? '').trim());
  if (hasMissingMandatory) {
    return NextResponse.json({ error: 'Please check all mandatory fields entered' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const companyCode = session.user.companyCode;

  const [leaveTypes] = await pool.execute<RowDataPacket[]>(
    `SELECT salary_head_item_pkey, item FROM salary_head_items
     WHERE head_fkey IN (SELECT head_pkey FROM salary_heads WHERE LCASE(item_type) = 'leave' AND value = 'Y' AND status = 1)
       AND status = 1`
  );
  const leaveTypesByName = new Map<string, number>();
  for (const t of leaveTypes) {
    leaveTypesByName.set(String(t.item ?? '').trim(), Number(t.salary_head_item_pkey));
  }

  const errors: { row: number; message: string }[] = [];
  let imported = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const empId = String(row['Employee ID'] ?? '').trim();
    const [[emp]] = await pool.execute<RowDataPacket[]>(
      `SELECT ed.emp_pkey, ed.first_name, ed.middile_name, ed.last_name, ep.emp_company_id
       FROM emp_details ed LEFT JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
       WHERE ed.emp_id = ? AND ed.status = 1`,
      [empId]
    );
    if (!emp?.emp_pkey) {
      errors.push({ row: rowNum, message: `No employee found for Employee ID "${empId}"` });
      continue;
    }
    const empName = [emp.first_name, emp.middile_name, emp.last_name].filter(Boolean).join(' ').trim();

    let rowImported = 0;
    for (const [itemName, salaryHeadItemFkey] of leaveTypesByName) {
      const uploadValue = row[`Upload ${itemName}`];
      if (uploadValue === '' || uploadValue === null || uploadValue === undefined) continue;

      await pool.execute<ResultSetHeader>(
        `INSERT INTO leave_balance_upload
           (empid, emp_name, leave_type, item, leave_balance, created_by, created_date, status)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), 1)`,
        [emp.emp_company_id ?? '', empName, salaryHeadItemFkey, itemName, Number(uploadValue) || 0, session.user.loginUserId]
      );
      rowImported++;
    }
    if (rowImported > 0) imported++;
  }

  if (RESTRICTED_BALANCE_COMPANIES.includes(companyCode)) {
    await applyLeaveBalanceUpload(pool, companyCode);
  }

  return NextResponse.json({ imported, errors });
}
