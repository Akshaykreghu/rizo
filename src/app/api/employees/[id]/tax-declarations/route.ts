import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors legacy TaxController::setup()/TaxationController::saveemployeetaxheads(): an
// employee's declarations only exist against the branch's currently-open financial year
// (fin_year table, Year_status='OPEN' AND is_current_finyear='Y'). Real dev data can have more
// than one row flagged is_current_finyear='Y' per branch (an April-March fiscal year and a
// calendar year both open at once) — pick the most recently started one, same as an admin
// eyeballing the list would.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT p.emp_branch, e.first_name, e.last_name FROM emp_proff p JOIN emp_details e ON e.emp_pkey = p.emp_fkey WHERE p.emp_fkey = ?',
    [id]
  );
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const [[finYear]] = await pool.execute<RowDataPacket[]>(
    `SELECT Fin_year_seq, fin_year, start_month, end_month
     FROM fin_year
     WHERE branch_code = ? AND Year_status = 'OPEN' AND is_current_finyear = 'Y' AND status = 1
     ORDER BY start_month DESC LIMIT 1`,
    [emp.emp_branch]
  );
  if (!finYear) {
    return NextResponse.json({ noFinYear: true, employee: emp });
  }

  const [heads] = await pool.execute<RowDataPacket[]>(
    `SELECT tax_heads_pkey, tax_name, tax_type, order_level1
     FROM tax_heads WHERE tax_active = 'Y'
     ORDER BY tax_type DESC, order_level1`
  );
  const [details] = await pool.execute<RowDataPacket[]>(
    `SELECT tax_heads_details_pkey, tax_heads_fkey, tax_heads_details
     FROM tax_heads_details WHERE active = 1 AND status = 1
     ORDER BY tax_heads_details_pkey`
  );
  const [transactions] = await pool.execute<RowDataPacket[]>(
    `SELECT tax_heads_fkey, tax_heads_details_fkey, tax_value, locked, file_name
     FROM emp_tax_transactions WHERE emp_fkey = ? AND fin_year = ?`,
    [id, finYear.fin_year]
  );

  const txByKey = new Map(transactions.map((t) => [`${t.tax_heads_fkey}:${t.tax_heads_details_fkey}`, t]));

  const result = heads.map((head) => {
    const childDetails = details.filter((d) => d.tax_heads_fkey === head.tax_heads_pkey);
    if (childDetails.length === 0) {
      const tx = txByKey.get(`${head.tax_heads_pkey}:0`);
      return {
        tax_heads_pkey: head.tax_heads_pkey,
        tax_name: head.tax_name,
        tax_type: head.tax_type,
        lines: [{
          tax_heads_details_pkey: 0,
          label: head.tax_name,
          tax_value: tx?.tax_value ?? null,
          locked: tx?.locked === 'Y',
          file_name: tx?.file_name ?? null,
        }],
      };
    }
    return {
      tax_heads_pkey: head.tax_heads_pkey,
      tax_name: head.tax_name,
      tax_type: head.tax_type,
      lines: childDetails.map((d) => {
        const tx = txByKey.get(`${head.tax_heads_pkey}:${d.tax_heads_details_pkey}`);
        return {
          tax_heads_details_pkey: d.tax_heads_details_pkey,
          label: d.tax_heads_details,
          tax_value: tx?.tax_value ?? null,
          locked: tx?.locked === 'Y',
          file_name: tx?.file_name ?? null,
        };
      }),
    };
  });

  return NextResponse.json({
    employee: emp,
    finYear: { fin_year: finYear.fin_year, start_month: finYear.start_month, end_month: finYear.end_month },
    heads: result,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { tax_heads_fkey, tax_heads_details_fkey, tax_value, fin_year } = body as {
    tax_heads_fkey: number; tax_heads_details_fkey: number; tax_value: number; fin_year: number;
  };

  const pool = await getCompanyPool(session.user.companyCode);

  const [[existing]] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_tax_tran_id, tax_value, locked FROM emp_tax_transactions
     WHERE emp_fkey = ? AND tax_heads_fkey = ? AND tax_heads_details_fkey = ? AND fin_year = ?`,
    [id, tax_heads_fkey, tax_heads_details_fkey, fin_year]
  );

  if (existing?.locked === 'Y') {
    return NextResponse.json({ error: 'This tax head is locked by admin and cannot be edited' }, { status: 403 });
  }

  if (existing) {
    await pool.execute(
      `UPDATE emp_tax_transactions SET \`last_value\` = tax_value, tax_value = ?, modified_by = ?
       WHERE emp_tax_tran_id = ?`,
      [tax_value, session.user.loginUserId, existing.emp_tax_tran_id]
    );
  } else {
    await pool.execute(
      `INSERT INTO emp_tax_transactions
         (emp_fkey, tax_heads_fkey, tax_heads_details_fkey, tax_value, fin_year, created_by, locked)
       VALUES (?, ?, ?, ?, ?, ?, 'N')`,
      [id, tax_heads_fkey, tax_heads_details_fkey, tax_value, fin_year, session.user.loginUserId]
    );
  }

  return NextResponse.json({ success: true });
}
