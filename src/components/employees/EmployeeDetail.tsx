'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, User, Briefcase, FileText, Plus, Trash2, Eye, Pencil,
  AlertCircle, CheckCircle2, Users, Star, GraduationCap, History,
} from 'lucide-react';
import { RepeatableRows } from '@/components/employees/RepeatableRows';
import { cn, formatDate } from '@/lib/utils';
import { AvatarUpload } from '@/components/ui/AvatarUpload';
import { RequiredMark } from '@/components/ui/RequiredMark';
import { FilePreviewModal } from '@/components/ui/FilePreviewModal';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { DatePicker } from '@/components/ui/DatePicker';
import { CollapsibleSection, SectionHeading } from '@/components/ui/CollapsibleSection';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { DocumentUploadField } from '@/components/employees/DocumentUploadField';
import { useSetupOptions, useSetupRows } from '@/lib/setupOptions';
import { EMP_TYPES } from '@/lib/employeeOptions';
import { EMPLOYEE_FIELD_LIMITS, CHILD_FIELD_LIMITS } from '@/lib/employeeFieldLimits';
import {
  FAMILY_GENDERS, marksError, salaryError, contactNumberError, documentNumberError,
  onlyDigits, onlyAlphanumeric, onlyPercent, cleanName,
} from '@/lib/childRowValidation';
import {
  dobError, ageAtDateError, aadhaarError, panError, esiError, uanError, lwfError, accountNoError, pfNumberError,
  mobileError, pincodeError, localDateStr,
} from '@/lib/validation';
import { DetailSkeleton } from '@/components/ui/Skeleton';

const DOCUMENT_TYPES = ['Aadhaar', 'PAN', 'Passport', 'Driving License', 'Voter ID', 'Educational Certificate', 'Offer Letter', 'Relieving Letter', 'Other'];

const INPUT_CLASS = 'w-full h-11 px-3.5 border border-slate-200 rounded-lg text-sm text-[#0F172A] placeholder:text-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors duration-150';
const ERROR_INPUT_CLASS = 'border-[color:var(--color-danger)] focus:ring-[color:var(--color-danger)]/20 focus:border-[color:var(--color-danger)]';
const LABEL_CLASS = 'block text-[13px] font-medium text-slate-600 mb-1.5';

const STATUS_BADGE: Record<number, { label: string; cls: string }> = {
  1: { label: 'Active', cls: 'bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]' },
  0: { label: 'Inactive', cls: 'bg-slate-100 text-slate-500' },
  2: { label: 'Resigned', cls: 'bg-amber-50 text-amber-600' },
};

// Three top-level tabs matching the legacy Employee Details screen (Employee/setups/{id} +
// EmployeeJoin/allonboard/{id}) — each merges several of this component's previous flat tabs.
const TABS = [
  { key: 'personal-info', label: 'Personal Info', icon: User, title: 'Personal Info' },
  { key: 'other-details', label: 'Other Details', icon: FileText, title: 'Other Details' },
  { key: 'onboarding', label: 'Onboarding', icon: Briefcase, title: 'Onboarding' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

// Which tab each validated field lives on — used to jump the user to the first invalid tab.
const FIELD_TAB: Record<string, TabKey> = {
  first_name: 'personal-info', classification: 'personal-info', date_of_birth: 'personal-info', id_card: 'personal-info',
  pan_no: 'personal-info', pf: 'personal-info', company_pf: 'personal-info', esi: 'personal-info', lwf_code: 'personal-info',
  account_no: 'personal-info', mobile_no: 'personal-info', pincode: 'personal-info', nationality_id: 'personal-info',
  contract_end_date: 'onboarding',
};

// nationality defaults to "Indian" (matches the India default on the profile's nationality_id).
const EMPTY_DOC = { document_type: '', document_number: '', name: '', relation: '', nationality: 'Indian', valid_from: '', valid_till: '' };
const FAMILY_RELATIONS = ['Self', 'Mother', 'Father', 'Sister', 'Brother', 'Cousin', 'Spouse', 'Other'];
const EMPTY_FAMILY = { name: '', relation: '', gender: '', DOB: '', blood_group: '', nationality: 'Indian', contact_number: '', alternate_number: '', is_nominee: 'N', emergency_contact: 'N' };
// Matches lib/validation.ts's dobError (18-years-minimum) check — caps the calendar itself at
// that same boundary instead of only rejecting an underage pick after submit.
const MAX_DOB = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return localDateStr(d);
})();
const TODAY = localDateStr(new Date());

interface NationalityOption { id: number; nationality: string; country_name: string }

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p className="flex items-center gap-1 text-xs text-[color:var(--color-danger)] mt-1.5">
      <AlertCircle className="w-3 h-3 flex-shrink-0" />
      {children}
    </p>
  );
}

function HelperText({ children }: { children?: string }) {
  if (!children) return null;
  return <p className="text-xs text-slate-400 mt-1.5">{children}</p>;
}

interface EmployeeDetailProps {
  id: string;
  /** Called when the user wants to leave this view (navigate back or close a modal). */
  onBack: () => void;
  /** Set to false to hide the "Back" link, e.g. when a modal already provides a close control. */
  showBackLink?: boolean;
}

