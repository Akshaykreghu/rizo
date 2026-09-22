'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { FileUploadField } from '@/components/employees/FileUploadField';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { useSetupOptions } from '@/lib/setupOptions';
import { EMP_TYPES } from '@/lib/employeeOptions';
import {
  dobError, aadhaarError, panError, esiError, uanError, lwfError, accountNoError, pfNumberError,
} from '@/lib/validation';
import { RequiredMark } from '@/components/ui/RequiredMark';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { cn } from '@/lib/utils';

// Matches the local .input class's box model (padding 0.5rem 0.75rem, border #d1d5db, radius
// 0.5rem, text-sm) so the searchable dropdown trigger lines up with this form's plain inputs.
const SELECT_BUTTON_CLASS = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';

// Matches lib/validation.ts's dobError (18-years-minimum) check — caps the calendar itself at
// that same boundary instead of only rejecting an underage pick after submit.
const MAX_DOB = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
})();

const EMPTY_FORM = {
  emp_id: '', first_name: '', last_name: '', date_of_birth: '',
  mobile_no: '', email: '',
  classification: '', blood: '', maritual_status: '', profile_pic: '',
  id_card: '', lwf_code: '',
  joining_date: '', emp_branch: '', emp_dept: '', designation: '', emp_grade: '',
  emp_type: '', attr1: '', probation: '',
  pan_no: '', pf: '', company_pf: '', eps: '', esi: '', esi_dispensary: '',
  bank_name: '', bank_branch_name: '', branch_address: '', ifsc_code: '', account_no: '',
};

