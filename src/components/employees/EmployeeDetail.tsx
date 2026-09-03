'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, User, Briefcase, Wallet, Landmark } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { AvatarUpload } from '@/components/ui/AvatarUpload';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { RepeatableRows } from '@/components/employees/RepeatableRows';
import { DocumentUploadField } from '@/components/employees/DocumentUploadField';

interface SelectOption { value: string; label: string }

const DOCUMENT_TYPES = ['Aadhaar', 'PAN', 'Passport', 'Driving License', 'Voter ID', 'Educational Certificate', 'Offer Letter', 'Relieving Letter', 'Other'];

const INPUT_CLASS = 'w-full px-3 py-2 border border-slate-200 rounded-xl text-sm text-[#0F172A] bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/40';
const LABEL_CLASS = 'block text-xs text-slate-500 mb-1.5';
const SECTION_CLASS = 'rounded-2xl border border-slate-100 bg-slate-50/50 p-5';

const SECTION_ACCENT = {
  primary: 'bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]',
  accent: 'bg-[color:var(--color-accent)]/10 text-[color:var(--color-accent)]',
  success: 'bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]',
} as const;

function useSetupOptions(path: string, codeKey: string, nameKey: string) {
  // The ['setup/*'] query keys are shared app-wide and get filled with inconsistent shapes
  // (raw API rows, {code, name} maps, {value, label} maps) depending on which page loads
  // first — React Query keys the cache by queryKey alone, so the first writer wins and the
  // others read a shape they can't render (blank <option>s). Cache the raw rows and shape
  // per-component via `select`, falling back to value/label so any cached shape still renders.
  return useQuery<Record<string, unknown>[], Error, SelectOption[]>({
    queryKey: [path],
    queryFn: () => fetch(`/api/${path}`).then((r) => r.json()),
    select: (rows) =>
      (rows ?? []).map((r) => ({
        value: String(r[codeKey] ?? r.value ?? ''),
        label: String(r[nameKey] ?? r.label ?? ''),
      })),
  });
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
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [docFile, setDocFile] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => fetch(`/api/employees/${id}`).then((r) => r.json()),
  });

  const { data: documents = [] } = useQuery<Record<string, unknown>[]>({
    queryKey: ['employee', id, 'documents'],
    queryFn: () => fetch(`/api/employees/${id}/documents`).then((r) => r.json()),
  });

  const { data: branches = [] } = useSetupOptions('setup/branches', 'branch_code', 'branch_name');
  const { data: departments = [] } = useSetupOptions('setup/departments', 'dept_code', 'dept_name');
  const { data: designations = [] } = useSetupOptions('setup/designations', 'desig_code', 'desig_name');
  const { data: grades = [] } = useSetupOptions('setup/grades', 'grade_code', 'grade_name');
  const { data: structures = [] } = useSetupOptions('setup/salary-structures', 'structure_id', 'structure_name');

  useEffect(() => {
    if (data?.employee && data?.professional !== undefined) {
      setForm({
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
        pan_no: data.employee.pan_no ?? '',
        name_as_on_pan: data.employee.name_as_on_pan ?? '',
        pf: data.employee.pf ?? '',
        company_pf: data.employee.company_pf ?? '',
        eps: data.employee.eps ?? '',
        esi: data.employee.esi ?? '',
        esi_dispensary: data.employee.esi_dispensary ?? '',
        bank_name: data.employee.bank_name ?? '',
        bank_branch_name: data.employee.branch_name ?? '',
        branch_address: data.employee.branch_address ?? '',
        name_as_per_bank: data.employee.name_as_per_bank ?? '',
        ifsc_code: data.employee.ifsc_code ?? '',
        account_no: data.employee.account_no ?? '',
        joining_date: data.professional?.joining_date?.split('T')[0] ?? '',
        emp_branch: data.professional?.emp_branch ?? '',
        emp_dept: data.professional?.emp_dept ?? '',
        designation: data.professional?.designation ?? '',
        emp_grade: data.professional?.emp_grade ?? '',
        emp_type: data.professional?.emp_type ?? '',
        attr1: data.professional?.attr1 ?? '',
        probation: data.professional?.probation != null ? String(data.professional.probation) : '',
        structure_id: data.professional?.structure_id != null ? String(data.professional.structure_id) : '',
        emp_anual_ctc: data.ctc?.emp_anual_ctc != null ? String(data.ctc.emp_anual_ctc) : '',
        emp_monthly_ctc: data.ctc?.emp_monthly_ctc != null ? String(data.ctc.emp_monthly_ctc) : '',
      });
    }
  }, [data]);

  const update = useMutation({
    mutationFn: () =>
      fetch(`/api/employees/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee', id] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  async function addDocument(values: Record<string, string>) {
    await fetch(`/api/employees/${id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, files: docFile }),
    });
    setDocFile('');
    queryClient.invalidateQueries({ queryKey: ['employee', id, 'documents'] });
  }

  async function removeDocument(pkey: number) {
    await fetch(`/api/employees/${id}/documents/${pkey}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['employee', id, 'documents'] });
  }

  if (isLoading) return <div className="text-slate-500 text-sm">Loading...</div>;
  if (!data?.employee) return <div className="text-[color:var(--color-danger)]">Employee not found.</div>;

  const emp = data.employee;
  const prof = data.professional;
  const ctc = data.ctc;

  function f(key: string) {
    return {
      value: form[key] ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm((prev) => ({ ...prev, [key]: e.target.value })),
      disabled: !editing,
    };
  }

  function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
    return (
      <div>
        <p className="text-[12.5px] text-slate-500 mb-1">{label}</p>
        <p className={cn('text-[14px] font-medium text-[#0F172A]', !value && 'text-slate-300 font-normal')}>
          {value || '—'}
        </p>
      </div>
    );
  }

  function SectionHeader({ icon: Icon, accent, children }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; accent: keyof typeof SECTION_ACCENT; children: React.ReactNode }) {
    return (
      <div className="flex items-center gap-2 mb-4">
        <span className={cn('w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0', SECTION_ACCENT[accent])}>
          <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
        </span>
        <h2 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">{children}</h2>
      </div>
    );
  }

  return (
    <div>
      <div className="sticky top-0 z-[5] -mx-6 -mt-6 mb-6 rounded-t-2xl bg-white/95 backdrop-blur-sm border-b border-slate-100 px-6 pt-6 pb-5">
        {showBackLink && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4 transition-colors duration-[180ms]"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Employees
          </button>
        )}
        <div className="flex items-start justify-between gap-4 pr-14">
          <div className="flex items-center gap-3.5 min-w-0">
            <AvatarUpload
              name={`${emp.first_name} ${emp.last_name}`}
              imageUrl={form.profile_pic || emp.profile_pic}
              onUploaded={(path) => setForm((prev) => ({ ...prev, profile_pic: path }))}
              disabled={!editing}
              className="w-11 h-11 flex-shrink-0"
              avatarClassName="text-sm"
            />
            <div className="min-w-0">
              <h1 className="font-heading text-[22px] font-bold text-[#0F172A] tracking-tight leading-tight truncate">
                {emp.first_name} {emp.last_name}
              </h1>
              <p className="text-[13px] text-slate-500 mt-0.5">
                EMP {emp.emp_id} · {emp.desig_name ?? '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 flex-shrink-0">
            {saved && <span className="text-xs font-medium text-[color:var(--color-success)]">Saved</span>}
            {editing ? (
              <>
                <button
                  onClick={() => setEditing(false)}
                  className="px-3.5 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-[180ms]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => update.mutate()}
                  disabled={update.isPending}
                  className="px-4 py-2 text-sm font-medium bg-[color:var(--color-primary)] hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100 text-white rounded-xl shadow-lg shadow-[color:var(--color-primary)]/20 transition-all duration-[180ms]"
                >
                  {update.isPending ? 'Saving…' : 'Save Changes'}
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-white border border-slate-200 hover:border-[color:var(--color-primary)]/40 hover:text-[color:var(--color-primary)] text-slate-700 rounded-xl transition-colors duration-[180ms]"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Personal Details */}
        <div className={SECTION_CLASS}>
          <SectionHeader icon={User} accent="primary">Personal Details</SectionHeader>
          {editing ? (
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className={LABEL_CLASS}>First Name</label>
                  <input className={INPUT_CLASS} {...f('first_name')} />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Last Name</label>
                  <input className={INPUT_CLASS} {...f('last_name')} />
                </div>
              </div>
              <div>
                <label className={LABEL_CLASS}>Date of Birth</label>
                <input type="date" className={INPUT_CLASS} {...f('date_of_birth')} />
              </div>
              <div>
                <label className={LABEL_CLASS}>Mobile</label>
                <input type="tel" className={INPUT_CLASS} {...f('mobile_no')} />
              </div>
              <div>
                <label className={LABEL_CLASS}>Email</label>
                <input type="email" className={INPUT_CLASS} {...f('email')} />
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className={LABEL_CLASS}>Gender</label>
                  <select className={INPUT_CLASS} {...f('classification')}>
                    <option value="">Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLASS}>Blood Group</label>
                  <select className={INPUT_CLASS} {...f('blood')}>
                    <option value="">Select</option>
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => <option key={bg} value={bg}>{bg}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL_CLASS}>Marital Status</label>
                <select className={INPUT_CLASS} {...f('maritual_status')}>
                  <option value="">Select</option>
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className={LABEL_CLASS}>ID Card Number</label>
                  <input className={INPUT_CLASS} {...f('id_card')} />
                </div>
                <div>
                  <label className={LABEL_CLASS}>LWF Code</label>
                  <input className={INPUT_CLASS} {...f('lwf_code')} />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              <InfoRow label="Employee ID" value={emp.emp_id} />
              <InfoRow label="Date of Birth" value={formatDate(emp.date_of_birth)} />
              <InfoRow label="Mobile" value={emp.mobile_no} />
              <InfoRow label="Email" value={emp.email} />
              <InfoRow label="Gender" value={emp.classification} />
              <InfoRow label="Blood Group" value={emp.blood} />
              <InfoRow label="Marital Status" value={emp.maritual_status} />
              <InfoRow label="ID Card" value={emp.id_card} />
              <InfoRow label="LWF Code" value={emp.lwf_code} />
            </div>
          )}
        </div>

        {/* Professional Details */}
        <div className={SECTION_CLASS}>
          <SectionHeader icon={Briefcase} accent="accent">Professional Details</SectionHeader>
          {editing ? (
            <div className="space-y-3.5">
              <div>
                <label className={LABEL_CLASS}>Joining Date</label>
                <input type="date" className={INPUT_CLASS} {...f('joining_date')} />
              </div>
              <div>
                <label className={LABEL_CLASS}>Employment Type</label>
                <select className={INPUT_CLASS} {...f('emp_type')}>
                  <option value="">Select</option>
                  <option value="Permanent">Permanent</option>
                  <option value="Contract">Contract</option>
                  <option value="Trainee">Trainee</option>
                  <option value="Intern">Intern</option>
                </select>
              </div>
              {[
                { key: 'emp_branch', label: 'Branch', opts: branches },
                { key: 'emp_dept', label: 'Department', opts: departments },
                { key: 'designation', label: 'Designation', opts: designations },
                { key: 'emp_grade', label: 'Grade', opts: grades },
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
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              <InfoRow label="Joining Date" value={formatDate(prof?.joining_date)} />
              <InfoRow label="Branch" value={emp.emp_branch_name} />
              <InfoRow label="Department" value={emp.dept_name} />
              <InfoRow label="Designation" value={emp.desig_name} />
              <InfoRow label="Grade" value={emp.grade_name} />
              <InfoRow label="Employment Type" value={prof?.emp_type} />
              <InfoRow label="Probation (days)" value={prof?.probation} />
              <InfoRow label="Reporting Manager" value={emp.manager_first_name ? `${emp.manager_first_name} ${emp.manager_last_name ?? ''}` : ''} />
            </div>
          )}
        </div>

        {/* Salary & Statutory */}
        <div className={SECTION_CLASS}>
          <SectionHeader icon={Wallet} accent="success">Salary &amp; Statutory</SectionHeader>
          {editing ? (
            <div className="space-y-3.5">
              <div>
                <label className={LABEL_CLASS}>Salary Structure</label>
                <select className={INPUT_CLASS} {...f('structure_id')}>
                  <option value="">Select structure</option>
                  {structures.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className={LABEL_CLASS}>Annual CTC</label>
                  <input type="number" className={INPUT_CLASS} {...f('emp_anual_ctc')} />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Monthly CTC</label>
                  <input type="number" className={INPUT_CLASS} {...f('emp_monthly_ctc')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className={LABEL_CLASS}>PAN Number</label>
                  <input className={INPUT_CLASS} {...f('pan_no')} />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Name as on PAN</label>
                  <input className={INPUT_CLASS} {...f('name_as_on_pan')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className={LABEL_CLASS}>PF Number</label>
                  <input className={INPUT_CLASS} {...f('pf')} />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Company PF</label>
                  <input className={INPUT_CLASS} {...f('company_pf')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className={LABEL_CLASS}>EPS</label>
                  <input className={INPUT_CLASS} {...f('eps')} />
                </div>
                <div>
                  <label className={LABEL_CLASS}>ESIC Number</label>
                  <input className={INPUT_CLASS} {...f('esi')} />
                </div>
              </div>
              <div>
                <label className={LABEL_CLASS}>ESI Dispensary</label>
                <input className={INPUT_CLASS} {...f('esi_dispensary')} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              <InfoRow label="Salary Structure" value={structures.find((s) => s.value === String(prof?.structure_id))?.label} />
              <InfoRow label="Annual CTC" value={ctc?.emp_anual_ctc} />
              <InfoRow label="Monthly CTC" value={ctc?.emp_monthly_ctc} />
              <InfoRow label="PAN Number" value={emp.pan_no} />
              <InfoRow label="PF Number" value={emp.pf} />
              <InfoRow label="ESIC Number" value={emp.esi} />
            </div>
          )}
        </div>

        {/* Bank Details */}
        <div className={SECTION_CLASS}>
          <SectionHeader icon={Landmark} accent="primary">Bank Details</SectionHeader>
          {editing ? (
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className={LABEL_CLASS}>Bank Name</label>
                  <input className={INPUT_CLASS} {...f('bank_name')} />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Bank Branch</label>
                  <input className={INPUT_CLASS} {...f('bank_branch_name')} />
                </div>
              </div>
              <div>
                <label className={LABEL_CLASS}>Name as per Bank</label>
                <input className={INPUT_CLASS} {...f('name_as_per_bank')} />
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className={LABEL_CLASS}>IFSC Code</label>
                  <input className={INPUT_CLASS} {...f('ifsc_code')} />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Account Number</label>
                  <input className={INPUT_CLASS} {...f('account_no')} />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              <InfoRow label="Bank Name" value={emp.bank_name} />
              <InfoRow label="Bank Branch" value={emp.branch_name} />
              <InfoRow label="Name as per Bank" value={emp.name_as_per_bank} />
              <InfoRow label="IFSC Code" value={emp.ifsc_code} />
              <InfoRow label="Account Number" value={emp.account_no} />
            </div>
          )}
        </div>
      </div>

      <div className={cn(SECTION_CLASS, 'mt-5')}>
        <h2 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider mb-4">Documents</h2>
        <div className="mb-3 max-w-sm">
          <label className={LABEL_CLASS}>Upload file (attach before adding a row below)</label>
          <DocumentUploadField value={docFile} onChange={setDocFile} />
        </div>
        <RepeatableRows
          pkeyField="emp_passport_visa_pkey"
          rows={documents}
          addLabel="Add document"
          onAdd={addDocument}
          onRemove={removeDocument}
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
      </div>
    </div>
  );
}
