import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

// Ports ExceptionRuleController (menu label "Exceptions", legacy internal name "Exception Rule") —
// confirmed live via a real, recently-created rule row and the actual stored procs it calls
// (exception_rule_apply_prce / exception_rule_reversal_proc, both present and non-trivial in the
// live schema). Applying a rule is genuinely consequential: the proc auto-regularizes late-in/
// early-out punches and can auto-approve LOP/leave deductions for a whole branch-month — reused
// here exactly as everywhere else in this project (never reimplemented).
//
// `status` on exception_rule is a soft-delete flag (0 = not deleted, 1 = deleted via deleteRule()),
// distinct from `activate_status` (the real enable/disable toggle) — confirmed via deleteRule()'s
// own save (`status=1, activate_status=0`) and getAllRules()'s list filter (`status=0`).
//
// `created_by` on exception_applied is fixed here to the real logged-in user id — legacy's
// applyRule() reads `Session::read('username')`, a key nothing else in the app ever sets, and its
// own live sample data shows created_by landing as '' as a result. Not replicated as a "feature".

export interface ExceptionRule {
  exceptionId: number;
  ruleName: string;
  ruleType: string;
  dataType: number; // 0=Early Out, 1=Late In, 2=Both
  exceptionDays: number | null;
  exceptionTime: number | null; // minutes of tolerance (see column note below)
  actionAfterException: number; // 0=Leave Deduction, 1=LOP
  detectCount: number;
  leaveDetectType: number | null; // 87=CL,86=SL,88=EL,114=CompOff,89=PL,105=LOP
  resetStatus: boolean;
  activateStatus: boolean;
  createdBy: string | null;
  creationTime: string | null;
}

function mapRuleRow(r: RowDataPacket): ExceptionRule {
  return {
    exceptionId: r.exception_id,
    ruleName: r.rule_name,
    ruleType: r.rule_type,
    dataType: r.data_type,
    exceptionDays: r.exception_days,
    exceptionTime: r.exception_time,
    actionAfterException: r.action_after_exception,
    detectCount: Number(r.detect_count),
    leaveDetectType: r.leave_detect_type,
    resetStatus: r.reset_status === 1,
    activateStatus: r.activate_status === 1,
    createdBy: r.created_by ?? null,
    creationTime: r.creation_time ?? null,
  };
}

export async function listRules(pool: Pool): Promise<ExceptionRule[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM exception_rule WHERE status = 0 ORDER BY exception_id DESC`
  );
  return rows.map(mapRuleRow);
}

export interface RuleInput {
  ruleName: string;
  ruleType: string;
  dataType: number;
  exceptionDays: number | null;
  exceptionTime: number | null;
  actionAfterException: number;
  detectCount: number;
  leaveType: number | null;
  resetStatus: boolean;
  activateStatus: boolean;
}

// Mirrors saveRule()/updateRule()'s leave-type resolution: LOP action always forces leave type 105
// regardless of what was passed; Leave Deduction keeps whatever valid leave type was chosen.
function resolveLeaveDetectType(input: RuleInput): number {
  return input.actionAfterException === 1 ? 105 : (input.leaveType ?? 0);
}

// Mirrors saveRule()'s customRound() — rounds detect_count down to the nearest 0.5.
function customRound(value: number): number {
  const intPart = Math.floor(value);
  const decimal = value - intPart;
  return decimal < 0.5 ? intPart : intPart + 0.5;
}

export class RuleNameExistsError extends Error {
  constructor() { super('This rule name already exists'); }
}

export async function createRule(pool: Pool, input: RuleInput, createdBy: string): Promise<number> {
  const [[existing]] = await pool.execute<RowDataPacket[]>(
    'SELECT exception_id FROM exception_rule WHERE LOWER(rule_name) = LOWER(?) AND status = 0',
    [input.ruleName]
  );
  if (existing) throw new RuleNameExistsError();

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO exception_rule
       (rule_name, rule_type, data_type, exception_days, exception_time, action_after_exception,
        detect_count, leave_detect_type, reset_status, activate_status, status, creation_time, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), ?)`,
    [
      input.ruleName.trim(), input.ruleType.trim(), input.dataType,
      input.exceptionDays ?? null, input.exceptionTime ?? null, input.actionAfterException,
      customRound(input.detectCount), resolveLeaveDetectType(input),
      input.resetStatus ? 1 : 0, input.activateStatus ? 1 : 0, createdBy,
    ]
  );
  return result.insertId;
}

