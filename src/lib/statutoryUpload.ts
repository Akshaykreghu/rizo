import type { Pool, RowDataPacket } from 'mysql2/promise';

// Ports the "Statutory Upload" screen's EPF Contribution sub-report
// (`EsiEpfReportController::generate_report()` + `View/EsiEpfReport/epf_contr.ctp`, menu-labelled
// "Statutory Upload" -> "EPF - Contribution"). Legacy renders this as a downloadable, `#~#`-delimited
// text file matching EPFO's real ECR upload row format: UAN#~#Name#~#Gross#~#EPFWages#~#EPSWages#~#
// EDLIWages#~#EPFContribution#~#EPSContribution#~#EPFEPSDiff#~#NCPDays#~#Refund.
//
// Deliberately NOT ported (documented backlog, same reasoning as statutoryReports.ts's header comment):
// - ESI Contribution: legacy recovers ESI wage base the same eval()-on-remarks way, but ESI's employee
//   rate is NOT uniform across GRTL's own live salary structures (some pre-2019 rows are 1.75%, current
//   ones 0.75% — a real data-quality issue already flagged in this project's memory). A fixed-rate
//   division (the safe substitute used below for EPF) would silently produce wrong wage bases for the
//   older structures, so this needs a per-employee rate lookup before it can be ported safely.
// - EPF Member Registration / EPF Exit: one-time KYC forms with many optional international-worker
//   fields (passport, nationality, country of origin) — low volume, different shape (form, not a batch
//   file) than everything else in this module.
// - WPS Template: UAE/Gulf Wage Protection System compliance format — confirmed irrelevant for GRTL
//   (an Indian tenant, in.mypayrollmaster.online).
// - EPF Upload: a further variant on top of `epf_contr`'s own data, not yet researched.
//
// Real, deliberate simplification vs. legacy: `generate_report()` recovers the PF wage base by eval()-ing
// an arithmetic string stored in `emp_salary_slip.remarks` (e.g. "6500*.12") and dividing by .12 — this
// project's standing discipline is to avoid eval() and read computed results directly instead. Since the
// statutory EPF employee rate is a fixed, legally-mandated 12% (unlike ESI's rate above), the wage base
// is mathematically recoverable, without eval, as `abs(salary_amount) / 0.12` from the employee's own PF
// deduction line — exactly what the stored remarks expression evaluates to, just derived from the answer
// instead of the formula. Also found and skipped two genuinely dead branches in the legacy view while
// reading it closely: a `subcat` ('pf' vs 'actual') toggle and an `emp_epf_contr <= 1800` threshold check
// that both evaluate to the same result on every real code path (traced by hand — not guessed).

export interface EpfContributionParams {
  monthYear: string; // 'YYYY-MM'
  branch?: string; // branch_code, optional
}

export interface EpfContributionRow extends RowDataPacket {
  emp_pkey: number;
  emp_name: string;
  uan: string;
  gross: number;
  epf_wages: number;
  eps_wages: number;
  edli_wages: number;
  epf_contribution: number;
  eps_contribution: number;
  epf_eps_diff: number;
  ncp_days: number;
  refund: number;
}

export async function generateEpfContributionReport(pool: Pool, params: EpfContributionParams) {
  const branchCondition = params.branch ? 'AND ed.branch_code = ?' : '';
  const args: (string | number)[] = [params.monthYear];
  if (params.branch) args.push(params.branch);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ed.emp_pkey, i.EmpName AS emp_name, ed.pf AS uan, ed.eps, ed.date_of_birth,
            ess.salary_amount AS pf_deduction, pm.loss_of_pay
     FROM emp_details ed
     LEFT JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
     LEFT JOIN emp_salary_slip ess ON ess.emp_fkey = ed.emp_pkey AND ess.month_year = ?
       AND ess.end_date_effective IS NULL AND ess.head_operator = 'Deduction' AND ess.item_part = 'Direct'
       AND ess.salary_head_item_desc LIKE '%PF%'
     LEFT JOIN payroll_master pm ON pm.emp_fkey = ed.emp_pkey AND pm.month_year = ?
     WHERE ed.status IN (1, 2) AND ed.pf IS NOT NULL AND ed.pf != '' AND ed.pf != '0'
       ${branchCondition}`,
    [params.monthYear, params.monthYear, ...(params.branch ? [params.branch] : [])]
  );

  const today = new Date();
  const out: EpfContributionRow[] = [];

  for (const row of rows as RowDataPacket[]) {
    const pfDeduction = row.pf_deduction != null ? Math.abs(Number(row.pf_deduction)) : 0;
    if (pfDeduction === 0) continue; // no PF deduction line this month -> not a real ECR row

    const wageBase = Math.round(pfDeduction / 0.12);
    const epf = wageBase; // legacy's 'GROSS' and 'EPF' columns are the same uncapped value (traced, not a bug fix)
    if (epf <= 0) continue;

    let age = 0;
    if (row.date_of_birth) {
      const dob = new Date(row.date_of_birth);
      age = today.getFullYear() - dob.getFullYear();
      const beforeBirthday = today.getMonth() < dob.getMonth() ||
        (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate());
      if (beforeBirthday) age--;
    }

    const epsEligible = row.eps === 'Y' && age <= 58;
    const epfContribution = Math.round(epf * 0.12);
    const epsContribution = epsEligible ? Math.round(Math.min(epf, 15000) * 0.0833) : 0;
    const epfEpsDiff = Math.round(epfContribution - epsContribution);
    const epsWages = epsEligible ? Math.min(epf, 15000) : 0;
    const edliWages = Math.min(epf, 15000);
    const ncpDays = row.loss_of_pay != null ? Math.round(Number(row.loss_of_pay)) : 0;

    out.push({
      emp_pkey: row.emp_pkey,
      emp_name: row.emp_name ?? '',
      uan: row.uan,
      gross: epf,
      epf_wages: epf,
      eps_wages: epsWages,
      edli_wages: edliWages,
      epf_contribution: epfContribution,
      eps_contribution: epsContribution,
      epf_eps_diff: epfEpsDiff,
      ncp_days: ncpDays,
      refund: 0,
    } as EpfContributionRow);
  }

  return out;
}

// Matches EPFO's real ECR text format: one row per employee, `#~#`-delimited, CRLF-terminated.
export function toEcrText(rows: EpfContributionRow[]): string {
  return rows
    .map((r) =>
      [r.uan, r.emp_name, r.gross, r.epf_wages, r.eps_wages, r.edli_wages, r.epf_contribution, r.eps_contribution, r.epf_eps_diff, r.ncp_days, r.refund].join('#~#')
    )
    .join('\r\n') + (rows.length > 0 ? '\r\n' : '');
}
