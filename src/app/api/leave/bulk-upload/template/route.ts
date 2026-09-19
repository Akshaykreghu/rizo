import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import * as XLSX from 'xlsx';

// Mirrors legacy EmployeeLeaveUploadController::uploadandsaveempctc()'s real column set.
// "Employee ID" is the login user_id (user_credentials.user_id), not emp_details.emp_id — matches
// legacy's own lookup (`UserCredentials->find(conditions => user_id)`), confirmed against source.
// "Leave Type" is the leave type's occurance code (e.g. CL, SL, EL — see salary_head_items.occurance),
// not its display name, also matching legacy's getLeaveTypeByOccurance() lookup.
export const TEMPLATE_HEADERS = [
  'Employee ID *', 'Employee Name *', 'Leave Type (code) *',
  'Leave Start Date * (yyyy-mm-dd)', 'Leave Start Session * (1=Full/Morning, 2=Afternoon)',
  'Leave End Date * (yyyy-mm-dd)', 'Leave End Session * (1=Morning, 2=Full/Afternoon)',
  'Reason',
];

// Ported from downloadempctcformat() (controller.php:797-946): the download is scoped by branch
// and/or employee (query params here, URL segments there) to pre-fill Employee ID/Name for the
// matching employees, so the admin doesn't have to type IDs by hand — leave dates/type/session
// are still filled in manually per row, same as legacy. Per-row Excel dropdown validation from
// that function can't be ported byte-for-byte (EmployeeCTCData.php, the vendor class defining that
// exact schema, isn't present in this repo); the Help sheet below documents the same lookups
// (leave type codes, session code meanings) instead.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const branch = searchParams.get('branch') ?? '';
  const employee = searchParams.get('employee') ?? '';

  const pool = await getCompanyPool(session.user.companyCode);
  const [leaveTypes] = await pool.execute<RowDataPacket[]>(
    `SELECT occurance, item FROM salary_head_items
     WHERE head_fkey = 6 AND value = 'Y' AND status = 1 AND occurance IS NOT NULL AND occurance <> ''
     ORDER BY item`
  );

  const conditions = ['ed.status = 1'];
  const values: string[] = [];
  if (branch) { conditions.push('ed.branch_code = ?'); values.push(branch); }
  if (employee) { conditions.push('ed.emp_pkey = ?'); values.push(employee); }

  const [employees] = await pool.execute<RowDataPacket[]>(
    `SELECT ei.employee_id, ei.EmpName
     FROM emp_details ed
     JOIN employee_info ei ON ei.emp_pkey = ed.emp_pkey
     WHERE ${conditions.join(' AND ')}
     ORDER BY ei.EmpName`,
    values
  );

  const rows = employees.map((e) => [String(e.employee_id ?? ''), String(e.EmpName ?? '')]);
  const worksheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...rows]);

  // Excel guesses a column's number/date format from context when cells are otherwise unstyled —
  // this has been observed turning a typed "1" in the Session columns into "01-01-1900" (Excel's
  // serial day 1), and a typed "2026-09-19" in the Date columns into the system locale's own date
  // display (e.g. "19-09-2026") once Excel decides the column is a date. Force explicit formats —
  // Text ('@') for the date columns so whatever is typed is kept verbatim (our parser reads a plain
  // yyyy-mm-dd string), plain integer ('0') for the session columns — on the header row and a block
  // of blank rows below the pre-filled employees, so Excel has a format to inherit before the admin
  // types into cells this route never touched.
  const dateCols = [3, 5]; // D: Leave Start Date, F: Leave End Date (0-indexed)
  const sessionCols = [4, 6]; // E: Leave Start Session, G: Leave End Session (0-indexed)
  const lastDataRow = Math.max(rows.length, 200); // cover typed-in rows well past the prefilled ones
  for (let r = 0; r <= lastDataRow; r++) {
    for (const c of dateCols) {
      const addr = XLSX.utils.encode_cell({ r, c });
      worksheet[addr] = { ...(worksheet[addr] ?? { t: 's', v: '' }), z: '@' };
    }
    for (const c of sessionCols) {
      const addr = XLSX.utils.encode_cell({ r, c });
      worksheet[addr] = { ...(worksheet[addr] ?? { t: 's', v: '' }), z: '0' };
    }
  }
  worksheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastDataRow, c: TEMPLATE_HEADERS.length - 1 } });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Leave Upload');

  const helpRows: (string | number)[][] = [
    ['Leave Type Codes', ''],
    ...leaveTypes.map((t) => [String(t.occurance ?? '').trim(), String(t.item ?? '').trim()]),
    ['', ''],
    ['Session Codes', ''],
    ['1', 'First Half'],
    ['2', 'Second Half'],
  ];
  const helpSheet = XLSX.utils.aoa_to_sheet(helpRows);
  XLSX.utils.book_append_sheet(workbook, helpSheet, 'Help');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="bulk_leave_upload_template.xlsx"',
    },
  });
}
