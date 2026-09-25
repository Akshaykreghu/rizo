'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { photoUrl } from '@/lib/utils';
import { PageSkeleton } from '@/components/ui/Skeleton';

// Port of New Rizo's pages/ESS/ESSTeam.jsx, backed by /api/employees/[id]/team (hierarchy)
// and /api/ess/directory (search) — see those routes' comments for why they're separate
// from the admin employee-list/hierarchy endpoints.

interface Person {
  emp_pkey: number;
  first_name: string;
  last_name: string | null;
  emp_code?: string | null; // Employee ID (e.g. GRTL100016)
  profile_pic?: string | null;
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
interface FullTeamMember extends Person {
  depth: number;
  manager_id: number | null;
}

// Profile photo when the employee has one, otherwise their initials — fills the avatar circle.
function Face({ emp }: { emp?: Person | null }) {
  const url = photoUrl(emp?.profile_pic);
  // eslint-disable-next-line @next/next/no-img-element -- user-uploaded photo URL
  if (url) return <img src={url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />;
  return <>{initials(emp?.first_name, emp?.last_name)}</>;
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
          <Face emp={emp} />
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
          <Face emp={emp} />
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
        <Face emp={emp} />
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
          <Face emp={emp} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{emp.first_name} {emp.last_name}</div>
          {emp.desig_name && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{emp.desig_name}</div>}
          {emp.emp_code && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>{emp.emp_code}</div>}
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
// Each card gets its own vertical drop line, joined into one continuous horizontal bar across
// all siblings (same connector style as the "Entire Team" org-chart's TreeChildrenRow) — one
// straight row, not a single bracket spanning a fixed width regardless of how many there are.
function ConnectedRow({ children }: { children: ReactNode[] }) {
  const count = children.length;
  if (count === 0) return null;
  if (count === 1) return (<><VLine h={28} /><div>{children[0]}</div></>);
  return (
    <div style={{ overflowX: 'auto', maxWidth: '100%', paddingBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'center', width: 'max-content', margin: '0 auto' }}>
        {children.map((child, i) => (
          <div key={i} style={{ position: 'relative', padding: '20px 8px 0', flexShrink: 0 }}>
            <div style={{ position: 'absolute', top: 0, left: '50%', width: 2, height: 20, background: 'var(--border)' }} />
            {i > 0 && <div style={{ position: 'absolute', top: 0, left: 0, width: '50%', height: 2, background: 'var(--border)' }} />}
            {i < count - 1 && <div style={{ position: 'absolute', top: 0, left: '50%', width: '50%', height: 2, background: 'var(--border)' }} />}
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}

// Plain gray person silhouette used on org-chart cards, matching the reference chart's
// neutral (non-per-person-colored) avatar icon.
function PersonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" fill="var(--text-muted)" />
      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="var(--text-muted)" />
    </svg>
  );
}

// Compact card for the "Entire Team" org chart — deliberately simpler than EmpNode (used
// for Manager/Peers above): plain avatar icon, name, designation, a reports-count badge,
// and a collapse toggle, matching login.glosonline.com's org chart style.
function OrgTreeCard({
  person,
  reportCount,
  collapsed,
  onToggleCollapse,
}: {
  person: FullTeamMember;
  reportCount: number;
  collapsed: boolean;
  onToggleCollapse?: () => void;
}) {
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '14px 16px', background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 12, minWidth: 168, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
      {reportCount > 0 && onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          style={{ position: 'absolute', top: -9, right: -9, width: 20, height: 20, borderRadius: '50%', border: '1.5px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
        >
          {collapsed ? '+' : '−'}
        </button>
      )}
      <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-page)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <PersonIcon />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3 }}>{person.first_name} {person.last_name}</div>
        {person.desig_name && <div style={{ fontSize: 10, color: '#2563eb', marginTop: 2 }}>{person.desig_name}</div>}
      </div>
      {reportCount > 0 && (
        <div style={{ fontSize: 9, fontWeight: 700, color: '#059669' }}>{reportCount} report{reportCount !== 1 ? 's' : ''}</div>
      )}
    </div>
  );
}

// True per-parent org chart branching (each node's own children hang directly beneath it,
// like login.glosonline.com's org chart) for the "Entire Team" view — as opposed to the
// default view's single flat row, which needs no branching since it's only one level deep.
function TreeChildrenRow({
  nodes,
  childrenMap,
  collapsedIds,
  onToggleCollapse,
}: {
  nodes: FullTeamMember[];
  childrenMap: Map<number, FullTeamMember[]>;
  collapsedIds: Set<number>;
  onToggleCollapse: (id: number) => void;
}) {
  if (nodes.length === 0) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      {nodes.map((node, i) => (
        <div key={node.emp_pkey} style={{ position: 'relative', padding: '20px 10px 0' }}>
          <div style={{ position: 'absolute', top: 0, left: '50%', width: 2, height: 20, background: 'var(--border)' }} />
          {i > 0 && <div style={{ position: 'absolute', top: 0, left: 0, width: '50%', height: 2, background: 'var(--border)' }} />}
          {i < nodes.length - 1 && <div style={{ position: 'absolute', top: 0, left: '50%', width: '50%', height: 2, background: 'var(--border)' }} />}
          <OrgTreeNode person={node} childrenMap={childrenMap} collapsedIds={collapsedIds} onToggleCollapse={onToggleCollapse} />
        </div>
      ))}
    </div>
  );
}
function OrgTreeNode({
  person,
  childrenMap,
  collapsedIds,
  onToggleCollapse,
}: {
  person: FullTeamMember;
  childrenMap: Map<number, FullTeamMember[]>;
  collapsedIds: Set<number>;
  onToggleCollapse: (id: number) => void;
}) {
  const kids = childrenMap.get(person.emp_pkey) ?? [];
  const collapsed = collapsedIds.has(person.emp_pkey);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <OrgTreeCard person={person} reportCount={kids.length} collapsed={collapsed} onToggleCollapse={() => onToggleCollapse(person.emp_pkey)} />
      {kids.length > 0 && !collapsed && (
        <>
          <VLine h={20} />
          <TreeChildrenRow nodes={kids} childrenMap={childrenMap} collapsedIds={collapsedIds} onToggleCollapse={onToggleCollapse} />
        </>
      )}
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

  const [showEntireTeam, setShowEntireTeam] = useState(false);
  const [allReports, setAllReports] = useState<FullTeamMember[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  const [treeZoom, setTreeZoom] = useState(1);

  function toggleNodeCollapse(id: number) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  function handleToggleEntireTeam() {
    if (showEntireTeam) {
      setShowEntireTeam(false);
      return;
    }
    if (allReports) {
      setShowEntireTeam(true);
      return;
    }
    setLoadingAll(true);
    fetch(`/api/employees/${empId}/team?scope=all`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setAllReports(data?.allReports ?? []);
        setShowEntireTeam(true);
      })
      .finally(() => setLoadingAll(false));
  }

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
      <div style={{ padding: '24px 28px 40px' }}>
        <PageSkeleton hero body="cards" />
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

  const childrenMap = new Map<number, FullTeamMember[]>();
  for (const p of allReports ?? []) {
    if (p.manager_id == null) continue;
    const list = childrenMap.get(p.manager_id) ?? [];
    list.push(p);
    childrenMap.set(p.manager_id, list);
  }
  const rootChildren = me ? childrenMap.get(me.emp_pkey) ?? [] : [];

  return (
    <div className="page-content">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24, alignItems: 'start' }}>

