import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { evaluateArithmetic } from './salaryFormula';
import { allocateSalaryStructure } from './salaryStructureAllocate';

// Shared helpers for Salary Increments (SalaryIncrementController.php port). Covers the
// single-employee flow at both levels — gross (item='N') and per-component (item='Y') — plus the
// revision worklist. Multi-employee batch mode (is_multiple='Y') and CSV upload are still deferred.
// Verified live: salary_hike/salary_hike_details/emp_ctc_upload schemas, copy_salary_structure_to_new
// proc, and the emp_ctc_upload_ai AFTER INSERT trigger (which itself calls
// sal_structure_distribution_fn) — the actual salary-structure regeneration on a gross increment
// happens DB-side via that trigger on a plain INSERT into emp_ctc_upload, not in application code.
// The item flow instead goes through emp_salcomp_upload + ctc_component_update_and_upload_prc +
// salary_structure_limit_prc, mirroring processItem().

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

    // Legacy applies salary_structure_limit_prc after every structure regeneration
    // (alterSalaryStructure() and processItem() both call it explicitly). process() itself
    // leans on the emp_ctc_upload trigger for distribution, but the per-item limit ceilings
    // still have to be enforced on top of the regenerated structure.
    await pool.query('CALL salary_structure_limit_prc(?, ?, @perr_msg)', [empFkey, userId]);

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

// ---------------------------------------------------------------------------
// Structure-change pre-pass (mirrors SalaryIncrementController::alterSalaryStructure())
// ---------------------------------------------------------------------------
//
// The legacy "Process" button (view.ctp) chains alterSalaryStructure -> process/processItem
// whenever salary_hike.structure_change = 'Y'. This function is that first step: for every
// employee in the batch whose drafted structure differs from their current one (or who has no
// structure yet), run the statutory / salary gates and then move them onto the target structure
// via allocateSalaryStructure() (shared with Bulk Policy Allocation). processIncrement() /
// processItemIncrement() then find emp_proff.structure_id already aligned and proceed normally;
// employees blocked here keep their old structure and are skipped by those functions' existing
// structure_change guard — exactly as in legacy.

export interface AlterStructurePerEmployee {
  emp_fkey: number;
  emp_name: string;
  ok: boolean;
  note?: string;
  formula_warnings: string[];
}

export interface AlterStructureResult {
  perEmployee: AlterStructurePerEmployee[];
  missingFields: string[];
  wrongSalary: string[];
}

// Resolves with_effect_from / payout_month with the same fallback rules processIncrement() uses
// inline (kept separate here to avoid touching that verified path).
async function resolveEffectiveDates(
  pool: Pool,
  args: {
    empFkey: number;
    currentStructureId: number;
    joiningDate: string;
    rawWithEffectFrom: unknown;
    rawPayoutMonth: unknown;
  }
): Promise<{ withEffectFrom: string; payoutMonth: string }> {
  const { empFkey, currentStructureId, joiningDate } = args;

  let withEffectFrom = args.rawWithEffectFrom
    ? new Date(args.rawWithEffectFrom as string).toISOString().slice(0, 10)
    : '';
  if (!withEffectFrom || withEffectFrom === '0000-00-00') {
    withEffectFrom = currentStructureId === 0 ? joiningDate : new Date().toISOString().slice(0, 10);
  }

  let payoutMonth = args.rawPayoutMonth
    ? new Date(args.rawPayoutMonth as string).toISOString().slice(0, 10)
    : '';
  if (!payoutMonth || payoutMonth === '0000-00-00') {
    if (currentStructureId === 0) {
      payoutMonth = joiningDate ? `${joiningDate.slice(0, 7)}-01` : `${new Date().toISOString().slice(0, 7)}-01`;
    } else {
      const [[latest]] = await pool.execute<RowDataPacket[]>(
        `SELECT MAX(month_year) AS latest FROM payroll_master WHERE emp_fkey = ? AND action = 'Processed'`,
        [empFkey]
      );
      if (latest?.latest) {
        payoutMonth = `${shiftMonth(String(latest.latest), 1)}-01`;
      } else if (joiningDate) {
        payoutMonth = `${shiftMonth(joiningDate.slice(0, 7), 1)}-01`;
      } else {
        payoutMonth = `${new Date().toISOString().slice(0, 7)}-01`;
      }
    }
  }
  return { withEffectFrom, payoutMonth };
}

