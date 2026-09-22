import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { RESTRICTED_BALANCE_COMPANIES } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import * as XLSX from 'xlsx';

// Ports downloadLeaveBalanceUploadctc() (controller.php:1013-1219): Sl No./Employee ID/User ID/
// Employee Name, then two columns per active non-Indirect leave type — the plain item name holds
// the current computed balance (read-only reference), "Upload <item>" is left blank for the admin
// to fill with the corrected/actual balance. Cells not in the employee's own leavepolicy are
// grey-filled, matching legacy's highlight.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const branch = searchParams.get('branch') ?? '';
  const employee = searchParams.get('employee') ?? '';
  const companyCode = session.user.companyCode;

  const pool = await getCompanyPool(companyCode);

  const [leaveTypes] = await pool.execute<RowDataPacket[]>(
    `SELECT salary_head_item_pkey, item FROM salary_head_items
     WHERE head_fkey IN (SELECT head_pkey FROM salary_heads WHERE LCASE(item_type) = 'leave' AND value = 'Y' AND status = 1)
       AND (item_part IS NULL OR item_part <> 'Indirect')
       AND status = 1
     ORDER BY salary_head_item_order1, salary_head_item_pkey`
  );

  const conditions = ['ed.status = 1'];
  const values: (string | number)[] = [];
  if (branch) { conditions.push('ed.branch_code = ?'); values.push(branch); }
  if (employee) { conditions.push('ed.emp_pkey = ?'); values.push(Number(employee)); }

  const [employees] = await pool.execute<RowDataPacket[]>(
    `SELECT CONCAT(ed.first_name,' ',IFNULL(ed.last_name,'')) AS emp_name,
            ed.emp_pkey, ed.emp_id, pf.emp_company_id
     FROM emp_details ed
     LEFT JOIN emp_proff pf ON ed.emp_pkey = pf.emp_fkey
     JOIN branches b ON ed.branch_code = b.branch_code AND b.status = 1
     WHERE ${conditions.join(' AND ')}
     ORDER BY ed.emp_pkey, ed.first_name ASC`,
    values
  );

  const isRestricted = RESTRICTED_BALANCE_COMPANIES.includes(companyCode);

  const header = ['Sl No.', 'Employee ID', 'User ID', 'Employee Name'];
  for (const t of leaveTypes) {
    const name = String(t.item ?? '').trim();
    header.push(name, `Upload ${name}`);
  }

  const aoa: (string | number)[][] = [header];
  const unallocatedMarkers: string[] = [];
  let slNo = 1;
  for (const emp of employees) {
    const empPkey = Number(emp.emp_pkey);

    const [allocated] = await pool.execute<RowDataPacket[]>(
      `SELECT salary_head_item_fkey FROM leavepolicy
       WHERE status = 1 AND LEAVEPOLICY_GROUP_ID IN (SELECT LEAVEPOLICY_GROUP_ID FROM emp_proff WHERE emp_fkey = ?)`,
      [empPkey]
    );
    const allocatedIds = new Set(allocated.map((a) => Number(a.salary_head_item_fkey)));

    const [[finYear]] = await pool.execute<RowDataPacket[]>(
      `SELECT fin_year FROM fin_year
       WHERE Year_status = 'OPEN' AND is_current_finyear = 'Y' AND status = 1 AND vattr1 = 0
         AND branch_code IN (SELECT branch_code FROM emp_details WHERE emp_pkey = ?)`,
      [empPkey]
    );

    const rowArr: (string | number)[] = [slNo, String(emp.emp_id ?? ''), String(emp.emp_company_id ?? ''), String(emp.emp_name ?? '')];
    const rowIndex = aoa.length; // 0-based data row index within aoa, before push

    for (const t of leaveTypes) {
      const salHead = Number(t.salary_head_item_pkey);
      let balance = 0;
      if (isRestricted && finYear?.fin_year) {
        const [[bal]] = await pool.query<RowDataPacket[]>(
          'SELECT leave_balance_inthe_year_fn(?, ?, ?) AS bal',
          [empPkey, salHead, String(finYear.fin_year)]
        );
        balance = Number(bal?.bal ?? 0);
      } else if (!isRestricted) {
        const [[bal]] = await pool.query<RowDataPacket[]>(
          'SELECT leave_balance_inthe_year_fn(?, ?, NULL) AS bal',
          [empPkey, salHead]
        );
        balance = Number(bal?.bal ?? 0);
      }
      const colBase = rowArr.length;
      rowArr.push(balance, '');
      if (!allocatedIds.has(salHead)) {
        unallocatedMarkers.push(`row ${rowIndex + 1}, ${String(t.item ?? '').trim()}`);
      }
    }
    aoa.push(rowArr);
    slNo++;
  }

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  // Same lesson as bulk-upload/template/route.ts: force a plain-number format on the current-
  // balance columns so Excel doesn't reinterpret a value like "1" or "0" oddly once the column
  // also contains blanks (the adjacent Upload column) — belt-and-braces, not strictly required
  // since these are genuine numbers, but cheap insurance against Excel's per-column format guess.
  const numericCols: number[] = [];
  for (let i = 0; i < leaveTypes.length; i++) numericCols.push(4 + i * 2);
  const lastRow = Math.max(aoa.length - 1, 1);
  for (let r = 1; r <= lastRow; r++) {
    for (const c of numericCols) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (worksheet[addr]) worksheet[addr].z = '0';
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Leave Balance Upload');

  // Legacy grey-fills cells for leave types not in the employee's own policy (PHPExcel supports
  // arbitrary cell fills). The `xlsx` package used here is the community (non-Pro) SheetJS build,
  // which cannot write cell fill styles at all — there is no equivalent call to make. Rather than
  // silently drop the signal, the same information is surfaced as a plain-text note sheet instead.
  if (unallocatedMarkers.length > 0) {
    const notesSheet = XLSX.utils.aoa_to_sheet([
      ["Not in employee's leave policy (informational only - legacy greys these cells, unsupported by this export)"],
      ...unallocatedMarkers.map((m) => [m]),
    ]);
    XLSX.utils.book_append_sheet(workbook, notesSheet, 'Notes');
  }

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const fileName = `${companyCode.toLowerCase()}_leave_balance_upload.xlsx`;
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  });
}
