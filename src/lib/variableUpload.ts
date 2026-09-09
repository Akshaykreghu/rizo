import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { monthYearToEvuFormat } from './payroll';

// Ports VariableController.php ("Variable Upload" menu) — per-employee, per-month one-off pay
// components (bonus, incentive, ad-hoc addition/deduction) that are NOT in the fixed salary
// structure. Each row targets a salary_head_items entry whose head has head_occurance = 'variable'
// (salary_heads 9 = Addition, 10 = Deduction), item_type = 'Manually', value = 'Y'.
//
// How payroll consumes this table (calculate_salary_main_prc BLOCK3): every status = 1 row for the
// month is SUM()'d into its head and posted to the salary slip — multiple rows for the same
// (emp, head, month) are additive by design. Payroll itself also INSERTs rows here with
// head_type = 'Fixed', action = 'Salary Processing' (BLOCK2); those are reset by the reprocess
// route. The UI must never let a user edit/delete a machine row.
//
// Hard constraint for this port: no schema changes. INSERT / UPDATE / status = 0 only, against the
// existing emp_variables_upload table, exactly as legacy VariableSave / uploadandsaveempvar /
// deleteEmployees do. All other tables are read-only here.
//
// month_year gotcha: emp_variables_upload.month_year is 'MM-YYYY' (varchar). Everything in the new
// app (and payroll_master) uses 'YYYY-MM'. Convert at every boundary — monthYearToEvuFormat() does
// 'YYYY-MM' -> 'MM-YYYY'; evuFormatToMonthYear() below is the reverse for display.

export function evuFormatToMonthYear(evu: string): string {
  // 'MM-YYYY' -> 'YYYY-MM'; pass through anything that doesn't match.
  const m = /^(\d{2})-(\d{4})$/.exec(evu ?? '');
  return m ? `${m[2]}-${m[1]}` : evu;
}

export interface VariableHeadItem extends RowDataPacket {
  salary_head_item_pkey: number;
  item: string;
  item_type: string;
  item_part: string;
  head_fkey: number;
  head_operator: string;
}

// Mirrors the arr_headitems query in VariableController::index()/form() — the dropdown source.
export async function getVariableHeadItems(pool: Pool): Promise<VariableHeadItem[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT shi.salary_head_item_pkey, TRIM(shi.item) AS item, shi.item_type, shi.item_part,
            shi.head_fkey, sh.head_operator
     FROM salary_head_items shi
     JOIN salary_heads sh ON sh.head_pkey = shi.head_fkey
     WHERE shi.status = 1 AND shi.item_type = 'Manually' AND shi.value = 'Y'
       AND LOWER(sh.head_occurance) = 'variable' AND sh.status = 1
     ORDER BY shi.item ASC`
  );
  return rows as VariableHeadItem[];
}

interface HeadSnapshot {
  salary_head_item_desc: string;
  head_operator: string;
  head_type: string;
  item_part: string;
}

// Mirrors VariableSave()'s SalaryHeadItems + SalaryHeads lookups: the denormalised columns payroll
// reads straight off emp_variables_upload without re-joining.
async function resolveHeadSnapshot(pool: Pool, salaryHeadItemFkey: number): Promise<HeadSnapshot | null> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT shi.item, shi.item_type, shi.item_part, sh.head_operator
     FROM salary_head_items shi
     JOIN salary_heads sh ON sh.head_pkey = shi.head_fkey
     WHERE shi.salary_head_item_pkey = ?`,
    [salaryHeadItemFkey]
  );
  if (!row) return null;
  return {
    salary_head_item_desc: String(row.item ?? ''),
    head_operator: String(row.head_operator ?? ''),
    head_type: String(row.item_type ?? ''),
    item_part: String(row.item_part ?? ''),
  };
}

