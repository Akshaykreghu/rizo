'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { mobileError, futureDateError, localDateStr } from '@/lib/validation';
import { DocumentUploadField } from '@/components/employees/DocumentUploadField';
import { FilePreviewModal } from '@/components/ui/FilePreviewModal';
import { EssDropdown } from '@/components/ess/EssDropdown';
import { photoUrl } from '@/lib/utils';
import { documentNumberError, onlyAlphanumeric } from '@/lib/childRowValidation';
import { PageSkeleton } from '@/components/ui/Skeleton';

// Read-only port of New Rizo's pages/ESS/ESSAbout.jsx. Self-service editing (the pencil icon /
// inline ListEditor forms in the original) is intentionally not included in this pass — this
// page only reads real emp_details / emp_family / emp_passport_visa / Education / work_experience
// / promotions / documents rows via the /api/employees/[id]/* routes (self-access only, enforced
// server-side). Field names below match this app's actual legacy schema, not New Rizo's — see
// the API routes' comments for how each is derived (e.g. Education/work_experience bridge
// through emp_join since they aren't linked to emp_details directly).

type Employee = Record<string, string | number | null | undefined>;

interface FamilyMember {
  emp_family_pkey: number;
  name: string;
  DOB: string | null;
  relation: string | null;
  is_nominee: string | null;
  emergency_contact: string | null;
}
interface PersonalDoc {
  emp_passport_visa_pkey: number;
  document_type: string;
  document_number: string | null;
  name: string | null;
  relation: string | null;
  valid_from: string | null;
  valid_till: string | null;
  files: string | null;
}
interface EducationRow { education_pkey: number; degree: string; university: string; duration: string; marks: string }
interface ExperienceRow { experience_pkey: number; company_name: string; department: string; designation: string; from_date: string; to_date: string | null }
interface Promotion { promotion_pkey: number; approved_date: string; created_date: string; new_desig_name: string | null; remarks: string | null }

type Scalar = string | number | null | undefined;

function initials(a?: Scalar, b?: Scalar) {
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  return ((sa[0] || '') + (sb[0] || '')).toUpperCase() || '?';
}
function fmtDate(d?: Scalar) {
  if (d == null || d === '') return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtMY(d?: Scalar) {
  if (d == null || d === '') return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}
// Matches lib/validation.ts's dobError (18-years-minimum) check — caps the calendar itself at
// that same boundary instead of only rejecting an underage pick after submit.
const MAX_DOB = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return localDateStr(d);
})();
// Matches lib/validation.ts's futureDateError check — blocks a future pick in the calendar itself
// (Work Experience from/to, Family DOB) instead of only rejecting it after submit.
const TODAY = localDateStr(new Date());
// Education duration only ever needs a year, not a full day/month/year pick — a plain year
// dropdown (last 60 years through the current one) instead of a full date-of-day calendar.
const YEAR_OPTIONS = Array.from({ length: 60 }, (_, i) => String(new Date().getFullYear() - i));
function tenureStr(from?: Scalar, to?: Scalar) {
  if (from == null || from === '') return '';
  const s = new Date(from);
  if (isNaN(s.getTime())) return '';
  const e = to != null && to !== '' ? new Date(to) : new Date();
  const m = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  const y = Math.floor(m / 12), mo = m % 12;
  return y > 0 ? `${y}y ${mo}m` : `${mo}m`;
}
function mask(v?: Scalar, keep = 4) {
  if (v == null || v === '') return '—';
  const s = String(v);
  if (s.length <= keep) return s;
  return '•'.repeat(s.length - keep) + s.slice(-keep);
}
function eduEndYear(e: EducationRow) {
  if (!e.duration) return null;
  const m = String(e.duration).match(/(\d{4})\s*$/);
  return m ? m[1] : null;
}
// marks is stored exactly as typed (see addEducation) — a % suffix is optional there, but
// anywhere it's just shown as a summary (the Career Journey timeline) it should always read as
// a percentage regardless of whether the person included the symbol themselves.
function marksWithPercent(v?: string | null) {
  if (!v) return null;
  const t = String(v).trim();
  if (!t) return null;
  return /%\s*$/.test(t) ? t : `${t}%`;
}
function docStatus(till?: string | null): 'no-expiry' | 'expired' | 'expiring' | 'valid' {
  if (!till) return 'no-expiry';
  const days = Math.round((new Date(till).getTime() - Date.now()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring';
  return 'valid';
}
const isYes = (v: unknown) => String(v ?? '').toUpperCase() === 'Y';

function F({ label, value, full, mono, masked }: { label: string; value?: string | number | null; full?: boolean; mono?: boolean; masked?: boolean }) {
  const display = masked ? mask(value == null ? null : String(value)) : (value ?? '—');
  const isEmpty = value == null || value === '';
  return (
    <div style={{ gridColumn: full ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: isEmpty ? 400 : 600, color: isEmpty ? 'var(--text-muted)' : 'var(--text-primary)', fontFamily: mono ? 'monospace' : 'inherit', opacity: isEmpty ? 0.4 : 1 }}>{display}</div>
    </div>
  );
}
function BoolF({ label, value }: { label: string; value?: unknown }) {
  const yes = isYes(value);
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: yes ? '#dcfce7' : 'var(--bg-page)', color: yes ? '#16a34a' : 'var(--text-muted)', border: `1px solid ${yes ? '#86efac' : 'var(--border)'}` }}>{yes ? 'Yes' : 'No'}</span>
    </div>
  );
}
function Sec({ title, icon }: { title: string; icon?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0 12px', color: 'var(--text-muted)' }}>
      {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
      <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', whiteSpace: 'nowrap' }}>{title}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}
function G({ cols = 4, children }: { cols?: number; children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '14px 20px' }}>{children}</div>;
}

// ── Edit form inputs — ported from New Rizo's EF, adapted to this app's actual emp_details
// field names (see /api/employees/[id] PUT) rather than New Rizo's own schema.
const INP: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 7, border: '1.5px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)', boxSizing: 'border-box', outline: 'none' };
type FormState = Record<string, string>;
// Searchable dropdowns (same behavior as Employee Join's) sized to match INP text inputs.
const DD_BTN: React.CSSProperties = { padding: '7px 10px', fontSize: 12, borderRadius: 7 };
function EF({ label, name, form, onChange, type = 'text', opts, full, cols, min, max, required }: {
  label?: string; name: string; form: FormState; onChange: (e: { target: { name: string; value: string } }) => void;
  type?: 'text' | 'date' | 'tel' | 'email' | 'textarea' | 'checkbox'; opts?: readonly string[]; full?: boolean; cols?: number;
  min?: string; max?: string; required?: boolean;
}) {
  const style: React.CSSProperties = { gridColumn: full ? '1 / -1' : cols ? `span ${cols}` : undefined };
  return (
    <div style={style}>
      {label && (
        <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>
          {label}{required && <span style={{ color: '#dc2626' }}> *</span>}
        </label>
      )}
      {opts ? (
        <EssDropdown value={form[name] ?? ''} onChange={(v) => onChange({ target: { name, value: v } })} placeholder="—" buttonStyle={DD_BTN}
          options={opts.map((o) => ({ value: o, label: o }))} />
      ) : type === 'textarea' ? (
        <textarea name={name} value={form[name] ?? ''} onChange={(e) => onChange({ target: { name, value: e.target.value } })} rows={2} style={{ ...INP, resize: 'vertical' }} />
      ) : type === 'checkbox' ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 4, cursor: 'pointer' }}>
          <input type="checkbox" name={name} checked={form[name] === 'Y'} onChange={(e) => onChange({ target: { name, value: e.target.checked ? 'Y' : 'N' } })} style={{ width: 14, height: 14, accentColor: '#1E516E' }} />
          <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{label}</span>
        </label>
      ) : (
        <input type={type} name={name} value={form[name] ?? ''} onChange={(e) => onChange({ target: { name, value: e.target.value } })} min={min} max={max} style={INP} />
      )}
    </div>
  );
}