        {/* LEFT — Hierarchy: one container, connector lines throughout, expands in place */}
        <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ background: 'linear-gradient(135deg, #0c1f2c, #1E516E)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#fff' }}>👥 My Team</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                {manager ? `Reports to ${manager.first_name} ${manager.last_name}` : 'No reporting hierarchy set'}
                {' · '}
                {showEntireTeam
                  ? `${(allReports ?? []).length} member${(allReports ?? []).length !== 1 ? 's' : ''} across all levels`
                  : `${directReports.length} direct report${directReports.length !== 1 ? 's' : ''}`}
              </div>
            </div>
            <button
              type="button"
              onClick={handleToggleEntireTeam}
              disabled={loadingAll}
              style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 9, border: '1.5px solid rgba(255,255,255,0.3)', background: showEntireTeam ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: loadingAll ? 'default' : 'pointer', opacity: loadingAll ? 0.6 : 1, whiteSpace: 'nowrap' }}
            >
              {loadingAll ? 'Loading…' : showEntireTeam ? 'Direct Reports Only' : 'Entire Team'}
            </button>
          </div>

          <div style={{ padding: '28px 24px 32px', maxHeight: 640, overflowY: 'auto' }}>
            {manager && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: 8 }}>Reporting Manager</div>
                <EmpNode emp={manager} size="md" />
                <VLine h={28} />
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', flexWrap: 'wrap', gap: 16, paddingBottom: 2 }}>
              {showEntireTeam && leftPeers.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {leftPeers.map((p) => <EmpNode key={p.emp_pkey} emp={p} size="xs" />)}
                </div>
              )}
              <div style={{ flexShrink: 0 }}>
                <EmpNode emp={me} isYou />
              </div>
              {showEntireTeam && rightPeers.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {rightPeers.map((p) => <EmpNode key={p.emp_pkey} emp={p} size="xs" />)}
                </div>
              )}
            </div>

            {/* Direct reports — one straight row, each card connected by its own line; scrolls
                horizontally instead of wrapping when there are too many to fit. */}
            {!showEntireTeam && directReports.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <VLine h={28} />
                <ConnectedRow>
                  {directReports.map((r) => <EmpNode key={r.emp_pkey} emp={r} size="sm" />)}
                </ConnectedRow>
                <div style={{ marginTop: 8, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)' }}>
                  Direct Reports · {directReports.length}
                </div>
              </div>
            )}

            {/* Entire team — a real org chart: each node's own children branch directly off it */}
            {showEntireTeam && (
              rootChildren.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '16px 0 0', color: 'var(--text-muted)', fontSize: 12 }}>
                  No one reports up to you yet
                </div>
              ) : (
                <>
                  <VLine h={24} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
                    <button type="button" onClick={() => setTreeZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))} style={{ width: 26, height: 26, borderRadius: 7, border: '1.5px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>−</button>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', minWidth: 36, textAlign: 'center' }}>{Math.round(treeZoom * 100)}%</div>
                    <button type="button" onClick={() => setTreeZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(2)))} style={{ width: 26, height: 26, borderRadius: 7, border: '1.5px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>+</button>
                    <button type="button" onClick={() => setTreeZoom(1)} style={{ padding: '0 10px', height: 26, borderRadius: 7, border: '1.5px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Reset</button>
                  </div>
                  <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
                    <div style={{ transform: `scale(${treeZoom})`, transformOrigin: 'top center' }}>
                      <TreeChildrenRow nodes={rootChildren} childrenMap={childrenMap} collapsedIds={collapsedIds} onToggleCollapse={toggleNodeCollapse} />
                    </div>
                  </div>
                </>
              )
            )}

            {!manager && peers.length === 0 && directReports.length === 0 && (
              <div style={{ textAlign: 'center', padding: '16px 0 0', color: 'var(--text-muted)', fontSize: 12 }}>
                Reporting hierarchy not configured yet
              </div>
            )}
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
