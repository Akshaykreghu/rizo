'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, User, Briefcase, Wallet, Landmark, FileText, Plus, Trash2, Eye, RefreshCw,
  AlertCircle, CheckCircle2, Users, Star,
} from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { AvatarUpload } from '@/components/ui/AvatarUpload';
import { RequiredMark } from '@/components/ui/RequiredMark';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { DocumentUploadField } from '@/components/employees/DocumentUploadField';
import { useSetupOptions, useSetupRows } from '@/lib/setupOptions';
import { EMP_TYPES } from '@/lib/employeeOptions';
import {
  dobError, ageAtDateError, panError, esiError, uanError, lwfError, accountNoError, pfNumberError,
} from '@/lib/validation';

const DOCUMENT_TYPES = ['Aadhaar', 'PAN', 'Passport', 'Driving License', 'Voter ID', 'Educational Certificate', 'Offer Letter', 'Relieving Letter', 'Other'];

const INPUT_CLASS = 'w-full h-11 px-3.5 border border-slate-200 rounded-lg text-sm text-[#0F172A] placeholder:text-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors duration-150';
const ERROR_INPUT_CLASS = 'border-[color:var(--color-danger)] focus:ring-[color:var(--color-danger)]/20 focus:border-[color:var(--color-danger)]';
const LABEL_CLASS = 'block text-[13px] font-medium text-slate-600 mb-1.5';

const STATUS_BADGE: Record<number, { label: string; cls: string }> = {
  1: { label: 'Active', cls: 'bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]' },
  0: { label: 'Inactive', cls: 'bg-slate-100 text-slate-500' },
  2: { label: 'Resigned', cls: 'bg-amber-50 text-amber-600' },
};