export default function NewEmployeePage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data: branches = [] } = useSetupOptions('setup/branches', 'branch_code', 'branch_name');
  const { data: departments = [] } = useSetupOptions('setup/departments', 'dept_code', 'dept_name');
  const { data: designations = [] } = useSetupOptions('setup/designations', 'desig_code', 'desig_name');
  const { data: grades = [] } = useSetupOptions('setup/grades', 'grade_code', 'grade_name');

  // Single source of truth for both live (on-type) and submit-time validation, so the two never
  // drift apart — legacy's setup.ctp runs the same per-field regex on 'keyup blur', not just on
  // submit (liveValidate()), which is what these fields were missing before.
  const fieldValidators: Partial<Record<keyof typeof EMPTY_FORM, (v: string) => string>> = {
    first_name: (v) => v.trim() ? '' : 'First name is required',
    classification: (v) => v ? '' : 'Gender is required',
    date_of_birth: (v) => v ? (dobError(v) ?? '') : 'Date of birth is required',
    id_card: (v) => v ? (aadhaarError(v) ?? '') : 'Aadhaar/ID Card is required',
    pan_no: (v) => panError(v) ?? '',
    pf: (v) => pfNumberError(v) ?? '',
    company_pf: (v) => uanError(v) ?? '',
    esi: (v) => esiError(v) ?? '',
    lwf_code: (v) => lwfError(v) ?? '',
    account_no: (v) => accountNoError(v) ?? '',
  };

  function validate(): boolean {
    const errors = Object.fromEntries(
      Object.entries(fieldValidators).map(([key, fn]) => [key, fn(form[key as keyof typeof EMPTY_FORM])])
    );
    if (Object.values(errors).some(Boolean)) {
      setFieldErrors(errors);
      return false;
    }
    setFieldErrors({});
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) { setError((await res.json()).error ?? 'Failed to create employee'); return; }
      const data = await res.json();
      router.push(`/employees/${data.emp_pkey}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  function updateField(key: keyof typeof EMPTY_FORM, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    const validator = fieldValidators[key];
    if (validator) setFieldErrors((prev) => ({ ...prev, [key]: validator(value) }));
  }

  function f(key: keyof typeof EMPTY_FORM) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => updateField(key, e.target.value),
    };
  }

  return (
    <div>
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-5 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Add New Employee</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl space-y-6">
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Personal Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Employee ID</label>
              <input className="input" {...f('emp_id')} placeholder="Leave blank to auto-generate" />
            </div>
            <div>
              <label className="label">Date of Birth <RequiredMark /></label>
              <input type="date" max={MAX_DOB} className={cn('input', fieldErrors.date_of_birth && 'input-error')} {...f('date_of_birth')} />
              {fieldErrors.date_of_birth && <p className="field-error">{fieldErrors.date_of_birth}</p>}
            </div>
            <div>
              <label className="label">First Name <RequiredMark /></label>
              <input className={cn('input', fieldErrors.first_name && 'input-error')} {...f('first_name')} />
              {fieldErrors.first_name && <p className="field-error">{fieldErrors.first_name}</p>}
            </div>
            <div>
              <label className="label">Last Name</label>
              <input className="input" {...f('last_name')} />
            </div>
            <div>
              <label className="label">Mobile</label>
              <input type="tel" maxLength={10} className="input" {...f('mobile_no')} />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" {...f('email')} />
            </div>
            <div>
              <label className="label">Gender <RequiredMark /></label>
              <SearchableSelect
                value={form.classification ?? ''}
                onChange={(v) => updateField('classification', v)}
                options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]}
                placeholder="Select gender"
                buttonClassName={cn(SELECT_BUTTON_CLASS, fieldErrors.classification && 'border-red-500')}
              />
              {fieldErrors.classification && <p className="field-error">{fieldErrors.classification}</p>}
            </div>
            <div>
              <label className="label">Blood Group</label>
              <SearchableSelect
                value={form.blood ?? ''}
                onChange={(v) => updateField('blood', v)}
                options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => ({ value: bg, label: bg }))}
                placeholder="Select blood group"
                buttonClassName={SELECT_BUTTON_CLASS}
              />
            </div>
            <div>
              <label className="label">Marital Status</label>
              <SearchableSelect
                value={form.maritual_status ?? ''}
                onChange={(v) => updateField('maritual_status', v)}
                options={[{ value: 'Single', label: 'Single' }, { value: 'Married', label: 'Married' }]}
                placeholder="Select status"
                buttonClassName={SELECT_BUTTON_CLASS}
              />
            </div>
            <div>
              <label className="label">ID Card Number <RequiredMark /></label>
              <input maxLength={12} className={cn('input', fieldErrors.id_card && 'input-error')} {...f('id_card')} />
              {fieldErrors.id_card && <p className="field-error">{fieldErrors.id_card}</p>}
            </div>
            <div>
              <label className="label">LWF Code</label>
              <input
                maxLength={15}
                className={cn('input', fieldErrors.lwf_code && 'input-error')}
                {...f('lwf_code')}
                onChange={(e) => updateField('lwf_code', e.target.value.toUpperCase())}
              />
              {fieldErrors.lwf_code && <p className="field-error">{fieldErrors.lwf_code}</p>}
            </div>
          </div>
          <div className="mt-4">
            <FileUploadField
              label="Photo"
              value={form.profile_pic}
              onChange={(path) => setForm((prev) => ({ ...prev, profile_pic: path }))}
            />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Professional Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Joining Date</label>
              <input type="date" className="input" {...f('joining_date')} />
            </div>
            <div>
              <label className="label">Employment Type</label>
              <SearchableSelect
                value={form.emp_type ?? ''}
                onChange={(v) => updateField('emp_type', v)}
                options={EMP_TYPES.map((t) => ({ value: t, label: t }))}
                placeholder="Select type"
                buttonClassName={SELECT_BUTTON_CLASS}
              />
            </div>
            <div>
              <label className="label">Branch</label>
              <SearchableSelect
                value={form.emp_branch ?? ''}
                onChange={(v) => updateField('emp_branch', v)}
                options={branches}
                placeholder="Select branch"
                buttonClassName={SELECT_BUTTON_CLASS}
              />
            </div>
            <div>
              <label className="label">Department</label>
              <SearchableSelect
                value={form.emp_dept ?? ''}
                onChange={(v) => updateField('emp_dept', v)}
                options={departments}
                placeholder="Select department"
                buttonClassName={SELECT_BUTTON_CLASS}
              />
            </div>
            <div>
              <label className="label">Designation</label>
              <SearchableSelect
                value={form.designation ?? ''}
                onChange={(v) => updateField('designation', v)}
                options={designations}
                placeholder="Select designation"
                buttonClassName={SELECT_BUTTON_CLASS}
              />
            </div>
            <div>
              <label className="label">Grade</label>
              <SearchableSelect
                value={form.emp_grade ?? ''}
                onChange={(v) => updateField('emp_grade', v)}
                options={grades}
                placeholder="Select grade"
                buttonClassName={SELECT_BUTTON_CLASS}
              />
            </div>
            <div>
              <label className="label">Probation Period (days)</label>
              <input type="number" className="input" {...f('probation')} />
            </div>
            <div>
              <label className="label">Reporting Manager</label>
              <EmployeeSearch
                value={form.attr1}
                onChange={(empPkey) => setForm((prev) => ({ ...prev, attr1: empPkey }))}
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Statutory</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">PAN Number</label>
              <input
                maxLength={10}
                className={cn('input', fieldErrors.pan_no && 'input-error')}
                {...f('pan_no')}
                onChange={(e) => updateField('pan_no', e.target.value.toUpperCase())}
              />
              {fieldErrors.pan_no && <p className="field-error">{fieldErrors.pan_no}</p>}
            </div>
            <div>
              <label className="label">PF Number</label>
              <input maxLength={22} className={cn('input', fieldErrors.pf && 'input-error')} {...f('pf')} />
              {fieldErrors.pf && <p className="field-error">{fieldErrors.pf}</p>}
            </div>
            <div>
              <label className="label">Company PF</label>
              <input maxLength={12} className={cn('input', fieldErrors.company_pf && 'input-error')} {...f('company_pf')} />
              {fieldErrors.company_pf && <p className="field-error">{fieldErrors.company_pf}</p>}
            </div>
            <div>
              <label className="label">EPS</label>
              <input className="input" {...f('eps')} />
            </div>
            <div>
              <label className="label">ESI Number</label>
              <input maxLength={10} className={cn('input', fieldErrors.esi && 'input-error')} {...f('esi')} />
              {fieldErrors.esi && <p className="field-error">{fieldErrors.esi}</p>}
            </div>
            <div>
              <label className="label">ESI Dispensary</label>
              <input className="input" {...f('esi_dispensary')} />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Bank Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Bank Name</label>
              <input maxLength={100} className="input" {...f('bank_name')} />
            </div>
            <div>
              <label className="label">Bank Branch</label>
              <input maxLength={100} className="input" {...f('bank_branch_name')} />
            </div>
            <div>
              <label className="label">Branch Address</label>
              <input className="input" {...f('branch_address')} />
            </div>
            <div>
              <label className="label">IFSC Code</label>
              <input maxLength={12} className="input" {...f('ifsc_code')} />
            </div>
            <div>
              <label className="label">Account Number</label>
              <input maxLength={18} className={cn('input', fieldErrors.account_no && 'input-error')} {...f('account_no')} />
              {fieldErrors.account_no && <p className="field-error">{fieldErrors.account_no}</p>}
            </div>
          </div>
        </section>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? 'Creating…' : 'Create Employee'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>

      <style jsx>{`
        .label { display: block; font-size: 0.875rem; font-weight: 500; color: #374151; margin-bottom: 0.25rem; }
        .input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 0.5rem; font-size: 0.875rem; outline: none; }
        .input:focus { box-shadow: 0 0 0 2px #6366f1; border-color: transparent; }
        .input-error { border-color: #ef4444; }
        .field-error { font-size: 0.75rem; color: #ef4444; margin-top: 0.25rem; }
      `}</style>
    </div>
  );
}