export async function alterSalaryStructure(
  pool: Pool,
  hikePkey: number,
  userId: string,
  companyCode: string
): Promise<AlterStructureResult> {
  const [pairs] = await pool.execute<RowDataPacket[]>(
    `SELECT DISTINCT emp_fkey, structure_id FROM salary_hike_details
     WHERE salary_hike_fkey = ? AND status = 1`,
    [hikePkey]
  );

  const perEmployee: AlterStructurePerEmployee[] = [];
  const missingFields: string[] = [];
  const wrongSalary: string[] = [];

  for (const pair of pairs) {
    const targetStructureId = Number(pair.structure_id);
    const empFkey = Number(pair.emp_fkey);
    if (targetStructureId === 0) continue; // legacy: `if ($structure_id != 0)`

    const [[proff]] = await pool.execute<RowDataPacket[]>(
      `SELECT structure_id, joining_date, emp_company_id, emp_type, emp_branch
       FROM emp_proff WHERE emp_fkey = ?`,
      [empFkey]
    );
    const [[nameRow]] = await pool.execute<RowDataPacket[]>(
      `SELECT CONCAT(EmpName, ' - ', employee_id) AS emp_name FROM employee_info WHERE emp_pkey = ?`,
      [empFkey]
    );
    const empName = String(nameRow?.emp_name ?? '').trim();
    const currentStructureId = Number(proff?.structure_id ?? 0);
    const joiningDate: string = proff?.joining_date
      ? new Date(proff.joining_date).toISOString().slice(0, 10)
      : '';

    // Legacy reads $arr_shd[0] off a `GROUP BY emp_fkey` query; all of an employee's detail rows
    // in one hike carry the same dates, so take the first row directly (a bare GROUP BY with
    // non-aggregated selects is rejected under only_full_group_by, which this connection enables).
    const [[draftDates]] = await pool.execute<RowDataPacket[]>(
      `SELECT with_effect_from, next_increment_date, payout_month
       FROM salary_hike_details
       WHERE salary_hike_fkey = ? AND emp_fkey = ? AND status = 1
       ORDER BY salary_hike_details_pkey
       LIMIT 1`,
      [hikePkey, empFkey]
    );

    const { withEffectFrom, payoutMonth } = await resolveEffectiveDates(pool, {
      empFkey,
      currentStructureId,
      joiningDate,
      rawWithEffectFrom: draftDates?.with_effect_from,
      rawPayoutMonth: draftDates?.payout_month,
    });
    const nextIncrementDate = draftDates?.next_increment_date
      ? new Date(draftDates.next_increment_date).toISOString().slice(0, 10)
      : null;

    // Joining-date guard (legacy silently `continue`s here).
    if (!joiningDate || joiningDate > withEffectFrom) {
      perEmployee.push({ emp_fkey: empFkey, emp_name: empName, ok: false, note: 'Joining date missing or after the effective date.', formula_warnings: [] });
      continue;
    }

    // total = SUM(new_amount) over the draft's Direct / head_fkey=1 rows (legacy `arr_total`).
    const [[totalRow]] = await pool.execute<RowDataPacket[]>(
      `SELECT SUM(new_amount) AS amount FROM salary_hike_details shd
       WHERE shd.salary_hike_fkey = ? AND shd.emp_fkey = ? AND shd.status = 1
         AND (shd.item <> 'Y' OR shd.salary_head_item_fkey IN (
           SELECT salary_head_item_pkey FROM salary_head_items
           WHERE head_fkey = 1 AND item_part = 'Direct' AND status = 1))`,
      [hikePkey, empFkey]
    );
    const total = Number(totalRow?.amount ?? 0);

    const [[structRow]] = await pool.execute<RowDataPacket[]>(
      `SELECT structure_eg_amt FROM salary_structure WHERE structure_id = ? AND structure_active = 1`,
      [targetStructureId]
    );
    const structureEgAmt = Number(structRow?.structure_eg_amt ?? 0);

    // Statutory-field pre-check — port of legacy's `arr_statuttory_fields` UNION query.
    const [[statRow]] = await pool.execute<RowDataPacket[]>(
      `SELECT GROUP_CONCAT(DISTINCT missing_item SEPARATOR ', ') AS missing_fields FROM (
         SELECT 'UAN No' AS missing_item
         FROM salary_structure_details ssd
         LEFT JOIN salary_head_items shi ON shi.salary_head_item_pkey = ssd.salary_head_item_fkey
         LEFT JOIN emp_details ed ON ed.emp_pkey = ?
         WHERE ssd.structure_id = ? AND ssd.structure_det_value <> 0
           AND (UPPER(shi.item) LIKE '%EPF%' OR UPPER(shi.item) LIKE '%PF%' OR UPPER(shi.item) LIKE '%PROVIDENT FUND%')
           AND (ed.company_pf IS NULL OR TRIM(ed.pf) = '')
         UNION ALL
         SELECT 'ESI No'
         FROM salary_structure_details ssd
         LEFT JOIN salary_head_items shi ON shi.salary_head_item_pkey = ssd.salary_head_item_fkey
         LEFT JOIN emp_details ed ON ed.emp_pkey = ?
         WHERE ssd.structure_id = ? AND ssd.structure_det_value <> 0
           AND shi.item LIKE '%ESI%' AND (ed.esi IS NULL OR TRIM(ed.esi) = '')
         UNION ALL
         SELECT 'LWF Registration Number'
         FROM salary_structure_details ssd
         LEFT JOIN salary_head_items shi ON shi.salary_head_item_pkey = ssd.salary_head_item_fkey
         LEFT JOIN emp_details ed ON ed.emp_pkey = ?
         WHERE ssd.structure_id = ? AND ssd.structure_det_value <> 0
           AND shi.item LIKE '%LWF%' AND (ed.lwf_code IS NULL OR TRIM(ed.lwf_code) = '')
         UNION ALL
         SELECT 'PAN No'
         FROM salary_structure_details ssd
         LEFT JOIN tax_salary_components tsc ON tsc.salary_head_item_Fkey = ssd.salary_head_item_fkey
         LEFT JOIN emp_details ed ON ed.emp_pkey = ?
         WHERE ssd.structure_id = ? AND ssd.structure_det_value <> 0
           AND TRIM(tsc.tax_salary_components_name) = 'TDS' AND (ed.pan_no IS NULL OR TRIM(ed.pan_no) = '')
       ) t`,
      [empFkey, targetStructureId, empFkey, targetStructureId, empFkey, targetStructureId, empFkey, targetStructureId]
    );
    const missing = String(statRow?.missing_fields ?? '').trim();
    if (missing) {
      missingFields.push(`Fields missing for ${empName} : ${missing}`);
      perEmployee.push({ emp_fkey: empFkey, emp_name: empName, ok: false, note: `Missing: ${missing}`, formula_warnings: [] });
      continue;
    }

    // Wrong-salary gate (legacy: `if ($structure_eg_amt > $total)`).
    if (structureEgAmt > total) {
      wrongSalary.push(`Incorrect salary for ${empName}`);
      perEmployee.push({ emp_fkey: empFkey, emp_name: empName, ok: false, note: `New salary ${total} is below the structure minimum ${structureEgAmt}.`, formula_warnings: [] });
      continue;
    }

    if (targetStructureId === currentStructureId) {
      // Nothing to move (legacy pushes response[]=0 for this case).
      perEmployee.push({ emp_fkey: empFkey, emp_name: empName, ok: false, note: 'Already on the target structure.', formula_warnings: [] });
      continue;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // First-time allocation: seed a CTC row so sal_structure_distribution_fn has an active
      // emp_ctc_transaction to work against. Legacy inserts via the EmployeeCTC model, which maps
      // to emp_ctc_upload; its AFTER INSERT trigger (emp_ctc_upload_ai) creates the
      // emp_ctc_transaction row. Only for no-current-structure employees with no CTC yet.
      if (currentStructureId === 0) {
        const [[ctcRow]] = await conn.execute<RowDataPacket[]>(
          'SELECT COUNT(*) AS cnt FROM emp_ctc_transaction WHERE emp_fkey = ? AND end_date_effective IS NULL',
          [empFkey]
        );
        if (Number(ctcRow?.cnt ?? 0) === 0) {
          if (total <= 0) { await conn.rollback(); continue; }
          const empType = String(proff?.emp_type ?? '').trim().toUpperCase();
          const annualCtc = empType === 'DAILY WAGES' || empType === 'HOURLY WAGES' ? total : total * 12;
          // approved_by is `int` live even though legacy writes the string login id into it;
          // left NULL here (same divergence already documented in processIncrement()).
          await conn.execute(
            `INSERT INTO emp_ctc_upload
               (emp_fkey, emp_anual_ctc, emp_monthly_ctc, arrear_salary, pay_out_month, created_by,
                start_date_effective, approved_by, next_increment_date, branch, status)
             VALUES (?, ?, ?, 'N', ?, ?, ?, NULL, ?, ?, 1)`,
            [
              empFkey, annualCtc, total, payoutMonth, userId, withEffectFrom,
              nextIncrementDate, proff?.emp_branch ?? null,
            ]
          );
        }
      }

      const { ok, formulaWarnings } = await allocateSalaryStructure(conn, {
        companyCode, userId, empFkey, structureId: targetStructureId,
      });

      await conn.commit();
      perEmployee.push({
        emp_fkey: empFkey,
        emp_name: empName,
        ok,
        note: ok ? undefined : 'sal_structure_distribution_fn returned 0 — no structure rows were created.',
        formula_warnings: formulaWarnings,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  return { perEmployee, missingFields, wrongSalary };
}

// ---------------------------------------------------------------------------
// Batch view + soft delete (mirrors viewSalaryIncrementForm() / deleteIncrement())
// ---------------------------------------------------------------------------

export interface IncrementBatchDetail {
  salary_hike_details_pkey: number;
  emp_fkey: number;
  emp_name: string;
  emp_company_id: string;
  salary_head_item_fkey: number | null;
  component_name: string | null;
  structure_id: number;
  structure_name: string | null;
  with_effect_from: string | null;
  next_increment_date: string | null;
  payout_month: string | null;
  current_amount: number;
  new_amount: number;
  increment_amount: number;
  increment_percentage: number;
  arrear_salary: string;
  processed: string;
}

export async function getIncrementBatch(pool: Pool, hikePkey: number) {
  const [[hike]] = await pool.execute<RowDataPacket[]>(
    `SELECT salary_hike_pkey, is_multiple, item, structure_change, action, remarks, creation_date
     FROM salary_hike WHERE salary_hike_pkey = ? AND status = 1`,
    [hikePkey]
  );
  if (!hike) return null;

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT shd.salary_hike_details_pkey, shd.emp_fkey,
            TRIM(CONCAT(COALESCE(ed.first_name,''),' ',COALESCE(ed.last_name,''))) AS emp_name,
            ep.emp_company_id, shd.salary_head_item_fkey, shi.item AS component_name,
            shd.structure_id, ss.structure_name, shd.with_effect_from, shd.next_increment_date,
            shd.payout_month, shd.current_amount, shd.new_amount, shd.increment_amount,
            shd.increment_percentage, shd.arrear_salary, shd.processed
     FROM salary_hike_details shd
     LEFT JOIN emp_details ed ON ed.emp_pkey = shd.emp_fkey
     LEFT JOIN emp_proff ep ON ep.emp_fkey = shd.emp_fkey
     LEFT JOIN salary_head_items shi ON shi.salary_head_item_pkey = shd.salary_head_item_fkey
     LEFT JOIN salary_structure ss ON ss.structure_id = shd.structure_id
     WHERE shd.salary_hike_fkey = ? AND shd.status = 1
     ORDER BY emp_name, shd.salary_head_item_fkey`,
    [hikePkey]
  );

  const details: IncrementBatchDetail[] = rows.map((r) => ({
    salary_hike_details_pkey: Number(r.salary_hike_details_pkey),
    emp_fkey: Number(r.emp_fkey),
    emp_name: String(r.emp_name ?? '').trim(),
    emp_company_id: String(r.emp_company_id ?? ''),
    salary_head_item_fkey: r.salary_head_item_fkey != null ? Number(r.salary_head_item_fkey) : null,
    component_name: r.component_name != null ? String(r.component_name).trim() : null,
    structure_id: Number(r.structure_id),
    structure_name: r.structure_name != null ? String(r.structure_name) : null,
    with_effect_from: r.with_effect_from ? new Date(r.with_effect_from).toISOString().slice(0, 10) : null,
    next_increment_date: r.next_increment_date ? new Date(r.next_increment_date).toISOString().slice(0, 10) : null,
    payout_month: r.payout_month ? new Date(r.payout_month).toISOString().slice(0, 10) : null,
    current_amount: Number(r.current_amount ?? 0),
    new_amount: Number(r.new_amount ?? 0),
    increment_amount: Number(r.increment_amount ?? 0),
    increment_percentage: Number(r.increment_percentage ?? 0),
    arrear_salary: String(r.arrear_salary ?? 'N'),
    processed: String(r.processed ?? 'N'),
  }));

  return { hike, details };
}

// Mirrors SalaryIncrementController::deleteIncrement() — soft delete only.
export async function deleteIncrementDraft(pool: Pool, hikePkey: number): Promise<void> {
  await pool.execute('UPDATE salary_hike SET status = 0 WHERE salary_hike_pkey = ?', [hikePkey]);
}

// ---------------------------------------------------------------------------
// Arrear check (mirrors onEffectiveDateChange())
// ---------------------------------------------------------------------------

export interface ArrearCheck {
  isProcessed: boolean;
  action: string;
  message: string;
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export async function checkArrear(
  pool: Pool,
  empFkey: number,
  effectiveDate: string, // YYYY-MM-DD
  companyCode: string
): Promise<ArrearCheck> {
  let month = effectiveDate.slice(0, 7);

  // Non-KWMT tenants resolve the payroll month against the attendance-cycle boundaries
  // (att_start_end_fn '1' = cycle start, '2' = cycle end); KWMT just uses the calendar month.
  if (companyCode.toUpperCase() !== 'KWMT') {
    const [[b]] = await pool.query<RowDataPacket[]>(
      'SELECT att_start_end_fn(?, ?) AS start_date, att_start_end_fn(?, ?) AS end_date',
      [effectiveDate, '1', effectiveDate, '2']
    );
    const startDate: string | null = b?.start_date ? String(b.start_date) : null;
    const endDate: string | null = b?.end_date ? String(b.end_date) : null;
    if (startDate && effectiveDate < startDate) month = shiftMonth(month, -1);
    else if (endDate && effectiveDate > endDate) month = shiftMonth(month, 1);
  }

  const [[cnt]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM payroll_master
     WHERE emp_fkey = ? AND month_year = ? AND action IN ('Approved', 'Processed')`,
    [empFkey, month]
  );
  const [[act]] = await pool.execute<RowDataPacket[]>(
    `SELECT action FROM payroll_master
     WHERE emp_fkey = ? AND month_year = ? AND action IN ('Approved', 'Processed') LIMIT 1`,
    [empFkey, month]
  );

  const isProcessed = Number(cnt?.cnt ?? 0) > 0;
  const action = String(act?.action ?? '').toLowerCase();
  return {
    isProcessed,
    action,
    message: isProcessed
      ? `Payroll is already ${action} for this month — this increment will be paid as arrear.`
      : 'Payroll is not yet processed for this month.',
  };
}

// ---------------------------------------------------------------------------
// Revision worklist + summary (mirrors employeelistPending() / getSummaryValue())
// ---------------------------------------------------------------------------

export interface IncrementSummary {
  noStructure: number;
  due: number;
  overDue: number;
}

export async function getIncrementSummary(pool: Pool): Promise<IncrementSummary> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN ep.structure_id IS NULL THEN 1 ELSE 0 END) AS no_structure,
       SUM(CASE WHEN ect.next_increment_date IS NOT NULL
                 AND ect.next_increment_date <> '0000-00-00'
                 AND DATEDIFF(ect.next_increment_date, CURDATE()) <= 44
                 AND ect.next_increment_date >= CURDATE()
                THEN 1 ELSE 0 END) AS due,
       SUM(CASE WHEN ect.next_increment_date IS NOT NULL
                 AND ect.next_increment_date <> '0000-00-00'
                 AND ect.next_increment_date < CURDATE()
                THEN 1 ELSE 0 END) AS over_due
     FROM employee_info ei
     LEFT JOIN emp_proff ep ON ep.emp_fkey = ei.emp_pkey
     LEFT JOIN emp_ctc_transaction ect ON (ect.emp_fkey = ep.emp_fkey AND ect.end_date_effective IS NULL)
     WHERE ei.emp_status = 1`
  );
  return {
    noStructure: Number(row?.no_structure ?? 0),
    due: Number(row?.due ?? 0),
    overDue: Number(row?.over_due ?? 0),
  };
}

export type PendingEmpStatus = 'Due' | 'Overdue' | 'NoStructure' | 'None';

export interface PendingEmpRow {
  emp_fkey: number;
  emp_name: string;
  emp_company_id: string;
  branch: string;
  salary_structure: string;
  next_increment_date: string | null;
  status: PendingEmpStatus;
}

export async function listPendingEmployees(
  pool: Pool,
  filters: { status?: string; branch?: string; structureId?: string; empName?: string }
): Promise<PendingEmpRow[]> {
  const DUE = "ect.next_increment_date IS NOT NULL AND ect.next_increment_date <> '0000-00-00' AND DATEDIFF(ect.next_increment_date, CURDATE()) <= 44 AND ect.next_increment_date >= CURDATE()";
  const OVERDUE = "ect.next_increment_date IS NOT NULL AND ect.next_increment_date <> '0000-00-00' AND ect.next_increment_date < CURDATE()";
  const NO_STRUCTURE = 'ep.structure_id IS NULL';

  const where: string[] = ['ei.emp_status = 1'];
  const params: (string | number)[] = [];

  switch (filters.status) {
    case 'Due': where.push(`(${DUE})`); break;
    case 'Overdue': where.push(`(${OVERDUE})`); break;
    case 'NoStructure': where.push(`(${NO_STRUCTURE})`); break;
    default: where.push(`((${DUE}) OR (${OVERDUE}) OR (${NO_STRUCTURE}))`);
  }
  if (filters.branch) { where.push('ei.branch_code = ?'); params.push(filters.branch); }
  if (filters.structureId) { where.push('ep.structure_id = ?'); params.push(filters.structureId); }
  if (filters.empName?.trim()) { where.push('ei.EmpName LIKE ?'); params.push(`%${filters.empName.trim()}%`); }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ei.emp_pkey AS emp_fkey, ei.EmpName AS emp_name, ei.employee_id AS emp_company_id,
            ei.branch, ss.structure_name, ect.next_increment_date, ep.structure_id
     FROM employee_info ei
     LEFT JOIN emp_proff ep ON ep.emp_fkey = ei.emp_pkey
     LEFT JOIN emp_ctc_transaction ect ON (ect.emp_fkey = ep.emp_fkey AND ect.end_date_effective IS NULL)
     LEFT JOIN salary_structure ss ON ss.structure_id = ep.structure_id
     WHERE ${where.join(' AND ')}
     GROUP BY ei.emp_pkey
     ORDER BY CASE WHEN ect.next_increment_date IS NULL THEN 1 ELSE 0 END,
              COALESCE(ect.next_increment_date, '9999-12-31') ASC, ei.EmpName ASC
     LIMIT 1000`,
    params
  );

  const todayTs = new Date(new Date().toISOString().slice(0, 10)).getTime();
  return rows.map((r): PendingEmpRow => {
    let status: PendingEmpStatus = 'None';
    if (r.next_increment_date) {
      const nidTs = new Date(new Date(r.next_increment_date).toISOString().slice(0, 10)).getTime();
      const diffDays = (nidTs - todayTs) / 86_400_000;
      if (diffDays < 0) status = 'Overdue';
      else if (diffDays <= 44) status = 'Due';
    }
    if (!r.structure_id) status = 'NoStructure';
    return {
      emp_fkey: Number(r.emp_fkey),
      emp_name: String(r.emp_name ?? '').trim(),
      emp_company_id: String(r.emp_company_id ?? ''),
      branch: String(r.branch ?? ''),
      salary_structure: String(r.structure_name ?? ''),
      next_increment_date: r.next_increment_date
        ? new Date(r.next_increment_date).toISOString().slice(0, 10)
        : null,
      status,
    };
  });
}

