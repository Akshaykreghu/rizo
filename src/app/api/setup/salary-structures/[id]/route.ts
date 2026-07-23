import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { buildItemToken, evaluateSalaryFormula, FormulaError } from '@/lib/salaryFormula';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[structure]] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM salary_structure WHERE structure_id = ?',
    [id]
  );
  if (!structure) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [details] = await pool.execute<RowDataPacket[]>(
    `SELECT ssd.structure_det_id, ssd.salary_head_item_fkey, ssd.structure_det_operator,
            ssd.structure_det_value, ssd.structure_det_depends, ssd.structure_formula,
            ssd.structure_derived_perc, ssd.structure_det_calequation,
            shi.item, shi.head_fkey, sh.head_desc, sh.head_operator
     FROM salary_structure_details ssd
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = ssd.salary_head_item_fkey
     JOIN salary_heads sh ON sh.head_pkey = shi.head_fkey
     WHERE ssd.structure_id = ?
     ORDER BY sh.salary_head_order1, shi.salary_head_item_order1`,
    [id]
  );

  return NextResponse.json({ structure, details });
}

// Full replace-on-save for details — matches legacy's own savesalarystructuresetup() exactly
// (confirmed: it deleteAll()s every detail row for the structure then re-inserts), not a
// simplification introduced here. structure_det_id values are therefore not stable across edits.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json() as {
    structure_name: string; prorate_code?: string; prorate_desc?: string; fixed_days?: number;
    defined_structure_for?: string; structure_eg_amt: number;
    startdate_effective: string; enddate_effective: string;
    details: {
      salary_head_item_fkey: number; structure_det_operator: string;
      structure_det_value?: number; structure_det_depends?: number; formula?: string;
    }[];
  };

  const pool = await getCompanyPool(session.user.companyCode);
  const exampleGross = Number(body.structure_eg_amt) || 0;

  // Resolve every item's numeric value at the example gross first (fixed/manually rows first,
  // since formula rows may reference them), so formula evaluation below has a value to look up
  // regardless of the order the admin listed rows in.
  const itemRows = body.details.length
    ? await pool.execute<RowDataPacket[]>(
        `SELECT salary_head_item_pkey, item FROM salary_head_items WHERE salary_head_item_pkey IN (${body.details.map(() => '?').join(',')})`,
        body.details.map((d) => d.salary_head_item_fkey)
      ).then(([rows]) => rows)
    : [];
  const itemNameByPkey = new Map(itemRows.map((r) => [r.salary_head_item_pkey as number, r.item as string]));

  const itemValues: Record<string, number> = {};
  for (const d of body.details) {
    const name = itemNameByPkey.get(d.salary_head_item_fkey);
    if (!name) continue;
    const token = buildItemToken(d.salary_head_item_fkey, name);
    if (d.structure_det_operator === 'fixed' || d.structure_det_operator === 'manually') {
      itemValues[token] = Number(d.structure_det_value) || 0;
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      `UPDATE salary_structure SET structure_name = ?, prorate_code = ?, prorate_desc = ?,
              fixed_days = ?, defined_structure_for = ?, structure_eg_amt = ?,
              startdate_effective = ?, enddate_effective = ?
       WHERE structure_id = ?`,
      [
        body.structure_name, body.prorate_code ?? '', body.prorate_desc ?? '', Number(body.fixed_days) || 30,
        body.defined_structure_for ?? '', exampleGross, body.startdate_effective, body.enddate_effective, id,
      ]
    );

    await connection.execute('DELETE FROM salary_structure_details WHERE structure_id = ?', [id]);

    for (const d of body.details) {
      const name = itemNameByPkey.get(d.salary_head_item_fkey);
      if (!name) continue;
      const token = buildItemToken(d.salary_head_item_fkey, name);

      let detValue = Number(d.structure_det_value) || 0;
      let derivedPerc: number | null = null;
      let calEquation: string | null = null;
      let formulaDisplay: string | null = null;

      if (['formula', 'limit', 'limit_wl', 'limit_wg'].includes(d.structure_det_operator)) {
        if (!d.formula) {
          throw new FormulaError(`A formula is required for item "${name}" (operator ${d.structure_det_operator})`);
        }
        detValue = evaluateSalaryFormula(d.formula, itemValues, exampleGross);
        derivedPerc = exampleGross > 0 ? (detValue * 100) / exampleGross : 0;
        calEquation = d.formula;
        formulaDisplay = d.formula;
        itemValues[token] = detValue;
      } else {
        derivedPerc = exampleGross > 0 ? (detValue * 100) / exampleGross : 0;
      }

      await connection.execute(
        `INSERT INTO salary_structure_details
           (structure_id, salary_head_item_fkey, structure_det_operator, structure_det_value,
            structure_det_depends, structure_formula, structure_derived_perc, structure_det_calequation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, d.salary_head_item_fkey, d.structure_det_operator, detValue,
          d.structure_det_depends ?? null, formulaDisplay, derivedPerc, calEquation,
        ]
      );
    }

    await connection.commit();
    return NextResponse.json({ success: true });
  } catch (err) {
    await connection.rollback();
    if (err instanceof FormulaError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  } finally {
    connection.release();
  }
}

// Blocks deletion if any employee currently has this structure assigned (emp_proff.structure_id) —
// matches legacy's real delete() guard. Soft-delete only (structure_active = 0).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[inUse]] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS cnt FROM emp_proff WHERE structure_id = ?',
    [id]
  );
  if (Number(inUse?.cnt ?? 0) > 0) {
    return NextResponse.json(
      { error: 'This structure is assigned to one or more employees and cannot be deleted' },
      { status: 409 }
    );
  }

  await pool.execute('UPDATE salary_structure SET structure_active = 0 WHERE structure_id = ?', [id]);
  return NextResponse.json({ success: true });
}
