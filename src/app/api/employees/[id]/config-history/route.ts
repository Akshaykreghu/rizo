import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// An employee's configuration history — the "History Table" legacy's All Employees "History"
// button opens (PromoController::promotion() -> View/Promo/promotion.ctp): every salary structure,
// CTC, shift, holiday/leave policy and hierarchy change from the emp_config_history view.
// Legacy hides rows made by internal support logins (created_by LIKE '%support%', except
// 'support550') for every company except GLET; kept as-is.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  const hideSupport = session.user.companyCode.toLowerCase() !== 'glet';

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT type, day_time_desc, status,
            DATE_FORMAT(creation_date, '%d-%m-%Y %H:%i') AS creation_date,
            created_by
     FROM emp_config_history
     WHERE emp_fkey = ?
       ${hideSupport ? "AND (created_by NOT LIKE '%support%' OR created_by = 'support550' OR created_by IS NULL)" : ''}
     ORDER BY emp_config_history.creation_date DESC`,
    [id]
  );
  return NextResponse.json({ data: rows });
}
