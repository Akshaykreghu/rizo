import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { NextResponse } from 'next/server';
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

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const worksheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Leave Upload');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="bulk_leave_upload_template.xlsx"',
    },
  });
}
