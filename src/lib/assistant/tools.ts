import type { Pool, RowDataPacket } from 'mysql2/promise';

export interface AssistantContext {
  pool: Pool;
  userGroup: number; // 1 = admin, 2 = employee
  empFkey: number | null; // caller's own emp_pkey (null for the admin login)
  loginUserId: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  execute: (args: Record<string, unknown>, ctx: AssistantContext) => Promise<unknown>;
}

function isAdmin(ctx: AssistantContext) {
  return ctx.userGroup === 1;
}

/** Resolves a free-text name/employee-id into an emp_pkey, scoped to what the caller may see. */
async function resolveEmployee(
  nameOrId: string,
  ctx: AssistantContext
): Promise<{ emp_pkey: number; EmpName: string } | null> {
  if (!isAdmin(ctx)) {
    // Non-admins can only ever resolve themselves — prevents "show me <coworker>'s leave balance".
    if (!ctx.empFkey) return null;
    const [rows] = await ctx.pool.execute<RowDataPacket[]>(
      `SELECT emp_pkey, EmpName FROM employee_info WHERE emp_pkey = ?`,
      [ctx.empFkey]
    );
    return (rows[0] as { emp_pkey: number; EmpName: string }) ?? null;
  }

  const [rows] = await ctx.pool.execute<RowDataPacket[]>(
    `SELECT emp_pkey, EmpName FROM employee_info
     WHERE emp_status = 1 AND (EmpName LIKE ? OR employee_id = ?)
     ORDER BY (employee_id = ?) DESC LIMIT 1`,
    [`%${nameOrId}%`, nameOrId, nameOrId]
  );
  return (rows[0] as { emp_pkey: number; EmpName: string }) ?? null;
}

