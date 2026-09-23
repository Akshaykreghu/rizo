'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSetupOptions, useSetupRows } from '@/lib/setupOptions';
import { Check, GraduationCap, History, Users, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AvatarUpload } from '@/components/ui/AvatarUpload';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { CollapsibleSection, SectionHeading } from '@/components/ui/CollapsibleSection';
import { RepeatableRows } from '@/components/employees/RepeatableRows';
import { DocumentUploadField } from '@/components/employees/DocumentUploadField';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { EMP_TYPES } from '@/lib/employeeOptions';
import {
  dobError, mobileError, aadhaarError, panError, esiError, uanError, lwfError,
  accountNoError, pfNumberError, pincodeError,
} from '@/lib/validation';

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

const PKEY_FIELD: Record<'documents' | 'education' | 'experience' | 'family', string> = {
  documents: 'emp_doc_pkey', education: 'education_pkey', experience: 'experience_pkey', family: 'emp_family_pkey',
};

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

// Seed for the "Onboarding" tab — a separate state slice from `form` above since it's saved
// through a different endpoint (POST .../onboard, a one-time promotion) with different
// semantics than the emp_join draft PUT. Matches the former OnboardForm's EMPTY_FORM.
const EMPTY_ONBOARD_FORM = {
  emp_company_id: '', password: '',
  joining_date: '', emp_branch: '', emp_dept: '', designation: '', emp_grade: '',
  emp_type: '', attr1: '', probation: '', notice_days: '',
  day_time_seq: '', holiday_group_id: '', leavepolicy_group_id: '',
};

// Three tabs matching the legacy Employee Join screen (setup.ctp Tab1+2 + onboarding.ctp
// Tab3) and the same grouping used by the Employee Details port.
const STEPS = [
  { key: 'personal-info', label: 'Personal Info', title: 'Personal Info', subtitle: 'Personal, statutory and bank details.', accent: 'var(--color-primary)', accentSoft: 'var(--color-primary-soft)' },
  { key: 'other-details', label: 'Other Details', title: 'Other Details', subtitle: 'Documents, education, experience and family information.', accent: 'var(--color-accent)', accentSoft: 'var(--color-accent-soft)' },
  { key: 'onboarding', label: 'Onboarding', title: 'Onboarding', subtitle: 'Login access, company information and policies & rules.', accent: 'var(--color-success)', accentSoft: 'var(--color-success-soft)' },
] as const;

const GATED_MESSAGE = 'Save the previous step first — this tab is available once the record exists.';

// Matches lib/validation.ts's dobError (18-years-minimum) check — caps the calendar itself at
// that same boundary instead of only rejecting an underage pick after submit.
const MAX_DOB = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
})();

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
  /** Create mode only: called with the new record's id after step 1 is saved. */
  onCreated?: (empJoinPkey: number) => void;
  /** Called with the new employee's emp_pkey once the Onboarding tab completes the real
   *  promotion (emp_join -> emp_details/emp_proff/user_credentials). This is the wizard's
   *  only "done" state — there's no separate "finished without onboarding" outcome. */
  onOnboarded?: (empPkey: number) => void;
  /** Opens the wizard on a given tab index instead of 0 — used by "Continue Onboarding". */
  initialStep?: number;
  /** False hides the Onboarding tab entirely, capping the wizard at Other Details — used for
   *  "New Join", where creating the login is a separate, later action (via "Continue Onboarding"
   *  from the Employee Join hub) rather than part of the initial create flow. Default true. */
  includeOnboarding?: boolean;
}

