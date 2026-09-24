import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

// Company announcements (admin-authored, shown in the ESS home "Company Updates" panel).
// Legacy has no equivalent feature, so these three tables are new and not in any schema dump —
// ensureAnnouncementTables() creates them on first use per tenant DB (CREATE TABLE IF NOT
// EXISTS, never touches an existing table), the same idempotent approach as
// scripts/create-image-templates.mjs but without a manual step per tenant.
//
//   announcements          one row per announcement (soft-deleted via active = 0)
//   announcement_targets   the audience values when audience_type != 'ALL' — an emp_pkey, a
//                          branch_code, a dept_code or a desig_code, depending on the type.
//                          latin1 like emp_proff, so target_value compares against
//                          emp_proff.emp_branch/emp_dept/designation without a collation clash.
//   announcement_reads     first time each employee opened an announcement (admin read count)

export const CATEGORIES = ['Emergency', 'Important', 'Information'] as const;
export type Category = (typeof CATEGORIES)[number];

export const AUDIENCE_TYPES = ['ALL', 'EMPLOYEE', 'BRANCH', 'DEPARTMENT', 'DESIGNATION'] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

const CREATE_ANNOUNCEMENTS = `
CREATE TABLE IF NOT EXISTS announcements (
  announcement_pkey int(11) NOT NULL AUTO_INCREMENT,
  title varchar(200) NOT NULL,
  message text NOT NULL,
  category varchar(20) NOT NULL DEFAULT 'Information',
  is_pinned tinyint(1) NOT NULL DEFAULT 0,
  audience_type varchar(20) NOT NULL DEFAULT 'ALL',
  publish_from date NOT NULL,
  expires_on date DEFAULT NULL,
  created_by varchar(50) DEFAULT NULL,
  created_date datetime DEFAULT CURRENT_TIMESTAMP,
  updated_by varchar(50) DEFAULT NULL,
  updated_date datetime DEFAULT NULL,
  active tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (announcement_pkey),
  KEY idx_announcements_live (active, publish_from, expires_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_TARGETS = `