// ---------------------------------------------------------------------------
// Employee current-state lookup for the Salary Update form
// (mirrors getSalaryStructure() / getGrossByEmp())
// ---------------------------------------------------------------------------

export interface StructureLine {
  salary_head_item_fkey: number;
  desc: string;
  value: number;
}

export interface EmployeeCurrentStructure {
  structure_id: number | null;
  monthly_gross: number;
  annual_ctc: number | null;
  next_increment_date: string | null;
  emp: {
    emp_name: string;
    emp_company_id: string;
    branch: string;
    designation: string;
    department: string;
    joining_date: string | null;
  };
  // Legacy getSalaryStructure() returns exactly these three filtered groups. In the form,
  // only `structure` (Monthly Salary Components) is user-editable; `structure_indirect` and
  // `emp_contribution` are read-only and only change when the recalculation sends new values.
  structure: StructureLine[];          // Addition / Direct / head_pkey = 1
  structure_indirect: StructureLine[]; // Addition / Indirect / head_pkey <> 1 / head_fkey IN (4,10)
  emp_contribution: StructureLine[];   // Deduction / Direct / head_pkey <> 1 / head_fkey = 5
  // Every active component's current value, keyed by item fkey — display-only, used to fill the
  // "Current" column of the gross-mode preview for lines outside the three editable groups.
  all_current: Record<number, number>;
}