export function JoinDetail({ id, onBack, showBackLink = true, onDirtyChange, onCreated, onOnboarded, initialStep, includeOnboarding = true }: JoinDetailProps) {
  const queryClient = useQueryClient();
  const [createdId, setCreatedId] = useState<number | null>(null);
  const effectiveId = id ?? (createdId != null ? String(createdId) : undefined);
  const isCreate = !effectiveId;

  const [form, setForm] = useState<Record<string, string>>(() => (id ? {} : { ...EMPTY_FORM }));
  const [savedSnapshot, setSavedSnapshot] = useState(() => (id ? '' : JSON.stringify({ ...EMPTY_FORM })));
  const [onboardForm, setOnboardForm] = useState({ ...EMPTY_ONBOARD_FORM });
  const [onboardFieldErrors, setOnboardFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [docFile, setDocFile] = useState('');
  const [step, setStep] = useState(initialStep ?? 0);
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
  const { data: branches = [] } = useSetupOptions('setup/branches', 'branch_code', 'branch_name');
  const { data: departments = [] } = useSetupOptions('setup/departments', 'dept_code', 'dept_name');
  const { data: designations = [] } = useSetupOptions('setup/designations', 'desig_code', 'desig_name');
  const { data: grades = [] } = useSetupOptions('setup/grades', 'grade_code', 'grade_name');
  const { data: noticePeriods = [] } = useSetupOptions('setup/notice-periods', 'notice_days', 'description');
  const { data: shifts = [] } = useSetupOptions('setup/shifts', 'day_time_seq', 'day_time_desc');
  const { data: holidayGroups = [] } = useSetupOptions('setup/holiday-groups', 'HOLIDAY_GROUP_ID', 'HOLIDAY_GROUP_NAME');
  const { data: leavePolicyGroups = [] } = useSetupOptions('setup/leavepolicy-groups', 'LEAVEPOLICY_GROUP_ID', 'LEAVEPOLICY_GROUP_NAME');

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

  // The Onboarding tab's "Done" completes the real promotion (emp_join -> emp_details/
  // emp_proff/user_credentials) via the existing, unchanged POST .../onboard route — a
  // fundamentally different action from the draft PUT the other two tabs use.
  const onboardMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/employees/join/${effectiveId}/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(onboardForm),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to onboard employee');
      return res.json() as Promise<{ emp_pkey: number }>;
    },
  });

  const steps = includeOnboarding ? STEPS : STEPS.slice(0, 2);
  const isOnboardingStep = includeOnboarding && step === STEPS.length - 1;
  const pending = isOnboardingStep ? onboardMutation.isPending : (isCreate ? createJoin.isPending : savePersonal.isPending);

  // Single source of truth for both live (on-type) and step-submit validation, so the two never
  // drift apart — legacy's setup.ctp runs the same per-field regex on 'keyup blur', not just when
  // Save & Continue is clicked (liveValidate()), which is what these fields were missing before.
  const fieldValidators: Record<string, (v: string) => string> = {
    first_name: (v) => v.trim() ? '' : 'First name is required',
    date_of_birth: (v) => v ? (dobError(v) ?? '') : 'Date of birth is required',
    mobile_no: (v) => mobileError(v) ?? '',
    id_card: (v) => v ? (aadhaarError(v) ?? '') : 'Aadhaar / ID Card is required',
    classification: (v) => v ? '' : 'Gender is required',
    nationality_id: (v) => v ? '' : 'Nationality is required',
    pincode: (v) => pincodeError(v) ?? '',
    pan_no: (v) => panError(v) ?? '',
    pf: (v) => pfNumberError(v) ?? '',
    company_pf: (v) => uanError(v) ?? '',
    esi: (v) => esiError(v) ?? '',
    lwf_code: (v) => lwfError(v) ?? '',
    account_no: (v) => accountNoError(v) ?? '',
  };

  function updateField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    const validator = fieldValidators[key];
    if (validator) setFieldErrors((prev) => ({ ...prev, [key]: validator(value) }));
  }

  function f(key: string) {
    return {
      value: form[key] ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => updateField(key, e.target.value),
    };
  }

  function updateOnboardField(key: keyof typeof EMPTY_ONBOARD_FORM, value: string) {
    setOnboardForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'password') {
      setOnboardFieldErrors((prev) => ({ ...prev, [key]: value.trim() ? '' : prev[key] }));
    }
  }

  function fOnboard(key: keyof typeof EMPTY_ONBOARD_FORM) {
    return {
      value: onboardForm[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => updateOnboardField(key, e.target.value),
    };
  }

  // Matches legacy's toggleCountryField()/toggleDisabilityTypes(): unchecking the parent
  // clears its dependent fields too, so a stale value can't get submitted once its own
  // control is hidden or disabled again.
  function checkbox(key: string, label: string) {
    return (
      <label key={key} className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={form[key] === 'Y'}
          onChange={(e) => {
            const checked = e.target.checked;
            setForm((prev) => {
              const next = { ...prev, [key]: checked ? 'Y' : 'N' };
              if (key === 'international_worker' && !checked) next.country_origin = '';
              if (key === 'physical_handicap' && !checked) {
                next.locomotive = 'N';
                next.hearing = 'N';
                next.visual = 'N';
              }
              return next;
            });
          }}
          className="accent-[color:var(--color-primary)]"
        />
        {label}
      </label>
    );
  }

  function addChild(type: 'documents' | 'education' | 'experience' | 'family') {
    return async (values: Record<string, string>) => {
      if (!effectiveId) return;
      const res = await fetch(`/api/employees/join/${effectiveId}/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(type === 'documents' ? { ...values, files: docFile } : values),
      });
      if (type === 'documents') setDocFile('');
      if (!res.ok) return;
      const created = await res.json() as Record<string, number>;
      // Patch the cache directly rather than invalidate/refetch — right after "New Join" creates
      // the record, the query's very first fetch for this effectiveId can still be in flight when
      // a row is added, and a refetch just dedupes against that in-flight (already-stale) request,
      // so the newly-added row silently didn't show until the user left and came back. The POST
      // response already has everything needed to build the row locally, with no race possible.
      queryClient.setQueryData<JoinDetailData>(['employees/join', effectiveId], (old) =>
        old ? { ...old, [type]: [...old[type], { ...values, ...created }] } : old
      );
    };
  }

  function removeChild(type: 'documents' | 'education' | 'experience' | 'family') {
    return async (rowId: number) => {
      if (!effectiveId) return;
      const res = await fetch(`/api/employees/join/${effectiveId}/${type}/${rowId}`, { method: 'DELETE' });
      if (!res.ok) return;
      const pkeyField = PKEY_FIELD[type];
      queryClient.setQueryData<JoinDetailData>(['employees/join', effectiveId], (old) =>
        old ? { ...old, [type]: old[type].filter((r) => Number(r[pkeyField]) !== rowId) } : old
      );
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

  function validateFields(keys: string[]): boolean {
    const errors = Object.fromEntries(keys.map((k) => [k, fieldValidators[k](form[k] ?? '')]));
    if (Object.values(errors).some(Boolean)) {
      setFieldErrors((prev) => ({ ...prev, ...errors }));
      return false;
    }
    setFieldErrors((prev) => {
      const next = { ...prev };
      keys.forEach((k) => delete next[k]);
      return next;
    });
    return true;
  }

  function validatePersonalInfoStep(): boolean {
    return validateFields([
      'first_name', 'date_of_birth', 'mobile_no', 'id_card', 'classification', 'nationality_id', 'pincode',
      'pan_no', 'pf', 'company_pf', 'esi', 'lwf_code', 'account_no',
    ]);
  }

  function validateOnboardingStep(): boolean {
    const errors = {
      password: onboardForm.password.trim() ? '' : 'Password is required',
    };
    setOnboardFieldErrors(errors);
    return !Object.values(errors).some(Boolean);
  }

  function validateStep(idx: number): boolean {
    if (idx === 0) return validatePersonalInfoStep();
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
    if (!validateStep(step)) return;
    if (await persist() && step < steps.length - 1) goToStep(step + 1);
  }

  // The Onboarding tab is the wizard's only "done" state — completing it promotes the draft
  // into a real employee (see onboardMutation above), it doesn't just save the draft.
  async function finish() {
    if (!validateOnboardingStep()) return;
    setFormError('');
    try {
      const { emp_pkey } = await onboardMutation.mutateAsync();
      onOnboarded?.(emp_pkey);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  // Reached when Other Details is the last VISIBLE step (includeOnboarding=false, e.g. "New
  // Join") — everything is already saved (persist() below, plus each Other Details row already
  // saves itself on add), so this just confirms the save and leaves the wizard; onboarding is a
  // separate, later action via "Continue Onboarding" on the Employee Join hub.
  async function finishWithoutOnboarding() {
    if (await persist()) onBack();
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
  const isLast = step === steps.length - 1;
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
        <div className="space-y-8">
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              <div>
                <label className={LABEL_CLASS}>First Name <span className="text-[color:var(--color-danger)]">*</span></label>
                <input className={cn(INPUT_CLASS, fieldErrors.first_name && ERROR_INPUT_CLASS)} {...f('first_name')} />
                <FieldError>{fieldErrors.first_name}</FieldError>
              </div>
              <div>
                <label className={LABEL_CLASS}>Last Name</label>
                <input className={INPUT_CLASS} {...f('last_name')} />
              </div>
              <div>
                <label className={LABEL_CLASS}>Date of Birth <span className="text-[color:var(--color-danger)]">*</span></label>
                <input
                  type="date"
                  max={MAX_DOB}
                  className={cn(INPUT_CLASS, fieldErrors.date_of_birth && ERROR_INPUT_CLASS)}
                  {...f('date_of_birth')}
                />
                <FieldError>{fieldErrors.date_of_birth}</FieldError>
              </div>
              <div>
                <label className={LABEL_CLASS}>Gender <span className="text-[color:var(--color-danger)]">*</span></label>
                <SearchableSelect
                  value={form.classification ?? ''}
                  onChange={(v) => updateField('classification', v)}
                  options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'others', label: 'Other' }]}
                  placeholder="Select gender"
                  buttonClassName={cn(INPUT_CLASS, fieldErrors.classification && ERROR_INPUT_CLASS)}
                />
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
                <label className={LABEL_CLASS}>Aadhaar / ID Card <span className="text-[color:var(--color-danger)]">*</span></label>
                <input
                  maxLength={12}
                  className={cn(INPUT_CLASS, fieldErrors.id_card && ERROR_INPUT_CLASS)}
                  {...f('id_card')}
                />
                <FieldError>{fieldErrors.id_card}</FieldError>
              </div>
              <div>
                <label className={LABEL_CLASS}>Blood Group</label>
                <SearchableSelect
                  value={form.blood ?? ''}
                  onChange={(v) => updateField('blood', v)}
                  options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => ({ value: bg, label: bg }))}
                  placeholder="Select blood group"
                  buttonClassName={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Marital Status</label>
                <SearchableSelect
                  value={form.maritual_status ?? ''}
                  onChange={(v) => updateField('maritual_status', v)}
                  options={['Single', 'Married', 'Divorced', 'Widowed'].map((s) => ({ value: s, label: s }))}
                  placeholder="Select status"
                  buttonClassName={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Nationality <span className="text-[color:var(--color-danger)]">*</span></label>
                <SearchableSelect
                  value={form.nationality_id ?? ''}
                  onChange={(v) => updateField('nationality_id', v)}
                  options={nationalities.map((n) => ({ value: String(n.id), label: n.country_name }))}
                  placeholder="Select nationality"
                  buttonClassName={cn(INPUT_CLASS, fieldErrors.nationality_id && ERROR_INPUT_CLASS)}
                />
                <FieldError>{fieldErrors.nationality_id}</FieldError>
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
                <input
                  maxLength={6}
                  className={cn(INPUT_CLASS, fieldErrors.pincode && ERROR_INPUT_CLASS)}
                  {...f('pincode')}
                />
                <FieldError>{fieldErrors.pincode}</FieldError>
              </div>
            </div>
          </div>

          <div>
            <SectionHeading>Statutory Details</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              <div>
                <label className={LABEL_CLASS}>PAN Number</label>
                <input
                  maxLength={10}
                  className={cn(INPUT_CLASS, fieldErrors.pan_no && ERROR_INPUT_CLASS)}
                  {...f('pan_no')}
                  onChange={(e) => updateField('pan_no', e.target.value.toUpperCase())}
                  placeholder="ABCDE1234D"
                />
                <FieldError>{fieldErrors.pan_no}</FieldError>
              </div>
              <div>
                <label className={LABEL_CLASS}>PF Number</label>
                <input
                  maxLength={22}
                  className={cn(INPUT_CLASS, fieldErrors.pf && ERROR_INPUT_CLASS)}
                  {...f('pf')}
                />
                <FieldError>{fieldErrors.pf}</FieldError>
              </div>
              <div>
                <label className={LABEL_CLASS}>UAN No</label>
                <input
                  maxLength={12}
                  className={cn(INPUT_CLASS, fieldErrors.company_pf && ERROR_INPUT_CLASS)}
                  {...f('company_pf')}
                />
                <FieldError>{fieldErrors.company_pf}</FieldError>
              </div>
              <div>
                <label className={LABEL_CLASS}>Previous PF Member ID</label>
                <input maxLength={15} className={INPUT_CLASS} {...f('previous_member_id')} />
              </div>
              <div>
                <label className={LABEL_CLASS}>ESI Number</label>
                <input
                  maxLength={10}
                  className={cn(INPUT_CLASS, fieldErrors.esi && ERROR_INPUT_CLASS)}
                  {...f('esi')}
                />
                <FieldError>{fieldErrors.esi}</FieldError>
              </div>
              <div>
                <label className={LABEL_CLASS}>ESI Dispensary</label>
                <input className={INPUT_CLASS} {...f('esi_dispensary')} />
              </div>
              <div>
                <label className={LABEL_CLASS}>LWF Code</label>
                <input
                  maxLength={15}
                  className={cn(INPUT_CLASS, fieldErrors.lwf_code && ERROR_INPUT_CLASS)}
                  {...f('lwf_code')}
                  onChange={(e) => updateField('lwf_code', e.target.value.toUpperCase())}
                />
                <FieldError>{fieldErrors.lwf_code}</FieldError>
              </div>
              <div>
                <label className={LABEL_CLASS}>WPS Code</label>
                <input maxLength={15} className={INPUT_CLASS} {...f('wps_code')} />
              </div>
            </div>
            <div className="flex items-center gap-6 mt-5 flex-wrap">
              <div className="flex items-center gap-3">
                {checkbox('international_worker', 'International Worker')}
                <SearchableSelect
                  value={form.country_origin ?? ''}
                  onChange={(v) => updateField('country_origin', v)}
                  options={nationalities.map((n) => ({ value: String(n.id), label: n.country_name }))}
                  placeholder="Country of origin"
                  buttonClassName={cn(INPUT_CLASS, 'w-44 py-1.5 shrink-0')}
                  disabled={form.international_worker !== 'Y'}
                />
              </div>
              {checkbox('physical_handicap', 'Physical Handicap')}
              {checkbox('eps', 'EPS Eligibility')}
            </div>
            {form.physical_handicap === 'Y' && (
              <div className="flex flex-wrap gap-4 mt-4 pl-1">
                {checkbox('locomotive', 'Locomotive Disability')}
                {checkbox('hearing', 'Hearing Disability')}
                {checkbox('visual', 'Visual Disability')}
              </div>
            )}
          </div>

          <div>
            <SectionHeading>Bank Details</SectionHeading>
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
                <input maxLength={12} className={INPUT_CLASS} {...f('ifsc_code')} />
              </div>
              <div>
                <label className={LABEL_CLASS}>Account Number</label>
                <input
                  maxLength={18}
                  className={cn(INPUT_CLASS, fieldErrors.account_no && ERROR_INPUT_CLASS)}
                  {...f('account_no')}
                />
                <FieldError>{fieldErrors.account_no}</FieldError>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (idx === 1) {
      if (isCreate) {
        return <p className="text-sm text-slate-500">{GATED_MESSAGE}</p>;
      }
      return (
        <div className="space-y-4">
          <CollapsibleSection title="Education" icon={GraduationCap}>
            <RepeatableRows
              pkeyField="education_pkey"
              rows={education}
              addLabel="Add education"
              onAdd={addChild('education')}
              onRemove={removeChild('education')}
              fields={[
                { key: 'course', label: 'Course', required: true },
                { key: 'university', label: 'University', required: true },
                { key: 'duration', label: 'Duration', required: true },
                { key: 'mark', label: 'Marks', required: true },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Work Experience" icon={History}>
            <RepeatableRows
              pkeyField="experience_pkey"
              rows={experience}
              addLabel="Add experience"
              onAdd={addChild('experience')}
              onRemove={removeChild('experience')}
              fields={[
                { key: 'company', label: 'Company', required: true },
                { key: 'designation', label: 'Designation', required: true },
                { key: 'department', label: 'Department', required: true },
                { key: 'from_date', label: 'From', type: 'date', required: true },
                { key: 'to_date', label: 'To', type: 'date', required: true },
                { key: 'salary', label: 'Salary', type: 'number', required: true },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Family" icon={Users}>
            <RepeatableRows
              pkeyField="emp_family_pkey"
              rows={family}
              addLabel="Add family member"
              onAdd={addChild('family')}
              onRemove={removeChild('family')}
              fields={[
                { key: 'name', label: 'Name', required: true },
                { key: 'relation', label: 'Relation', required: true },
                { key: 'gender', label: 'Gender', required: true },
                { key: 'DOB', label: 'Date of Birth', type: 'date', required: true },
                { key: 'nationality', label: 'Nationality' },
                { key: 'contact_number', label: 'Contact Number', required: true },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Documents" icon={FileText}>
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
                { key: 'document_type', label: 'Type', type: 'select', options: DOCUMENT_TYPES.map((d) => ({ value: d, label: d })), required: true },
                { key: 'document_number', label: 'Number', required: true },
                { key: 'name', label: 'Name on Document', required: true },
                { key: 'relation', label: 'Relation', required: true },
                { key: 'nationality', label: 'Nationality' },
                { key: 'valid_from', label: 'Valid From', type: 'date', required: true },
                { key: 'valid_till', label: 'Valid Till', type: 'date' },
              ]}
            />
          </CollapsibleSection>
        </div>
      );
    }

    // idx === 2: Onboarding — only reachable once the draft exists (mirrors legacy's own
    // Tab-3-empty-until-saved behavior, not a bug to fix).
    if (isCreate) {
      return <p className="text-sm text-slate-500">{GATED_MESSAGE}</p>;
    }
    return (
      <div className="space-y-8">
        <div>
          <SectionHeading>Identity &amp; Login</SectionHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <div>
              <label className={LABEL_CLASS}>Employee ID</label>
              <input className={INPUT_CLASS} {...fOnboard('emp_company_id')} placeholder="Leave blank if no ID" />
            </div>
            <div>
              <label className={LABEL_CLASS}>Initial Password <span className="text-[color:var(--color-danger)]">*</span></label>
              <input
                type="password"
                autoComplete="new-password"
                className={cn(INPUT_CLASS, onboardFieldErrors.password && ERROR_INPUT_CLASS)}
                {...fOnboard('password')}
              />
              <FieldError>{onboardFieldErrors.password}</FieldError>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            The login username is generated automatically from the company code and employee ID once onboarding completes.
          </p>
        </div>

        <div>
          <SectionHeading>Company Information</SectionHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <div>
              <label className={LABEL_CLASS}>Joining Date</label>
              <input type="date" className={INPUT_CLASS} {...fOnboard('joining_date')} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Employment Type</label>
              <SearchableSelect
                value={onboardForm.emp_type}
                onChange={(v) => updateOnboardField('emp_type', v)}
                options={EMP_TYPES.map((t) => ({ value: t, label: t }))}
                placeholder="Select type"
                buttonClassName={INPUT_CLASS}
              />
            </div>
            {[
              { key: 'emp_branch' as const, label: 'Branch', opts: branches },
              { key: 'emp_dept' as const, label: 'Department', opts: departments },
              { key: 'designation' as const, label: 'Designation', opts: designations },
              { key: 'emp_grade' as const, label: 'Grade', opts: grades },
            ].map(({ key, label, opts }) => (
              <div key={key}>
                <label className={LABEL_CLASS}>{label}</label>
                <SearchableSelect
                  value={onboardForm[key]}
                  onChange={(v) => updateOnboardField(key, v)}
                  options={opts}
                  placeholder={`Select ${label.toLowerCase()}`}
                  buttonClassName={INPUT_CLASS}
                />
              </div>
            ))}
            <div>
              <label className={LABEL_CLASS}>Notice Period</label>
              <SearchableSelect
                value={onboardForm.notice_days}
                onChange={(v) => updateOnboardField('notice_days', v)}
                options={noticePeriods}
                placeholder="Select notice period"
                buttonClassName={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Probation Period (days)</label>
              <input type="number" className={INPUT_CLASS} {...fOnboard('probation')} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Reporting Manager</label>
              <EmployeeSearch
                value={onboardForm.attr1}
                onChange={(empPkey) => setOnboardForm((prev) => ({ ...prev, attr1: empPkey }))}
              />
            </div>
          </div>
        </div>

        <div>
          <SectionHeading>Policies &amp; Rules</SectionHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            {[
              { key: 'day_time_seq' as const, label: 'Shift Policy', opts: shifts },
              { key: 'holiday_group_id' as const, label: 'Holiday Calendar', opts: holidayGroups },
              { key: 'leavepolicy_group_id' as const, label: 'Leave Policy', opts: leavePolicyGroups },
            ].map(({ key, label, opts }) => (
              <div key={key}>
                <label className={LABEL_CLASS}>{label}</label>
                <SearchableSelect
                  value={onboardForm[key]}
                  onChange={(v) => updateOnboardField(key, v)}
                  options={opts}
                  placeholder={`Select ${label.toLowerCase()}`}
                  buttonClassName={INPUT_CLASS}
                />
              </div>
            ))}
          </div>
        </div>
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
            imageUrl={form.profile_image_url !== undefined ? form.profile_image_url : data?.join.profile_image_url}
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
          {steps.map((s, i) => {
            const isCompleted = completed.has(i);
            const isActive = i === activeStepForUI;
            // Once the draft exists, every tab is freely reachable — matching legacy's own
            // tab-switching (no restriction once emp_pkey != 0), and avoiding a stuck tab
            // when Onboarding (which never calls persist()/marks "completed") is left early.
            const clickable = isActive || i === 0 || !isCreate;
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
                      : clickable
                        ? 'text-slate-500 hover:bg-slate-100 cursor-pointer'
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
                {i < steps.length - 1 && <span className="w-4 h-px bg-slate-200 flex-shrink-0" />}
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

          {isLast && includeOnboarding ? (
            <button
              onClick={finish}
              disabled={pending || isCreate}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-[color:var(--color-primary)] hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100 text-white shadow-lg shadow-[color:var(--color-primary)]/20 transition-all duration-[180ms]"
            >
              {pending ? 'Onboarding…' : 'Complete Onboarding'}
            </button>
          ) : isLast ? (
            <button
              onClick={finishWithoutOnboarding}
              disabled={pending || isCreate}
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
