import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import {
  saveStructureDetails, structureHeaderError, structureNameTaken,
  FIXED_DAYS_LOCKED_COMPANIES, DEFAULT_FIXED_DAYS, type StructureDetailInput,
} from '@/lib/salaryStructureSave';
import { FormulaError } from '@/lib/salaryFormula';

// GET response shape (structure_id/structure_name only) is load-bearing for existing
// employee-side structure pickers (bulk-policies, join onboarding, new/edit employee,
// promotions) — kept exactly as-is. Pass ?full=1 for the Salary Structure setup list page's
// richer columns instead of adding a second endpoint.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const full = searchParams.get('full') === '1';

  const pool = await getCompanyPool(session.user.companyCode);
  if (full) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT structure_id, structure_name, structure_eg_amt, fixed_days, prorate_code,
              startdate_effective, enddate_effective, structure_active
       FROM salary_structure ORDER BY structure_name`
    );
    return NextResponse.json(rows);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT structure_id, structure_name FROM salary_structure WHERE structure_active = 1 ORDER BY structure_name'
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as {
    structure_name: string; prorate_code?: string; prorate_desc?: string; fixed_days?: number;
    defined_structure_for?: string; structure_eg_amt: number;
    details?: StructureDetailInput[];
  };

  const headerError = structureHeaderError(body);
  if (headerError) return NextResponse.json({ error: headerError }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const exampleGross = Number(body.structure_eg_amt) || 0;

  // Legacy checkstructureexists() — name must be unique among active structures.
  if (await structureNameTaken(pool, body.structure_name, 0)) {
    return NextResponse.json({ error: 'A salary structure with this name already exists' }, { status: 409 });
  }

  // fixed_days is not admin-settable for the special-companies list — legacy omits it from the
  // save entirely, letting the column keep its default of 30.
  const fixedDays = FIXED_DAYS_LOCKED_COMPANIES.has(session.user.companyCode.toUpperCase())
    ? DEFAULT_FIXED_DAYS
    : Number(body.fixed_days) || DEFAULT_FIXED_DAYS;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // startdate_effective/enddate_effective are NOT NULL columns nothing actually reads (see
    // structureHeaderError) — CURDATE() satisfies the constraint without asking the admin to
    // fill in a meaningless date, matching legacy's present-day disuse of these fields.
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO salary_structure
         (company_code, structure_name, prorate_code, prorate_desc, fixed_days, defined_structure_for,
          structure_eg_amt, structure_created_date, startdate_effective, enddate_effective, structure_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, UNIX_TIMESTAMP(), CURDATE(), CURDATE(), 1)`,
      [
        session.user.companyCode, body.structure_name, body.prorate_code ?? '', body.prorate_desc ?? '',
        fixedDays, body.defined_structure_for ?? '', exampleGross,
      ]
    );

    await saveStructureDetails(connection, result.insertId, body.details ?? [], exampleGross);

    await connection.commit();
    return NextResponse.json({ id: result.insertId }, { status: 201 });
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