const ABOUT_PAGES = ['Personal & Statutory', 'Family, Education & Documents'];
const ABOUT_TURN_MS = 620; // matches the .page-turn-* animation duration in globals.css
const PAGE_BTN: React.CSSProperties = { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid rgba(30,81,110,0.35)', borderRadius: 8, background: 'rgba(30,81,110,0.06)', color: '#1E516E', fontSize: 18, fontWeight: 800, lineHeight: 1, cursor: 'pointer', flexShrink: 0 };
const GENDER_OPTS = [{ v: 'male', l: 'Male' }, { v: 'female', l: 'Female' }, { v: 'others', l: 'Other' }];
const BLOOD_OPTS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const MARITAL_OPTS = ['Single', 'Married', 'Divorced', 'Widowed'];
const FAMILY_RELATIONS = ['Self', 'Mother', 'Father', 'Sister', 'Brother', 'Cousin', 'Spouse', 'Other'];
const DOCUMENT_TYPES = ['Aadhaar', 'PAN', 'Passport', 'Driving License', 'Voter ID', 'Educational Certificate', 'Offer Letter', 'Relieving Letter', 'Other'];
// nationality defaults to "Indian" (matches the profile's India default on nationality_id).
const EMPTY_FAMILY = { name: '', relation: '', gender: '', DOB: '', blood_group: '', nationality: 'Indian', contact_number: '', alternate_number: '', is_nominee: 'N', emergency_contact: 'N' };
const EMPTY_DOC = { document_type: '', document_number: '', name: '', relation: '', classification: '', nationality: 'Indian', valid_from: '', valid_till: '', files: '' };
// Field names match /api/employees/[id]/education's own GET aliases (degree/marks, not the raw
// qualifcations columns course/mark) — see that route's comment for why. durationFrom/durationTo
// are this form's own fields, not sent as-is: addEducation() combines them into the single
// `duration` string the API/DB actually store (legacy schema has no separate from/to columns).
const EMPTY_EDUCATION = { degree: '', university: '', durationFrom: '', durationTo: '', marks: '' };
const EMPTY_EXPERIENCE = { company_name: '', designation: '', department: '', from_date: '', to_date: '', salary: '' };

function GenderSelect({ form, onChange }: { form: FormState; onChange: (e: { target: { name: string; value: string } }) => void }) {
  return (
    <div>
      <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Gender</label>
      <EssDropdown value={form.classification ?? ''} onChange={(v) => onChange({ target: { name: 'classification', value: v } })} placeholder="—" buttonStyle={DD_BTN}
        options={GENDER_OPTS.map((o) => ({ value: o.v, label: o.l }))} />
    </div>
  );
}

// Select whose stored value (an id) differs from its label — e.g. nationality_id 75 → "Indian".
function IdSelect({ label, name, form, onChange, options, required }: {
  label: string; name: string; form: FormState; onChange: (e: { target: { name: string; value: string } }) => void;
  options: { v: string; l: string }[]; required?: boolean;
}) {
  return (
    <div>
      <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>
        {label}{required && <span style={{ color: '#dc2626' }}> *</span>}
      </label>
      <EssDropdown value={form[name] ?? ''} onChange={(v) => onChange({ target: { name, value: v } })} placeholder="—" buttonStyle={DD_BTN}
        options={options.map((o) => ({ value: o.v, label: o.l }))} />
    </div>
  );
}

const REL_COLOR: Record<string, string> = {
  father: '#1E516E', mother: '#7c3aed', 'father-in-law': '#1E516E', 'mother-in-law': '#7c3aed',
  husband: '#059669', wife: '#059669', spouse: '#059669', partner: '#059669',
  son: '#d97706', daughter: '#f97316', child: '#f97316',
  brother: '#0ea5e9', sister: '#ec4899',
};
function relColor(r?: string | null) { return REL_COLOR[(r || '').toLowerCase()] || '#6b7280'; }
function relGroup(r?: string | null) {
  const k = (r || '').toLowerCase();
  if (k.includes('father') || k.includes('mother') || k === 'guardian') return 'parent';
  if (['husband', 'wife', 'spouse', 'partner'].includes(k)) return 'partner';
  if (k.includes('son') || k.includes('daughter') || k === 'child') return 'child';
  return 'other';
}

function TreeNode({ name, relation, dob, isEmployee, empInitials, size = 48 }: { name: string; relation?: string | null; dob?: string | null; isEmployee?: boolean; empInitials?: string; size?: number }) {
  const color = isEmployee ? '#1E516E' : relColor(relation);
  const sz = isEmployee ? 64 : size;
  const parts = (name || '').split(' ');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: sz, height: sz, borderRadius: '50%', flexShrink: 0,
        background: `linear-gradient(135deg, ${color}bb, ${color})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: sz * 0.3, fontWeight: 900, color: '#fff',
        boxShadow: isEmployee ? `0 0 0 4px ${color}25, 0 4px 16px ${color}40` : '0 2px 8px rgba(0,0,0,0.1)',
        outline: isEmployee ? `3px solid ${color}` : 'none',
        outlineOffset: 2,
      }}>
        {isEmployee ? empInitials : initials(parts[0], parts[1])}
      </div>
      <div style={{ textAlign: 'center', maxWidth: 80 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3 }}>{name}</div>
        <span style={{ display: 'inline-block', marginTop: 2, padding: '1px 8px', borderRadius: 20, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.3px', background: `${color}15`, color }}>
          {isEmployee ? 'You' : relation}
        </span>
        {dob && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>🎂 {fmtDate(dob)}</div>}
      </div>
    </div>
  );
}

function Line({ h = 22 }: { h?: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}><div style={{ width: 2, height: h, background: 'var(--border)' }} /></div>
  );
}
function BracketDown({ count }: { count: number }) {
  if (!count) return null;
  if (count === 1) return <Line />;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', position: 'relative', height: 26 }}>
      <div style={{ position: 'absolute', top: 0, left: '25%', right: '25%', height: 2, background: 'var(--border)' }} />
      <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 2, height: 14, background: 'var(--border)' }} />
      <div style={{ position: 'absolute', top: 0, left: '25%', width: 2, height: 12, background: 'var(--border)' }} />
      <div style={{ position: 'absolute', top: 0, right: '25%', width: 2, height: 12, background: 'var(--border)' }} />
    </div>
  );
}
function BracketUp({ count }: { count: number }) {
  if (!count) return null;
  if (count === 1) return <Line />;
  return (
    <div style={{ position: 'relative', height: 26 }}>
      <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 2, height: 14, background: 'var(--border)' }} />
      <div style={{ position: 'absolute', bottom: 0, left: '20%', right: '20%', height: 2, background: 'var(--border)' }} />
      <div style={{ position: 'absolute', bottom: 0, left: '20%', width: 2, height: 12, background: 'var(--border)' }} />
      <div style={{ position: 'absolute', bottom: 0, right: '20%', width: 2, height: 12, background: 'var(--border)' }} />
    </div>
  );
}

function FamilyTree({ family, emp }: { family: FamilyMember[]; emp: Employee | null }) {
  const parents = family.filter((f) => relGroup(f.relation) === 'parent');
  const partners = family.filter((f) => relGroup(f.relation) === 'partner');
  const children = family.filter((f) => relGroup(f.relation) === 'child');
  const others = family.filter((f) => relGroup(f.relation) === 'other');
  const empName = `${emp?.first_name || ''} ${emp?.last_name || ''}`.trim();
  const empInits = initials(emp?.first_name, emp?.last_name);

  return (
    <div style={{ padding: '8px 0 4px', userSelect: 'none' }}>
      {parents.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 36 }}>
            {parents.map((p, i) => <TreeNode key={i} name={p.name} relation={p.relation} dob={p.DOB} />)}
          </div>
          <BracketDown count={parents.length} />
        </>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        {partners.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            {partners.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start' }}>
                <TreeNode name={p.name} relation={p.relation} dob={p.DOB} />
                <div style={{ display: 'flex', alignItems: 'center', height: 64, paddingBottom: 24 }}>
                  <div style={{ width: 16, height: 2, background: 'var(--border)' }} />
                  <span style={{ fontSize: 14, color: '#e11d48', lineHeight: 1 }}>♥</span>
                  <div style={{ width: 16, height: 2, background: 'var(--border)' }} />
                </div>
              </div>
            ))}
          </div>
        )}
        <TreeNode name={empName} isEmployee empInitials={empInits} />
      </div>
      {children.length > 0 && (
        <>
          <BracketUp count={children.length} />
          <div style={{ display: 'flex', justifyContent: 'center', gap: 24 }}>
            {children.map((c, i) => <TreeNode key={i} name={c.name} relation={c.relation} dob={c.DOB} />)}
          </div>
        </>
      )}
      {others.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px dashed var(--border)', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 20 }}>
          {others.map((f, i) => <TreeNode key={i} name={f.name} relation={f.relation} dob={f.DOB} />)}
        </div>
      )}
    </div>
  );
}

const TL_CFG = {
  joining: { color: '#1E516E', bg: '#dbeafe', icon: '🏢', label: 'Joined' },
  promotion: { color: '#7c3aed', bg: '#ede9fe', icon: '🚀', label: 'Promoted' },
  education: { color: '#d97706', bg: '#fef3c7', icon: '🎓', label: 'Education' },
  experience: { color: '#059669', bg: '#d1fae5', icon: '💼', label: 'Experience' },
} as const;
type TLKind = keyof typeof TL_CFG;
// `date` drives sort order only. `dateLabel` overrides what the badge actually displays — needed
// for education, whose only real precision is a year, so the badge shouldn't show a fabricated
// day/month (fmtDate(date) would print "01 Jun 2025" for something that's really just "2025").
// sortDate: when the milestone ended (or happened) — the timeline is ordered by this, newest first.
interface TLItem { kind: TLKind; date: string | null; sortDate?: string | null; dateLabel?: string | null; title: string; sub?: string | null; extra?: string | null }

export default function EssAboutPage() {
  const { data: session } = useSession();
  const empId = session?.user.empFkey;

  const [loading, setLoading] = useState(true);
  const [emp, setEmp] = useState<Employee | null>(null);
  const [family, setFamily] = useState<FamilyMember[]>([]);
  const [education, setEducation] = useState<EducationRow[]>([]);
  const [experience, setExperience] = useState<ExperienceRow[]>([]);
  const [documents, setDocuments] = useState<PersonalDoc[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);

  // Self-edit — matches New Rizo's pencil-icon edit mode on ESS About Me, restricted to the
  // fields /api/employees/[id] PUT actually lets an employee change (see that route's isAdmin
  // guard): personal/contact/banking/statutory only, never department/designation/joining date/etc.
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<'saved' | 'failed' | ''>('');
  const [saveError, setSaveError] = useState('');

  const [showFamilyForm, setShowFamilyForm] = useState(false);
  const [familyDraft, setFamilyDraft] = useState(EMPTY_FAMILY);
  const [familyErrors, setFamilyErrors] = useState<Record<string, string>>({});
  const [familySaving, setFamilySaving] = useState(false);

  const [showDocForm, setShowDocForm] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ url: string; title: string } | null>(null);
  // pkey of the row currently open in its section's form for editing (null = the form adds a new row).
  const [editingFamilyPkey, setEditingFamilyPkey] = useState<number | null>(null);
  const [editingEducationPkey, setEditingEducationPkey] = useState<number | null>(null);
  const [editingExperiencePkey, setEditingExperiencePkey] = useState<number | null>(null);
  const [editingDocPkey, setEditingDocPkey] = useState<number | null>(null);
  const [docDraft, setDocDraft] = useState(EMPTY_DOC);
  const [docErrors, setDocErrors] = useState<Record<string, string>>({});
  const [docSaving, setDocSaving] = useState(false);

  const [showEducationForm, setShowEducationForm] = useState(false);
  const [educationDraft, setEducationDraft] = useState(EMPTY_EDUCATION);
  const [educationErrors, setEducationErrors] = useState<Record<string, string>>({});
  const [educationSaving, setEducationSaving] = useState(false);

  const [showExperienceForm, setShowExperienceForm] = useState(false);
  const [experienceDraft, setExperienceDraft] = useState(EMPTY_EXPERIENCE);
  const [experienceErrors, setExperienceErrors] = useState<Record<string, string>>({});
  const [experienceSaving, setExperienceSaving] = useState(false);

  const [nationalities, setNationalities] = useState<{ id: number; nationality: string; country_name: string }[]>([]);
  useEffect(() => {
    fetch('/api/setup/nationalities')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setNationalities(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!empId) return;
    Promise.all([
      fetch(`/api/employees/${empId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/employees/${empId}/family`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`/api/employees/${empId}/education`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`/api/employees/${empId}/experience`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`/api/employees/${empId}/documents`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`/api/promotions?status=Y&emp_fkey=${empId}`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([e, fam, edu, exp, docs, promos]) => {
      setEmp(e?.employee ? { ...e.employee, ...e.professional, ...e.ctc } : null);
      setFamily(fam || []);
      setEducation(edu || []);
      setExperience(exp || []);
      setDocuments(docs || []);
      setPromotions(promos || []);
    }).finally(() => setLoading(false));
  }, [empId]);

  useEffect(() => { load(); }, [load]);

  const [aboutPage, setAboutPage] = useState(0);
  const [aboutTurn, setAboutTurn] = useState<{ from: number; to: number; dir: 'forward' | 'back' } | null>(null);
  const [aboutTurnHeight, setAboutTurnHeight] = useState<number | null>(null);
  const aboutPanelRef = useRef<HTMLDivElement>(null);
  const aboutTurnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (aboutTurnTimer.current) clearTimeout(aboutTurnTimer.current); }, []);
  const aboutPageUI = aboutTurn ? aboutTurn.to : aboutPage;
  function turnAboutPage(to: number) {
    if (to === aboutPage || aboutTurn) return;
    // Freeze the panel at the current page's height so the absolutely-positioned layers have room.
    setAboutTurnHeight(aboutPanelRef.current?.getBoundingClientRect().height ?? null);
    setAboutTurn({ from: aboutPage, to, dir: to > aboutPage ? 'forward' : 'back' });
    aboutTurnTimer.current = setTimeout(() => {
      setAboutPage(to);
      setAboutTurn(null);
      setAboutTurnHeight(null);
      aboutPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, ABOUT_TURN_MS);
  }

  function startEdit() {
    if (!emp) return;
    setForm({
      first_name: emp.first_name != null ? String(emp.first_name) : '',
      last_name: emp.last_name != null ? String(emp.last_name) : '',
      date_of_birth: emp.date_of_birth ? String(emp.date_of_birth).slice(0, 10) : '',
      classification: emp.classification != null ? String(emp.classification) : '',
      blood: emp.blood != null ? String(emp.blood) : '',
      maritual_status: emp.maritual_status != null ? String(emp.maritual_status) : '',
      guradian: emp.guradian != null ? String(emp.guradian) : '',
      relation_guardian: emp.relation_guardian != null ? String(emp.relation_guardian) : '',
      physical_handicap: emp.physical_handicap != null ? String(emp.physical_handicap) : 'N',
      mobile_no: emp.mobile_no != null ? String(emp.mobile_no) : '',
      email: emp.email != null ? String(emp.email) : '',
      address: emp.address != null ? String(emp.address) : '',
      district: emp.city != null ? String(emp.city) : '',
      state: emp.state != null ? String(emp.state) : '',
      pincode: emp.pincode != null ? String(emp.pincode) : '',
      bank_name: emp.bank_name != null ? String(emp.bank_name) : '',
      bank_branch_name: emp.branch_name != null ? String(emp.branch_name) : '',
      branch_address: emp.branch_address != null ? String(emp.branch_address) : '',
      ifsc_code: emp.ifsc_code != null ? String(emp.ifsc_code) : '',
      account_no: emp.account_no != null ? String(emp.account_no) : '',
      pan_no: emp.pan_no != null ? String(emp.pan_no) : '',
      id_card: emp.id_card != null ? String(emp.id_card) : '',
      pf: emp.pf != null ? String(emp.pf) : '',
      company_pf: emp.company_pf != null ? String(emp.company_pf) : '',
      esi: emp.esi != null ? String(emp.esi) : '',
      esi_dispensary: emp.esi_dispensary != null ? String(emp.esi_dispensary) : '',
      previous_member_id: emp.previous_member_id != null ? String(emp.previous_member_id) : '',
      lwf_code: emp.lwf_code != null ? String(emp.lwf_code) : '',
      wps_code: emp.wps_code != null ? String(emp.wps_code) : '',
      eps: emp.eps != null ? String(emp.eps) : 'N',
      international_worker: emp.international_worker != null ? String(emp.international_worker) : 'N',
      // Not shown for self-edit (unsupported / not part of New Rizo's editable set here), but
      // must round-trip unchanged — PUT nulls any emp_details column left out of the body.
      profile_pic: emp.profile_pic != null ? String(emp.profile_pic) : '',
      country: emp.country != null ? String(emp.country) : '',
      // Must be sent: the profile PUT writes every column, so omitting it blanked the nationality.
      nationality_id: emp.nationality_id != null ? String(emp.nationality_id) : '',
      locomotive: emp.locomotive != null ? String(emp.locomotive) : 'N',
      hearing: emp.hearing != null ? String(emp.hearing) : 'N',
      visual: emp.visual != null ? String(emp.visual) : 'N',
    });
    setEditing(true);
    setMsg('');
    setSaveError('');
  }
  function cancelEdit() { setEditing(false); setMsg(''); setSaveError(''); }
  function handleChange(e: { target: { name: string; value: string } }) {
    const { name, value } = e.target;
    setForm((f) => {
      const next = { ...f, [name]: value };
      if (name === 'international_worker' && value !== 'Y') next.country = '';
      if (name === 'physical_handicap' && value !== 'Y') {
        next.locomotive = 'N';
        next.hearing = 'N';
        next.visual = 'N';
      }
      return next;
    });
  }
  async function save() {
    if (!empId) return;
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`/api/employees/${empId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const resBody = await res.json();
      if (!res.ok) throw new Error(resBody.error || 'Failed to save');
      load();
      setEditing(false);
      setMsg('saved');
      setTimeout(() => setMsg(''), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
      setMsg('failed');
    } finally {
      setSaving(false);
    }
  }

  // Edit loads the row into the section's existing form; saving then PUTs over that same row.
  const str = (v: unknown) => (v == null ? '' : String(v));
  const pickOpt = (v: unknown, opts: readonly string[]) => opts.find((o) => o.toLowerCase() === str(v).toLowerCase()) ?? str(v);
  function startEditFamily(f: FamilyMember) {
    const r = f as unknown as Record<string, unknown>;
    setFamilyDraft({
      name: str(r.name), relation: pickOpt(r.relation, FAMILY_RELATIONS), gender: pickOpt(r.gender, ['Male', 'Female', 'Other']),
      DOB: str(r.DOB).slice(0, 10), blood_group: str(r.blood_group), nationality: str(r.nationality),
      contact_number: str(r.contact_number), alternate_number: str(r.alternate_number),
      is_nominee: str(r.is_nominee) || 'N', emergency_contact: str(r.emergency_contact) || 'N',
      remarks: str(r.remarks), // not on the form — carried so saving doesn't blank it
    } as typeof EMPTY_FAMILY);
    setFamilyErrors({});
    setEditingFamilyPkey(f.emp_family_pkey);
    setShowFamilyForm(true);
  }
  function startEditEducation(e: EducationRow) {
    const [from, to] = str(e.duration).split('-').map((x) => x.trim());
    setEducationDraft({ degree: str(e.degree), university: str(e.university), durationFrom: from ?? '', durationTo: to ?? '', marks: str(e.marks) });
    setEducationErrors({});
    setEditingEducationPkey(e.education_pkey);
    setShowEducationForm(true);
  }
  function startEditExperience(x: ExperienceRow) {
    const r = x as unknown as Record<string, unknown>;
    setExperienceDraft({
      company_name: str(r.company_name), designation: str(r.designation), department: str(r.department),
      from_date: str(r.from_date).slice(0, 10), to_date: str(r.to_date).slice(0, 10), salary: str(r.salary),
    });
    setExperienceErrors({});
    setEditingExperiencePkey(x.experience_pkey);
    setShowExperienceForm(true);
  }
  function startEditDoc(d: PersonalDoc) {
    const r = d as unknown as Record<string, unknown>;
    setDocDraft({
      document_type: str(r.document_type), document_number: str(r.document_number), name: str(r.name),
      relation: pickOpt(r.relation, FAMILY_RELATIONS), classification: pickOpt(r.classification, ['Male', 'Female', 'Other']),
      nationality: str(r.nationality), valid_from: str(r.valid_from).slice(0, 10), valid_till: str(r.valid_till).slice(0, 10),
      files: str(r.files),
    });
    setDocErrors({});
    setEditingDocPkey(d.emp_passport_visa_pkey);
    setShowDocForm(true);
  }
  // POST a new row, or PUT over the row being edited; throws the server's message on failure.
  async function saveRow(section: string, pkey: number | null, body: unknown) {
    const res = await fetch(`/api/employees/${empId}/${section}${pkey != null ? `/${pkey}` : ''}`, {
      method: pkey != null ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Could not save — please try again.');
  }

  async function addFamily() {
    const errors = {
      name: familyDraft.name.trim() ? '' : 'Name is required',
      relation: familyDraft.relation ? '' : 'Relation is required',
      gender: familyDraft.gender ? '' : 'Gender is required',
      DOB: familyDraft.DOB ? (futureDateError(familyDraft.DOB, 'Date of birth') || '') : 'Date of birth is required',
      contact_number: familyDraft.contact_number.trim()
        ? (mobileError(familyDraft.contact_number.trim()) || '')
        : 'Contact number is required',
    };
    setFamilyErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    setFamilySaving(true);
    try {
      await saveRow('family', editingFamilyPkey, familyDraft);
      setFamilyDraft(EMPTY_FAMILY);
      setFamilyErrors({});
      setShowFamilyForm(false);
      setEditingFamilyPkey(null);
      load();
    } catch (err) {
      setFamilyErrors({ save: err instanceof Error ? err.message : String(err) });
    } finally {
      setFamilySaving(false);
    }
  }
  async function deleteFamily(pkey: number) {
    await fetch(`/api/employees/${empId}/family/${pkey}`, { method: 'DELETE' });
    load();
  }

  async function addDocument() {
    const errors = {
      document_type: docDraft.document_type ? '' : 'Document type is required',
      document_number: docDraft.document_number.trim() ? (documentNumberError(docDraft.document_number) ?? '') : 'Document number is required',
      name: docDraft.name.trim() ? '' : 'Name on document is required',
      relation: docDraft.relation.trim() ? '' : 'Relation is required',
      classification: docDraft.classification ? '' : 'Gender is required',
      nationality: docDraft.nationality.trim() ? '' : 'Nationality is required',
      valid_from: docDraft.valid_from ? '' : 'Valid from date is required',
    };
    setDocErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    setDocSaving(true);
    try {
      await saveRow('documents', editingDocPkey, docDraft);
      setDocDraft(EMPTY_DOC);
      setDocErrors({});
      setShowDocForm(false);
      setEditingDocPkey(null);
      load();
    } catch (err) {
      setDocErrors({ save: err instanceof Error ? err.message : String(err) });
    } finally {
      setDocSaving(false);
    }
  }
  async function deleteDocument(pkey: number) {
    await fetch(`/api/employees/${empId}/documents/${pkey}`, { method: 'DELETE' });
    load();
  }

  async function addEducation() {
    const marksTrimmed = educationDraft.marks.trim();
    // Field allows typing a trailing "%" (the label just hints it, doesn't force it) — strip it
    // before parsing so "80%" validates the same as "80" instead of Number("80%") => NaN
    // rejecting the entry outright.
    const marksNum = Number(marksTrimmed.replace(/%\s*$/, ''));
    const errors = {
      degree: educationDraft.degree.trim() ? '' : 'Course is required',
      university: educationDraft.university.trim() ? '' : 'University is required',
      durationFrom: educationDraft.durationFrom ? '' : 'Start year is required',
      durationTo: !educationDraft.durationTo
        ? 'End year is required'
        : educationDraft.durationFrom && Number(educationDraft.durationTo) < Number(educationDraft.durationFrom)
          ? 'End year must be on or after start year'
          : '',
      marks: !marksTrimmed
        ? 'Marks is required'
        : Number.isNaN(marksNum) || marksNum < 0 || marksNum > 100
          ? 'Marks must be a percentage between 0 and 100'
          : '',
    };
    setEducationErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    setEducationSaving(true);
    try {
      // Legacy schema stores duration as one free-text string ("2025-2026") — compose it from the
      // two year dropdowns rather than adding a from/to column pair.
      const duration = `${educationDraft.durationFrom}-${educationDraft.durationTo}`;
      await saveRow('education', editingEducationPkey, { degree: educationDraft.degree, university: educationDraft.university, duration, marks: marksTrimmed });
      setEducationDraft(EMPTY_EDUCATION);
      setEducationErrors({});
      setShowEducationForm(false);
      setEditingEducationPkey(null);
      load();
    } catch (err) {
      setEducationErrors({ save: err instanceof Error ? err.message : String(err) });
    } finally {
      setEducationSaving(false);
    }
  }
  async function deleteEducation(pkey: number) {
    await fetch(`/api/employees/${empId}/education/${pkey}`, { method: 'DELETE' });
    load();
  }

  async function addExperience() {
    const errors = {
      company_name: experienceDraft.company_name.trim() ? '' : 'Company is required',
      designation: experienceDraft.designation.trim() ? '' : 'Designation is required',
      department: experienceDraft.department.trim() ? '' : 'Department is required',
      from_date: !experienceDraft.from_date
        ? 'From date is required'
        : (futureDateError(experienceDraft.from_date, 'From date') || ''),
      to_date: !experienceDraft.to_date
        ? 'To date is required'
        : (futureDateError(experienceDraft.to_date, 'To date')
          || (experienceDraft.from_date && experienceDraft.to_date < experienceDraft.from_date ? 'To date must be after from date' : '')),
      salary: experienceDraft.salary.trim() ? '' : 'Salary is required',
    };
    setExperienceErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    setExperienceSaving(true);
    try {
      await saveRow('experience', editingExperiencePkey, experienceDraft);
      setExperienceDraft(EMPTY_EXPERIENCE);
      setExperienceErrors({});
      setShowExperienceForm(false);
      setEditingExperiencePkey(null);
      load();
    } catch (err) {
      setExperienceErrors({ save: err instanceof Error ? err.message : String(err) });
    } finally {
      setExperienceSaving(false);
    }
  }
  async function deleteExperience(pkey: number) {
    await fetch(`/api/employees/${empId}/experience/${pkey}`, { method: 'DELETE' });
    load();
  }

  const timeline: TLItem[] = (() => {
    const items: TLItem[] = [];
    if (emp?.joining_date) {
      items.push({ kind: 'joining', date: String(emp.joining_date), title: emp.desig_name ? String(emp.desig_name) : 'Employee', sub: emp.dept_name != null ? String(emp.dept_name) : null, extra: `${tenureStr(emp.joining_date)} tenure` });
    }
    promotions.forEach((p) => items.push({ kind: 'promotion', date: p.approved_date || p.created_date, title: p.new_desig_name || '—', sub: p.remarks }));
    education.forEach((e) => {
      const yr = eduEndYear(e);
      items.push({ kind: 'education', date: yr ? `${yr}-06-01` : null, dateLabel: e.duration, title: e.degree || 'Degree', sub: e.university, extra: marksWithPercent(e.marks) });
    });
    experience.forEach((x) => items.push({
      // Ongoing roles (no To date) count as current, so they sort to the top with today's date.
      kind: 'experience', date: x.from_date, sortDate: x.to_date || new Date().toISOString().slice(0, 10), title: x.designation || 'Role', sub: x.company_name,
      extra: x.from_date ? `${fmtMY(x.from_date)} – ${x.to_date ? fmtMY(x.to_date) : 'Present'} · ${tenureStr(x.from_date, x.to_date)}` : null,
    }));
    // Newest first by when each milestone ended — sorting experience by its start date put a
    // 2024–2025 job below a degree that finished in 2024.
    const time = (i: TLItem) => { const d = i.sortDate ?? i.date; return d ? new Date(d).getTime() : 0; };
    return items.sort((a, b) => time(b) - time(a));
  })();

  if (loading) {
    return (
      <div style={{ padding: '24px 28px 40px' }}>
        <PageSkeleton title={false} body="detail" />
      </div>
    );
  }

  if (!emp) {
    return <div className="page-content"><div className="empty-state"><div className="empty-state-title">Profile not found</div></div></div>;
  }

  // The details panel is split into two pages the user flips between (Next » / « Back), with the
  // same page-turn animation as the Employee Join wizard. Editing and Save still cover both pages.
  const aboutPages = [
    <div key="p1">
                <Sec icon="👤" title="Personal" />
                {editing ? (
                  <G>
                    <EF label="First Name" name="first_name" form={form} onChange={handleChange} />
                    <EF label="Last Name" name="last_name" form={form} onChange={handleChange} />
                    <EF label="Date of Birth" name="date_of_birth" form={form} onChange={handleChange} type="date" max={MAX_DOB} />
                    <GenderSelect form={form} onChange={handleChange} />
                    <EF label="Blood Group" name="blood" form={form} onChange={handleChange} opts={BLOOD_OPTS} />
                    <EF label="Marital Status" name="maritual_status" form={form} onChange={handleChange} opts={MARITAL_OPTS} />
                    <IdSelect label="Nationality" name="nationality_id" form={form} onChange={handleChange} required
                      options={nationalities.map((n) => ({ v: String(n.id), l: n.nationality }))} />
                    <EF label="Guardian Name" name="guradian" form={form} onChange={handleChange} />
                    <EF label="Guardian Relation" name="relation_guardian" form={form} onChange={handleChange} />
                  </G>
                ) : (
                  <G>
                    <F label="Date of Birth" value={fmtDate(emp.date_of_birth)} />
                    <F label="Gender" value={emp.classification} />
                    <F label="Blood Group" value={emp.blood} />
                    <F label="Marital Status" value={emp.maritual_status} />
                    <F label="Nationality" value={emp.nationality_name} />
                    <F label="Guardian Name" value={emp.guradian} />
                    <F label="Guardian Relation" value={emp.relation_guardian} />
                  </G>
                )}

                <Sec icon="📞" title="Contact" />
                {editing ? (
                  <G>
                    <EF label="Mobile" name="mobile_no" form={form} onChange={handleChange} type="tel" />
                    <EF label="Email" name="email" form={form} onChange={handleChange} type="email" />
                    <EF label="City" name="district" form={form} onChange={handleChange} />
                    <EF label="State" name="state" form={form} onChange={handleChange} />
                    <EF label="Pincode" name="pincode" form={form} onChange={handleChange} />
                    <EF label="Address" name="address" form={form} onChange={handleChange} type="textarea" full />
                  </G>
                ) : (
                  <G>
                    <F label="Mobile" value={emp.mobile_no} />
                    <F label="Email" value={emp.email} />
                    <F label="City" value={emp.city} />
                    <F label="State" value={emp.state} />
                    <F label="Pincode" value={emp.pincode} />
                    <F label="Address" value={emp.address} full />
                  </G>
                )}

                <Sec icon="🏢" title="Official" />
                <G>
                  {/* Employee ID (emp_proff.emp_company_id) — what HR and the admin list use; defaults to the login ID. */}
                  <F label="Employee ID" value={emp.emp_company_id || emp.emp_id} />
                  <F label="Employee Type" value={emp.emp_type} />
                  <F label="Joining Date" value={fmtDate(emp.joining_date)} />
                  <F label="Probation (months)" value={emp.probation} />
                  <F label="Department" value={emp.dept_name} />
                  <F label="Designation" value={emp.desig_name} />
                  <F label="Grade" value={emp.grade_name} />
                  <F label="Branch" value={emp.emp_branch_name} />
                  <F label="Shift" value={emp.shift_name} />
                  <F label="Holiday Group" value={emp.holiday_group_name} />
                  <F label="Leave Policy Group" value={emp.leave_policy_group_name} />
                  <F label="Reporting To" value={emp.manager_first_name ? `${emp.manager_first_name} ${emp.manager_last_name || ''}`.trim() : null} />
                </G>
                {editing && (
                  <div style={{ marginTop: 10, padding: '9px 12px', background: 'rgba(30,81,110,0.05)', borderRadius: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                    Department, designation, grade, shift, branch and reporting structure are managed by HR.
                  </div>
                )}

                <Sec icon="🏦" title="Banking" />
                {editing ? (
                  <G>
                    <EF label="Bank Name" name="bank_name" form={form} onChange={handleChange} />
                    <EF label="Bank Branch" name="bank_branch_name" form={form} onChange={handleChange} />
                    <EF label="IFSC Code" name="ifsc_code" form={form} onChange={handleChange} />
                    <EF label="Account Number" name="account_no" form={form} onChange={handleChange} />
                  </G>
                ) : (
                  <G>
                    <F label="Bank Name" value={emp.bank_name} />
                    <F label="Bank Branch" value={emp.branch_name} />
                    <F label="IFSC Code" value={emp.ifsc_code} mono />
                    <F label="Account Number" value={emp.account_no} masked />
                  </G>
                )}

                <Sec icon="📋" title="Statutory & Identity" />
                {editing ? (
                  <G>
                    <EF label="PAN Number" name="pan_no" form={form} onChange={handleChange} />
                    <EF label="Aadhaar / ID Card" name="id_card" form={form} onChange={handleChange} />
                    <EF label="PF Number" name="pf" form={form} onChange={handleChange} />
                    <EF label="UAN Number" name="company_pf" form={form} onChange={handleChange} />
                    <EF label="ESI Number" name="esi" form={form} onChange={handleChange} />
                    <EF label="ESI Dispensary" name="esi_dispensary" form={form} onChange={handleChange} />
                    <EF label="Previous Member ID" name="previous_member_id" form={form} onChange={handleChange} />
                    <EF label="LWF Code" name="lwf_code" form={form} onChange={handleChange} />
                    <EF label="WPS Code" name="wps_code" form={form} onChange={handleChange} />
                    <EF label="EPS" name="eps" form={form} onChange={handleChange} type="checkbox" />
                    <EF label="International Worker" name="international_worker" form={form} onChange={handleChange} type="checkbox" />
                    {form.international_worker === 'Y' && (
                      <IdSelect label="Country of Origin" name="country" form={form} onChange={handleChange}
                        options={nationalities.map((n) => ({ v: String(n.id), l: n.country_name }))} />
                    )}
                    <EF label="Physically Challenged" name="physical_handicap" form={form} onChange={handleChange} type="checkbox" />
                    {form.physical_handicap === 'Y' && (
                      <>
                        <EF label="Locomotive Disability" name="locomotive" form={form} onChange={handleChange} type="checkbox" />
                        <EF label="Hearing Disability" name="hearing" form={form} onChange={handleChange} type="checkbox" />
                        <EF label="Visual Disability" name="visual" form={form} onChange={handleChange} type="checkbox" />
                      </>
                    )}
                  </G>
                ) : (
                  <G>
                    <F label="PAN Number" value={emp.pan_no} masked />
                    <F label="Aadhaar / ID Card" value={emp.id_card} masked />
                    <F label="PF Number" value={emp.pf} mono />
                    <F label="ESI Number" value={emp.esi} mono />
                    <F label="ESI Dispensary" value={emp.esi_dispensary} />
                    <F label="Previous Member ID" value={emp.previous_member_id} />
                    <F label="LWF Code" value={emp.lwf_code} />
                    <F label="WPS Code" value={emp.wps_code} />
                    {/* emp_details.company_pf actually stores the UAN number (see PUT /api/employees/[id]
                        and the join-onboarding "swapped per legacy quirk" comment) — not a Y/N flag. */}
                    <F label="UAN Number" value={emp.company_pf} mono />
                    <BoolF label="EPS" value={emp.eps} />
                    <BoolF label="International Worker" value={emp.international_worker} />
                    {isYes(emp.international_worker) && <F label="Country of Origin" value={emp.country_name} />}
                    <BoolF label="Physically Challenged" value={emp.physical_handicap} />
                    {isYes(emp.physical_handicap) && (
                      <>
                        <BoolF label="Locomotive Disability" value={emp.locomotive} />
                        <BoolF label="Hearing Disability" value={emp.hearing} />
                        <BoolF label="Visual Disability" value={emp.visual} />
                      </>
                    )}
                  </G>
                )}
    </div>,
    <div key="p2">
                {(family.length > 0 || editing) && (
                  <>
                    <Sec icon="👨‍👩‍👧" title="Family" />
                    {editing ? (
                      <div>
                        {family.filter((f) => !(showFamilyForm && f.emp_family_pkey === editingFamilyPkey)).map((f) => (
                          <div key={f.emp_family_pkey} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-page)', marginBottom: 6 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{f.name}</div>
                              <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                                {f.relation && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: `${relColor(f.relation)}15`, color: relColor(f.relation) }}>{f.relation}</span>}
                                {f.DOB && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>🎂 {fmtDate(f.DOB)}</span>}
                              </div>
                            </div>
                            <button onClick={() => startEditFamily(f)} title="Edit" style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#1E516E', flexShrink: 0 }}>✏️</button>
                            <button onClick={() => deleteFamily(f.emp_family_pkey)} title="Delete" style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-page)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#dc2626', flexShrink: 0 }}>🗑️</button>
                          </div>
                        ))}
                        {showFamilyForm ? (
                          <div style={{ padding: '12px 14px', background: 'rgba(30,81,110,0.04)', borderRadius: 10, marginBottom: 8, border: '1.5px dashed rgba(30,81,110,0.3)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px 12px' }}>
                              <EF label="Full Name" name="name" form={familyDraft} onChange={(e) => setFamilyDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} required />
                              <EF label="Relation" name="relation" form={familyDraft} onChange={(e) => setFamilyDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} opts={FAMILY_RELATIONS} required />
                              <EF label="Date of Birth" name="DOB" form={familyDraft} onChange={(e) => setFamilyDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} type="date" max={TODAY} required />
                              <EF label="Gender" name="gender" form={familyDraft} onChange={(e) => setFamilyDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} opts={['Male', 'Female', 'Other']} required />
                              <EF label="Blood Group" name="blood_group" form={familyDraft} onChange={(e) => setFamilyDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} opts={BLOOD_OPTS} />
                              <IdSelect label="Nationality" name="nationality" form={familyDraft} onChange={(e) => setFamilyDraft((d) => ({ ...d, [e.target.name]: e.target.value }))}
                                options={nationalities.map((n) => ({ v: n.nationality, l: n.country_name }))} />
                              <EF label="Contact Number" name="contact_number" form={familyDraft} onChange={(e) => setFamilyDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} type="tel" required />
                              <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingTop: 18 }}>
                                <EF name="is_nominee" form={familyDraft} onChange={(e) => setFamilyDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} type="checkbox" label="Nominee" />
                                <EF name="emergency_contact" form={familyDraft} onChange={(e) => setFamilyDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} type="checkbox" label="Emergency Contact" />
                              </div>
                            </div>
                            {Object.values(familyErrors).some(Boolean) && (
                              <div style={{ marginTop: 8, fontSize: 11, color: '#dc2626' }}>{Object.values(familyErrors).find(Boolean)}</div>
                            )}
                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                              <button onClick={addFamily} disabled={familySaving} style={{ padding: '5px 14px', background: '#1E516E', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{familySaving ? 'Saving…' : editingFamilyPkey != null ? 'Update' : 'Add'}</button>
                              <button onClick={() => { setShowFamilyForm(false); setFamilyErrors({}); setEditingFamilyPkey(null); setFamilyDraft(EMPTY_FAMILY); }} style={{ padding: '5px 12px', border: '1.5px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => { setEditingFamilyPkey(null); setFamilyDraft(EMPTY_FAMILY); setShowFamilyForm(true); }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: '1.5px dashed rgba(30,81,110,0.35)', borderRadius: 8, background: 'transparent', color: '#1E516E', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
                            + Add Family Member
                          </button>
                        )}
                      </div>
                    ) : (
                      <FamilyTree family={family} emp={emp} />
                    )}
                  </>
                )}

                {(education.length > 0 || editing) && (
                  <>
                    <Sec icon="🎓" title="Education" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {education.filter((e) => !(showEducationForm && e.education_pkey === editingEducationPkey)).map((e) => (
                        <div key={e.education_pkey} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-page)' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{e.degree}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{e.university} · {e.duration} · {marksWithPercent(e.marks)}</div>
                          </div>
                          {editing && <button onClick={() => startEditEducation(e)} title="Edit" style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#1E516E', flexShrink: 0 }}>✏️</button>}
                          {editing && (
                            <button onClick={() => deleteEducation(e.education_pkey)} title="Delete" style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#dc2626', flexShrink: 0 }}>🗑️</button>
                          )}
                        </div>
                      ))}
                      {editing && (showEducationForm ? (
                        <div style={{ padding: '12px 14px', background: 'rgba(30,81,110,0.04)', borderRadius: 10, border: '1.5px dashed rgba(30,81,110,0.3)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px 12px' }}>
                            <EF label="Course" name="degree" form={educationDraft} onChange={(e) => setEducationDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} cols={2} required />
                            <EF label="University" name="university" form={educationDraft} onChange={(e) => setEducationDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} cols={2} required />
                            <EF label="Start Year" name="durationFrom" form={educationDraft} onChange={(e) => setEducationDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} opts={YEAR_OPTIONS} required />
                            <EF label="End Year" name="durationTo" form={educationDraft} onChange={(e) => setEducationDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} opts={YEAR_OPTIONS} required />
                            <EF
                              label="Mark (%)" name="marks" type="text" form={educationDraft}
                              onChange={(e) => setEducationDraft((d) => ({ ...d, marks: e.target.value }))}
                              required
                            />
                          </div>
                          {Object.values(educationErrors).some(Boolean) && (
                            <div style={{ marginTop: 8, fontSize: 11, color: '#dc2626' }}>{Object.values(educationErrors).find(Boolean)}</div>
                          )}
                          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button onClick={addEducation} disabled={educationSaving} style={{ padding: '5px 14px', background: '#1E516E', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{educationSaving ? 'Saving…' : editingEducationPkey != null ? 'Update' : 'Add'}</button>
                            <button onClick={() => { setShowEducationForm(false); setEducationErrors({}); setEditingEducationPkey(null); setEducationDraft(EMPTY_EDUCATION); }} style={{ padding: '5px 12px', border: '1.5px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingEducationPkey(null); setEducationDraft(EMPTY_EDUCATION); setShowEducationForm(true); }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: '1.5px dashed rgba(30,81,110,0.35)', borderRadius: 8, background: 'transparent', color: '#1E516E', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
                          + Add Education
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {(experience.length > 0 || editing) && (
                  <>
                    <Sec icon="💼" title="Work Experience" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {experience.filter((x) => !(showExperienceForm && x.experience_pkey === editingExperiencePkey)).map((x) => (
                        <div key={x.experience_pkey} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-page)' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{x.designation} · {x.company_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{x.department} · {fmtDate(x.from_date)} – {x.to_date ? fmtDate(x.to_date) : 'Present'}</div>
                          </div>
                          {editing && <button onClick={() => startEditExperience(x)} title="Edit" style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#1E516E', flexShrink: 0 }}>✏️</button>}
                          {editing && (
                            <button onClick={() => deleteExperience(x.experience_pkey)} title="Delete" style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#dc2626', flexShrink: 0 }}>🗑️</button>
                          )}
                        </div>
                      ))}
                      {editing && (showExperienceForm ? (
                        <div style={{ padding: '12px 14px', background: 'rgba(30,81,110,0.04)', borderRadius: 10, border: '1.5px dashed rgba(30,81,110,0.3)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px 12px' }}>
                            <EF label="Company" name="company_name" form={experienceDraft} onChange={(e) => setExperienceDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} cols={2} required />
                            <EF label="Designation" name="designation" form={experienceDraft} onChange={(e) => setExperienceDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} cols={2} required />
                            <EF label="Department" name="department" form={experienceDraft} onChange={(e) => setExperienceDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} cols={2} required />
                            <EF label="Salary" name="salary" form={experienceDraft} onChange={(e) => setExperienceDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} cols={2} required />
                            <EF label="From" name="from_date" form={experienceDraft} onChange={(e) => setExperienceDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} type="date" cols={2} max={TODAY} required />
                            <EF label="To" name="to_date" form={experienceDraft} onChange={(e) => setExperienceDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} type="date" cols={2} max={TODAY} required />
                          </div>
                          {Object.values(experienceErrors).some(Boolean) && (
                            <div style={{ marginTop: 8, fontSize: 11, color: '#dc2626' }}>{Object.values(experienceErrors).find(Boolean)}</div>
                          )}
                          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button onClick={addExperience} disabled={experienceSaving} style={{ padding: '5px 14px', background: '#1E516E', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{experienceSaving ? 'Saving…' : editingExperiencePkey != null ? 'Update' : 'Add'}</button>
                            <button onClick={() => { setShowExperienceForm(false); setExperienceErrors({}); setEditingExperiencePkey(null); setExperienceDraft(EMPTY_EXPERIENCE); }} style={{ padding: '5px 12px', border: '1.5px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingExperiencePkey(null); setExperienceDraft(EMPTY_EXPERIENCE); setShowExperienceForm(true); }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: '1.5px dashed rgba(30,81,110,0.35)', borderRadius: 8, background: 'transparent', color: '#1E516E', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
                          + Add Experience
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {(documents.length > 0 || editing) && (
                  <>
                    <Sec icon="📄" title="Personal Documents" />
                    <FilePreviewModal url={previewDoc?.url ?? null} title={previewDoc?.title} onClose={() => setPreviewDoc(null)} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {documents.filter((d) => !(showDocForm && d.emp_passport_visa_pkey === editingDocPkey)).map((d) => {
                        const st = docStatus(d.valid_till);
                        const stStyle = {
                          valid: { bg: '#f0fdf4', c: '#16a34a', label: 'Valid' },
                          expiring: { bg: '#fffbeb', c: '#b45309', label: 'Expiring Soon' },
                          expired: { bg: '#fef2f2', c: '#dc2626', label: 'Expired' },
                          'no-expiry': { bg: 'var(--bg-page)', c: 'var(--text-muted)', label: 'No Expiry' },
                        }[st];
                        return (
                          <div key={d.emp_passport_visa_pkey} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--bg-page)', border: `1px solid ${st === 'expired' ? '#fecaca' : st === 'expiring' ? '#fde68a' : 'var(--border)'}` }}>
                            <div style={{ width: 36, height: 36, borderRadius: 9, background: stStyle.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📄</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{d.document_type}</div>
                              {(d.name || d.relation) && (
                                <div style={{ fontSize: 12, color: 'var(--text-secondary, var(--text-primary))', marginTop: 2 }}>
                                  {d.name}{d.name && d.relation ? ' · ' : ''}{d.relation}
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                                {/* Masked like PAN/Aadhaar above — only the last 4 characters are shown. */}
                                {d.document_number && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{mask(d.document_number)}</span>}
                                {d.valid_from && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>From {fmtDate(d.valid_from)}</span>}
                                {d.valid_till && <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 20, background: stStyle.bg, color: stStyle.c }}>{stStyle.label} · {fmtDate(d.valid_till)}</span>}
                                {d.files && (
                                  <button
                                    type="button"
                                    onClick={() => setPreviewDoc({ url: String(d.files), title: d.document_type })}
                                    style={{ fontSize: 11, fontWeight: 700, color: '#1E516E', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                                  >
                                    View Attachment
                                  </button>
                                )}
                              </div>
                            </div>
                            {editing && <button onClick={() => startEditDoc(d)} title="Edit" style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#1E516E', flexShrink: 0 }}>✏️</button>}
                            {editing && (
                              <button onClick={() => deleteDocument(d.emp_passport_visa_pkey)} title="Delete" style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#dc2626', flexShrink: 0 }}>🗑️</button>
                            )}
                          </div>
                        );
                      })}
                      {editing && (showDocForm ? (
                        <div style={{ padding: '12px 14px', background: 'rgba(30,81,110,0.04)', borderRadius: 10, border: '1.5px dashed rgba(30,81,110,0.3)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px 12px' }}>
                            <EF label="Document Type" name="document_type" form={docDraft} onChange={(e) => setDocDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} opts={DOCUMENT_TYPES} cols={2} required />
                            <EF label="Document Number" name="document_number" form={docDraft} onChange={(e) => setDocDraft((d) => ({ ...d, document_number: onlyAlphanumeric(e.target.value) }))} cols={2} required />
                            <EF label="Name on Document" name="name" form={docDraft} onChange={(e) => setDocDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} cols={2} required />
                            <EF label="Relation" name="relation" form={docDraft} onChange={(e) => setDocDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} opts={FAMILY_RELATIONS} cols={2} required />
                            <EF label="Valid From" name="valid_from" form={docDraft} onChange={(e) => setDocDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} type="date" required />
                            <EF label="Valid Till" name="valid_till" form={docDraft} onChange={(e) => setDocDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} type="date" />
                            <EF label="Gender" name="classification" form={docDraft} onChange={(e) => setDocDraft((d) => ({ ...d, [e.target.name]: e.target.value }))} opts={['Male', 'Female', 'Other']} required />
                            <IdSelect label="Nationality" name="nationality" form={docDraft} onChange={(e) => setDocDraft((d) => ({ ...d, [e.target.name]: e.target.value }))}
                              options={nationalities.map((n) => ({ v: n.nationality, l: n.country_name }))} required />
                          </div>
                          <div style={{ marginTop: 10 }}>
                            <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>Document Attachment</label>
                            <DocumentUploadField value={docDraft.files} onChange={(path) => setDocDraft((d) => ({ ...d, files: path }))} />
                          </div>
                          {Object.values(docErrors).some(Boolean) && (
                            <div style={{ marginTop: 8, fontSize: 11, color: '#dc2626' }}>{Object.values(docErrors).find(Boolean)}</div>
                          )}
                          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button onClick={addDocument} disabled={docSaving} style={{ padding: '5px 14px', background: '#1E516E', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{docSaving ? 'Saving…' : editingDocPkey != null ? 'Update' : 'Add'}</button>
                            <button onClick={() => { setShowDocForm(false); setDocErrors({}); setEditingDocPkey(null); setDocDraft(EMPTY_DOC); }} style={{ padding: '5px 12px', border: '1.5px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingDocPkey(null); setDocDraft(EMPTY_DOC); setShowDocForm(true); }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: '1.5px dashed rgba(30,81,110,0.35)', borderRadius: 8, background: 'transparent', color: '#1E516E', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
                          + Add Document
                        </button>
                      ))}
                    </div>
                  </>
                )}
      {!editing && family.length === 0 && education.length === 0 && experience.length === 0 && documents.length === 0 && (
        <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No family, education, experience or documents added yet.</div>
      )}
    </div>,
  ];

  return (
    <div className="page-content">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 310px', gap: 22, alignItems: 'start' }}>

        {/* LEFT */}
        <div>
          {/* Profile hero */}
          <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, overflow: 'hidden', marginBottom: 20, position: 'relative' }}>
            <div style={{ background: 'linear-gradient(135deg, #0c1f2c 0%, #1E516E 55%, #2d7fb8 100%)', height: 130, position: 'relative' }}>
              <div style={{ position: 'absolute', top: -20, right: -20, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
              <div style={{ position: 'absolute', top: 20, right: 80, width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
              {/* Self-edit is only offered while HR has ticked "Editable" on this record (the API enforces it too). */}
              {!editing && !(Number(emp.editable) > 0) && (
                <span title="Editing is locked. Ask HR to enable editing." style={{ position: 'absolute', top: 14, right: 16, width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🔒</span>
              )}
              {!editing && Number(emp.editable) > 0 && (
                <button onClick={startEdit} title="Edit profile" style={{ position: 'absolute', top: 14, right: 16, width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.35)', color: '#fff', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✏️</button>
              )}
              {editing && (
                <div style={{ position: 'absolute', top: 14, right: 16, display: 'flex', gap: 7, alignItems: 'center' }}>
                  {msg && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: msg === 'failed' ? '#fef2f2' : '#f0fdf4', color: msg === 'failed' ? '#dc2626' : '#16a34a' }}>{msg === 'failed' ? `❌ ${saveError || 'Error'}` : '✅ Saved'}</span>}
                  <button onClick={cancelEdit} style={{ padding: '5px 12px', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 7, background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={save} disabled={saving} style={{ padding: '5px 16px', background: '#fff', color: '#1E516E', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
              )}
            </div>
            <div style={{
              position: 'absolute', top: 82, left: 28, width: 96, height: 96, borderRadius: '50%',
              background: 'linear-gradient(135deg, #0c3349 0%, #1E516E 50%, #2d7fb8 100%)',
              border: '5px solid var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 30, fontWeight: 900, color: '#fff', boxShadow: '0 8px 28px rgba(30,81,110,0.38)', zIndex: 2, letterSpacing: '-1px',
            }}>
              {photoUrl(emp.profile_pic)
                // eslint-disable-next-line @next/next/no-img-element -- user-uploaded photo URL
                ? <img src={photoUrl(emp.profile_pic)!} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                : initials(emp.first_name, emp.last_name)}
            </div>
            <div style={{ padding: '14px 24px 20px 140px', minHeight: 72 }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1.15, letterSpacing: '-0.4px' }}>
                {emp.first_name} {emp.last_name}
              </div>
              {emp.desig_name && <div style={{ fontSize: 13, fontWeight: 700, color: '#1E516E', marginTop: 3 }}>{emp.desig_name}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                {emp.dept_name && <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'var(--border)', color: 'var(--text-muted)' }}>{emp.dept_name}</span>}
                {emp.emp_branch_name && <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'var(--border)', color: 'var(--text-muted)' }}>📍 {emp.emp_branch_name}</span>}
                {(emp.emp_company_id || emp.emp_id) && <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'var(--border)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{emp.emp_company_id || emp.emp_id}</span>}
              </div>
            </div>
          </div>

          {/* Content panel */}
          <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, padding: '16px 20px', marginBottom: 20 }}>
            {/* Header strip: which page is showing + the Next » / « Back arrow (page-turn like Employee Join). */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{ABOUT_PAGES[aboutPageUI]}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>{aboutPageUI + 1} / {ABOUT_PAGES.length}</span>
              </div>
              {aboutPageUI === 0 ? (
                <button onClick={() => turnAboutPage(1)} disabled={!!aboutTurn} style={PAGE_BTN} title="Next page" aria-label="Next page">»</button>
              ) : (
                <button onClick={() => turnAboutPage(0)} disabled={!!aboutTurn} style={PAGE_BTN} title="Previous page" aria-label="Previous page">«</button>
              )}
            </div>
            <div
              ref={aboutPanelRef}
              className={aboutTurn ? 'page-turn-container' : undefined}
              style={aboutTurn ? { position: 'relative', overflow: 'hidden', height: aboutTurnHeight ?? undefined } : undefined}
            >
              {aboutTurn ? (
                <>
                  <div className={`page-turn-layer ${aboutTurn.dir === 'forward' ? 'page-turn-out-forward' : 'page-turn-out-back'}`} style={{ position: 'absolute', inset: 0, background: 'var(--bg-card)', zIndex: 2 }}>
                    {aboutPages[aboutTurn.from]}
                  </div>
                  <div className={`page-turn-layer ${aboutTurn.dir === 'forward' ? 'page-turn-in-forward' : 'page-turn-in-back'}`} style={{ position: 'absolute', inset: 0, background: 'var(--bg-card)', zIndex: 1 }}>
                    {aboutPages[aboutTurn.to]}
                  </div>
                </>
              ) : (
                aboutPages[aboutPage]
              )}
            </div>


          </div>
        </div>

        {/* RIGHT — Career Journey */}
        <div style={{ position: 'sticky', top: 24 }}>
          <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg, #0c1f2c, #1E516E)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>🗺️</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 900, color: '#fff' }}>Career Journey</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 1 }}>Most recent · {timeline.length} milestones</div>
              </div>
            </div>
            <div style={{ padding: '16px 16px 8px', maxHeight: 500, overflowY: 'auto' }}>
              {timeline.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: 26, opacity: 0.3, marginBottom: 6 }}>🗺️</div>
                  <div style={{ fontSize: 12 }}>No milestones yet</div>
                </div>
              ) : timeline.map((item, i) => {
                const cfg = TL_CFG[item.kind];
                const isLast = i === timeline.length - 1;
                return (
                  <div key={i} style={{ display: 'flex', gap: 11, position: 'relative', paddingBottom: isLast ? 0 : 20 }}>
                    {!isLast && <div style={{ position: 'absolute', left: 16, top: 36, bottom: 0, width: 2, background: `linear-gradient(to bottom, ${cfg.color}40, transparent)` }} />}
                    <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: cfg.bg, border: `2px solid ${cfg.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, position: 'relative', zIndex: 1 }}>{cfg.icon}</div>
                    <div style={{ flex: 1, paddingTop: 1 }}>
                      <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.7px', color: cfg.color, marginBottom: 1 }}>{cfg.label}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3 }}>{item.title}</div>
                      {item.sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{item.sub}</div>}
                      <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                        {item.date && <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: cfg.bg, color: cfg.color }}>{item.dateLabel ?? fmtDate(item.date)}</span>}
                        {item.extra && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{item.extra}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {emp.joining_date && (
              <div style={{ borderTop: '1px solid var(--border)', display: 'flex' }}>
                {[
                  { label: 'Tenure', value: tenureStr(emp.joining_date) },
                  { label: 'Promotions', value: promotions.length },
                  { label: 'Milestones', value: timeline.length },
                ].map((s, i, a) => (
                  <div key={i} style={{ flex: 1, padding: '9px 0', textAlign: 'center', borderRight: i < a.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: '#1E516E' }}>{s.value}</div>
                    <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)', fontWeight: 700, marginTop: 1 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
