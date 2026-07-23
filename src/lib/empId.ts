import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

/**
 * Mirrors legacy loadEmpProfDetails() (EmployeeController.php / EmployeeJoinController.php,
 * byte-identical in both): next emp_id = highest existing numeric emp_id + 1, or 1000 if
 * this is the first employee. Real dev data confirms emp_id is plain numeric (no company
 * code prefix), matching this implementation rather than the letter-prefixed reading of
 * the legacy source.
 */
export async function generateNextEmpId(pool: Pool | PoolConnection): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT emp_id FROM emp_details WHERE emp_id REGEXP '^[0-9]+$' ORDER BY CAST(emp_id AS UNSIGNED) DESC LIMIT 1"
  );
  if (rows.length) {
    return String(Number(rows[0].emp_id) + 1);
  }
  return '1000';
}
