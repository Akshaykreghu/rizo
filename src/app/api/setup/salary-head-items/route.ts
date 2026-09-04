import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports SalaryHeadsController's item (salary_head_items) CRUD, scoped to one head via
// ?headId=. `value` ('Y'/'N') and `status` are two independent live flags (confirmed) —
// `status` is the usual soft-delete, `value` is a separate "included in the active
// salary-head set" toggle that gates whether the Structure builder can see this item at all
// (SalaryStructureController only reads status=1 AND value='Y') — surfaced on the create/edit
// form as "Available in Structure Builder" so this trap is visible, not hidden behind a
// same-named-but-different `status` flag.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const headId = searchParams.get('headId');
  const buildable = searchParams.get('buildable') === '1';

  const pool = await getCompanyPool(session.user.companyCode);

  if (buildable) {
    // Every item eligible for the Salary Structure builder, across all live heads —
    // status=1 AND value='Y' on the item, and the parent head itself active — matching
    // SalaryStructureController::form()'s own filter. On a `basic`-plan tenant legacy further
    // restricts to heads flagged `plan='basic'` (heads 1/4/5 only); other plans see them all.
    const [[cci]] = await pool.execute<RowDataPacket[]>('SELECT plan FROM comp_contact_info LIMIT 1');
    const planBasic = String(cci?.plan ?? '').toLowerCase() === 'basic';
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT shi.salary_head_item_pkey, shi.item, shi.item_type, shi.head_fkey,
              sh.head_desc, sh.head_operator, sh.salary_head_order1
       FROM salary_head_items shi
       JOIN salary_heads sh ON sh.head_pkey = shi.head_fkey
       WHERE shi.status = 1 AND shi.value = 'Y' AND sh.status = 1
         ${planBasic ? "AND sh.plan = 'basic'" : ''}
       ORDER BY sh.salary_head_order1, shi.salary_head_item_order1`
    );
    return NextResponse.json(rows);
  }

  if (!headId) return NextResponse.json({ error: 'headId is required' }, { status: 400 });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT salary_head_item_pkey, head_fkey, item, item_type, item_value, occurance, item_part,
            value, is_show_salslip, status, salary_head_item_order1, comments
     FROM salary_head_items WHERE head_fkey = ? AND status = 1 ORDER BY salary_head_item_order1, salary_head_item_pkey`,
    [headId]
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const headId = searchParams.get('headId');
  const body = await request.json();
  if (!headId) return NextResponse.json({ error: 'headId is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO salary_head_items
       (head_fkey, item, item_type, item_value, occurance, item_part, value, is_show_salslip,
        status, salary_head_item_order1, comments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      headId, body.item, body.item_type ?? 'Fixed', body.item_value ?? null, body.occurance ?? null,
      body.item_part ?? 'Direct', body.value === 'N' ? 'N' : 'Y', body.is_show_salslip === 'N' ? 'N' : 'Y',
      Number(body.salary_head_item_order1) || 0, body.comments ?? '',
    ]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
