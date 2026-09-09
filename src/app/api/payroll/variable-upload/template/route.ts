import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import * as XLSX from 'xlsx';

// Mirrors VariableController::downloadvariableuploadform()'s admin (user_group 1) column shape:
// User ID | Employee Company ID | Employee Name | Gross Salary | Monthly CTC | Amount | Remarks.
// "User ID" is the login user_id (user_credentials.user_id) — that's what the import resolves on.
// Gross Salary = emp_anual_ctc / 12; Monthly CTC = SUM of the fixed (non-manual, non-variable)
// ADDITION components of the current salary structure — the same formula legacy uses. Amount /
// Remarks are left blank for the admin to fill in. The chosen salary head + month are passed to the
// upload endpoint as fields, not columns (legacy does the same).

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const branch = sp.get('branch') ?? '';
  const empFkey = sp.get('empFkey');

  const conditions = ['ed.status = 1'];
  const args: (string | number)[] = [];
  if (branch) {
    conditions.push('ed.branch_code = ?');
    args.push(branch);
  }
  if (empFkey) {
    conditions.push('ed.emp_pkey = ?');
    args.push(Number(empFkey));
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const [employees] = await pool.execute<RowDataPacket[]>(
    `SELECT uc.user_id,
            ep.emp_company_id,
            CONCAT_WS(' ', ed.first_name, NULLIF(ed.middile_name,''), ed.last_name) AS emp_name,
            ROUND(COALESCE(ect.emp_anual_ctc,0) / 12, 2) AS gross_salary,
            ROUND(COALESCE((
              SELECT SUM(ess.structure_det_value)
              FROM emp_salary_structure ess
              WHERE ess.emp_fkey = ed.emp_pkey
                AND ess.head_operator = 'ADDITION'
                AND LOWER(ess.head_type) NOT IN ('manually','variable')
                AND ess.end_date_effective IS NULL
            ), 0), 2) AS monthly_ctc
     FROM emp_details ed
     JOIN user_credentials uc ON uc.emp_fkey = ed.emp_pkey
     LEFT JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
     LEFT JOIN emp_ctc_transaction ect ON ect.emp_fkey = ed.emp_pkey AND ect.end_date_effective IS NULL
     WHERE ${conditions.join(' AND ')}
     ORDER BY ed.first_name ASC`,
    args
  );

  const headers = [
    'User ID', 'Employee Company ID', 'Employee Name', 'Gross Salary', 'Monthly CTC', 'Amount', 'Remarks',
  ];
  const rows = employees.map((e) => [
    e.user_id, e.emp_company_id ?? '', e.emp_name, e.gross_salary, e.monthly_ctc, '', '',
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet['!cols'] = [{ wch: 16 }, { wch: 20 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 24 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Variable Upload');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const fileName = `${session.user.companyCode.toLowerCase()}_variable.xlsx`;
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  });
}
