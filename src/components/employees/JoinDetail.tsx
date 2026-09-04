'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSetupRows } from '@/lib/setupOptions';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AvatarUpload } from '@/components/ui/AvatarUpload';
import { RepeatableRows } from '@/components/employees/RepeatableRows';
import { DocumentUploadField } from '@/components/employees/DocumentUploadField';
import { dobError, mobileError, aadhaarError } from '@/lib/validation';

interface JoinDetailData {
  join: Record<string, string>;
  documents: Record<string, unknown>[];
  education: Record<string, unknown>[];
  experience: Record<string, unknown>[];
  family: Record<string, unknown>[];
}

interface NationalityOption { id: number; nationality: string; country_name: string }

const DATE_KEYS = new Set(['date_of_birth']);

const DOCUMENT_TYPES = ['Aadhaar', 'PAN', 'Passport', 'Driving License', 'Voter ID', 'Educational Certificate', 'Offer Letter', 'Relieving Letter', 'Other'];

const PAGE_TURN_MS = 620;

// Seed for "New Join" (create) mode — the full set of columns POST /api/employees/join
// accepts. Y/N flags default to 'N'. Matches the former NewJoinForm's EMPTY_FORM.
const EMPTY_FORM: Record<string, string> = {
  first_name: '', last_name: '', date_of_birth: '', email: '', mobile_no: '', address: '',
  id_card: '', pincode: '', district: '', state: '', blood: '', maritual_status: '',
  guradian: '', relation_guardian: '', classification: '', nationality_id: '', country_origin: '',
  bank: '', bank_branch: '', ifsc_code: '', account_no: '', pf: '', company_pf: '', previous_member_id: '',
  esi_dispensary: '', esi: '', eps: 'N', pan_no: '', international_worker: 'N', locomotive: 'N',
  hearing: 'N', visual: 'N', physical_handicap: 'N', wps_code: '', lwf_code: '', profile_image_url: '',
};

const STEPS = [
  { key: 'personal', label: 'Personal', title: 'Personal Details', subtitle: 'Basic personal information about the employee.', accent: 'var(--color-primary)', accentSoft: 'var(--color-primary-soft)' },
  { key: 'statutory', label: 'Statutory', title: 'Statutory Details', subtitle: 'PF, ESI, tax and compliance information.', accent: 'var(--color-accent)', accentSoft: 'var(--color-accent-soft)' },
  { key: 'bank', label: 'Bank', title: 'Bank Details', subtitle: 'Employee banking and payment information.', accent: 'var(--color-success)', accentSoft: 'var(--color-success-soft)' },
  { key: 'additional', label: 'Additional', title: 'Additional Details', subtitle: 'Documents, education, experience and family information.', accent: 'var(--color-highlight-dark)', accentSoft: 'var(--color-highlight-light)' },
] as const;

const INPUT_CLASS = 'w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-[#0F172A] bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/40 focus:border-[color:var(--color-primary)]/40 transition-colors duration-[180ms]';
const ERROR_INPUT_CLASS = 'border-[color:var(--color-danger)] focus:ring-[color:var(--color-danger)]/25 focus:border-[color:var(--color-danger)]';
const LABEL_CLASS = 'block text-[13.5px] font-medium text-slate-600 mb-2';

function toFormState(join: Record<string, string>): Record<string, string> {
  const form: Record<string, string> = { ...join };
  for (const key of DATE_KEYS) {
    if (form[key]) form[key] = String(form[key]).slice(0, 10);
  }
  return form;
}

interface JoinDetailProps {
  /** Existing join record id. Omit for "New Join" (create) mode. */
  id?: string;
  /** Called when the user wants to leave this view (navigate back or close a modal). */
  onBack: () => void;
  /** Set to false to hide the "Back" link, e.g. when a modal already provides a close control. */
  showBackLink?: boolean;
  /** Reports whether there are unsaved changes, so a host modal can guard against closing. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Called once the final step has been saved successfully. Defaults to onBack. */
  onFinished?: () => void;
  /** Create mode only: called with the new record's id after step 1 is saved. */
  onCreated?: (empJoinPkey: number) => void;
}