export async function updateRule(pool: Pool, exceptionId: number, input: RuleInput, modifiedBy: string): Promise<void> {
  const [[existing]] = await pool.execute<RowDataPacket[]>(
    'SELECT exception_id FROM exception_rule WHERE LOWER(rule_name) = LOWER(?) AND status = 0 AND exception_id != ?',
    [input.ruleName, exceptionId]
  );
  if (existing) throw new RuleNameExistsError();

  await pool.execute(
    `UPDATE exception_rule SET
       rule_name = ?, rule_type = ?, data_type = ?, action_after_exception = ?,
       exception_days = ?, exception_time = ?, detect_count = ?, leave_detect_type = ?,
       reset_status = ?, activate_status = ?, modification_time = NOW(), modified_by = ?
     WHERE exception_id = ?`,
    [
      input.ruleName.trim(), input.ruleType.trim(), input.dataType, input.actionAfterException,
      input.exceptionDays ?? null, input.exceptionTime ?? null, customRound(input.detectCount),
      resolveLeaveDetectType(input), input.resetStatus ? 1 : 0, input.activateStatus ? 1 : 0,
      modifiedBy, exceptionId,
    ]
  );
}

export async function softDeleteRule(pool: Pool, exceptionId: number): Promise<void> {
  await pool.execute(
    `UPDATE exception_rule SET status = 1, activate_status = 0 WHERE exception_id = ?`,
    [exceptionId]
  );
}

export interface AppliedRuleRow {
  exceptionAppliedPkey: number;
  ruleId: number;
  ruleName: string;
  branchCode: string;
  branchName: string | null;
  appliedDate: string;
  monthYear: string;
  createdBy: string | null;
}

export async function listAppliedRules(pool: Pool, limit: number, offset: number): Promise<{ rows: AppliedRuleRow[]; total: number }> {
  const [[countRow]] = await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM exception_applied');
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ea.exception_applied_pkey, ea.rule_id, er.rule_name, ea.branch_code, b.branch_name,
            ea.applied_date, ea.month_year, ea.created_by
     FROM exception_applied ea
     LEFT JOIN exception_rule er ON er.exception_id = ea.rule_id
     LEFT JOIN branches b ON b.branch_code = ea.branch_code
     ORDER BY ea.exception_applied_pkey DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return {
    total: Number(countRow?.total ?? 0),
    rows: rows.map((r) => ({
      exceptionAppliedPkey: r.exception_applied_pkey,
      ruleId: r.rule_id,
      ruleName: r.rule_name ?? '(deleted rule)',
      branchCode: r.branch_code,
      branchName: r.branch_name,
      appliedDate: r.applied_date,
      monthYear: r.month_year,
      createdBy: r.created_by || null,
    })),
  };
}

export class ApplyRuleError extends Error {}

// Mirrors applyRule()'s real guards: attendance already verified for the branch/month blocks
// applying (matching the same lock enforced everywhere else in this app), and — a real, somewhat
// surprising legacy behavior confirmed via source — only ONE rule total can be applied to a given
// branch/month, not just one instance of the same rule. Then calls the confirmed-live proc and
// logs the application; the proc's own side effects (auto-regularization, LOP/leave deduction) are
// never reimplemented here.
export async function applyRule(
  pool: Pool,
  branchCode: string,
  ruleId: number,
  month: string, // 'YYYY-MM'
  userLogin: string
): Promise<string> {
  const [[verified]] = await pool.execute<RowDataPacket[]>(
    `SELECT registerid FROM attendance_register WHERE branch_code = ? AND month_year = ? AND isdelete = 'N' LIMIT 1`,
    [branchCode, month]
  );
  if (verified) throw new ApplyRuleError('Attendance already verified for this month. Rule cannot be applied.');

  const [[already]] = await pool.execute<RowDataPacket[]>(
    `SELECT ea.exception_applied_pkey, er.rule_name FROM exception_applied ea
     JOIN exception_rule er ON er.exception_id = ea.rule_id
     WHERE ea.branch_code = ? AND ea.month_year = ? LIMIT 1`,
    [branchCode, month]
  );
  if (already) throw new ApplyRuleError(`Rule '${already.rule_name}' is already applied for this branch and month.`);

  const monthStart = `${month}-01`;
  await pool.query('CALL exception_rule_apply_prce(?, ?, ?, ?, @p_output)', [branchCode, monthStart, ruleId, userLogin]);
  const [[output]] = await pool.query<RowDataPacket[]>('SELECT @p_output AS message');
  const procMessage = output?.message || 'Rule applied successfully';

  await pool.execute(
    `INSERT INTO exception_applied (rule_id, branch_code, applied_date, month_year, creation_date, created_by, modification_date, modifyed_by)
     VALUES (?, ?, CURDATE(), ?, NOW(), ?, NOW(), '')`,
    [ruleId, branchCode, month, userLogin]
  );

  return procMessage;
}

export async function reverseAppliedRule(
  pool: Pool,
  exceptionAppliedPkey: number,
  branchCode: string,
  ruleId: number,
  monthYear: string
): Promise<string> {
  const monthStart = `${monthYear}-01`;
  await pool.query('CALL exception_rule_reversal_proc(?, ?, ?, @p_output)', [ruleId, branchCode, monthStart]);
  const [[output]] = await pool.query<RowDataPacket[]>('SELECT @p_output AS message');
  const procMessage = output?.message || 'Rule reversed successfully';

  await pool.execute('DELETE FROM exception_applied WHERE exception_applied_pkey = ?', [exceptionAppliedPkey]);

  return procMessage;
}