export async function getEmployeeCurrentStructure(pool: Pool, empFkey: number): Promise<EmployeeCurrentStructure> {
  const [[proff]] = await pool.execute<RowDataPacket[]>(
    `SELECT ep.structure_id, ep.emp_type, ep.emp_company_id,
            ei.EmpName, ei.branch, ei.designation, ei.department, ei.joining_date
     FROM emp_proff ep
     LEFT JOIN employee_info ei ON ei.emp_pkey = ep.emp_fkey
     WHERE ep.emp_fkey = ?`,
    [empFkey]
  );

  const monthlyGross = await getCurrentGross(pool, empFkey);

  const [[ctcRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_anual_ctc, next_increment_date FROM emp_ctc_transaction
     WHERE emp_fkey = ? AND end_date_effective IS NULL LIMIT 1`,
    [empFkey]
  );

  const toLines = (rows: RowDataPacket[]): StructureLine[] =>
    rows.map((r) => ({
      salary_head_item_fkey: Number(r.salary_head_item_fkey),
      desc: String(r.salary_head_item_desc ?? '').trim(),
      value: Number(r.structure_det_value ?? 0),
    }));

  // The three groups, each mirroring one of getSalaryStructure()'s queries exactly, plus a
  // full current-value map for the preview's "Current" column.
  const [directRows, indirectRows, contribRows, allRows] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT ess.salary_head_item_fkey, ess.salary_head_item_desc, ess.structure_det_value
       FROM emp_salary_structure ess
       LEFT JOIN salary_head_items shi ON ess.salary_head_item_fkey = shi.salary_head_item_pkey
       LEFT JOIN salary_heads sh ON shi.head_fkey = sh.head_pkey
       WHERE ess.emp_fkey = ? AND TRIM(ess.head_operator) = 'Addition'
         AND TRIM(ess.item_part) = 'Direct' AND ess.end_date_effective IS NULL
         AND sh.head_pkey = 1`,
      [empFkey]
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT ess.salary_head_item_fkey, ess.salary_head_item_desc, ess.structure_det_value
       FROM emp_salary_structure ess
       LEFT JOIN salary_head_items shi ON ess.salary_head_item_fkey = shi.salary_head_item_pkey
       LEFT JOIN salary_heads sh ON shi.head_fkey = sh.head_pkey
       WHERE ess.emp_fkey = ? AND TRIM(ess.head_operator) = 'Addition'
         AND TRIM(ess.item_part) = 'Indirect' AND ess.end_date_effective IS NULL
         AND sh.head_pkey <> 1
         AND ess.salary_head_item_fkey IN
           (SELECT salary_head_item_pkey FROM salary_head_items WHERE head_fkey IN (4, 10))`,
      [empFkey]
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT ess.salary_head_item_fkey, ess.salary_head_item_desc, ess.structure_det_value
       FROM emp_salary_structure ess
       LEFT JOIN salary_head_items shi ON ess.salary_head_item_fkey = shi.salary_head_item_pkey
       LEFT JOIN salary_heads sh ON shi.head_fkey = sh.head_pkey
       WHERE ess.emp_fkey = ? AND TRIM(ess.head_operator) = 'Deduction'
         AND TRIM(ess.item_part) = 'Direct' AND ess.end_date_effective IS NULL
         AND sh.head_pkey <> 1
         AND ess.salary_head_item_fkey IN
           (SELECT salary_head_item_pkey FROM salary_head_items WHERE head_fkey = 5)`,
      [empFkey]
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT salary_head_item_fkey, structure_det_value
       FROM emp_salary_structure WHERE emp_fkey = ? AND end_date_effective IS NULL`,
      [empFkey]
    ),
  ]);

  const allCurrent: Record<number, number> = {};
  for (const r of allRows[0]) allCurrent[Number(r.salary_head_item_fkey)] = Number(r.structure_det_value ?? 0);

  const nid = ctcRow?.next_increment_date;
  return {
    structure_id: proff?.structure_id ? Number(proff.structure_id) : null,
    monthly_gross: monthlyGross,
    annual_ctc: ctcRow?.emp_anual_ctc != null ? Number(ctcRow.emp_anual_ctc) : null,
    next_increment_date: nid && String(nid) !== '0000-00-00'
      ? new Date(nid).toISOString().slice(0, 10)
      : null,
    emp: {
      emp_name: String(proff?.EmpName ?? '').trim(),
      emp_company_id: String(proff?.emp_company_id ?? ''),
      branch: String(proff?.branch ?? ''),
      designation: String(proff?.designation ?? ''),
      department: String(proff?.department ?? ''),
      joining_date: proff?.joining_date ? new Date(proff.joining_date).toISOString().slice(0, 10) : null,
    },
    structure: toLines(directRows[0]),
    structure_indirect: toLines(indirectRows[0]),
    emp_contribution: toLines(contribRows[0]),
    all_current: allCurrent,
  };
}

// ---------------------------------------------------------------------------
// Component-level ("item") increment — single employee
// (mirrors saveIncrement() item='Y', onIncrementChangeNew(), processItem())
// ---------------------------------------------------------------------------

export interface ComponentRecalcInput {
  structureId: number;
  changedItemPkey: number;
  newValue: number;
  grossAmount: number;
  /** itemPkey -> the "new" value currently shown for every editable row */
  newValues: Record<string, number>;
}

// Mirrors SalaryIncrementController::onIncrementChangeNew() — given one component's new value,
// recompute every dependent component from calculate_emp_component_breakup + the stored formula,
// applying the operator (limit / limit_wl / limit_wg / fixed) and deduction sign.
export async function recalcComponentBreakup(
  pool: Pool,
  input: ComponentRecalcInput
): Promise<{ salary_head_item_fkey: number; calculated_value: number }[]> {
  const { structureId, changedItemPkey, newValue, grossAmount, newValues } = input;

  const [callRes] = await pool.query<RowDataPacket[][]>(
    'CALL calculate_emp_component_breakup(?, ?, ?, ?)',
    [structureId, changedItemPkey, newValue, grossAmount]
  );
  const rows = (callRes[0] ?? []) as unknown as RowDataPacket[];
  if (!rows.length) return [];

  const [[rb]] = await pool.execute<RowDataPacket[]>(
    `SELECT structure_derived_perc FROM salary_structure_details
     WHERE structure_id = ? AND TRIM(structure_formula) = 'Remaining Balance' LIMIT 1`,
    [structureId]
  );
  const rembalance = (grossAmount * Number(rb?.structure_derived_perc ?? 0)) / 100;

  const out: { salary_head_item_fkey: number; calculated_value: number }[] = [];
  for (const row of rows) {
    const temp = (row.salary_breakup_temp ?? row) as RowDataPacket;
    const itemPkey = Number(temp.salary_head_item_fkey);

    if (itemPkey === Number(changedItemPkey)) {
      out.push({ salary_head_item_fkey: itemPkey, calculated_value: newValue });
      continue;
    }

    let calculated = 0;
    const formula = String(temp.structure_det_calequation ?? '');
    if (formula.trim()) {
      const expr = formula
        .replace(/monthsal/g, String(grossAmount))
        .replace(/rembalance/g, String(rembalance))
        .replace(/\b(\d+)_\w+\b/g, (_m: string, id: string) => {
          if (id === String(changedItemPkey)) return String(newValue);
          const v = newValues[id];
          return v !== undefined && v !== null ? String(v) : '0';
        });
      try {
        calculated = expr.trim() ? evaluateArithmetic(expr) : 0;
      } catch {
        calculated = 0;
      }
    }

    const operator = String(temp.structure_det_operator ?? '').toLowerCase();
    const depends = temp.structure_det_depends != null ? Number(temp.structure_det_depends) : 0;
    const detValue = Number(temp.structure_det_value ?? 0);
    const isDeduction = String(temp.is_deduction ?? '').toUpperCase() === 'Y';

    switch (operator) {
      case 'limit': calculated = Math.min(calculated, detValue); break;
      case 'limit_wl': calculated = Math.min(depends, calculated); break;
      case 'limit_wg': calculated = Math.max(depends, calculated); break;
      case 'fixed': calculated = detValue; break;
    }
    if (isDeduction) calculated = -Math.abs(calculated);

    out.push({ salary_head_item_fkey: itemPkey, calculated_value: calculated });
  }
  return out;
}

export interface ItemIncrementDraftInput {
  empFkey: number;
  structureId: number;
  withEffectFrom: string;
  nextIncrementDate: string;
  payoutMonth?: string;
  remarks?: string;
  components: { salaryHeadItemFkey: number; currentAmount: number; newAmount: number }[];
}

// Mirrors SalaryIncrementController::saveIncrement() (item='Y' branch) for a single employee —
// one salary_hike_details row per edited component.
export async function createItemIncrementDraft(
  pool: Pool,
  input: ItemIncrementDraftInput,
  userId: string
): Promise<{ hikeId: number }> {
  if (!input.components.length) throw new Error('No components to update');

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT branch_code FROM emp_details WHERE emp_pkey = ?', [input.empFkey]
  );
  if (!emp) throw new Error('Employee not found');

  const [[proff]] = await pool.execute<RowDataPacket[]>(
    'SELECT structure_id FROM emp_proff WHERE emp_fkey = ?', [input.empFkey]
  );
  const structureChange = Number(proff?.structure_id ?? 0) !== Number(input.structureId) ? 'Y' : 'N';

  const monthYear = input.withEffectFrom.slice(0, 7);
  const [[processedRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM payroll_master WHERE emp_fkey = ? AND month_year = ? AND action IN ('Approved', 'Processed')`,
    [input.empFkey, monthYear]
  );
  const arrearSalary = Number(processedRow?.cnt ?? 0) > 0 ? 'Y' : 'N';

  const [hikeResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO salary_hike (is_multiple, item, structure_change, action, remarks, created_by, status)
     VALUES ('N', 'Y', ?, NULL, ?, ?, 1)`,
    [structureChange, input.remarks ?? null, userId]
  );
  const hikeId = hikeResult.insertId;
  const payoutMonth = input.payoutMonth ? `${input.payoutMonth}-01` : `${monthYear}-01`;

  for (const c of input.components) {
    const incrementAmount = c.newAmount - c.currentAmount;
    const incrementPercentage = c.currentAmount !== 0 ? (incrementAmount / c.currentAmount) * 100 : 0;
    await pool.execute(
      `INSERT INTO salary_hike_details
         (salary_hike_fkey, item, branch_code, emp_fkey, structure_id, with_effect_from,
          next_increment_date, payout_month, salary_head_item_fkey, current_amount, new_amount,
          increment_amount, increment_percentage, arrear_salary, status, processed)
       VALUES (?, 'Y', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'N')`,
      [
        hikeId, emp.branch_code, input.empFkey, input.structureId, input.withEffectFrom,
        input.nextIncrementDate, payoutMonth, c.salaryHeadItemFkey, c.currentAmount, c.newAmount,
        incrementAmount, incrementPercentage, arrearSalary,
      ]
    );
  }
  return { hikeId };
}

// Re-evaluates emp_salary_structure.remarks formulas after a component-level regeneration,
// mirroring the two remarks loops in processItem() (updateRemarkValue token substitution, then
// the plain-arithmetic remarks eval). Pure string/arithmetic — never eval().
async function reevaluateStructureRemarks(pool: Pool, empFkey: number): Promise<void> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ess.emp_salary_structure_pkey, ess.remarks,
            ssd.structure_det_calequation AS formula
     FROM emp_salary_structure ess
     LEFT JOIN salary_structure_details ssd
       ON ssd.salary_head_item_fkey = ess.salary_head_item_fkey AND ssd.structure_id = ess.emp_structure_id
     WHERE ess.emp_fkey = ? AND ess.end_date_effective IS NULL AND ess.remarks IS NOT NULL`,
    [empFkey]
  );
  for (const row of rows) {
    const formula = String(row.formula ?? '');
    const remarks = String(row.remarks ?? '');
    if (!formula || !remarks) continue;
    if (!/(?:\b\d+_[A-Za-z0-9_]+|monthsal|rembalance)/i.test(formula)) continue;
    const updated = await substituteRemarkValues(pool, formula, remarks, empFkey);
    if (updated !== remarks) {
      await pool.execute(
        'UPDATE emp_salary_structure SET remarks = ? WHERE emp_salary_structure_pkey = ?',
        [updated, row.emp_salary_structure_pkey]
      );
    }
  }

  const [rows2] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_salary_structure_pkey, head_operator, remarks
     FROM emp_salary_structure
     WHERE emp_fkey = ? AND end_date_effective IS NULL AND remarks IS NOT NULL`,
    [empFkey]
  );
  for (const row of rows2) {
    const expr = String(row.remarks ?? '').replace(/\s+/g, '');
    if (!/^[0-9.+\-*/()]+$/.test(expr)) continue;
    let amount: number;
    try { amount = evaluateArithmetic(expr); } catch { continue; }
    if (String(row.head_operator) === 'Deduction') amount = -amount;
    await pool.execute(
      'UPDATE emp_salary_structure SET structure_det_value = ? WHERE emp_salary_structure_pkey = ?',
      [Math.round(amount), row.emp_salary_structure_pkey]
    );
  }
}

// Mirrors SalaryIncrementController::updateRemarkValue() — position-based substitution of the
// numbers in a remarks string with live DB values, keyed by the formula's token order.
async function substituteRemarkValues(
  pool: Pool,
  formula: string,
  remarks: string,
  empFkey: number
): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ess.salary_head_item_fkey, ess.structure_det_value, ess.salary_head_item_desc,
            ess.head_operator, ess.item_part, shi.head_fkey
     FROM emp_salary_structure ess
     LEFT JOIN salary_head_items shi ON ess.salary_head_item_fkey = shi.salary_head_item_pkey
     WHERE ess.emp_fkey = ? AND ess.end_date_effective IS NULL`,
    [empFkey]
  );

  const map: Record<string, number> = {};
  let monthsal = 0;
  for (const r of rows) {
    const itemKey = Number(r.salary_head_item_fkey);
    const value = Number(r.structure_det_value ?? 0);
    const item = String(r.salary_head_item_desc ?? '')
      .trim()
      .replace(/-/g, ' ')
      .replace(/\s+/g, '_')
      .replace(/[()]/g, '_');
    map[`${itemKey}_${item}`] = value;
    if (Number(r.head_fkey) === 1 && String(r.head_operator) === 'Addition' && String(r.item_part) === 'Direct') {
      monthsal += value;
    }
  }
  map['monthsal'] = monthsal;

  const [[rb]] = await pool.execute<RowDataPacket[]>(
    `SELECT structure_derived_perc FROM salary_structure_details
     WHERE structure_id = (SELECT IFNULL(ep.structure_id, 0) FROM emp_proff ep WHERE ep.emp_fkey = ?)
       AND TRIM(structure_formula) = 'Remaining Balance' LIMIT 1`,
    [empFkey]
  );
  const rembalancePrc = Number(rb?.structure_derived_perc ?? 0);
  map['rembalance'] = rembalancePrc > 0 ? (monthsal * rembalancePrc) / 100 : 0;

  const tokens = formula.match(/(?:monthsal|rembalance|[0-9]+_[A-Za-z0-9_]+)/g) ?? [];
  const numbers = remarks.match(/\b\d+(?:\.\d+)?\b/g) ?? [];

  let result = remarks;
  tokens.forEach((token, i) => {
    if (numbers[i] === undefined || map[token] === undefined) return;
    const escaped = numbers[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\b${escaped}\\b`), String(map[token]));
  });
  return result;
}

// Mirrors SalaryIncrementController::processItem() for a single-employee item batch.
export async function processItemIncrement(pool: Pool, hikePkey: number, userId: string): Promise<ProcessResult> {
  const [[hike]] = await pool.execute<RowDataPacket[]>(
    'SELECT structure_change FROM salary_hike WHERE salary_hike_pkey = ?', [hikePkey]
  );
  const structureChange = hike?.structure_change ?? 'N';

  const [details] = await pool.execute<RowDataPacket[]>(
    `SELECT salary_head_item_fkey, emp_fkey, structure_id, branch_code, with_effect_from,
            next_increment_date, payout_month, new_amount, arrear_salary
     FROM salary_hike_details WHERE salary_hike_fkey = ? AND status = 1 AND processed = 'N'`,
    [hikePkey]
  );
  if (!details.length) return { success: false, notProcessed: [], invalidSalary: [] };

  const byEmp = new Map<number, RowDataPacket[]>();
  for (const row of details) {
    const empFkey = Number(row.emp_fkey);
    if (structureChange === 'Y') {
      const [[p]] = await pool.execute<RowDataPacket[]>('SELECT structure_id FROM emp_proff WHERE emp_fkey = ?', [empFkey]);
      if (Number(p?.structure_id ?? 0) !== Number(row.structure_id)) continue;
    }
    if (!byEmp.has(empFkey)) byEmp.set(empFkey, []);
    byEmp.get(empFkey)!.push(row);
  }

  const notProcessed: string[] = [];
  const invalidSalary: string[] = [];
  let processedCount = 0;

  for (const [empFkey, rows] of byEmp) {
    await pool.query('CALL copy_salary_structure_to_new(?)', [empFkey]);

    const [[info]] = await pool.execute<RowDataPacket[]>(
      `SELECT ed.emp_id, ep.emp_type, ep.structure_id, ep.joining_date, ep.emp_company_id,
              TRIM(CONCAT(COALESCE(ed.first_name,''),' ',COALESCE(ed.last_name,''))) AS emp_name
       FROM emp_details ed LEFT JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
       WHERE ed.emp_pkey = ?`,
      [empFkey]
    );
    const empId = info?.emp_id;
    const structureId = Number(info?.structure_id ?? 0);
    const joiningDate: string = info?.joining_date ? new Date(info.joining_date).toISOString().slice(0, 10) : '';
    const empLabel = `${String(info?.emp_name ?? '').trim()} - ${info?.emp_company_id ?? ''}`;

    const first = rows[0];
    let withEffectFrom = first.with_effect_from ? new Date(first.with_effect_from).toISOString().slice(0, 10) : '';
    const nextIncrementDate = first.next_increment_date
      ? new Date(first.next_increment_date).toISOString().slice(0, 10)
      : '0000-00-00';
    let payoutMonth = first.payout_month ? new Date(first.payout_month).toISOString().slice(0, 10) : '';

    if (structureId === 0 && !withEffectFrom) withEffectFrom = joiningDate;
    if (!joiningDate || (withEffectFrom && joiningDate > withEffectFrom)) {
      notProcessed.push(empLabel);
      continue;
    }

    if (!payoutMonth || payoutMonth === '0000-00-00') {
      if (structureId === 0) {
        payoutMonth = joiningDate ? `${joiningDate.slice(0, 7)}-01` : `${new Date().toISOString().slice(0, 7)}-01`;
      } else {
        const [[latest]] = await pool.execute<RowDataPacket[]>(
          `SELECT MAX(month_year) AS latest FROM payroll_master WHERE emp_fkey = ? AND action = 'Processed'`,
          [empFkey]
        );
        if (latest?.latest) payoutMonth = `${shiftMonth(String(latest.latest), 1)}-01`;
        else if (joiningDate) payoutMonth = `${shiftMonth(joiningDate.slice(0, 7), 1)}-01`;
        else payoutMonth = `${new Date().toISOString().slice(0, 7)}-01`;
      }
    }

    const effectiveStructureId = structureChange === 'Y' || structureId === 0 ? Number(first.structure_id) : structureId;
    const [[sRow]] = await pool.execute<RowDataPacket[]>(
      'SELECT structure_eg_amt FROM salary_structure WHERE structure_id = ?', [effectiveStructureId]
    );
    const structureEgAmt = Number(sRow?.structure_eg_amt ?? 0);

    let grossSalary = 0;
    for (const r of rows) {
      const headItemFkey = Number(r.salary_head_item_fkey);
      const [[sh]] = await pool.execute<RowDataPacket[]>(
        `SELECT item, item_part FROM salary_head_items WHERE salary_head_item_pkey = ? AND status = 1`,
        [headItemFkey]
      );
      const componentName = String(sh?.item ?? '').trim();
      const itemPart = String(sh?.item_part ?? '').trim().toLowerCase();
      const value = Number(r.new_amount ?? 0);
      if (itemPart === 'direct' && value > 0) grossSalary += value;

      await pool.execute(
        `UPDATE emp_salcomp_upload SET status = 0
         WHERE emp_id = ? AND component = ? AND salary_head_item_fkey = ?`,
        [empId, componentName, headItemFkey || 1000]
      );
      await pool.execute(
        `INSERT INTO emp_salcomp_upload (emp_id, component, created_by, salary_head_item_fkey, rate, status)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [empId, componentName, userId, headItemFkey || 1000, value === 0 ? 0 : value]
      );
    }

    if (structureEgAmt > grossSalary) {
      invalidSalary.push(empLabel);
      continue;
    }

    await pool.query('CALL ctc_component_update_and_upload_prc(?, @pmessage)', [empFkey]);

    const [[arrRow]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM payroll_master WHERE emp_fkey = ? AND month_year = ? AND action IN ('Approved','Processed')`,
      [empFkey, withEffectFrom.slice(0, 7)]
    );
    const isArrear = Number(arrRow?.cnt ?? 0) > 0 ? 'Y' : 'N';

    await pool.execute(
      `UPDATE emp_ctc_transaction
       SET arrear_salary = ?, pay_out_month = ?, start_date_effective = ?, next_increment_date = ?, ctc_upload_type = 1
       WHERE emp_fkey = ? AND end_date_effective IS NULL`,
      [isArrear, payoutMonth, withEffectFrom, nextIncrementDate, empFkey]
    );

    await reevaluateStructureRemarks(pool, empFkey);
    await pool.query('CALL salary_structure_limit_prc(?, ?, @perr_msg)', [empFkey, userId]);

    await pool.execute(
      `UPDATE salary_hike_details SET processed = 'Y', payout_month = ?
       WHERE salary_hike_fkey = ? AND emp_fkey = ? AND status = 1 AND processed = 'N'`,
      [payoutMonth, hikePkey, empFkey]
    );
    processedCount++;
  }

  if (processedCount > 0) {
    await pool.execute(`UPDATE salary_hike SET action = 'Processed' WHERE salary_hike_pkey = ?`, [hikePkey]);
  }
  return {
    success: byEmp.size > 0 && processedCount > 0 && notProcessed.length === 0 && invalidSalary.length === 0,
    notProcessed,
    invalidSalary,
  };
}