const TABS = [
  { key: 'personal', label: 'Personal', icon: User, title: 'Personal Details', subtitle: 'Basic employee information' },
  { key: 'professional', label: 'Professional', icon: Briefcase, title: 'Professional Details', subtitle: 'Employment and organizational information' },
  { key: 'statutory', label: 'Salary & Statutory', icon: Wallet, title: 'Salary & Statutory', subtitle: 'Tax, PF, pension and statutory information' },
  { key: 'bank', label: 'Bank Details', icon: Landmark, title: 'Bank Details', subtitle: 'Employee salary account information' },
  { key: 'documents', label: 'Documents', icon: FileText, title: 'Documents', subtitle: 'Identity and supporting documents' },
  { key: 'family', label: 'Family', icon: Users, title: 'Family & Nominee', subtitle: 'Family member and nominee details' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

// Which tab each validated field lives on — used to jump the user to the first invalid tab.
const FIELD_TAB: Record<string, TabKey> = {
  first_name: 'personal', classification: 'personal', date_of_birth: 'personal', id_card: 'personal',
  pan_no: 'statutory', pf: 'statutory', company_pf: 'statutory', esi: 'statutory', lwf_code: 'personal',
  account_no: 'bank',
};

const EMPTY_DOC = { document_type: '', document_number: '', name: '', relation: '', nationality: '', valid_from: '', valid_till: '' };
const FAMILY_RELATIONS = ['Self', 'Mother', 'Father', 'Sister', 'Brother', 'Cousin', 'Spouse', 'Other'];
const EMPTY_FAMILY = { name: '', relation: '', gender: '', DOB: '', blood_group: '', nationality: '', contact_number: '', alternate_number: '', is_nominee: 'N', emergency_contact: 'N' };

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
  const [activeTab, setActiveTab] = useState<TabKey>('personal');
  const seeded = useRef(false);

  const [showDocForm, setShowDocForm] = useState(false);
  const [docDraft, setDocDraft] = useState(EMPTY_DOC);
  const [docFile, setDocFile] = useState('');
  const [docErrors, setDocErrors] = useState<Record<string, string>>({});
  const [replacingPkey, setReplacingPkey] = useState<number | null>(null);
  const [docSaving, setDocSaving] = useState(false);

  const [showFamilyForm, setShowFamilyForm] = useState(false);
  const [familyDraft, setFamilyDraft] = useState(EMPTY_FAMILY);
  const [familyErrors, setFamilyErrors] = useState<Record<string, string>>({});
  const [familySaving, setFamilySaving] = useState(false);

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

  const { data: nationalities = [] } = useSetupRows<NationalityOption>('setup/nationalities');
  const { data: branches = [] } = useSetupOptions('setup/branches', 'branch_code', 'branch_name');
  const { data: departments = [] } = useSetupOptions('setup/departments', 'dept_code', 'dept_name');
  const { data: designations = [] } = useSetupOptions('setup/designations', 'desig_code', 'desig_name');
  const { data: grades = [] } = useSetupOptions('setup/grades', 'grade_code', 'grade_name');
  const { data: structures = [] } = useSetupOptions('setup/salary-structures', 'structure_id', 'structure_name');
  const { data: shifts = [] } = useSetupOptions('setup/shifts', 'day_time_seq', 'day_time_desc');
  const { data: holidayGroups = [] } = useSetupOptions('setup/holiday-groups', 'HOLIDAY_GROUP_ID', 'HOLIDAY_GROUP_NAME');
  const { data: leavePolicyGroups = [] } = useSetupOptions('setup/leavepolicy-groups', 'LEAVEPOLICY_GROUP_ID', 'LEAVEPOLICY_GROUP_NAME');

  // Seed `form` from the server exactly once — a background refetch (window refocus, a
  // document add/remove invalidating ['employee', id]) must not clobber in-progress edits.
  useEffect(() => {
    if (data?.employee && data?.professional !== undefined && !seeded.current) {
      seeded.current = true;
      const initial = {
        first_name: data.employee.first_name ?? '',
        last_name: data.employee.last_name ?? '',
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
        district: data.employee.city ?? '',
        state: data.employee.state ?? '',
        pincode: data.employee.pincode ?? '',
        guradian: data.employee.guradian ?? '',
        relation_guardian: data.employee.relation_guardian ?? '',
        international_worker: data.employee.international_worker ?? 'N',
        country: data.employee.country ?? '',
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
        day_time_seq: data.professional?.day_time_seq != null ? String(data.professional.day_time_seq) : '',
        holiday_group_id: data.professional?.HOLIDAY_GROUP_ID != null ? String(data.professional.HOLIDAY_GROUP_ID) : '',
        leavepolicy_group_id: data.professional?.LEAVEPOLICY_GROUP_ID != null ? String(data.professional.LEAVEPOLICY_GROUP_ID) : '',
        attr1: data.professional?.attr1 ?? '',
        probation: data.professional?.probation != null ? String(data.professional.probation) : '',
      };
      setForm(initial);
      setSavedSnapshot(JSON.stringify(initial));
    }
  }, [data]);

  const isDirty = savedSnapshot !== '' && JSON.stringify(form) !== savedSnapshot;

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
    setDocFile('');
    setReplacingPkey(Number(row.emp_passport_visa_pkey));
    setDocErrors({});
    setShowDocForm(true);
  }

  async function submitDocument() {
    const errors = {
      document_type: docDraft.document_type ? '' : 'Document type is required',
      document_number: docDraft.document_number.trim() ? '' : 'Document number is required',
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
      if (replacingPkey != null) await removeDocument(replacingPkey);
      await addDocument({ ...docDraft, files: docFile });
      setShowDocForm(false);
    } finally {
      setDocSaving(false);
    }
  }

  function validateAndSave() {
    const ageError = form.joining_date ? (ageAtDateError(form.date_of_birth, form.joining_date) ?? '') : '';
    const errors: Record<string, string> = {
      first_name: form.first_name?.trim() ? '' : 'First name is required',
      classification: form.classification ? '' : 'Gender is required',
      date_of_birth: form.date_of_birth ? (dobError(form.date_of_birth) ?? '') : 'Date of birth is required',
      id_card: form.id_card ? '' : 'Aadhaar/ID Card is required',
      pan_no: panError(form.pan_no ?? '') ?? '',
      pf: pfNumberError(form.pf ?? '') ?? '',
      company_pf: uanError(form.company_pf ?? '') ?? '',
      esi: esiError(form.esi ?? '') ?? '',
      lwf_code: lwfError(form.lwf_code ?? '') ?? '',
      account_no: accountNoError(form.account_no ?? '') ?? '',
    };
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

  function openAddFamily() {
    setFamilyDraft(EMPTY_FAMILY);
    setFamilyErrors({});
    setShowFamilyForm(true);
  }

  async function submitFamily() {
    const errors = {
      name: familyDraft.name.trim() ? '' : 'Name is required',
      relation: familyDraft.relation ? '' : 'Relation is required',
      gender: familyDraft.gender ? '' : 'Gender is required',
      DOB: familyDraft.DOB ? '' : 'Date of birth is required',
      contact_number: familyDraft.contact_number.trim() ? '' : 'Contact number is required',
    };
    if (Object.values(errors).some(Boolean)) {
      setFamilyErrors(errors);
      return;
    }
    setFamilyErrors({});
    setFamilySaving(true);
    try {
      await addFamilyMember(familyDraft);
      setShowFamilyForm(false);
    } finally {
      setFamilySaving(false);
    }
  }

  if (isLoading) return <div className="p-10 text-center text-sm text-slate-500">Loading…</div>;
  if (!data?.employee) return <div className="p-10 text-center text-sm text-[color:var(--color-danger)]">Employee not found.</div>;

  const emp = data.employee;
  const prof = data.professional;
  const ctc = data.ctc;
  const embedded = !showBackLink;
  const statusInfo = STATUS_BADGE[Number(emp.status)] ?? STATUS_BADGE[1];
  const headerName = `${emp.first_name} ${emp.last_name}`.trim();
  const metaParts = [
    `EMP ${emp.emp_id}`,
    emp.desig_name,
    emp.emp_branch_name,
    emp.dept_name,
  ].filter(Boolean);

  return (
    <div className={cn('flex flex-col -m-6', embedded && 'max-h-[calc(90vh-3rem)]')}>
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
              imageUrl={form.profile_pic || emp.profile_pic}
              onUploaded={(path) => setForm((prev) => ({ ...prev, profile_pic: path }))}
              className="w-12 h-12 flex-shrink-0"
              avatarClassName="text-sm"
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
        {TABS.map((tab) => {
          if (tab.key !== activeTab) return null;
          const Icon = tab.icon;
          return (
            <div key={tab.key}>
              <div className="flex items-center gap-2.5 mb-6">
                <span className="w-8 h-8 rounded-lg bg-[color:var(--color-primary)]/8 text-[color:var(--color-primary)] flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4" strokeWidth={1.75} />
                </span>
                <div>
                  <h2 className="text-[15px] font-semibold text-[#0F172A]">{tab.title}</h2>
                  <p className="text-[12.5px] text-slate-400">{tab.subtitle}</p>
                </div>
              </div>

              {tab.key === 'personal' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 max-w-3xl">
                  <div>
                    <label className={LABEL_CLASS}>First Name<RequiredMark /></label>
                    <input maxLength={100} className={cn(INPUT_CLASS, fieldErrors.first_name && ERROR_INPUT_CLASS)} {...f('first_name')} />
                    <FieldError>{fieldErrors.first_name}</FieldError>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Last Name</label>
                    <input maxLength={100} className={INPUT_CLASS} {...f('last_name')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Date of Birth<RequiredMark /></label>
                    <input type="date" className={cn(INPUT_CLASS, fieldErrors.date_of_birth && ERROR_INPUT_CLASS)} {...f('date_of_birth')} />
                    <FieldError>{fieldErrors.date_of_birth}</FieldError>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Gender<RequiredMark /></label>
                    <select className={cn(INPUT_CLASS, fieldErrors.classification && ERROR_INPUT_CLASS)} {...f('classification')}>
                      <option value="">Select</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                    <FieldError>{fieldErrors.classification}</FieldError>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Mobile</label>
                    <input type="tel" maxLength={10} className={INPUT_CLASS} {...f('mobile_no')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Email</label>
                    <input type="email" className={INPUT_CLASS} {...f('email')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Blood Group</label>
                    <select className={INPUT_CLASS} {...f('blood')}>
                      <option value="">Select</option>
                      {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => <option key={bg} value={bg}>{bg}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Marital Status</label>
                    <select className={INPUT_CLASS} {...f('maritual_status')}>
                      <option value="">Select</option>
                      <option value="Single">Single</option>
                      <option value="Married">Married</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>ID Card Number<RequiredMark /></label>
                    <input maxLength={12} className={cn(INPUT_CLASS, fieldErrors.id_card && ERROR_INPUT_CLASS)} {...f('id_card')} />
                    <FieldError>{fieldErrors.id_card}</FieldError>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>LWF Code</label>
                    <input
                      maxLength={15}
                      className={cn(INPUT_CLASS, fieldErrors.lwf_code && ERROR_INPUT_CLASS)}
                      {...f('lwf_code')}
                      onChange={(e) => setForm((prev) => ({ ...prev, lwf_code: e.target.value.toUpperCase() }))}
                    />
                    <FieldError>{fieldErrors.lwf_code}</FieldError>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>WPS ID</label>
                    <input className={INPUT_CLASS} {...f('wps_code')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Previous Member ID</label>
                    <input className={INPUT_CLASS} {...f('previous_member_id')} />
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
                    <label className={LABEL_CLASS}>Pincode</label>
                    <input maxLength={6} className={INPUT_CLASS} {...f('pincode')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Guardian Name</label>
                    <input className={INPUT_CLASS} {...f('guradian')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Relation to Guardian</label>
                    <input className={INPUT_CLASS} {...f('relation_guardian')} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={LABEL_CLASS}>Address</label>
                    <textarea
                      rows={2}
                      className={cn(INPUT_CLASS, 'h-auto py-2.5')}
                      value={form.address ?? ''}
                      onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                    />
                  </div>

                  <div className="sm:col-span-2 flex flex-col gap-3 pt-1">
                    {checkbox('international_worker', 'International Worker')}
                    {form.international_worker === 'Y' && (
                      <div className="max-w-xs">
                        <label className={LABEL_CLASS}>Country of Origin</label>
                        <select className={INPUT_CLASS} {...f('country')}>
                          <option value="">Select country</option>
                          {nationalities.map((n) => <option key={n.id} value={n.id}>{n.country_name}</option>)}
                        </select>
                      </div>
                    )}
                    {checkbox('physical_handicap', 'Physical Handicap')}
                    {form.physical_handicap === 'Y' && (
                      <div className="flex flex-wrap gap-4 pl-1">
                        {checkbox('locomotive', 'Locomotive')}
                        {checkbox('hearing', 'Hearing')}
                        {checkbox('visual', 'Visual')}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tab.key === 'professional' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 max-w-3xl">
                  <div>
                    <label className={LABEL_CLASS}>Joining Date</label>
                    <input type="date" className={INPUT_CLASS} {...f('joining_date')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Employment Type</label>
                    <select className={INPUT_CLASS} {...f('emp_type')}>
                      <option value="">Select</option>
                      {EMP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {[
                    { key: 'emp_branch', label: 'Branch', opts: branches },
                    { key: 'emp_dept', label: 'Department', opts: departments },
                    { key: 'designation', label: 'Designation', opts: designations },
                    { key: 'emp_grade', label: 'Grade', opts: grades },
                    { key: 'day_time_seq', label: 'Shift Policy', opts: shifts },
                    { key: 'holiday_group_id', label: 'Holiday Group', opts: holidayGroups },
                    { key: 'leavepolicy_group_id', label: 'Leave Policy Group', opts: leavePolicyGroups },
                  ].map(({ key, label, opts }) => (
                    <div key={key}>
                      <label className={LABEL_CLASS}>{label}</label>
                      <select className={INPUT_CLASS} {...f(key)}>
                        <option value="">Select {label.toLowerCase()}</option>
                        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  ))}
                  <div>
                    <label className={LABEL_CLASS}>Probation Period (days)</label>
                    <input type="number" className={INPUT_CLASS} {...f('probation')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Reporting Manager</label>
                    <EmployeeSearch
                      value={form.attr1 ?? ''}
                      onChange={(empPkey) => setForm((prev) => ({ ...prev, attr1: empPkey }))}
                    />
                  </div>
                </div>
              )}

              {tab.key === 'statutory' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 max-w-3xl">
                  {structures.length > 0 || ctc ? (
                    <div className="sm:col-span-2 rounded-lg bg-slate-50 border border-slate-100 px-4 py-3.5 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 mb-1">
                      <div>
                        <p className="text-[11px] text-slate-400 mb-0.5">Salary Structure</p>
                        <p className="text-[13px] font-medium text-[#0F172A]">
                          {structures.find((s) => s.value === String(prof?.structure_id))?.label || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-400 mb-0.5">Annual CTC</p>
                        <p className="text-[13px] font-medium text-[#0F172A]">{ctc?.emp_anual_ctc ?? '—'}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-400 mb-0.5">Monthly CTC</p>
                        <p className="text-[13px] font-medium text-[#0F172A]">{ctc?.emp_monthly_ctc ?? '—'}</p>
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <label className={LABEL_CLASS}>PAN Number</label>
                    <input
                      maxLength={10}
                      className={cn(INPUT_CLASS, fieldErrors.pan_no && ERROR_INPUT_CLASS)}
                      {...f('pan_no')}
                      onChange={(e) => setForm((prev) => ({ ...prev, pan_no: e.target.value.toUpperCase() }))}
                    />
                    {fieldErrors.pan_no ? <FieldError>{fieldErrors.pan_no}</FieldError> : <HelperText>Format: ABCDE1234F</HelperText>}
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>PF Number</label>
                    <input maxLength={22} className={cn(INPUT_CLASS, fieldErrors.pf && ERROR_INPUT_CLASS)} {...f('pf')} />
                    <FieldError>{fieldErrors.pf}</FieldError>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Company PF</label>
                    <input maxLength={12} className={cn(INPUT_CLASS, fieldErrors.company_pf && ERROR_INPUT_CLASS)} {...f('company_pf')} />
                    <FieldError>{fieldErrors.company_pf}</FieldError>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>EPS</label>
                    <input className={INPUT_CLASS} {...f('eps')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>ESIC Number</label>
                    <input maxLength={10} className={cn(INPUT_CLASS, fieldErrors.esi && ERROR_INPUT_CLASS)} {...f('esi')} />
                    {fieldErrors.esi ? <FieldError>{fieldErrors.esi}</FieldError> : <HelperText>10 digits</HelperText>}
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>ESI Dispensary</label>
                    <input className={INPUT_CLASS} {...f('esi_dispensary')} />
                  </div>
                </div>
              )}

              {tab.key === 'bank' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 max-w-3xl">
                  <div>
                    <label className={LABEL_CLASS}>Bank Name</label>
                    <input maxLength={100} className={INPUT_CLASS} {...f('bank_name')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Bank Branch</label>
                    <input maxLength={100} className={INPUT_CLASS} {...f('bank_branch_name')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>IFSC Code</label>
                    <input maxLength={12} className={INPUT_CLASS} {...f('ifsc_code')} />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Account Number</label>
                    <input maxLength={18} className={cn(INPUT_CLASS, fieldErrors.account_no && ERROR_INPUT_CLASS)} {...f('account_no')} />
                    <FieldError>{fieldErrors.account_no}</FieldError>
                  </div>
                </div>
              )}

              {tab.key === 'documents' && (
                <div className="max-w-3xl">
                  {documents.length === 0 && !showDocForm && (
                    <p className="text-sm text-slate-400 py-6 text-center border border-dashed border-slate-200 rounded-lg">
                      No documents added yet.
                    </p>
                  )}
                  {documents.length > 0 && (
                    <div className="space-y-2.5">
                      {documents.map((row) => {
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
                                <a
                                  href={String(row.files)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-2 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-slate-50 transition-colors duration-150"
                                  title="View"
                                >
                                  <Eye className="w-4 h-4" />
                                </a>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => openReplaceDocument(row)}
                                className="p-2 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-slate-50 transition-colors duration-150"
                                title="Replace"
                              >
                                <RefreshCw className="w-4 h-4" />
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
                        {replacingPkey != null ? 'Replace Document' : 'Add Document'}
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                        <div>
                          <label className={LABEL_CLASS}>Document Type<RequiredMark /></label>
                          <select
                            className={cn(INPUT_CLASS, docErrors.document_type && ERROR_INPUT_CLASS)}
                            value={docDraft.document_type}
                            onChange={(e) => setDocDraft((p) => ({ ...p, document_type: e.target.value }))}
                          >
                            <option value="">Select type</option>
                            {DOCUMENT_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                          <FieldError>{docErrors.document_type}</FieldError>
                        </div>
                        <div>
                          <label className={LABEL_CLASS}>Document Number<RequiredMark /></label>
                          <input
                            className={cn(INPUT_CLASS, docErrors.document_number && ERROR_INPUT_CLASS)}
                            value={docDraft.document_number}
                            onChange={(e) => setDocDraft((p) => ({ ...p, document_number: e.target.value }))}
                          />
                          <FieldError>{docErrors.document_number}</FieldError>
                        </div>
                        <div>
                          <label className={LABEL_CLASS}>Name on Document<RequiredMark /></label>
                          <input
                            className={cn(INPUT_CLASS, docErrors.name && ERROR_INPUT_CLASS)}
                            value={docDraft.name}
                            onChange={(e) => setDocDraft((p) => ({ ...p, name: e.target.value }))}
                          />
                          <FieldError>{docErrors.name}</FieldError>
                        </div>
                        <div>
                          <label className={LABEL_CLASS}>Relation<RequiredMark /></label>
                          <input
                            className={cn(INPUT_CLASS, docErrors.relation && ERROR_INPUT_CLASS)}
                            value={docDraft.relation}
                            onChange={(e) => setDocDraft((p) => ({ ...p, relation: e.target.value }))}
                          />
                          <FieldError>{docErrors.relation}</FieldError>
                        </div>
                        <div>
                          <label className={LABEL_CLASS}>Nationality</label>
                          <input
                            className={INPUT_CLASS}
                            value={docDraft.nationality}
                            onChange={(e) => setDocDraft((p) => ({ ...p, nationality: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className={LABEL_CLASS}>Valid From<RequiredMark /></label>
                          <input
                            type="date"
                            className={cn(INPUT_CLASS, docErrors.valid_from && ERROR_INPUT_CLASS)}
                            value={docDraft.valid_from}
                            onChange={(e) => setDocDraft((p) => ({ ...p, valid_from: e.target.value }))}
                          />
                          <FieldError>{docErrors.valid_from}</FieldError>
                        </div>
                        <div>
                          <label className={LABEL_CLASS}>Valid Till</label>
                          <input
                            type="date"
                            className={INPUT_CLASS}
                            value={docDraft.valid_till}
                            onChange={(e) => setDocDraft((p) => ({ ...p, valid_till: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="mt-4">
                        <label className={LABEL_CLASS}>File Upload</label>
                        <DocumentUploadField value={docFile} onChange={setDocFile} />
                      </div>
                      <div className="flex items-center gap-2 mt-5">
                        <button
                          type="button"
                          onClick={submitDocument}
                          disabled={docSaving}
                          className="px-4 py-2 text-sm font-medium bg-[color:var(--color-primary)] hover:opacity-90 disabled:opacity-50 text-white rounded-lg transition-opacity duration-150"
                        >
                          {docSaving ? 'Saving…' : replacingPkey != null ? 'Save Replacement' : 'Save Document'}
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
                </div>
              )}

              {tab.key === 'family' && (
                <div className="max-w-3xl">
                  {family.length === 0 && !showFamilyForm && (
                    <p className="text-sm text-slate-400 py-6 text-center border border-dashed border-slate-200 rounded-lg">
                      No family members added yet.
                    </p>
                  )}
                  {family.length > 0 && (
                    <div className="space-y-2.5">
                      {family.map((row) => {
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
                      <h3 className="text-sm font-semibold text-[#0F172A] mb-4">Add Family Member</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                        <div>
                          <label className={LABEL_CLASS}>Name<RequiredMark /></label>
                          <input
                            maxLength={100}
                            className={cn(INPUT_CLASS, familyErrors.name && ERROR_INPUT_CLASS)}
                            value={familyDraft.name}
                            onChange={(e) => setFamilyDraft((p) => ({ ...p, name: e.target.value }))}
                          />
                          <FieldError>{familyErrors.name}</FieldError>
                        </div>
                        <div>
                          <label className={LABEL_CLASS}>Relation<RequiredMark /></label>
                          <select
                            className={cn(INPUT_CLASS, familyErrors.relation && ERROR_INPUT_CLASS)}
                            value={familyDraft.relation}
                            onChange={(e) => setFamilyDraft((p) => ({ ...p, relation: e.target.value }))}
                          >
                            <option value="">Select relation</option>
                            {FAMILY_RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <FieldError>{familyErrors.relation}</FieldError>
                        </div>
                        <div>
                          <label className={LABEL_CLASS}>Gender<RequiredMark /></label>
                          <select
                            className={cn(INPUT_CLASS, familyErrors.gender && ERROR_INPUT_CLASS)}
                            value={familyDraft.gender}
                            onChange={(e) => setFamilyDraft((p) => ({ ...p, gender: e.target.value }))}
                          >
                            <option value="">Select gender</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                          </select>
                          <FieldError>{familyErrors.gender}</FieldError>
                        </div>
                        <div>
                          <label className={LABEL_CLASS}>Date of Birth<RequiredMark /></label>
                          <input
                            type="date"
                            className={cn(INPUT_CLASS, familyErrors.DOB && ERROR_INPUT_CLASS)}
                            value={familyDraft.DOB}
                            onChange={(e) => setFamilyDraft((p) => ({ ...p, DOB: e.target.value }))}
                          />
                          <FieldError>{familyErrors.DOB}</FieldError>
                        </div>
                        <div>
                          <label className={LABEL_CLASS}>Blood Group</label>
                          <input
                            maxLength={5}
                            className={INPUT_CLASS}
                            value={familyDraft.blood_group}
                            onChange={(e) => setFamilyDraft((p) => ({ ...p, blood_group: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className={LABEL_CLASS}>Nationality</label>
                          <input
                            className={INPUT_CLASS}
                            value={familyDraft.nationality}
                            onChange={(e) => setFamilyDraft((p) => ({ ...p, nationality: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className={LABEL_CLASS}>Contact Number<RequiredMark /></label>
                          <input
                            maxLength={10}
                            className={cn(INPUT_CLASS, familyErrors.contact_number && ERROR_INPUT_CLASS)}
                            value={familyDraft.contact_number}
                            onChange={(e) => setFamilyDraft((p) => ({ ...p, contact_number: e.target.value }))}
                          />
                          <FieldError>{familyErrors.contact_number}</FieldError>
                        </div>
                        <div>
                          <label className={LABEL_CLASS}>Alternative Number</label>
                          <input
                            maxLength={10}
                            className={INPUT_CLASS}
                            value={familyDraft.alternate_number}
                            onChange={(e) => setFamilyDraft((p) => ({ ...p, alternate_number: e.target.value }))}
                          />
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
                      <div className="flex items-center gap-2 mt-5">
                        <button
                          type="button"
                          onClick={submitFamily}
                          disabled={familySaving}
                          className="px-4 py-2 text-sm font-medium bg-[color:var(--color-primary)] hover:opacity-90 disabled:opacity-50 text-white rounded-lg transition-opacity duration-150"
                        >
                          {familySaving ? 'Saving…' : 'Save Family Member'}
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
                </div>
              )}
            </div>
          );
        })}
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
