import type { Pool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

/**
 * Mirrors legacy DocumentManagerController::getPlaceholder()/saveDocument(): templates store
 * raw HTML with {:token} placeholders, merged against a specific employee/company/branch at
 * generation time. This is a curated subset of legacy's ~65 tokens (Employee/Company/Branch
 * groups only — Supplier/Customer/Others and the image-composite/salary-breakup tokens are out
 * of scope for this pass), using legacy's exact spelling where confirmed (including its
 * `empolyee_name` typo) and our own consistent naming for the rest, documented in the template
 * editor's placeholder reference panel rather than assumed byte-identical to legacy.
 */
export async function buildMergeTokens(pool: Pool, empFkey: number): Promise<Record<string, string>> {
  const [[emp]] = await pool.execute<RowDataPacket[]>(
    `SELECT e.first_name, e.last_name, e.emp_id, e.blood, e.address, e.city, e.state, e.pincode,
            e.mobile_no, e.email, e.classification, e.maritual_status, e.date_of_birth, e.pan_no,
            e.bank_name, e.branch_name AS bank_branch_name, e.ifsc_code, e.account_no,
            p.joining_date, p.notice_days, p.emp_branch,
            ds.desig_name, d.dept_name, b.branch_name, b.address AS branch_address,
            b.city AS branch_city, b.state AS branch_state, b.pincode AS branch_pincode
     FROM emp_details e
     LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
     LEFT JOIN designation ds ON ds.desig_code = p.designation
     LEFT JOIN department d ON d.dept_code = p.emp_dept
     LEFT JOIN branches b ON b.branch_code = p.emp_branch
     WHERE e.emp_pkey = ?`,
    [empFkey]
  );

  const [[ctc]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_anual_ctc, emp_monthly_ctc FROM emp_ctc_upload WHERE emp_fkey = ? ORDER BY emp_ctc_upload_pkey DESC LIMIT 1',
    [empFkey]
  );

  const [[company]] = await pool.execute<RowDataPacket[]>('SELECT * FROM comp_contact_info LIMIT 1');

  const fmt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '');

  return {
    'empolyee_name': `${emp?.first_name ?? ''} ${emp?.last_name ?? ''}`.trim(),
    'employee_id': emp?.emp_id ?? '',
    'employee_designation': emp?.desig_name ?? '',
    'employee_department': emp?.dept_name ?? '',
    'employee_branch': emp?.branch_name ?? '',
    'employee_joining_date': fmt(emp?.joining_date),
    'employee_notice_days': emp?.notice_days != null ? String(emp.notice_days) : '',
    'blood_group': emp?.blood ?? '',
    'employee_address': emp?.address ?? '',
    'employee_city': emp?.city ?? '',
    'employee_state': emp?.state ?? '',
    'employee_pincode': emp?.pincode ?? '',
    'employee_mobile': emp?.mobile_no ?? '',
    'employee_email': emp?.email ?? '',
    'employee_gender': emp?.classification ?? '',
    'employee_marital_status': emp?.maritual_status ?? '',
    'employee_dob': fmt(emp?.date_of_birth),
    'employee_pan': emp?.pan_no ?? '',
    'employee_bank_name': emp?.bank_name ?? '',
    'employee_bank_branch': emp?.bank_branch_name ?? '',
    'employee_ifsc_code': emp?.ifsc_code ?? '',
    'employee_account_no': emp?.account_no ?? '',
    'employee_ctc': ctc?.emp_anual_ctc != null ? String(ctc.emp_anual_ctc) : '',
    'employee_monthly_ctc': ctc?.emp_monthly_ctc != null ? String(ctc.emp_monthly_ctc) : '',
    'comp_business_name': company?.business_name ?? '',
    'comp_business_nature': company?.business_nature ?? '',
    'comp_business_type': company?.business_type ?? '',
    'comp_address': company?.address ?? '',
    'comp_city': company?.city ?? '',
    'comp_state': company?.state ?? '',
    'comp_pincode': company?.pincode ?? '',
    'comp_phone': company?.phone ?? '',
    'comp_fax': company?.fax ?? '',
    'branch_name': emp?.branch_name ?? '',
    'branch_address': emp?.branch_address ?? '',
    'branch_city': emp?.branch_city ?? '',
    'branch_state': emp?.branch_state ?? '',
    'branch_pincode': emp?.branch_pincode ?? '',
    'current_date': fmt(new Date()),
  };
}

export function mergeTemplate(html: string, tokens: Record<string, string>): string {
  return html.replace(/\{:(\w+)\}/g, (match, key) => (key in tokens ? tokens[key] : match));
}

export const PLACEHOLDER_REFERENCE: { group: string; tokens: string[] }[] = [
  { group: 'Employee', tokens: [
    'empolyee_name', 'employee_id', 'employee_designation', 'employee_department', 'employee_branch',
    'employee_joining_date', 'employee_notice_days', 'blood_group', 'employee_address', 'employee_city',
    'employee_state', 'employee_pincode', 'employee_mobile', 'employee_email', 'employee_gender',
    'employee_marital_status', 'employee_dob', 'employee_pan', 'employee_bank_name', 'employee_bank_branch',
    'employee_ifsc_code', 'employee_account_no', 'employee_ctc', 'employee_monthly_ctc',
  ] },
  { group: 'Company', tokens: ['comp_business_name', 'comp_business_nature', 'comp_business_type', 'comp_address', 'comp_city', 'comp_state', 'comp_pincode', 'comp_phone', 'comp_fax'] },
  { group: 'Branch', tokens: ['branch_name', 'branch_address', 'branch_city', 'branch_state', 'branch_pincode'] },
  { group: 'Other', tokens: ['current_date'] },
];
