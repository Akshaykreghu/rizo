import type { Pool, RowDataPacket } from 'mysql2/promise';

// Punch type (mob_user_credentials.punchtype) that allows punching from the ESS home page.
// Legacy (View/Dashboard/empdashboard.ctp) only rendered the IN/OUT buttons for 'S' ("Web");
// 'W' is Machine, 'M'/'O' are the mobile app.
export const WEB_PUNCH_TYPE = 'S';

export async function canWebPunch(pool: Pool, empFkey: number | string): Promise<boolean> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT mc.punchtype FROM user_credentials uc
     JOIN mob_user_credentials mc ON mc.user_id = uc.user_id
     WHERE uc.emp_fkey = ? LIMIT 1`,
    [empFkey]
  );
  return String(row?.punchtype ?? '').toUpperCase() === WEB_PUNCH_TYPE;
}