export function EmployeeDetail({ id, onBack, showBackLink = true }: EmployeeDetailProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('personal-info');
  const seeded = useRef(false);
  // Legacy locks a record on onboarding (editable=0) until an admin explicitly unlocks it —
  // default true so the form isn't briefly disabled while this employee's data is still loading.
  const [editable, setEditableState] = useState(true);

  const [showDocForm, setShowDocForm] = useState(false);
  const [docDraft, setDocDraft] = useState(EMPTY_DOC);
  const [docFile, setDocFile] = useState('');
  const [docErrors, setDocErrors] = useState<Record<string, string>>({});
  const [replacingPkey, setReplacingPkey] = useState<number | null>(null);
  const [docSaving, setDocSaving] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ url: string; title: string } | null>(null);

  const [showFamilyForm, setShowFamilyForm] = useState(false);
  const [familyDraft, setFamilyDraft] = useState(EMPTY_FAMILY);
  const [familyErrors, setFamilyErrors] = useState<Record<string, string>>({});
  const [familySaving, setFamilySaving] = useState(false);
  const [editingFamilyPkey, setEditingFamilyPkey] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => fetch(`/api/employees/${id}`).then((r) => r.json()),
  });

  const { data: documents = [] } = useQuery<Record<string, unknown>[]>({
    queryKey: ['employee', id, 'documents'],
    queryFn: () => fetch(`/api/employees/${id}/documents`).then((r) => r.json()),
  });

  const { data: family = [] } = useQuery<Record<string, unknown>[]>({
    queryKey: ['employee', id, 'family'],
    queryFn: () => fetch(`/api/employees/${id}/family`).then((r) => r.json()),
  });

  const { data: education = [] } = useQuery<Record<string, unknown>[]>({
    queryKey: ['employee', id, 'education'],
    queryFn: () => fetch(`/api/employees/${id}/education`).then((r) => r.json()),
  });

  const { data: experience = [] } = useQuery<Record<string, unknown>[]>({
    queryKey: ['employee', id, 'experience'],
    queryFn: () => fetch(`/api/employees/${id}/experience`).then((r) => r.json()),
  });

  const { data: nationalities = [] } = useSetupRows<NationalityOption>('setup/nationalities');
  const { data: branches = [] } = useSetupOptions('setup/branches', 'branch_code', 'branch_name');
  const { data: departments = [] } = useSetupOptions('setup/departments', 'dept_code', 'dept_name');
  const { data: designations = [] } = useSetupOptions('setup/designations', 'desig_code', 'desig_name');
  const { data: grades = [] } = useSetupOptions('setup/grades', 'grade_code', 'grade_name');
  const { data: shifts = [] } = useSetupOptions('setup/shifts', 'day_time_seq', 'day_time_desc');
  const { data: holidayGroups = [] } = useSetupOptions('setup/holiday-groups', 'HOLIDAY_GROUP_ID', 'HOLIDAY_GROUP_NAME');
  const { data: leavePolicyGroups = [] } = useSetupOptions('setup/leavepolicy-groups', 'LEAVEPOLICY_GROUP_ID', 'LEAVEPOLICY_GROUP_NAME');
  const { data: noticePeriods = [] } = useSetupOptions('setup/notice-periods', 'notice_days', 'description');

  // Seed `form` from the server exactly once — a background refetch (window refocus, a
  // document add/remove invalidating ['employee', id]) must not clobber in-progress edits.
  useEffect(() => {
    if (data?.employee && data?.professional !== undefined && !seeded.current) {
      seeded.current = true;
      const initial = {
        // One Name field, as in legacy (setups.ctp): any separate last name is merged in and saved
        // back the legacy way — full name in first_name, last_name empty.
        first_name: `${data.employee.first_name ?? ''} ${data.employee.last_name ?? ''}`.trim(),
        last_name: '',
        date_of_birth: data.employee.date_of_birth?.split('T')[0] ?? '',
        mobile_no: data.employee.mobile_no ?? '',
        email: data.employee.email ?? '',
        classification: data.employee.classification ?? '',
        blood: data.employee.blood ?? '',
        maritual_status: data.employee.maritual_status ?? '',
        profile_pic: data.employee.profile_pic ?? '',
        id_card: data.employee.id_card ?? '',
        lwf_code: data.employee.lwf_code ?? '',
        address: data.employee.address ?? '',
        nationality_id: data.employee.nationality_id != null ? String(data.employee.nationality_id) : '',
        district: data.employee.city ?? '',
        state: data.employee.state ?? '',
        pincode: data.employee.pincode ?? '',
        guradian: data.employee.guradian ?? '',
        relation_guardian: data.employee.relation_guardian ?? '',
        international_worker: data.employee.international_worker ?? 'N',
        // String() like nationality_id above: the dropdown matches options ('1') by strict equality,
        // so a raw numeric id (1) showed as blank even though it was saved.
        country: data.employee.country != null ? String(data.employee.country) : '',
        physical_handicap: data.employee.physical_handicap ?? 'N',
        locomotive: data.employee.locomotive ?? 'N',
        hearing: data.employee.hearing ?? 'N',
        visual: data.employee.visual ?? 'N',
        wps_code: data.employee.wps_code ?? '',
        previous_member_id: data.employee.previous_member_id ?? '',
        pan_no: data.employee.pan_no ?? '',
        pf: data.employee.pf ?? '',
        company_pf: data.employee.company_pf ?? '',
        eps: data.employee.eps ?? '',
        esi: data.employee.esi ?? '',
        esi_dispensary: data.employee.esi_dispensary ?? '',
        bank_name: data.employee.bank_name ?? '',
        bank_branch_name: data.employee.branch_name ?? '',
        branch_address: data.employee.branch_address ?? '',
        ifsc_code: data.employee.ifsc_code ?? '',
        account_no: data.employee.account_no ?? '',
        joining_date: data.professional?.joining_date?.split('T')[0] ?? '',
        emp_branch: data.professional?.emp_branch ?? '',
        emp_dept: data.professional?.emp_dept ?? '',
        designation: data.professional?.designation ?? '',
        emp_grade: data.professional?.emp_grade ?? '',
        emp_type: data.professional?.emp_type ?? '',
        contract_end_date: data.professional?.contract_end_date?.split('T')[0] ?? '',
        day_time_seq: data.professional?.day_time_seq != null ? String(data.professional.day_time_seq) : '',
        holiday_group_id: data.professional?.HOLIDAY_GROUP_ID != null ? String(data.professional.HOLIDAY_GROUP_ID) : '',
        leavepolicy_group_id: data.professional?.LEAVEPOLICY_GROUP_ID != null ? String(data.professional.LEAVEPOLICY_GROUP_ID) : '',
        attr1: data.professional?.attr1 ?? '',
        probation: data.professional?.probation != null ? String(data.professional.probation) : '',
        emp_company_id: data.professional?.emp_company_id ?? '',
        notice_days: data.professional?.notice_days != null ? String(data.professional.notice_days) : '',
      };
      setForm(initial);
      setSavedSnapshot(JSON.stringify(initial));
      // Legacy treats any value > 0 as unlocked (its 1-7 range encodes which sections), not just
      // exactly 1 — real historical records can carry those legacy values.
      setEditableState(Number(data.employee.editable ?? 0) > 0);
    }
  }, [data]);

  const isDirty = savedSnapshot !== '' && JSON.stringify(form) !== savedSnapshot;

  const editableToggle = useMutation({
    mutationFn: async (next: boolean) => {
      const res = await fetch(`/api/employees/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editable: next ? 1 : 0 }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to update editable status');
      return next;
    },
    onSuccess: (next) => {
      setEditableState(next);
      // Also update the cached employee record — otherwise reopening this employee within the
      // query's staleTime re-seeds from the old cached `editable` and shows the previous state.
      queryClient.setQueryData(['employee', id], (old: { employee?: Record<string, unknown> } | undefined) =>
        old?.employee ? { ...old, employee: { ...old.employee, editable: next ? 1 : 0 } } : old
      );
      queryClient.invalidateQueries({ queryKey: ['employee', id] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : String(err)),
  });

  const update = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/employees/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error ?? 'Failed to save');
      return resData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee', id] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setSavedSnapshot(JSON.stringify(form));
      setFormError('');
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : String(err)),
  });

  async function addDocument(values: Record<string, string>) {
    await fetch(`/api/employees/${id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    queryClient.invalidateQueries({ queryKey: ['employee', id, 'documents'] });
  }

  async function removeDocument(pkey: number) {
    await fetch(`/api/employees/${id}/documents/${pkey}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['employee', id, 'documents'] });
  }

  function openAddDocument() {
    setDocDraft(EMPTY_DOC);
    setDocFile('');
    setReplacingPkey(null);
    setDocErrors({});
    setShowDocForm(true);
  }

  function openReplaceDocument(row: Record<string, unknown>) {
    setDocDraft({
      document_type: String(row.document_type ?? ''),
      document_number: String(row.document_number ?? ''),
      name: String(row.name ?? ''),
      relation: String(row.relation ?? ''),
      nationality: String(row.nationality ?? ''),
      valid_from: String(row.valid_from ?? '').slice(0, 10),
      valid_till: String(row.valid_till ?? '').slice(0, 10),
    });
    // Keep the current attachment unless a new file is uploaded — Edit updates the row in place.
    setDocFile(String(row.files ?? ''));
    setReplacingPkey(Number(row.emp_passport_visa_pkey));
    setDocErrors({});
    setShowDocForm(true);
  }

  async function submitDocument() {
    const errors = {
      document_type: docDraft.document_type ? '' : 'Document type is required',
      document_number: docDraft.document_number.trim() ? (documentNumberError(docDraft.document_number) ?? '') : 'Document number is required',
      name: docDraft.name.trim() ? '' : 'Name on document is required',
      relation: docDraft.relation.trim() ? '' : 'Relation is required',
      valid_from: docDraft.valid_from ? '' : 'Valid from date is required',
    };
    if (Object.values(errors).some(Boolean)) {
      setDocErrors(errors);
      return;
    }
    setDocErrors({});
    setDocSaving(true);
    try {
      if (replacingPkey != null) await updateRow('documents', replacingPkey, { ...docDraft, files: docFile });
      else await addDocument({ ...docDraft, files: docFile });
      setShowDocForm(false);
    } catch (err) {
      setDocErrors({ form: err instanceof Error ? err.message : String(err) });
    } finally {
      setDocSaving(false);
    }
  }

  // Single source of truth for both live (on-type) and submit-time validation, so the two never
  // drift apart — legacy's setup.ctp runs the same per-field checks on 'keyup blur', not just on
  // submit, which is what these fields were missing before.
  const fieldValidators: Record<string, (v: string) => string> = {
    first_name: (v) => v.trim() ? '' : 'Name is required',
    classification: (v) => v ? '' : 'Gender is required',
    nationality_id: (v) => v ? '' : 'Nationality is required',
    date_of_birth: (v) => v ? (dobError(v) ?? '') : 'Date of birth is required',
    id_card: (v) => v ? (aadhaarError(v) ?? '') : 'Aadhaar/ID Card is required',
    mobile_no: (v) => mobileError(v) ?? '',
    pincode: (v) => pincodeError(v) ?? '',
    pan_no: (v) => panError(v) ?? '',
    pf: (v) => pfNumberError(v) ?? '',
    company_pf: (v) => uanError(v) ?? '',
    esi: (v) => esiError(v) ?? '',
    lwf_code: (v) => lwfError(v) ?? '',
    account_no: (v) => accountNoError(v) ?? '',
  };

  // Legacy View/Employee/setup.ctp:1001-1037's "18 at joining" check is against a SECOND field
  // (joining_date), not a per-field format error — surfaced as its own banner (formError),
  // recomputed live whenever either date changes so it never goes stale mid-edit.
  function recomputeAgeError(next: Record<string, string>) {
    setFormError(next.joining_date ? (ageAtDateError(next.date_of_birth, next.joining_date) ?? '') : '');
  }

  // Contract Period is only meaningful (and only required) while Employee Type = Contract —
  // ports legacy EmployeeController.php:3527-3563's contracted_days bookkeeping, which needs a
  // real end date whenever a row for it is inserted/updated.
  function contractEndDateError(next: Record<string, string>): string {
    if (next.emp_type !== 'Contract') return '';
    if (!next.contract_end_date) return 'Contract end date is required';
    if (next.joining_date && next.contract_end_date <= next.joining_date) {
      return 'Contract end date must be after the joining date';
    }
    return '';
  }

  function validateAndSave() {
    const ageError = form.joining_date ? (ageAtDateError(form.date_of_birth, form.joining_date) ?? '') : '';
    const errors = Object.fromEntries(
      Object.entries(fieldValidators).map(([key, fn]) => [key, fn(form[key] ?? '')])
    );
    errors.contract_end_date = contractEndDateError(form);
    setFormError(ageError);
    if (Object.values(errors).some(Boolean) || ageError) {
      setFieldErrors(errors);
      const firstBadField = Object.keys(errors).find((k) => errors[k]);
      if (firstBadField && FIELD_TAB[firstBadField]) setActiveTab(FIELD_TAB[firstBadField]);
      return;
    }
    setFieldErrors({});
    update.mutate();
  }

  function updateField(key: string, raw: string) {
    // Also caps number inputs, which ignore the maxLength attribute.
    const value = EMPLOYEE_FIELD_LIMITS[key] ? raw.slice(0, EMPLOYEE_FIELD_LIMITS[key]) : raw;
    const next = { ...form, [key]: value };
    // Probation days only apply to a Probation hire (the field is hidden otherwise).
    if (key === 'emp_type' && value !== 'Probation') next.probation = '';
    setForm(next);
    const validator = fieldValidators[key];
    if (validator) setFieldErrors((prev) => ({ ...prev, [key]: validator(value) }));
    if (key === 'date_of_birth' || key === 'joining_date') recomputeAgeError(next);
    if (key === 'emp_type' || key === 'joining_date' || key === 'contract_end_date') {
      setFieldErrors((prev) => ({ ...prev, contract_end_date: contractEndDateError(next) }));
    }
  }

  function f(key: string) {
    return {
      value: form[key] ?? '',
      maxLength: EMPLOYEE_FIELD_LIMITS[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => updateField(key, e.target.value),
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
              if (key === 'international_worker' && !checked) next.country = '';
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

  // Edit saves over the existing row (same pkey) via PUT — never delete + re-add.
  async function updateRow(section: 'education' | 'experience' | 'family' | 'documents', pkey: number, values: Record<string, string>) {
    const res = await fetch(`/api/employees/${id}/${section}/${pkey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) throw new Error('Could not save these changes — please check the values and try again.');
    queryClient.invalidateQueries({ queryKey: ['employee', id, section] });
  }

  async function addFamilyMember(values: Record<string, string>) {
    await fetch(`/api/employees/${id}/family`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    queryClient.invalidateQueries({ queryKey: ['employee', id, 'family'] });
  }

  async function removeFamilyMember(pkey: number) {
    await fetch(`/api/employees/${id}/family/${pkey}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['employee', id, 'family'] });
  }

  async function addEducation(values: Record<string, string>) {
    await fetch(`/api/employees/${id}/education`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    queryClient.invalidateQueries({ queryKey: ['employee', id, 'education'] });
  }

  async function removeEducation(pkey: number) {
    await fetch(`/api/employees/${id}/education/${pkey}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['employee', id, 'education'] });
  }

  async function addExperience(values: Record<string, string>) {
    await fetch(`/api/employees/${id}/experience`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    queryClient.invalidateQueries({ queryKey: ['employee', id, 'experience'] });
  }

  async function removeExperience(pkey: number) {
    await fetch(`/api/employees/${id}/experience/${pkey}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['employee', id, 'experience'] });
  }

  function openAddFamily() {
    setFamilyDraft(EMPTY_FAMILY);
    setEditingFamilyPkey(null);
    setFamilyErrors({});
    setShowFamilyForm(true);
  }

  function openEditFamily(row: Record<string, unknown>) {
    const str = (k: string, fallback = '') => (row[k] == null ? fallback : String(row[k]));
    // remarks isn't on the form but is part of the row — carried along so saving doesn't blank it.
    setFamilyDraft({
      name: str('name'), relation: str('relation'), gender: str('gender'), DOB: str('DOB').slice(0, 10),
      blood_group: str('blood_group'), nationality: str('nationality'), contact_number: str('contact_number'),
      alternate_number: str('alternate_number'), is_nominee: str('is_nominee', 'N'), emergency_contact: str('emergency_contact', 'N'),
      remarks: str('remarks'),
    } as typeof EMPTY_FAMILY);
    setEditingFamilyPkey(Number(row.emp_family_pkey));
    setFamilyErrors({});
    setShowFamilyForm(true);
  }

  async function submitFamily() {
    const errors = {
      name: familyDraft.name.trim() ? '' : 'Name is required',
      relation: familyDraft.relation ? '' : 'Relation is required',
      gender: familyDraft.gender ? '' : 'Gender is required',
      DOB: familyDraft.DOB ? '' : 'Date of birth is required',
      contact_number: familyDraft.contact_number.trim() ? (contactNumberError(familyDraft.contact_number) ?? '') : 'Contact number is required',
      alternate_number: contactNumberError(familyDraft.alternate_number, 'Alternative number') ?? '',
    };
    if (Object.values(errors).some(Boolean)) {
      setFamilyErrors(errors);
      return;
    }
    setFamilyErrors({});
    setFamilySaving(true);
    try {
      if (editingFamilyPkey != null) await updateRow('family', editingFamilyPkey, familyDraft);
      else await addFamilyMember(familyDraft);
      setShowFamilyForm(false);
      setEditingFamilyPkey(null);
    } catch (err) {
      setFamilyErrors({ form: err instanceof Error ? err.message : String(err) });
    } finally {
      setFamilySaving(false);
    }
  }

  if (isLoading) return <DetailSkeleton fields={12} />;
  if (!data?.employee) return <div className="p-10 text-center text-sm text-[color:var(--color-danger)]">Employee not found.</div>;

  const emp = data.employee;
  const embedded = !showBackLink;
  const statusInfo = STATUS_BADGE[Number(emp.status)] ?? STATUS_BADGE[1];
  const headerName = `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim();
  const metaParts = [
    // Employee ID (emp_proff.emp_company_id) — same as the Employees list; defaults to the login ID.
    data.professional?.emp_company_id || emp.emp_id,
    emp.desig_name,
    emp.emp_branch_name,
    emp.dept_name,
  ].filter(Boolean);

  return (
    <div className={cn('flex flex-col -m-6', embedded && 'max-h-[calc(95vh-3rem)]')}>
      {/* Sticky header + tab navigation */}
      <div className="flex-shrink-0 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-6 pt-6 rounded-t-2xl">
        {showBackLink && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4 transition-colors duration-150"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Employees
          </button>
        )}
        <div className="flex items-start justify-between gap-4 pr-14">
          <div className="flex items-center gap-3.5 min-w-0">
            <AvatarUpload
              name={headerName}
              imageUrl={form.profile_pic !== undefined ? form.profile_pic : emp.profile_pic}
              onUploaded={(path) => setForm((prev) => ({ ...prev, profile_pic: path }))}
              className="w-12 h-12 flex-shrink-0"
              avatarClassName="text-sm"
              // Locked with the rest of the form while "Editable" is off.
              disabled={!editable}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="font-heading text-[19px] font-bold text-[#0F172A] tracking-tight leading-tight truncate">
                  {headerName}
                </h1>
                <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0', statusInfo.cls)}>
                  {statusInfo.label}
                </span>
              </div>
              <p className="text-[13px] text-slate-500 mt-0.5 truncate">{metaParts.join(' · ')}</p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px] font-medium text-slate-600 flex-shrink-0 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={editable}
              disabled={editableToggle.isPending}
              onChange={(e) => editableToggle.mutate(e.target.checked)}
              className="accent-[color:var(--color-primary)] w-4 h-4"
            />
            Editable
          </label>
        </div>
        {formError && (
          <p className="flex items-center gap-1.5 text-xs text-[color:var(--color-danger)] mt-3">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {formError}
          </p>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 mt-5 -mb-px overflow-x-auto scroll-fade">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3.5 py-2.5 text-[13.5px] font-medium border-b-2 whitespace-nowrap transition-colors duration-150',
                  isActive
                    ? 'border-[color:var(--color-primary)] text-[color:var(--color-primary)]'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                )}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={2} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable tab content */}
      <div className="flex-1 overflow-y-auto scroll-fade px-6 py-6">
        {/* Ports legacy's disableAllSections()/setSectionAccess() — a locked record (editable=0)
            can't have any of its fields touched until the toggle above unlocks it. A native
            fieldset cascades disabled to every descendant input without touching each field. */}
        <fieldset disabled={!editable} className="m-0 p-0 border-0 min-w-0">
        {TABS.map((tab) => {
          if (tab.key !== activeTab) return null;
          return (
            <div key={tab.key}>
              {tab.key === 'personal-info' && (
                // One continuous dense grid — matches legacy's Employee Details / Personal Info
                // tab (and the Employee Join wizard's first step), which runs Name through LWF
                // Registration Number as a single flat form with no sub-section headers.
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-5">
                  <div>
                    <label className={LABEL_CLASS}>Name<RequiredMark /></label>
                    <input className={cn(INPUT_CLASS, fieldErrors.first_name && ERROR_INPUT_CLASS)} {...f('first_name')} onChange={(e) => updateField('first_name', cleanName(e.target.value))} placeholder="Full name" />
                    <FieldError>{fieldErrors.first_name}</FieldError>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Date of Birth<RequiredMark /></label>
                    <DatePicker value={form.date_of_birth ?? ''} onChange={(v) => updateField('date_of_birth', v)} max={MAX_DOB} required buttonClassName={cn(INPUT_CLASS, fieldErrors.date_of_birth && ERROR_INPUT_CLASS)} />
                    <FieldError>{fieldErrors.date_of_birth}</FieldError>
                  </div>

                  <div>
                    <label className={LABEL_CLASS}>Gender<RequiredMark /></label>
                    <SearchableSelect
                      value={form.classification ?? ''}
                      onChange={(v) => updateField('classification', v)}
                      options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]}
                      placeholder="Select"
                      buttonClassName={cn(INPUT_CLASS, fieldErrors.classification && ERROR_INPUT_CLASS)}
                    />
                    <FieldError>{fieldErrors.classification}</FieldError>
                  </div>
                  {/* Two columns wide on the 3-column layout: fills the slot the removed Last Name
                      field left in this row. */}
                  <div className="lg:col-span-2">
                    <label className={LABEL_CLASS}>Email</label>
                    <input type="email" className={INPUT_CLASS} {...f('email')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Mobile Number</label>
                    <input type="tel" className={cn(INPUT_CLASS, fieldErrors.mobile_no && ERROR_INPUT_CLASS)} {...f('mobile_no')} />
                    <FieldError>{fieldErrors.mobile_no}</FieldError>
                  </div>

                  <div className="sm:col-span-2">
                    <label className={LABEL_CLASS}>Address</label>
                    <input maxLength={EMPLOYEE_FIELD_LIMITS.address} className={INPUT_CLASS} value={form.address ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Pincode</label>
                    <input className={cn(INPUT_CLASS, fieldErrors.pincode && ERROR_INPUT_CLASS)} {...f('pincode')} />
                    <FieldError>{fieldErrors.pincode}</FieldError>
                  </div>

                  <div>
                    <label className={LABEL_CLASS}>Nationality<RequiredMark /></label>
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
                    <label className={LABEL_CLASS}>District</label>
                    <input className={INPUT_CLASS} {...f('district')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>State</label>
                    <input className={INPUT_CLASS} {...f('state')} />
                  </div>

                  <div>
                    <label className={LABEL_CLASS}>Marital Status</label>
                    <SearchableSelect
                      value={form.maritual_status ?? ''}
                      onChange={(v) => updateField('maritual_status', v)}
                      options={[{ value: 'Single', label: 'Single' }, { value: 'Married', label: 'Married' }]}
                      placeholder="Select"
                      buttonClassName={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Guardian Name</label>
                    <input className={INPUT_CLASS} {...f('guradian')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Relation to Guardian</label>
                    <input className={INPUT_CLASS} {...f('relation_guardian')} />
                  </div>

                  <div>
                    <label className={LABEL_CLASS}>Blood Group</label>
                    <SearchableSelect
                      value={form.blood ?? ''}
                      onChange={(v) => updateField('blood', v)}
                      options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => ({ value: bg, label: bg }))}
                      placeholder="Select"
                      buttonClassName={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>ID Card Number<RequiredMark /></label>
                    <input className={cn(INPUT_CLASS, fieldErrors.id_card && ERROR_INPUT_CLASS)} {...f('id_card')} />
                    <FieldError>{fieldErrors.id_card}</FieldError>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>PAN Number</label>
                    <input
                      className={cn(INPUT_CLASS, fieldErrors.pan_no && ERROR_INPUT_CLASS)}
                      {...f('pan_no')}
                      onChange={(e) => updateField('pan_no', e.target.value.toUpperCase())}
                    />
                    {fieldErrors.pan_no ? <FieldError>{fieldErrors.pan_no}</FieldError> : <HelperText>Format: ABCDE1234F</HelperText>}
                  </div>

                  <div>
                    <label className={LABEL_CLASS}>Bank Name</label>
                    <input className={INPUT_CLASS} {...f('bank_name')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Bank Branch</label>
                    <input className={INPUT_CLASS} {...f('bank_branch_name')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>IFSC Code</label>
                    <input className={INPUT_CLASS} {...f('ifsc_code')} />
                  </div>

                  <div>
                    <label className={LABEL_CLASS}>Account Number</label>
                    <input className={cn(INPUT_CLASS, fieldErrors.account_no && ERROR_INPUT_CLASS)} {...f('account_no')} />
                    <FieldError>{fieldErrors.account_no}</FieldError>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>ESI Number</label>
                    <input className={cn(INPUT_CLASS, fieldErrors.esi && ERROR_INPUT_CLASS)} {...f('esi')} />
                    {fieldErrors.esi ? <FieldError>{fieldErrors.esi}</FieldError> : <HelperText>10 digits</HelperText>}
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>ESI Dispensary</label>
                    <input className={INPUT_CLASS} {...f('esi_dispensary')} />
                  </div>

                  <div>
                    <label className={LABEL_CLASS}>PF Number</label>
                    <input className={cn(INPUT_CLASS, fieldErrors.pf && ERROR_INPUT_CLASS)} {...f('pf')} />
                    <FieldError>{fieldErrors.pf}</FieldError>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>UAN No</label>
                    <input className={cn(INPUT_CLASS, fieldErrors.company_pf && ERROR_INPUT_CLASS)} {...f('company_pf')} />
                    <FieldError>{fieldErrors.company_pf}</FieldError>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Previous Member ID</label>
                    <input className={INPUT_CLASS} {...f('previous_member_id')} />
                  </div>

                  <div>
                    <label className={LABEL_CLASS}>WPS ID</label>
                    <input className={INPUT_CLASS} {...f('wps_code')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>LWF Registration Number</label>
                    <input
                      className={cn(INPUT_CLASS, fieldErrors.lwf_code && ERROR_INPUT_CLASS)}
                      {...f('lwf_code')}
                      onChange={(e) => updateField('lwf_code', e.target.value.toUpperCase())}
                    />
                    <FieldError>{fieldErrors.lwf_code}</FieldError>
                  </div>
                  <div className="flex items-end">
                    <SearchableSelect
                      value={form.country ?? ''}
                      onChange={(v) => updateField('country', v)}
                      options={nationalities.map((n) => ({ value: String(n.id), label: n.country_name }))}
                      placeholder="Country of origin"
                      buttonClassName={INPUT_CLASS}
                      disabled={form.international_worker !== 'Y'}
                    />
                  </div>

                  <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-6 flex-wrap pt-1">
                    {checkbox('eps', 'EPS Eligibility')}
                    {checkbox('physical_handicap', 'Physical Handicap')}
                    {checkbox('international_worker', 'International Worker')}
                  </div>
                  {form.physical_handicap === 'Y' && (
                    <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap gap-4 pl-1">
                      {checkbox('locomotive', 'Locomotive')}
                      {checkbox('hearing', 'Hearing')}
                      {checkbox('visual', 'Visual')}
                    </div>
                  )}
                </div>
              )}

              {tab.key === 'onboarding' && (
                <div className="space-y-8">
                  <div>
                    <SectionHeading>Company Information</SectionHeading>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-5">
                      <div>
                        <label className={LABEL_CLASS}>Joining Date</label>
                        <DatePicker value={form.joining_date ?? ''} onChange={(v) => updateField('joining_date', v)} buttonClassName={INPUT_CLASS} />
                      </div>
                      <div>
                        <label className={LABEL_CLASS}>Employee ID</label>
                        <input className={INPUT_CLASS} {...f('emp_company_id')} />
                      </div>
                      <div>
                        <label className={LABEL_CLASS}>Employment Type</label>
                        <SearchableSelect
                          value={form.emp_type ?? ''}
                          onChange={(v) => updateField('emp_type', v)}
                          options={EMP_TYPES.map((t) => ({ value: t, label: t }))}
                          placeholder="Select"
                          buttonClassName={INPUT_CLASS}
                        />
                      </div>
                      {[
                        { key: 'emp_branch', label: 'Branch', opts: branches },
                        { key: 'emp_dept', label: 'Department', opts: departments },
                        { key: 'designation', label: 'Designation', opts: designations },
                        { key: 'emp_grade', label: 'Grade', opts: grades },
                      ].map(({ key, label, opts }) => (
                        <div key={key}>
                          <label className={LABEL_CLASS}>{label}</label>
                          <SearchableSelect
                            value={form[key] ?? ''}
                            onChange={(v) => updateField(key, v)}
                            options={opts}
                            placeholder={`Select ${label.toLowerCase()}`}
                            buttonClassName={INPUT_CLASS}
                          />
                        </div>
                      ))}
                      <div>
                        <label className={LABEL_CLASS}>Notice Period</label>
                        <SearchableSelect
                          value={form.notice_days ?? ''}
                          onChange={(v) => updateField('notice_days', v)}
                          options={noticePeriods}
                          placeholder="Select notice period"
                          buttonClassName={INPUT_CLASS}
                        />
                      </div>
                      {/* Legacy setup.ctp #probationDaysContainer: only for a Probation hire. */}
                      {form.emp_type === 'Probation' && (
                        <div>
                          <label className={LABEL_CLASS}>Probation Period (days)</label>
                          <input inputMode="numeric" className={INPUT_CLASS} {...f('probation')} onChange={(e) => updateField('probation', onlyDigits(e.target.value))} />
                        </div>
                      )}
                      {form.emp_type === 'Contract' && (
                        <>
                          <div>
                            <label className={LABEL_CLASS}>Contract Start Date</label>
                            <DatePicker value={form.joining_date ?? ''} onChange={() => {}} disabled buttonClassName={INPUT_CLASS} />
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Contract End Date<RequiredMark /></label>
                            <DatePicker
                              value={form.contract_end_date ?? ''}
                              onChange={(v) => updateField('contract_end_date', v)}
                              min={form.joining_date || undefined}
                              required
                              buttonClassName={cn(INPUT_CLASS, fieldErrors.contract_end_date && ERROR_INPUT_CLASS)}
                            />
                            <FieldError>{fieldErrors.contract_end_date}</FieldError>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div>
                    <SectionHeading>Policies & Rules</SectionHeading>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-5">
                      {[
                        { key: 'day_time_seq', label: 'Shift Policy', opts: shifts },
                        { key: 'holiday_group_id', label: 'Holiday Group', opts: holidayGroups },
                        { key: 'leavepolicy_group_id', label: 'Leave Policy Group', opts: leavePolicyGroups },
                      ].map(({ key, label, opts }) => (
                        <div key={key}>
                          <label className={LABEL_CLASS}>{label}</label>
                          <SearchableSelect
                            value={form[key] ?? ''}
                            onChange={(v) => updateField(key, v)}
                            options={opts}
                            placeholder={`Select ${label.toLowerCase()}`}
                            buttonClassName={INPUT_CLASS}
                          />
                        </div>
                      ))}
                      <div>
                        <label className={LABEL_CLASS}>Reporting Manager (Superior)</label>
                        <EmployeeSearch
                          value={form.attr1 ?? ''}
                          onChange={(empPkey) => setForm((prev) => ({ ...prev, attr1: empPkey }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {tab.key === 'other-details' && (
                <div className="space-y-4">
                  <CollapsibleSection title="Education" icon={GraduationCap}>
                    <RepeatableRows
                      pkeyField="education_pkey"
                      rows={education}
                      addLabel="Add education"
                      onAdd={addEducation}
                      onRemove={removeEducation}
                      onUpdate={(pkey, values) => updateRow('education', pkey, values)}
                      fields={[
                        { key: 'degree', label: 'Course', required: true, maxLength: CHILD_FIELD_LIMITS.course },
                        { key: 'university', label: 'University', required: true, maxLength: CHILD_FIELD_LIMITS.university },
                        { key: 'duration', label: 'Duration', required: true, maxLength: CHILD_FIELD_LIMITS.duration },
                        { key: 'marks', label: 'Marks (%)', required: true, maxLength: CHILD_FIELD_LIMITS.mark, inputMode: 'decimal', sanitize: onlyPercent, validate: marksError },
                      ]}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection title="Experience" icon={History}>
                    <RepeatableRows
                      pkeyField="experience_pkey"
                      rows={experience}
                      addLabel="Add experience"
                      onAdd={addExperience}
                      onRemove={removeExperience}
                      onUpdate={(pkey, values) => updateRow('experience', pkey, values)}
                      fields={[
                        { key: 'company_name', label: 'Company', required: true, maxLength: CHILD_FIELD_LIMITS.company },
                        { key: 'designation', label: 'Designation', required: true, maxLength: CHILD_FIELD_LIMITS.designation },
                        { key: 'department', label: 'Department', required: true, maxLength: CHILD_FIELD_LIMITS.department },
                        { key: 'from_date', label: 'From', type: 'date', required: true },
                        { key: 'to_date', label: 'To', type: 'date', required: true, minFromKey: 'from_date' },
                        { key: 'salary', label: 'Salary', required: true, maxLength: CHILD_FIELD_LIMITS.salary, inputMode: 'numeric', sanitize: onlyDigits, validate: salaryError },
                      ]}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection title="Family" icon={Users}>
                    {family.length === 0 && !showFamilyForm && (
                      <p className="text-sm text-slate-400 py-6 text-center border border-dashed border-slate-200 rounded-lg">
                        No family members added yet.
                      </p>
                    )}
                    {/* The member being edited is shown only in the form below, not repeated here. */}
                    {family.some((r) => !(showFamilyForm && Number(r.emp_family_pkey) === editingFamilyPkey)) && (
                      <div className="space-y-2.5">
                        {family.filter((r) => !(showFamilyForm && Number(r.emp_family_pkey) === editingFamilyPkey)).map((row) => {
                          const dob = row.DOB ? new Date(String(row.DOB)) : null;
                          const age = dob && !Number.isNaN(dob.getTime())
                            ? Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                            : null;
                          return (
                            <div
                              key={String(row.emp_family_pkey)}
                              className="flex items-center gap-3.5 rounded-lg border border-slate-100 bg-white px-4 py-3.5 hover:border-slate-200 transition-colors duration-150"
                            >
                              <span className="w-9 h-9 rounded-lg bg-[color:var(--color-primary)]/8 text-[color:var(--color-primary)] flex items-center justify-center flex-shrink-0">
                                <Users className="w-4 h-4" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-[#0F172A] truncate flex items-center gap-1.5">
                                  {String(row.name || '—')}
                                  {row.is_nominee === 'Y' && <Star className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="currentColor" />}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5 truncate">
                                  {String(row.relation || '')}{age != null ? ` · ${age} yrs` : ''}{row.contact_number ? ` · ${row.contact_number}` : ''}
                                </p>
                              </div>
                              {row.is_nominee === 'Y' && (
                                <span className="text-[11px] font-medium px-2 py-1 rounded-full bg-amber-50 text-amber-600 flex-shrink-0">
                                  Nominee
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => openEditFamily(row)}
                                className="p-2 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-slate-50 transition-colors duration-150 flex-shrink-0"
                                title="Edit"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeFamilyMember(Number(row.emp_family_pkey))}
                                className="p-2 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-slate-50 transition-colors duration-150 flex-shrink-0"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {!showFamilyForm && (
                      <button
                        type="button"
                        onClick={openAddFamily}
                        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[color:var(--color-primary)] hover:opacity-80 transition-opacity duration-150"
                      >
                        <Plus className="w-4 h-4" /> Add Family Member
                      </button>
                    )}

                    {showFamilyForm && (
                      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-5">
                        <h3 className="text-sm font-semibold text-[#0F172A] mb-4">{editingFamilyPkey != null ? 'Edit Family Member' : 'Add Family Member'}</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-4">
                          <div>
                            <label className={LABEL_CLASS}>Name<RequiredMark /></label>
                            <input
                              maxLength={CHILD_FIELD_LIMITS.name}
                              className={cn(INPUT_CLASS, familyErrors.name && ERROR_INPUT_CLASS)}
                              value={familyDraft.name}
                              onChange={(e) => setFamilyDraft((p) => ({ ...p, name: e.target.value }))}
                            />
                            <FieldError>{familyErrors.name}</FieldError>
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Relation<RequiredMark /></label>
                            <SearchableSelect
                              value={familyDraft.relation}
                              onChange={(v) => setFamilyDraft((p) => ({ ...p, relation: v }))}
                              options={FAMILY_RELATIONS.map((r) => ({ value: r, label: r }))}
                              placeholder="Select relation"
                              buttonClassName={cn(INPUT_CLASS, familyErrors.relation && ERROR_INPUT_CLASS)}
                            />
                            <FieldError>{familyErrors.relation}</FieldError>
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Gender<RequiredMark /></label>
                            <SearchableSelect
                              value={familyDraft.gender}
                              onChange={(v) => setFamilyDraft((p) => ({ ...p, gender: v }))}
                              options={FAMILY_GENDERS.map((g) => ({ value: g, label: g }))}
                              placeholder="Select gender"
                              buttonClassName={cn(INPUT_CLASS, familyErrors.gender && ERROR_INPUT_CLASS)}
                            />
                            <FieldError>{familyErrors.gender}</FieldError>
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Date of Birth<RequiredMark /></label>
                            <DatePicker
                              value={familyDraft.DOB}
                              onChange={(v) => setFamilyDraft((p) => ({ ...p, DOB: v }))}
                              max={TODAY}
                              required
                              buttonClassName={cn(INPUT_CLASS, familyErrors.DOB && ERROR_INPUT_CLASS)}
                            />
                            <FieldError>{familyErrors.DOB}</FieldError>
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Blood Group</label>
                            <input
                              maxLength={CHILD_FIELD_LIMITS.blood_group}
                              className={INPUT_CLASS}
                              value={familyDraft.blood_group}
                              onChange={(e) => setFamilyDraft((p) => ({ ...p, blood_group: e.target.value }))}
                            />
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Nationality</label>
                            <SearchableSelect
                              value={familyDraft.nationality}
                              onChange={(v) => setFamilyDraft((p) => ({ ...p, nationality: v }))}
                              options={nationalities.map((n) => ({ value: n.nationality, label: n.country_name }))}
                              placeholder="Select nationality"
                              buttonClassName={INPUT_CLASS}
                            />
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Contact Number<RequiredMark /></label>
                            <input
                              maxLength={CHILD_FIELD_LIMITS.contact_number}
                              className={cn(INPUT_CLASS, familyErrors.contact_number && ERROR_INPUT_CLASS)}
                              value={familyDraft.contact_number}
                              onChange={(e) => setFamilyDraft((p) => ({ ...p, contact_number: onlyDigits(e.target.value) }))}
                            />
                            <FieldError>{familyErrors.contact_number}</FieldError>
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Alternative Number</label>
                            <input
                              maxLength={CHILD_FIELD_LIMITS.contact_number}
                              inputMode="numeric"
                              className={cn(INPUT_CLASS, familyErrors.alternate_number && ERROR_INPUT_CLASS)}
                              value={familyDraft.alternate_number}
                              onChange={(e) => setFamilyDraft((p) => ({ ...p, alternate_number: onlyDigits(e.target.value) }))}
                            />
                            <FieldError>{familyErrors.alternate_number}</FieldError>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-4 mt-4">
                          <label className="flex items-center gap-2 text-sm text-slate-600">
                            <input
                              type="checkbox"
                              checked={familyDraft.is_nominee === 'Y'}
                              onChange={(e) => setFamilyDraft((p) => ({ ...p, is_nominee: e.target.checked ? 'Y' : 'N' }))}
                              className="accent-[color:var(--color-primary)]"
                            />
                            Mark as Nominee
                          </label>
                          <label className="flex items-center gap-2 text-sm text-slate-600">
                            <input
                              type="checkbox"
                              checked={familyDraft.emergency_contact === 'Y'}
                              onChange={(e) => setFamilyDraft((p) => ({ ...p, emergency_contact: e.target.checked ? 'Y' : 'N' }))}
                              className="accent-[color:var(--color-primary)]"
                            />
                            Mark as Emergency Contact
                          </label>
                        </div>
                        <FieldError>{familyErrors.form}</FieldError>
                        <div className="flex items-center gap-2 mt-5">
                          <button
                            type="button"
                            onClick={submitFamily}
                            disabled={familySaving}
                            className="px-4 py-2 text-sm font-medium bg-[color:var(--color-primary)] hover:opacity-90 disabled:opacity-50 text-white rounded-lg transition-opacity duration-150"
                          >
                            {familySaving ? 'Saving…' : editingFamilyPkey != null ? 'Save Changes' : 'Save Family Member'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowFamilyForm(false)}
                            className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-lg transition-colors duration-150"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </CollapsibleSection>

                  <CollapsibleSection title="Documents" icon={FileText}>
                    {documents.length === 0 && !showDocForm && (
                      <p className="text-sm text-slate-400 py-6 text-center border border-dashed border-slate-200 rounded-lg">
                        No documents added yet.
                      </p>
                    )}
                    {/* The document being edited is shown only in the form below, not repeated here. */}
                    {documents.some((r) => !(showDocForm && Number(r.emp_passport_visa_pkey) === replacingPkey)) && (
                      <div className="space-y-2.5">
                        {documents.filter((r) => !(showDocForm && Number(r.emp_passport_visa_pkey) === replacingPkey)).map((row) => {
                          const validity = row.valid_from
                            ? `Valid ${formatDate(row.valid_from as string)}${row.valid_till ? ` – ${formatDate(row.valid_till as string)}` : ''}`
                            : '';
                          return (
                            <div
                              key={String(row.emp_passport_visa_pkey)}
                              className="flex items-center gap-3.5 rounded-lg border border-slate-100 bg-white px-4 py-3.5 hover:border-slate-200 transition-colors duration-150"
                            >
                              <span className="w-9 h-9 rounded-lg bg-[color:var(--color-primary)]/8 text-[color:var(--color-primary)] flex items-center justify-center flex-shrink-0">
                                <FileText className="w-4 h-4" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-[#0F172A] truncate">
                                  {String(row.document_type || 'Document')} · {String(row.document_number || '—')}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5 truncate">
                                  {String(row.name || '')}{validity ? ` · ${validity}` : ''}
                                </p>
                              </div>
                              <span className="text-[11px] font-medium px-2 py-1 rounded-full bg-[color:var(--color-success)]/10 text-[color:var(--color-success)] flex-shrink-0">
                                Uploaded
                              </span>
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                {row.files ? (
                                  <button
                                    type="button"
                                    onClick={() => setPreviewDoc({ url: String(row.files), title: `${String(row.document_type || 'Document')} · ${String(row.document_number || '')}` })}
                                    className="p-2 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-slate-50 transition-colors duration-150"
                                    title="View"
                                  >
                                    <Eye className="w-4 h-4" />
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => openReplaceDocument(row)}
                                  className="p-2 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-slate-50 transition-colors duration-150"
                                  title="Edit"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeDocument(Number(row.emp_passport_visa_pkey))}
                                  className="p-2 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-slate-50 transition-colors duration-150"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {!showDocForm && (
                      <button
                        type="button"
                        onClick={openAddDocument}
                        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[color:var(--color-primary)] hover:opacity-80 transition-opacity duration-150"
                      >
                        <Plus className="w-4 h-4" /> Add Document
                      </button>
                    )}

                    {showDocForm && (
                      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-5">
                        <h3 className="text-sm font-semibold text-[#0F172A] mb-4">
                          {replacingPkey != null ? 'Edit Document' : 'Add Document'}
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-4">
                          <div>
                            <label className={LABEL_CLASS}>Document Type<RequiredMark /></label>
                            <SearchableSelect
                              value={docDraft.document_type}
                              onChange={(v) => setDocDraft((p) => ({ ...p, document_type: v }))}
                              options={DOCUMENT_TYPES.map((d) => ({ value: d, label: d }))}
                              placeholder="Select type"
                              buttonClassName={cn(INPUT_CLASS, docErrors.document_type && ERROR_INPUT_CLASS)}
                            />
                            <FieldError>{docErrors.document_type}</FieldError>
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Document Number<RequiredMark /></label>
                            <input
                              maxLength={CHILD_FIELD_LIMITS.document_number}
                              className={cn(INPUT_CLASS, docErrors.document_number && ERROR_INPUT_CLASS)}
                              value={docDraft.document_number}
                              onChange={(e) => setDocDraft((p) => ({ ...p, document_number: onlyAlphanumeric(e.target.value) }))}
                            />
                            <FieldError>{docErrors.document_number}</FieldError>
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Name on Document<RequiredMark /></label>
                            <input
                              maxLength={CHILD_FIELD_LIMITS.name}
                              className={cn(INPUT_CLASS, docErrors.name && ERROR_INPUT_CLASS)}
                              value={docDraft.name}
                              onChange={(e) => setDocDraft((p) => ({ ...p, name: e.target.value }))}
                            />
                            <FieldError>{docErrors.name}</FieldError>
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Relation<RequiredMark /></label>
                            <input
                              maxLength={CHILD_FIELD_LIMITS.relation}
                              className={cn(INPUT_CLASS, docErrors.relation && ERROR_INPUT_CLASS)}
                              value={docDraft.relation}
                              onChange={(e) => setDocDraft((p) => ({ ...p, relation: e.target.value }))}
                            />
                            <FieldError>{docErrors.relation}</FieldError>
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Nationality</label>
                            <SearchableSelect
                              value={docDraft.nationality}
                              onChange={(v) => setDocDraft((p) => ({ ...p, nationality: v }))}
                              options={nationalities.map((n) => ({ value: n.nationality, label: n.country_name }))}
                              placeholder="Select nationality"
                              buttonClassName={INPUT_CLASS}
                            />
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Valid From<RequiredMark /></label>
                            <DatePicker
                              value={docDraft.valid_from}
                              required
                              buttonClassName={cn(INPUT_CLASS, docErrors.valid_from && ERROR_INPUT_CLASS)}
                              // Moving Valid From past Valid Till clears the now-invalid Valid Till.
                              onChange={(v) => setDocDraft((p) => ({ ...p, valid_from: v, valid_till: p.valid_till && v && p.valid_till < v ? '' : p.valid_till }))}
                            />
                            <FieldError>{docErrors.valid_from}</FieldError>
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Valid Till</label>
                            <DatePicker
                              value={docDraft.valid_till}
                              min={docDraft.valid_from || undefined}
                              buttonClassName={INPUT_CLASS}
                              onChange={(v) => setDocDraft((p) => ({ ...p, valid_till: v }))}
                            />
                          </div>
                        </div>
                        <div className="mt-4">
                          <label className={LABEL_CLASS}>File Upload</label>
                          <DocumentUploadField value={docFile} onChange={setDocFile} accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif" maxBytes={100_000_000} />
                        </div>
                        <FieldError>{docErrors.form}</FieldError>
                        <div className="flex items-center gap-2 mt-5">
                          <button
                            type="button"
                            onClick={submitDocument}
                            disabled={docSaving}
                            className="px-4 py-2 text-sm font-medium bg-[color:var(--color-primary)] hover:opacity-90 disabled:opacity-50 text-white rounded-lg transition-opacity duration-150"
                          >
                            {docSaving ? 'Saving…' : replacingPkey != null ? 'Save Changes' : 'Save Document'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowDocForm(false)}
                            className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-lg transition-colors duration-150"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    <FilePreviewModal url={previewDoc?.url ?? null} title={previewDoc?.title} onClose={() => setPreviewDoc(null)} />
                  </CollapsibleSection>
                </div>
              )}
            </div>
          );
        })}
        </fieldset>
      </div>

      {/* Sticky footer */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-slate-100 bg-white/95 backdrop-blur-sm rounded-b-2xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            {isDirty ? (
              <span className="flex items-center gap-1.5 text-amber-600">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Unsaved changes
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-slate-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> All changes saved
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors duration-150"
            >
              Cancel
            </button>
            <button
              onClick={validateAndSave}
              disabled={!isDirty || update.isPending}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-[color:var(--color-primary)] hover:opacity-90 disabled:opacity-40 text-white shadow-sm transition-opacity duration-150"
            >
              {update.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
