'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import AppTabs from '@/components/ess/AppTabs';

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
  if (!allFYMonths.length) return <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>;
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

// ── Main page ─────────────────────────────────────────────────────────────────
interface PayMonth { month: string; payroll_master_id: number; gross_salary: number; net_salary: number; total_deductions: number; present_days: number }
interface PayData {
  employee: { gross_ctc: number };
  finYear: { id: number; fin_year: string } | null;
  allFinYears: { id: number; fin_year: string }[];
  months: PayMonth[];
  allFYMonths: string[];
  latestLines: { head_type: string; item_name: string; amount: number }[];
}

export default function EssSalaryPage() {
  const { data: session } = useSession();
  const empId = session?.user.empFkey;

  const [tab, setTab] = useState<'salary' | 'tax'>('salary');
  const [payData, setPayData] = useState<PayData | null>(null);
  const [selFYId, setSelFYId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [declData, setDeclData] = useState<{ heads: TaxHead[] } | null>(null);
  const [declVals, setDeclVals] = useState<Record<number, string>>({});
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
      const vals: Record<number, string> = {};
      for (const head of decl?.heads || []) {
        for (const line of head.lines) if (line.tax_value != null) vals[line.tax_heads_details_pkey] = String(line.tax_value);
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
          const val = Number(declVals[line.tax_heads_details_pkey] || 0);
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

  function printSlipHTML(html: string) {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Salary Slip</title><style>
      *{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#111;padding:24px}
      .header{text-align:center;margin-bottom:16px}.company{font-size:16px;font-weight:900;color:#1E516E}
      .slip-title{font-size:12px;font-weight:700;margin:4px 0}.emp-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:14px;padding:10px 14px;border:1px solid #ddd;border-radius:6px}
      table{width:100%;border-collapse:collapse;margin-bottom:10px}
      th{background:#1E516E;color:#fff;padding:6px 10px;text-align:left;font-size:10px}
      td{padding:5px 10px;border-bottom:1px solid #eee}
      .totals{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px}
      .total-box{border:1px solid #ddd;border-radius:6px;padding:8px 12px;text-align:center}
      .total-box .label{font-size:9px;color:#666;font-weight:700;text-transform:uppercase}
      .total-box .value{font-size:14px;font-weight:900;color:#1E516E;margin-top:2px}
      .net-box{background:#1E516E;border-color:#1E516E}.net-box .label,.net-box .value{color:#fff}
    </style></head><body>${html}</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  }

  async function downloadPayslip(payrollMasterId: number, monthLabel: string) {
    try {
      const res = await fetch(`/api/payroll/slip/${payrollMasterId}`);
      const data = await res.json();
      const fmtA = (n: number) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });
      interface SlipGroup { head_desc: string; items: { salary_head_item_desc: string; head_operator: string; salary_amount: number }[] }
      const allItems = (data.direct as SlipGroup[]).flatMap((g) => g.items);
      const earnings = allItems.filter((it) => it.head_operator === 'Addition');
      const deductions = allItems.filter((it) => it.head_operator === 'Deduction');
      const rows = (items: typeof allItems) => items.map((it) => `<tr><td>${it.salary_head_item_desc}</td><td style="text-align:right">${fmtA(it.salary_amount)}</td></tr>`).join('');
      const html = `
        <div class="header"><div class="company">${data.header.desig || 'Payslip'}</div><div class="slip-title">Salary Slip — ${monthLabel}</div></div>
        <div class="emp-grid">
          <div><span>Employee: </span><strong>${data.header.emp_name}</strong></div>
          <div><span>Month: </span><strong>${monthLabel}</strong></div>
          <div><span>Present Days: </span><strong>${data.header.days_presant ?? '—'}</strong></div>
          <div><span>Working Days: </span><strong>${data.header.working_days ?? '—'}</strong></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div><table><thead><tr><th>Earnings</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows(earnings)}</tbody></table></div>
          <div><table><thead><tr><th>Deductions</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows(deductions)}</tbody></table></div>
        </div>
        <div class="totals">
          <div class="total-box"><div class="label">Gross Salary</div><div class="value">${fmtA(data.header.gross_salary)}</div></div>
          <div class="total-box"><div class="label">Total Deductions</div><div class="value" style="color:#dc2626">${fmtA(data.header.total_deduction)}</div></div>
          <div class="total-box net-box"><div class="label">Net Pay</div><div class="value">${fmtA(data.header.net_salary)}</div></div>
        </div>`;
      printSlipHTML(html);
    } catch {
      alert('Could not load payslip data.');
    }
  }

  if (loading && !payData) {
    return (
      <div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: BRAND, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }
  if (!payData) return null;

  const { employee, finYear, allFinYears, months, allFYMonths, latestLines } = payData;
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

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100%' }}>
      <div style={{ background: `linear-gradient(135deg, #0c1f2c 0%, ${BRAND} 55%, #2d7fb8 100%)`, padding: '18px 28px 0' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>💰 Salary & Benefits</div>
            {allFinYears.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: '6px 14px', border: '1px solid rgba(255,255,255,0.2)' }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>FY</span>
                <select value={selFYId || ''} onChange={(e) => { const id = Number(e.target.value); setSelFYId(id); loadSalary(id); }} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', outline: 'none' }}>
                  {allFinYears.map((fy) => <option key={fy.id} value={fy.id} style={{ background: '#0c1f2c' }}>{fy.fin_year}</option>)}
                </select>
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

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 28px 48px' }}>
        {tab === 'salary' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
              {[
                { label: 'Monthly CTC', val: fmtINR(monthlyCTC), sub: 'per month', color: BRAND, bg: `${BRAND}0d` },
                { label: 'Annual CTC', val: fmtINR(annualCTC), sub: finYear?.fin_year || '', color: '#2d7fb8', bg: '#eff6ff' },
                { label: 'YTD Earned', val: fmtINR(ytdGross), sub: `${months.length} months processed`, color: '#16a34a', bg: '#f0fdf4' },
                { label: 'YTD Net Pay', val: fmtINR(ytdNet), sub: `After ${fmtINR(ytdDeduct)} deductions`, color: '#7c3aed', bg: '#f5f3ff' },
              ].map((s) => (
                <div key={s.label} style={{ ...card, padding: '14px 18px', background: s.bg, border: `1.5px solid ${s.color}22` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: s.color, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 3 }}>{s.sub}</div>
                </div>
              ))}
            </div>

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

            <div style={{ ...card, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)' }}>FY Detail — {finYear?.fin_year}</div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead><tr style={{ background: 'var(--bg-page)' }}>{['Month', 'Status', 'Net Salary', 'Deductions', 'Present Days', 'Payslip'].map((h) => <th key={h} style={{ padding: '8px 14px', textAlign: h === 'Month' || h === 'Status' ? 'left' : h === 'Payslip' ? 'center' : 'right', fontWeight: 700, fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {allFYMonths.map((m) => {
                      const p = processedMap.get(m);
                      const isFuture = m > thisMonthStr;
                      const isCurrent = m === thisMonthStr;
                      const [yr, mo] = m.split('-');
                      return (
                        <tr key={m} style={{ background: p ? `${BRAND}06` : isCurrent ? `${BRAND}0a` : 'transparent', borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '9px 14px', fontWeight: isCurrent ? 800 : 600 }}>{MON[parseInt(mo)]} {yr}</td>
                          <td style={{ padding: '9px 14px' }}>{p ? <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 9, fontWeight: 800, background: '#f0fdf4', color: '#16a34a' }}>Processed</span> : isFuture ? <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 9, fontWeight: 800, background: '#f1f5f9', color: '#64748b' }}>Upcoming</span> : <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 9, fontWeight: 800, background: '#fffbeb', color: '#d97706' }}>Pending</span>}</td>
                          <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: p ? 700 : 400, color: p ? BRAND : 'var(--text-muted)' }}>{p ? fmtINR(p.net_salary) : '—'}</td>
                          <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-muted)' }}>{p ? fmtINR(p.total_deductions) : '—'}</td>
                          <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-muted)' }}>{p ? p.present_days : '—'}</td>
                          <td style={{ padding: '9px 14px', textAlign: 'center' }}>{p ? <button onClick={() => downloadPayslip(p.payroll_master_id, `${MON[parseInt(mo)]} ${yr}`)} style={{ padding: '3px 10px', fontSize: 9, fontWeight: 700, cursor: 'pointer', border: `1px solid ${BRAND}`, borderRadius: 12, background: 'transparent', color: BRAND }}>⬇ Payslip</button> : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>Investment Declarations</div>
                  <button onClick={handleSaveDecl} disabled={saving} style={{ padding: '7px 18px', borderRadius: 20, border: 'none', background: BRAND, color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save Declarations'}</button>
                </div>
                {declData.heads.filter((h) => h.tax_type !== 'Income').map((head) => (
                  <div key={head.tax_heads_pkey} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: BRAND, marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                      {head.tax_name}
                      {head.cap != null && <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)' }}>(cap ₹{fmtINR(head.cap)})</span>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                      {head.lines.map((line) => (
                        <div key={line.tax_heads_details_pkey}>
                          <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>{line.label}</label>
                          <input
                            type="number" disabled={line.locked}
                            value={declVals[line.tax_heads_details_pkey] ?? ''}
                            onChange={(e) => setDeclVals((v) => ({ ...v, [line.tax_heads_details_pkey]: e.target.value }))}
                            style={{ width: '100%', padding: '6px 10px', borderRadius: 7, border: '1.5px solid var(--border)', background: line.locked ? 'var(--bg-page)' : 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12, boxSizing: 'border-box' }}
                          />
                          {line.locked && <div style={{ fontSize: 9, color: '#dc2626', marginTop: 2 }}>Locked by admin</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
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
    </div>
  );
}
