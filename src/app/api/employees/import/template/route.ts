import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// Legacy's Import Employee (DataUploaderController::downloadempdataformat/uploadandsaveempdetails)
// depends on a vendor field-list class (EmployeeCSVData.php) not present in this checkout, so this
// template is our own design rather than a byte-identical port. It keeps legacy's confirmed 6
// mandatory columns and adds the common optional fields our own Add Employee form supports.
// Branch is chosen once for the whole file (matches legacy: uploadandsaveempdetails($emp_branch)
// takes the branch as a single upload-time parameter, not a per-row column).
export const TEMPLATE_HEADERS = [
  'First Name *', 'Last Name', 'Date of Birth * (yyyy-mm-dd)', 'Joining Date * (yyyy-mm-dd)',
  'Employee Type *', 'Designation *', 'Department *', 'Grade', 'Mobile Number', 'Email Address',
  'Gender *', 'Aadhaar No', 'PAN No',
];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const worksheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Import Employee');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="import_employee_template.xlsx"',
    },
  });
}