export const tools: ToolDefinition[] = [
  {
    name: 'getEmployeeCount',
    description:
      'Get the total number of active employees, optionally filtered by branch or department name.',
    parameters: {
      type: 'object',
      properties: {
        branch: { type: 'string', description: 'Branch name to filter by (optional)' },
        department: { type: 'string', description: 'Department name to filter by (optional)' },
      },
    },
    execute: async (args, ctx) => {
      const conditions = ['emp_status = 1'];
      const params: string[] = [];
      if (args.branch) {
        conditions.push('branch LIKE ?');
        params.push(`%${args.branch}%`);
      }
      if (args.department) {
        conditions.push('department LIKE ?');
        params.push(`%${args.department}%`);
      }
      const [[row]] = await ctx.pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM employee_info WHERE ${conditions.join(' AND ')}`,
        params
      );
      return { count: row?.total ?? 0 };
    },
  },

  {
    name: 'getEmployeeProfile',
    description:
      "Look up an employee's basic profile (name, branch, department, designation, joining date, status) by name or employee ID.",
    parameters: {
      type: 'object',
      properties: {
        nameOrId: { type: 'string', description: 'Employee name or employee ID to search for' },
      },
      required: ['nameOrId'],
    },
    execute: async (args, ctx) => {
      const emp = await resolveEmployee(String(args.nameOrId ?? ''), ctx);
      if (!emp) return { found: false };
      const [[row]] = await ctx.pool.execute<RowDataPacket[]>(
        `SELECT EmpName, employee_id, branch, department, designation, joining_date,
                CASE emp_status WHEN 1 THEN 'Active' WHEN 2 THEN 'Relieved' ELSE 'Inactive' END AS status
         FROM employee_info WHERE emp_pkey = ?`,
        [emp.emp_pkey]
      );
      return { found: true, profile: row };
    },
  },

  {
    name: 'getLeaveBalance',
    description:
      "Get an employee's current leave balance for each leave type they are eligible for. If the caller is not an admin, this always returns their own balance regardless of the name given.",
    parameters: {
      type: 'object',
      properties: {
        nameOrId: {
          type: 'string',
          description: 'Employee name or employee ID (ignored for non-admin callers, who only see their own)',
        },
      },
    },
    execute: async (args, ctx) => {
      const emp = await resolveEmployee(String(args.nameOrId ?? ''), ctx);
      if (!emp) return { found: false };

      const { getEmployeeLeaveTypes, getLeaveBalance } = await import('@/lib/leave');
      const today = new Date().toISOString().slice(0, 10);
      const types = await getEmployeeLeaveTypes(ctx.pool, emp.emp_pkey);
      const balances = await Promise.all(
        types.map(async (t) => ({
          leaveType: t.name,
          balance: await getLeaveBalance(ctx.pool, emp.emp_pkey, t.salaryHeadItemFkey, today, t.allowNegative),
        }))
      );
      return { found: true, employee: emp.EmpName, balances };
    },
  },

  {
    name: 'getPendingLeaveRequests',
    description:
      'List leave requests currently awaiting the caller\'s authorization or approval. Admin/approver use only.',
    parameters: { type: 'object', properties: {} },
    execute: async (_args, ctx) => {
      if (!isAdmin(ctx)) return { error: 'Only admins/approvers can view pending approvals.' };
      const [rows] = await ctx.pool.execute<RowDataPacket[]>(
        `SELECT e.first_name, e.last_name, l.LEAVESTATUS AS status, l.FROMDATE AS fromDate, l.TODATE AS toDate
         FROM leaveentries l
         LEFT JOIN emp_details e ON e.emp_pkey = l.EMP_fkey
         WHERE (l.ISAutherizedby = ? AND l.ISAutherized = '0' AND l.LEAVESTATUS IN ('Applied'))
            OR (l.APPROVEDBY = ? AND l.ISAPPROVED = '0' AND l.ISAutherized = '1' AND l.LEAVESTATUS IN ('Authorized'))
         ORDER BY l.FROMDATE DESC LIMIT 20`,
        [ctx.loginUserId, ctx.loginUserId]
      );
      return { pending: rows };
    },
  },

  {
    name: 'getAttendanceStatus',
    description:
      "Check whether a specific employee is marked present today, or (admin only, no name given) get today's total present count.",
    parameters: {
      type: 'object',
      properties: {
        nameOrId: { type: 'string', description: 'Employee name or employee ID (optional)' },
      },
    },
    execute: async (args, ctx) => {
      if (!args.nameOrId) {
        if (!isAdmin(ctx)) return { error: 'Only admins can view company-wide attendance.' };
        const [[row]] = await ctx.pool.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS total FROM present_today`
        );
        return { presentToday: row?.total ?? 0 };
      }
      const emp = await resolveEmployee(String(args.nameOrId), ctx);
      if (!emp) return { found: false };
      const [rows] = await ctx.pool.execute<RowDataPacket[]>(
        `SELECT 1 FROM present_today WHERE emp_pkey = ?`,
        [emp.emp_pkey]
      );
      return { found: true, employee: emp.EmpName, presentToday: rows.length > 0 };
    },
  },

  {
    name: 'getNewJoiners',
    description: 'List employees who joined within a given number of past days (default 30).',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'How many days back to look (default 30)' },
      },
    },
    execute: async (args, ctx) => {
      const days = Number(args.days) > 0 ? Number(args.days) : 30;
      const [rows] = await ctx.pool.execute<RowDataPacket[]>(
        `SELECT EmpName, employee_id, branch, department, designation, joining_date
         FROM employee_info
         WHERE emp_status = 1 AND joining_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         ORDER BY joining_date DESC LIMIT 50`,
        [days]
      );
      return { joiners: rows };
    },
  },

  {
    name: 'getHeadcountBreakdown',
    description: 'Get active employee headcount grouped by branch or by department. Admin only.',
    parameters: {
      type: 'object',
      properties: {
        groupBy: { type: 'string', description: "Either 'branch' or 'department'" },
      },
      required: ['groupBy'],
    },
    execute: async (args, ctx) => {
      if (!isAdmin(ctx)) return { error: 'Only admins can view company-wide headcount breakdowns.' };
      const col = args.groupBy === 'department' ? 'department' : 'branch';
      const [rows] = await ctx.pool.execute<RowDataPacket[]>(
        `SELECT ${col} AS \`group\`, COUNT(*) AS count
         FROM employee_info WHERE emp_status = 1
         GROUP BY ${col} ORDER BY count DESC`
      );
      return { breakdown: rows };
    },
  },

  {
    name: 'getUpcomingEvents',
    description:
      'List employees with a birthday or work anniversary in the next N days (default 14).',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'How many days ahead to look (default 14)' },
      },
    },
    execute: async (args, ctx) => {
      const days = Number(args.days) > 0 ? Number(args.days) : 14;
      const [birthdays] = await ctx.pool.execute<RowDataPacket[]>(
        `SELECT EmpName, employee_id, date_of_birth
         FROM employee_info i JOIN emp_details ed ON ed.emp_pkey = i.emp_pkey
         WHERE emp_status = 1 AND date_of_birth IS NOT NULL
           AND DATEDIFF(
                 DATE(CONCAT(YEAR(CURDATE()), '-', DATE_FORMAT(date_of_birth, '%m-%d'))),
                 CURDATE()
               ) BETWEEN 0 AND ?
         ORDER BY DATE_FORMAT(date_of_birth, '%m-%d') LIMIT 20`,
        [days]
      );
      const [anniversaries] = await ctx.pool.execute<RowDataPacket[]>(
        `SELECT EmpName, employee_id, joining_date
         FROM employee_info
         WHERE emp_status = 1 AND joining_date IS NOT NULL
           AND DATEDIFF(
                 DATE(CONCAT(YEAR(CURDATE()), '-', DATE_FORMAT(joining_date, '%m-%d'))),
                 CURDATE()
               ) BETWEEN 0 AND ?
         ORDER BY DATE_FORMAT(joining_date, '%m-%d') LIMIT 20`,
        [days]
      );
      return { birthdays, anniversaries };
    },
  },
];

export function getToolByName(name: string): ToolDefinition | undefined {
  return tools.find((t) => t.name === name);
}