// Mirrors VariableSave()'s payroll_master guard. Legacy converts the form's 'MM-YYYY' to 'YYYY-MM'
// for this check because payroll_master.month_year is ISO. This is a HARD block (unlike advances).
export async function isPayrollProcessedForVariable(
  pool: Pool,
  empFkey: number,
  monthYearIso: string
): Promise<boolean> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM payroll_master
     WHERE emp_fkey = ? AND month_year = ? AND action IN ('Approved','Processed')`,
    [empFkey, monthYearIso]
  );
  return Number(row?.cnt ?? 0) > 0;
}

export const PAYROLL_PROCESSED_MESSAGE =
  'Payroll Already Processed, Please Remove it before upload Variable';

export interface VariableUploadRow extends RowDataPacket {
  emp_variables_upload_pkey: number;
  emp_fkey: number;
  emp_name: string;
  month_year: string; // 'MM-YYYY' as stored
  salary_head_item_fkey: number;
  salary_head_item_desc: string;
  uploaded_amount: number;
  head_operator: string;
  head_type: string;
  item_part: string;
  remarks: string | null;
  action: string | null;
  is_machine_row: 0 | 1;
}

export interface VariableListParams {
  month?: string; // 'YYYY-MM' from the UI
  empFkey?: number;
  branch?: string; // emp_details.branch_code
  salaryHeadItemFkey?: number;
  limit?: number;
  offset?: number;
}

// Mirrors VariableController::employeelistvariable().
export async function listVariableUploads(
  pool: Pool,
  params: VariableListParams
): Promise<{ rows: VariableUploadRow[]; total: number }> {
  const conditions: string[] = ['vu.status = 1'];
  const args: (string | number)[] = [];

  if (params.month) {
    conditions.push('vu.month_year = ?');
    args.push(monthYearToEvuFormat(params.month));
  }
  if (params.empFkey) {
    conditions.push('vu.emp_fkey = ?');
    args.push(params.empFkey);
  }
  if (params.branch) {
    conditions.push('ed.branch_code = ?');
    args.push(params.branch);
  }
  if (params.salaryHeadItemFkey) {
    conditions.push('vu.salary_head_item_fkey = ?');
    args.push(params.salaryHeadItemFkey);
  }
  const where = conditions.join(' AND ');

  const [[countRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM emp_variables_upload vu
     JOIN emp_details ed ON ed.emp_pkey = vu.emp_fkey
     WHERE ${where}`,
    args
  );
  const total = Number(countRow?.cnt ?? 0);

  const limit = Math.max(1, Math.floor(params.limit ?? 50));
  const offset = Math.max(0, Math.floor(params.offset ?? 0));
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT vu.emp_variables_upload_pkey, vu.emp_fkey,
            CONCAT(COALESCE(ed.first_name,''),' ',COALESCE(ed.last_name,'')) AS emp_name,
            vu.month_year, vu.salary_head_item_fkey, vu.salary_head_item_desc, vu.uploaded_amount,
            vu.head_operator, vu.head_type, vu.item_part, vu.remarks, vu.action,
            (vu.action = 'Salary Processing' OR LOWER(vu.head_type) = 'fixed') AS is_machine_row
     FROM emp_variables_upload vu
     JOIN emp_details ed ON ed.emp_pkey = vu.emp_fkey
     WHERE ${where}
     ORDER BY vu.creation_date DESC
     LIMIT ${limit} OFFSET ${offset}`,
    args
  );
  return { rows: rows as VariableUploadRow[], total };
}

export interface VariableUploadInput {
  pkey?: number; // present -> update
  empFkey: number;
  salaryHeadItemFkey: number;
  month: string; // 'YYYY-MM'
  amount: number;
  remarks?: string;
}

export class VariableUploadError extends Error {}

// Mirrors VariableController::VariableSave() (single-entry form path).
export async function saveVariableUpload(
  pool: Pool,
  input: VariableUploadInput,
  createdBy: string
): Promise<{ pkey: number }> {
  if (!(input.amount >= 0)) {
    throw new VariableUploadError('Amount must be zero or greater');
  }

  const processed = await isPayrollProcessedForVariable(pool, input.empFkey, input.month);
  if (processed) throw new VariableUploadError(PAYROLL_PROCESSED_MESSAGE);

  const snap = await resolveHeadSnapshot(pool, input.salaryHeadItemFkey);
  if (!snap) throw new VariableUploadError('Unknown salary head item');

  const evuMonth = monthYearToEvuFormat(input.month);

  if (input.pkey && input.pkey > 0) {
    // Refuse to touch machine-generated rows (BLOCK2 / reprocess own these).
    const [[existing]] = await pool.execute<RowDataPacket[]>(
      `SELECT action, head_type FROM emp_variables_upload
       WHERE emp_variables_upload_pkey = ? AND status = 1`,
      [input.pkey]
    );
    if (!existing) throw new VariableUploadError('Record not found');
    if (existing.action === 'Salary Processing' || String(existing.head_type).toLowerCase() === 'fixed') {
      throw new VariableUploadError('This row was generated by payroll processing and cannot be edited');
    }
    await pool.execute<ResultSetHeader>(
      `UPDATE emp_variables_upload
       SET emp_fkey = ?, salary_head_item_fkey = ?, month_year = ?, salary_head_item_desc = ?,
           uploaded_amount = ?, head_operator = ?, head_type = ?, item_part = ?,
           action = 'uploaded by form', remarks = ?
       WHERE emp_variables_upload_pkey = ?`,
      [
        input.empFkey, input.salaryHeadItemFkey, evuMonth, snap.salary_head_item_desc,
        input.amount, snap.head_operator, snap.head_type, snap.item_part,
        input.remarks ?? '', input.pkey,
      ]
    );
    return { pkey: input.pkey };
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_variables_upload
       (emp_fkey, salary_head_item_fkey, month_year, salary_head_item_desc, uploaded_amount,
        head_operator, head_type, item_part, action, remarks, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded by form', ?, 1, ?)`,
    [
      input.empFkey, input.salaryHeadItemFkey, evuMonth, snap.salary_head_item_desc,
      input.amount, snap.head_operator, snap.head_type, snap.item_part,
      input.remarks ?? '', createdBy,
    ]
  );
  return { pkey: result.insertId };
}

