import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// Column order matches the legacy Employee Join bulk-upload template exactly
// (EmployeeController.php downloadempdataformatjoin()).
export const TEMPLATE_HEADERS = [
  'Name *', 'Birth Date * (yyyy-mm-dd)', 'Gender *', 'Email Address', 'Phone Number',
  'Address', 'Pin Code', 'Nationality *', 'State', 'District', 'Marital Status',
  'Guardian Name', 'Relation', 'Blood Group', 'Aadhaar No *', 'PAN No', 'Bank Name',
  'Branch', 'IFSC Code', 'Account Number', 'ESI No', 'ESI Dispensary', 'PF No', 'UAN No',
  'Previous Member ID', 'WPS ID', 'LWF Registration No', 'EPS Eligibility (Yes/No)',
  'Physical Handicap (Yes/No)', 'International Worker (Yes/No)', 'Country of Origin',
  'Locomotive (Yes/No)', 'Hearing (Yes/No)', 'Visual (Yes/No)',
];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const worksheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Employee Join');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="employee_join_template.xlsx"',
    },
  });
}
