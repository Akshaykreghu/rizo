'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { FileUploadField } from '@/components/employees/FileUploadField';
import { dobError, mobileError, aadhaarError } from '@/lib/validation';

interface NationalityOption { id: number; nationality: string; country_name: string }

const EMPTY_FORM = {
  first_name: '', last_name: '', date_of_birth: '', email: '', mobile_no: '', address: '',
  id_card: '', pincode: '', district: '', state: '', blood: '', maritual_status: '',
  guradian: '', relation_guardian: '', classification: '', nationality_id: '', country_origin: '',
  bank: '', bank_branch: '', ifsc_code: '', account_no: '', pf: '', company_pf: '', previous_member_id: '',
  esi_dispensary: '', esi: '', eps: 'N', pan_no: '', international_worker: 'N', locomotive: 'N',
  hearing: 'N', visual: 'N', physical_handicap: 'N', wps_code: '', lwf_code: '', profile_image_url: '',
};

export default function NewJoinPage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: nationalities = [] } = useQuery<NationalityOption[]>({
    queryKey: ['setup/nationalities'],
    queryFn: () => fetch('/api/setup/nationalities').then((r) => r.json()),
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
    const validationError = dobError(form.date_of_birth) || mobileError(form.mobile_no) || aadhaarError(form.id_card);
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/employees/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) { setError((await res.json()).error ?? 'Failed to create join record'); return; }
      const data = await res.json();
      router.push(`/employees/join/${data.emp_join_pkey}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-5 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <h1 className="text-2xl font-semibold text-gray-900 mb-6">New Employee Join</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl space-y-6">
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Personal Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">First Name <span className="text-red-500">*</span></label>
              <input required className="input" {...f('first_name')} />
            </div>
            <div>
              <label className="label">Last Name</label>
              <input className="input" {...f('last_name')} />
            </div>
            <div>
              <label className="label">Date of Birth <span className="text-red-500">*</span></label>
              <input required type="date" max={new Date().toISOString().slice(0, 10)} className="input" {...f('date_of_birth')} />
            </div>
            <div>
              <label className="label">Gender</label>
              <select className="input" {...f('classification')}>
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="others">Other</option>
              </select>
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
              <label className="label">Aadhaar / ID Card <span className="text-red-500">*</span></label>
              <input required maxLength={12} className="input" {...f('id_card')} />
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
                <option value="Divorced">Divorced</option>
                <option value="Widowed">Widowed</option>
              </select>
            </div>
            <div>
              <label className="label">Nationality <span className="text-red-500">*</span></label>
              <select required className="input" {...f('nationality_id')}>
                <option value="">Select nationality</option>
                {nationalities.map((n) => <option key={n.id} value={n.id}>{n.country_name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Country of Origin</label>
              <select className="input" {...f('country_origin')}>
                <option value="">Select country</option>
                {nationalities.map((n) => <option key={n.id} value={n.id}>{n.country_name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Guardian Name</label>
              <input className="input" {...f('guradian')} />
            </div>
            <div>
              <label className="label">Relation to Guardian</label>
              <input className="input" {...f('relation_guardian')} />
            </div>
          </div>
          <div className="mt-4">
            <label className="label">Address</label>
            <textarea className="input" rows={2} value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div>
              <label className="label">District</label>
              <input className="input" {...f('district')} />
            </div>
            <div>
              <label className="label">State</label>
              <input className="input" {...f('state')} />
            </div>
            <div>
              <label className="label">Pincode</label>
              <input className="input" {...f('pincode')} />
            </div>
          </div>
          <div className="mt-4">
            <FileUploadField
              label="Photo"
              value={form.profile_image_url}
              onChange={(path) => setForm((prev) => ({ ...prev, profile_image_url: path }))}
            />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Statutory Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">PAN Number</label>
              <input className="input" {...f('pan_no')} placeholder="ABCDE1234D" />
            </div>
            <div>
              <label className="label">PF Number</label>
              <input className="input" {...f('pf')} />
            </div>
            <div>
              <label className="label">UAN (Company PF)</label>
              <input className="input" {...f('company_pf')} />
            </div>
            <div>
              <label className="label">Previous PF Member ID</label>
              <input className="input" {...f('previous_member_id')} />
            </div>
            <div>
              <label className="label">ESIC Number</label>
              <input className="input" {...f('esi')} />
            </div>
            <div>
              <label className="label">ESI Dispensary</label>
              <input className="input" {...f('esi_dispensary')} />
            </div>
            <div>
              <label className="label">LWF Code</label>
              <input className="input" {...f('lwf_code')} />
            </div>
            <div>
              <label className="label">WPS Code</label>
              <input className="input" {...f('wps_code')} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4 mt-4">
            {([
              ['eps', 'EPS Eligibility'],
              ['international_worker', 'International Worker'],
              ['physical_handicap', 'Physical Handicap'],
              ['locomotive', 'Locomotive Disability'],
              ['hearing', 'Hearing Disability'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form[key] === 'Y'}
                  onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.checked ? 'Y' : 'N' }))}
                />
                {label}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.visual === 'Y'}
                onChange={(e) => setForm((prev) => ({ ...prev, visual: e.target.checked ? 'Y' : 'N' }))}
              />
              Visual Disability
            </label>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Bank Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Bank Name</label>
              <input className="input" {...f('bank')} />
            </div>
            <div>
              <label className="label">Bank Branch</label>
              <input className="input" {...f('bank_branch')} />
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
            {saving ? 'Saving…' : 'Save & Continue'}
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
