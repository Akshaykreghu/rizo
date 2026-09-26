'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { EssDropdown } from '@/components/ess/EssDropdown';
import AppTabs from '@/components/ess/AppTabs';
import { SalarySlipModal } from '@/components/payroll/SalarySlipModal';
import { essPortal } from '@/components/ess/essPortal';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { Skeleton } from '@/components/ui/Skeleton';

// Port of New Rizo's pages/ESS/ESSSalary.jsx (Salary & Benefits + Tax Declarations tabs), backed
// by the new /api/employees/[id]/pay-summary endpoint and the existing tax-* routes (now with
// self-access checks added — see those routes' comments). Field names differ from New Rizo's
// assumptions in a few places because they're read from the real schema, not invented:
// - payroll line "head_operator" values are 'Addition'/'Deduction' here, not 'Earning'/'Deduction'.
// - Tax computation comes back as { old: {...}, new: {...} } (two full rows from
//   emp_tax_sal_trans_sum / _new), not one object with _old/_new-suffixed fields.

const BRAND = '#1E516E';
const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtINR(n?: number | null) { return Math.round(Number(n) || 0).toLocaleString('en-IN'); }

const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16 };

// ── Salary trend bar chart ────────────────────────────────────────────────────
function SalaryTrendChart({ allFYMonths, processedMap, monthlyCTC }: { allFYMonths: string[]; processedMap: Map<string, { net_salary: number }>; monthlyCTC: number }) {
  if (!allFYMonths.length) return <Skeleton height={180} radius={12} />;
  if (processedMap.size === 0) {
    return (
      <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        No salary processed yet for this financial year.
      </div>
    );
  }
  const W = 480, H = 200, PL = 46, PR = 6, PT = 14, PB = 28;
  const cW = W - PL - PR, cH = H - PT - PB;
  const n = allFYMonths.length;
  const slotW = cW / n;
  const barW = Math.max(6, slotW - 6);
  const today = new Date();
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const allVals = allFYMonths.map((m) => processedMap.get(m)?.net_salary ?? (m <= thisMonth ? 0 : monthlyCTC));
  const yMax = Math.max(...allVals, monthlyCTC, 1000) * 1.2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }}>
      {[0, yMax * 0.5, yMax].map((v) => {
        const y = PT + cH - (v / yMax) * cH;
        return <g key={v}><line x1={PL} x2={W - PR} y1={y} y2={y} stroke="var(--border)" strokeWidth={0.5} strokeDasharray="3,3" /><text x={PL - 4} y={y + 3.5} fontSize={7} textAnchor="end" fill="var(--text-muted)">{Math.round(v / 1000)}K</text></g>;
      })}
      {allFYMonths.map((m, i) => {
        const p = processedMap.get(m);
        const isFuture = m > thisMonth;
        const val = p ? p.net_salary : isFuture ? monthlyCTC : 0;
        const barH = Math.max((val / yMax) * cH, 1);
        const x = PL + i * slotW + (slotW - barW) / 2;
        const y = PT + cH - barH;
        const [yr, mo] = m.split('-');
        return (
          <g key={m}>
            {p ? <rect x={x} y={y} width={barW} height={barH} fill={BRAND} rx={2} opacity={0.88}><title>{m}: Net {fmtINR(p.net_salary)}</title></rect>
              : isFuture ? <rect x={x} y={y} width={barW} height={barH} fill="none" stroke="#94a3b8" strokeWidth={0.8} strokeDasharray="3,2" rx={2} />
                : <rect x={x} y={PT + cH - 2} width={barW} height={2} fill="#e2e8f0" rx={1} />}
            <text x={x + barW / 2} y={H - PB + 10} fontSize={6} textAnchor="middle" fill="var(--text-muted)">{MON[parseInt(mo)]}&apos;{yr.slice(2)}</text>
          </g>
        );
      })}
    </svg>
  );
}

interface RegimeComputation { taxable_income?: number; tax_yearly?: number; tax_monthly_proj?: number; rebate?: number; cess?: number }

