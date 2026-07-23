import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

// Shared helpers for Salary Increments (SalaryIncrementController.php port). Scoped to the
// single-employee, gross-level increment flow (item='N', is_multiple='N') — legacy also supports
// a per-component (item='Y') increment editor and multi-employee batch mode; both are deferred
// (would require reproducing a very large dynamic per-component form) and not built here.
// Verified live: salary_hike/salary_hike_details/emp_ctc_upload schemas, copy_salary_structure_to_new
// proc, and the emp_ctc_upload_ai AFTER INSERT trigger (which itself calls
// sal_structure_distribution_fn) — the actual salary-structure regeneration on an increment happens
// DB-side via that trigger on a plain INSERT into emp_ctc_upload, not in application code, so this
// file relies on that trigger firing rather than reimplementing distribution logic in TypeScript.

export interface IncrementDraftInput {
  empFkey: number;
  structureId: number;
  newGross: number;
  withEffectFrom: string;
  nextIncrementDate: string;
  payoutMonth?: string;
  remarks?: string;
}

async function getCurrentGross(pool: Pool, empFkey: number): Promise<number> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT SUM(structure_det_value) AS gross FROM emp_salary_structure
     WHERE emp_fkey = ? AND end_date_effective IS NULL
       AND salary_head_item_fkey IN (SELECT salary_head_item_pkey FROM salary_head_items WHERE head_fkey = 1 AND status = 1)
       AND head_operator = 'Addition' AND item_part = 'Direct'`,
    [empFkey]
  );
  return Number(row?.gross ?? 0);
}

// Mirrors SalaryIncrementController::saveIncrement() (gross-level branch).
export async function createIncrementDraft(pool: Pool, input: IncrementDraftInput, userId: string) {
  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT branch_code FROM emp_details WHERE emp_pkey = ?', [input.empFkey]
  );
  if (!emp) throw new Error('Employee not found');

  const [[proff]] = await pool.execute<RowDataPacket[]>(
    'SELECT structure_id FROM emp_proff WHERE emp_fkey = ?', [input.empFkey]
  );
  const currentStructureId = Number(proff?.structure_id ?? 0);
  const structureChange = currentStructureId !== Number(input.structureId) ? 'Y' : 'N';

  const gross = await getCurrentGross(pool, input.empFkey);

  const [[gcRow]] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS cnt FROM emp_ctc_transaction WHERE emp_fkey = ? AND end_date_effective IS NULL',
    [input.empFkey]
  );
  const grossCount = Number(gcRow?.cnt ?? 0);

  let newGross = input.newGross;
  let incrementAmount: number;
  if (grossCount !== 0) {
    incrementAmount = newGross - gross;
  } else {
    incrementAmount = newGross - gross;
    newGross = incrementAmount;
  }
  const incrementPercentage = gross > 0 ? (incrementAmount / gross) * 100 : 0;

  const monthYear = input.withEffectFrom.slice(0, 7);
  const [[processedRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM payroll_master WHERE emp_fkey = ? AND month_year = ? AND action IN ('Approved', 'Processed')`,
    [input.empFkey, monthYear]
  );
  const arrearSalary = Number(processedRow?.cnt ?? 0) > 0 ? 'Y' : 'N';

  const [hikeResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO salary_hike (is_multiple, item, structure_change, action, remarks, created_by, status)
     VALUES ('N', 'N', ?, NULL, ?, ?, 1)`,
    [structureChange, input.remarks ?? null, userId]
  );
  const hikeId = hikeResult.insertId;

  // salary_hike_details.payout_month is NOT NULL and strict SQL mode rejects legacy's own
  // '0000-00-00' placeholder via a parameterized insert, so default to the effective month
  // instead of replicating that literal (process() below still resolves a real payout month
  // from payroll history if this default isn't what's wanted).
  const payoutMonth = input.payoutMonth ? `${input.payoutMonth}-01` : `${input.withEffectFrom.slice(0, 7)}-01`;

  await pool.execute(
    `INSERT INTO salary_hike_details
       (salary_hike_fkey, item, branch_code, emp_fkey, structure_id, with_effect_from,
        next_increment_date, payout_month, current_amount, new_amount, increment_amount,
        increment_percentage, arrear_salary, status, processed)
     VALUES (?, 'N', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'N')`,
    [
      hikeId, emp.branch_code, input.empFkey, input.structureId, input.withEffectFrom,
      input.nextIncrementDate, payoutMonth, gross, newGross, incrementAmount,
      incrementPercentage, arrearSalary,
    ]
  );

  return { hikeId };
}

export interface ProcessResult {
  success: boolean;
  notProcessed: string[];
  invalidSalary: string[];
}

// Mirrors SalaryIncrementController::process() for the single-employee gross-level case.
export async function processIncrement(pool: Pool, hikePkey: number, userId: string): Promise<ProcessResult> {
  const [[hike]] = await pool.execute<RowDataPacket[]>(
    'SELECT structure_change FROM salary_hike WHERE salary_hike_pkey = ?', [hikePkey]
  );
  const structureChange = hike?.structure_change ?? 'N';

  const [details] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_fkey, structure_id, branch_code, with_effect_from, next_increment_date,
            payout_month, new_amount, arrear_salary
     FROM salary_hike_details WHERE salary_hike_fkey = ? AND status = 1 AND processed = 'N'`,
    [hikePkey]
  );

  const notProcessed: string[] = [];
  const invalidSalary: string[] = [];
  let processedCount = 0;

  for (const row of details) {
    const empFkey = row.emp_fkey;

    if (structureChange === 'Y') {
      const [[proff]] = await pool.execute<RowDataPacket[]>(
        'SELECT structure_id FROM emp_proff WHERE emp_fkey = ?', [empFkey]
      );
      if (Number(proff?.structure_id ?? 0) !== Number(row.structure_id)) continue;
    }

    const [[proff]] = await pool.execute<RowDataPacket[]>(
      `SELECT designation, emp_branch, structure_id, joining_date, emp_company_id, emp_type
       FROM emp_proff WHERE emp_fkey = ?`,
      [empFkey]
    );
    const [[name]] = await pool.execute<RowDataPacket[]>(
      `SELECT CONCAT(COALESCE(first_name,''),' ',COALESCE(last_name,'')) AS emp_name FROM emp_details WHERE emp_pkey = ?`,
      [empFkey]
    );
    const empLabel = `${(name?.emp_name ?? '').trim()} - ${proff?.emp_company_id ?? ''}`;

    const structureId = Number(proff?.structure_id ?? 0);
    const joiningDate: string = proff?.joining_date ?? '';
    let withEffectFrom: string = row.with_effect_from
      ? new Date(row.with_effect_from).toISOString().slice(0, 10)
      : '';
    if (!withEffectFrom || withEffectFrom === '0000-00-00') {
      withEffectFrom = structureId === 0 ? joiningDate : new Date().toISOString().slice(0, 10);
    }

    if (!joiningDate || joiningDate > withEffectFrom) {
      notProcessed.push(empLabel);
      continue;
    }

    let payoutMonth: string = row.payout_month
      ? new Date(row.payout_month).toISOString().slice(0, 10)
      : '';
    if (!payoutMonth || payoutMonth === '0000-00-00') {
      if (structureId === 0) {
        payoutMonth = joiningDate ? `${joiningDate.slice(0, 7)}-01` : `${new Date().toISOString().slice(0, 7)}-01`;
      } else {
        const [[latest]] = await pool.execute<RowDataPacket[]>(
          `SELECT MAX(month_year) AS latest FROM payroll_master WHERE emp_fkey = ? AND action = 'Processed'`,
          [empFkey]
        );
        if (latest?.latest) {
          const d = new Date(`${latest.latest}-01`);
          d.setMonth(d.getMonth() + 1);
          payoutMonth = `${d.toISOString().slice(0, 7)}-01`;
        } else if (joiningDate) {
          const d = new Date(joiningDate);
          d.setMonth(d.getMonth() + 1);
          payoutMonth = `${d.toISOString().slice(0, 7)}-01`;
        } else {
          payoutMonth = `${new Date().toISOString().slice(0, 7)}-01`;
        }
      }
    }

    const grossSalary = Number(row.new_amount ?? 0);

    const effectiveStructureId = structureChange === 'Y' || structureId === 0 ? Number(row.structure_id) : structureId;
    const [[structRow]] = await pool.execute<RowDataPacket[]>(
      'SELECT structure_eg_amt FROM salary_structure WHERE structure_id = ?', [effectiveStructureId]
    );
    const structureEgAmt = Number(structRow?.structure_eg_amt ?? 0);

    if (structureEgAmt > grossSalary) {
      invalidSalary.push(empLabel);
      continue;
    }

    await pool.query('CALL copy_salary_structure_to_new(?)', [empFkey]);

    const empType = (proff?.emp_type ?? '').toString().trim().toUpperCase();
    const annualCtc = empType === 'DAILY WAGES' || empType === 'HOURLY WAGES' ? grossSalary : grossSalary * 12;

    // Triggers emp_ctc_upload_ai (AAFTER INSERT), which cascades into emp_ctc_transaction and
    // sal_structure_distribution_fn — the real structure regeneration happens there, DB-side.
    // approved_by is `int` live even though legacy writes the string login_user_id into it (a
    // real schema/code mismatch — MySQL's non-strict mode silently coerced it there); left NULL
    // here rather than writing a fabricated numeric value.
    await pool.execute(
      `INSERT INTO emp_ctc_upload
         (emp_fkey, emp_anual_ctc, emp_monthly_ctc, arrear_salary, pay_out_month, created_by,
          start_date_effective, approved_by, next_increment_date, branch, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1)`,
      [
        empFkey, annualCtc, grossSalary, row.arrear_salary, payoutMonth, userId,
        withEffectFrom, row.next_increment_date, proff?.emp_branch ?? row.branch_code,
      ]
    );

    await pool.execute(
      `UPDATE salary_hike_details SET processed = 'Y', payout_month = ?
       WHERE salary_hike_fkey = ? AND emp_fkey = ? AND status = 1 AND processed = 'N'`,
      [payoutMonth, hikePkey, empFkey]
    );
    processedCount++;
  }

  const success = details.length > 0 && processedCount > 0 && notProcessed.length === 0 && invalidSalary.length === 0;
  if (processedCount > 0) {
    await pool.execute(`UPDATE salary_hike SET action = 'Processed' WHERE salary_hike_pkey = ?`, [hikePkey]);
  }

  return { success, notProcessed, invalidSalary };
}
