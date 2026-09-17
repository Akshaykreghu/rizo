import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextResponse } from 'next/server';
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

// downloadempctcformat()'s per-employee prefilled rows and per-row Excel dropdown validation
// (controller.php:797-1069) can't be ported byte-for-byte: EmployeeCTCData.php, the vendor class
// that defines that exact schema, isn't present anywhere in this repo. This route instead adds a
// Help sheet documenting the same information legacy's help sheet communicates (leave type codes,
// session code meanings) so users don't have to guess — same intent, flat-file mechanism.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const [leaveTypes] = await pool.execute<RowDataPacket[]>(
    `SELECT occurance, item FROM salary_head_items
     WHERE head_fkey = 6 AND value = 'Y' AND status = 1 AND occurance IS NOT NULL AND occurance <> ''
     ORDER BY item`
  );

  const worksheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
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
