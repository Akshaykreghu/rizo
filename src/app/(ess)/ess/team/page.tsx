'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';

// Port of New Rizo's pages/ESS/ESSTeam.jsx, backed by /api/employees/[id]/team (hierarchy)
// and /api/ess/directory (search) — see those routes' comments for why they're separate
// from the admin employee-list/hierarchy endpoints.

interface Person {
  emp_pkey: number;
  first_name: string;
  last_name: string | null;
  emp_code?: string | null;
  mobile_no: string | null;
  email: string | null;
  desig_name: string | null;
  dept_name: string | null;
  branch_name: string | null;
}
interface TeamData {
  employee: Person;
  manager: Person | null;
  directReports: Person[];
  peers: Person[];
}

function initials(a?: string | null, b?: string | null) {
  return ((a?.[0] || '') + (b?.[0] || '')).toUpperCase() || '?';
}

function EmpNode({ emp, isYou = false, size = 'sm' }: { emp?: Person | null; isYou?: boolean; size?: 'xs' | 'sm' | 'md' }) {
  const avatarSz = isYou ? 68 : size === 'md' ? 48 : 44;
  const fontSize = isYou ? 20 : size === 'md' ? 15 : 14;
  const accent = isYou ? '#1E516E' : size === 'md' ? '#7c3aed' : '#059669';

  if (size === 'xs') {
    return (
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 12, minWidth: 180, maxWidth: 210, opacity: 0.88, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: `linear-gradient(135deg, ${accent}99, ${accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: '#fff' }}>
          {initials(emp?.first_name, emp?.last_name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{emp?.first_name} {emp?.last_name}</div>
          {emp?.desig_name && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{emp.desig_name}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {emp?.dept_name && <span style={{ padding: '1px 6px', borderRadius: 10, fontSize: 9, fontWeight: 700, background: `${accent}15`, color: accent }}>{emp.dept_name}</span>}
            {emp?.branch_name && <span style={{ padding: '1px 6px', borderRadius: 10, fontSize: 9, fontWeight: 600, background: 'var(--bg-page)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>📍 {emp.branch_name}</span>}
          </div>
        </div>
      </div>
    );
  }

  if (isYou) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '18px 24px', background: 'linear-gradient(135deg, #0c1f2c, #1E516E)', border: '2px solid #2d7fb8', borderRadius: 16, minWidth: 200, boxShadow: '0 8px 32px rgba(30,81,110,0.35)' }}>
        <div style={{ width: avatarSz, height: avatarSz, borderRadius: '50%', background: 'linear-gradient(135deg, #1e7bb8, #5cb8f0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize, fontWeight: 900, color: '#fff', boxShadow: '0 0 0 4px rgba(255,255,255,0.15)', border: '3px solid rgba(255,255,255,0.25)' }}>
          {initials(emp?.first_name, emp?.last_name)}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{emp?.first_name} {emp?.last_name}</div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.55)', marginTop: 2, letterSpacing: '1.2px', textTransform: 'uppercase' }}>You</div>
          {emp?.desig_name && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 3 }}>{emp.desig_name}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5, justifyContent: 'center' }}>
            {emp?.dept_name && <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 9, fontWeight: 700, background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.85)' }}>{emp.dept_name}</span>}
            {emp?.branch_name && <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 9, fontWeight: 600, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>📍 {emp.branch_name}</span>}
          </div>
          {emp?.emp_code && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 3, fontFamily: 'monospace' }}>{emp.emp_code}</div>}
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start', width: '100%' }}>
            {emp?.mobile_no && (
              <div style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 10 }}>
                <span>📱</span>
                <a href={`tel:${emp.mobile_no}`} style={{ color: '#7ecfff', fontWeight: 600, textDecoration: 'none' }}>{emp.mobile_no}</a>
              </div>
            )}
            {emp?.email && (
              <div style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 10 }}>
                <span>✉️</span>
                <a href={`mailto:${emp.email}`} style={{ color: '#7ecfff', fontWeight: 600, textDecoration: 'none', wordBreak: 'break-all' }}>{emp.email}</a>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: '12px 16px', background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 14, minWidth: 220, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
      <div style={{ width: avatarSz, height: avatarSz, borderRadius: '50%', flexShrink: 0, background: `linear-gradient(135deg, ${accent}aa, ${accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize, fontWeight: 900, color: '#fff' }}>
        {initials(emp?.first_name, emp?.last_name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3 }}>{emp?.first_name} {emp?.last_name}</div>
        {emp?.desig_name && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{emp.desig_name}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {emp?.dept_name && <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: `${accent}15`, color: accent }}>{emp.dept_name}</span>}
          {emp?.branch_name && <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: 'var(--bg-page)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>📍 {emp.branch_name}</span>}
        </div>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {emp?.mobile_no && (
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11 }}>
              <span>📱</span>
              <a href={`tel:${emp.mobile_no}`} style={{ color: '#1E516E', fontWeight: 600, textDecoration: 'none' }}>{emp.mobile_no}</a>
            </div>
          )}
          {emp?.email && (
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11 }}>
              <span>✉️</span>
              <a href={`mailto:${emp.email}`} style={{ color: '#1E516E', fontWeight: 600, textDecoration: 'none', wordBreak: 'break-all', fontSize: 10 }}>{emp.email}</a>
            </div>
          )}
        </div>
        {emp?.emp_code && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>{emp.emp_code}</div>}
      </div>
    </div>
  );
}

