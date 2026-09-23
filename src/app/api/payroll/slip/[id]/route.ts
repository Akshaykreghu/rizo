import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors SalarySlipReportsController::Reports() — the real self-service payslip screen (reads
// emp_fkey from session, gated on action='Approved' exactly like pay-summary's own months filter)
// — not PayrollController::showsalaryslip()'s admin quick-view modal, which groups differently.
// The employee/statutory/bank fields below match reports.ctp's info panel field-for-field.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[header]] = await pool.execute<RowDataPacket[]>(
    `SELECT pm.payroll_master_pkey, pm.emp_fkey, pm.emp_name, pm.branch_code, pm.month_year, pm.days_presant,
            pm.days_leave, pm.loss_of_pay, pm.gross_salary, pm.net_salary, pm.total_deduction,
            pm.action, pm.bank_details, pm.desig, pm.departments, pm.working_days, pm.holidays,
            pm.week_off_days, ed.status AS emp_status,
            ep.emp_company_id, ep.joining_date, ed.classification,
            ed.company_pf, ed.esi, ed.pf AS uan_no,
            ed.bank_name, ed.account_no, ed.ifsc_code, ed.branch_name AS bank_branch_name
     FROM payroll_master pm
     LEFT JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
     LEFT JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
     WHERE pm.payroll_master_pkey = ?`,
    [id]
  );
  if (!header) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (session.user.userGroup !== 1 && session.user.empFkey !== header.emp_fkey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [lines] = await pool.execute<RowDataPacket[]>(
    `SELECT ess.head_type, ess.structure_det_value, ess.salary_head_item_desc, ess.salary_rate,
            ess.salary_amount, ess.head_operator, ess.item_part, sh.head_pkey, sh.head_desc
     FROM emp_salary_slip ess
     LEFT JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
     LEFT JOIN salary_heads sh ON sh.head_pkey = shi.head_fkey
     WHERE ess.payroll_master_fkey = ? AND ess.end_date_effective IS NULL
     ORDER BY sh.head_pkey ASC, ess.salary_head_item_fkey ASC`,
    [id]
  );

  interface SlipItem {
    salary_head_item_desc: string | null;
    head_operator: string | null;
    salary_amount: number | null;
    salary_rate: number | null;
    structure_det_value: number | null;
    head_type: string | null;
  }
  type Group = { head_pkey: number | null; head_desc: string; items: SlipItem[] };
  const direct = new Map<number | string, Group>();
  const indirect = new Map<number | string, Group>();

  for (const line of lines) {
    const bucket = line.item_part === 'Indirect' ? indirect : direct;
    const key = line.head_pkey ?? 'unknown';
    if (!bucket.has(key)) bucket.set(key, { head_pkey: line.head_pkey, head_desc: line.head_desc ?? '', items: [] });
    bucket.get(key)!.items.push({
      salary_head_item_desc: line.salary_head_item_desc,
      head_operator: line.head_operator,
      salary_amount: line.salary_amount,
      salary_rate: line.salary_rate,
      structure_det_value: line.structure_det_value,
      head_type: line.head_type,
    });
  }

  return NextResponse.json({
    header,
    direct: Array.from(direct.values()),
    indirect: Array.from(indirect.values()),
  });
}
