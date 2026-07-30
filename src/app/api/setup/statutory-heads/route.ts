import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports TaxsalarycomponentsController (legacy's real "Statutory Heads" screen, table
// tax_salary_components) — a FIXED set of ~17 standard report labels (Basic, HRA, Employee
// EPF, ...) that admin maps to whichever actual salary_head_item the company has configured.
// Rows are never created/deleted here, only their salary_head_item_Fkey/upper_limit mapping is
// edited — matching legacy's bulk save() over posted pkey[]/components[]/Limit[] arrays.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT tsc.tax_salary_components_pkey, tsc.tax_salary_components_name,
            tsc.salary_head_item_Fkey, tsc.upper_limit, shi.item AS mapped_item_name
     FROM tax_salary_components tsc
     LEFT JOIN salary_head_items shi ON shi.salary_head_item_pkey = tsc.salary_head_item_Fkey
     WHERE tsc.status = 1
     ORDER BY tsc.tax_salary_components_pkey`
  );
  return NextResponse.json(rows);
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const updates = Array.isArray(body.updates) ? body.updates : [];
  const pool = await getCompanyPool(session.user.companyCode);

  try {
    for (const u of updates as { pkey: number; salary_head_item_Fkey: number | null; upper_limit: number }[]) {
      await pool.execute(
        'UPDATE tax_salary_components SET salary_head_item_Fkey = ?, upper_limit = ? WHERE tax_salary_components_pkey = ?',
        [u.salary_head_item_Fkey ?? null, Number(u.upper_limit) || 0, u.pkey]
      );
    }
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return NextResponse.json(
        { error: 'The same salary head item is already mapped to another statutory head' },
        { status: 409 }
      );
    }
    throw err;
  }
  return NextResponse.json({ success: true });
}
