import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);

  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT 'BIR' as event_type, first_name, last_name,
           DATE_FORMAT(date_of_birth,'%M %d') as event_date
    FROM emp_details
    WHERE DATE_FORMAT(date_of_birth,'%m-%d')
          BETWEEN DATE_FORMAT(CURDATE(),'%m-%d')
          AND DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 7 DAY),'%m-%d')
      AND status = 1
    UNION
    SELECT 'JOIN' as event_type, e.first_name, e.last_name,
           DATE_FORMAT(p.joining_date,'%M %d') as event_date
    FROM emp_proff p
    LEFT JOIN emp_details e ON e.emp_pkey = p.emp_fkey
    WHERE DATE_FORMAT(p.joining_date,'%m-%d')
          BETWEEN DATE_FORMAT(CURDATE(),'%m-%d')
          AND DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 7 DAY),'%m-%d')
      AND e.status = 1
    ORDER BY event_date
  `);

  return NextResponse.json(rows);
}