export function JoinDetail({ id, onBack, showBackLink = true, onDirtyChange, onFinished, onCreated }: JoinDetailProps) {
  const queryClient = useQueryClient();
  const [createdId, setCreatedId] = useState<number | null>(null);
  const effectiveId = id ?? (createdId != null ? String(createdId) : undefined);
  const isCreate = !effectiveId;

  const [form, setForm] = useState<Record<string, string>>(() => (id ? {} : { ...EMPTY_FORM }));
  const [savedSnapshot, setSavedSnapshot] = useState(() => (id ? '' : JSON.stringify({ ...EMPTY_FORM })));
  const [formError, setFormError] = useState('');
  const [docFile, setDocFile] = useState('');
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [transitioning, setTransitioning] = useState<{ from: number; to: number; direction: 'forward' | 'back' } | null>(null);
  const [transitionHeight, setTransitionHeight] = useState<number | null>(null);
  const stepRef = useRef<HTMLDivElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const transitionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Seed `form` from the server exactly once per record. Without this, the refetch that
  // every "Save & Continue" triggers would clobber edits made on a later step.
  const seeded = useRef(false);
  // True while the `id` prop is catching up to an id we just created ourselves — that
  // transition must NOT re-seed the form (it holds the values we just submitted).
  const justCreated = useRef(false);

  useEffect(() => {
    return () => {
      if (transitionTimeout.current) clearTimeout(transitionTimeout.current);
    };
  }, []);

  const { data, isLoading, isError } = useQuery<JoinDetailData>({
    queryKey: ['employees/join', effectiveId],
    enabled: !!effectiveId,
    queryFn: async () => {
      const res = await fetch(`/api/employees/join/${effectiveId}`);
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load join record');
      return res.json();
    },
  });

  const { data: nationalities = [] } = useSetupRows<NationalityOption>('setup/nationalities');

  // Switching to a different existing record (host changed `id`) should allow a fresh seed;
  // the create -> edit transition of our own new record should not.
  useEffect(() => {
    if (justCreated.current) {
      justCreated.current = false;
      return;
    }
    seeded.current = false;
  }, [id]);

  useEffect(() => {
    if (data?.join && !seeded.current) {
      seeded.current = true;
      const initial = toFormState(data.join);
      setForm(initial);
      setSavedSnapshot(JSON.stringify(initial));
    }
  }, [data]);

  const isDirty = savedSnapshot !== '' && JSON.stringify(form) !== savedSnapshot;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    const el = stepRef.current?.querySelector<HTMLElement>('input, select, textarea, button');
    el?.focus();
  }, [step]);

  const createJoin = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/employees/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to create join record');
      return res.json() as Promise<{ emp_join_pkey: number }>;
    },
  });

  const savePersonal = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/employees/join/${effectiveId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees/join'] }),
  });

  const pending = isCreate ? createJoin.isPending : savePersonal.isPending;

  function f(key: string) {
    return {
      value: form[key] ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm((prev) => ({ ...prev, [key]: e.target.value })),
    };
  }

  function checkbox(key: string, label: string) {
    return (
      <label key={key} className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={form[key] === 'Y'}
          onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.checked ? 'Y' : 'N' }))}
          className="accent-[color:var(--color-primary)]"
        />
        {label}
      </label>
    );
  }

  function addChild(type: 'documents' | 'education' | 'experience' | 'family') {
    return async (values: Record<string, string>) => {
      if (!effectiveId) return;
      await fetch(`/api/employees/join/${effectiveId}/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(type === 'documents' ? { ...values, files: docFile } : values),
      });
      if (type === 'documents') setDocFile('');
      queryClient.invalidateQueries({ queryKey: ['employees/join', effectiveId] });
    };
  }

  function removeChild(type: 'documents' | 'education' | 'experience' | 'family') {
    return async (rowId: number) => {
      if (!effectiveId) return;
      await fetch(`/api/employees/join/${effectiveId}/${type}/${rowId}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['employees/join', effectiveId] });
    };
  }

  function goToStep(target: number) {
    if (target === step) return;
    const dir: 'forward' | 'back' = target > step ? 'forward' : 'back';
    if (contentWrapperRef.current) {
      setTransitionHeight(contentWrapperRef.current.getBoundingClientRect().height);
    }
    setTransitioning({ from: step, to: target, direction: dir });
    if (transitionTimeout.current) clearTimeout(transitionTimeout.current);
    transitionTimeout.current = setTimeout(() => {
      setStep(target);
      setTransitioning(null);
      setTransitionHeight(null);
    }, PAGE_TURN_MS);
  }

  function validateStep0(): boolean {
    const errors = {
      date_of_birth: dobError(form.date_of_birth ?? '') ?? '',
      mobile_no: mobileError(form.mobile_no ?? '') ?? '',
      id_card: aadhaarError(form.id_card ?? '') ?? '',
      classification: form.classification ? '' : 'Gender is required',
    };
    if (errors.date_of_birth || errors.mobile_no || errors.id_card || errors.classification) {
      setFieldErrors(errors);
      return false;
    }
    setFieldErrors({});
    return true;
  }

  async function persist(): Promise<boolean> {
    setFormError('');
    try {
      if (isCreate) {
        const { emp_join_pkey } = await createJoin.mutateAsync();
        justCreated.current = true;
        seeded.current = true; // we already hold the just-submitted values
        setCreatedId(emp_join_pkey);
        onCreated?.(emp_join_pkey);
        queryClient.invalidateQueries({ queryKey: ['employees/join'] });
      } else {
        await savePersonal.mutateAsync();
      }
      setSavedSnapshot(JSON.stringify(form));
      setCompleted((prev) => new Set(prev).add(step));
      return true;
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function saveAndContinue() {
    if (step === 0 && !validateStep0()) return;
    if (await persist() && step < STEPS.length - 1) goToStep(step + 1);
  }

  async function finish() {
    if (step === 0 && !validateStep0()) return;
    if (await persist()) (onFinished ?? onBack)();
  }

  function FieldError({ children }: { children?: string }) {
    if (!children) return null;
    return <p className="text-xs text-[color:var(--color-danger)] mt-1.5">{children}</p>;
  }

  if (effectiveId && isError) {
    return (
      <div className="text-sm">
        <p className="text-red-600 mb-3">Couldn&apos;t load this join record. It may have been removed, or you may need to sign in again.</p>
        <button onClick={onBack} className="text-indigo-600 hover:text-indigo-800 font-medium">
          Back to Employee Join
        </button>
      </div>
    );
  }
  // Only block on the fetch when there is nothing to show yet (pure edit, first load).
  // After the create -> edit handoff the form is already populated, so skip the flash.
  if (!isCreate && effectiveId && (isLoading || !data) && Object.keys(form).length === 0) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;
  const embedded = !showBackLink;
  const activeStepForUI = transitioning ? transitioning.to : step;

  const documents = data?.documents ?? [];
  const education = data?.education ?? [];
  const experience = data?.experience ?? [];
  const family = data?.family ?? [];

  const headerName = `${form.first_name ?? ''} ${form.last_name ?? ''}`.trim() || (isCreate ? 'New Joiner' : '');

  function renderStepFields(idx: number) {
    if (idx === 0) {
      return (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <div>
              <label className={LABEL_CLASS}>First Name</label>
              <input className={INPUT_CLASS} {...f('first_name')} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Last Name</label>
              <input className={INPUT_CLASS} {...f('last_name')} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Date of Birth</label>
              <input
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                className={cn(INPUT_CLASS, fieldErrors.date_of_birth && ERROR_INPUT_CLASS)}
                {...f('date_of_birth')}
              />
              <FieldError>{fieldErrors.date_of_birth}</FieldError>
            </div>
            <div>
              <label className={LABEL_CLASS}>Gender <span className="text-[color:var(--color-danger)]">*</span></label>
              <select className={cn(INPUT_CLASS, fieldErrors.classification && ERROR_INPUT_CLASS)} {...f('classification')}>
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="others">Other</option>
              </select>
              <FieldError>{fieldErrors.classification}</FieldError>
            </div>
            <div>
              <label className={LABEL_CLASS}>Mobile</label>
              <input
                type="tel"
                maxLength={10}
                className={cn(INPUT_CLASS, fieldErrors.mobile_no && ERROR_INPUT_CLASS)}
                {...f('mobile_no')}
              />
              <FieldError>{fieldErrors.mobile_no}</FieldError>
            </div>
            <div>
              <label className={LABEL_CLASS}>Email</label>
              <input type="email" className={INPUT_CLASS} {...f('email')} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Aadhaar / ID Card</label>
              <input
                maxLength={12}
                className={cn(INPUT_CLASS, fieldErrors.id_card && ERROR_INPUT_CLASS)}
                {...f('id_card')}
              />
              <FieldError>{fieldErrors.id_card}</FieldError>
            </div>
            <div>
              <label className={LABEL_CLASS}>Blood Group</label>
              <select className={INPUT_CLASS} {...f('blood')}>
                <option value="">Select blood group</option>
                {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => (
                  <option key={bg} value={bg}>{bg}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS}>Marital Status</label>
              <select className={INPUT_CLASS} {...f('maritual_status')}>
                <option value="">Select status</option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Divorced">Divorced</option>
                <option value="Widowed">Widowed</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS}>Nationality</label>
              <select className={INPUT_CLASS} {...f('nationality_id')}>
                <option value="">Select nationality</option>
                {nationalities.map((n) => <option key={n.id} value={n.id}>{n.country_name}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS}>Country of Origin</label>
              <select className={INPUT_CLASS} {...f('country_origin')}>
                <option value="">Select country</option>
                {nationalities.map((n) => <option key={n.id} value={n.id}>{n.country_name}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS}>Guardian Name</label>
              <input className={INPUT_CLASS} {...f('guradian')} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Relation to Guardian</label>
              <input className={INPUT_CLASS} {...f('relation_guardian')} />
            </div>
          </div>
          <div className="mt-5">
            <label className={LABEL_CLASS}>Address</label>
            <textarea className={INPUT_CLASS} rows={2} value={form.address ?? ''} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5 mt-5">
            <div>
              <label className={LABEL_CLASS}>District</label>
              <input className={INPUT_CLASS} {...f('district')} />
            </div>
            <div>
              <label className={LABEL_CLASS}>State</label>
              <input className={INPUT_CLASS} {...f('state')} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Pincode</label>
              <input className={INPUT_CLASS} {...f('pincode')} />
            </div>
          </div>
        </div>
      );
    }

    if (idx === 1) {
      return (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <div>
              <label className={LABEL_CLASS}>PAN Number</label>
              <input className={INPUT_CLASS} {...f('pan_no')} placeholder="ABCDE1234D" />
            </div>
            <div>
              <label className={LABEL_CLASS}>PF Number</label>
              <input className={INPUT_CLASS} {...f('pf')} />
            </div>
            <div>
              <label className={LABEL_CLASS}>UAN (Company PF)</label>
              <input className={INPUT_CLASS} {...f('company_pf')} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Previous PF Member ID</label>
              <input className={INPUT_CLASS} {...f('previous_member_id')} />
            </div>
            <div>
              <label className={LABEL_CLASS}>ESIC Number</label>
              <input className={INPUT_CLASS} {...f('esi')} />
            </div>
            <div>
              <label className={LABEL_CLASS}>ESI Dispensary</label>
              <input className={INPUT_CLASS} {...f('esi_dispensary')} />
            </div>
            <div>
              <label className={LABEL_CLASS}>LWF Code</label>
              <input className={INPUT_CLASS} {...f('lwf_code')} />
            </div>
            <div>
              <label className={LABEL_CLASS}>WPS Code</label>
              <input className={INPUT_CLASS} {...f('wps_code')} />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-5">
            {checkbox('eps', 'EPS Eligibility')}
            {checkbox('international_worker', 'International Worker')}
            {checkbox('physical_handicap', 'Physical Handicap')}
            {checkbox('locomotive', 'Locomotive Disability')}
            {checkbox('hearing', 'Hearing Disability')}
            {checkbox('visual', 'Visual Disability')}
          </div>
        </div>
      );
    }

    if (idx === 2) {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
          <div>
            <label className={LABEL_CLASS}>Bank Name</label>
            <input className={INPUT_CLASS} {...f('bank')} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Bank Branch</label>
            <input className={INPUT_CLASS} {...f('bank_branch')} />
          </div>
          <div>
            <label className={LABEL_CLASS}>IFSC Code</label>
            <input className={INPUT_CLASS} {...f('ifsc_code')} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Account Number</label>
            <input className={INPUT_CLASS} {...f('account_no')} />
          </div>
        </div>
      );
    }

    if (isCreate) {
      return (
        <p className="text-sm text-slate-500">
          Save the previous steps first — documents, education, experience and family can be added once the record exists.
        </p>
      );
    }

    return (
      <div className="space-y-8">
        <section>
          <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Documents</h3>
          <div className="mb-3 max-w-sm">
            <label className={LABEL_CLASS}>Upload file (attach before adding a row below)</label>
            <DocumentUploadField value={docFile} onChange={setDocFile} />
          </div>
          <RepeatableRows
            pkeyField="emp_doc_pkey"
            rows={documents}
            addLabel="Add document"
            onAdd={addChild('documents')}
            onRemove={removeChild('documents')}
            fields={[
              { key: 'document_type', label: 'Type', type: 'select', options: DOCUMENT_TYPES.map((d) => ({ value: d, label: d })) },
              { key: 'document_number', label: 'Number' },
              { key: 'name', label: 'Name on Document' },
              { key: 'relation', label: 'Relation' },
              { key: 'nationality', label: 'Nationality' },
              { key: 'valid_from', label: 'Valid From', type: 'date' },
              { key: 'valid_till', label: 'Valid Till', type: 'date' },
            ]}
          />
        </section>

        <section>
          <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Education</h3>
          <RepeatableRows
            pkeyField="education_pkey"
            rows={education}
            addLabel="Add education"
            onAdd={addChild('education')}
            onRemove={removeChild('education')}
            fields={[
              { key: 'course', label: 'Course' },
              { key: 'university', label: 'University' },
              { key: 'duration', label: 'Duration' },
              { key: 'mark', label: 'Marks' },
            ]}
          />
        </section>

        <section>
          <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Work Experience</h3>
          <RepeatableRows
            pkeyField="experience_pkey"
            rows={experience}
            addLabel="Add experience"
            onAdd={addChild('experience')}
            onRemove={removeChild('experience')}
            fields={[
              { key: 'company', label: 'Company' },
              { key: 'designation', label: 'Designation' },
              { key: 'department', label: 'Department' },
              { key: 'from_date', label: 'From', type: 'date' },
              { key: 'to_date', label: 'To', type: 'date' },
              { key: 'salary', label: 'Salary', type: 'number' },
            ]}
          />
        </section>

        <section>
          <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Family</h3>
          <RepeatableRows
            pkeyField="emp_family_pkey"
            rows={family}
            addLabel="Add family member"
            onAdd={addChild('family')}
            onRemove={removeChild('family')}
            fields={[
              { key: 'name', label: 'Name' },
              { key: 'relation', label: 'Relation' },
              { key: 'gender', label: 'Gender' },
              { key: 'DOB', label: 'Date of Birth', type: 'date' },
              { key: 'nationality', label: 'Nationality' },
              { key: 'contact_number', label: 'Contact Number' },
            ]}
          />
        </section>
      </div>
    );
  }

  function renderStepContent(idx: number) {
    const s = STEPS[idx];
    return (
      <div>
        <h2 className="font-heading text-[20px] font-bold text-[#0F172A] tracking-tight">{s.title}</h2>
        <p className="text-[13.5px] text-slate-500 mt-1 mb-6">{s.subtitle}</p>
        {renderStepFields(idx)}
      </div>
    );
  }

  const turnGlow = transitioning ? STEPS[transitioning.to].accent : undefined;

  return (
    <div className={cn('flex flex-col -m-6', embedded && 'max-h-[calc(90vh-3rem)]')}>
      {/* Sticky header + stepper */}
      <div className="flex-shrink-0 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-6 pt-6 pb-4 rounded-t-2xl">
        {showBackLink && (
          <button
            onClick={onBack}
            className="text-sm text-slate-500 hover:text-slate-800 mb-3 transition-colors duration-[180ms]"
          >
            ← Back
          </button>
        )}
        <div className="flex items-center gap-3 pr-14">
          <AvatarUpload
            name={headerName || 'New Joiner'}
            imageUrl={form.profile_image_url || data?.join.profile_image_url}
            onUploaded={(path) => setForm((prev) => ({ ...prev, profile_image_url: path }))}
            className="w-10 h-10 flex-shrink-0"
          />
          <div className="min-w-0">
            <h1 className="font-heading text-[20px] font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              {headerName || 'New Joiner'}
            </h1>
            <p className="text-[13px] text-slate-500 mt-0.5">{isCreate ? 'New employee join' : 'Employee onboarding'}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 mt-5 overflow-x-auto scroll-fade">
          {STEPS.map((s, i) => {
            const isCompleted = completed.has(i);
            const isActive = i === activeStepForUI;
            const clickable = isCompleted || isActive;
            return (
              <div key={s.key} className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && goToStep(i)}
                  style={isActive ? { backgroundColor: s.accentSoft, color: s.accent } : undefined}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors duration-[220ms]',
                    !isActive && (isCompleted
                      ? 'text-[color:var(--color-success)] hover:bg-[color:var(--color-success)]/10 cursor-pointer'
                      : 'text-slate-400 cursor-default')
                  )}
                >
                  <span
                    style={isActive && !isCompleted ? { backgroundColor: s.accent } : undefined}
                    className={cn(
                      'w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0 transition-colors duration-[220ms]',
                      isCompleted
                        ? 'bg-[color:var(--color-success)] text-white'
                        : isActive
                          ? 'text-white'
                          : 'bg-slate-200 text-slate-500'
                    )}
                  >
                    {isCompleted ? <Check className="w-2.5 h-2.5" strokeWidth={3} /> : i + 1}
                  </span>
                  {s.label}
                </button>
                {i < STEPS.length - 1 && <span className="w-4 h-px bg-slate-200 flex-shrink-0" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step content — a document that "turns pages" between sections */}
      <div
        ref={contentWrapperRef}
        className={cn(
          'relative',
          transitioning ? 'overflow-hidden page-turn-container' : 'flex-1 overflow-y-auto scroll-fade'
        )}
        style={{
          ...(transitioning && transitionHeight ? { height: transitionHeight } : undefined),
          ...(turnGlow ? ({ '--turn-glow': turnGlow } as React.CSSProperties) : undefined),
        }}
      >
        {transitioning ? (
          <>
            <div
              className={cn(
                'absolute inset-0 overflow-y-auto scroll-fade px-6 py-6 bg-white page-turn-layer',
                transitioning.direction === 'forward' ? 'page-turn-out-forward' : 'page-turn-out-back'
              )}
              style={{ zIndex: 2 }}
            >
              {renderStepContent(transitioning.from)}
            </div>
            <div
              className={cn(
                'absolute inset-0 overflow-y-auto scroll-fade px-6 py-6 bg-white page-turn-layer',
                transitioning.direction === 'forward' ? 'page-turn-in-forward' : 'page-turn-in-back'
              )}
              style={{ zIndex: 1 }}
            >
              {renderStepContent(transitioning.to)}
            </div>
          </>
        ) : (
          <div key={step} ref={stepRef} className="px-6 py-6">
            {renderStepContent(step)}
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-slate-100 bg-white/95 backdrop-blur-sm rounded-b-2xl">
        {formError && <p className="text-xs text-[color:var(--color-danger)] mb-2">{formError}</p>}
        <div className="flex items-center justify-between gap-2">
          {isFirst ? (
            <button
              onClick={onBack}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors duration-[180ms]"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={() => goToStep(step - 1)}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors duration-[180ms]"
            >
              ← Back
            </button>
          )}

          {isLast ? (
            <button
              onClick={finish}
              disabled={pending}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-[color:var(--color-primary)] hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100 text-white shadow-lg shadow-[color:var(--color-primary)]/20 transition-all duration-[180ms]"
            >
              {pending ? 'Saving…' : 'Done'}
            </button>
          ) : (
            <button
              onClick={saveAndContinue}
              disabled={pending}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-[color:var(--color-primary)] hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100 text-white shadow-lg shadow-[color:var(--color-primary)]/20 transition-all duration-[180ms]"
            >
              {pending ? 'Saving…' : 'Save & Continue →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
