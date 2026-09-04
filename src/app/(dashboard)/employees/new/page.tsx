'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { FileUploadField } from '@/components/employees/FileUploadField';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { useSetupOptions } from '@/lib/setupOptions';

const EMPTY_FORM = {
  emp_id: '', first_name: '', last_name: '', date_of_birth: '',
  mobile_no: '', email: '',
  classification: '', blood: '', maritual_status: '', profile_pic: '',
  id_card: '', lwf_code: '',
  joining_date: '', emp_branch: '', emp_dept: '', designation: '', emp_grade: '',
  emp_type: '', attr1: '', probation: '',
  structure_id: '', emp_anual_ctc: '', emp_monthly_ctc: '',
  pan_no: '', name_as_on_pan: '', pf: '', company_pf: '', eps: '', esi: '', esi_dispensary: '',
  bank_name: '', bank_branch_name: '', branch_address: '', name_as_per_bank: '', ifsc_code: '', account_no: '',
};

export default function NewEmployeePage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: branches = [] } = useSetupOptions('setup/branches', 'branch_code', 'branch_name');
  const { data: departments = [] } = useSetupOptions('setup/departments', 'dept_code', 'dept_name');
  const { data: designations = [] } = useSetupOptions('setup/designations', 'desig_code', 'desig_name');
  const { data: grades = [] } = useSetupOptions('setup/grades', 'grade_code', 'grade_name');
  const { data: structures = [] } = useSetupOptions('setup/salary-structures', 'structure_id', 'structure_name');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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

  function f(key: keyof typeof EMPTY_FORM) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm((prev) => ({ ...prev, [key]: e.target.value })),
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
              <label className="label">Date of Birth</label>
              <input type="date" className="input" {...f('date_of_birth')} />
            </div>
            <div>
              <label className="label">First Name <span className="text-red-500">*</span></label>
              <input required className="input" {...f('first_name')} />
            </div>
            <div>
              <label className="label">Last Name</label>
              <input className="input" {...f('last_name')} />
            </div>
            <div>
              <label className="label">Mobile</label>
              <input type="tel" className="input" {...f('mobile_no')} />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" {...f('email')} />
            </div>
            <div>
              <label className="label">Gender</label>
              <select className="input" {...f('classification')}>
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div>
              <label className="label">Blood Group</label>
              <select className="input" {...f('blood')}>
                <option value="">Select blood group</option>
                {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => (
                  <option key={bg} value={bg}>{bg}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Marital Status</label>
              <select className="input" {...f('maritual_status')}>
                <option value="">Select status</option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
              </select>
            </div>
            <div>
              <label className="label">ID Card Number</label>
              <input className="input" {...f('id_card')} />
            </div>
            <div>
              <label className="label">LWF Code</label>
              <input className="input" {...f('lwf_code')} />
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
              <select className="input" {...f('emp_type')}>
                <option value="">Select type</option>
                <option value="Permanent">Permanent</option>
                <option value="Contract">Contract</option>
                <option value="Trainee">Trainee</option>
                <option value="Intern">Intern</option>
              </select>
            </div>
            <div>
              <label className="label">Branch</label>
              <select className="input" {...f('emp_branch')}>
                <option value="">Select branch</option>
                {branches.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Department</label>
              <select className="input" {...f('emp_dept')}>
                <option value="">Select department</option>
                {departments.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Designation</label>
              <select className="input" {...f('designation')}>
                <option value="">Select designation</option>
                {designations.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Grade</label>
              <select className="input" {...f('emp_grade')}>
                <option value="">Select grade</option>
                {grades.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
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
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Salary &amp; Statutory</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Salary Structure</label>
              <select className="input" {...f('structure_id')}>
                <option value="">Select structure</option>
                {structures.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div />
            <div>
              <label className="label">Annual CTC</label>
              <input type="number" className="input" {...f('emp_anual_ctc')} />
            </div>
            <div>
              <label className="label">Monthly CTC</label>
              <input type="number" className="input" {...f('emp_monthly_ctc')} />
            </div>
            <div>
              <label className="label">PAN Number</label>
              <input className="input" {...f('pan_no')} />
            </div>
            <div>
              <label className="label">Name as on PAN</label>
              <input className="input" {...f('name_as_on_pan')} />
            </div>
            <div>
              <label className="label">PF Number</label>
              <input className="input" {...f('pf')} />
            </div>
            <div>
              <label className="label">Company PF</label>
              <input className="input" {...f('company_pf')} />
            </div>
            <div>
              <label className="label">EPS</label>
              <input className="input" {...f('eps')} />
            </div>
            <div>
              <label className="label">ESIC Number</label>
              <input className="input" {...f('esi')} />
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
              <input className="input" {...f('bank_name')} />
            </div>
            <div>
              <label className="label">Bank Branch</label>
              <input className="input" {...f('bank_branch_name')} />
            </div>
            <div>
              <label className="label">Branch Address</label>
              <input className="input" {...f('branch_address')} />
            </div>
            <div>
              <label className="label">Name as per Bank</label>
              <input className="input" {...f('name_as_per_bank')} />
            </div>
            <div>
              <label className="label">IFSC Code</label>
              <input className="input" {...f('ifsc_code')} />
            </div>
            <div>
              <label className="label">Account Number</label>
              <input className="input" {...f('account_no')} />
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
      `}</style>
    </div>
  );
}
