'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

// Port of New Rizo's pages/ESS/ESSReports.jsx. New Rizo's version delegated to four separate
// sub-components (Reports/SalarySlip, AttendanceReport, LeaveBalance, LeaveDetailed) that weren't
// available to read while building this — so these are built directly from the same endpoints
// already wired for My Salary / My Presence, as clean tabular report views, rather than a guess
// at unseen source.

const BRAND = '#1E516E';
const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtINR(n?: number | null) { return Math.round(Number(n) || 0).toLocaleString('en-IN'); }
function fmtDate(d?: string | null) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }

const thS: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'var(--bg-page)', textTransform: 'uppercase', letterSpacing: '0.3px' };
const tdS: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' };
const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' };

function PaySlipReport({ empId }: { empId: number }) {
  const [months, setMonths] = useState<{ month: string; payroll_master_id: number; net_salary: number; gross_salary: number; total_deductions: number }[]>([]);
  const [finYear, setFinYear] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/employees/${empId}/pay-summary`).then((r) => (r.ok ? r.json() : null)).then((d) => { setMonths(d?.months || []); setFinYear(d?.finYear?.fin_year ?? null); }).finally(() => setLoading(false));
  }, [empId]);

  return (
    <div style={card}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>Processed Pay Slips — {finYear || '—'}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Month', 'Gross', 'Deductions', 'Net Pay'].map((h) => <th key={h} style={thS}>{h}</th>)}</tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={4} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
            : months.length === 0 ? <tr><td colSpan={4} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>No payslips processed this FY</td></tr>
            : months.map((m) => {
              const [yr, mo] = m.month.split('-');
              return (
                <tr key={m.payroll_master_id}>
                  <td style={tdS}>{MON[parseInt(mo)]} {yr}</td>
                  <td style={tdS}>₹{fmtINR(m.gross_salary)}</td>
                  <td style={{ ...tdS, color: '#dc2626' }}>₹{fmtINR(m.total_deductions)}</td>
                  <td style={{ ...tdS, fontWeight: 700, color: BRAND }}>₹{fmtINR(m.net_salary)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

function AttendanceReportView({ empId }: { empId: number }) {
  const [months, setMonths] = useState<{ month: string; present: number; absent: number; leave_days: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/employees/${empId}/presence-summary`).then((r) => (r.ok ? r.json() : null)).then((d) => setMonths(d?.monthlyAttendance || [])).finally(() => setLoading(false));
  }, [empId]);

  return (
    <div style={card}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>Attendance — last 12 months</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Month', 'Present', 'Absent / LOP', 'Leave Days'].map((h) => <th key={h} style={thS}>{h}</th>)}</tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={4} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
            : months.map((m) => {
              const [yr, mo] = m.month.split('-');
              return (
                <tr key={m.month}>
                  <td style={tdS}>{MON[parseInt(mo)]} {yr}</td>
                  <td style={{ ...tdS, color: '#16a34a', fontWeight: 700 }}>{m.present}</td>
                  <td style={{ ...tdS, color: m.absent > 0 ? '#dc2626' : 'var(--text-muted)' }}>{m.absent}</td>
                  <td style={tdS}>{m.leave_days}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

function LeaveBalanceReport() {
  const [rows, setRows] = useState<{ salaryHeadItemFkey: number; name: string; balance: number; maxLeave: number; allowNegative: boolean }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/leave/balances').then((r) => (r.ok ? r.json() : { data: [] })).then((d) => setRows(d.data || [])).finally(() => setLoading(false));
  }, []);

  return (
    <div style={card}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>Leave Balance</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Leave Type', 'Balance', 'Annual Max', 'Carries Negative'].map((h) => <th key={h} style={thS}>{h}</th>)}</tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={4} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={4} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>No leave policy assigned</td></tr>
            : rows.map((r) => (
              <tr key={r.salaryHeadItemFkey}>
                <td style={tdS}>{r.name}</td>
                <td style={{ ...tdS, fontWeight: 700, color: r.balance >= 0 ? BRAND : '#dc2626' }}>{r.balance}</td>
                <td style={tdS}>{r.maxLeave || '—'}</td>
                <td style={tdS}>{r.allowNegative ? 'Yes' : 'No'}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function LeaveDetailedReport() {
  const [rows, setRows] = useState<{ LEAVEENTRYID: number; leave_type: string; FROMDATE: string; TODATE: string; leave_days: number; LEAVESTATUS: string; Reason: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/leave/requests').then((r) => (r.ok ? r.json() : { data: [] })).then((d) => setRows(d.data || [])).finally(() => setLoading(false));
  }, []);

  return (
    <div style={card}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>Leave History</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Leave Type', 'From', 'To', 'Days', 'Status', 'Reason'].map((h) => <th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={6} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>No leave history</td></tr>
              : rows.map((r) => (
                <tr key={r.LEAVEENTRYID}>
                  <td style={tdS}>{r.leave_type}</td>
                  <td style={tdS}>{fmtDate(r.FROMDATE)}</td>
                  <td style={tdS}>{fmtDate(r.TODATE)}</td>
                  <td style={{ ...tdS, fontWeight: 700 }}>{r.leave_days}</td>
                  <td style={tdS}>{r.LEAVESTATUS}</td>
                  <td style={{ ...tdS, color: 'var(--text-muted)' }}>{r.Reason || '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const REPORTS = [
  { id: 'payslip', label: 'Pay Slip', emoji: '📄' },
  { id: 'attendance', label: 'Attendance', emoji: '📊' },
  { id: 'leavebal', label: 'Leave Balance', emoji: '⚖️' },
  { id: 'leavehist', label: 'Leave History', emoji: '📋' },
] as const;
type ReportId = typeof REPORTS[number]['id'];

export default function EssReportsPage() {
  const { data: session } = useSession();
  const empId = session?.user.empFkey;
  const [active, setActive] = useState<ReportId>('payslip');

  if (!empId) return null;

  return (
    <div className="page-content" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Reports</h1>
          <p className="page-subtitle">Pay slips, attendance, and leave reports</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 6, marginBottom: 20, overflowX: 'auto' }}>
        {REPORTS.map((r) => (
          <button key={r.id} onClick={() => setActive(r.id)} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: active === r.id ? 700 : 500, fontSize: 13, background: active === r.id ? BRAND : 'transparent', color: active === r.id ? '#fff' : 'var(--text-primary)' }}>
            <span>{r.emoji}</span> {r.label}
          </button>
        ))}
      </div>

      {active === 'payslip' && <PaySlipReport empId={empId} />}
      {active === 'attendance' && <AttendanceReportView empId={empId} />}
      {active === 'leavebal' && <LeaveBalanceReport />}
      {active === 'leavehist' && <LeaveDetailedReport />}
    </div>
  );
}