function SearchCard({ emp }: { emp: Person }) {
  const accent = '#1E516E';
  return (
    <div style={{ padding: '12px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, background: `linear-gradient(135deg, ${accent}aa, ${accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, color: '#fff' }}>
          {initials(emp.first_name, emp.last_name)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{emp.first_name} {emp.last_name}</div>
          {emp.desig_name && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{emp.desig_name}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
            {emp.dept_name && <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: `${accent}12`, color: accent }}>{emp.dept_name}</span>}
            {emp.branch_name && <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: 'var(--bg-page)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>📍 {emp.branch_name}</span>}
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {emp.mobile_no && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
                <span>📱</span>
                <a href={`tel:${emp.mobile_no}`} style={{ color: '#1E516E', fontWeight: 600, textDecoration: 'none' }}>{emp.mobile_no}</a>
              </div>
            )}
            {emp.email && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
                <span>✉️</span>
                <a href={`mailto:${emp.email}`} style={{ color: '#1E516E', fontWeight: 600, textDecoration: 'none', wordBreak: 'break-all' }}>{emp.email}</a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function VLine({ h = 32 }: { h?: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: 2, height: h, background: 'var(--border)' }} />
    </div>
  );
}
function HBracket({ count }: { count: number }) {
  if (count === 0) return null;
  if (count === 1) return <VLine h={28} />;
  return (
    <div style={{ position: 'relative', height: 28, margin: '0 auto', width: '70%', minWidth: 200 }}>
      <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 2, height: 14, background: 'var(--border)' }} />
      <div style={{ position: 'absolute', top: 14, left: '10%', right: '10%', height: 2, background: 'var(--border)' }} />
      <div style={{ position: 'absolute', top: 14, left: '10%', width: 2, height: 14, background: 'var(--border)' }} />
      <div style={{ position: 'absolute', top: 14, right: '10%', width: 2, height: 14, background: 'var(--border)' }} />
    </div>
  );
}

export default function EssTeamPage() {
  const { data: session } = useSession();
  const empId = session?.user.empFkey;

  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<TeamData | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!empId) return;
    fetch(`/api/employees/${empId}/team`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setTeam(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [empId]);

  function handleSearch(q: string) {
    setQuery(q);
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/ess/directory?search=${encodeURIComponent(q)}`);
        setResults(r.ok ? await r.json() : []);
      } catch {
        setResults([]);
      }
      setSearching(false);
    }, 300);
  }

  if (loading) {
    return (
      <div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: '#1E516E', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  const me = team?.employee;
  const manager = team?.manager ?? null;
  const directReports = team?.directReports ?? [];
  const peers = team?.peers ?? [];
  const half = Math.ceil(peers.length / 2);
  const leftPeers = peers.slice(0, half);
  const rightPeers = peers.slice(half);

  return (
    <div className="page-content" style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24, alignItems: 'start' }}>

        {/* LEFT — Hierarchy */}
        <div>
          <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg, #0c1f2c, #1E516E)', padding: '14px 20px' }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#fff' }}>👥 My Team</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                {manager ? `Reports to ${manager.first_name} ${manager.last_name}` : 'No reporting hierarchy set'} · {directReports.length} direct report{directReports.length !== 1 ? 's' : ''}
              </div>
            </div>

            <div style={{ padding: '28px 24px 32px' }}>
              {manager && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: 8 }}>Reporting Manager</div>
                  <EmpNode emp={manager} size="md" />
                  <VLine h={28} />
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, overflowX: 'auto', paddingBottom: 2 }}>
                {leftPeers.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {leftPeers.map((p) => <EmpNode key={p.emp_pkey} emp={p} size="xs" />)}
                  </div>
                )}
                <div style={{ flexShrink: 0 }}>
                  <EmpNode emp={me} isYou />
                </div>
                {rightPeers.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {rightPeers.map((p) => <EmpNode key={p.emp_pkey} emp={p} size="xs" />)}
                  </div>
                )}
              </div>

              {directReports.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <HBracket count={directReports.length} />
                  <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 4, width: '100%', justifyContent: 'center' }}>
                    {directReports.map((r) => <div key={r.emp_pkey} style={{ flexShrink: 0 }}><EmpNode emp={r} size="sm" /></div>)}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)' }}>
                    Direct Reports · {directReports.length}
                  </div>
                </div>
              )}

              {directReports.length === 0 && !manager && peers.length === 0 && (
                <div style={{ textAlign: 'center', padding: '16px 0 0', color: 'var(--text-muted)', fontSize: 12 }}>
                  Reporting hierarchy not configured yet
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — Search */}
        <div style={{ position: 'sticky', top: 24 }}>
          <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg, #0c1f2c, #1E516E)', padding: '14px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#fff' }}>🔍 Find Employee</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 1 }}>Search by name or employee ID</div>
            </div>
            <div style={{ padding: '14px 16px' }}>
              <input
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search employees…"
                style={{ width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 9, border: '1.5px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ padding: '0 16px 16px', maxHeight: 520, overflowY: 'auto' }}>
              {searching && <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>Searching…</div>}
              {!searching && query && results.length === 0 && (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>No employees found for &quot;{query}&quot;</div>
              )}
              {!searching && results.map((emp) => <SearchCard key={emp.emp_pkey} emp={emp} />)}
              {!query && (
                <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-muted)', fontSize: 12 }}>
                  <div style={{ fontSize: 24, opacity: 0.3, marginBottom: 6 }}>🔍</div>
                  Type to search any employee
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
