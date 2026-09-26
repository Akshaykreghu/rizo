'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import { Building2, MapPin, Phone, Mail, Globe } from 'lucide-react';
import { photoUrl } from '@/lib/utils';
import { PageSkeleton } from '@/components/ui/Skeleton';
import AppTabs from '@/components/ess/AppTabs';

// Port of New Rizo's pages/ESS/ESSTeam.jsx, backed by /api/employees/[id]/team (hierarchy)
// and /api/ess/directory (search) — see those routes' comments for why they're separate
// from the admin employee-list/hierarchy endpoints.
//
// This page is the "Organisation" tab group: My Team (this original page, unchanged) plus three
// read-only views an employee has no admin access to edit — Company Details (/api/company, the
// same row the admin Company Profile page's Profile tab edits), Branches (/api/setup/branches),
// and HR Policy documents (documents.policy = 1 — see DocumentManagersController.php's doc_template
// save: a template flagged policy=1 auto-creates a company-wide documents row, distinct from an
// employee's own allocated documents shown on the Allocations page's My Documents tab).

function EmptyNote({ text }: { text: string }) {
  return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>{text}</div>;
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Blanks out legacy sentinel values ("0", "0.00") so a never-filled-in field reads as empty. */
function clean(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  return s === '0' || s === '0.00' ? '' : s;
}

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
          {emp?.mobile_no && (
            <div style={{ marginTop: 4, fontSize: 9.5, color: 'var(--text-muted)' }}>
              <a href={`tel:${emp.mobile_no}`} style={{ color: 'inherit', textDecoration: 'none' }}>📱 {emp.mobile_no}</a>
            </div>
          )}
          {emp?.emp_code && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>{emp.emp_code}</div>}
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
        {person.emp_code && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>{person.emp_code}</div>}
        {person.mobile_no && (
          <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 2 }}>
            <a href={`tel:${person.mobile_no}`} style={{ color: 'inherit', textDecoration: 'none' }}>📱 {person.mobile_no}</a>
          </div>
        )}
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

function MyTeamTab() {
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
  );
}

// ── Company Details (read-only) ─────────────────────────────────────────────────────────────
interface CompanyProfile {
  business_name?: string | null;
  business_type?: string | null;
  business_nature?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logo?: string | null;
}

function FieldCard({ icon: Icon, label, value, href }: { icon: React.ElementType; label: string; value?: string | null; href?: string }) {
  const clean_ = clean(value);
  const content = clean_ || '—';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--bg-page)', border: '1px solid var(--border)' }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(30,81,110,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={15} color="#1E516E" strokeWidth={2} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
        {clean_ && href ? (
          <a href={href} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, color: '#1E516E', textDecoration: 'none', wordBreak: 'break-word' }}>{content}</a>
        ) : (
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>{content}</div>
        )}
      </div>
    </div>
  );
}