function RegimeCard({ regime, computation, preferred, onClick }: { regime: 'OLD' | 'NEW'; computation: RegimeComputation | null; preferred: string; onClick: () => void }) {
  const isPref = preferred === regime;
  const tax = Number(computation?.tax_yearly || 0);
  const tds = Number(computation?.tax_monthly_proj || 0);
  const reb = Number(computation?.rebate || 0);
  const cess = Number(computation?.cess || 0);
  const ti = Number(computation?.taxable_income || 0);

  return (
    <div onClick={onClick} style={{ flex: 1, borderRadius: 14, padding: '16px 20px', cursor: 'pointer', border: isPref ? `2px solid ${BRAND}` : '2px solid var(--border)', background: isPref ? `${BRAND}08` : 'var(--bg-card)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{regime === 'OLD' ? 'Old Regime' : 'New Regime'}</div>
        {isPref && <span style={{ padding: '2px 10px', borderRadius: 20, background: BRAND, color: '#fff', fontSize: 9, fontWeight: 800 }}>PREFERRED</span>}
      </div>
      {computation ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
          {[
            ['Taxable Income', fmtINR(ti), false, undefined],
            ['Gross Tax', fmtINR(tax - cess), false, undefined],
            ['Rebate', reb > 0 ? `−${fmtINR(reb)}` : '—', false, '#16a34a'],
            ['+ Cess (4%)', fmtINR(cess), false, '#d97706'],
            ['Net Tax / Year', fmtINR(tax), true, undefined],
            ['Monthly TDS', fmtINR(tds), true, tax === 0 ? '#16a34a' : '#dc2626'],
          ].map(([label, val, bold, color]) => (
            <div key={label as string}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 1 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: bold ? 900 : 600, color: (color as string) || 'var(--text-primary)' }}>{val}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>Click &quot;Compute Tax&quot; to see projections</div>
      )}
    </div>
  );
}

interface TaxLine { tax_heads_details_pkey: number; label: string; tax_value: number | null; locked: boolean }
interface TaxHead { tax_heads_pkey: number; tax_name: string; tax_type: string; cap: number | null; lines: TaxLine[] }

// Shared by both the Deductions and Other Income sections below — each is just a list of tax
// heads with the same name/cap/input-grid shape, so the actual field markup only needs writing
// once.
function TaxHeadFields({ head, values, onChange }: { head: TaxHead; values: Record<string, string>; onChange: (key: string, value: string) => void }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: BRAND, marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
        {head.tax_name}
        {head.cap != null && <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)' }}>(cap ₹{fmtINR(head.cap)})</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {head.lines.map((line) => {
          const key = `${head.tax_heads_pkey}:${line.tax_heads_details_pkey}`;
          return (
            <div key={line.tax_heads_details_pkey}>
              <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>{line.label}</label>
              <input
                type="number" disabled={line.locked}
                value={values[key] ?? ''}
                onChange={(e) => onChange(key, e.target.value)}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 7, border: '1.5px solid var(--border)', background: line.locked ? 'var(--bg-page)' : 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12, boxSizing: 'border-box' }}
              />
              {line.locked && <div style={{ fontSize: 9, color: '#dc2626', marginTop: 2 }}>Locked by admin</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── PF Contributions panel ───────────────────────────────────────────────────
// A small passbook-style ledger next to FY Detail — like the EPFO member portal: most recent
// month at top, 6 rows visible before scrolling (same capped-list-plus-scrollbar technique as the
// Organisation page's Branches panel), and a running Total that always stays visible below the
// list rather than requiring a scroll to see, since it covers this employee's whole tenure here,
// not just the FY currently selected above.
// Both the PF table and the FY Detail table scroll within the same fixed height, so the two
// side-by-side grids read as a matched pair regardless of how many rows either one has.
const GRID_SCROLL_HEIGHT = 290;

const PF_EMPLOYEE_COLOR = BRAND;
const PF_EMPLOYER_COLOR = '#7c3aed';

// Column widths shared by the scrolling body table and the fixed footer table below it, so the
// two independent <table>s (needed so the Total row stays visible without scrolling) line up.
const PF_COL_WIDTHS = ['34%', '22%', '22%', '22%'];

function PFPanel({ pf, monthLabel }: { pf: PayData['pf']; monthLabel: (m: string | null) => string }) {
  const grandTotal = pf.employeeTotal + pf.employerTotal;
  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <style>{`
        .grid-scroll-y { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
        .grid-scroll-y::-webkit-scrollbar { width: 7px; }
        .grid-scroll-y::-webkit-scrollbar-track { background: transparent; }
        .grid-scroll-y::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
        .grid-scroll-y::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
      `}</style>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-primary)' }}>💳 PF Contributions (Approx)</div>
      </div>

      {pf.months.length === 0 ? (
        <div style={{ height: GRID_SCROLL_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11.5 }}>
          No contributions recorded yet.
        </div>
      ) : (
        <>
          <div className="grid-scroll-y" style={{ maxHeight: GRID_SCROLL_HEIGHT, overflowY: 'auto' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'var(--bg-page)' }}>
                  {['Month', 'Employee', 'Employer', 'Total'].map((h, i) => (
                    <th key={h} style={{ width: PF_COL_WIDTHS[i], position: 'sticky', top: 0, background: 'var(--bg-page)', padding: '6px 12px', textAlign: i === 0 ? 'left' : 'right', fontWeight: 700, fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pf.months.map((m) => (
                  <tr key={m.month} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>{monthLabel(m.month)}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', color: PF_EMPLOYEE_COLOR, fontWeight: 700 }}>₹{fmtINR(m.employee)}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', color: PF_EMPLOYER_COLOR, fontWeight: 700 }}>₹{fmtINR(m.employer)}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--text-primary)' }}>₹{fmtINR(m.employee + m.employer)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* A separate table (not part of the scrolling body above) so this Total row always
              stays visible — it covers this employee's whole tenure here, not just the rows
              currently scrolled into view. */}
          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 11 }}>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${BRAND}`, background: `${BRAND}0a` }}>
                <td style={{ width: PF_COL_WIDTHS[0], padding: '8px 12px', fontWeight: 800, fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.3px', color: 'var(--text-muted)' }}>
                  Total{pf.firstMonth && <><br />Since {monthLabel(pf.firstMonth)}</>}
                </td>
                <td style={{ width: PF_COL_WIDTHS[1], padding: '8px 12px', textAlign: 'right', fontWeight: 900, color: PF_EMPLOYEE_COLOR }}>₹{fmtINR(pf.employeeTotal)}</td>
                <td style={{ width: PF_COL_WIDTHS[2], padding: '8px 12px', textAlign: 'right', fontWeight: 900, color: PF_EMPLOYER_COLOR }}>₹{fmtINR(pf.employerTotal)}</td>
                <td style={{ width: PF_COL_WIDTHS[3], padding: '8px 12px', textAlign: 'right', fontWeight: 900, color: BRAND }}>₹{fmtINR(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
interface PayMonth { month: string; payroll_master_id: number; gross_salary: number; net_salary: number; total_deductions: number; present_days: number }
interface PayData {
  employee: { gross_ctc: number };
  finYear: { id: number; fin_year: string } | null;
  allFinYears: { id: number; fin_year: string }[];
  months: PayMonth[];
  allFYMonths: string[];
  latestLines: { head_type: string; item_name: string; amount: number }[];
  lifetime: { monthsProcessed: number; firstMonth: string | null; grossTotal: number; netTotal: number; deductionsTotal: number };
  pf: { months: { month: string; employee: number; employer: number }[]; employeeTotal: number; employerTotal: number; firstMonth: string | null };
}

export default function EssSalaryPage() {
  const { data: session } = useSession();
  const empId = session?.user.empFkey;

  const [tab, setTab] = useState<'salary' | 'tax'>('salary');
  const [slipId, setSlipId] = useState<number | null>(null);
  const [payData, setPayData] = useState<PayData | null>(null);
  const [selFYId, setSelFYId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [declData, setDeclData] = useState<{ heads: TaxHead[]; otherIncomeTotal: number; cappedDeductionTotal: number } | null>(null);
  // Keyed by "tax_heads_pkey:tax_heads_details_pkey", not just the details pkey alone — a head
  // with no child lines (e.g. "Business / Profession" under Income, "Equity Investment 80CCG"
  // under Deductions) gets a details pkey of 0 from the API, and more than one such head exists,
  // so keying by details pkey alone would let two unrelated heads silently share and overwrite the
  // same stored value.
  const [declVals, setDeclVals] = useState<Record<string, string>>({});
  const declValKey = (head: { tax_heads_pkey: number }, line: { tax_heads_details_pkey: number }) =>
    `${head.tax_heads_pkey}:${line.tax_heads_details_pkey}`;
  const [computation, setComputation] = useState<{ old: RegimeComputation | null; new: RegimeComputation | null } | null>(null);
  const [regime, setRegime] = useState<'OLD' | 'NEW'>('NEW');
  const [form16Docs, setForm16Docs] = useState<{ form_name: string; fin_year: string; path: string }[]>([]);
  const [computing, setComputing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taxLoading, setTaxLoading] = useState(false);

  const loadSalary = useCallback((fyId: number | null) => {
    if (!empId) return;
    fetch(`/api/employees/${empId}/pay-summary${fyId ? `?fin_year_id=${fyId}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setPayData(d); setSelFYId(d?.finYear?.id ?? null); })
      .finally(() => setLoading(false));
  }, [empId]);

  useEffect(() => { loadSalary(null); }, [loadSalary]);

  // Note: tax-declarations/tax-regime/form16 all resolve the fin year server-side via
  // getOpenFinYear rather than accepting an explicit override, so this doesn't take fyId —
  // switching the FY selector above only affects the Salary tab's payroll data.
  const loadTax = useCallback(() => {
    if (!empId) return;
    Promise.all([
      fetch(`/api/employees/${empId}/tax-declarations`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/employees/${empId}/tax-regime`).then((r) => (r.ok ? r.json() : { optionType: 'N' })),
      fetch(`/api/employees/${empId}/form16`).then((r) => (r.ok ? r.json() : { documents: [] })),
    ]).then(([decl, reg, f16]) => {
      setDeclData(decl);
      setRegime(reg.optionType === 'O' ? 'OLD' : 'NEW');
      setForm16Docs(f16.documents || []);
      const vals: Record<string, string> = {};
      for (const head of decl?.heads || []) {
        for (const line of head.lines) if (line.tax_value != null) vals[declValKey(head, line)] = String(line.tax_value);
      }
      setDeclVals(vals);
    }).finally(() => setTaxLoading(false));
  }, [empId]);

  useEffect(() => { if (tab === 'tax' && selFYId) loadTax(); }, [tab, selFYId, loadTax]);

  async function handleCompute() {
    if (!empId) return;
    setComputing(true);
    try {
      const res = await fetch(`/api/employees/${empId}/tax-compute`, { method: 'POST' });
      const body = await res.json();
      if (res.ok) setComputation(body.summary);
    } finally {
      setComputing(false);
    }
  }

  async function handleSaveDecl() {
    if (!empId || !declData) return;
    setSaving(true);
    try {
      for (const head of declData.heads) {
        for (const line of head.lines) {
          if (line.locked) continue;
          const val = Number(declVals[declValKey(head, line)] || 0);
          await fetch(`/api/employees/${empId}/tax-declarations`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tax_heads_fkey: head.tax_heads_pkey, tax_heads_details_fkey: line.tax_heads_details_pkey, tax_value: val, fin_year: new Date().getFullYear() }),
          });
        }
      }
      await handleCompute();
    } finally {
      setSaving(false);
    }
  }

  async function handleSetRegime(r: 'OLD' | 'NEW') {
    setRegime(r);
    if (empId) await fetch(`/api/employees/${empId}/tax-regime`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionType: r === 'OLD' ? 'O' : 'N' }) });
  }

  if (loading && !payData) {
    return (
      <div style={{ padding: '24px 28px 40px' }}>
        <PageSkeleton stats={3} body="table" />
      </div>
    );
  }
  if (!payData) return null;

  const { employee, finYear, allFinYears, months, allFYMonths, latestLines, lifetime, pf } = payData;
  const processedMap = new Map(months.map((m) => [m.month, m]));
  const monthlyCTC = employee.gross_ctc;
  const annualCTC = monthlyCTC * 12;
  const ytdGross = months.reduce((s, m) => s + m.gross_salary, 0);
  const ytdNet = months.reduce((s, m) => s + m.net_salary, 0);
  const ytdDeduct = months.reduce((s, m) => s + m.total_deductions, 0);
  const today = new Date();
  const thisMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const earningsLines = latestLines.filter((l) => l.head_type === 'Addition');
  const earningsTotal = earningsLines.reduce((s, l) => s + l.amount, 0);
  const monthLabel = (m: string | null) => {
    if (!m) return '';
    const [yr, mo] = m.split('-');
    return `${MON[parseInt(mo)]} ${yr}`;
  };
  const firstMonthLabel = monthLabel(lifetime.firstMonth);

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100%' }}>
      <div style={{ background: `linear-gradient(135deg, #0c1f2c 0%, ${BRAND} 55%, #2d7fb8 100%)`, padding: '18px 28px 0' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>💰 Salary & Benefits</div>
            {allFinYears.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: '6px 14px', border: '1px solid rgba(255,255,255,0.2)' }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>FY</span>
                <EssDropdown
                  value={selFYId ? String(selFYId) : ''}
                  onChange={(v) => { const id = Number(v); setSelFYId(id); loadSalary(id); }}
                  clearable={false}
                  options={allFinYears.map((fy) => ({ value: String(fy.id), label: fy.fin_year }))}
                  style={{ minWidth: 120 }}
                  buttonStyle={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 13, fontWeight: 800, padding: '0 2px' }}
                />
              </div>
            )}
          </div>
          <div style={{ marginTop: 8 }}>
            <AppTabs
              active={tab}
              onChange={(k) => setTab(k as 'salary' | 'tax')}
              tabs={[
                { key: 'salary', label: 'Salary & Benefits' },
                { key: 'tax', label: 'Tax Declarations' },
              ]}
            />
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 28px 48px' }}>
        {tab === 'salary' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {[
                { label: 'Monthly CTC', val: fmtINR(monthlyCTC), sub: 'per month', color: BRAND, bg: `${BRAND}0d` },
                { label: 'Annual CTC', val: fmtINR(annualCTC), sub: finYear?.fin_year || '', color: '#2d7fb8', bg: '#eff6ff' },
                { label: 'YTD Earned', val: fmtINR(ytdGross), sub: `${months.length} months processed`, color: '#16a34a', bg: '#f0fdf4' },
                { label: 'YTD Net Pay', val: fmtINR(ytdNet), sub: `After ${fmtINR(ytdDeduct)} deductions`, color: '#7c3aed', bg: '#f5f3ff' },
                {
                  label: 'Total Earned (This Company)',
                  val: fmtINR(lifetime.netTotal),
                  sub: firstMonthLabel ? `Net pay since joining ${firstMonthLabel} · ${lifetime.monthsProcessed} months` : 'No payslips processed yet',
                  color: '#d97706', bg: '#fffbeb',
                },
              ].map((s) => (
                <div key={s.label} style={{ ...card, padding: '14px 18px', background: s.bg, border: `1.5px solid ${s.color}22` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: s.color, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 3 }}>{s.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: earningsLines.length > 0 ? '1fr 1fr' : '1fr', gap: 16 }}>
              <div style={{ ...card, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>Monthly Net Salary — {finYear?.fin_year}</div>
                <SalaryTrendChart allFYMonths={allFYMonths} processedMap={processedMap} monthlyCTC={monthlyCTC} />
              </div>

              {earningsLines.length > 0 && (
                <div style={{ ...card, padding: '14px 16px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>Latest Earnings Breakdown</div>
                  {earningsLines.map((l, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < earningsLines.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-primary)' }}>{l.item_name.trim()}</span>
                      <span style={{ fontWeight: 700 }}>₹{fmtINR(l.amount)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, marginTop: 4, borderTop: `2px solid ${BRAND}`, fontSize: 12, fontWeight: 800, color: BRAND }}>
                    <span>Total</span><span>₹{fmtINR(earningsTotal)}</span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
              <PFPanel pf={pf} monthLabel={monthLabel} />

              <div style={{ ...card, overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-primary)' }}>FY Detail — {finYear?.fin_year}</div>
                </div>
                <div className="grid-scroll-y" style={{ maxHeight: GRID_SCROLL_HEIGHT, overflowY: 'auto', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
                    <thead><tr>{['Month', 'Status', 'Net Salary', 'Deductions', 'Present', 'Payslip'].map((h) => <th key={h} style={{ position: 'sticky', top: 0, background: 'var(--bg-page)', padding: '6px 10px', textAlign: h === 'Month' || h === 'Status' ? 'left' : h === 'Payslip' ? 'center' : 'right', fontWeight: 700, fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {/* Always exactly 12 rows (one per FY month) — a fixed calendar view, not paginated,
                          so switching financial years doesn't hide months behind a page click. */}
                      {allFYMonths.map((m, i) => {
                        const p = processedMap.get(m);
                        const isFuture = m > thisMonthStr;
                        const isCurrent = m === thisMonthStr;
                        const [yr, mo] = m.split('-');
                        return (
                          <tr key={m} style={{ background: p ? `${BRAND}06` : isCurrent ? `${BRAND}0a` : i % 2 ? 'var(--bg-page)' : 'transparent', borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '7px 10px', fontWeight: isCurrent ? 800 : 600 }}>{MON[parseInt(mo)]} {yr}</td>
                            <td style={{ padding: '7px 10px' }}>{p ? <span style={{ padding: '2px 7px', borderRadius: 20, fontSize: 8.5, fontWeight: 800, background: '#f0fdf4', color: '#16a34a' }}>Processed</span> : isFuture ? <span style={{ padding: '2px 7px', borderRadius: 20, fontSize: 8.5, fontWeight: 800, background: '#f1f5f9', color: '#64748b' }}>Upcoming</span> : <span style={{ padding: '2px 7px', borderRadius: 20, fontSize: 8.5, fontWeight: 800, background: '#fffbeb', color: '#d97706' }}>Pending</span>}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: p ? 700 : 400, color: p ? BRAND : 'var(--text-muted)' }}>{p ? fmtINR(p.net_salary) : '—'}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-muted)' }}>{p ? fmtINR(p.total_deductions) : '—'}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-muted)' }}>{p ? p.present_days : '—'}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'center' }}>{p ? <button onClick={() => setSlipId(p.payroll_master_id)} style={{ padding: '3px 9px', fontSize: 8.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${BRAND}`, borderRadius: 12, background: 'transparent', color: BRAND }}>👁 Payslip</button> : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'tax' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ ...card, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>Income Tax — {finYear?.fin_year}</div>
                <button onClick={handleCompute} disabled={computing} style={{ padding: '7px 18px', borderRadius: 20, border: 'none', background: BRAND, color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer', opacity: computing ? 0.7 : 1 }}>{computing ? '⟳ Computing…' : '⟳ Compute Tax'}</button>
              </div>
              {taxLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><div style={{ width: 24, height: 24, border: `2px solid var(--border)`, borderTopColor: BRAND, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /></div>
              ) : (
                <div style={{ display: 'flex', gap: 14 }}>
                  <RegimeCard regime="NEW" computation={computation?.new ?? null} preferred={regime} onClick={() => handleSetRegime('NEW')} />
                  <RegimeCard regime="OLD" computation={computation?.old ?? null} preferred={regime} onClick={() => handleSetRegime('OLD')} />
                </div>
              )}
            </div>

            {declData && (
              <div style={{ ...card, padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>Other Income (Additions)</div>
                  <button onClick={handleSaveDecl} disabled={saving} style={{ padding: '7px 18px', borderRadius: 20, border: 'none', background: BRAND, color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save Declarations'}</button>
                </div>
                <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 14 }}>
                  Income beyond salary (rent, other sources, etc.) — added to taxable income, not deducted from it.
                </p>
                {declData.heads.filter((h) => h.tax_type === 'Income').map((head) => (
                  <TaxHeadFields key={head.tax_heads_pkey} head={head} values={declVals} onChange={(key, value) => setDeclVals((v) => ({ ...v, [key]: value }))} />
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: `2px solid ${BRAND}`, fontSize: 12, fontWeight: 800, color: BRAND }}>
                  <span>Total Other Income</span><span>₹{fmtINR(declData.otherIncomeTotal)}</span>
                </div>
              </div>
            )}

            {declData && (
              <div style={{ ...card, padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>Investment Declarations</div>
                  <button onClick={handleSaveDecl} disabled={saving} style={{ padding: '7px 18px', borderRadius: 20, border: 'none', background: BRAND, color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save Declarations'}</button>
                </div>
                {declData.heads.filter((h) => h.tax_type !== 'Income').map((head) => (
                  <TaxHeadFields key={head.tax_heads_pkey} head={head} values={declVals} onChange={(key, value) => setDeclVals((v) => ({ ...v, [key]: value }))} />
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: `2px solid ${BRAND}`, fontSize: 12, fontWeight: 800, color: BRAND }}>
                  <span>Total Deductions (capped)</span><span>₹{fmtINR(declData.cappedDeductionTotal)}</span>
                </div>
              </div>
            )}

            <div style={{ ...card, padding: '16px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 10 }}>Form 16</div>
              {form16Docs.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No Form 16 documents available yet.</div>
              ) : form16Docs.map((d, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < form16Docs.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ fontSize: 12 }}>FY {d.fin_year}</div>
                  <a href={d.path} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 700, color: BRAND }}>⬇ Download</a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {slipId != null && essPortal(<SalarySlipModal payrollMasterPkey={slipId} onClose={() => setSlipId(null)} />)}
    </div>
  );
}
