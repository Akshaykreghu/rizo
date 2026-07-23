import type { Pool, RowDataPacket } from 'mysql2/promise';

// Shared helpers for Payroll Processing (PayrollController port, GRTL is not in legacy's
// $specialCompanies list so only the main calculate_salary_main_prc path is ported — the parallel
// salary_process_prc/tax_salary_process_prc path used by special tenants is out of scope). Verified
// live against mypayrol_mpm121 before wiring: payroll_master_insert, calculate_salary_main_prc,
// payroll_master_approve all confirmed via SHOW CREATE PROCEDURE. Note: payroll_master.month_year is
// 'YYYY-MM' but emp_variables_upload.month_year is 'MM-YYYY' — legacy reformats between the two
// (date_format(concat(month_year,'-01'),'%m-%Y')), replicated in monthYearToEvuFormat below.

export function monthYearToEvuFormat(monthYear: string): string {
  const [y, m] = monthYear.split('-');
  return `${m}-${y}`;
}

// Mirrors PayrollController::listpayroll()'s draft-seed path — calls payroll_master_insert, which
// itself deletes any pre-existing action IS NULL rows for the month/branch before reseeding from
// attendance_register (this is the real "reseed" mechanism, confirmed live).
export async function seedPayrollDraft(
  pool: Pool,
  branch: string,
  monthYear: string,
  userId: string
): Promise<string | null> {
  await pool.query('CALL payroll_master_insert(?, ?, ?, @err)', [branch, monthYear, userId]);
  const [[row]] = await pool.query<RowDataPacket[]>('SELECT @err AS err');
  return row?.err ?? null;
}

// Mirrors PayrollController::processpayroll()'s per-employee loop: calls calculate_salary_main_prc
// (sets payroll_master.action = 'Processed' itself, confirmed live inside the proc), then backfills
// the desig snapshot column exactly as legacy does via a separate designation lookup/update.
export async function processPayrollEmployee(
  pool: Pool,
  monthYear: string,
  branch: string,
  empPkey: number,
  payrollMasterPkey: number,
  userId: string
): Promise<string | null> {
  await pool.query('CALL calculate_salary_main_prc(?, ?, ?, ?, ?, @err)', [
    monthYear, branch, empPkey, payrollMasterPkey, userId,
  ]);
  const [[row]] = await pool.query<RowDataPacket[]>('SELECT @err AS err');

  const [[desigRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT d.desig_name FROM emp_proff p LEFT JOIN designation d ON d.desig_code = p.designation
     WHERE p.emp_fkey = ?`,
    [empPkey]
  );
  if (desigRow?.desig_name) {
    await pool.execute('UPDATE payroll_master SET desig = ? WHERE payroll_master_pkey = ?', [
      desigRow.desig_name, payrollMasterPkey,
    ]);
  }

  return row?.err ?? null;
}

// Mirrors PayrollController::approvepayroll(): payroll_master_approve settles pending advances/loans
// tied to this payslip; the action='Approved' flip happens separately in the caller (matches legacy,
// where the proc itself does not set action).
export async function approvePayrollEmployee(
  pool: Pool,
  branch: string,
  monthYear: string,
  empFkey: number,
  userId: string
): Promise<string | null> {
  await pool.query('CALL payroll_master_approve(?, ?, ?, ?, @err)', [branch, monthYear, empFkey, userId]);
  const [[row]] = await pool.query<RowDataPacket[]>('SELECT @err AS err');
  return row?.err ?? null;
}
