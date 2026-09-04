import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { FormulaError } from '@/lib/salaryFormula';
import {
  saveStructureDetails, structureHeaderError, structureNameTaken,
  FIXED_DAYS_LOCKED_COMPANIES, DEFAULT_FIXED_DAYS, type StructureDetailInput,
} from '@/lib/salaryStructureSave';
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
    structure_active?: number;
    details: StructureDetailInput[];
  };

  const headerError = structureHeaderError(body);
  if (headerError) return NextResponse.json({ error: headerError }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const exampleGross = Number(body.structure_eg_amt) || 0;

  // Legacy checkstructureexists() — name must stay unique among active structures (this row excepted).
  if (await structureNameTaken(pool, body.structure_name, Number(id))) {
    return NextResponse.json({ error: 'A salary structure with this name already exists' }, { status: 409 });
  }

  // For the special-companies list legacy never writes fixed_days — an edit leaves whatever is
  // already in the column, same as create leaves the default.
  const fixedDaysLocked = FIXED_DAYS_LOCKED_COMPANIES.has(session.user.companyCode.toUpperCase());

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // startdate_effective/enddate_effective deliberately left untouched here — dropped from
    // the product surface entirely (see structureHeaderError), so an edit shouldn't overwrite
    // whatever placeholder/legacy value already sits in those columns.
    await connection.execute(
      `UPDATE salary_structure SET structure_name = ?, prorate_code = ?, prorate_desc = ?,
              ${fixedDaysLocked ? '' : 'fixed_days = ?,'} defined_structure_for = ?, structure_eg_amt = ?, structure_active = ?
       WHERE structure_id = ?`,
      [
        body.structure_name, body.prorate_code ?? '', body.prorate_desc ?? '',
        ...(fixedDaysLocked ? [] : [Number(body.fixed_days) || DEFAULT_FIXED_DAYS]),
        body.defined_structure_for ?? '', exampleGross,
        body.structure_active !== undefined ? Number(body.structure_active) : 1, id,
      ]
    );

    await saveStructureDetails(connection, Number(id), body.details ?? [], exampleGross);

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
