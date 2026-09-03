'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';

interface SelectOption { value: string; label: string }
interface JoinDetail { join: Record<string, string> }

// Tolerant option mapper — see the useQuery block below for why this has to accept
// raw API rows, {code, name} maps and {value, label} maps interchangeably.
const opt = (codeKey: string, nameKey: string) => (rows: Record<string, unknown>[]): SelectOption[] =>
  (rows ?? []).map((r) => ({
    value: String(r[codeKey] ?? r.value ?? ''),
    label: String(r[nameKey] ?? r.label ?? ''),
  }));

const EMPTY_FORM = {
  emp_company_id: '', username: '', password: '',
  joining_date: '', emp_branch: '', emp_dept: '', designation: '', emp_grade: '',
  emp_type: '', attr1: '', probation: '',
  structure_id: '', emp_anual_ctc: '', emp_monthly_ctc: '',
};

interface OnboardFormProps {
  id: string;
  onBack: () => void;
  /** Called with the newly created employee's id once onboarding completes. */
  onOnboarded: (empPkey: number) => void;
  /** Set to false to hide the "Back" link, e.g. when a modal already provides a close control. */
  showBackLink?: boolean;
}

export function OnboardForm({ id, onBack, onOnboarded, showBackLink = true }: OnboardFormProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: join, isLoading: joinLoading, isError: joinError } = useQuery<JoinDetail>({
    queryKey: ['employees/join', id],
    queryFn: async () => {
      const res = await fetch(`/api/employees/join/${id}`);
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load join record');
      return res.json();
    },
  });

  // These lookups share their queryKey (['setup/branches'], etc.) with other pages. React Query
  // keys the cache by queryKey alone, and across the app the same key is filled with three
  // different shapes: raw API rows, {branch_code, branch_name} maps, and {value, label} maps
  // (useLookup/useSetupOptions). Whichever page loads first wins the cache entry, which is why
  // this dropdown sometimes rendered blank <option>s. Keep queryFn raw and make `select`
  // tolerant of every shape so render is correct regardless of load order.
  const { data: branches = [] } = useQuery<Record<string, unknown>[], Error, SelectOption[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
    select: opt('branch_code', 'branch_name'),
  });
  const { data: departments = [] } = useQuery<Record<string, unknown>[], Error, SelectOption[]>({
    queryKey: ['setup/departments'],
    queryFn: () => fetch('/api/setup/departments').then((r) => r.json()),
    select: opt('dept_code', 'dept_name'),
  });
  const { data: designations = [] } = useQuery<Record<string, unknown>[], Error, SelectOption[]>({
    queryKey: ['setup/designations'],
    queryFn: () => fetch('/api/setup/designations').then((r) => r.json()),
    select: opt('desig_code', 'desig_name'),
  });
  const { data: grades = [] } = useQuery<Record<string, unknown>[], Error, SelectOption[]>({
    queryKey: ['setup/grades'],
    queryFn: () => fetch('/api/setup/grades').then((r) => r.json()),
    select: opt('grade_code', 'grade_name'),
  });
  const { data: structures = [] } = useQuery<Record<string, unknown>[], Error, SelectOption[]>({
    queryKey: ['setup/salary-structures'],
    queryFn: () => fetch('/api/setup/salary-structures').then((r) => r.json()),
    select: opt('structure_id', 'structure_name'),
  });

  function f(key: keyof typeof EMPTY_FORM) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm((prev) => ({ ...prev, [key]: e.target.value })),
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/employees/join/${id}/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) { setError((await res.json()).error ?? 'Failed to onboard employee'); return; }
      const data = await res.json();
      onOnboarded(data.emp_pkey);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  if (joinError) {
    return (
      <div className="text-sm">
        <p className="text-red-600 mb-3">Couldn&apos;t load this join record. It may have been removed, or you may need to sign in again.</p>
        <button onClick={onBack} className="text-indigo-600 hover:text-indigo-800 font-medium">
          Back to Employee Join
        </button>
      </div>
    );
  }
  if (joinLoading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      {showBackLink && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      )}

      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Onboard Employee</h1>
      {join && (
        <p className="text-sm text-gray-500 mb-6">
          Converting join record for <span className="font-medium text-gray-700">{join.join.first_name} {join.join.last_name}</span>
        </p>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Identity &amp; Login</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Employee ID</label>
              <input className="input" {...f('emp_company_id')} placeholder="Leave as blanks if no ID" />
            </div>
            <div>
              <label className="label">Login Username <span className="text-red-500">*</span></label>
              <input required autoComplete="off" className="input" {...f('username')} placeholder="e.g. GRTL100024" />
            </div>
            <div>
              <label className="label">Initial Password <span className="text-red-500">*</span></label>
              <input required type="password" autoComplete="new-password" className="input" {...f('password')} />
            </div>
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
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Salary</h2>
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
          </div>
        </section>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? 'Onboarding…' : 'Complete Onboarding'}
          </button>
          <button
            type="button"
            onClick={onBack}
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
