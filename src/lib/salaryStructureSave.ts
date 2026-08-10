import type { PoolConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { buildItemToken, evaluateSalaryFormula, FormulaError } from './salaryFormula';

export interface StructureDetailInput {
  salary_head_item_fkey: number;
  structure_det_operator: string;
  structure_det_value?: number;
  structure_det_depends?: number | null;
  formula?: string;
}

const FORMULA_ONLY_OPERATORS = new Set(['formula', 'limit_wl', 'limit_wg']);

// "Monthly Salary Components" (legacy/schema/mypayrol_mpm121.sql:248005) — Direct+Addition,
// non-variable — the same category the live calculate_emp_salary_breakup procedure sums into
// vdistributed_total for its own 'rembalance' math, and the same one legacy's own
// setRemainingBalance() (form.ctp:465-491) restricts its "must sum to gross" check to.
const MONTHLY_SALARY_HEAD_PKEY = 1;

// Every validation error in this module follows the same pattern: state the actual gap, then
// suggest the fix — not just "this is wrong". Wraps evaluateSalaryFormula's own (more
// technical, position-in-string) parse errors with the item name and an actionable next step,
// since an admin seeing a raw "Unrecognized token at position 12" has no idea what to do next.
function evaluateFormulaOrThrowHelpfully(
  formula: string,
  itemValues: Record<string, number>,
  exampleGross: number,
  itemName: string
): number {
  try {
    return evaluateSalaryFormula(formula, itemValues, exampleGross);
  } catch (err) {
    if (err instanceof FormulaError) {
      throw new FormulaError(
        `The formula for "${itemName}" couldn't be evaluated (${err.message}). Open the Formula Builder to re-enter it in the current syntax.`
      );
    }
    throw err;
  }
}

interface ComputedRow {
  detail: StructureDetailInput;
  name: string;
  token: string;
  headFkey: number;
  detValue: number;
  derivedPerc: number | null;
  calEquation: string | null;
  formulaDisplay: string | null;
}

// Shared by create (POST) and edit (PUT) — SAL-001 was caused by POST never calling this at
// all. Full replace-on-save, matching legacy's own savesalarystructuresetup() (deleteAll() then
// re-insert), so structure_det_id values are not stable across edits.
export async function saveStructureDetails(
  connection: PoolConnection,
  structureId: number,
  details: StructureDetailInput[],
  exampleGross: number
): Promise<void> {
  const itemRows = details.length
    ? await connection
        .execute<RowDataPacket[]>(
          `SELECT salary_head_item_pkey, item, head_fkey FROM salary_head_items WHERE salary_head_item_pkey IN (${details.map(() => '?').join(',')})`,
          details.map((d) => d.salary_head_item_fkey)
        )
        .then(([rows]) => rows)
    : [];
  const itemByPkey = new Map(itemRows.map((r) => [r.salary_head_item_pkey as number, r]));

  // Resolve fixed/manually values first, since formula rows may reference them regardless of
  // the order the admin listed rows in.
  const itemValues: Record<string, number> = {};
  for (const d of details) {
    const item = itemByPkey.get(d.salary_head_item_fkey);
    if (!item) continue;
    const token = buildItemToken(d.salary_head_item_fkey, item.item as string);
    if (d.structure_det_operator === 'fixed' || d.structure_det_operator === 'manually') {
      itemValues[token] = Number(d.structure_det_value) || 0;
    }
  }

  // Everything is computed before any DB write, so a validation failure (missing formula, or
  // the gross-sum check below) leaves the structure's existing details untouched.
  const computed: ComputedRow[] = [];
  for (const d of details) {
    const item = itemByPkey.get(d.salary_head_item_fkey);
    if (!item) continue;
    const name = item.item as string;
    const token = buildItemToken(d.salary_head_item_fkey, name);

    let detValue = Number(d.structure_det_value) || 0;
    let derivedPerc: number | null = null;
    let calEquation: string | null = null;
    let formulaDisplay: string | null = null;

    if (d.structure_det_operator === 'rembalance') {
      // Value itself is resolved in a second pass below, once every other Monthly Salary
      // Component's value is known — mirrors the live proc's own vdistributed_total math
      // instead of trusting whatever number the client happened to send for this row (SAL-015:
      // that field isn't authoritative at calculation time, so it shouldn't be treated as
      // authoritative here either). calequation/formula are still set here to the literal
      // sentinel legacy itself stores ('rembalance' / 'Remaining Balance', confirmed via real
      // migrated rows) — legacy's own edit-form JS (form.ctp:292,354,434) gates real
      // formula-recompute logic on `cal_equation !== 'rembalance'` read straight from this
      // column, so leaving it NULL would make a structure saved here behave wrong if ever
      // reopened in legacy's still-live admin UI.
      calEquation = 'rembalance';
      formulaDisplay = 'Remaining Balance';
    } else if (d.structure_det_operator === 'limit') {
      // "Limit (lesser of value or formula)" — the live calculate_emp_salary_breakup
      // procedure genuinely compares two real inputs (LEAST(structure_det_value,
      // formula-derived amount)); the value side must survive, not be overwritten by the
      // formula's result (SAL-014's actual root cause).
      if (!d.formula) {
        throw new FormulaError(`"${name}" needs a formula (it's set to Limit, which compares a Value against a formula). Open the Formula Builder to add one.`);
      }
      const formulaValue = evaluateFormulaOrThrowHelpfully(d.formula, itemValues, exampleGross, name);
      derivedPerc = exampleGross > 0 ? (formulaValue * 100) / exampleGross : 0;
      calEquation = d.formula;
      formulaDisplay = d.formula;
      itemValues[token] = Math.min(detValue, formulaValue);
    } else if (FORMULA_ONLY_OPERATORS.has(d.structure_det_operator)) {
      if (!d.formula) {
        throw new FormulaError(`"${name}" needs a formula (its calculation type requires one). Open the Formula Builder to add one, or switch it to Fixed Amount or Manually Entered instead.`);
      }
      detValue = evaluateFormulaOrThrowHelpfully(d.formula, itemValues, exampleGross, name);
      derivedPerc = exampleGross > 0 ? (detValue * 100) / exampleGross : 0;
      calEquation = d.formula;
      formulaDisplay = d.formula;
      itemValues[token] = detValue;
    } else {
      derivedPerc = exampleGross > 0 ? (detValue * 100) / exampleGross : 0;
    }

    computed.push({ detail: d, name, token, headFkey: Number(item.head_fkey), detValue, derivedPerc, calEquation, formulaDisplay });
  }

  const monthlySalaryTotal = computed
    .filter((c) => c.headFkey === MONTHLY_SALARY_HEAD_PKEY && c.detail.structure_det_operator !== 'rembalance')
    .reduce((sum, c) => sum + c.detValue, 0);
  for (const c of computed) {
    if (c.detail.structure_det_operator === 'rembalance') {
      c.detValue = exampleGross - monthlySalaryTotal;
      c.derivedPerc = exampleGross > 0 ? (c.detValue * 100) / exampleGross : 0;
      itemValues[c.token] = c.detValue;
    }
  }

  // SAL-019: mirrors legacy's own save-blocking "Remaining amount for applied formula should
  // be zero" guardrail (form.ctp:1105-1112) — Monthly Salary Components must sum to exactly the
  // declared Example Monthly Gross. A Remaining Balance component (resolved just above) makes
  // this hold automatically; without one, the admin's amounts must add up exactly, same as
  // legacy has always required.
  const finalMonthlySalaryTotal = computed
    .filter((c) => c.headFkey === MONTHLY_SALARY_HEAD_PKEY)
    .reduce((sum, c) => sum + c.detValue, 0);
  if (Math.abs(finalMonthlySalaryTotal - exampleGross) > 0.01) {
    throw new FormulaError(
      `Monthly Salary Components must sum to the Example Monthly Gross (currently ₹${finalMonthlySalaryTotal.toFixed(2)}, expected ₹${exampleGross.toFixed(2)}). Add a Remaining Balance component or adjust amounts so they add up exactly.`
    );
  }

  await connection.execute('DELETE FROM salary_structure_details WHERE structure_id = ?', [structureId]);

  for (const c of computed) {
    await connection.execute(
      `INSERT INTO salary_structure_details
         (structure_id, salary_head_item_fkey, structure_det_operator, structure_det_value,
          structure_det_depends, structure_formula, structure_derived_perc, structure_det_calequation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        structureId, c.detail.salary_head_item_fkey, c.detail.structure_det_operator, c.detValue,
        c.detail.structure_det_depends ?? null, c.formulaDisplay, c.derivedPerc, c.calEquation,
      ]
    );
  }
}

// startdate_effective/enddate_effective are intentionally not validated or collected here —
// legacy stopped writing them years ago (its own save controller has the assignment lines
// commented out; every structure created since is stored with '0000-00-00'), nothing in
// legacy or here ever reads them back, so they're dropped from the product surface entirely.
export function structureHeaderError(body: {
  structure_name?: string;
  structure_eg_amt?: number;
}): string | null {
  if (!body.structure_name?.trim()) return 'Structure Name is required';
  if (!body.structure_eg_amt || Number(body.structure_eg_amt) <= 0) return 'Example Monthly Gross must be greater than 0';
  return null;
}
