import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool, controlPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { RowDataPacket, Pool } from 'mysql2/promise';

type Status = 'configured' | 'action-required' | 'not-configured';

interface SectionStatus {
  status: Status;
  detail: string;
}

async function queryOne(pool: Pool, sql: string, params: (string | number)[] = []): Promise<RowDataPacket | undefined> {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return rows[0];
}

async function count(pool: Pool, sql: string, params: (string | number)[] = []): Promise<number> {
  const row = await queryOne(pool, sql, params);
  return Number(row?.cnt ?? 0);
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// Drives the status badges + progress bar on the Company Setup menu grid. Each section gets a
// cheap COUNT/EXISTS check against the same tables its own setup screen reads from — no writes,
// nothing beyond what an admin could already see by opening each screen individually.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const companyCode = session.user.companyCode;

  const [
    companyProfile,
    contactsCount,
    holidaysCount,
    leavePoliciesCount,
    shiftsCount,
    salaryStructuresCount,
    devicesCount,
    professionCount,
  ] = await Promise.all([
    queryOne(pool, 'SELECT business_name FROM comp_contact_info LIMIT 1'),
    count(pool, 'SELECT COUNT(*) AS cnt FROM contacts'),
    count(pool, 'SELECT COUNT(*) AS cnt FROM holidays WHERE status = 1'),
    count(
      pool,
      `SELECT COUNT(*) AS cnt FROM leavepolicy lp
       JOIN leavepolicy_group g ON g.LEAVEPOLICY_GROUP_ID = lp.LEAVEPOLICY_GROUP_ID AND g.status = 1
       WHERE lp.status = 1`
    ),
    count(pool, "SELECT COUNT(*) AS cnt FROM working_day_time_procedures WHERE active <> 0"),
    count(pool, 'SELECT COUNT(*) AS cnt FROM salary_structure WHERE structure_active = 1'),
    count(controlPool, 'SELECT COUNT(*) AS cnt FROM devices WHERE company_code = ?', [companyCode]),
    count(
      pool,
      `SELECT
         (SELECT COUNT(*) FROM department WHERE status = 1)
       + (SELECT COUNT(*) FROM designation WHERE status = 1)
       + (SELECT COUNT(*) FROM grade WHERE status = 1)
       + (SELECT COUNT(*) FROM notice_period WHERE status = 1)
       + (SELECT COUNT(*) FROM division WHERE status = 1)
       + (SELECT COUNT(*) FROM section WHERE status = 1) AS cnt`
    ),
  ]);

  const sections: Record<string, SectionStatus> = {
    'Company Profile': companyProfile?.business_name
      ? { status: 'configured', detail: 'Configured' }
      : { status: 'not-configured', detail: 'Not configured' },
    'Contacts': contactsCount > 0
      ? { status: 'configured', detail: plural(contactsCount, 'contact') }
      : { status: 'not-configured', detail: 'Not configured' },
    'Holiday': holidaysCount > 0
      ? { status: 'configured', detail: plural(holidaysCount, 'holiday') }
      : { status: 'not-configured', detail: 'Not configured' },
    'Leave': leavePoliciesCount > 0
      ? { status: 'configured', detail: plural(leavePoliciesCount, 'policy') }
      : { status: 'not-configured', detail: 'Not configured' },
    'Shift': shiftsCount > 0
      ? { status: 'configured', detail: plural(shiftsCount, 'shift') }
      : { status: 'not-configured', detail: 'Not configured' },
    'Salary': salaryStructuresCount > 0
      ? { status: 'configured', detail: plural(salaryStructuresCount, 'structure') }
      : { status: 'not-configured', detail: 'Not configured' },
    'Devices': devicesCount > 0
      ? { status: 'configured', detail: plural(devicesCount, 'device') }
      : { status: 'not-configured', detail: 'Not configured' },
    'Profession': professionCount > 0
      ? { status: 'configured', detail: plural(professionCount, 'item') }
      : { status: 'not-configured', detail: 'Not configured' },
  };

  const configuredCount = Object.values(sections).filter((s) => s.status === 'configured').length;

  return NextResponse.json({ sections, configuredCount, totalCount: Object.keys(sections).length });
}
