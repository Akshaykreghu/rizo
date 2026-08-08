'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DollarSign,
  Users,
  CalendarDays,
  TreePalm,
  FileBarChart,
  UserPlus,
  TrendingUp,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export type ModuleId =
  | 'payroll'
  | 'employees'
  | 'attendance'
  | 'leave'
  | 'reports'
  | 'recruitment'
  | 'performance'
  | 'settings';

export interface SubmenuItem {
  label: string;
  /** Real app route. Omitted for modules that don't exist in the app yet (demo-only). */
  href?: string;
}

export interface ModuleMeta {
  id: ModuleId;
  title: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  submenus: SubmenuItem[];
}

export interface InteractionState {
  clicks: number;
  hoverSeconds: number;
  searches: number;
  lastAccessed: number | null;
}

export interface RankedModule extends ModuleMeta, InteractionState {
  score: number;
  confidence: number;
  rank: number;
  previousRank: number;
  reasons: string[];
  matchedSubmenu?: SubmenuItem;
}

export type InteractionEvent = {
  id: number;
  moduleId: ModuleId;
  type: 'click' | 'hover' | 'search';
  label: string;
  timestamp: number;
};

// Submenu hrefs mirror the real entries in components/layout/Sidebar.tsx so a
// matched submenu can genuinely navigate there. Modules with no equivalent in
// the app yet (Recruitment, Performance) keep hrefs undefined — the UI marks
// those as preview-only instead of pretending to link somewhere real.
export const MODULES: ModuleMeta[] = [
  {
    id: 'payroll',
    title: 'Payroll',
    description: 'Process salaries, payslips & revisions',
    icon: DollarSign,
    keywords: ['pay', 'payroll', 'salary', 'payslip', 'compensation'],
    submenus: [
      { label: 'Process Payroll', href: '/payroll/process' },
      { label: 'Approve Payroll', href: '/payroll/approve' },
      { label: 'Salary Structure', href: '/setup/salary-structure' },
      { label: 'Increments', href: '/payroll/increments' },
      { label: 'Year-End Processing', href: '/payroll/year-end' },
    ],
  },
  {
    id: 'employees',
    title: 'Employees',
    description: 'Manage employee records & profiles',
    icon: Users,
    keywords: ['employee', 'staff', 'people', 'directory', 'profile'],
    submenus: [
      { label: 'All Employees', href: '/employees' },
      { label: 'Add Employee', href: '/employees/new' },
      { label: 'Employee Join', href: '/employees/join' },
      { label: 'Document Upload', href: '/employees/documents' },
    ],
  },
  {
    id: 'attendance',
    title: 'Attendance',
    description: 'Track punches, shifts & regularisation',
    icon: CalendarDays,
    keywords: ['attendance', 'present', 'punch', 'shift', 'checkin'],
    submenus: [
      { label: 'Register', href: '/attendance/register' },
      { label: 'Regularisation', href: '/attendance/regularisation' },
      { label: 'Shift Planner', href: '/attendance/shift-planner' },
      { label: 'Overtime', href: '/attendance/overtime' },
    ],
  },
  {
    id: 'leave',
    title: 'Leave',
    description: 'Apply, approve & track leave balances',
    icon: TreePalm,
    keywords: ['leave', 'vacation', 'holiday', 'time off', 'balance'],
    submenus: [
      { label: 'Leave Requests', href: '/leave/requests' },
      { label: 'Leave Balances', href: '/leave/balances' },
      { label: 'Leave Encashment', href: '/leave/encashment' },
      { label: 'Bulk Leave Upload', href: '/leave/bulk-upload' },
    ],
  },
  {
    id: 'reports',
    title: 'Reports',
    description: 'Employee, payroll & statutory reports',
    icon: FileBarChart,
    keywords: ['report', 'analytics', 'export', 'statutory'],
    submenus: [
      { label: 'Employee Report', href: '/reports/employee' },
      { label: 'Payroll Report', href: '/reports/payroll' },
      { label: 'Attendance Report', href: '/reports/attendance' },
      { label: 'Statutory Report', href: '/reports/statutory' },
    ],
  },
  {
    id: 'recruitment',
    title: 'Recruitment',
    description: 'Source, screen & onboard candidates',
    icon: UserPlus,
    keywords: ['recruit', 'hire', 'job', 'candidate', 'interview'],
    submenus: [
      { label: 'Post Job' },
      { label: 'Screen Resumes' },
      { label: 'Schedule Interview' },
      { label: 'Send Offer' },
    ],
  },
  {
    id: 'performance',
    title: 'Performance',
    description: 'Goals, reviews & appraisal cycles',
    icon: TrendingUp,
    keywords: ['performance', 'review', 'appraisal', 'goals', 'feedback'],
    submenus: [
      { label: 'Set Goals' },
      { label: 'Review Cycle' },
      { label: '360° Feedback' },
      { label: 'Appraisal Report' },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Company setup, roles & access control',
    icon: Settings,
    keywords: ['setting', 'config', 'roles', 'access', 'company setup'],
    submenus: [
      { label: 'Company Profile', href: '/setup/company' },
      { label: 'Branches', href: '/setup/branches' },
      { label: 'Tax Heads', href: '/setup/tax-heads' },
      { label: 'Statutory Heads', href: '/setup/statutory-heads' },
    ],
  },
];

const emptyState = (): InteractionState => ({
  clicks: 0,
  hoverSeconds: 0,
  searches: 0,
  lastAccessed: null,
});

function initialHistory(): Record<ModuleId, InteractionState> {
  return MODULES.reduce(
    (acc, m) => ({ ...acc, [m.id]: emptyState() }),
    {} as Record<ModuleId, InteractionState>
  );
}

function minutesSince(timestamp: number | null): number {
  if (!timestamp) return Infinity;
  return (Date.now() - timestamp) / 60000;
}

function formatLastAccessed(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  const mins = minutesSince(timestamp);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Pure scoring function — isolated so it can be swapped for a call to a real
// recommendation API later without touching any UI code. A future version
// would return this same shape: { order, confidence, reasons }.
function computeRecommendation(history: Record<ModuleId, InteractionState>) {
  const rawScores = MODULES.map((m) => {
    const s = history[m.id];
    const recencyBonus = s.lastAccessed ? Math.max(0, 30 - minutesSince(s.lastAccessed)) : 0;
    const score = s.clicks * 5 + s.searches * 4 + s.hoverSeconds * 2 + recencyBonus;
    return { id: m.id, score };
  });

  const maxScore = Math.max(...rawScores.map((r) => r.score), 1);
  const order = [...rawScores].sort((a, b) => b.score - a.score).map((r) => r.id);
  const topId = order[0];

  const confidence: Record<ModuleId, number> = {} as Record<ModuleId, number>;
  const reasons: Record<ModuleId, string[]> = {} as Record<ModuleId, string[]>;

  for (const { id, score } of rawScores) {
    confidence[id] = score <= 0 ? 40 : Math.round(Math.min(99, 40 + (score / maxScore) * 59));

    const s = history[id];
    const list: string[] = [];
    if (s.clicks >= 5) list.push('Frequently accessed');
    if (s.hoverSeconds >= 20) list.push('High hover duration');
    if (s.searches >= 2) list.push('Frequently searched for');
    const mins = minutesSince(s.lastAccessed);
    if (mins < 5) list.push('Used just now');
    else if (mins < 60) list.push('Used recently');

    if (id === 'attendance' && topId === 'payroll' && history.payroll.clicks > 0) {
      list.push('Usually accessed right after Payroll');
    }
    if (id === 'employees' && topId === 'recruitment' && history.recruitment.clicks > 0) {
      list.push('Often reviewed after Recruitment activity');
    }
    if (id === 'reports' && (topId === 'payroll' || topId === 'attendance')) {
      list.push('Commonly checked to verify recent activity');
    }

    if (list.length === 0) list.push('Limited interaction so far — AI is still learning');
    reasons[id] = list;
  }

  return { order, confidence, reasons, scores: Object.fromEntries(rawScores.map((r) => [r.id, r.score])) as Record<ModuleId, number> };
}

type ReplayStep =
  | { type: 'click'; moduleId: ModuleId }
  | { type: 'hover'; moduleId: ModuleId; seconds: number }
  | { type: 'search'; query: string };

// A believable "morning routine" session — payroll checks, an attendance
// glance, a couple of searches, a report pulled to verify. Spaced out with
// randomised gaps at replay time so it never feels mechanical.
const REPLAY_SCRIPT: ReplayStep[] = [
  { type: 'click', moduleId: 'attendance' },
  { type: 'hover', moduleId: 'attendance', seconds: 1.4 },
  { type: 'click', moduleId: 'payroll' },
  { type: 'click', moduleId: 'payroll' },
  { type: 'hover', moduleId: 'payroll', seconds: 2.6 },
  { type: 'search', query: 'pay' },
  { type: 'click', moduleId: 'payroll' },
  { type: 'click', moduleId: 'reports' },
  { type: 'hover', moduleId: 'reports', seconds: 1.6 },
  { type: 'click', moduleId: 'attendance' },
  { type: 'click', moduleId: 'payroll' },
  { type: 'hover', moduleId: 'payroll', seconds: 1.8 },
  { type: 'click', moduleId: 'employees' },
  { type: 'click', moduleId: 'payroll' },
  { type: 'search', query: 'report' },
  { type: 'click', moduleId: 'reports' },
];

const PERSONAS: Record<string, Partial<Record<ModuleId, number>>> = {
  'HR Manager': { employees: 90, leave: 85, attendance: 70, performance: 60, reports: 50 },
  'Payroll Officer': { payroll: 95, attendance: 80, reports: 75, employees: 45 },
  Recruiter: { recruitment: 100, employees: 90, performance: 50 },
};

let eventCounter = 0;

export function useNavigationAI() {
  const [history, setHistory] = useState<Record<ModuleId, InteractionState>>(initialHistory);
  const previousOrderRef = useRef<ModuleId[]>(MODULES.map((m) => m.id));
  const [events, setEvents] = useState<InteractionEvent[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [pipelineKey, setPipelineKey] = useState(0);
  const [isReplaying, setIsReplaying] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const pushEvent = useCallback((moduleId: ModuleId, type: InteractionEvent['type'], label: string) => {
    eventCounter += 1;
    setEvents((prev) => [{ id: eventCounter, moduleId, type, label, timestamp: Date.now() }, ...prev].slice(0, 6));
    setPipelineKey((k) => k + 1);
  }, []);

  const registerClick = useCallback(
    (id: ModuleId) => {
      setHistory((prev) => ({
        ...prev,
        [id]: { ...prev[id], clicks: prev[id].clicks + 1, lastAccessed: Date.now() },
      }));
      pushEvent(id, 'click', `Clicked ${MODULES.find((m) => m.id === id)?.title}`);
    },
    [pushEvent]
  );

  const registerHover = useCallback(
    (id: ModuleId, seconds: number) => {
      if (seconds < 0.5) return;
      setHistory((prev) => ({
        ...prev,
        [id]: { ...prev[id], hoverSeconds: prev[id].hoverSeconds + seconds },
      }));
      pushEvent(id, 'hover', `Reviewed ${MODULES.find((m) => m.id === id)?.title} for ${seconds.toFixed(1)}s`);
    },
    [pushEvent]
  );

  const registerSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
      const trimmed = query.trim().toLowerCase();
      if (trimmed.length < 2) return;
      searchDebounce.current = setTimeout(() => {
        let match: ModuleMeta | undefined;
        let matchedLabel = '';

        for (const m of MODULES) {
          const submenuHit = m.submenus.find((s) => s.label.toLowerCase().includes(trimmed));
          if (submenuHit) {
            match = m;
            matchedLabel = submenuHit.label;
            break;
          }
        }
        if (!match) {
          match = MODULES.find(
            (m) => m.title.toLowerCase().includes(trimmed) || m.keywords.some((k) => k.includes(trimmed))
          );
          matchedLabel = match?.title ?? '';
        }
        if (!match) return;

        setHistory((prev) => ({
          ...prev,
          [match!.id]: { ...prev[match!.id], searches: prev[match!.id].searches + 1 },
        }));
        pushEvent(match.id, 'search', `Searched "${query}" → matched ${matchedLabel}`);
      }, 400);
    },
    [pushEvent]
  );

  const applyPersona = useCallback((persona: keyof typeof PERSONAS) => {
    const targets = PERSONAS[persona];
    const next = initialHistory();
    for (const m of MODULES) {
      const target = targets[m.id];
      if (target) {
        next[m.id] = {
          clicks: Math.round(target / 6),
          hoverSeconds: Math.round(target / 4),
          searches: Math.round(target / 25),
          lastAccessed: Date.now() - Math.random() * 2 * 60000,
        };
      } else {
        next[m.id] = {
          clicks: 1,
          hoverSeconds: 2,
          searches: 0,
          lastAccessed: Date.now() - (2 + Math.random() * 3) * 24 * 60 * 60000,
        };
      }
    }
    setHistory(next);
    eventCounter += 1;
    setEvents([{ id: eventCounter, moduleId: MODULES[0].id, type: 'click', label: `Simulated "${persona}" usage pattern`, timestamp: Date.now() }]);
    setPipelineKey((k) => k + 1);
  }, []);

  const cancelReplay = useCallback(() => {
    replayTimers.current.forEach(clearTimeout);
    replayTimers.current = [];
    setIsReplaying(false);
  }, []);

  const runReplay = useCallback(() => {
    cancelReplay();
    setIsReplaying(true);

    let cumulative = 500;
    for (const step of REPLAY_SCRIPT) {
      cumulative += 1800 + Math.random() * 1400;
      const delay = cumulative;
      const timer = setTimeout(() => {
        if (step.type === 'click') registerClick(step.moduleId);
        else if (step.type === 'hover') registerHover(step.moduleId, step.seconds);
        else registerSearch(step.query);
      }, delay);
      replayTimers.current.push(timer);
    }

    const endTimer = setTimeout(() => {
      registerSearch('');
      setIsReplaying(false);
      replayTimers.current = [];
    }, cumulative + 1000);
    replayTimers.current.push(endTimer);
  }, [cancelReplay, registerClick, registerHover, registerSearch]);

  useEffect(() => () => cancelReplay(), [cancelReplay]);

  const reset = useCallback(() => {
    cancelReplay();
    setHistory(initialHistory());
    setEvents([]);
    setSearchQuery('');
    previousOrderRef.current = MODULES.map((m) => m.id);
    setPipelineKey((k) => k + 1);
  }, [cancelReplay]);

  const recommendation = useMemo(() => computeRecommendation(history), [history]);

  const modules: RankedModule[] = useMemo(() => {
    const trimmedQuery = searchQuery.trim().toLowerCase();
    const searchActive = trimmedQuery.length >= 2;

    // Two-tier priority: a submenu hit outranks a bare module/keyword hit,
    // so "payslip" surfaces Payroll above a module that merely matches by name.
    const submenuMatches = new Map<ModuleId, SubmenuItem>();
    const titleMatches = new Set<ModuleId>();
    if (searchActive) {
      for (const meta of MODULES) {
        const submenuHit = meta.submenus.find((s) => s.label.toLowerCase().includes(trimmedQuery));
        if (submenuHit) {
          submenuMatches.set(meta.id, submenuHit);
          continue;
        }
        if (meta.title.toLowerCase().includes(trimmedQuery) || meta.keywords.some((k) => k.includes(trimmedQuery))) {
          titleMatches.add(meta.id);
        }
      }
    }

    let orderedIds = recommendation.order;
    if (searchActive) {
      const tierSubmenu = recommendation.order.filter((id) => submenuMatches.has(id));
      const tierTitle = recommendation.order.filter((id) => titleMatches.has(id));
      const rest = recommendation.order.filter((id) => !submenuMatches.has(id) && !titleMatches.has(id));
      orderedIds = [...tierSubmenu, ...tierTitle, ...rest];
    }

    return orderedIds.map((id, index) => {
      const meta = MODULES.find((m) => m.id === id)!;
      const state = history[id];
      const prevRank = previousOrderRef.current.indexOf(id);
      const matchedSubmenu = submenuMatches.get(id);
      const reasons = matchedSubmenu
        ? [`Matches your search "${searchQuery.trim()}" → ${matchedSubmenu.label}`, ...recommendation.reasons[id]]
        : recommendation.reasons[id];
      return {
        ...meta,
        ...state,
        score: Math.round(recommendation.scores[id]),
        confidence: recommendation.confidence[id],
        rank: index,
        previousRank: prevRank === -1 ? index : prevRank,
        reasons,
        matchedSubmenu,
      };
    });
  }, [recommendation, history, searchQuery]);

  useEffect(() => {
    previousOrderRef.current = modules.map((m) => m.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendation.order.join(','), searchQuery]);

  const topModule = modules[0];

  const metrics = useMemo(() => {
    const totalInteractions = MODULES.reduce(
      (sum, m) => sum + history[m.id].clicks + history[m.id].searches,
      0
    );
    const modulesLearned = MODULES.filter(
      (m) => history[m.id].clicks > 0 || history[m.id].searches > 0 || history[m.id].hoverSeconds > 0
    ).length;
    const avgTopConfidence = Math.round(
      modules.slice(0, 3).reduce((sum, m) => sum + m.confidence, 0) / Math.max(1, Math.min(3, modules.length))
    );
    return {
      navigationEfficiency: Math.min(98, 52 + totalInteractions * 3),
      predictionAccuracy: modulesLearned === 0 ? 50 : avgTopConfidence,
      clicksSaved: Math.round(totalInteractions * 1.4),
      modulesLearned,
    };
  }, [history, modules]);

  const explanation = useMemo(() => {
    if (!topModule || topModule.score === 0) {
      return "I'm still learning your habits — interact with a few modules to see personalized ordering.";
    }
    return `Based on your activity, ${topModule.title} has become your primary module.`;
  }, [topModule]);

  return {
    modules,
    events,
    searchQuery,
    metrics,
    explanation,
    pipelineKey,
    registerClick,
    registerHover,
    registerSearch,
    applyPersona,
    reset,
    isReplaying,
    runReplay,
    cancelReplay,
    personas: Object.keys(PERSONAS) as (keyof typeof PERSONAS)[],
    formatLastAccessed,
  };
}
