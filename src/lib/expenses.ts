import type { Pool, RowDataPacket } from 'mysql2/promise';
import { getAuthorizerApprover } from '@/lib/leave';

export interface ExpensePerson { empFkey: number; name: string }

// Ports EmployeeExpensesController::form()'s employee-side Authorized By / Approved By lists:
// each comes from leave_auth_apr_person_fn ('auth' / 'api' — 'api' is identical to 'apr' in the
// function). When the function returns nothing ('0' in legacy, falsy in PHP) the list falls back
// to every other active employee. The applicant is never offered as an approver, nor (in the
// fallback) as an authorizer. Labels match legacy's "First Last - emp_company_id".
export async function getExpensePeople(
  pool: Pool,
  companyCode: string,
  empFkey: number
): Promise<{ authorizers: ExpensePerson[]; approvers: ExpensePerson[] }> {
  const { authorizerIds, approverIds } = await getAuthorizerApprover(pool, companyCode, empFkey);

  const list = async (ids: number[]) => {
    const wanted = ids.filter((id) => id !== empFkey);
    const byIds = wanted.length > 0;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT e.emp_pkey, e.first_name, e.last_name, p.emp_company_id
       FROM emp_details e JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
       WHERE e.status = 1 AND e.emp_pkey != ? ${byIds ? `AND e.emp_pkey IN (${wanted.map(() => '?').join(',')})` : ''}
       ORDER BY e.first_name, e.last_name`,
      byIds ? [empFkey, ...wanted] : [empFkey]
    );
    return rows.map((r) => {
      const name = `${r.first_name} ${r.last_name ?? ''}`.trim();
      return { empFkey: Number(r.emp_pkey), name: r.emp_company_id ? `${name} - ${r.emp_company_id}` : name };
    });
  };

  const [authorizers, approvers] = await Promise.all([list(authorizerIds), list(approverIds)]);
  return { authorizers, approvers };
}

// Ports EmployeeExpensesController::salarycheck(): an expense can't be filed for a date before the
// employee joined, or for a month whose salary has already been processed. Returns the legacy
// message to show, or null when the date is fine.
export async function expenseDateError(pool: Pool, empFkey: number, expenseDate: string): Promise<string | null> {
  const [[proff]] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(p.joining_date, '%Y-%m-%d') AS doj
     FROM emp_proff p JOIN emp_details e ON e.emp_pkey = p.emp_fkey
     WHERE p.emp_fkey = ? AND e.status = 1`,
    [empFkey]
  );
  if (proff?.doj && expenseDate < proff.doj) return 'Employee Not Exist in this Date';

  const [[slip]] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM emp_salary_slip WHERE month_year = ? AND emp_fkey = ? AND end_date_effective IS NULL LIMIT 1`,
    [expenseDate.slice(0, 7), empFkey]
  );
  if (slip) return 'Salary already processed';
  return null;
}