// ── Branches (read-only) — also used as the compact panel next to Company Details ──────────
interface Branch {
  id: number;
  branch_name: string;
  branch_code: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

function useBranches() {
  const [rows, setRows] = useState<Branch[] | null>(null);
  useEffect(() => {
    fetch('/api/setup/branches')
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  return rows;
}

// 6 rows visible (each ~54px) before scrolling — the browser's default overlay scrollbar is
// near-invisible on this dark/light theme pair, so it's styled explicitly here instead of relying
// on the platform default to signal there's more to scroll.
const BRANCHES_PANEL_ROWS = 6;
const BRANCHES_PANEL_ROW_HEIGHT = 54;

function BranchesPanel({ branches }: { branches: Branch[] | null }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = !branches ? branches : !q ? branches : branches.filter((b) =>
    [b.branch_name, b.branch_code, b.city, b.state].some((v) => (v ?? '').toLowerCase().includes(q))
  );

  return (
    <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
      <style>{`
        .branches-panel-scroll { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
        .branches-panel-scroll::-webkit-scrollbar { width: 7px; }
        .branches-panel-scroll::-webkit-scrollbar-track { background: transparent; }
        .branches-panel-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
        .branches-panel-scroll::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
      `}</style>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <MapPin size={15} color="#1E516E" strokeWidth={2} />
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>Branches</span>
        {branches && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{filtered?.length}{q ? ` / ${branches.length}` : ''}</span>}
      </div>
      {branches && branches.length > 0 && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search branch, city, state…"
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
      )}
      <div className="branches-panel-scroll" style={{ maxHeight: BRANCHES_PANEL_ROWS * BRANCHES_PANEL_ROW_HEIGHT, overflowY: 'auto' }}>
        {filtered === null ? (
          <div style={{ padding: 16 }}><PageSkeleton body="cards" /></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            {q ? `No branches match "${query}".` : 'No branches have been set up yet.'}
          </div>
        ) : (
          filtered.map((b) => {
            const loc = [clean(b.city), clean(b.state)].filter(Boolean).join(', ');
            return (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(30,81,110,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Building2 size={14} color="#1E516E" strokeWidth={2} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{b.branch_name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{loc || b.branch_code}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function CompanyDetailsTab() {
  const [data, setData] = useState<CompanyProfile | null>(null);
  const branches = useBranches();

  useEffect(() => {
    fetch('/api/company')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d ?? {}))
      .catch(() => setData({}));
  }, []);

  if (data === null) {
    return <div style={{ padding: 24 }}><PageSkeleton hero body="cards" /></div>;
  }

  const typeLine = [clean(data.business_type), clean(data.business_nature)].filter(Boolean).join(' · ');
  const fullAddress = [clean(data.address), clean(data.city), clean(data.state), clean(data.pincode)].filter(Boolean).join(', ');
  // Some legacy-migrated logos are a bare filesystem-relative path ("files/companylogos/...")
  // rather than a real URL this app can serve — same dead-path issue photoUrl() already guards
  // against for profile pictures elsewhere on this page, so it's reused here instead of requesting
  // (and 404-ing on) a path that was never servable to begin with.
  const logoUrl = photoUrl(data.logo);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
      <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
        <div style={{ background: 'linear-gradient(135deg, #0c1f2c, #1E516E)', height: 72 }} />
        <div style={{ padding: '0 24px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 22 }}>
            <div style={{ width: 76, height: 76, marginTop: -36, borderRadius: 18, background: 'var(--bg-card)', border: '4px solid var(--bg-card)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- admin-uploaded company logo URL
                <img src={logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <Building2 size={28} color="#1E516E" strokeWidth={1.75} />
              )}
            </div>
            <div style={{ paddingBottom: 4, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)' }}>{clean(data.business_name) || 'Company'}</div>
              {typeLine && (
                <span style={{ display: 'inline-block', marginTop: 5, padding: '2px 10px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: 'rgba(30,81,110,0.1)', color: '#1E516E' }}>
                  {typeLine}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <FieldCard icon={MapPin} label="Address" value={fullAddress} />
            </div>
            <FieldCard icon={Phone} label="Phone" value={data.phone} />
            <FieldCard icon={Mail} label="Email" value={data.email} href={clean(data.email) ? `mailto:${clean(data.email)}` : undefined} />
            <FieldCard icon={Globe} label="Website" value={data.website} href={clean(data.website) ? clean(data.website) : undefined} />
          </div>
        </div>
      </div>

      <BranchesPanel branches={branches} />
    </div>
  );
}

// ── HR Policy documents (read-only) ─────────────────────────────────────────────────────────
interface PolicyDoc {
  document_pkey: number;
  document_name: string;
  doc_id: string;
  creation_date: string;
  created_by: string;
}

// Same fixed-overlay-portaled-into-.ess-legacy pattern as the Allocations page's AssetDetailModal
// (see that file's comment) — needed so the modal both escapes the sticky header's stacking
// context and stays inside the .ess-legacy[data-theme] scope that every var(--bg-card)/etc. color
// here is defined under.
function PolicyViewModal({ doc, onClose }: { doc: PolicyDoc; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/documents/policies/${doc.document_pkey}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setContent(d?.document ?? ''))
      .catch(() => setContent(''));
  }, [doc.document_pkey]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  const portalTarget = document.querySelector('.ess-legacy') ?? document.body;

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 14, width: 720, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{doc.document_name}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ padding: 20 }}>
          {content === null ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>
          ) : (
            <div className="prose prose-sm max-w-none" style={{ color: 'var(--text-primary)' }} dangerouslySetInnerHTML={{ __html: content }} />
          )}
        </div>
      </div>
    </div>,
    portalTarget
  );
}

function HrPolicyTab() {
  const [rows, setRows] = useState<PolicyDoc[] | null>(null);
  const [viewing, setViewing] = useState<PolicyDoc | null>(null);

  useEffect(() => {
    fetch('/api/documents/policies')
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  if (rows === null) return <div style={{ padding: 24 }}><PageSkeleton hero body="cards" /></div>;
  if (rows.length === 0) return <EmptyNote text="No HR policy documents have been published yet." />;

  return (
    <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((d) => (
        <div key={d.document_pkey} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--bg-page)', border: '1px solid var(--border)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(30,81,110,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📘</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{d.document_name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Published: {fmtDate(d.creation_date)}</div>
          </div>
          <button onClick={() => setViewing(d)} style={{ background: 'none', border: 'none', color: '#1E516E', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', flexShrink: 0 }}>
            View
          </button>
        </div>
      ))}
      {viewing && <PolicyViewModal doc={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

// ── Organisation page shell — tabs: My Team (unchanged), Company Details (branches live inside
// it as a side panel — no separate tab needed), HR Policy ──
const ORG_TABS = [
  { key: 'team', label: 'My Team', icon: '👥' },
  { key: 'company', label: 'Company Details', icon: '🏢' },
  { key: 'policy', label: 'HR Policy', icon: '📘' },
] as const;
type OrgTab = (typeof ORG_TABS)[number]['key'];

export default function EssTeamPage() {
  const [tab, setTab] = useState<OrgTab>('team');

  return (
    <div className="page-content">
      <div style={{ marginBottom: 20 }}>
        <AppTabs
          tabs={ORG_TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))}
          active={tab}
          onChange={(k) => setTab(k as OrgTab)}
        />
      </div>

      {tab === 'team' && <MyTeamTab />}
      {tab === 'company' && <CompanyDetailsTab />}
      {tab === 'policy' && <HrPolicyTab />}
    </div>
  );
}
