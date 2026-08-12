'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRightCircle } from 'lucide-react';
import { RepeatableRows } from '@/components/employees/RepeatableRows';
import { DocumentUploadField } from '@/components/employees/DocumentUploadField';
import { FileUploadField } from '@/components/employees/FileUploadField';
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

function toFormState(join: Record<string, string>): Record<string, string> {
  const form: Record<string, string> = { ...join };
  for (const key of DATE_KEYS) {
    if (form[key]) form[key] = String(form[key]).slice(0, 10);
  }
  return form;
}

interface JoinDetailProps {
  id: string;
  /** Called when the user wants to leave this view (navigate back or close a modal). */
  onBack: () => void;
  /** Set to false to hide the "Back" link, e.g. when a modal already provides a close control. */
  showBackLink?: boolean;
}

export function JoinDetail({ id, onBack, showBackLink = true }: JoinDetailProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [docFile, setDocFile] = useState('');
  const [validationError, setValidationError] = useState('');

  const { data, isLoading, isError } = useQuery<JoinDetailData>({
    queryKey: ['employees/join', id],
    queryFn: async () => {
      const res = await fetch(`/api/employees/join/${id}`);
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load join record');
      return res.json();
    },
  });

  const { data: nationalities = [] } = useQuery<NationalityOption[]>({
    queryKey: ['setup/nationalities'],
    queryFn: () => fetch('/api/setup/nationalities').then((r) => r.json()),
  });

  useEffect(() => {
    if (data?.join) setForm(toFormState(data.join));
  }, [data]);

  const savePersonal = useMutation({
    mutationFn: () => fetch(`/api/employees/join/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees/join', id] }),
  });

  function f(key: string) {
    return {
      value: form[key] ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm((prev) => ({ ...prev, [key]: e.target.value })),
    };
  }

  function checkbox(key: string, label: string) {
    return (
      <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={form[key] === 'Y'}
          onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.checked ? 'Y' : 'N' }))}
        />
        {label}
      </label>
    );
  }

  function addChild(type: 'documents' | 'education' | 'experience' | 'family') {
    return async (values: Record<string, string>) => {
      await fetch(`/api/employees/join/${id}/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(type === 'documents' ? { ...values, files: docFile } : values),
      });
      if (type === 'documents') setDocFile('');
      queryClient.invalidateQueries({ queryKey: ['employees/join', id] });
    };
  }

  function removeChild(type: 'documents' | 'education' | 'experience' | 'family') {
    return async (rowId: number) => {
      await fetch(`/api/employees/join/${id}/${type}/${rowId}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['employees/join', id] });
    };
  }

  if (isError) {
    return (
      <div className="text-sm">
        <p className="text-red-600 mb-3">Couldn&apos;t load this join record. It may have been removed, or you may need to sign in again.</p>
        <button onClick={onBack} className="text-indigo-600 hover:text-indigo-800 font-medium">
          Back to Employee Join
        </button>
      </div>
    );
  }
  if (isLoading || !data) return <p className="text-sm text-gray-500">Loading…</p>;

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

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          {data.join.first_name} {data.join.last_name}
        </h1>
        <button
          onClick={() => router.push(`/employees/join/${id}/onboard`)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <ArrowRightCircle className="w-4 h-4" /> Continue Onboarding
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl space-y-6">
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Personal Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">First Name</label>
              <input className="input" {...f('first_name')} />
            </div>
            <div>
              <label className="label">Last Name</label>
              <input className="input" {...f('last_name')} />
            </div>
            <div>
              <label className="label">Date of Birth</label>
              <input type="date" max={new Date().toISOString().slice(0, 10)} className="input" {...f('date_of_birth')} />
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
              <label className="label">Aadhaar / ID Card</label>
              <input maxLength={12} className="input" {...f('id_card')} />
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
              <label className="label">Nationality</label>
              <select className="input" {...f('nationality_id')}>
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
            <textarea className="input" rows={2} value={form.address ?? ''} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
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
              value={form.profile_image_url ?? ''}
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
            {checkbox('eps', 'EPS Eligibility')}
            {checkbox('international_worker', 'International Worker')}
            {checkbox('physical_handicap', 'Physical Handicap')}
            {checkbox('locomotive', 'Locomotive Disability')}
            {checkbox('hearing', 'Hearing Disability')}
            {checkbox('visual', 'Visual Disability')}
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
          {validationError && <p className="text-red-500 text-sm mt-3">{validationError}</p>}
          <button
            onClick={() => {
              const err = dobError(form.date_of_birth ?? '') || mobileError(form.mobile_no ?? '') || aadhaarError(form.id_card ?? '');
              if (err) { setValidationError(err); return; }
              setValidationError('');
              savePersonal.mutate();
            }}
            disabled={savePersonal.isPending}
            className="mt-5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {savePersonal.isPending ? 'Saving…' : 'Save Details'}
          </button>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Documents</h2>
          <div className="mb-3">
            <label className="label">Upload file (attach before adding a row below)</label>
            <DocumentUploadField value={docFile} onChange={setDocFile} />
          </div>
          <RepeatableRows
            pkeyField="emp_doc_pkey"
            rows={data.documents}
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
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Education</h2>
          <RepeatableRows
            pkeyField="education_pkey"
            rows={data.education}
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
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Work Experience</h2>
          <RepeatableRows
            pkeyField="experience_pkey"
            rows={data.experience}
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
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Family</h2>
          <RepeatableRows
            pkeyField="emp_family_pkey"
            rows={data.family}
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

      <style jsx>{`
        .label { display: block; font-size: 0.875rem; font-weight: 500; color: #374151; margin-bottom: 0.25rem; }
        .input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 0.5rem; font-size: 0.875rem; outline: none; }
        .input:focus { box-shadow: 0 0 0 2px #6366f1; border-color: transparent; }
      `}</style>
    </div>
  );
}
