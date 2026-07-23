'use client';

import { use, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { FileUploadField } from '@/components/employees/FileUploadField';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { RepeatableRows } from '@/components/employees/RepeatableRows';
import { DocumentUploadField } from '@/components/employees/DocumentUploadField';

interface SelectOption { value: string; label: string }

const DOCUMENT_TYPES = ['Aadhaar', 'PAN', 'Passport', 'Driving License', 'Voter ID', 'Educational Certificate', 'Offer Letter', 'Relieving Letter', 'Other'];

function useSetupOptions(path: string, codeKey: string, nameKey: string) {
  return useQuery<SelectOption[]>({
    queryKey: [path],
    queryFn: () =>
      fetch(`/api/${path}`).then((r) => r.json()).then((rows: Record<string, unknown>[]) =>
        rows.map((r) => ({ value: String(r[codeKey]), label: String(r[nameKey]) }))
      ),
  });
}

export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
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

  if (isLoading) return <div className="text-gray-500 text-sm">Loading...</div>;
  if (!data?.employee) return <div className="text-red-500">Employee not found.</div>;

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
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        <p className="text-sm text-gray-900 font-medium">{value || '—'}</p>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => router.push('/employees')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-5 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Employees
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {emp.first_name} {emp.last_name}
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {emp.emp_id} · {emp.desig_name ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-green-600 text-sm">Saved.</span>}
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => update.mutate()}
                disabled={update.isPending}
                className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg transition-colors"
              >
                {update.isPending ? 'Saving…' : 'Save Changes'}
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="px-4 py-2 text-sm font-medium bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Personal Details */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Personal Details</h2>
          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">First Name</label>
                  <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('first_name')} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Last Name</label>
                  <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('last_name')} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date of Birth</label>
                <input type="date" className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('date_of_birth')} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Mobile</label>
                <input type="tel" className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('mobile_no')} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Email</label>
                <input type="email" className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('email')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Gender</label>
                  <select className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('classification')}>
                    <option value="">Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Blood Group</label>
                  <select className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('blood')}>
                    <option value="">Select</option>
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => <option key={bg} value={bg}>{bg}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Marital Status</label>
                <select className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('maritual_status')}>
                  <option value="">Select</option>
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ID Card Number</label>
                  <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('id_card')} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">LWF Code</label>
                  <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('lwf_code')} />
                </div>
              </div>
              <FileUploadField
                label="Photo"
                value={form.profile_pic ?? ''}
                onChange={(path) => setForm((prev) => ({ ...prev, profile_pic: path }))}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
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
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Professional Details</h2>
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Joining Date</label>
                <input type="date" className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('joining_date')} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Employment Type</label>
                <select className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('emp_type')}>
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
                  <label className="block text-xs text-gray-500 mb-1">{label}</label>
                  <select className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f(key)}>
                    <option value="">Select {label.toLowerCase()}</option>
                    {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              ))}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Probation Period (days)</label>
                <input type="number" className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('probation')} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Reporting Manager</label>
                <EmployeeSearch
                  value={form.attr1 ?? ''}
                  onChange={(empPkey) => setForm((prev) => ({ ...prev, attr1: empPkey }))}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
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
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Salary &amp; Statutory</h2>
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Salary Structure</label>
                <select className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('structure_id')}>
                  <option value="">Select structure</option>
                  {structures.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Annual CTC</label>
                  <input type="number" className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('emp_anual_ctc')} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Monthly CTC</label>
                  <input type="number" className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('emp_monthly_ctc')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">PAN Number</label>
                  <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('pan_no')} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Name as on PAN</label>
                  <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('name_as_on_pan')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">PF Number</label>
                  <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('pf')} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Company PF</label>
                  <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('company_pf')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">EPS</label>
                  <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('eps')} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ESIC Number</label>
                  <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('esi')} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ESI Dispensary</label>
                <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('esi_dispensary')} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
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
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Bank Details</h2>
          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Bank Name</label>
                  <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('bank_name')} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Bank Branch</label>
                  <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('bank_branch_name')} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Name as per Bank</label>
                <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('name_as_per_bank')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">IFSC Code</label>
                  <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('ifsc_code')} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Account Number</label>
                  <input className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" {...f('account_no')} />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <InfoRow label="Bank Name" value={emp.bank_name} />
              <InfoRow label="Bank Branch" value={emp.branch_name} />
              <InfoRow label="Name as per Bank" value={emp.name_as_per_bank} />
              <InfoRow label="IFSC Code" value={emp.ifsc_code} />
              <InfoRow label="Account Number" value={emp.account_no} />
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mt-5">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Documents</h2>
        <div className="mb-3 max-w-sm">
          <label className="block text-xs text-gray-500 mb-1">Upload file (attach before adding a row below)</label>
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