CREATE TABLE IF NOT EXISTS announcement_targets (
  target_pkey int(11) NOT NULL AUTO_INCREMENT,
  announcement_fkey int(11) NOT NULL,
  target_value varchar(50) NOT NULL,
  PRIMARY KEY (target_pkey),
  UNIQUE KEY uq_announcement_target (announcement_fkey, target_value),
  KEY idx_announcement_target_value (target_value)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;

const CREATE_READS = `
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_fkey int(11) NOT NULL,
  emp_fkey int(11) NOT NULL,
  read_at datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (announcement_fkey, emp_fkey)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;

const ensured = new WeakSet<Pool>();

export async function ensureAnnouncementTables(pool: Pool): Promise<void> {
  if (ensured.has(pool)) return;
  await pool.query(CREATE_ANNOUNCEMENTS);
  await pool.query(CREATE_TARGETS);
  await pool.query(CREATE_READS);
  ensured.add(pool);
}

// True when employee `e` (emp_details) with professional row `p` (emp_proff) is in announcement
// `a`'s audience. Shared by the ESS feed and the admin recipient counts so both agree exactly.
export const AUDIENCE_MATCH_SQL = `(
  a.audience_type = 'ALL' OR EXISTS (
    SELECT 1 FROM announcement_targets t
    WHERE t.announcement_fkey = a.announcement_pkey
      AND t.target_value = CASE a.audience_type
        WHEN 'EMPLOYEE' THEN CAST(e.emp_pkey AS CHAR CHARACTER SET latin1)
        WHEN 'BRANCH' THEN p.emp_branch
        WHEN 'DEPARTMENT' THEN p.emp_dept
        WHEN 'DESIGNATION' THEN p.designation
      END
  )
)`;

// Published and not yet expired, by the DB's own (IST) calendar date.
export const LIVE_SQL = `a.active = 1 AND a.publish_from <= CURDATE() AND (a.expires_on IS NULL OR a.expires_on >= CURDATE())`;

export interface AnnouncementInput {
  title: string;
  message: string;
  category: Category;
  isPinned: boolean;
  audienceType: AudienceType;
  targets: string[];
  publishFrom: string;
  expiresOn: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseAnnouncementInput(body: Record<string, unknown>): { input?: AnnouncementInput; error?: string } {
  const title = String(body.title ?? '').trim();
  const message = String(body.message ?? '').trim();
  const category = String(body.category ?? '') as Category;
  const audienceType = String(body.audienceType ?? '') as AudienceType;
  const publishFrom = String(body.publishFrom ?? '');
  const expiresOn = body.expiresOn ? String(body.expiresOn) : null;
  const targets = Array.isArray(body.targets)
    ? [...new Set(body.targets.map((t) => String(t).trim()).filter(Boolean))]
    : [];

  if (!title) return { error: 'Title is required' };
  if (title.length > 200) return { error: 'Title must be 200 characters or fewer' };
  if (!message) return { error: 'Message is required' };
  if (!CATEGORIES.includes(category)) return { error: 'Invalid announcement type' };
  if (!AUDIENCE_TYPES.includes(audienceType)) return { error: 'Invalid audience' };
  if (audienceType !== 'ALL' && targets.length === 0) return { error: 'Select at least one recipient' };
  if (targets.some((t) => t.length > 50)) return { error: 'Invalid recipient value' };
  if (!ISO_DATE.test(publishFrom)) return { error: 'Publish date is required' };
  if (expiresOn && !ISO_DATE.test(expiresOn)) return { error: 'Invalid expiry date' };
  if (expiresOn && expiresOn < publishFrom) return { error: 'Expiry date cannot be before the publish date' };

  return {
    input: {
      title, message, category, audienceType, publishFrom, expiresOn,
      isPinned: Boolean(body.isPinned),
      targets: audienceType === 'ALL' ? [] : targets,
    },
  };
}

export interface TargetOption {
  value: string;
  label: string;
}

// Audience values with a display name, grouped by announcement — one query for a whole page of
// announcements. Each target is labelled from the master table its audience_type points at.
export async function loadTargets(pool: Pool, ids: number[]): Promise<Map<number, TargetOption[]>> {
  const out = new Map<number, TargetOption[]>();
  if (!ids.length) return out;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT t.announcement_fkey, t.target_value,
            CASE a.audience_type
              WHEN 'EMPLOYEE' THEN CONCAT(ed.first_name, ' ', IFNULL(ed.last_name, ''), ' (', IFNULL(NULLIF(TRIM(ep.emp_company_id), ''), ed.emp_id), ')')
              WHEN 'BRANCH' THEN b.branch_name
              WHEN 'DEPARTMENT' THEN d.dept_name
              WHEN 'DESIGNATION' THEN ds.desig_name
            END AS label
     FROM announcement_targets t
     JOIN announcements a ON a.announcement_pkey = t.announcement_fkey
     LEFT JOIN emp_details ed ON a.audience_type = 'EMPLOYEE' AND ed.emp_pkey = t.target_value
     LEFT JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
     LEFT JOIN branches b ON a.audience_type = 'BRANCH' AND b.branch_code = t.target_value
     LEFT JOIN department d ON a.audience_type = 'DEPARTMENT' AND d.dept_code = t.target_value
     LEFT JOIN designation ds ON a.audience_type = 'DESIGNATION' AND ds.desig_code = t.target_value
     WHERE t.announcement_fkey IN (${ids.map(() => '?').join(',')})
     ORDER BY t.target_pkey`,
    ids
  );
  for (const r of rows) {
    const list = out.get(r.announcement_fkey) ?? [];
    list.push({ value: String(r.target_value), label: r.label?.trim() || String(r.target_value) });
    out.set(r.announcement_fkey, list);
  }
  return out;
}

export async function saveTargets(conn: Pool | PoolConnection, id: number, targets: string[]): Promise<void> {
  await conn.execute('DELETE FROM announcement_targets WHERE announcement_fkey = ?', [id]);
  if (!targets.length) return;
  await conn.query(
    'INSERT INTO announcement_targets (announcement_fkey, target_value) VALUES ?',
    [targets.map((t) => [id, t])]
  );
}

// Number of active employees an audience would reach — used for the live "reaches N employees"
// hint in the admin form before anything is saved.
export async function countAudience(pool: Pool, audienceType: AudienceType, targets: string[]): Promise<number> {
  if (audienceType === 'ALL') {
    const [[row]] = await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS c FROM emp_details WHERE status = 1');
    return Number(row.c);
  }
  if (!targets.length) return 0;
  const column = { EMPLOYEE: 'e.emp_pkey', BRANCH: 'p.emp_branch', DEPARTMENT: 'p.emp_dept', DESIGNATION: 'p.designation' }[audienceType];
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT e.emp_pkey) AS c
     FROM emp_details e LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
     WHERE e.status = 1 AND ${column} IN (${targets.map(() => '?').join(',')})`,
    targets
  );
  return Number(row.c);
}