// Mirrors VariableController::deleteEmployees() — soft-delete. Adds a guard legacy lacks: machine
// rows are skipped and reported back, never zeroed.
export async function softDeleteVariableUploads(
  pool: Pool,
  ids: number[]
): Promise<{ deleted: number; skipped: number[] }> {
  if (ids.length === 0) return { deleted: 0, skipped: [] };

  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_variables_upload_pkey, action, head_type
     FROM emp_variables_upload
     WHERE emp_variables_upload_pkey IN (${placeholders}) AND status = 1`,
    ids
  );

  const deletable = (rows as RowDataPacket[])
    .filter((r) => r.action !== 'Salary Processing' && String(r.head_type).toLowerCase() !== 'fixed')
    .map((r) => Number(r.emp_variables_upload_pkey));
  const skipped = (rows as RowDataPacket[])
    .filter((r) => r.action === 'Salary Processing' || String(r.head_type).toLowerCase() === 'fixed')
    .map((r) => Number(r.emp_variables_upload_pkey));

  if (deletable.length > 0) {
    const del = deletable.map(() => '?').join(',');
    await pool.execute(
      `UPDATE emp_variables_upload SET status = 0 WHERE emp_variables_upload_pkey IN (${del})`,
      deletable
    );
  }
  return { deleted: deletable.length, skipped };
}

export interface BulkUploadResult {
  imported: number;
  errors: { row: number; message: string }[];
}

// Mirrors VariableController::uploadandsaveempvar(). Legacy appends a new row per sheet line (no
// upsert, no dedupe — payroll SUM()s them). Deliberate addition over legacy: the payroll_master
// guard is run per row so we never write into a locked month (same discipline as the attendance
// upload port).
export async function bulkImportVariableUploads(
  pool: Pool,
  sheetRows: Record<string, unknown>[],
  salaryHeadItemFkey: number,
  month: string, // 'YYYY-MM'
  createdBy: string
): Promise<BulkUploadResult> {
  const snap = await resolveHeadSnapshot(pool, salaryHeadItemFkey);
  if (!snap) return { imported: 0, errors: [{ row: 0, message: 'Unknown salary head item' }] };

  const evuMonth = monthYearToEvuFormat(month);
  const errors: { row: number; message: string }[] = [];
  let imported = 0;
  const empCache = new Map<string, number | null>();
  const lockCache = new Map<number, boolean>();

  for (let i = 0; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    const rowNum = i + 2;
    const userId = String(row['User ID'] ?? '').trim();
    const amountRaw = String(row['Amount'] ?? '').trim();
    const remarks = String(row['Remarks'] ?? '').trim();

    if (!userId) continue; // legacy: silently skips
    if (amountRaw === '') continue; // legacy bulk path skips empty amounts
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount)) {
      errors.push({ row: rowNum, message: `Amount "${amountRaw}" is not a number` });
      continue;
    }

    let empFkey = empCache.get(userId);
    if (empFkey === undefined) {
      const [[uc]] = await pool.execute<RowDataPacket[]>(
        'SELECT emp_fkey FROM user_credentials WHERE user_id = ?',
        [userId]
      );
      empFkey = uc?.emp_fkey ? Number(uc.emp_fkey) : null;
      empCache.set(userId, empFkey);
    }
    if (!empFkey) {
      errors.push({ row: rowNum, message: `No employee login found for User ID "${userId}"` });
      continue;
    }

    let locked = lockCache.get(empFkey);
    if (locked === undefined) {
      locked = await isPayrollProcessedForVariable(pool, empFkey, month);
      lockCache.set(empFkey, locked);
    }
    if (locked) {
      errors.push({ row: rowNum, message: `${userId}: ${PAYROLL_PROCESSED_MESSAGE}` });
      continue;
    }

    try {
      await pool.execute<ResultSetHeader>(
        `INSERT INTO emp_variables_upload
           (emp_fkey, salary_head_item_fkey, month_year, salary_head_item_desc, uploaded_amount,
            head_operator, head_type, item_part, action, remarks, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded by excel', ?, 1, ?)`,
        [
          empFkey, salaryHeadItemFkey, evuMonth, snap.salary_head_item_desc, amount,
          snap.head_operator, snap.head_type, snap.item_part, remarks, createdBy,
        ]
      );
      imported++;
    } catch {
      errors.push({ row: rowNum, message: `${userId}: failed to save` });
    }
  }

  return { imported, errors };
}
