import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { buildItemToken, evaluateSalaryFormula, FormulaError } from '@/lib/salaryFormula';

interface BreakupLine {
  salary_head_item_fkey: number;
  head_name: string;
  amount: number;
  is_deduction: 'Y' | 'N';
  head_desc: string;
  is_employer_contribution: boolean;
  formula_warning: string | null;
}

const EMPLOYER_CONTRIBUTION_HEAD_PKEY = 4;

// Wraps the real, confirmed-live calculate_emp_salary_breakup(Pemp_fkey, Pstructure_id,
// Pmonthly_gross) procedure — also called by 3 legacy controllers (SalaryIncrement,
// EmployeeJoin, Employee), so it's shared/load-bearing, not touched here. Its own WHERE clause
// drops any row whose structure_det_value AND structure_derived_perc are both 0 (silently
// omitting genuinely-unconfigured components, but also anything whose true computed value is
// legitimately 0 — SAL-011/SAL-016), and it never separates "Employer Contributions" from
// employee-facing pay when returning rows, so a naive sum of everything it returns overstates
// Net whenever employer/employee contribution amounts differ (SAL-013). Both are corrected here,
// in the app layer, by cross-referencing the full salary_structure_details set the proc's own
// query is built from — not by altering the shared procedure itself.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const gross = Number(searchParams.get('gross'));
  if (!gross || gross <= 0) {
    return NextResponse.json({ error: 'A positive gross amount is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [procResults, detailRows] = await Promise.all([
    pool.query<RowDataPacket[][]>('CALL calculate_emp_salary_breakup(?, ?, ?)', [0, id, gross]),
    pool.execute<RowDataPacket[]>(
      `SELECT ssd.salary_head_item_fkey, ssd.structure_det_operator, ssd.structure_det_value,
              ssd.structure_det_depends, ssd.structure_derived_perc, ssd.structure_det_calequation,
              shi.item AS head_name, sh.head_pkey, sh.head_desc,
              CASE WHEN LOWER(sh.head_operator) = 'deduction' THEN 'Y' ELSE 'N' END AS is_deduction
       FROM salary_structure_details ssd
       JOIN salary_head_items shi ON shi.salary_head_item_pkey = ssd.salary_head_item_fkey
       JOIN salary_heads sh ON sh.head_pkey = shi.head_fkey
       WHERE ssd.structure_id = ?`,
      [id]
    ),
  ]);
  const procRows = procResults[0][0] as unknown as RowDataPacket[];
  const details = detailRows[0];

  const byItemFkey = new Map(procRows.map((r) => [Number(r.salary_head_item_fkey), r]));

  const lines: BreakupLine[] = details.map((d) => {
    const procRow = byItemFkey.get(Number(d.salary_head_item_fkey));
    const isDeduction: 'Y' | 'N' = d.is_deduction === 'Y' ? 'Y' : 'N';

    let amount: number;
    if (procRow) {
      amount = Number(procRow.amount);
    } else {
      // Reconstructs exactly the proc's own per-operator math (mirrored, not reimplemented
      // differently) for rows its WHERE clause excluded, so they show as a real ₹ line
      // (possibly ₹0) instead of vanishing with no way to tell "zero" from "broken."
      const derivedPerc = Number(d.structure_derived_perc) || 0;
      const detValue = Number(d.structure_det_value) || 0;
      const detDepends = d.structure_det_depends != null ? Number(d.structure_det_depends) : null;
      const formulaValue = (derivedPerc / 100) * gross;

      switch (d.structure_det_operator) {
        case 'fixed':
        case 'manually':
          amount = detValue;
          break;
        case 'formula':
          amount = formulaValue;
          break;
        case 'limit':
          amount = Math.min(detValue, formulaValue);
          break;
        case 'limit_wl':
          amount = Math.min(detDepends ?? formulaValue, formulaValue);
          break;
        case 'limit_wg':
          amount = Math.max(detDepends ?? formulaValue, formulaValue);
          break;
        default:
          amount = 0;
      }
      if (isDeduction === 'Y') amount = -Math.abs(amount);
      amount = Math.round(amount * 100) / 100;
    }

    return {
      salary_head_item_fkey: Number(d.salary_head_item_fkey),
      head_name: String(d.head_name ?? '').trim(),
      amount,
      is_deduction: isDeduction,
      head_desc: String(d.head_desc ?? ''),
      is_employer_contribution: Number(d.head_pkey) === EMPLOYER_CONTRIBUTION_HEAD_PKEY,
      formula_warning: null,
    };
  });

  // SAL-012: flag (don't silently trust or silently drop) any formula this app's own token-based
  // parser can't understand — the classic case being migrated pre-migration plain-English text
  // like "Monthly Gross Salary * . 40". The proc doesn't re-evaluate formula text at all (it uses
  // the pre-stored derived percentage), so this check is purely diagnostic: it doesn't change the
  // displayed amount, it tells the admin the underlying formula needs re-entry.
  const itemValues: Record<string, number> = {};
  for (const line of lines) {
    itemValues[buildItemToken(line.salary_head_item_fkey, line.head_name)] = line.amount;
  }
  for (const d of details) {
    const operator = String(d.structure_det_operator);
    const formula = d.structure_det_calequation ?? d.structure_formula;
    if (!['formula', 'limit', 'limit_wl', 'limit_wg'].includes(operator) || !formula) continue;
    const line = lines.find((l) => l.salary_head_item_fkey === Number(d.salary_head_item_fkey));
    if (!line) continue;
    try {
      evaluateSalaryFormula(String(formula), itemValues, gross);
    } catch (err) {
      if (err instanceof FormulaError) {
        line.formula_warning = `Formula could not be evaluated ("${String(formula)}") — likely legacy-syntax text needing re-entry. Showing the last-saved value instead.`;
      }
    }
  }

  // SAL-013: Net is employee take-home only — Employer Contributions are a cost to the company,
  // never part of what the employee receives, mirroring legacy's own category separation.
  const net = lines
    .filter((l) => !l.is_employer_contribution)
    .reduce((sum, l) => sum + l.amount, 0);
  const employerCost = lines
    .filter((l) => l.is_employer_contribution)
    .reduce((sum, l) => sum + l.amount, 0);

  return NextResponse.json({
    data: lines,
    net: Math.round(net * 100) / 100,
    employer_cost: Math.round(employerCost * 100) / 100,
  });
}
