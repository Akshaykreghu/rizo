import mysql from 'mysql2/promise';

// Singleton pattern for Next.js hot-reload compatibility
const globalForPools = global as typeof globalThis & {
  _controlPool?: mysql.Pool;
  _companyPools?: Map<string, mysql.Pool>;
};

function getControlPool(): mysql.Pool {
  if (!globalForPools._controlPool) {
    globalForPools._controlPool = mysql.createPool({
      host: process.env.CONTROL_DB_HOST || 'localhost',
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
