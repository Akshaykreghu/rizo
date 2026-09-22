import mysql from 'mysql2/promise';

// Both pools below are deliberately pinned to timezone: '+00:00' so that plain DATE columns
// round-trip correctly via toISODate()'s UTC-getter approach (lib/settlement.ts) — pointing this
// at the DB server's real SYSTEM timezone instead (confirmed IST/+05:30 live: TIMEDIFF(NOW(),
// UTC_TIMESTAMP()) = 05:30:00) would fix DATETIME columns but shift every plain DATE column back
// by a day instead (a DATE has no time component, so mysql2 anchors it at UTC midnight; midnight
// IST is 18:30 the previous day in UTC).
//
// The tradeoff: any column that carries genuine time-of-day meaning (a punch/log DATETIME, not a
// bare DATE — e.g. device_attandance.LOGDATE, emp_detail_timeattandance.att_in_time/att_out_time)
// was actually written as literal IST wall-clock (this DB's NOW() is IST, confirmed above), but
// mysql2 reads its digits back mislabeled as UTC. Diffing two such mislabeled reads against EACH
// OTHER still cancels out correctly, but comparing one against a genuine `Date.now()`/`new Date()`,
// or letting it reach the client to be formatted as a wall-clock time, is off by exactly +5:30
// unless corrected once here.
const IST_MISLABEL_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export function realInstant(dbDateTime: Date | null | undefined): Date | null {
  if (!dbDateTime) return null;
  return new Date(dbDateTime.getTime() - IST_MISLABEL_OFFSET_MS);
}

// Singleton pattern for Next.js hot-reload compatibility
const globalForPools = global as typeof globalThis & {
  _controlPool?: mysql.Pool;
  _companyPools?: Map<string, mysql.Pool>;
};

function getControlPool(): mysql.Pool {
  if (!globalForPools._controlPool) {
    globalForPools._controlPool = mysql.createPool({
      host: process.env.CONTROL_DB_HOST || 'localhost',
      port: process.env.CONTROL_DB_PORT ? Number(process.env.CONTROL_DB_PORT) : 3306,
      user: process.env.CONTROL_DB_USER || 'root',
      password: process.env.CONTROL_DB_PASSWORD || '',
      database: process.env.CONTROL_DB_NAME || 'mypayrol_control_db',
      connectionLimit: 5,
      waitForConnections: true,
      timezone: '+00:00',
    });
  }
  return globalForPools._controlPool;
}

function getCompanyPoolsMap(): Map<string, mysql.Pool> {
  if (!globalForPools._companyPools) {
    globalForPools._companyPools = new Map();
  }
  return globalForPools._companyPools;
}

export const controlPool = getControlPool();

export async function getCompanyPool(companyCode: string): Promise<mysql.Pool> {
  const pools = getCompanyPoolsMap();

  if (pools.has(companyCode)) {
    return pools.get(companyCode)!;
  }

  const [rows] = await controlPool.execute<mysql.RowDataPacket[]>(
    `SELECT user_db, Admin_name, user_pwd
     FROM central_control
     WHERE company_code = ? AND active = 'active'`,
    [companyCode]
  );

  if (!rows.length) {
    throw new Error(`Company not found or inactive: ${companyCode}`);
  }

  const { user_db, Admin_name, user_pwd } = rows[0];

  const isDev = process.env.NODE_ENV === 'development';
  const pool = mysql.createPool({
    host: process.env.COMPANY_DB_HOST || process.env.CONTROL_DB_HOST || 'localhost',
    port: process.env.CONTROL_DB_PORT ? Number(process.env.CONTROL_DB_PORT) : 3306,
    user: isDev ? (process.env.CONTROL_DB_USER || 'root') : Admin_name,
    password: isDev ? (process.env.CONTROL_DB_PASSWORD || '') : user_pwd,
    database: user_db,
    connectionLimit: 10,
    waitForConnections: true,
    timezone: '+00:00',
  });

  pools.set(companyCode, pool);
  return pool;
}
